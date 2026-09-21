#!/usr/bin/env node

// Contract test for the production dependency audit gate.
//
// The gate reads live registry data, so its severity rules are pinned here
// against a hand-built `npm audit --json` payload instead. The shape is real;
// the records are not, apart from the one advisory this test exists for:
// GHSA-qvfw-j98x-7q72 is `low`, but it sat under a package whose rollup was
// `high`, and the gate reported it as a blocking high/critical finding.

// skipcq: JS-0833
import { evaluateAudit } from '../security/audit-prod.mjs';

const TODAY = '2026-01-15';

const highAdvisory = (n) => ({
  source: 1000 + n,
  name: 'multer',
  dependency: 'multer',
  title: `Synthetic high advisory ${n} in multer`,
  url: `https://github.com/advisories/GHSA-0000-0000-000${n}`,
  severity: 'high',
  range: '<2.0.2',
});

// A package whose rollup is `high` because of its worst advisory, carrying a
// `low` one alongside — the case the gate used to mis-report.
const multer = {
  name: 'multer',
  severity: 'high',
  isDirect: true,
  via: [
    highAdvisory(1),
    highAdvisory(2),
    highAdvisory(3),
    highAdvisory(4),
    {
      source: 1099,
      name: 'multer',
      dependency: 'multer',
      title:
        'multer vulnerable to file size limit bypass via async fileFilter race condition',
      url: 'https://github.com/advisories/GHSA-qvfw-j98x-7q72',
      severity: 'low',
      range: '<2.0.2',
    },
  ],
  fixAvailable: true,
};

const auditFixture = {
  vulnerabilities: {
    multer,
    // Rollup below the threshold: the cheap pre-filter drops the package
    // whole, and nothing under it may block.
    tar: {
      name: 'tar',
      severity: 'moderate',
      via: [
        {
          source: 2001,
          name: 'tar',
          title: 'Synthetic moderate advisory in tar',
          url: 'https://github.com/advisories/GHSA-0000-0000-0021',
          severity: 'moderate',
        },
      ],
    },
    // Vulnerable only through a dependency: the advisory belongs to `multer`,
    // which reports it itself, so counting it here would double-count.
    '@nestjs/platform-express': {
      name: '@nestjs/platform-express',
      severity: 'high',
      via: ['multer'],
    },
    // A record that omits its own severity falls back to the package rollup.
    'no-severity-pkg': {
      name: 'no-severity-pkg',
      severity: 'critical',
      via: [
        {
          source: 3001,
          name: 'no-severity-pkg',
          title: 'Synthetic advisory with no severity field',
          url: 'https://github.com/advisories/GHSA-0000-0000-0031',
        },
      ],
    },
  },
};

const failures = [];
const check = (name, condition, detail) => {
  if (!condition) failures.push(detail ? `${name} (${detail})` : name);
};

// --- no allowlist: only genuinely high/critical advisories block ------------

const bare = evaluateAudit(auditFixture, { allowlist: [], today: TODAY });
const bareIds = bare.blocking.map((item) => item.id);

check(
  'every blocking entry is high or critical',
  bare.blocking.every((item) => item.severity === 'high' || item.severity === 'critical'),
  bare.blocking.map((item) => `${item.severity} ${item.id}`).join(', '),
);
check(
  'the low advisory under a high rollup does not block',
  !bareIds.includes('GHSA-qvfw-j98x-7q72'),
);
check(
  'all four high multer advisories block',
  ['GHSA-0000-0000-0001', 'GHSA-0000-0000-0002', 'GHSA-0000-0000-0003', 'GHSA-0000-0000-0004']
    .every((id) => bareIds.includes(id)),
  bareIds.join(', '),
);
check(
  'a moderate package rollup contributes nothing',
  !bareIds.includes('GHSA-0000-0000-0021'),
);
check(
  'a package vulnerable only via a dependency contributes nothing',
  !bare.blocking.some((item) => item.package === '@nestjs/platform-express'),
);
check(
  'an advisory with no severity of its own falls back to the package rollup',
  bare.blocking.some(
    (item) => item.id === 'GHSA-0000-0000-0031' && item.severity === 'critical',
  ),
);
check(
  'the reported count matches the high/critical heading',
  bare.blocking.length === 5,
  `got ${bare.blocking.length}, expected 4 high + 1 critical`,
);

// --- allowlisting a high advisory silences exactly that one ----------------

const allowHigh = [
  {
    id: 'GHSA-0000-0000-0001',
    package: 'multer',
    reason: 'fixture',
    reviewBy: '2026-06-01',
  },
];
const allowed = evaluateAudit(auditFixture, { allowlist: allowHigh, today: TODAY });

check(
  'an allowlisted high advisory stops blocking',
  !allowed.blocking.some((item) => item.id === 'GHSA-0000-0000-0001'),
);
check(
  'its siblings keep blocking',
  allowed.blocking.length === 4,
  `got ${allowed.blocking.length}`,
);
check(
  'an allowlisted high advisory is reported as allowed',
  allowed.allowed.some((entry) => entry.id === 'GHSA-0000-0000-0001'),
);
check('a matched allowlist entry is not stale', allowed.stale.length === 0);

// --- allowlisting a sub-threshold advisory is dead weight ------------------
// Deliberate: the gate does not enforce low, so an entry that only ever covers
// a low advisory holds nothing back. It reads as stale so it gets removed,
// rather than sitting there looking load-bearing.

const allowLow = [
  {
    id: 'GHSA-qvfw-j98x-7q72',
    package: 'multer',
    reason: 'fixture',
    reviewBy: '2026-06-01',
  },
];
const lowAllowed = evaluateAudit(auditFixture, { allowlist: allowLow, today: TODAY });

check(
  'a low advisory drops out without needing an allowlist entry',
  !lowAllowed.blocking.some((item) => item.id === 'GHSA-qvfw-j98x-7q72'),
);
check(
  'the low advisory still does not consume its allowlist entry',
  lowAllowed.allowed.length === 0,
);
check(
  'an allowlist entry that only covers a low advisory reads as stale',
  lowAllowed.stale.some((entry) => entry.id === 'GHSA-qvfw-j98x-7q72'),
);

// --- review dates ----------------------------------------------------------

const dated = evaluateAudit(auditFixture, {
  allowlist: [
    { id: 'GHSA-0000-0000-0001', package: 'multer', reason: 'fixture', reviewBy: '2025-12-31' },
    { id: 'GHSA-0000-0000-0002', package: 'multer', reason: 'fixture', reviewBy: '2026-06-01' },
  ],
  today: TODAY,
});

check(
  'an allowlist entry past its review date expires',
  dated.expired.length === 1 && dated.expired[0].id === 'GHSA-0000-0000-0001',
  dated.expired.map((entry) => entry.id).join(', '),
);

// --- empty audit -----------------------------------------------------------

const empty = evaluateAudit({}, { allowlist: [], today: TODAY });
check(
  'an audit with no vulnerabilities key is clean',
  empty.blocking.length === 0 && empty.expired.length === 0,
);

if (failures.length > 0) {
  const details = failures.map((name) => `- ${name}`).join('\n');
  throw new Error(
    `production audit gate contract failed.\nFailing expectations:\n${details}\nPath: security/audit-prod.mjs`,
  );
}

process.stdout.write('production audit gate contract passed\n');
