#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
OUT_FILE="$REPORT_DIR/trufflehog.jsonl"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo '{"tool":"trufflehog","status":"skipped","reason":"docker_not_found"}' >"$OUT_FILE"
  [[ "$MODE" == "strict" ]] && exit 2 || exit 0
fi

set +e
docker run --rm \
  -v "$ROOT_DIR:/repo" \
  trufflesecurity/trufflehog:latest \
  filesystem /repo --json >"$OUT_FILE"
code=$?
set -e

if [[ $code -ne 0 && "$MODE" != "strict" ]]; then
  exit 0
fi

exit "$code"
