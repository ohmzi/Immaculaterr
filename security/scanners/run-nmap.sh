#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
TARGET="${SECURITY_SCAN_TARGET_HOST:-127.0.0.1}"
REPORT_DIR_DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/security/reports"
REPORT_DIR="${SECURITY_REPORT_DIR:-$REPORT_DIR_DEFAULT}"
OUT_FILE="$REPORT_DIR/nmap.xml"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo '<nmaprun><runstats><finished exit="docker_not_found"/></runstats></nmaprun>' >"$OUT_FILE"
  [[ "$MODE" == "strict" ]] && exit 2 || exit 0
fi

set +e
docker run --rm --network host instrumentisto/nmap:latest -sV -Pn "$TARGET" -oX - >"$OUT_FILE"
code=$?
set -e

if [[ $code -ne 0 && "$MODE" != "strict" ]]; then
  exit 0
fi

exit "$code"
