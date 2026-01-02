#!/bin/bash
#
# TV Immaculate Taste Collection Runner
#
# Runs the TV Immaculate Taste pipeline for a given seed show/episode title.
#
# Usage:
#   ./run_tv_immaculate_taste_collection.sh "Show - Episode Title" [media_type] [options]
#
# Examples:
#   ./run_tv_immaculate_taste_collection.sh "Mayor of Kingstown - The End Begins" episode --log-file --no-pause
#   ./run_tv_immaculate_taste_collection.sh "Mayor of Kingstown" show --log-file --no-pause
#
# Options:
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

NO_PAUSE=""
LOG_FILE=""
PYTHON_CMD="python3"

SEED_TITLE=""
MEDIA_TYPE="episode"
MEDIA_TYPE_SET=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-pause)
            NO_PAUSE="true"
            shift
            ;;
        --log-file)
            LOG_FILE="true"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 \"Show - Episode Title\" [media_type] [options]"
            echo ""
            echo "Options:"
            echo "  --no-pause      Don't pause at the end (for automated runs)"
            echo "  --log-file      Also save output to a log file"
            echo "  --help          Show this help message"
            echo ""
            exit 0
            ;;
        --*)
            echo -e "${RED}Error: Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
        *)
            if [[ -z "$SEED_TITLE" ]]; then
                SEED_TITLE="$1"
                shift
                continue
            fi
            if [[ -z "$MEDIA_TYPE_SET" ]]; then
                MEDIA_TYPE="$1"
                MEDIA_TYPE_SET="true"
                shift
                continue
            fi
            echo -e "${RED}Error: Unexpected extra argument: $1${NC}"
            exit 1
            ;;
    esac
done

if [[ -z "$SEED_TITLE" ]]; then
    echo -e "${RED}Error: missing required seed title${NC}"
    echo "Usage: $0 \"Show - Episode Title\" [media_type] [options]"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: python3 is not installed or not in PATH${NC}"
    exit 1
fi

PIPELINE_SCRIPT="$PROJECT_ROOT/src/tautulli_curated/helpers/tv_immaculate_taste_collection.py"
if [[ ! -f "$PIPELINE_SCRIPT" ]]; then
    echo -e "${RED}Error: tv_immaculate_taste_collection.py not found at: $PIPELINE_SCRIPT${NC}"
    exit 1
fi

# Always set up log file for monitoring
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_PATH="$PROJECT_ROOT/data/logs/tv_immaculate_taste_collection_${TIMESTAMP}.log"
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
seed = sys.argv[1] if len(sys.argv) > 1 else ""
media_type = sys.argv[2] if len(sys.argv) > 2 else "episode"
spec = importlib.util.spec_from_file_location("__main__", "${PIPELINE_SCRIPT}")
module = importlib.util.module_from_spec(spec)
sys.argv = ["${PIPELINE_SCRIPT}", seed, media_type]
spec.loader.exec_module(module)
PYTHON_EOF

chmod +x "$TEMP_WRAPPER"
CMD=("$PYTHON_CMD" -u "$TEMP_WRAPPER" "$SEED_TITLE" "$MEDIA_TYPE")

output_color "${BLUE}========================================${NC}"
output_color "${BLUE}TV Immaculate Taste Collection Runner${NC}"
output_color "${BLUE}========================================${NC}"
output ""
output_color "Script: ${GREEN}$PIPELINE_SCRIPT${NC}"
output_color "Working directory: ${GREEN}$PROJECT_ROOT${NC}"
output_color "Python: ${GREEN}$(python3 --version)${NC}"
output_color "Seed: ${GREEN}$SEED_TITLE${NC}"
output_color "Media type: ${GREEN}$MEDIA_TYPE${NC}"
output_color "Log file: ${GREEN}$LOG_PATH${NC}"
output ""

output_color "${BLUE}Starting pipeline...${NC}"
output ""

EXIT_CODE=0
set +o pipefail
"${CMD[@]}" 2>&1 | tee >(stdbuf -o0 -e0 sed -u -e 's/\x1b\[[0-9;]*m//g' -e 's/\\033\[[0-9;]*m//g' -e 's/\\x1b\[[0-9;]*m//g' >> "$LOG_PATH")
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


