#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
BASE_URL="${SECURITY_BASE_URL:-http://localhost:5454}"
OUT_FILE="$REPORT_DIR/testssl.json"
STATUS_FILE="$REPORT_DIR/testssl-status.txt"

mkdir -p "$REPORT_DIR"

TARGET="${SECURITY_TLS_TARGET:-}"
if [[ -z "$TARGET" ]]; then
  if [[ "$BASE_URL" =~ ^https:// ]]; then
    TARGET="$(printf '%s' "$BASE_URL" | sed -E 's#^https?://([^/]+).*$#\1#')"
  fi
fi

if [[ -z "$TARGET" ]]; then
  echo "SKIP http_target_or_missing_tls_target" >"$STATUS_FILE"
  echo '{"tool":"testssl","status":"SKIP","reason":"HTTP target or missing SECURITY_TLS_TARGET"}' >"$OUT_FILE"
  echo "[SKIP] testssl: HTTP base URL or missing SECURITY_TLS_TARGET"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP docker_not_found" >"$STATUS_FILE"
  echo '{"tool":"testssl","status":"SKIP","reason":"docker_not_found"}' >"$OUT_FILE"
  echo "[SKIP] testssl: docker not found"
  exit 0
fi

set +e
docker run --rm --network host \
  -v "$REPORT_DIR:/reports" \
  drwetter/testssl.sh \
  --quiet --warnings batch --jsonfile-pretty "/reports/$(basename "$OUT_FILE")" "$TARGET"
code=$?
set -e

if [[ $code -eq 0 ]]; then
  echo "PASS exit_code=0 target=$TARGET" >"$STATUS_FILE"
  echo "[PASS] testssl: target=$TARGET"
  exit 0
fi

if [[ "$MODE" == "strict" ]]; then
  echo "FAIL exit_code=$code target=$TARGET" >"$STATUS_FILE"
  echo "[FAIL] testssl: exit_code=$code target=$TARGET"
  exit "$code"
fi

echo "WARN exit_code=$code target=$TARGET" >"$STATUS_FILE"
echo "[WARN] testssl: findings/errors recorded (mode=$MODE, exit_code=$code)"
exit 0
