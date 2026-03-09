#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
IMAGE_REF="${SECURITY_IMAGE_REF:-}"
TRIVY_FS_PATH="${SECURITY_TRIVY_FS_PATH:-/repo}"
OUT_FILE="$REPORT_DIR/trivy-image.json"
STATUS_FILE="$REPORT_DIR/trivy-image-status.txt"

mkdir -p "$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP docker_not_found" >"$STATUS_FILE"
  echo '{"tool":"trivy-image","status":"SKIP","reason":"docker_not_found"}' >"$OUT_FILE"
  echo "[SKIP] trivy-image: docker not found"
  exit 0
fi

set +e
if [[ -n "$IMAGE_REF" ]]; then
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$REPORT_DIR:/reports" \
    aquasec/trivy:latest \
    image --severity HIGH,CRITICAL --format json --output "/reports/$(basename "$OUT_FILE")" "$IMAGE_REF"
  code=$?
  scan_target="$IMAGE_REF"
  scan_mode="image"
else
  docker run --rm \
    -v "$ROOT_DIR:/repo:ro" \
    -v "$REPORT_DIR:/reports" \
    aquasec/trivy:latest \
    fs --severity HIGH,CRITICAL --format json --output "/reports/$(basename "$OUT_FILE")" "$TRIVY_FS_PATH"
  code=$?
  scan_target="$TRIVY_FS_PATH"
  scan_mode="filesystem"
fi
set -e

if [[ $code -eq 0 ]]; then
  echo "PASS exit_code=0 mode=$scan_mode target=$scan_target" >"$STATUS_FILE"
  echo "[PASS] trivy-image: mode=$scan_mode target=$scan_target"
  exit 0
fi

if [[ "$MODE" == "strict" ]]; then
  echo "FAIL exit_code=$code mode=$scan_mode target=$scan_target" >"$STATUS_FILE"
  echo "[FAIL] trivy-image: exit_code=$code mode=$scan_mode target=$scan_target"
  exit "$code"
fi

echo "WARN exit_code=$code mode=$scan_mode target=$scan_target" >"$STATUS_FILE"
echo "[WARN] trivy-image: findings/errors recorded (mode=$MODE, exit_code=$code, mode=$scan_mode)"
exit 0
