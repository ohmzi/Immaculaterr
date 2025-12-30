#!/bin/bash
#
# Sonarr Monitor Confirm Runner
#
# This script checks all monitored series and episodes in Sonarr and unmonitors
# episodes that already exist in your Plex library. If any episode is missing from
# Plex, the series remains monitored.
#
# Usage:
#   ./run_sonarr_monitor_confirm.sh [options]
#
# Options:
#   --dry-run    Show what would be done without actually unmonitoring
#   --no-pause   Don't pause at the end (for automated runs)
#   --help       Show this help message
#

# Don't exit on error immediately - we want to see what happened
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
NC='\033[0m' # No Color

# Default values
PYTHON_CMD="python3"
DRY_RUN=""
NO_PAUSE=""

# Parse command line arguments
for arg in "$@"; do
    case "$arg" in
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "This script checks all monitored series and episodes in Sonarr and unmonitors"
            echo "episodes that already exist in your Plex library. If any episode is missing"
            echo "from Plex, the series remains monitored."
            echo ""
            echo "Options:"
            echo "  --dry-run      Show what would be done without actually unmonitoring"
            echo "  --no-pause     Don't pause at the end (for automated runs)"
            echo "  --help         Show this help message"
            echo ""
            exit 0
            ;;
        --dry-run)
            DRY_RUN="true"
            ;;
        --no-pause)
            NO_PAUSE="true"
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

# Check if config.yaml exists
if [[ ! -f "$PROJECT_ROOT/config/config.yaml" ]]; then
    echo -e "${YELLOW}Warning: config.yaml not found at: $PROJECT_ROOT/config/config.yaml${NC}"
    echo -e "${YELLOW}The script may fail if configuration is missing.${NC}"
fi

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

# Determine dry_run value for Python
if [[ -n "$DRY_RUN" ]]; then
    DRY_RUN_PYTHON="True"
else
    DRY_RUN_PYTHON="False"
fi

cat > "$TEMP_SCRIPT" <<PYTHON_EOF
#!/usr/bin/env python3
import sys
from pathlib import Path

# Add project root to path for standalone execution
# Go up from temp script -> project root -> src
project_root = Path("$PROJECT_ROOT").resolve()
sys.path.insert(0, str(project_root / "src"))

# Import the function
from tautulli_curated.helpers.sonarr_monitor_confirm import run_sonarr_monitor_confirm
from tautulli_curated.helpers.config_loader import load_config

try:
    config = load_config()
    dry_run = $DRY_RUN_PYTHON
    
    total_series, episodes_checked, episodes_in_plex, episodes_unmonitored, series_with_missing = run_sonarr_monitor_confirm(
        config=config,
        dry_run=dry_run
    )
    
    print("")
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total monitored series: {total_series}")
    print(f"Total episodes checked: {episodes_checked}")
    print(f"Episodes found in Plex: {episodes_in_plex}")
    if dry_run:
        print(f"Would unmonitor: {episodes_unmonitored}")
    else:
        print(f"Episodes unmonitored: {episodes_unmonitored}")
    print(f"Series with missing episodes (kept monitored): {series_with_missing}")
    print("=" * 60)
    
    sys.exit(0)
except KeyboardInterrupt:
    print("\nScript interrupted by user", file=sys.stderr)
    sys.exit(130)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
PYTHON_EOF

# Print header
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Sonarr Monitor Confirm${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Working directory: ${GREEN}$PROJECT_ROOT${NC}"
echo -e "Python: ${GREEN}$(python3 --version)${NC}"
if [[ -n "$DRY_RUN" ]]; then
    echo -e "Mode: ${YELLOW}DRY RUN${NC}"
fi
echo ""

# Run the Python script
echo -e "${BLUE}Starting Sonarr monitor confirmation...${NC}"
echo ""

EXIT_CODE=0
$PYTHON_CMD "$TEMP_SCRIPT"
EXIT_CODE=$?

# Clean up temp script
rm -f "$TEMP_SCRIPT"

echo ""

if [[ $EXIT_CODE -eq 0 ]]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Script completed successfully!${NC}"
    echo -e "${GREEN}========================================${NC}"
else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}Script failed with exit code: $EXIT_CODE${NC}"
    echo -e "${RED}========================================${NC}"
fi

# Pause at the end unless --no-pause is specified
if [[ -z "$NO_PAUSE" ]]; then
    echo ""
    echo -e "${YELLOW}Press Enter to close this window...${NC}"
    read -r
fi

exit $EXIT_CODE

