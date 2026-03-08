#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function parseArgs(argv) {
  const args = { results: 'security/reports/pipeline-results.tsv', out: 'security/reports/security-scorecard.md' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--results' && argv[i + 1]) {
      args.results = argv[i + 1];
      i += 1;
    } else if (arg === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function parseTsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];
  return lines.slice(1).map((line) => {
    const [check = '', checkClass = '', status = '', details = ''] = line.split('\t');
    return { check, checkClass, status, details };
  });
}

function toMarkdown(rows) {
  const pass = rows.filter((row) => row.status === 'PASS').length;
  const warn = rows.filter((row) => row.status === 'WARN').length;
  const fail = rows.filter((row) => row.status === 'FAIL').length;
  const overall = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS';

  const tableRows = rows
    .map((row) => {
      const details = row.details.replaceAll('|', '\\|');
      return `| ${row.check} | ${row.checkClass} | ${row.status} | ${details} |`;
    })
    .join('\n');

  return [
    '# Security Scorecard',
    '',
    `Overall: **${overall}**`,
    '',
    `- PASS: ${pass}`,
    `- WARN: ${warn}`,
    `- FAIL: ${fail}`,
    '',
    '| Check | Class | Status | Details |',
    '| --- | --- | --- | --- |',
    tableRows || '| (none) | - | - | - |',
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resultsPath = resolve(args.results);
  const outPath = resolve(args.out);
  const content = await readFile(resultsPath, 'utf8');
  const rows = parseTsv(content);
  const markdown = toMarkdown(rows);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, 'utf8');
  process.stdout.write(`Wrote security scorecard: ${outPath}\n`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
