#!/bin/bash
#
# Immaculate Taste Collection Refresher Runner
#
# This script refreshes the "Inspired by your Immaculate Taste" Plex collection
# by randomizing the order of movies and updating them in Plex.
#
# Usage:
#   ./run_immaculate_taste_refresher.sh [options]
#
# Options:
#   --dry-run       Run in dry-run mode (no Plex changes)
#   --verbose       Enable verbose logging
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

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DRY_RUN=""
VERBOSE=""
NO_PAUSE=""
LOG_FILE=""
PYTHON_CMD="python3"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN="--dry-run"
            shift
            ;;
        --verbose|-v)
            VERBOSE="--verbose"
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
            echo "Options:"
            echo "  --dry-run       Run in dry-run mode (no Plex changes)"
            echo "  --verbose       Enable verbose logging"
            echo "  --no-pause      Don't pause at the end (for automated runs)"
            echo "  --log-file      Also save output to a log file"
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

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: python3 is not installed or not in PATH${NC}"
    exit 1
fi

# Check if the Python script exists
REFRESHER_SCRIPT="$PROJECT_ROOT/src/tautulli_curated/helpers/immaculate_taste_refresher.py"
if [[ ! -f "$REFRESHER_SCRIPT" ]]; then
    echo -e "${RED}Error: immaculate_taste_refresher.py not found at: $REFRESHER_SCRIPT${NC}"
    exit 1
fi

# Check if config.yaml exists
if [[ ! -f "$PROJECT_ROOT/config/config.yaml" ]]; then
    echo -e "${YELLOW}Warning: config.yaml not found at: $PROJECT_ROOT/config/config.yaml${NC}"
    echo -e "${YELLOW}The script may fail if configuration is missing.${NC}"
fi

# Set up log file if requested
LOG_PATH=""
if [[ -n "$LOG_FILE" ]]; then
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    LOG_PATH="$PROJECT_ROOT/data/logs/immaculate_taste_refresher_${TIMESTAMP}.log"
    mkdir -p "$PROJECT_ROOT/data/logs"
    echo "Log file: $LOG_PATH"
fi

# Function to output (both to terminal and log file if enabled)
output() {
    echo "$@"
    if [[ -n "$LOG_PATH" ]]; then
        # Strip color codes for log file
        echo "$@" | sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_PATH"
    fi
}

# Function to output with color (both to terminal and log file if enabled)
output_color() {
    echo -e "$@"
    if [[ -n "$LOG_PATH" ]]; then
        # Strip color codes for log file
        echo "$@" | sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_PATH"
    fi
}

# Build command with unbuffered output
export PYTHONUNBUFFERED=1
# Add src to PYTHONPATH so imports work
export PYTHONPATH="$PROJECT_ROOT/src:$PYTHONPATH"
CMD="$PYTHON_CMD -u $REFRESHER_SCRIPT"
if [[ -n "$DRY_RUN" ]]; then
    CMD="$CMD $DRY_RUN"
fi
if [[ -n "$VERBOSE" ]]; then
    CMD="$CMD $VERBOSE"
fi

# Print header
output_color "${BLUE}========================================${NC}"
output_color "${BLUE}Immaculate Taste Collection Refresher${NC}"
output_color "${BLUE}========================================${NC}"
output ""
output_color "Script: ${GREEN}$REFRESHER_SCRIPT${NC}"
output_color "Working directory: ${GREEN}$PROJECT_ROOT${NC}"
output_color "Python: ${GREEN}$(python3 --version)${NC}"
if [[ -n "$DRY_RUN" ]]; then
    output_color "Mode: ${YELLOW}DRY RUN${NC}"
fi
if [[ -n "$VERBOSE" ]]; then
    output_color "Logging: ${YELLOW}VERBOSE${NC}"
fi
if [[ -n "$LOG_PATH" ]]; then
    output_color "Log file: ${GREEN}$LOG_PATH${NC}"
fi
output ""

# Run the script and capture output
output_color "${BLUE}Starting refresher...${NC}"
output ""

EXIT_CODE=0
if [[ -n "$LOG_PATH" ]]; then
    # Run with both terminal output and log file
    # Capture exit code from the command, not from tee
    set +o pipefail  # Allow pipe to continue even if command fails
    $CMD 2>&1 | tee -a "$LOG_PATH"
    EXIT_CODE=${PIPESTATUS[0]}  # Get exit code from the command, not tee
else
    # Run normally
    $CMD
    EXIT_CODE=$?
fi

output ""

if [[ $EXIT_CODE -eq 0 ]]; then
    output_color "${GREEN}========================================${NC}"
    output_color "${GREEN}Script completed successfully!${NC}"
    output_color "${GREEN}========================================${NC}"
else
    output_color "${RED}========================================${NC}"
    output_color "${RED}Script failed with exit code: $EXIT_CODE${NC}"
    output_color "${RED}========================================${NC}"
fi

# Pause at the end unless --no-pause is specified
if [[ -z "$NO_PAUSE" ]]; then
    output ""
    output_color "${YELLOW}Press Enter to close this window...${NC}"
    read -r
fi

if [[ -n "$LOG_PATH" ]]; then
    output ""
    output_color "Full log saved to: ${GREEN}$LOG_PATH${NC}"
fi

exit $EXIT_CODE

