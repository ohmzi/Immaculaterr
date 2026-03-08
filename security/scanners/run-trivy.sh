#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
OUT_FILE="$REPORT_DIR/trivy.json"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo '{"tool":"trivy","status":"skipped","reason":"docker_not_found"}' >"$OUT_FILE"
  [[ "$MODE" == "strict" ]] && exit 2 || exit 0
fi

set +e
docker run --rm \
  -v "$ROOT_DIR:/workspace" \
  -v "$REPORT_DIR:/reports" \
  aquasec/trivy:latest \
  fs --scanners vuln,secret --severity HIGH,CRITICAL --format json --output /reports/trivy.json /workspace
code=$?
set -e

if [[ $code -ne 0 && "$MODE" != "strict" ]]; then
  if [[ ! -s "$OUT_FILE" ]]; then
    echo "{\"tool\":\"trivy\",\"status\":\"warning\",\"exitCode\":$code}" >"$OUT_FILE"
  fi
  exit 0
fi

exit "$code"
