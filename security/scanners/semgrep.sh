#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
OUT_FILE="$REPORT_DIR/semgrep.json"
STATUS_FILE="$REPORT_DIR/semgrep-status.txt"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP docker_not_found" >"$STATUS_FILE"
  echo '{"tool":"semgrep","status":"SKIP","reason":"docker_not_found"}' >"$OUT_FILE"
  echo "[SKIP] semgrep: docker not found"
  exit 0
fi

set +e
docker run --rm \
  -v "$ROOT_DIR:/src" \
  -v "$REPORT_DIR:/reports" \
  returntocorp/semgrep:latest \
  semgrep scan --config auto --error --json --output /reports/semgrep.json /src
code=$?
set -e

if [[ $code -eq 0 ]]; then
  echo "PASS exit_code=0" >"$STATUS_FILE"
  echo "[PASS] semgrep"
  exit 0
fi

if [[ "$MODE" == "strict" ]]; then
  echo "FAIL exit_code=$code" >"$STATUS_FILE"
  echo "[FAIL] semgrep: exit_code=$code"
  exit "$code"
fi

echo "WARN exit_code=$code" >"$STATUS_FILE"
echo "[WARN] semgrep: findings/errors recorded (mode=$MODE, exit_code=$code)"
exit 0
