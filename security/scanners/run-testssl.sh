#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
TARGET="${SECURITY_TLS_TARGET:-localhost:443}"
OUT_FILE="$REPORT_DIR/testssl.json"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo '{"tool":"testssl","status":"skipped","reason":"docker_not_found"}' >"$OUT_FILE"
  [[ "$MODE" == "strict" ]] && exit 2 || exit 0
fi

set +e
docker run --rm --network host \
  -v "$REPORT_DIR:/reports" \
  drwetter/testssl.sh \
  --quiet --warnings batch --jsonfile-pretty /reports/testssl.json "$TARGET"
code=$?
set -e

if [[ $code -ne 0 && "$MODE" != "strict" ]]; then
  if [[ ! -f "$OUT_FILE" ]]; then
    echo "{\"tool\":\"testssl\",\"status\":\"warning\",\"exitCode\":$code}" >"$OUT_FILE"
  fi
  exit 0
fi

exit "$code"
