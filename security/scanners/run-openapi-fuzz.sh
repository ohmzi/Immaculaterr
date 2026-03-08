#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
OPENAPI_URL="${SECURITY_OPENAPI_URL:-http://host.docker.internal:5859/api/docs-json}"
OUT_FILE="$REPORT_DIR/openapi-fuzz.txt"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo 'openapi-fuzz skipped: docker_not_found' >"$OUT_FILE"
  [[ "$MODE" == "strict" ]] && exit 2 || exit 0
fi

set +e
docker run --rm --network host schemathesis/schemathesis:stable run "$OPENAPI_URL" >"$OUT_FILE"
code=$?
set -e

if [[ $code -ne 0 && "$MODE" != "strict" ]]; then
  exit 0
fi

exit "$code"
