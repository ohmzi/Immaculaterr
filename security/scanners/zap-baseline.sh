#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
BASE_URL="${SECURITY_BASE_URL:-http://localhost:5454}"
TARGET_URL="${SECURITY_SCAN_TARGET_URL:-$BASE_URL/api}"
STATUS_FILE="$REPORT_DIR/zap-status.txt"
OUT_JSON="$REPORT_DIR/zap.json"
OUT_MD="$REPORT_DIR/zap.md"
OUT_HTML="$REPORT_DIR/zap.html"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP docker_not_found" >"$STATUS_FILE"
  echo '{"tool":"zap","status":"SKIP","reason":"docker_not_found"}' >"$OUT_JSON"
  echo "[SKIP] zap-baseline: docker not found"
  exit 0
fi

set +e
docker run --rm --network host \
  -v "$REPORT_DIR:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t "$TARGET_URL" -J "$(basename "$OUT_JSON")" -r "$(basename "$OUT_HTML")" -w "$(basename "$OUT_MD")"
code=$?
set -e

if [[ $code -eq 0 ]]; then
  echo "PASS exit_code=0 target=$TARGET_URL" >"$STATUS_FILE"
  echo "[PASS] zap-baseline: target=$TARGET_URL"
  exit 0
fi

if [[ "$MODE" == "strict" ]]; then
  echo "FAIL exit_code=$code target=$TARGET_URL" >"$STATUS_FILE"
  echo "[FAIL] zap-baseline: exit_code=$code target=$TARGET_URL"
  exit "$code"
fi

echo "WARN exit_code=$code target=$TARGET_URL" >"$STATUS_FILE"
echo "[WARN] zap-baseline: findings/errors recorded (mode=$MODE, exit_code=$code)"
exit 0
