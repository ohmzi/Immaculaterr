import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from './plex-server.service';
import { createHash } from 'crypto';

export type PlexLibraryGrowthPoint = {
  month: string; // YYYY-MM or YYYY-MM-DD (UTC)
  movies: number;
  tv: number;
};

export type PlexLibraryGrowthResponse = {
  ok: true;
  series: PlexLibraryGrowthPoint[];
  summary: {
    startMonth: string | null;
    endMonth: string | null;
    movies: number;
    tv: number;
    total: number;
  };
};

export type PlexLibraryGrowthVersionResponse = {
  ok: true;
  version: string;
};

const LIBRARY_GROWTH_ALGO_REV = '2';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol))
      throw new Error('Unsupported protocol');
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

function monthKeyUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function dayKeyUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfMonthUtc(tsSeconds: number): Date {
  const d = new Date(tsSeconds * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonthsUtc(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
}

function buildCumulativeMonthlySeries(params: {
  movieAddedAtSeconds: number[];
  tvAddedAtSeconds: number[];
}): PlexLibraryGrowthPoint[] {
  const all = [...params.movieAddedAtSeconds, ...params.tvAddedAtSeconds];
  if (!all.length) return [];

  let minTs = all[0];
  for (const ts of all) {
    if (ts < minTs) minTs = ts;
  }

  // Plex can contain bogus/legacy addedAt timestamps (e.g. 1970). For UX,
  // clamp the visible timeline to start no earlier than 2015-01.
  const minStart = new Date(Date.UTC(2015, 0, 1));
  const rawStart = startOfMonthUtc(minTs);
  const start = rawStart < minStart ? minStart : rawStart;
  const startSeconds = Math.floor(start.getTime() / 1000);
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const movieAdds = new Map<string, number>();
  let movies = 0;
  for (const ts of params.movieAddedAtSeconds) {
    if (ts < startSeconds) {
      // Baseline: count items that existed before the visible window.
      movies += 1;
      continue;
    }
    const key = monthKeyUtc(new Date(ts * 1000));
    movieAdds.set(key, (movieAdds.get(key) ?? 0) + 1);
  }

  const tvAdds = new Map<string, number>();
  let tv = 0;
  for (const ts of params.tvAddedAtSeconds) {
    if (ts < startSeconds) {
      tv += 1;
      continue;
    }
    const key = monthKeyUtc(new Date(ts * 1000));
    tvAdds.set(key, (tvAdds.get(key) ?? 0) + 1);
  }

  const series: PlexLibraryGrowthPoint[] = [];

  // Iterate month-by-month (UTC)
  for (let cursor = start; cursor <= end; cursor = addMonthsUtc(cursor, 1)) {
    const key = monthKeyUtc(cursor);
    movies += movieAdds.get(key) ?? 0;
    tv += tvAdds.get(key) ?? 0;
    series.push({ month: key, movies, tv });
  }

  // Always end on today's *actual* UTC date so the chart advances daily.
  const today = new Date();
  const todayKey = dayKeyUtc(today);
  const lastKey = series.at(-1)?.month ?? '';
  if (todayKey && lastKey !== todayKey) {
    series.push({ month: todayKey, movies, tv });
  }

  return series;
}

@Injectable()
export class PlexAnalyticsService {
  private readonly logger = new Logger(PlexAnalyticsService.name);

  private readonly cache = new Map<
    string,
    { signature: string; expiresAt: number; data: PlexLibraryGrowthResponse }
  >();

  private readonly growthBustCounterByUserId = new Map<string, number>();

  constructor(
    private readonly settings: SettingsService,
    private readonly plexServer: PlexServerService,
  ) {}

  invalidateLibraryGrowth(userId: string) {
    this.cache.delete(userId);
    this.growthBustCounterByUserId.set(
      userId,
      (this.growthBustCounterByUserId.get(userId) ?? 0) + 1,
    );
  }

  async getLibraryGrowthVersion(
    userId: string,
  ): Promise<PlexLibraryGrowthVersionResponse> {
    const { settings, secrets } =
      await this.settings.getInternalSettings(userId);

    const baseUrlRaw = pickString(settings, 'plex.baseUrl');
    const token = pickString(secrets, 'plex.token');

    const signatureSeed = (() => {
      if (!baseUrlRaw || !token) return 'unconfigured';
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      return baseUrl;
    })();

    const signatureHash = createHash('sha256')
      .update(`${signatureSeed}:${LIBRARY_GROWTH_ALGO_REV}`)
      .digest('hex')
      .slice(0, 16);

    const counter = this.growthBustCounterByUserId.get(userId) ?? 0;
    const dayBucket = Math.floor(Date.now() / 86_400_000); // refresh at least daily
    return { ok: true, version: `${signatureHash}:${counter}:${dayBucket}` };
  }

  async getLibraryGrowth(userId: string): Promise<PlexLibraryGrowthResponse> {
    const { settings, secrets } =
      await this.settings.getInternalSettings(userId);

    const baseUrlRaw = pickString(settings, 'plex.baseUrl');
    const token = pickString(secrets, 'plex.token');
    if (!baseUrlRaw || !token) {
      return {
        ok: true,
        series: [],
        summary: {
          startMonth: null,
          endMonth: null,
          movies: 0,
          tv: 0,
          total: 0,
        },
      };
    }

    const baseUrl = normalizeHttpUrl(baseUrlRaw);

    const signature = JSON.stringify({ baseUrl, token });

    const cached = this.cache.get(userId);
    const now = Date.now();
    if (cached && cached.signature === signature && cached.expiresAt > now) {
      return cached.data;
    }

    const sections = await this.plexServer.getSections({ baseUrl, token });
    const movieSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'movie',
    );
    const tvSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'show',
    );

    // If the server has no movie/show libraries, just return empty analytics.
    if (!movieSections.length && !tvSections.length) {
      const data: PlexLibraryGrowthResponse = {
        ok: true,
        series: [],
        summary: {
          startMonth: null,
          endMonth: null,
          movies: 0,
          tv: 0,
          total: 0,
        },
      };
      this.cache.set(userId, {
        signature,
        expiresAt: now + 60 * 60_000,
        data,
      });
      return data;
    }

    this.logger.log(
      `Computing Plex library growth userId=${userId} movieLibraries=${movieSections.length} tvLibraries=${tvSections.length}`,
    );

    const loadAddedAtForSections = async (
      kind: 'movie' | 'tv',
      targetSections: Array<{ key: string; title: string }>,
    ) => {
      if (!targetSections.length) return [] as number[];
      const perSection = await Promise.all(
        targetSections.map(async (sec) => {
          try {
            const values = await this.plexServer.getAddedAtTimestampsForSection(
              {
                baseUrl,
                token,
                librarySectionKey: sec.key,
              },
            );
            this.logger.log(
              `Plex growth source kind=${kind} section=${sec.title} key=${sec.key} items=${values.length}`,
            );
            return values;
          } catch (err) {
            const msg = (err as Error)?.message ?? String(err);
            this.logger.warn(
              `Failed loading Plex growth timestamps kind=${kind} section=${sec.title} key=${sec.key}: ${msg}`,
            );
            return [] as number[];
          }
        }),
      );
      return perSection.flat();
    };

    const [movieAddedAtSeconds, tvAddedAtSeconds] = await Promise.all([
      loadAddedAtForSections('movie', movieSections),
      loadAddedAtForSections('tv', tvSections),
    ]);

    const series = buildCumulativeMonthlySeries({
      movieAddedAtSeconds,
      tvAddedAtSeconds,
    });

    const last = series.at(-1);
    const movies = last?.movies ?? 0;
    const tvCount = last?.tv ?? 0;
    const data: PlexLibraryGrowthResponse = {
      ok: true,
      series,
      summary: {
        startMonth: series[0]?.month ?? null,
        endMonth: last?.month ?? null,
        movies,
        tv: tvCount,
        total: movies + tvCount,
      },
    };

    // Cache for 24 hours (webhooks will invalidate on library.new)
    // Also refresh frequently enough that the chart's end date advances each day.
    this.cache.set(userId, { signature, expiresAt: now + 60 * 60_000, data });
    return data;
  }
}
