// skipcq: JS-0833
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OWNER = process.env.GHCR_OWNER ?? process.env.GITHUB_REPOSITORY_OWNER;
const PACKAGE = process.env.GHCR_PACKAGE ?? 'immaculaterr';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const API_BASE = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const REPO = process.env.GHCR_REPO ?? process.env.GITHUB_REPOSITORY ?? `${OWNER}/Immaculaterr`;

if (!OWNER) throw new Error('Missing GHCR_OWNER / GITHUB_REPOSITORY_OWNER');

async function fetchJsonWithToken(url) {
  if (!TOKEN) throw new Error('Missing GITHUB_TOKEN (or GH_TOKEN)');
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'immaculaterr-ghcr-downloads-badge',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url}) ${text}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      // Mimic a browser-ish UA to avoid edge cases with bot responses.
      'User-Agent': 'immaculaterr-ghcr-downloads-badge',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url}) ${text}`);
  }
  return res.text();
}

async function sumDownloadsForEndpoint(endpointUrlBase) {
  const perPage = 100;
  let page = 1;
  let total = 0;

  // Pagination until empty page.
  // Note: `download_count` is per-version, and the GHCR UI totals match summing these.
  for (;;) {
    const url = `${endpointUrlBase}?per_page=${perPage}&page=${page}`;
    const versions = await fetchJsonWithToken(url);
    if (!Array.isArray(versions) || versions.length === 0) break;

    for (const v of versions) {
      const n = typeof v?.download_count === 'number' ? v.download_count : 0;
      total += n;
    }

    if (versions.length < perPage) break;
    page += 1;
  }

  return total;
}

async function getGhcrDownloadsTotalFromApi() {
  // Prefer package-level total if available (matches the UI “Total downloads”).
  const userPkgUrl = `${API_BASE}/users/${encodeURIComponent(
    OWNER,
  )}/packages/container/${encodeURIComponent(PACKAGE)}`;
  const orgPkgUrl = `${API_BASE}/orgs/${encodeURIComponent(
    OWNER,
  )}/packages/container/${encodeURIComponent(PACKAGE)}`;

  try {
    const pkg = await fetchJsonWithToken(userPkgUrl);
    if (typeof pkg?.download_count === 'number') return pkg.download_count;
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)) ?? '';
    if (!msg.includes('403') && !msg.includes('404')) throw err;
  }

  try {
    const pkg = await fetchJsonWithToken(orgPkgUrl);
    if (typeof pkg?.download_count === 'number') return pkg.download_count;
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)) ?? '';
    if (!msg.includes('403') && !msg.includes('404')) throw err;
  }

  const userEndpointBase = `${API_BASE}/users/${encodeURIComponent(
    OWNER,
  )}/packages/container/${encodeURIComponent(PACKAGE)}/versions`;
  const orgEndpointBase = `${API_BASE}/orgs/${encodeURIComponent(
    OWNER,
  )}/packages/container/${encodeURIComponent(PACKAGE)}/versions`;

  try {
    return await sumDownloadsForEndpoint(userEndpointBase);
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)) ?? '';
    // Fallback for org-owned packages.
    if (msg.includes('/users/') && (msg.includes('404') || msg.includes('403'))) {
      return sumDownloadsForEndpoint(orgEndpointBase);
    }
    throw err;
  }
}

async function getGhcrDownloadsTotalFromHtml() {
  const url = `https://github.com/${REPO}/pkgs/container/${encodeURIComponent(PACKAGE)}`;
  const html = await fetchText(url);

  // Example snippet:
  // <span ...>Total downloads</span>
  // <h3 title="314">314</h3>
  const re = /Total downloads<\/span>\s*<h3[^>]*title="(\d+)"[^>]*>\s*\d+\s*<\/h3>/i;
  const m = html.match(re);
  if (!m?.[1]) throw new Error(`Could not parse total downloads from ${url}`);
  return Number.parseInt(m[1], 10);
}

let apiTotal = null;
if (TOKEN) {
  try {
    apiTotal = await getGhcrDownloadsTotalFromApi();
  } catch (err) {
    // Keep going; HTML parsing is our reliable fallback for public packages.
    console.warn(String(err));
  }
}

const htmlTotal = await getGhcrDownloadsTotalFromHtml();
const total = typeof apiTotal === 'number' ? Math.max(apiTotal, htmlTotal) : htmlTotal;

const badgePath = 'doc/assets/badges/ghcr-package-downloads.json';
await mkdir('doc/assets/badges', { recursive: true });

const next = {
  schemaVersion: 1,
  label: 'GHCR downloads',
  message: String(total),
  color: 'blue',
};

let prevRaw = '';
try {
  prevRaw = await readFile(badgePath, 'utf8');
} catch {
  // ignore
}

const nextRaw = JSON.stringify(next, null, 2) + '\n';
if (prevRaw === nextRaw) {
  console.log(`No change (total=${total}).`);
} else {
  await writeFile(badgePath, nextRaw, 'utf8');
  console.log(`Updated ${badgePath} (total=${total}).`);
}
