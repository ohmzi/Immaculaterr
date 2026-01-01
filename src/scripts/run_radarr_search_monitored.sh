#!/bin/bash
#
# Radarr Search Monitored Movies Runner
#
# This script triggers a search for all monitored movies in Radarr.
# It reads configuration from the project's config.yaml file.
#
# Usage:
#   ./run_radarr_search_monitored.sh [options]
#
# Options:
#   --verbose       Show detailed output
#   --no-pause      Don't pause at the end (for automated runs)
#   --log-file      Also save output to a log file
#   --help          Show this help message
#

# Don't exit on error immediately - we want to see what happened
# But still catch undefined variables
set -u

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Go up to project root: scripts/ -> src/ -> project root
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

# Ensure HOME is set (important for cron which may not have it)
if [[ -z "${HOME:-}" ]]; then
    # Try to get HOME from /etc/passwd or use a default
    export HOME=$(getent passwd "$(whoami)" | cut -d: -f6)
    if [[ -z "$HOME" ]]; then
        export HOME="/home/$(whoami)"
    fi
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
VERBOSE=""
NO_PAUSE=""
LOG_FILE=""

# Standardized exit codes for monitoring:
#  0  = SUCCESS
#  10 = PARTIAL
#  20 = DEPENDENCY_FAILED (Radarr/API/network)
#  30 = FAILED (config/deps/script)
status_from_exit_code() {
    local code="${1:-30}"
    case "$code" in
        0) echo "SUCCESS" ;;
        10) echo "PARTIAL" ;;
        20) echo "DEPENDENCY_FAILED" ;;
        30) echo "FAILED" ;;
        130) echo "INTERRUPTED" ;;
        *) echo "FAILED" ;;
    esac
}

on_exit() {
    local code=$?
    local status
    status=$(status_from_exit_code "$code")
    echo ""
    echo "FINAL_STATUS=${status} FINAL_EXIT_CODE=${code}"
}
trap on_exit EXIT

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE="true"
            shift
            ;;
        --no-pause)
            NO_PAUSE="true"
            shift
            ;;
        --log-file)
            LOG_FILE="true"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "This script triggers a search for all monitored movies in Radarr."
            echo ""
            echo "Options:"
            echo "  --verbose       Show detailed output"
            echo "  --no-pause      Don't pause at the end (for automated runs)"
            echo "  --log-file      Also save output to a log file in data/logs/"
            echo "  --help          Show this help message"
            echo ""
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Function to log messages
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        INFO)
            echo -e "${CYAN}[$timestamp]${NC} ${BLUE}INFO:${NC} $message"
            ;;
        SUCCESS)
            echo -e "${CYAN}[$timestamp]${NC} ${GREEN}✓${NC} $message"
            ;;
        WARNING)
            echo -e "${CYAN}[$timestamp]${NC} ${YELLOW}⚠${NC} $message"
            ;;
        ERROR)
            echo -e "${CYAN}[$timestamp]${NC} ${RED}✗${NC} $message"
            ;;
        DEBUG)
            if [[ -n "$VERBOSE" ]]; then
                echo -e "${CYAN}[$timestamp]${NC} ${YELLOW}DEBUG:${NC} $message"
            fi
            ;;
    esac
}

# Set up log file if requested
LOG_PATH=""
if [[ -n "$LOG_FILE" ]]; then
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    LOG_PATH="$PROJECT_ROOT/data/logs/radarr_search_monitored_${TIMESTAMP}.log"
    mkdir -p "$PROJECT_ROOT/data/logs"
    # Redirect all output to both terminal and log file
    # Strip ANSI color codes for log file while preserving colors in terminal
    # Use unbuffered sed to strip colors in real-time (handles both actual escapes and literal strings)
    exec > >(tee >(stdbuf -o0 -e0 sed -u -e 's/\x1b\[[0-9;]*m//g' -e 's/\\033\[[0-9;]*m//g' -e 's/\\x1b\[[0-9;]*m//g' >> "$LOG_PATH")) 2>&1
fi

# Ensure Python can find user-installed packages (important for cron)
export PYTHONUSERBASE="${HOME}/.local"
# Get user site-packages path dynamically using Python
USER_SITE_PACKAGES=$(python3 -c "import site; print(site.getusersitepackages())" 2>/dev/null || echo "${HOME}/.local/lib/python3.12/site-packages")
# Add user site-packages to Python path if not already there
export PYTHONPATH="${USER_SITE_PACKAGES}:${PYTHONPATH:-}"

# Print header (match other runner scripts)
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Radarr Search Monitored Movies${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Script: ${GREEN}$SCRIPT_DIR/$(basename "$0")${NC}"
echo -e "Working directory: ${GREEN}$PROJECT_ROOT${NC}"
if [[ -n "$LOG_PATH" ]]; then
    echo -e "Log file: ${GREEN}$LOG_PATH${NC}"
fi
echo ""

log INFO "Starting script..."
log DEBUG "Project root: $PROJECT_ROOT"
log DEBUG "Script directory: $SCRIPT_DIR"

# Check if yq is available
log INFO "Checking dependencies..."
if ! command -v yq &> /dev/null; then
    log ERROR "yq is not installed or not in PATH"
    echo "Please install yq to use this script."
    echo "On Ubuntu/Debian: sudo apt-get install yq"
    echo "On macOS: brew install yq"
    exit 30
fi
log SUCCESS "yq is available"

# Check if curl is available
if ! command -v curl &> /dev/null; then
    log ERROR "curl is not installed or not in PATH"
    exit 30
fi
log SUCCESS "curl is available"

# Pick config file (prefer config.local.* for secrets)
log INFO "Checking configuration file..."
CONFIG_FILE=""
for candidate in \
    "$PROJECT_ROOT/config/config.local.yaml" \
    "$PROJECT_ROOT/config/config.local.yml" \
    "$PROJECT_ROOT/config/config.yaml" \
    "$PROJECT_ROOT/config/config.yml"; do
    if [[ -f "$candidate" ]]; then
        CONFIG_FILE="$candidate"
        break
    fi
done

if [[ -z "$CONFIG_FILE" ]]; then
    log ERROR "No config file found in: $PROJECT_ROOT/config/"
    log ERROR "Expected one of: config.local.yaml, config.local.yml, config.yaml, config.yml"
    exit 30
fi
log SUCCESS "Configuration file found: $CONFIG_FILE"

# Helper to read YAML values safely
yq_get() {
    local expr="$1"
    local v
    v=$(yq "$expr" < "$CONFIG_FILE" 2>/dev/null | tr -d '"')
    # Normalize common null output
    if [[ "$v" == "null" || "$v" == "NULL" || "$v" == "Null" ]]; then
        v=""
    fi
    echo "$v"
}

# Detect placeholder keys so we fail fast with a clear message (instead of 401)
is_placeholder_key() {
    local key="${1:-}"
    local key_upper
    key_upper=$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')

    if [[ -z "$key" ]]; then
        return 0
    fi
    if [[ "$key_upper" == "RADARR_API_KEY" || "$key_upper" == "YOUR_RADARR_API_KEY" ]]; then
        return 0
    fi
    if [[ "$key" =~ [Xx]{8,} ]]; then
        return 0
    fi
    return 1
}

# Read configuration from config file
log INFO "Reading configuration from $(basename "$CONFIG_FILE")..."
RADARR_URL=$(yq_get '.radarr.url')
API_KEY=$(yq_get '.radarr.api_key')
ROOT_FOLDER=$(yq_get '.radarr.root_folder')
TAG_NAME=$(yq_get '.radarr.tag_name')

log DEBUG "Radarr URL: ${RADARR_URL:0:20}..." # Only show first 20 chars for security
log DEBUG "API Key: ${API_KEY:0:10}..." # Only show first 10 chars for security
log DEBUG "Root Folder: ${ROOT_FOLDER:-N/A}"
log DEBUG "Tag Name: ${TAG_NAME:-N/A}"

# Validate required configuration
if [[ -z "$RADARR_URL" ]]; then
    log ERROR "Radarr URL missing in $(basename "$CONFIG_FILE")"
    exit 30
fi
if is_placeholder_key "$API_KEY"; then
    log ERROR "Radarr API Key missing/placeholder in $(basename "$CONFIG_FILE")"
    log ERROR "Set radarr.api_key in config/config.local.yaml (recommended) or config/config.yaml"
    exit 30
fi
log SUCCESS "Configuration loaded successfully"

echo ""
echo -e "${CYAN}Configuration:${NC}"
echo -e "  Radarr URL: ${GREEN}$RADARR_URL${NC}"
echo -e "  Root Folder: ${GREEN}${ROOT_FOLDER:-N/A}${NC}"
echo -e "  Tag Name: ${GREEN}${TAG_NAME:-N/A}${NC}"
echo ""

# Trigger search for all monitored movies
log INFO "Preparing to trigger search for all monitored movies..."
log DEBUG "API Endpoint: $RADARR_URL/api/v3/command"
log DEBUG "Command: MoviesSearch"
log DEBUG "Filter: monitored = true"

echo -e "${BLUE}Triggering search for all monitored movies in Radarr...${NC}"
echo -e "${YELLOW}This may take a few seconds...${NC}"
echo ""

START_TIME=$(date +%s)

# Make the API call with better error handling
RESPONSE=$(curl -s -w "\n%{http_code}" \
    --max-time 30 \
    --connect-timeout 10 \
    -X POST "$RADARR_URL/api/v3/command" \
    -H "X-Api-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"name": "MoviesSearch", "filterKey": "monitored", "filterValue": "true"}' 2>&1)

CURL_EXIT_CODE=$?
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

log DEBUG "Curl exit code: $CURL_EXIT_CODE"
log DEBUG "Request completed in ${ELAPSED}s"

if [[ $CURL_EXIT_CODE -ne 0 ]]; then
    log ERROR "Failed to connect to Radarr"
    log ERROR "Curl exit code: $CURL_EXIT_CODE"
    log ERROR "Response: $RESPONSE"
    echo ""
    echo -e "${RED}============================================================${NC}"
    echo -e "${RED}Script failed - Connection error${NC}"
    echo -e "${RED}============================================================${NC}"
    echo ""
    echo "Possible issues:"
    echo "  - Radarr server is not running or not accessible"
    echo "  - Incorrect URL in config.yaml"
    echo "  - Network connectivity issues"
    echo "  - Firewall blocking connection"
    echo ""
    
    if [[ -z "$NO_PAUSE" ]]; then
        echo -e "${YELLOW}Press Enter to exit...${NC}"
        read
    fi
    exit 20
fi

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

log DEBUG "HTTP Status Code: $HTTP_CODE"
if [[ -n "$VERBOSE" && -n "$BODY" ]]; then
    log DEBUG "Response body: $BODY"
fi

echo ""
if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
    log SUCCESS "Search command triggered successfully"
    echo -e "${GREEN}HTTP Status: $HTTP_CODE${NC}"
    echo -e "${GREEN}Time taken: ${ELAPSED}s${NC}"
    
    if [[ -n "$BODY" ]]; then
        echo ""
        echo -e "${CYAN}Response:${NC}"
        echo "$BODY" | head -20  # Show first 20 lines
        if [[ $(echo "$BODY" | wc -l) -gt 20 ]]; then
            echo -e "${YELLOW}... (response truncated)${NC}"
        fi
    fi
    
    echo ""
    echo -e "${GREEN}============================================================${NC}"
    echo -e "${GREEN}Script completed successfully!${NC}"
    echo -e "${GREEN}============================================================${NC}"
    echo ""
    echo -e "${CYAN}Note:${NC} The search command has been queued in Radarr."
    echo -e "      You can monitor the search progress in Radarr's Activity tab."
    echo ""
    
    if [[ -n "$LOG_PATH" ]]; then
        echo -e "${CYAN}Log file saved to: $LOG_PATH${NC}"
        echo ""
    fi
    
    if [[ -z "$NO_PAUSE" ]]; then
        echo -e "${YELLOW}Press Enter to exit...${NC}"
        read
    fi
    exit 0
else
    log ERROR "Failed to trigger search command"
    echo -e "${RED}HTTP Status: $HTTP_CODE${NC}"
    
    if [[ -n "$BODY" ]]; then
        echo ""
        echo -e "${RED}Error Response:${NC}"
        echo "$BODY"
    fi
    
    echo ""
    echo -e "${RED}============================================================${NC}"
    echo -e "${RED}Script failed${NC}"
    echo -e "${RED}============================================================${NC}"
    echo ""
    
    case $HTTP_CODE in
        401)
            echo "Possible issues:"
            echo "  - Invalid API key in config.yaml"
            echo "  - API key may have been changed in Radarr"
            ;;
        404)
            echo "Possible issues:"
            echo "  - Radarr API endpoint not found"
            echo "  - Incorrect Radarr URL in config.yaml"
            ;;
        500|502|503|504)
            echo "Possible issues:"
            echo "  - Radarr server error"
            echo "  - Radarr may be overloaded or experiencing issues"
            ;;
        *)
            echo "Possible issues:"
            echo "  - Check Radarr server status"
            echo "  - Verify API key and URL in config.yaml"
            echo "  - Check Radarr logs for more details"
            ;;
    esac
    echo ""
    
    if [[ -n "$LOG_PATH" ]]; then
        echo -e "${CYAN}Log file saved to: $LOG_PATH${NC}"
        echo ""
    fi
    
    if [[ -z "$NO_PAUSE" ]]; then
        echo -e "${YELLOW}Press Enter to exit...${NC}"
        read
    fi
    exit 20
fi

