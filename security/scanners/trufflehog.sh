#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
OUT_FILE="$REPORT_DIR/trufflehog.jsonl"
STATUS_FILE="$REPORT_DIR/trufflehog-status.txt"
TIMEOUT_SECONDS="${SECURITY_TRUFFLEHOG_TIMEOUT_SECONDS:-180}"
LOG_FILE="$REPORT_DIR/trufflehog.log"
EXCLUDE_PATHS_FILE="$REPORT_DIR/trufflehog-exclude-paths.txt"
SCAN_TARGET="${SECURITY_TRUFFLEHOG_TARGET_PATH:-/repo}"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP docker_not_found" >"$STATUS_FILE"
  echo '{"tool":"trufflehog","status":"SKIP","reason":"docker_not_found"}' >"$OUT_FILE"
  echo "[SKIP] trufflehog: docker not found"
  exit 0
fi

cat >"$EXCLUDE_PATHS_FILE" <<'EOF'
^/repo/\.git/
^/repo/node_modules/
^/repo/node_modules_old/
^/repo/apps/api/node_modules/
^/repo/apps/api/node_modules_old/
^/repo/apps/web/node_modules/
^/repo/security/reports/
^/repo/extra/
^/repo/\.cache/
^/repo/\.pnpm-store/
EOF

set +e
if command -v timeout >/dev/null 2>&1; then
  timeout "$TIMEOUT_SECONDS" docker run --rm \
    -v "$ROOT_DIR:/repo:ro" \
    -v "$REPORT_DIR:/reports:rw" \
    trufflesecurity/trufflehog:latest \
    filesystem "$SCAN_TARGET" \
    --json \
    --exclude-paths "/reports/$(basename "$EXCLUDE_PATHS_FILE")" \
    --force-skip-binaries \
    --force-skip-archives >"$OUT_FILE" 2>"$LOG_FILE"
  code=$?
else
  docker run --rm \
    -v "$ROOT_DIR:/repo:ro" \
    -v "$REPORT_DIR:/reports:rw" \
    trufflesecurity/trufflehog:latest \
    filesystem "$SCAN_TARGET" \
    --json \
    --exclude-paths "/reports/$(basename "$EXCLUDE_PATHS_FILE")" \
    --force-skip-binaries \
    --force-skip-archives >"$OUT_FILE" 2>"$LOG_FILE"
  code=$?
fi
set -e

if [[ $code -eq 124 ]]; then
  if [[ "$MODE" == "strict" ]]; then
    echo "FAIL timeout=${TIMEOUT_SECONDS}s" >"$STATUS_FILE"
    echo "[FAIL] trufflehog: timed out after ${TIMEOUT_SECONDS}s"
    exit 124
  fi
  echo "WARN timeout=${TIMEOUT_SECONDS}s" >"$STATUS_FILE"
  echo "[WARN] trufflehog: timed out after ${TIMEOUT_SECONDS}s (mode=$MODE)"
  exit 0
fi

if [[ $code -eq 0 ]]; then
  echo "PASS exit_code=0" >"$STATUS_FILE"
  echo "[PASS] trufflehog"
  exit 0
fi

if [[ "$MODE" == "strict" ]]; then
  echo "FAIL exit_code=$code" >"$STATUS_FILE"
  echo "[FAIL] trufflehog: exit_code=$code"
  exit "$code"
fi

echo "WARN exit_code=$code" >"$STATUS_FILE"
echo "[WARN] trufflehog: findings/errors recorded (mode=$MODE, exit_code=$code)"
exit 0
