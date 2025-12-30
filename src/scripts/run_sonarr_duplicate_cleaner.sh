#!/bin/bash
#
# Sonarr Duplicate Episode Cleaner Runner
#
# This script runs the Sonarr duplicate episode cleaner to identify and remove
# duplicate episodes in Plex, keeping only the best quality version.
#
# Usage:
#   ./run_sonarr_duplicate_cleaner.sh [options]
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

# Ensure HOME is set to a non-root user's home (important for cron)
# Packages are installed in user's .local, not root's
# Priority: 1) ohmz user, 2) SUDO_USER if set, 3) script owner, 4) current user
if [[ -z "${HOME:-}" ]] || [[ "$HOME" == "/root" ]]; then
    # First, try ohmz user (most likely to have packages installed)
    if id "ohmz" &>/dev/null; then
        OHMZ_HOME=$(getent passwd "ohmz" | cut -d: -f6)
        if [[ -n "$OHMZ_HOME" ]] && [[ -d "$OHMZ_HOME" ]] && [[ -d "$OHMZ_HOME/.local/lib/python3.12/site-packages" ]]; then
            export HOME="$OHMZ_HOME"
        fi
    fi
    # If still root, try SUDO_USER (if script was run with sudo)
    if [[ -z "${HOME:-}" ]] || [[ "$HOME" == "/root" ]]; then
        if [[ -n "${SUDO_USER:-}" ]] && [[ "$SUDO_USER" != "root" ]]; then
            SUDO_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
            if [[ -n "$SUDO_HOME" ]] && [[ -d "$SUDO_HOME" ]]; then
                export HOME="$SUDO_HOME"
            fi
        fi
    fi
    # Try script owner
    if [[ -z "${HOME:-}" ]] || [[ "$HOME" == "/root" ]]; then
        SCRIPT_OWNER=$(stat -c '%U' "$0" 2>/dev/null || echo "")
        if [[ -n "$SCRIPT_OWNER" ]] && [[ "$SCRIPT_OWNER" != "root" ]]; then
            OWNER_HOME=$(getent passwd "$SCRIPT_OWNER" | cut -d: -f6)
            if [[ -n "$OWNER_HOME" ]] && [[ -d "$OWNER_HOME" ]]; then
                export HOME="$OWNER_HOME"
            fi
        fi
    fi
    # Final fallback: hardcode to ohmz
    if [[ -z "${HOME:-}" ]] || [[ "$HOME" == "/root" ]]; then
        export HOME="/home/ohmz"
    fi
fi

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
CLEANER_SCRIPT="$PROJECT_ROOT/src/tautulli_curated/helpers/sonarr_duplicate_cleaner.py"
if [[ ! -f "$CLEANER_SCRIPT" ]]; then
    echo -e "${RED}Error: sonarr_duplicate_cleaner.py not found at: $CLEANER_SCRIPT${NC}"
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
    LOG_PATH="$PROJECT_ROOT/data/logs/sonarr_duplicate_cleaner_${TIMESTAMP}.log"
    mkdir -p "$PROJECT_ROOT/data/logs"
    echo "Log file: $LOG_PATH"
fi

# Function to strip ANSI color codes (handles both actual escape sequences and literal \033 strings)
strip_colors() {
    sed -u -e 's/\x1b\[[0-9;]*m//g' -e 's/\\033\[[0-9;]*m//g' -e 's/\\x1b\[[0-9;]*m//g'
}

# Function to output (both to terminal and log file if enabled)
output() {
    echo "$@"
    if [[ -n "$LOG_PATH" ]]; then
        # Strip color codes for log file
        echo "$@" | strip_colors >> "$LOG_PATH"
    fi
}

# Function to output with color (both to terminal and log file if enabled)
output_color() {
    echo -e "$@"
    if [[ -n "$LOG_PATH" ]]; then
        # Strip color codes for log file - handle both \x1b and \033 formats
        echo -e "$@" | strip_colors >> "$LOG_PATH"
    fi
}

# Build command with unbuffered output
export PYTHONUNBUFFERED=1
# Ensure Python can find user-installed packages (important for cron)
export PYTHONUSERBASE="${HOME}/.local"
# Get user site-packages path dynamically using Python
USER_SITE_PACKAGES=$(python3 -c "import site; print(site.getusersitepackages())" 2>/dev/null || echo "${HOME}/.local/lib/python3.12/site-packages")
# Add src to PYTHONPATH so imports work (handle case where PYTHONPATH is unset)
# Add user site-packages first so user-installed packages take precedence
export PYTHONPATH="${USER_SITE_PACKAGES}:$PROJECT_ROOT/src:${PYTHONPATH:-}"

# Create a wrapper Python script that ensures paths are set before any imports
# This is critical for cron which may not automatically add user site-packages
TEMP_WRAPPER=$(mktemp)
cat > "$TEMP_WRAPPER" <<PYTHON_EOF
#!/usr/bin/env python3
import sys
import os
import site

# Enable user site-packages explicitly (important for cron)
# This ensures user-installed packages are available
user_site = "${USER_SITE_PACKAGES}"
if user_site and os.path.exists(user_site):
    # Use site.addsitedir to properly enable the directory
    site.addsitedir(user_site)
    # Also add to sys.path as backup
    if user_site not in sys.path:
        sys.path.insert(0, user_site)

# Add project src to sys.path
project_src = "${PROJECT_ROOT}/src"
if project_src and os.path.exists(project_src):
    if project_src not in sys.path:
        sys.path.insert(0, project_src)

# Verify plexapi can be imported (for debugging)
try:
    import plexapi
    print(f"DEBUG: plexapi found at {plexapi.__file__}", file=sys.stderr)
except ImportError as e:
    print(f"DEBUG: Failed to import plexapi: {e}", file=sys.stderr)
    print(f"DEBUG: sys.path = {sys.path}", file=sys.stderr)
    raise

# Now import and execute the actual script
import importlib.util
spec = importlib.util.spec_from_file_location("__main__", "${CLEANER_SCRIPT}")
module = importlib.util.module_from_spec(spec)
sys.argv = ["${CLEANER_SCRIPT}"]
PYTHON_EOF

# Add command-line arguments to the wrapper
if [[ -n "$DRY_RUN" ]]; then
    echo 'sys.argv.append("--dry-run")' >> "$TEMP_WRAPPER"
fi
if [[ -n "$VERBOSE" ]]; then
    echo 'sys.argv.append("--verbose")' >> "$TEMP_WRAPPER"
fi

# Complete the wrapper script
cat >> "$TEMP_WRAPPER" <<PYTHON_EOF
spec.loader.exec_module(module)
PYTHON_EOF

chmod +x "$TEMP_WRAPPER"

CMD="$PYTHON_CMD -u $TEMP_WRAPPER"
if [[ -n "$DRY_RUN" ]]; then
    CMD="$CMD $DRY_RUN"
fi
if [[ -n "$VERBOSE" ]]; then
    CMD="$CMD $VERBOSE"
fi

# Print header
output_color "${BLUE}========================================${NC}"
output_color "${BLUE}Sonarr Duplicate Episode Cleaner${NC}"
output_color "${BLUE}========================================${NC}"
output ""
output_color "Script: ${GREEN}$CLEANER_SCRIPT${NC}"
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
output_color "${BLUE}Starting duplicate episode cleaner...${NC}"
output ""
output_color "${YELLOW}This script will:${NC}"
output_color "${YELLOW}  - Scan Plex TV shows library for duplicate episodes${NC}"
output_color "${YELLOW}  - Identify episodes with multiple copies${NC}"
output_color "${YELLOW}  - Delete worst quality versions (by resolution)${NC}"
output_color "${YELLOW}  - Unmonitor episodes in Sonarr after deletion${NC}"
output ""

EXIT_CODE=0
if [[ -n "$LOG_PATH" ]]; then
    # Run with both terminal output and log file
    # Strip ANSI color codes for log file while preserving colors in terminal
    set +o pipefail  # Allow pipe to continue even if command fails
    # Use unbuffered sed to strip colors in real-time (handles both actual escapes and literal strings)
    $CMD 2>&1 | tee >(stdbuf -o0 -e0 sed -u -e 's/\x1b\[[0-9;]*m//g' -e 's/\\033\[[0-9;]*m//g' -e 's/\\x1b\[[0-9;]*m//g' >> "$LOG_PATH")
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

# Clean up temp wrapper
if [[ -n "${TEMP_WRAPPER:-}" ]] && [[ -f "$TEMP_WRAPPER" ]]; then
    rm -f "$TEMP_WRAPPER" 2>/dev/null
fi

exit $EXIT_CODE

