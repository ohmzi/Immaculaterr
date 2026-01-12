import { Injectable } from '@nestjs/common';
import { readAppMeta } from '../app.meta';

type Cached<T> = {
  value: T;
  fetchedAtMs: number;
};

type LatestInfo = {
  version: string;
  url: string | null;
};

const DEFAULT_UPDATE_REPO = 'ohmzi/Immaculaterr';

function normalizeVersion(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  return s.replace(/^[vV]/, '');
}

function parseVersionToParts(raw: string): number[] | null {
  const norm = normalizeVersion(raw);
  if (!norm) return null;
  const parts = norm.split('.');
  if (parts.length < 3 || parts.length > 4) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (nums.length === 3) nums.push(0);
  return nums;
}

function compareVersions(a: string, b: string): number | null {
  const ap = parseVersionToParts(a);
  const bp = parseVersionToParts(b);
  if (!ap || !bp) return null;
  for (let i = 0; i < 4; i += 1) {
    const d = (ap[i] ?? 0) - (bp[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function readUpdateCheckEnabled(): boolean {
  const raw = (process.env.UPDATE_CHECK_ENABLED ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function readUpdateRepoEnv(): string | null {
  const raw = (process.env.UPDATE_CHECK_REPO ?? process.env.GITHUB_REPOSITORY ?? '').trim();
  if (!raw) return DEFAULT_UPDATE_REPO;
  // Expect "owner/repo"
  if (!/^[^/]+\/[^/]+$/.test(raw)) return null;
  return raw;
}

function readUpdateCheckTtlMs(): number {
  // Default to 60s so new releases show up quickly for users.
  // Can be overridden via UPDATE_CHECK_TTL_MS.
  const raw = Number.parseInt(process.env.UPDATE_CHECK_TTL_MS ?? '60000', 10);
  return Number.isFinite(raw) && raw > 5_000 ? raw : 60_000;
}

function readGitHubToken(): string | null {
  const v =
    (process.env.UPDATE_CHECK_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? '').trim() || null;
  return v;
}

@Injectable()
export class UpdatesService {
  private cache: Cached<{ latest: LatestInfo | null; error: string | null }> | null = null;

  private async fetchLatestFromGitHubReleases(repo: string): Promise<LatestInfo> {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const token = readGitHubToken();
    const meta = readAppMeta();

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `immaculaterr/${meta.version}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(6_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    const tagName = typeof json.tag_name === 'string' ? json.tag_name : '';
    const htmlUrl = typeof json.html_url === 'string' ? json.html_url : null;

    const version = normalizeVersion(tagName);
    if (!version) throw new Error('GitHub latest release missing tag_name');

    return { version, url: htmlUrl };
  }

  private async getCachedLatest(): Promise<{ latest: LatestInfo | null; error: string | null }> {
    if (!readUpdateCheckEnabled()) {
      return { latest: null, error: null };
    }

    const repo = readUpdateRepoEnv();
    if (!repo) {
      return { latest: null, error: 'UPDATE_CHECK_REPO is invalid (expected "owner/repo")' };
    }

    const ttlMs = readUpdateCheckTtlMs();
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAtMs < ttlMs) return this.cache.value;

    try {
      const latest = await this.fetchLatestFromGitHubReleases(repo);
      const value = { latest, error: null };
      this.cache = { value, fetchedAtMs: now };
      return value;
    } catch (err) {
      const value = { latest: null, error: (err as Error)?.message ?? String(err) };
      // Cache failures briefly to avoid thundering herd / log spam.
      this.cache = { value, fetchedAtMs: now };
      return value;
    }
  }

  async getUpdates() {
    const meta = readAppMeta();
    const repo = readUpdateRepoEnv();
    const { latest, error } = await this.getCachedLatest();

    const latestVersion = latest?.version ?? null;
    const cmp =
      latestVersion && meta.version ? compareVersions(latestVersion, meta.version) : null;
    const updateAvailable = typeof cmp === 'number' ? cmp > 0 : false;

    return {
      currentVersion: meta.version,
      latestVersion,
      updateAvailable,
      source: 'github-releases' as const,
      repo,
      latestUrl: latest?.url ?? null,
      checkedAt: new Date().toISOString(),
      error,
    };
  }
}

