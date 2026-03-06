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
  // <h3 title="1042">1.04K</h3>
  // Prefer `title` because UI text may be abbreviated (K/M/B).
  const titleRe = /Total downloads<\/span>[\s\S]{0,600}?<h3[^>]*title="([^"]+)"[^>]*>/i;
  const titleMatch = html.match(titleRe);
  const fromTitle = (titleMatch?.[1] ?? '').replace(/[^\d]/g, '');
  if (fromTitle) {
    const parsed = Number.parseInt(fromTitle, 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  // Fallback: parse visible content (e.g. "1.04K").
  const visibleRe = /Total downloads<\/span>[\s\S]{0,600}?<h3[^>]*>\s*([^<]+?)\s*<\/h3>/i;
  const visibleMatch = html.match(visibleRe);
  const visible = (visibleMatch?.[1] ?? '').trim();
  if (visible) {
    const compact = visible.replace(/,/g, '');
    const m = compact.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
    if (m?.[1]) {
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n)) {
        const unit = (m[2] ?? '').toLowerCase();
        const mult = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : unit === 'b' ? 1_000_000_000 : 1;
        return Math.round(n * mult);
      }
    }
  }

  throw new Error(`Could not parse total downloads from ${url}`);
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

let htmlTotal = null;
try {
  htmlTotal = await getGhcrDownloadsTotalFromHtml();
} catch (err) {
  // Do not fail if API already gave us a value.
  console.warn(String(err));
}

let total = null;
if (typeof apiTotal === 'number' && Number.isFinite(apiTotal)) {
  total =
    typeof htmlTotal === 'number' && Number.isFinite(htmlTotal)
      ? Math.max(apiTotal, htmlTotal)
      : apiTotal;
} else if (typeof htmlTotal === 'number' && Number.isFinite(htmlTotal)) {
  total = htmlTotal;
}

if (!Number.isFinite(total)) {
  throw new Error('Unable to resolve GHCR downloads total from API or HTML');
}

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
