#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
TARGET_URL="${SECURITY_SCAN_TARGET_URL:-http://host.docker.internal:5859/api}"
OUT_FILE="$REPORT_DIR/zap.json"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo '{"tool":"zap","status":"skipped","reason":"docker_not_found"}' >"$OUT_FILE"
  [[ "$MODE" == "strict" ]] && exit 2 || exit 0
fi

set +e
docker run --rm --network host \
  -v "$REPORT_DIR:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t "$TARGET_URL" -J zap.json -r zap.html -w zap.md
code=$?
set -e

if [[ $code -ne 0 && "$MODE" != "strict" ]]; then
  if [[ ! -f "$OUT_FILE" ]]; then
    echo "{\"tool\":\"zap\",\"status\":\"warning\",\"exitCode\":$code}" >"$OUT_FILE"
  fi
  exit 0
fi

exit "$code"
