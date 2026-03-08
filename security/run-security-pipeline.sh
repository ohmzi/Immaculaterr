#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${SECURITY_MODE:-hybrid}"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
RESULTS_FILE="$REPORT_DIR/pipeline-results.tsv"
SCORECARD_FILE="$REPORT_DIR/security-scorecard.md"

mkdir -p "$REPORT_DIR"
printf "check\tclass\tstatus\tdetails\n" >"$RESULTS_FILE"

run_check() {
  local name="$1"
  local check_class="$2"
  shift 2

  echo "==> $name"
  set +e
  "$@"
  local code=$?
  set -e

  local status="PASS"
  local details="ok"
  if [[ $code -ne 0 ]]; then
    details="exit_code=$code"
    if [[ "$check_class" == "blocking" ]]; then
      if [[ "$MODE" == "report-only" ]]; then
        status="WARN"
      else
        status="FAIL"
      fi
    else
      if [[ "$MODE" == "strict" ]]; then
        status="FAIL"
      else
        status="WARN"
      fi
    fi
  fi

  printf "%s\t%s\t%s\t%s\n" "$name" "$check_class" "$status" "$details" >>"$RESULTS_FILE"
  [[ "$status" == "FAIL" ]] && return 1 || return 0
}

FAILED=0

run_check "ajv-check" "blocking" npm run security:check:ajv || FAILED=1
run_check "security-tests" "blocking" npm -w apps/api run test -- --runInBand src/tests/security || FAILED=1
run_check "dependency-audit" "report" npm run security:audit:prod || FAILED=1
run_check "semgrep" "report" bash "$ROOT_DIR/security/scanners/run-semgrep.sh" || FAILED=1
run_check "trivy" "report" bash "$ROOT_DIR/security/scanners/run-trivy.sh" || FAILED=1
run_check "trufflehog" "report" bash "$ROOT_DIR/security/scanners/run-trufflehog.sh" || FAILED=1
run_check "zap" "report" bash "$ROOT_DIR/security/scanners/run-zap.sh" || FAILED=1
run_check "nmap" "report" bash "$ROOT_DIR/security/scanners/run-nmap.sh" || FAILED=1
run_check "testssl" "report" bash "$ROOT_DIR/security/scanners/run-testssl.sh" || FAILED=1
run_check "openapi-fuzz" "report" bash "$ROOT_DIR/security/scanners/run-openapi-fuzz.sh" || FAILED=1

node "$ROOT_DIR/security/scorecard.mjs" --results "$RESULTS_FILE" --out "$SCORECARD_FILE"

if [[ $FAILED -ne 0 ]]; then
  echo "Security pipeline finished with blocking failures."
  echo "See reports in: $REPORT_DIR"
  exit 1
fi

echo "Security pipeline finished successfully."
echo "Scorecard: $SCORECARD_FILE"
