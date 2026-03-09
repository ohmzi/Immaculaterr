#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
OUT_FILE="$REPORT_DIR/dependency-audit.json"
STATUS_FILE="$REPORT_DIR/dependency-audit-status.txt"

mkdir -p "$REPORT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "SKIP npm_not_found" >"$STATUS_FILE"
  echo '{"tool":"dependency-audit","status":"SKIP","reason":"npm_not_found"}' >"$OUT_FILE"
  echo "[SKIP] dependency-audit: npm not found"
  exit 0
fi

set +e
npm audit --omit=dev --json >"$OUT_FILE"
code=$?
set -e

if [[ $code -eq 0 ]]; then
  echo "PASS exit_code=0" >"$STATUS_FILE"
  echo "[PASS] dependency-audit"
  exit 0
fi

if [[ "$MODE" == "strict" ]]; then
  echo "FAIL exit_code=$code" >"$STATUS_FILE"
  echo "[FAIL] dependency-audit: vulnerabilities found (exit_code=$code)"
  exit "$code"
fi

echo "WARN exit_code=$code" >"$STATUS_FILE"
echo "[WARN] dependency-audit: vulnerabilities found (mode=$MODE, exit_code=$code)"
exit 0
