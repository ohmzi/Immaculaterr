#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE_RAW="${SECURITY_MODE:-hybrid}"
BASE_URL="${SECURITY_BASE_URL:-http://localhost:5454}"
REPORT_DIR="${SECURITY_REPORT_DIR:-$ROOT_DIR/security/reports}"
RESULTS_FILE="$REPORT_DIR/summary-results.tsv"
SUMMARY_MD="$REPORT_DIR/summary.md"
SUMMARY_JSON="$REPORT_DIR/summary.json"

case "${MODE_RAW,,}" in
  report|report-only)
    MODE="report"
    ;;
  strict)
    MODE="strict"
    ;;
  *)
    MODE="hybrid"
    ;;
esac

mkdir -p "$REPORT_DIR"
printf "section\tcheck\tclass\tstatus\tdetails\tcommand\n" >"$RESULTS_FILE"

FAILED=0

sanitize_field() {
  local value="$1"
  value="${value//$'\t'/ }"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

record_result() {
  local section="$1"
  local check="$2"
  local check_class="$3"
  local status="$4"
  local details="$5"
  local command="$6"

  printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
    "$(sanitize_field "$section")" \
    "$(sanitize_field "$check")" \
    "$(sanitize_field "$check_class")" \
    "$(sanitize_field "$status")" \
    "$(sanitize_field "$details")" \
    "$(sanitize_field "$command")" \
    >>"$RESULTS_FILE"
}

status_from_exit_code() {
  local check_class="$1"
  local exit_code="$2"

  if [[ "$exit_code" -eq 0 ]]; then
    printf 'PASS'
    return
  fi

  if [[ "$check_class" == "blocking" ]]; then
    if [[ "$MODE" == "report" ]]; then
      printf 'WARN'
    else
      printf 'FAIL'
    fi
    return
  fi

  if [[ "$MODE" == "strict" ]]; then
    printf 'FAIL'
  else
    printf 'WARN'
  fi
}

read_status_file_token() {
  local status_file="$1"
  if [[ -z "$status_file" || ! -f "$status_file" ]]; then
    printf ''
    return
  fi

  local token
  token="$(awk 'NR==1{print toupper($1)}' "$status_file" 2>/dev/null || true)"
  case "$token" in
    PASS|WARN|FAIL|SKIP)
      printf '%s' "$token"
      ;;
    *)
      printf ''
      ;;
  esac
}

read_status_file_line() {
  local status_file="$1"
  if [[ -z "$status_file" || ! -f "$status_file" ]]; then
    printf ''
    return
  fi
  head -n 1 "$status_file" 2>/dev/null || true
}

run_check() {
  local section="$1"
  local check="$2"
  local check_class="$3"
  local command="$4"
  local status_file="${5:-}"

  echo "==> $section :: $check"

  set +e
  bash -lc "$command"
  local exit_code=$?
  set -e

  local status
  status="$(read_status_file_token "$status_file")"
  local details
  details="$(read_status_file_line "$status_file")"

  if [[ -z "$status" ]]; then
    status="$(status_from_exit_code "$check_class" "$exit_code")"
  fi
  if [[ -z "$details" ]]; then
    details="exit_code=$exit_code"
  fi

  record_result "$section" "$check" "$check_class" "$status" "$details" "$command"
  echo "[$status] $section :: $check :: $details"

  if [[ "$status" == "FAIL" ]]; then
    FAILED=1
  fi
}

run_cypress_spec() {
  local section="$1"
  local check="$2"
  local check_class="$3"
  local spec_path="$4"

  if [[ ! -f "$ROOT_DIR/$spec_path" ]]; then
    record_result "$section" "$check" "$check_class" "SKIP" "spec_missing" "$spec_path"
    echo "[SKIP] $section :: $check :: spec_missing"
    return
  fi

  local cmd
  cmd="SECURITY_BASE_URL=$BASE_URL SECURITY_MODE=$MODE SECURITY_REPORT_DIR=$REPORT_DIR npx cypress run --spec $spec_path --config-file cypress.config.ts"
  run_check "$section" "$check" "$check_class" "$cmd"
}

run_wrapper() {
  local section="$1"
  local check="$2"
  local check_class="$3"
  local script_path="$4"
  local status_file="$5"

  if [[ ! -f "$script_path" ]]; then
    record_result "$section" "$check" "$check_class" "SKIP" "wrapper_missing" "$script_path"
    echo "[SKIP] $section :: $check :: wrapper_missing"
    return
  fi

  local cmd
  cmd="SECURITY_MODE=$MODE SECURITY_BASE_URL=$BASE_URL SECURITY_REPORT_DIR=$REPORT_DIR bash $script_path"
  run_check "$section" "$check" "$check_class" "$cmd" "$status_file"
}

# Targeted Cypress security suite
run_cypress_spec "Authentication" "auth-cypress" "blocking" "cypress/e2e/security/authentication.cy.ts"
run_cypress_spec "Authorization" "authorization-cypress" "blocking" "cypress/e2e/security/authorization.cy.ts"
run_cypress_spec "Input validation" "input-validation-cypress" "blocking" "cypress/e2e/security/input-validation.cy.ts"
run_cypress_spec "Session / CSRF" "session-csrf-cypress" "blocking" "cypress/e2e/security/session-csrf.cy.ts"
run_cypress_spec "Headers" "security-headers-cypress" "report" "cypress/e2e/security/security-headers.cy.ts"
run_cypress_spec "Advanced surfaces" "ssrf-cypress" "report" "cypress/e2e/security/ssrf.cy.ts"
run_cypress_spec "Advanced surfaces" "file-upload-cypress" "report" "cypress/e2e/security/file-upload.cy.ts"

# External scanners
run_wrapper "Secrets" "trufflehog" "report" "$ROOT_DIR/security/scanners/trufflehog.sh" "$REPORT_DIR/trufflehog-status.txt"
run_wrapper "Dependency audit" "dependency-audit" "report" "$ROOT_DIR/security/scanners/dependency-audit.sh" "$REPORT_DIR/dependency-audit-status.txt"
run_wrapper "Semgrep" "semgrep" "report" "$ROOT_DIR/security/scanners/semgrep.sh" "$REPORT_DIR/semgrep-status.txt"
run_wrapper "ZAP" "zap-baseline" "report" "$ROOT_DIR/security/scanners/zap-baseline.sh" "$REPORT_DIR/zap-status.txt"
run_wrapper "Trivy" "trivy-image" "report" "$ROOT_DIR/security/scanners/trivy-image.sh" "$REPORT_DIR/trivy-image-status.txt"
run_wrapper "Nmap" "nmap" "report" "$ROOT_DIR/security/scanners/nmap.sh" "$REPORT_DIR/nmap-status.txt"
run_wrapper "TLS" "testssl" "report" "$ROOT_DIR/security/scanners/testssl.sh" "$REPORT_DIR/testssl-status.txt"

node - <<'NODE' "$RESULTS_FILE" "$SUMMARY_MD" "$SUMMARY_JSON" "$MODE" "$BASE_URL" "$REPORT_DIR"
const fs = require('node:fs');
const path = require('node:path');

const [resultsFile, summaryMd, summaryJson, mode, baseUrl, reportDir] = process.argv.slice(2);
const tsv = fs.readFileSync(resultsFile, 'utf8').trim();
const lines = tsv ? tsv.split(/\r?\n/) : [];
const rows = lines.slice(1).map((line) => {
  const [section = '', check = '', checkClass = '', status = '', details = '', command = ''] = line.split('\t');
  return { section, check, checkClass, status, details, command };
});

const totals = rows.reduce(
  (acc, row) => {
    const key = row.status.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(acc, key)) acc[key] += 1;
    return acc;
  },
  { pass: 0, warn: 0, fail: 0, skip: 0 },
);

let overall = 'PASS';
if (totals.fail > 0) overall = 'FAIL';
else if (totals.warn > 0) overall = 'WARN';
else if (totals.pass === 0 && totals.skip > 0) overall = 'SKIP';

const sections = [];
const sectionMap = new Map();
for (const row of rows) {
  if (!sectionMap.has(row.section)) {
    const entry = { name: row.section, checks: [] };
    sectionMap.set(row.section, entry);
    sections.push(entry);
  }
  sectionMap.get(row.section).checks.push(row);
}

const summary = {
  generatedAt: new Date().toISOString(),
  mode,
  baseUrl,
  reportDir,
  totals: { ...totals, overall },
  checks: rows,
};

const md = [];
md.push('# Security Summary');
md.push('');
md.push(`- overall: **${overall}**`);
md.push(`- mode: ${mode}`);
md.push(`- baseUrl: ${baseUrl}`);
md.push('');
md.push(`- PASS: ${totals.pass}`);
md.push(`- WARN: ${totals.warn}`);
md.push(`- FAIL: ${totals.fail}`);
md.push(`- SKIP: ${totals.skip}`);
md.push('');

for (const section of sections) {
  md.push(`## ${section.name}`);
  md.push('');
  md.push('| Check | Class | Status | Details |');
  md.push('| --- | --- | --- | --- |');
  for (const row of section.checks) {
    const safeDetails = String(row.details || '').replace(/\|/g, '\\|');
    md.push(`| ${row.check} | ${row.checkClass} | ${row.status} | ${safeDetails} |`);
  }
  md.push('');
}

fs.mkdirSync(path.dirname(summaryMd), { recursive: true });
fs.writeFileSync(summaryMd, `${md.join('\n')}\n`, 'utf8');
fs.writeFileSync(summaryJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
NODE

echo "Security summary written:" \
  "$SUMMARY_MD" \
  "$SUMMARY_JSON"

if [[ "$FAILED" -ne 0 ]]; then
  echo "Security pipeline finished with FAIL status (mode=$MODE)."
  exit 1
fi

echo "Security pipeline finished without blocking failures (mode=$MODE)."
exit 0
