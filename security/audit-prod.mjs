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
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FAIL_SEVERITIES = new Set(['high', 'critical']);

export const ALLOWLIST = [];

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

// Sorts an `npm audit --json` payload into what blocks the build, which
// allowlist entries earned their keep, and which no longer do. Kept free of
// I/O so the severity rules can be exercised against a fixture.
export const evaluateAudit = (audit, options = {}) => {
  const {
    allowlist = ALLOWLIST,
    today = new Date().toISOString().slice(0, 10),
  } = options;

  const vulnerabilities = Object.values(audit.vulnerabilities ?? {});
  const allowedIds = new Map(allowlist.map((entry) => [entry.id, entry]));
  const seenIds = new Set();
  const blocking = [];

  for (const vuln of vulnerabilities) {
    // `vuln.severity` is npm's rollup for the whole package — the max across
    // everything it reports — so it only works as a cheap pre-filter. It can
    // never hide a high advisory, but a package that has one drags its lower
    // advisories in behind it, which is why each one is re-checked below.
    if (!FAIL_SEVERITIES.has(vuln.severity)) continue;
    const advisories = advisoriesFor(vuln);
    // A package with no direct advisory is only listed because something it
    // depends on is — the dependency itself reports the advisory, so judging it
    // here would double-count.
    if (advisories.length === 0) continue;

    for (const advisory of advisories) {
      // Judge the advisory on its own severity, falling back to the package
      // rollup only when the record does not carry one.
      const severity = advisory.severity ?? vuln.severity;
      if (!FAIL_SEVERITIES.has(severity)) continue;

      const id = idFromUrl(advisory.url);
      // The id is marked seen after the severity check, not before: an entry
      // that only ever covers a sub-threshold advisory is holding nothing back,
      // so it should surface as stale rather than look load-bearing.
      if (id && allowedIds.has(id)) {
        seenIds.add(id);
        continue;
      }
      blocking.push({
        id: id ?? String(advisory.source ?? 'unknown'),
        package: advisory.name ?? vuln.name,
        severity,
        title: advisory.title ?? '(no title)',
        url: advisory.url ?? '',
      });
    }
  }

  return {
    blocking,
    allowed: [...seenIds].map((id) => allowedIds.get(id)),
    stale: allowlist.filter((entry) => !seenIds.has(entry.id)),
    expired: allowlist.filter((entry) => entry.reviewBy < today),
  };
};

const main = () => {
  const { blocking, allowed, stale, expired } = evaluateAudit(runAudit());

  for (const entry of stale) {
    console.log(
      `note: allowlisted ${entry.id} (${entry.package}) no longer blocks the audit — it is fixed, gone, or below high — remove it from security/audit-prod.mjs`,
    );
  }
  for (const entry of allowed) {
    console.log(`allowed: ${entry.id} (${entry.package}) — review by ${entry.reviewBy}`);
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
};

// Only gate the build when run as the entry point; importing this module (the
// contract test does) must not shell out to npm.
const entryPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entryPath === realpathSync(fileURLToPath(import.meta.url))) main();
