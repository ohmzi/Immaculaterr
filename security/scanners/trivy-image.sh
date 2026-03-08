#!/usr/bin/env bash
set -euo pipefail

MODE="${SECURITY_MODE:-hybrid}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
IMAGE_REF="${SECURITY_IMAGE_REF:-}"
OUT_FILE="$REPORT_DIR/trivy-image.json"
STATUS_FILE="$REPORT_DIR/trivy-image-status.txt"

mkdir -p "$REPORT_DIR"

if [[ -z "$IMAGE_REF" ]]; then
  echo "SKIP missing_security_image_ref" >"$STATUS_FILE"
  echo '{"tool":"trivy-image","status":"SKIP","reason":"missing_SECURITY_IMAGE_REF"}' >"$OUT_FILE"
  echo "[SKIP] trivy-image: SECURITY_IMAGE_REF not set"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP docker_not_found" >"$STATUS_FILE"
  echo '{"tool":"trivy-image","status":"SKIP","reason":"docker_not_found"}' >"$OUT_FILE"
  echo "[SKIP] trivy-image: docker not found"
  exit 0
fi

set +e
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$REPORT_DIR:/reports" \
  aquasec/trivy:latest \
  image --severity HIGH,CRITICAL --format json --output "/reports/$(basename "$OUT_FILE")" "$IMAGE_REF"
code=$?
set -e

if [[ $code -eq 0 ]]; then
  echo "PASS exit_code=0 image=$IMAGE_REF" >"$STATUS_FILE"
  echo "[PASS] trivy-image: image=$IMAGE_REF"
  exit 0
fi

if [[ "$MODE" == "strict" ]]; then
  echo "FAIL exit_code=$code image=$IMAGE_REF" >"$STATUS_FILE"
  echo "[FAIL] trivy-image: exit_code=$code image=$IMAGE_REF"
  exit "$code"
fi

echo "WARN exit_code=$code image=$IMAGE_REF" >"$STATUS_FILE"
echo "[WARN] trivy-image: findings/errors recorded (mode=$MODE, exit_code=$code)"
exit 0
