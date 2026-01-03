import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from './plex-server.service';

export type PlexLibraryGrowthPoint = {
  month: string; // YYYY-MM (UTC)
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

function startOfMonthUtc(tsSeconds: number): Date {
  const d = new Date(tsSeconds * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function buildCumulativeMonthlySeries(params: {
  movieAddedAtSeconds: number[];
  tvAddedAtSeconds: number[];
}): PlexLibraryGrowthPoint[] {
  const all = [...params.movieAddedAtSeconds, ...params.tvAddedAtSeconds];
  if (!all.length) return [];

  let minTs = all[0]!;
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

  return series;
}

@Injectable()
export class PlexAnalyticsService {
  private readonly logger = new Logger(PlexAnalyticsService.name);

  private readonly cache = new Map<
    string,
    { signature: string; expiresAt: number; data: PlexLibraryGrowthResponse }
  >();

  constructor(
    private readonly settings: SettingsService,
    private readonly plexServer: PlexServerService,
  ) {}

  async getLibraryGrowth(userId: string): Promise<PlexLibraryGrowthResponse> {
    const { settings, secrets } = await this.settings.getInternalSettings(userId);

    const baseUrlRaw = pickString(settings, 'plex.baseUrl');
    const token = pickString(secrets, 'plex.token');
    if (!baseUrlRaw || !token) {
      return {
        ok: true,
        series: [],
        summary: { startMonth: null, endMonth: null, movies: 0, tv: 0, total: 0 },
      };
    }

    const baseUrl = normalizeHttpUrl(baseUrlRaw);
    const movieLibraryName =
      pickString(settings, 'plex.movieLibraryName') || 'Movies';
    const tvLibraryName = pickString(settings, 'plex.tvLibraryName') || 'TV Shows';

    const signature = JSON.stringify({
      baseUrl,
      token,
      movieLibraryName,
      tvLibraryName,
    });

    const cached = this.cache.get(userId);
    const now = Date.now();
    if (cached && cached.signature === signature && cached.expiresAt > now) {
      return cached.data;
    }

    const sections = await this.plexServer.getSections({ baseUrl, token });
    const find = (title: string) =>
      sections.find((s) => s.title.toLowerCase() === title.toLowerCase());

    const movie = find(movieLibraryName);
    if (!movie) {
      throw new BadRequestException({
        code: 'PLEX_MOVIE_LIBRARY_NOT_FOUND',
        message: `Movie library not found: ${movieLibraryName}`,
      });
    }

    const tv = find(tvLibraryName);
    if (!tv) {
      throw new BadRequestException({
        code: 'PLEX_TV_LIBRARY_NOT_FOUND',
        message: `TV library not found: ${tvLibraryName}`,
      });
    }

    this.logger.log(
      `Computing Plex library growth userId=${userId} movie=${movie.title} tv=${tv.title}`,
    );

    const [movieAddedAtSeconds, tvAddedAtSeconds] = await Promise.all([
      this.plexServer.getAddedAtTimestampsForSection({
        baseUrl,
        token,
        librarySectionKey: movie.key,
      }),
      this.plexServer.getAddedAtTimestampsForSection({
        baseUrl,
        token,
        librarySectionKey: tv.key,
      }),
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

    // Cache for 10 minutes
    this.cache.set(userId, { signature, expiresAt: now + 10 * 60_000, data });
    return data;
  }
}


