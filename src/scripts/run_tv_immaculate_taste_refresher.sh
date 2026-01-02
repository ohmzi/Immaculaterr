#!/bin/bash
#
# TV Immaculate Taste Collection Refresher Runner
#
# Refreshes the "Inspired by your Immaculate Taste (TV)" Plex collection by:
# - Reading recommendation_points_tv.json
# - Randomizing the order of shows
# - Updating the Plex collection
#
# Usage:
#   ./run_tv_immaculate_taste_refresher.sh [options]
#
# Options:
#   --dry-run       Run in dry-run mode (no Plex changes)
#   --verbose       Enable verbose logging
#   --no-pause      Don't pause at the end (for automated runs)
#   --log-file      Also save output to a log file (data/logs/)
#   --help          Show this help message
#

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

# Ensure HOME is set to a non-root user's home (important for cron)
if [[ -z "${HOME:-}" ]] || [[ "$HOME" == "/root" ]]; then
    if id "ohmz" &>/dev/null; then
        OHMZ_HOME=$(getent passwd "ohmz" | cut -d: -f6)
        if [[ -n "$OHMZ_HOME" ]] && [[ -d "$OHMZ_HOME" ]]; then
            export HOME="$OHMZ_HOME"
        fi
    fi
    if [[ -z "${HOME:-}" ]] || [[ "$HOME" == "/root" ]]; then
        export HOME="/home/ohmz"
    fi
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Defaults
DRY_RUN=""
VERBOSE=""
NO_PAUSE=""
LOG_FILE=""
PYTHON_CMD="python3"

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

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: python3 is not installed or not in PATH${NC}"
    exit 1
fi

REFRESHER_SCRIPT="$PROJECT_ROOT/src/tautulli_curated/helpers/tv_immaculate_taste_refresher.py"
if [[ ! -f "$REFRESHER_SCRIPT" ]]; then
    echo -e "${RED}Error: tv_immaculate_taste_refresher.py not found at: $REFRESHER_SCRIPT${NC}"
    exit 1
fi

# Always set up log file for monitoring
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_PATH="$PROJECT_ROOT/data/logs/tv_immaculate_taste_refresher_${TIMESTAMP}.log"
mkdir -p "$PROJECT_ROOT/data/logs"

strip_colors() {
    sed -u -e 's/\x1b\[[0-9;]*m//g' -e 's/\\033\[[0-9;]*m//g' -e 's/\\x1b\[[0-9;]*m//g'
}

output() {
    echo "$@"
    echo "$@" | strip_colors >> "$LOG_PATH"
}

output_color() {
    echo -e "$@"
    echo -e "$@" | strip_colors >> "$LOG_PATH"
}

export PYTHONUNBUFFERED=1
export PYTHONUSERBASE="${HOME}/.local"
USER_SITE_PACKAGES=$(python3 -c "import site; print(site.getusersitepackages())" 2>/dev/null || echo "${HOME}/.local/lib/python3.12/site-packages")
export PYTHONPATH="${USER_SITE_PACKAGES}:$PROJECT_ROOT/src:${PYTHONPATH:-}"

# Wrapper to ensure paths are set before imports (cron-safe)
TEMP_WRAPPER=$(mktemp)
cat > "$TEMP_WRAPPER" <<PYTHON_EOF
#!/usr/bin/env python3
import sys
import os
import site

user_site = "${USER_SITE_PACKAGES}"
if user_site and os.path.exists(user_site):
    site.addsitedir(user_site)
    if user_site not in sys.path:
        sys.path.insert(0, user_site)

project_src = "${PROJECT_ROOT}/src"
if project_src and os.path.exists(project_src):
    if project_src not in sys.path:
        sys.path.insert(0, project_src)

import importlib.util
spec = importlib.util.spec_from_file_location("__main__", "${REFRESHER_SCRIPT}")
module = importlib.util.module_from_spec(spec)
sys.argv = ["${REFRESHER_SCRIPT}"]
PYTHON_EOF

if [[ -n "$DRY_RUN" ]]; then
    echo 'sys.argv.append("--dry-run")' >> "$TEMP_WRAPPER"
fi
if [[ -n "$VERBOSE" ]]; then
    echo 'sys.argv.append("--verbose")' >> "$TEMP_WRAPPER"
fi

cat >> "$TEMP_WRAPPER" <<PYTHON_EOF
spec.loader.exec_module(module)
PYTHON_EOF

chmod +x "$TEMP_WRAPPER"
CMD="$PYTHON_CMD -u $TEMP_WRAPPER"

output_color "${BLUE}========================================${NC}"
output_color "${BLUE}TV Immaculate Taste Collection Refresher${NC}"
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
output_color "Log file: ${GREEN}$LOG_PATH${NC}"
output ""

output_color "${BLUE}Starting refresher...${NC}"
output ""

EXIT_CODE=0
set +o pipefail
$CMD 2>&1 | tee >(stdbuf -o0 -e0 sed -u -e 's/\x1b\[[0-9;]*m//g' -e 's/\\033\[[0-9;]*m//g' -e 's/\\x1b\[[0-9;]*m//g' >> "$LOG_PATH")
EXIT_CODE=${PIPESTATUS[0]}

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

if [[ -z "$NO_PAUSE" ]]; then
    output ""
    output_color "${YELLOW}Press Enter to close this window...${NC}"
    read -r
fi

output ""
output_color "Full log saved to: ${GREEN}$LOG_PATH${NC}"

if [[ -n "${TEMP_WRAPPER:-}" ]] && [[ -f "$TEMP_WRAPPER" ]]; then
    rm -f "$TEMP_WRAPPER" 2>/dev/null
fi

output "FINAL_STATUS=${FINAL_STATUS} FINAL_EXIT_CODE=${EXIT_CODE}"
exit $EXIT_CODE


