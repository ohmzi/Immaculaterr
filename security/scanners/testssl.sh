#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
BASE_URL="${SECURITY_BASE_URL:-http://localhost:5454}"
OUT_FILE="$REPORT_DIR/testssl.json"
STATUS_FILE="$REPORT_DIR/testssl-status.txt"

mkdir -p "$REPORT_DIR"

extract_authority() {
  printf '%s' "$1" | sed -E 's#^https?://([^/]+).*$#\1#'
}

extract_host() {
  printf '%s' "$1" | sed -E 's#^https?://([^/:]+).*$#\1#'
}

is_tls_port_open() {
  local host="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 2 "$host" 443 >/dev/null 2>&1
    return $?
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout 2 bash -c 'exec 3<>/dev/tcp/"$1"/443' _ "$host" >/dev/null 2>&1
    return $?
  fi

  return 1
}

TARGET="${SECURITY_TLS_TARGET:-}"
if [[ -z "$TARGET" ]]; then
  if [[ "$BASE_URL" =~ ^https:// ]]; then
    TARGET="$(extract_authority "$BASE_URL")"
  else
    BASE_HOST="$(extract_host "$BASE_URL")"
    if [[ -n "$BASE_HOST" ]] && is_tls_port_open "$BASE_HOST"; then
      TARGET="$BASE_HOST:443"
    fi
  fi
fi

if [[ -z "$TARGET" ]]; then
  echo "SKIP tls_target_not_detected_set_security_tls_target" >"$STATUS_FILE"
  echo '{"tool":"testssl","status":"SKIP","reason":"TLS target not detected; set SECURITY_TLS_TARGET"}' >"$OUT_FILE"
  echo "[SKIP] testssl: TLS target not detected (set SECURITY_TLS_TARGET)"
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
