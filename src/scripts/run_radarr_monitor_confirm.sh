#!/bin/bash
#
# Radarr Monitor Confirm Runner
#
# This script checks all monitored movies in Radarr and unmonitors those
# that already exist in your Plex library. This helps keep Radarr and Plex
# synchronized and prevents unnecessary tracking.
#
# Usage:
#   ./run_radarr_monitor_confirm.sh [options]
#
# Options:
#   --dry-run       Show what would be done without actually unmonitoring
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
PYTHON_CMD="python3"
DRY_RUN=""
VERBOSE=""
NO_PAUSE=""
LOG_FILE=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "This script checks all monitored movies in Radarr and unmonitors those"
            echo "that already exist in your Plex library."
            echo ""
            echo "Options:"
            echo "  --dry-run       Show what would be done without actually unmonitoring"
            echo "  --verbose       Enable verbose logging"
            echo "  --no-pause      Don't pause at the end (for automated runs)"
            echo "  --log-file      Also save output to a log file in data/logs/"
            echo "  --help          Show this help message"
            echo ""
            exit 0
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
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
        *)
            echo -e "${RED}Error: Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 30
            ;;
    esac
done

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: python3 is not installed or not in PATH${NC}"
    exit 30
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
    LOG_PATH="$PROJECT_ROOT/data/logs/radarr_monitor_confirm_${TIMESTAMP}.log"
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
        echo "$@" | strip_colors >> "$LOG_PATH"
    fi
}

# Function to output with color (both to terminal and log file if enabled)
output_color() {
    echo -e "$@"
    if [[ -n "$LOG_PATH" ]]; then
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

# Create a temporary Python script file
TEMP_SCRIPT=$(mktemp)

# Determine flags for Python
if [[ -n "$DRY_RUN" ]]; then
    DRY_RUN_PYTHON="True"
else
    DRY_RUN_PYTHON="False"
fi
if [[ -n "$VERBOSE" ]]; then
    VERBOSE_PYTHON="True"
else
    VERBOSE_PYTHON="False"
fi

cat > "$TEMP_SCRIPT" <<PYTHON_EOF
#!/usr/bin/env python3
import sys
import logging
from pathlib import Path
from requests.exceptions import Timeout, ConnectionError as RequestsConnectionError
from urllib3.exceptions import ReadTimeoutError, ConnectTimeoutError

# Add project root to path for standalone execution
project_root = Path("$PROJECT_ROOT").resolve()
sys.path.insert(0, str(project_root / "src"))

from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers import radarr_monitor_confirm as mod

try:
    verbose = $VERBOSE_PYTHON
    if verbose:
        mod.logger.setLevel(logging.DEBUG)
        logging.getLogger("config_loader").setLevel(logging.DEBUG)

    config = load_config()
    dry_run = $DRY_RUN_PYTHON

    total_monitored, already_in_plex, unmonitored, stats = mod.run_radarr_monitor_confirm_with_stats(
        config=config,
        dry_run=dry_run,
    )

    print("")
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total monitored in Radarr: {total_monitored}")
    print(f"Already in Plex: {already_in_plex}")
    if dry_run:
        print(f"Would unmonitor: {unmonitored}")
    else:
        print(f"Unmonitored: {unmonitored}")
    print(f"Failed unmonitor attempts: {stats.get('failed_unmonitor', 0)}")
    print(f"Dependency checks: radarr_ok={stats.get('radarr_ok')} plex_ok={stats.get('plex_ok')}")
    print("=" * 60)

    if not stats.get("radarr_ok", True) or not stats.get("plex_ok", True):
        status = "DEPENDENCY_FAILED"
        exit_code = 20
    elif int(stats.get("failed_unmonitor", 0) or 0) > 0:
        status = "PARTIAL"
        exit_code = 10
    else:
        status = "SUCCESS"
        exit_code = 0

    print(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
    sys.exit(exit_code)
except KeyboardInterrupt:
    print("\nScript interrupted by user", file=sys.stderr)
    print("FINAL_STATUS=INTERRUPTED FINAL_EXIT_CODE=130")
    sys.exit(130)
except Exception as e:
    dependency_failed = isinstance(e, (Timeout, RequestsConnectionError, ReadTimeoutError, ConnectTimeoutError))
    status = "DEPENDENCY_FAILED" if dependency_failed else "FAILED"
    exit_code = 20 if dependency_failed else 30
    print(f"Error: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    print(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
    sys.exit(exit_code)
PYTHON_EOF

# Print header
output_color "${BLUE}========================================${NC}"
output_color "${BLUE}Radarr Monitor Confirm${NC}"
output_color "${BLUE}========================================${NC}"
output ""
output_color "Script: ${GREEN}$SCRIPT_DIR/$(basename "$0")${NC}"
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

# Run the Python script
output_color "${BLUE}Starting Radarr monitor confirmation...${NC}"
output ""

EXIT_CODE=0
if [[ -n "$LOG_PATH" ]]; then
    set +o pipefail
    $PYTHON_CMD -u "$TEMP_SCRIPT" 2>&1 | tee >(stdbuf -o0 -e0 sed -u -e 's/\x1b\[[0-9;]*m//g' -e 's/\\033\[[0-9;]*m//g' -e 's/\\x1b\[[0-9;]*m//g' >> "$LOG_PATH")
    EXIT_CODE=${PIPESTATUS[0]}
else
    $PYTHON_CMD -u "$TEMP_SCRIPT"
    EXIT_CODE=$?
fi

# Clean up temp script
rm -f "$TEMP_SCRIPT"

output ""

FINAL_STATUS="FAILED"
case "$EXIT_CODE" in
    0) FINAL_STATUS="SUCCESS" ;;
    10) FINAL_STATUS="PARTIAL" ;;
    20) FINAL_STATUS="DEPENDENCY_FAILED" ;;
    30) FINAL_STATUS="FAILED" ;;
    130) FINAL_STATUS="INTERRUPTED" ;;
    *) FINAL_STATUS="FAILED" ;;
esac

if [[ "$FINAL_STATUS" == "SUCCESS" ]]; then
    output_color "${GREEN}========================================${NC}"
    output_color "${GREEN}Script completed successfully!${NC}"
    output_color "${GREEN}========================================${NC}"
elif [[ "$FINAL_STATUS" == "PARTIAL" ]]; then
    output_color "${YELLOW}========================================${NC}"
    output_color "${YELLOW}Script completed with warnings (PARTIAL) - exit code: $EXIT_CODE${NC}"
    output_color "${YELLOW}========================================${NC}"
elif [[ "$FINAL_STATUS" == "INTERRUPTED" ]]; then
    output_color "${YELLOW}========================================${NC}"
    output_color "${YELLOW}Script interrupted (exit code: $EXIT_CODE)${NC}"
    output_color "${YELLOW}========================================${NC}"
else
    output_color "${RED}========================================${NC}"
    output_color "${RED}Script failed (${FINAL_STATUS}) with exit code: $EXIT_CODE${NC}"
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

# Stable final line for monitoring
output "FINAL_STATUS=${FINAL_STATUS} FINAL_EXIT_CODE=${EXIT_CODE}"

exit $EXIT_CODE

