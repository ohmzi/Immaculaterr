import { Injectable } from '@nestjs/common';
import { readAppMeta } from '../app.meta';

type Cached<T> = {
  key: string;
  value: T;
  fetchedAtMs: number;
};

type LatestInfo = {
  version: string;
  url: string | null;
};

type GitHubMatchingRef = {
  ref?: string;
};

type ParsedVersion = {
  normalized: string;
  core: [number, number, number, number];
  channel: 'stable' | 'beta';
  betaNumber: number | null;
};

const DEFAULT_UPDATE_REPO = 'ohmzi/Immaculaterr';
const STABLE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/;
const BETA_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-beta(?:-(\d+))?$/i;
const GITHUB_API_TIMEOUT_MS = 6_000;
const GITHUB_API_ACCEPT = 'application/vnd.github+json';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_TAG_REF_PREFIX = 'refs/tags/';

function normalizeVersion(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  return s.replace(/^[vV]/, '');
}

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function parseVersion(raw: string): ParsedVersion | null {
  const norm = normalizeVersion(raw);
  if (!norm) return null;

  const betaMatch = norm.match(BETA_VERSION_RE);
  if (betaMatch) {
    const major = parseNonNegativeInt(betaMatch[1]);
    const minor = parseNonNegativeInt(betaMatch[2]);
    const patch = parseNonNegativeInt(betaMatch[3]);
    const betaNumber =
      betaMatch[4] === undefined ? 1 : parseNonNegativeInt(betaMatch[4]);
    if (
      major === null ||
      minor === null ||
      patch === null ||
      betaNumber === null ||
      betaNumber < 1
    ) {
      return null;
    }

    return {
      normalized: norm,
      core: [major, minor, patch, 0],
      channel: 'beta',
      betaNumber,
    };
  }

  const stableMatch = norm.match(STABLE_VERSION_RE);
  if (!stableMatch) return null;

  const major = parseNonNegativeInt(stableMatch[1]);
  const minor = parseNonNegativeInt(stableMatch[2]);
  const patch = parseNonNegativeInt(stableMatch[3]);
  const build =
    stableMatch[4] === undefined ? 0 : parseNonNegativeInt(stableMatch[4]);
  if (major === null || minor === null || patch === null || build === null) {
    return null;
  }

  return {
    normalized: norm,
    core: [major, minor, patch, build],
    channel: 'stable',
    betaNumber: null,
  };
}

function compareVersionCore(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  for (let i = 0; i < 4; i += 1) {
    const d = a[i] - b[i];
    if (d !== 0) return d;
  }
  return 0;
}

function isBetaVersion(raw: string): boolean {
  const parsed = parseVersion(raw);
  return parsed?.channel === 'beta';
}

function compareVersions(a: string, b: string): number | null {
  const ap = parseVersion(a);
  const bp = parseVersion(b);
  if (!ap || !bp) return null;

  const coreDiff = compareVersionCore(ap.core, bp.core);
  if (coreDiff !== 0) return coreDiff;
  if (ap.channel !== bp.channel) {
    return ap.channel === 'stable' ? 1 : -1;
  }
  if (ap.channel === 'stable') return 0;
  return (ap.betaNumber ?? 0) - (bp.betaNumber ?? 0);
}

function selectLatestCandidate(candidates: LatestInfo[]): LatestInfo | null {
  let latest: LatestInfo | null = null;

  for (const candidate of candidates) {
    if (!latest) {
      latest = candidate;
      continue;
    }

    const cmp = compareVersions(candidate.version, latest.version);
    if (typeof cmp === 'number' && cmp > 0) {
      latest = candidate;
    }
  }

  return latest;
}

function toGitHubBetaTagUrl(repo: string, tagName: string): string {
  return `https://github.com/${repo}/tree/${encodeURIComponent(tagName)}`;
}

function readUpdateCheckEnabled(): boolean {
  const raw = (process.env.UPDATE_CHECK_ENABLED ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function readUpdateRepoEnv(): string | null {
  const raw = (
    process.env.UPDATE_CHECK_REPO ??
    process.env.GITHUB_REPOSITORY ??
    ''
  ).trim();
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
    (
      process.env.UPDATE_CHECK_GITHUB_TOKEN ??
      process.env.GITHUB_TOKEN ??
      ''
    ).trim() || null;
  return v;
}

@Injectable()
export class UpdatesService {
  private cache: Cached<{
    latest: LatestInfo | null;
    error: string | null;
  }> | null = null;

  private async fetchGitHubJson<T>(url: string): Promise<T> {
    const token = readGitHubToken();
    const meta = readAppMeta();

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: GITHUB_API_ACCEPT,
        'User-Agent': `immaculaterr/${meta.version}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  }

  private async fetchLatestFromGitHubReleases(
    repo: string,
  ): Promise<LatestInfo> {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const json = await this.fetchGitHubJson<Record<string, unknown>>(url);
    const tagName = typeof json.tag_name === 'string' ? json.tag_name : '';
    const htmlUrl = typeof json.html_url === 'string' ? json.html_url : null;

    const version = normalizeVersion(tagName);
    if (!version) throw new Error('GitHub latest release missing tag_name');

    return { version, url: htmlUrl };
  }

  private async fetchLatestBetaTag(repo: string): Promise<LatestInfo | null> {
    const url = `https://api.github.com/repos/${repo}/git/matching-refs/tags/v`;
    const refs = await this.fetchGitHubJson<GitHubMatchingRef[]>(url);

    const candidates: LatestInfo[] = [];
    for (const ref of refs) {
      const refName = typeof ref.ref === 'string' ? ref.ref : '';
      if (!refName.startsWith(GITHUB_TAG_REF_PREFIX)) continue;

      const tagName = refName.slice(GITHUB_TAG_REF_PREFIX.length);
      const version = normalizeVersion(tagName);
      const parsed = version ? parseVersion(version) : null;
      if (!version || !parsed || parsed.channel !== 'beta') continue;

      candidates.push({
        version,
        url: toGitHubBetaTagUrl(repo, tagName),
      });
    }

    return selectLatestCandidate(candidates);
  }

  private async fetchLatestCandidate(
    repo: string,
    currentVersion: string,
  ): Promise<{
    latest: LatestInfo | null;
    error: string | null;
  }> {
    if (!isBetaVersion(currentVersion)) {
      const latest = await this.fetchLatestFromGitHubReleases(repo);
      return { latest, error: null };
    }

    const [stableReleaseResult, betaTagResult] = await Promise.allSettled([
      this.fetchLatestFromGitHubReleases(repo),
      this.fetchLatestBetaTag(repo),
    ]);

    const candidates: LatestInfo[] = [];
    const errors: string[] = [];

    if (stableReleaseResult.status === 'fulfilled') {
      candidates.push(stableReleaseResult.value);
    } else {
      errors.push(
        stableReleaseResult.reason instanceof Error
          ? stableReleaseResult.reason.message
          : String(stableReleaseResult.reason),
      );
    }

    if (betaTagResult.status === 'fulfilled') {
      if (betaTagResult.value) {
        candidates.push(betaTagResult.value);
      }
    } else {
      errors.push(
        betaTagResult.reason instanceof Error
          ? betaTagResult.reason.message
          : String(betaTagResult.reason),
      );
    }

    const latest = selectLatestCandidate(candidates);
    return {
      latest,
      error: latest ? null : errors.join('; ') || null,
    };
  }

  private async getCachedLatest(): Promise<{
    latest: LatestInfo | null;
    error: string | null;
  }> {
    if (!readUpdateCheckEnabled()) {
      return { latest: null, error: null };
    }

    const repo = readUpdateRepoEnv();
    if (!repo) {
      return {
        latest: null,
        error: 'UPDATE_CHECK_REPO is invalid (expected "owner/repo")',
      };
    }

    const meta = readAppMeta();
    const ttlMs = readUpdateCheckTtlMs();
    const now = Date.now();
    const cacheKey = `${repo}::${meta.version}`;
    if (
      this.cache &&
      this.cache.key === cacheKey &&
      now - this.cache.fetchedAtMs < ttlMs
    ) {
      return this.cache.value;
    }

    try {
      const value = await this.fetchLatestCandidate(repo, meta.version);
      this.cache = { key: cacheKey, value, fetchedAtMs: now };
      return value;
    } catch (err) {
      const value = {
        latest: null,
        error: (err as Error)?.message ?? String(err),
      };
      // Cache failures briefly to avoid thundering herd / log spam.
      this.cache = { key: cacheKey, value, fetchedAtMs: now };
      return value;
    }
  }

  async getUpdates() {
    const meta = readAppMeta();
    const repo = readUpdateRepoEnv();
    const { latest, error } = await this.getCachedLatest();

    const latestVersion = latest?.version ?? null;
    const cmp =
      latestVersion && meta.version
        ? compareVersions(latestVersion, meta.version)
        : null;
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
