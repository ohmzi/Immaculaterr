import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

type PlexXml = {
  MediaContainer?: Record<string, unknown>;
};

type PlexWatchlistItem = Record<string, unknown> & {
  ratingKey?: string | number;
  title?: string;
  year?: number | string;
  type?: string;
};

export type PlexWatchlistKind = 'movie' | 'show';

export type PlexWatchlistEntry = {
  ratingKey: string;
  title: string;
  year: number | null;
  type: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  allowBooleanAttributes: true,
  processEntities: false,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asPlexXml(value: unknown): PlexXml {
  return value && typeof value === 'object' ? (value as PlexXml) : {};
}

function asWatchlistItems(
  container?: Record<string, unknown>,
): PlexWatchlistItem[] {
  // Similar to PlexServerService: watchlist endpoints can return different element names.
  const items = (container?.Metadata ??
    container?.Video ??
    container?.Directory ??
    container?.Hub ??
    []) as PlexWatchlistItem | PlexWatchlistItem[];
  return asArray(items);
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function sanitizeUrlForLogs(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    for (const k of [
      'X-Plex-Token',
      'x-plex-token',
      'token',
      'authToken',
      'auth_token',
      'plexToken',
      'plex_token',
    ]) {
      if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function normTitle(s: string): string {
  // Match Python helper: "".join(ch.lower() for ch in s if ch.isalnum())
  return (s ?? '')
    .toLowerCase()
    .split('')
    .filter((ch) => /[a-z0-9]/.test(ch))
    .join('');
}

function diceCoefficient(a: string, b: string): number {
  const s1 = normTitle(a);
  const s2 = normTitle(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams = (s: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };

  const m1 = bigrams(s1);
  const m2 = bigrams(s2);
  let intersection = 0;
  for (const [bg, c1] of m1.entries()) {
    const c2 = m2.get(bg) ?? 0;
    intersection += Math.min(c1, c2);
  }
  return (2 * intersection) / (s1.length - 1 + (s2.length - 1));
}

@Injectable()
export class PlexWatchlistService {
  private readonly logger = new Logger(PlexWatchlistService.name);
  private readonly clientIdentifier: string;

  constructor() {
    // Keep consistent with PlexService: Plex expects a stable-ish identifier.
    this.clientIdentifier = process.env.PLEX_CLIENT_IDENTIFIER ?? randomUUID();
  }

  async listWatchlist(params: {
    token: string;
    kind: PlexWatchlistKind;
  }): Promise<{ ok: true; baseUrl: string; items: PlexWatchlistEntry[] }> {
    const { token, kind } = params;
    const typeNum = kind === 'movie' ? 1 : 2;

    const bases = [
      'https://discover.provider.plex.tv/',
      'https://metadata.provider.plex.tv/',
    ];

    const paths = [
      `library/sections/watchlist/all?type=${typeNum}`,
      // Some Plex deployments appear to accept this as well; harmless if ignored.
      `library/sections/watchlist/all?type=${typeNum}&includeGuids=1`,
    ];

    let lastErr: unknown = null;

    for (const base of bases) {
      for (const p of paths) {
        const url = new URL(p, normalizeBaseUrl(base)).toString();
        try {
          const xml = asPlexXml(await this.fetchXml(url, token, 20000));
          const container = xml.MediaContainer;
          const items = asWatchlistItems(container);
          const out: PlexWatchlistEntry[] = items
            .map((it) => ({
              ratingKey: it.ratingKey ? String(it.ratingKey) : '',
              title: typeof it.title === 'string' ? it.title : '',
              year: toInt(it.year),
              type: typeof it.type === 'string' ? it.type : null,
            }))
            .filter((it) => it.ratingKey && it.title);

          return { ok: true, baseUrl: base, items: out };
        } catch (err) {
          lastErr = err;
          this.logger.debug(
            `Watchlist fetch failed base=${base} path=${p}: ${(err as Error)?.message ?? String(err)}`,
          );
        }
      }
    }

    throw new BadGatewayException(
      `Failed to load Plex watchlist: ${(lastErr as Error)?.message ?? String(lastErr)}`,
    );
  }

  async removeMovieFromWatchlistByTitle(params: {
    token: string;
    title: string;
    year?: number | null;
    dryRun?: boolean;
  }): Promise<{
    ok: true;
    removed: number;
    attempted: number;
    matchedBy: 'normalized' | 'fuzzy' | 'none';
    sample: PlexWatchlistEntry[];
    baseUrlTried: string | null;
  }> {
    const { token, title, year, dryRun = false } = params;
    const q = title.trim();
    if (!q) {
      return {
        ok: true,
        removed: 0,
        attempted: 0,
        matchedBy: 'none',
        sample: [],
        baseUrlTried: null,
      };
    }

    const wl = await this.listWatchlist({ token, kind: 'movie' });

    const wantedNorm = normTitle(q);
    const candidatesNorm = wl.items.filter((it) => {
      if (normTitle(it.title) !== wantedNorm) return false;
      if (typeof year === 'number' && Number.isFinite(year)) {
        return it.year === year;
      }
      return true;
    });

    let candidates = candidatesNorm;
    let matchedBy: 'normalized' | 'fuzzy' | 'none' =
      candidatesNorm.length > 0 ? 'normalized' : 'none';

    if (candidates.length === 0) {
      // Fuzzy fallback (match Python's difflib.get_close_matches cutoff ~0.80)
      let best: { item: PlexWatchlistEntry; score: number } | null = null;
      for (const it of wl.items) {
        const score = diceCoefficient(q, it.title);
        if (!best || score > best.score) best = { item: it, score };
      }
      if (best && best.score >= 0.8) {
        candidates = wl.items.filter((it) => it.title === best.item.title);
        matchedBy = candidates.length > 0 ? 'fuzzy' : 'none';
      }
    }

    let removed = 0;
    for (const it of candidates) {
      if (dryRun) continue;
      const ok = await this.removeFromWatchlistByRatingKey({
        token,
        ratingKey: it.ratingKey,
      }).catch(() => false);
      if (ok) removed += 1;
    }

    return {
      ok: true,
      removed,
      attempted: candidates.length,
      matchedBy,
      sample: candidates.slice(0, 10),
      baseUrlTried: wl.baseUrl,
    };
  }

  async removeShowFromWatchlistByTitle(params: {
    token: string;
    title: string;
    dryRun?: boolean;
  }): Promise<{
    ok: true;
    removed: number;
    attempted: number;
    matchedBy: 'normalized' | 'fuzzy' | 'none';
    sample: PlexWatchlistEntry[];
    baseUrlTried: string | null;
  }> {
    const { token, title, dryRun = false } = params;
    const q = title.trim();
    if (!q) {
      return {
        ok: true,
        removed: 0,
        attempted: 0,
        matchedBy: 'none',
        sample: [],
        baseUrlTried: null,
      };
    }

    const wl = await this.listWatchlist({ token, kind: 'show' });

    const wantedNorm = normTitle(q);
    const candidatesNorm = wl.items.filter(
      (it) => normTitle(it.title) === wantedNorm,
    );

    let candidates = candidatesNorm;
    let matchedBy: 'normalized' | 'fuzzy' | 'none' =
      candidatesNorm.length > 0 ? 'normalized' : 'none';

    if (candidates.length === 0) {
      let best: { item: PlexWatchlistEntry; score: number } | null = null;
      for (const it of wl.items) {
        const score = diceCoefficient(q, it.title);
        if (!best || score > best.score) best = { item: it, score };
      }
      if (best && best.score >= 0.8) {
        candidates = wl.items.filter((it) => it.title === best.item.title);
        matchedBy = candidates.length > 0 ? 'fuzzy' : 'none';
      }
    }

    let removed = 0;
    for (const it of candidates) {
      if (dryRun) continue;
      const ok = await this.removeFromWatchlistByRatingKey({
        token,
        ratingKey: it.ratingKey,
      }).catch(() => false);
      if (ok) removed += 1;
    }

    return {
      ok: true,
      removed,
      attempted: candidates.length,
      matchedBy,
      sample: candidates.slice(0, 10),
      baseUrlTried: wl.baseUrl,
    };
  }

  async removeFromWatchlistByRatingKey(params: {
    token: string;
    ratingKey: string;
  }): Promise<boolean> {
    const { token, ratingKey } = params;
    const key = ratingKey.trim();
    if (!key) return false;

    const bases = [
      'https://discover.provider.plex.tv/',
      'https://metadata.provider.plex.tv/',
    ];

    // Endpoint shapes vary across Plex versions/backends; try a few known patterns.
    const candidates: Array<{
      path: string;
      method: 'PUT' | 'POST' | 'DELETE';
    }> = [
      {
        method: 'PUT',
        path: `actions/removeFromWatchlist?ratingKey=${encodeURIComponent(key)}`,
      },
      {
        method: 'PUT',
        path: `actions/removeFromWatchlist?key=${encodeURIComponent(key)}`,
      },
      {
        method: 'PUT',
        path: `library/metadata/${encodeURIComponent(key)}/actions/removeFromWatchlist`,
      },
      {
        method: 'POST',
        path: `library/metadata/${encodeURIComponent(key)}/actions/removeFromWatchlist`,
      },
      // Some implementations expose the action directly under /library/metadata/<key>/removeFromWatchlist
      {
        method: 'PUT',
        path: `library/metadata/${encodeURIComponent(key)}/removeFromWatchlist`,
      },
      {
        method: 'POST',
        path: `library/metadata/${encodeURIComponent(key)}/removeFromWatchlist`,
      },
      // Last resort: some backends accept DELETE on a watchlist metadata endpoint.
      {
        method: 'DELETE',
        path: `library/metadata/${encodeURIComponent(key)}/watchlist`,
      },
    ];

    for (const base of bases) {
      for (const c of candidates) {
        const url = new URL(c.path, normalizeBaseUrl(base)).toString();
        try {
          const ok = await this.fetchNoContent(url, token, c.method, 15000);
          if (ok) return true;
        } catch (err) {
          this.logger.debug(
            `Watchlist remove failed ${c.method} ${sanitizeUrlForLogs(url)}: ${(err as Error)?.message ?? String(err)}`,
          );
        }
      }
    }

    return false;
  }

  private getPlexHeaders(params: { token?: string }): Record<string, string> {
    // Match PlexService header set.
    return {
      Accept: 'application/xml',
      'X-Plex-Client-Identifier': this.clientIdentifier,
      'X-Plex-Product': 'Immaculaterr',
      'X-Plex-Version': '0.0.0',
      'X-Plex-Device': 'Server',
      'X-Plex-Device-Name': 'Immaculaterr',
      'X-Plex-Platform': 'Web',
      'X-Plex-Platform-Version': process.version,
      ...(params.token ? { 'X-Plex-Token': params.token } : {}),
    };
  }

  private async fetchNoContent(
    url: string,
    token: string,
    method: 'POST' | 'PUT' | 'DELETE',
    timeoutMs: number,
  ): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...this.getPlexHeaders({ token }),
          // Some endpoints behave better with JSON accept, even if they don't return a body.
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const ms = Date.now() - startedAt;
        this.logger.debug(
          `Plex watchlist HTTP ${method} ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
        );
        return false;
      }

      const ms = Date.now() - startedAt;
      this.logger.log(
        `Plex watchlist HTTP ${method} ${safeUrl} -> ${res.status} (${ms}ms)`,
      );
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchXml(
    url: string,
    token: string,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.getPlexHeaders({ token }),
        signal: controller.signal,
      });

      const text = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;

      if (!res.ok) {
        this.logger.debug(
          `Plex watchlist HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${text}`.trim(),
        );
        throw new BadGatewayException(
          `Plex watchlist request failed: HTTP ${res.status} ${text}`.trim(),
        );
      }

      this.logger.log(
        `Plex watchlist HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`,
      );
      return parser.parse(text) as unknown;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const ms = Date.now() - startedAt;
      this.logger.debug(
        `Plex watchlist HTTP GET ${safeUrl} -> FAILED (${ms}ms): ${(err as Error)?.message ?? String(err)}`.trim(),
      );
      throw new BadGatewayException(
        `Plex watchlist request failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
