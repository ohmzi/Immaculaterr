import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OWNER = process.env.GHCR_OWNER ?? process.env.GITHUB_REPOSITORY_OWNER;
const PACKAGE = process.env.GHCR_PACKAGE ?? 'immaculaterr';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const API_BASE = process.env.GITHUB_API_URL ?? 'https://api.github.com';

if (!OWNER) throw new Error('Missing GHCR_OWNER / GITHUB_REPOSITORY_OWNER');
if (!TOKEN) throw new Error('Missing GITHUB_TOKEN (or GH_TOKEN)');

async function fetchJson(url) {
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
  return await res.json();
}

async function sumDownloadsForEndpoint(endpointUrlBase) {
  const perPage = 100;
  let page = 1;
  let total = 0;

  // Pagination until empty page.
  // Note: `download_count` is per-version, and the GHCR UI totals match summing these.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${endpointUrlBase}?per_page=${perPage}&page=${page}`;
    const versions = await fetchJson(url);
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

async function getGhcrDownloadsTotal() {
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
      return await sumDownloadsForEndpoint(orgEndpointBase);
    }
    throw err;
  }
}

const total = await getGhcrDownloadsTotal();

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

