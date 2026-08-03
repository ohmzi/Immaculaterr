#!/usr/bin/env node
// Production dependency audit gate.
//
// Wraps `npm audit --omit=dev --json` so a single advisory that provably does
// not reach this app cannot hold the whole gate red. Everything else still
// fails the build exactly as `npm audit --audit-level=high` did.
//
// An entry here is a decision to stop being told about a real advisory, so
// each one carries the reason it does not apply and a date by which it must be
// re-argued. Past that date the gate fails until someone re-reads it.

import { spawnSync } from 'node:child_process';

const FAIL_SEVERITIES = new Set(['high', 'critical']);

const ALLOWLIST = [
  {
    id: 'GHSA-qwww-vcr4-c8h2',
    package: 'react-router',
    reason:
      'RSC Mode CSRF bypass. Only reachable through React Router RSC server actions; ' +
      'this app is a Vite SPA that mounts BrowserRouter and ships no RSC entry point, ' +
      'so the vulnerable code path is never loaded. The advisory covers 7.12.0-8.2.0 ' +
      'and the only fixed release is 8.3.0, a major upgrade of the router. Drop this ' +
      'entry the moment a 7.x fix ships or the app moves to 8.x.',
    reviewBy: '2026-11-01',
  },
];

const runAudit = () => {
  const result = spawnSync(
    'npm',
    ['audit', '--omit=dev', '--json'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  // npm audit exits non-zero whenever it finds anything, so the exit code is
  // not an error signal here — only unparseable output is.
  if (!result.stdout) {
    console.error('npm audit produced no output');
    if (result.stderr) console.error(result.stderr);
    process.exit(2);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    console.error('could not parse npm audit output as JSON');
    console.error(result.stdout.slice(0, 2000));
    process.exit(2);
  }
};

// npm nests the advisory records under `via`, where a string means "vulnerable
// because a dependency is" and an object is the advisory itself.
const advisoriesFor = (vuln) =>
  (vuln.via ?? []).filter((entry) => entry && typeof entry === 'object');

const idFromUrl = (url) => {
  const match = /\/advisories\/(GHSA-[a-z0-9-]+)/i.exec(url ?? '');
  return match ? match[1] : null;
};

const audit = runAudit();
const vulnerabilities = Object.values(audit.vulnerabilities ?? {});
const today = new Date().toISOString().slice(0, 10);

const allowedIds = new Map(ALLOWLIST.map((entry) => [entry.id, entry]));
const seenIds = new Set();
const blocking = [];

for (const vuln of vulnerabilities) {
  if (!FAIL_SEVERITIES.has(vuln.severity)) continue;
  const advisories = advisoriesFor(vuln);
  // A package with no direct advisory is only listed because something it
  // depends on is — the dependency itself reports the advisory, so judging it
  // here would double-count.
  if (advisories.length === 0) continue;

  for (const advisory of advisories) {
    const id = idFromUrl(advisory.url);
    if (id && allowedIds.has(id)) {
      seenIds.add(id);
      continue;
    }
    blocking.push({
      id: id ?? String(advisory.source ?? 'unknown'),
      package: advisory.name ?? vuln.name,
      severity: advisory.severity ?? vuln.severity,
      title: advisory.title ?? '(no title)',
      url: advisory.url ?? '',
    });
  }
}

const expired = ALLOWLIST.filter((entry) => entry.reviewBy < today);
const stale = ALLOWLIST.filter((entry) => !seenIds.has(entry.id));

for (const entry of stale) {
  console.log(
    `note: allowlisted ${entry.id} (${entry.package}) no longer appears in the audit — remove it from security/audit-prod.mjs`,
  );
}
for (const entry of seenIds) {
  const allowed = allowedIds.get(entry);
  console.log(`allowed: ${allowed.id} (${allowed.package}) — review by ${allowed.reviewBy}`);
}

if (expired.length > 0) {
  console.error('');
  for (const entry of expired) {
    console.error(
      `allowlist entry ${entry.id} (${entry.package}) passed its review date ${entry.reviewBy} — re-argue it or remove it`,
    );
  }
  process.exit(1);
}

if (blocking.length > 0) {
  console.error('');
  console.error(`${blocking.length} unallowlisted high/critical advisory(ies) in production dependencies:`);
  for (const item of blocking) {
    console.error(`  ${item.severity} ${item.package}: ${item.title}`);
    if (item.url) console.error(`    ${item.url}`);
  }
  process.exit(1);
}

console.log('production dependency audit clean (high and critical)');
