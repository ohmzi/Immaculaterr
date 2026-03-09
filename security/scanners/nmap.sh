#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
BASE_URL="${SECURITY_BASE_URL:-http://localhost:5454}"
DEFAULT_TARGET="$(printf '%s' "$BASE_URL" | sed -E 's#^[a-zA-Z]+://([^/:]+).*#\1#')"
TARGET_HOST="${SECURITY_SCAN_TARGET_HOST:-$DEFAULT_TARGET}"
OUT_FILE="$REPORT_DIR/nmap.xml"
STATUS_FILE="$REPORT_DIR/nmap-status.txt"

mkdir -p "$REPORT_DIR"

if [[ -z "$TARGET_HOST" ]]; then
  echo "SKIP missing_target_host" >"$STATUS_FILE"
  echo '<nmaprun><runstats><finished exit="missing_target_host"/></runstats></nmaprun>' >"$OUT_FILE"
  echo "[SKIP] nmap: target host unresolved"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP docker_not_found" >"$STATUS_FILE"
  echo '<nmaprun><runstats><finished exit="docker_not_found"/></runstats></nmaprun>' >"$OUT_FILE"
  echo "[SKIP] nmap: docker not found"
  exit 0
fi

set +e
docker run --rm --network host instrumentisto/nmap:latest -sV -Pn "$TARGET_HOST" -oX - >"$OUT_FILE"
code=$?
set -e

if [[ $code -eq 0 ]]; then
  echo "PASS exit_code=0 target=$TARGET_HOST" >"$STATUS_FILE"
  echo "[PASS] nmap: target=$TARGET_HOST"
  exit 0
fi

if [[ "$MODE" == "strict" ]]; then
  echo "FAIL exit_code=$code target=$TARGET_HOST" >"$STATUS_FILE"
  echo "[FAIL] nmap: exit_code=$code target=$TARGET_HOST"
  exit "$code"
fi

echo "WARN exit_code=$code target=$TARGET_HOST" >"$STATUS_FILE"
echo "[WARN] nmap: findings/errors recorded (mode=$MODE, exit_code=$code)"
exit 0
