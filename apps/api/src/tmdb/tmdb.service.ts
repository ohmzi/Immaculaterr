import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import {
  buildTitleQueryVariants,
  normalizeTitleForMatching,
} from '../lib/title-normalize';

type TmdbConfiguration = Record<string, unknown>;

type TmdbMovieSearchResult = {
  id: number;
  title: string;
  release_date?: string;
  genre_ids?: number[];
  vote_count?: number;
  vote_average?: number;
  popularity?: number;
  original_language?: string;
};

type TmdbMovieDetails = {
  id: number;
  title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string;
  genres?: Array<{ id?: unknown; name?: unknown }>;
  vote_count?: number;
  vote_average?: number;
};

type TmdbTvSearchResult = {
  id: number;
  name: string;
  first_air_date?: string;
  genre_ids?: number[];
  vote_count?: number;
  vote_average?: number;
  popularity?: number;
};

type TmdbTvExternalIds = {
  tvdb_id?: number | null;
};

type TmdbTvDetails = {
  id: number;
  name?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  genres?: Array<{ id?: unknown; name?: unknown }>;
  vote_count?: number;
  vote_average?: number;
  external_ids?: TmdbTvExternalIds;
};

type TmdbPagedResponse = {
  results?: unknown;
  total_pages?: unknown;
};

export type TmdbMovieCandidate = {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
  sources: string[];
};

export type TmdbTvCandidate = {
  tmdbId: number;
  title: string;
  releaseDate: string | null; // TV: first_air_date
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
  sources: string[];
};

export type TmdbMovieGenreOption = {
  id: number;
  name: string;
};

export type TmdbLanguageOption = {
  code: string;
  englishName: string;
  name: string;
};

export type TmdbMovieCertificationOption = {
  countryCode: string;
  certification: string;
};

export type TmdbMovieWatchProviderOption = {
  id: number;
  name: string;
};

export type TmdbUpcomingMovieDiscoverCandidate = {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
  originalLanguage: string | null;
};

const bestSeedResult = (
  query: string,
  results: TmdbMovieSearchResult[],
  seedYear?: number | null,
): TmdbMovieSearchResult | null => {
  const q = query.trim().toLowerCase();
  if (!results.length) return null;

  const score = (r: TmdbMovieSearchResult): number => {
    const title = (r.title || '').trim().toLowerCase();
    const pop = Number.isFinite(r.popularity) ? Number(r.popularity) : 0;
    const votes = Number.isFinite(r.vote_count) ? Number(r.vote_count) : 0;
    const vavg = Number.isFinite(r.vote_average) ? Number(r.vote_average) : 0;
    const genreIds = new Set(r.genre_ids ?? []);

    // Hard penalty for documentaries unless user explicitly asked
    const isDoc = genreIds.has(99);
    const docPenalty = isDoc && !q.includes('documentary') ? -1000 : 0;

    const starts = q && title.startsWith(q) ? 80 : 0;
    const contains = q && title.includes(q) ? 30 : 0;

    // Franchise heuristic
    const franchiseBoost =
      q === 'harry potter' && title.startsWith('harry potter and the') ? 60 : 0;

    const yearBoost = (() => {
      const y = Math.trunc(seedYear ?? NaN);
      if (!Number.isFinite(y) || y <= 1800) return 0;
      const ry =
        typeof r.release_date === 'string'
          ? Number(r.release_date.slice(0, 4))
          : NaN;
      if (!Number.isFinite(ry)) return 0;
      const d = Math.abs(ry - y);
      if (d === 0) return 200;
      if (d === 1) return 50;
      if (d === 2) return 10;
      return 0;
    })();

    const engagement = votes * 0.05 + pop * 0.5 + vavg * 2.0;
    return (
      docPenalty + starts + contains + franchiseBoost + yearBoost + engagement
    );
  };

  return results.reduce((best, cur) => (score(cur) > score(best) ? cur : best));
};

const bestSeedTvResult = (
  query: string,
  results: TmdbTvSearchResult[],
  seedYear?: number | null,
): TmdbTvSearchResult | null => {
  const q = query.trim().toLowerCase();
  if (!results.length) return null;

  const score = (r: TmdbTvSearchResult): number => {
    const title = (r.name || '').trim().toLowerCase();
    const pop = Number.isFinite(r.popularity) ? Number(r.popularity) : 0;
    const votes = Number.isFinite(r.vote_count) ? Number(r.vote_count) : 0;
    const vavg = Number.isFinite(r.vote_average) ? Number(r.vote_average) : 0;
    const genreIds = new Set(r.genre_ids ?? []);

    // Hard penalty for documentaries unless user explicitly asked
    const isDoc = genreIds.has(99);
    const docPenalty = isDoc && !q.includes('documentary') ? -1000 : 0;

    const starts = q && title.startsWith(q) ? 80 : 0;
    const contains = q && title.includes(q) ? 30 : 0;

    const yearBoost = (() => {
      const y = Math.trunc(seedYear ?? NaN);
      if (!Number.isFinite(y) || y <= 1800) return 0;
      const ry =
        typeof r.first_air_date === 'string'
          ? Number(r.first_air_date.slice(0, 4))
          : NaN;
      if (!Number.isFinite(ry)) return 0;
      const d = Math.abs(ry - y);
      if (d === 0) return 200;
      if (d === 1) return 50;
      if (d === 2) return 10;
      return 0;
    })();

    const engagement = votes * 0.05 + pop * 0.5 + vavg * 2.0;
    return docPenalty + starts + contains + yearBoost + engagement;
  };

  return results.reduce((best, cur) => (score(cur) > score(best) ? cur : best));
};

const classifyByReleaseDate = (
  releaseDate: string | null,
  today: string,
): 'released' | 'upcoming' | 'unknown' => {
  const d = (releaseDate ?? '').trim();
  if (!d) return 'unknown';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'unknown';
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(today) && d > today)
    return 'upcoming';
  return 'released';
};

const normalizeTimezone = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const tz = raw.trim();
  if (!tz) return null;
  try {
    // Throws RangeError for invalid time zones
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz });
    formatter.format(0);
    return tz;
  } catch {
    return null;
  }
};

const addDays = (date: Date, days: number): Date => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
};

const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
};

const TMDB_CONNECTIVITY_ERROR_MARKERS = [
  'fetch failed',
  'failed to fetch',
  'network',
  'timeout',
  'timed out',
  'aborted',
  'econnrefused',
  'enotfound',
  'eai_again',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'socket hang up',
  'getaddrinfo',
] as const;

const errorMessageWithCause = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  const cause = (error as { cause?: unknown } | null)?.cause;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : '';
  return `${message}${causeMessage ? ` (cause: ${causeMessage})` : ''}`;
};

const isTmdbConnectivityFailure = (error: unknown): boolean => {
  const message = errorMessageWithCause(error).toLowerCase();
  return TMDB_CONNECTIVITY_ERROR_MARKERS.some((marker) =>
    message.includes(marker),
  );
};

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);

  async testConnection(params: { apiKey: string }) {
    const apiKey = params.apiKey.trim();

    this.logger.log('Testing TMDB connection');

    const url = new URL('https://api.themoviedb.org/3/configuration');
    url.searchParams.set('api_key', apiKey);

    const data = (await this.fetchTmdbJson(
      url,
      10000,
      'TMDB test failed',
    )) as TmdbConfiguration;

    // Return a small subset + raw for now; we’ll store settings later.
    const images = (data['images'] ?? null) as Record<string, unknown> | null;
    const secureBaseUrl =
      images && typeof images['secure_base_url'] === 'string'
        ? images['secure_base_url']
        : null;

    return {
      ok: true,
      summary: {
        secureBaseUrl,
      },
      configuration: data,
    };
  }

  async searchMovie(params: {
    apiKey: string;
    query: string;
    year?: number | null;
    includeAdult?: boolean;
  }): Promise<TmdbMovieSearchResult[]> {
    const apiKey = params.apiKey.trim();
    const query = params.query.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!query) return [];

    const url = new URL('https://api.themoviedb.org/3/search/movie');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query);
    url.searchParams.set('include_adult', String(Boolean(params.includeAdult)));
    if (params.year && Number.isFinite(params.year)) {
      url.searchParams.set('year', String(Math.trunc(params.year)));
    }

    const data = (await this.fetchTmdbJson(url, 20000)) as TmdbPagedResponse;
    const results = Array.isArray(data.results)
      ? (data.results as unknown[])
      : [];

    const out: TmdbMovieSearchResult[] = [];
    for (const r of results) {
      if (!r || typeof r !== 'object') continue;
      const rec = r as Record<string, unknown>;
      const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
      const title = typeof rec['title'] === 'string' ? rec['title'].trim() : '';
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!title) continue;

      out.push({
        id: Math.trunc(id),
        title,
        release_date:
          typeof rec['release_date'] === 'string'
            ? rec['release_date']
            : undefined,
        genre_ids: Array.isArray(rec['genre_ids'])
          ? (rec['genre_ids'] as unknown[])
              .map((x) => (typeof x === 'number' ? x : Number(x)))
              .filter((n) => Number.isFinite(n) && n > 0)
          : undefined,
        vote_count:
          typeof rec['vote_count'] === 'number'
            ? rec['vote_count']
            : Number(rec['vote_count']),
        vote_average:
          typeof rec['vote_average'] === 'number'
            ? rec['vote_average']
            : Number(rec['vote_average']),
        popularity:
          typeof rec['popularity'] === 'number'
            ? rec['popularity']
            : Number(rec['popularity']),
        original_language:
          typeof rec['original_language'] === 'string'
            ? rec['original_language'].trim()
            : undefined,
      });
    }

    return out;
  }

  async searchTv(params: {
    apiKey: string;
    query: string;
    firstAirDateYear?: number | null;
    includeAdult?: boolean;
  }): Promise<TmdbTvSearchResult[]> {
    const apiKey = params.apiKey.trim();
    const query = params.query.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!query) return [];

    const url = new URL('https://api.themoviedb.org/3/search/tv');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query);
    // TMDB supports include_adult on some endpoints; harmless if ignored.
    url.searchParams.set('include_adult', String(Boolean(params.includeAdult)));
    if (
      typeof params.firstAirDateYear === 'number' &&
      Number.isFinite(params.firstAirDateYear)
    ) {
      url.searchParams.set(
        'first_air_date_year',
        String(Math.trunc(params.firstAirDateYear)),
      );
    }

    const data = (await this.fetchTmdbJson(url, 20000)) as TmdbPagedResponse;
    const results = Array.isArray(data.results)
      ? (data.results as unknown[])
      : [];

    const out: TmdbTvSearchResult[] = [];
    for (const r of results) {
      if (!r || typeof r !== 'object') continue;
      const rec = r as Record<string, unknown>;
      const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
      const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!name) continue;

      out.push({
        id: Math.trunc(id),
        name,
        first_air_date:
          typeof rec['first_air_date'] === 'string'
            ? rec['first_air_date']
            : undefined,
        genre_ids: Array.isArray(rec['genre_ids'])
          ? (rec['genre_ids'] as unknown[])
              .map((x) => (typeof x === 'number' ? x : Number(x)))
              .filter((n) => Number.isFinite(n) && n > 0)
          : undefined,
        vote_count:
          typeof rec['vote_count'] === 'number'
            ? rec['vote_count']
            : Number(rec['vote_count']),
        vote_average:
          typeof rec['vote_average'] === 'number'
            ? rec['vote_average']
            : Number(rec['vote_average']),
        popularity:
          typeof rec['popularity'] === 'number'
            ? rec['popularity']
            : Number(rec['popularity']),
      });
    }

    return out;
  }

  async getMovie(params: {
    apiKey: string;
    tmdbId: number;
  }): Promise<TmdbMovieDetails | null> {
    const apiKey = params.apiKey.trim();
    const tmdbId = Math.trunc(params.tmdbId);
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

    const url = new URL(`https://api.themoviedb.org/3/movie/${tmdbId}`);
    url.searchParams.set('api_key', apiKey);

    const data = await this.fetchTmdbJson(url, 20000);
    if (!data || typeof data !== 'object') return null;
    const rec = data as Record<string, unknown>;
    const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
    if (!Number.isFinite(id) || id <= 0) return null;

    const voteAverageRaw = rec['vote_average'];
    const voteAverage =
      typeof voteAverageRaw === 'number'
        ? voteAverageRaw
        : typeof voteAverageRaw === 'string' && voteAverageRaw.trim()
          ? Number(voteAverageRaw)
          : NaN;

    const voteCountRaw = rec['vote_count'];
    const voteCount =
      typeof voteCountRaw === 'number'
        ? voteCountRaw
        : typeof voteCountRaw === 'string' && voteCountRaw.trim()
          ? Number(voteCountRaw)
          : NaN;

    return {
      id: Math.trunc(id),
      title: typeof rec['title'] === 'string' ? rec['title'] : undefined,
      release_date:
        typeof rec['release_date'] === 'string'
          ? rec['release_date']
          : undefined,
      overview:
        typeof rec['overview'] === 'string' ? rec['overview'] : undefined,
      poster_path:
        typeof rec['poster_path'] === 'string' ? rec['poster_path'] : undefined,
      genres: Array.isArray(rec['genres'])
        ? (rec['genres'] as Array<{ id?: unknown; name?: unknown }>)
        : undefined,
      vote_average: Number.isFinite(voteAverage) ? voteAverage : undefined,
      vote_count: Number.isFinite(voteCount)
        ? Math.max(0, Math.trunc(voteCount))
        : undefined,
    };
  }

  async getTv(params: {
    apiKey: string;
    tmdbId: number;
    appendExternalIds?: boolean;
  }): Promise<TmdbTvDetails | null> {
    const apiKey = params.apiKey.trim();
    const tmdbId = Math.trunc(params.tmdbId);
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

    const url = new URL(`https://api.themoviedb.org/3/tv/${tmdbId}`);
    url.searchParams.set('api_key', apiKey);
    if (params.appendExternalIds) {
      url.searchParams.set('append_to_response', 'external_ids');
    }

    const data = await this.fetchTmdbJson(url, 20000);
    if (!data || typeof data !== 'object') return null;
    const rec = data as Record<string, unknown>;
    const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
    if (!Number.isFinite(id) || id <= 0) return null;

    const voteAverageRaw = rec['vote_average'];
    const voteAverage =
      typeof voteAverageRaw === 'number'
        ? voteAverageRaw
        : typeof voteAverageRaw === 'string' && voteAverageRaw.trim()
          ? Number(voteAverageRaw)
          : NaN;

    const voteCountRaw = rec['vote_count'];
    const voteCount =
      typeof voteCountRaw === 'number'
        ? voteCountRaw
        : typeof voteCountRaw === 'string' && voteCountRaw.trim()
          ? Number(voteCountRaw)
          : NaN;

    const externalIdsRaw = rec['external_ids'];
    const external_ids: TmdbTvExternalIds | undefined =
      externalIdsRaw && typeof externalIdsRaw === 'object'
        ? ({
            tvdb_id:
              typeof (externalIdsRaw as Record<string, unknown>)['tvdb_id'] ===
              'number'
                ? ((externalIdsRaw as Record<string, unknown>)[
                    'tvdb_id'
                  ] as number)
                : typeof (externalIdsRaw as Record<string, unknown>)[
                      'tvdb_id'
                    ] === 'string'
                  ? Number(
                      (externalIdsRaw as Record<string, unknown>)['tvdb_id'],
                    )
                  : null,
          } as TmdbTvExternalIds)
        : undefined;

    return {
      id: Math.trunc(id),
      name: typeof rec['name'] === 'string' ? rec['name'] : undefined,
      first_air_date:
        typeof rec['first_air_date'] === 'string'
          ? rec['first_air_date']
          : undefined,
      overview:
        typeof rec['overview'] === 'string' ? rec['overview'] : undefined,
      poster_path:
        typeof rec['poster_path'] === 'string' ? rec['poster_path'] : undefined,
      genres: Array.isArray(rec['genres'])
        ? (rec['genres'] as Array<{ id?: unknown; name?: unknown }>)
        : undefined,
      vote_average: Number.isFinite(voteAverage) ? voteAverage : undefined,
      vote_count: Number.isFinite(voteCount)
        ? Math.max(0, Math.trunc(voteCount))
        : undefined,
      ...(external_ids ? { external_ids } : {}),
    };
  }

  async getTvExternalIds(params: {
    apiKey: string;
    tmdbId: number;
  }): Promise<{ tvdb_id: number | null } | null> {
    const apiKey = params.apiKey.trim();
    const tmdbId = Math.trunc(params.tmdbId);
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

    const url = new URL(
      `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids`,
    );
    url.searchParams.set('api_key', apiKey);
    const data = await this.fetchTmdbJson(url, 20000);
    if (!data || typeof data !== 'object') return null;
    const rec = data as Record<string, unknown>;
    const tvdbRaw = rec['tvdb_id'];
    const tvdb =
      typeof tvdbRaw === 'number'
        ? tvdbRaw
        : typeof tvdbRaw === 'string' && tvdbRaw.trim()
          ? Number(tvdbRaw)
          : NaN;
    return { tvdb_id: Number.isFinite(tvdb) ? Math.trunc(tvdb) : null };
  }

  async getMovieVoteStats(params: { apiKey: string; tmdbId: number }): Promise<{
    vote_average: number | null;
    vote_count: number | null;
  } | null> {
    const details = await this.getMovie({
      apiKey: params.apiKey,
      tmdbId: params.tmdbId,
    });
    if (!details) return null;

    const vote_average =
      typeof details.vote_average === 'number' &&
      Number.isFinite(details.vote_average)
        ? Number(details.vote_average)
        : null;
    const vote_count =
      typeof details.vote_count === 'number' &&
      Number.isFinite(details.vote_count)
        ? Math.max(0, Math.trunc(details.vote_count))
        : null;

    return { vote_average, vote_count };
  }

  async getTvVoteStats(params: { apiKey: string; tmdbId: number }): Promise<{
    vote_average: number | null;
    vote_count: number | null;
  } | null> {
    const details = await this.getTv({
      apiKey: params.apiKey,
      tmdbId: params.tmdbId,
    });
    if (!details) return null;

    const vote_average =
      typeof details.vote_average === 'number' &&
      Number.isFinite(details.vote_average)
        ? Number(details.vote_average)
        : null;
    const vote_count =
      typeof details.vote_count === 'number' &&
      Number.isFinite(details.vote_count)
        ? Math.max(0, Math.trunc(details.vote_count))
        : null;

    return { vote_average, vote_count };
  }

  async getMovieGenres(params: {
    apiKey: string;
  }): Promise<TmdbMovieGenreOption[]> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');

    const url = new URL('https://api.themoviedb.org/3/genre/movie/list');
    url.searchParams.set('api_key', apiKey);
    const data = await this.fetchTmdbJson(url, 20000);
    if (!data || typeof data !== 'object') return [];

    const raw = (data as Record<string, unknown>)['genres'];
    const rows = Array.isArray(raw) ? raw : [];
    const out: TmdbMovieGenreOption[] = [];
    const seen = new Set<number>();

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
      const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!name) continue;
      const normalizedId = Math.trunc(id);
      if (seen.has(normalizedId)) continue;
      seen.add(normalizedId);
      out.push({ id: normalizedId, name });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async getLanguages(params: {
    apiKey: string;
  }): Promise<TmdbLanguageOption[]> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');

    const url = new URL('https://api.themoviedb.org/3/configuration/languages');
    url.searchParams.set('api_key', apiKey);
    const data = await this.fetchTmdbJson(url, 20000);
    const rows = Array.isArray(data) ? data : [];

    const out: TmdbLanguageOption[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const code =
        typeof rec['iso_639_1'] === 'string' ? rec['iso_639_1'].trim() : '';
      if (!code) continue;
      const key = code.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const englishName =
        typeof rec['english_name'] === 'string'
          ? rec['english_name'].trim()
          : '';
      const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
      out.push({
        code,
        englishName: englishName || code,
        name: name || englishName || code,
      });
    }

    out.sort((a, b) => a.englishName.localeCompare(b.englishName));
    return out;
  }

  async getMovieCertifications(params: {
    apiKey: string;
    countryCode?: string;
  }): Promise<TmdbMovieCertificationOption[]> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');

    const countryCode = (
      (params.countryCode ?? 'US').trim().toUpperCase() || 'US'
    ).slice(0, 2);
    const url = new URL(
      'https://api.themoviedb.org/3/certification/movie/list',
    );
    url.searchParams.set('api_key', apiKey);
    const data = await this.fetchTmdbJson(url, 20000);
    if (!data || typeof data !== 'object') return [];

    const resultsRaw = (data as Record<string, unknown>)['certifications'];
    if (!resultsRaw || typeof resultsRaw !== 'object') return [];
    const countryRows = (resultsRaw as Record<string, unknown>)[countryCode];
    const rows = Array.isArray(countryRows) ? countryRows : [];

    const out: TmdbMovieCertificationOption[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const certification =
        typeof rec['certification'] === 'string'
          ? rec['certification'].trim()
          : '';
      if (!certification) continue;
      const key = certification.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ countryCode, certification });
    }

    out.sort((a, b) => a.certification.localeCompare(b.certification));
    return out;
  }

  async getMovieWatchProviders(params: {
    apiKey: string;
    countryCode?: string;
  }): Promise<TmdbMovieWatchProviderOption[]> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');

    const countryCode = (
      (params.countryCode ?? 'US').trim().toUpperCase() || 'US'
    ).slice(0, 2);
    const url = new URL('https://api.themoviedb.org/3/watch/providers/movie');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('watch_region', countryCode);
    const data = await this.fetchTmdbJson(url, 20000);
    if (!data || typeof data !== 'object') return [];

    const resultsRaw = (data as Record<string, unknown>)['results'];
    const rows = Array.isArray(resultsRaw) ? resultsRaw : [];
    const out: Array<
      TmdbMovieWatchProviderOption & { displayPriority: number }
    > = [];
    const seen = new Set<number>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const idRaw = rec['provider_id'];
      const parsedId = typeof idRaw === 'number' ? idRaw : Number(idRaw);
      if (!Number.isFinite(parsedId) || parsedId <= 0) continue;
      const id = Math.trunc(parsedId);
      if (seen.has(id)) continue;
      const name =
        typeof rec['provider_name'] === 'string'
          ? rec['provider_name'].trim()
          : '';
      if (!name) continue;
      const displayPriorityRaw = rec['display_priority'];
      const parsedDisplayPriority =
        typeof displayPriorityRaw === 'number'
          ? displayPriorityRaw
          : Number(displayPriorityRaw);
      const displayPriority = Number.isFinite(parsedDisplayPriority)
        ? Math.trunc(parsedDisplayPriority)
        : Number.MAX_SAFE_INTEGER;
      seen.add(id);
      out.push({ id, name, displayPriority });
    }

    out.sort((a, b) => {
      if (a.displayPriority !== b.displayPriority) {
        return a.displayPriority - b.displayPriority;
      }
      return a.name.localeCompare(b.name);
    });
    return out.map(({ id, name }) => ({ id, name }));
  }

  async getMovieCertification(params: {
    apiKey: string;
    tmdbId: number;
    countryCode?: string;
  }): Promise<string | null> {
    const apiKey = params.apiKey.trim();
    const tmdbId = Math.trunc(params.tmdbId);
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

    const countryCode = (
      (params.countryCode ?? 'US').trim().toUpperCase() || 'US'
    ).slice(0, 2);
    const url = new URL(
      `https://api.themoviedb.org/3/movie/${tmdbId}/release_dates`,
    );
    url.searchParams.set('api_key', apiKey);
    const data = await this.fetchTmdbJson(url, 20000);
    if (!data || typeof data !== 'object') return null;

    const rowsRaw = (data as Record<string, unknown>)['results'];
    const countryRows = Array.isArray(rowsRaw) ? (rowsRaw as unknown[]) : [];
    let countryEntry: Record<string, unknown> | null = null;
    for (const row of countryRows) {
      if (!row || typeof row !== 'object') continue;
      const code = (row as Record<string, unknown>)['iso_3166_1'];
      if (
        typeof code === 'string' &&
        code.trim().toUpperCase() === countryCode
      ) {
        countryEntry = row as Record<string, unknown>;
        break;
      }
    }
    if (!countryEntry) return null;

    const releasesRaw = countryEntry['release_dates'];
    const releases = Array.isArray(releasesRaw) ? releasesRaw : [];
    const releaseTypePriority = [3, 2, 4, 1, 5, 6];
    const releaseTypeRank = new Map(
      releaseTypePriority.map((type, index) => [type, index]),
    );

    const parsed = releases
      .map((release) => {
        if (!release || typeof release !== 'object') return null;
        const rec = release as Record<string, unknown>;
        const certification =
          typeof rec['certification'] === 'string'
            ? rec['certification'].trim()
            : '';
        if (!certification) return null;
        const releaseTypeRaw = rec['release_type'];
        let releaseType: number | null = null;
        if (
          typeof releaseTypeRaw === 'number' &&
          Number.isFinite(releaseTypeRaw)
        ) {
          releaseType = Math.trunc(releaseTypeRaw);
        } else if (
          typeof releaseTypeRaw === 'string' &&
          releaseTypeRaw.trim()
        ) {
          const parsedReleaseType = Number.parseInt(releaseTypeRaw.trim(), 10);
          if (Number.isFinite(parsedReleaseType)) {
            releaseType = parsedReleaseType;
          }
        }
        return {
          certification,
          releaseType,
        };
      })
      .filter(
        (
          entry,
        ): entry is { certification: string; releaseType: number | null } =>
          entry !== null,
      )
      .sort((a, b) => {
        const aRank = a.releaseType
          ? (releaseTypeRank.get(a.releaseType) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
        const bRank = b.releaseType
          ? (releaseTypeRank.get(b.releaseType) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return a.certification.localeCompare(b.certification);
      });

    return parsed[0]?.certification ?? null;
  }

  async discoverUpcomingMovies(params: {
    apiKey: string;
    fromDate: string;
    toDate: string;
    genreIds?: number[] | null;
    languages?: string[] | null;
    watchProviderIds?: number[] | null;
    watchRegion?: string | null;
    minScore?: number | null;
    maxScore?: number | null;
    startPage?: number;
    maxItems?: number;
    maxPages?: number;
  }): Promise<TmdbUpcomingMovieDiscoverCandidate[]> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    const fromDate = params.fromDate.trim();
    const toDate = params.toDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      throw new BadGatewayException('TMDB fromDate must be YYYY-MM-DD');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      throw new BadGatewayException('TMDB toDate must be YYYY-MM-DD');
    }

    const genreIds = Array.isArray(params.genreIds)
      ? params.genreIds
          .map((value) =>
            Number.isFinite(value) ? Math.trunc(value) : Number.NaN,
          )
          .filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const languageAllowlist = Array.isArray(params.languages)
      ? params.languages
          .map((value) =>
            String(value ?? '')
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean)
      : [];
    const languageSet = new Set(languageAllowlist);
    const watchProviderIdsRaw = Array.isArray(params.watchProviderIds)
      ? params.watchProviderIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.trunc(value))
      : [];
    const watchProviderIds = Array.from(new Set(watchProviderIdsRaw));
    const watchRegion = (
      typeof params.watchRegion === 'string'
        ? params.watchRegion.trim().toUpperCase()
        : 'US'
    ).slice(0, 2);

    const minScoreRaw =
      typeof params.minScore === 'number' && Number.isFinite(params.minScore)
        ? params.minScore
        : null;
    const maxScoreRaw =
      typeof params.maxScore === 'number' && Number.isFinite(params.maxScore)
        ? params.maxScore
        : null;
    const minScore = minScoreRaw !== null ? Math.max(0, minScoreRaw) : null;
    const maxScore = maxScoreRaw !== null ? Math.min(10, maxScoreRaw) : null;
    const scoreLower =
      minScore !== null && maxScore !== null
        ? Math.min(minScore, maxScore)
        : minScore;
    const scoreUpper =
      minScore !== null && maxScore !== null
        ? Math.max(minScore, maxScore)
        : maxScore;

    const maxItems = Math.max(
      1,
      Math.min(500, Math.trunc(params.maxItems ?? 250)),
    );
    const maxPages = Math.max(
      1,
      Math.min(20, Math.trunc(params.maxPages ?? 10)),
    );
    const startPage = Math.max(
      1,
      Math.min(500, Math.trunc(params.startPage ?? 1)),
    );

    const url = new URL('https://api.themoviedb.org/3/discover/movie');
    url.searchParams.set('primary_release_date.gte', fromDate);
    url.searchParams.set('primary_release_date.lte', toDate);
    url.searchParams.set('sort_by', 'popularity.desc');
    if (genreIds.length) {
      url.searchParams.set('with_genres', genreIds.join(','));
    }
    if (scoreLower !== null) {
      url.searchParams.set('vote_average.gte', scoreLower.toFixed(1));
    }
    if (scoreUpper !== null) {
      url.searchParams.set('vote_average.lte', scoreUpper.toFixed(1));
    }
    if (languageAllowlist.length === 1) {
      url.searchParams.set('with_original_language', languageAllowlist[0]);
    }
    if (watchProviderIds.length) {
      url.searchParams.set('with_watch_providers', watchProviderIds.join(','));
      url.searchParams.set('watch_region', watchRegion || 'US');
    }

    const rows = await this.pagedResults({
      apiKey,
      url,
      includeAdult: false,
      maxItems,
      maxPages,
      startPage,
    });

    const out: TmdbUpcomingMovieDiscoverCandidate[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
      if (!row || !Number.isFinite(row.id) || row.id <= 0) continue;
      const tmdbId = Math.trunc(row.id);
      if (seen.has(tmdbId)) continue;
      const title = (row.title ?? '').trim();
      if (!title) continue;
      const originalLanguage =
        typeof row.original_language === 'string' &&
        row.original_language.trim()
          ? row.original_language.trim().toLowerCase()
          : null;
      if (
        languageSet.size &&
        originalLanguage &&
        !languageSet.has(originalLanguage)
      ) {
        continue;
      }
      if (languageSet.size && !originalLanguage) continue;
      seen.add(tmdbId);
      out.push({
        tmdbId,
        title,
        releaseDate:
          typeof row.release_date === 'string' && row.release_date.trim()
            ? row.release_date.trim()
            : null,
        voteAverage:
          typeof row.vote_average === 'number' &&
          Number.isFinite(row.vote_average)
            ? Number(row.vote_average)
            : null,
        voteCount:
          typeof row.vote_count === 'number' && Number.isFinite(row.vote_count)
            ? Math.max(0, Math.trunc(row.vote_count))
            : null,
        popularity:
          typeof row.popularity === 'number' && Number.isFinite(row.popularity)
            ? Number(row.popularity)
            : null,
        originalLanguage,
      });
      if (out.length >= maxItems) break;
    }

    return out;
  }

  async getMovieFilterMetadata(params: {
    apiKey: string;
    countryCode?: string;
  }): Promise<{
    genres: TmdbMovieGenreOption[];
    languages: TmdbLanguageOption[];
    certifications: TmdbMovieCertificationOption[];
    watchProviders: TmdbMovieWatchProviderOption[];
  }> {
    const [genres, languages, certifications, watchProviders] =
      await Promise.all([
        this.getMovieGenres({ apiKey: params.apiKey }),
        this.getLanguages({ apiKey: params.apiKey }),
        this.getMovieCertifications({
          apiKey: params.apiKey,
          countryCode: params.countryCode,
        }),
        this.getMovieWatchProviders({
          apiKey: params.apiKey,
          countryCode: params.countryCode,
        }),
      ]);

    return { genres, languages, certifications, watchProviders };
  }

  async getSeedMetadata(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
  }): Promise<Record<string, unknown>> {
    const seedTitle = params.seedTitle.trim();
    const apiKey = params.apiKey.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) return { seed_title: '' };

    try {
      const variants = buildTitleQueryVariants(seedTitle);
      let best: TmdbMovieSearchResult | null = null;
      for (const q of variants.length ? variants : [seedTitle]) {
        const results = await this.searchMovie({
          apiKey,
          query: q,
          year: params.seedYear ?? null,
          includeAdult: false,
        });
        best = bestSeedResult(q, results, params.seedYear ?? null);
        if (best) break;
      }
      if (!best) return { seed_title: seedTitle };

      const details = await this.getMovie({ apiKey, tmdbId: best.id }).catch(
        () => null,
      );
      const genres = Array.isArray(details?.genres)
        ? details.genres
            .map((g) => {
              if (!g || typeof g !== 'object') return null;
              const name = typeof g.name === 'string' ? g.name.trim() : '';
              return name || null;
            })
            .filter((x): x is string => Boolean(x))
        : [];

      return {
        seed_title: seedTitle,
        tmdb_id: best.id,
        title: details?.title ?? best.title ?? seedTitle,
        year: (details?.release_date ?? best.release_date ?? '').slice(0, 4),
        genres,
        overview: details?.overview ?? '',
      };
    } catch {
      return { seed_title: seedTitle };
    }
  }

  async getTvSeedMetadata(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
  }): Promise<Record<string, unknown>> {
    const seedTitle = params.seedTitle.trim();
    const apiKey = params.apiKey.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) return { seed_title: '' };

    try {
      const variants = buildTitleQueryVariants(seedTitle);
      let best: TmdbTvSearchResult | null = null;
      for (const q of variants.length ? variants : [seedTitle]) {
        const results = await this.searchTv({
          apiKey,
          query: q,
          firstAirDateYear: params.seedYear ?? null,
          includeAdult: false,
        });
        best = bestSeedTvResult(q, results, params.seedYear ?? null);
        if (best) break;
      }
      if (!best) return { seed_title: seedTitle };

      const details = await this.getTv({
        apiKey,
        tmdbId: best.id,
      }).catch(() => null);
      const genres = Array.isArray(details?.genres)
        ? details.genres
            .map((g) => {
              if (!g || typeof g !== 'object') return null;
              const name = typeof g.name === 'string' ? g.name.trim() : '';
              return name || null;
            })
            .filter((x): x is string => Boolean(x))
        : [];

      return {
        seed_title: seedTitle,
        tmdb_id: best.id,
        title: details?.name ?? best.name ?? seedTitle,
        year: (details?.first_air_date ?? best.first_air_date ?? '').slice(
          0,
          4,
        ),
        genres,
        overview: details?.overview ?? '',
        media_type: 'tv',
      };
    } catch {
      return { seed_title: seedTitle, media_type: 'tv' };
    }
  }

  async discoverFallbackMovieCandidates(params: {
    apiKey: string;
    limit: number;
    seedYear?: number | null;
    genreIds?: number[] | null;
    includeAdult?: boolean;
    timezone?: string | null;
  }): Promise<TmdbMovieCandidate[]> {
    const apiKey = params.apiKey.trim();
    const limit = Math.max(1, Math.min(500, Math.trunc(params.limit || 50)));
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');

    const tz = normalizeTimezone(params.timezone) ?? 'America/Toronto';
    const today = this.formatTodayInTimezone(tz);

    const url = new URL('https://api.themoviedb.org/3/discover/movie');
    const genreIds = Array.isArray(params.genreIds)
      ? params.genreIds
          .map((n) => (Number.isFinite(n) ? Math.trunc(n) : NaN))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (genreIds.length)
      url.searchParams.set('with_genres', genreIds.slice(0, 4).join(','));
    url.searchParams.set('primary_release_date.lte', today);

    const y = Math.trunc(params.seedYear ?? NaN);
    if (Number.isFinite(y) && y > 1800) {
      const from = Math.max(1900, y - 20);
      url.searchParams.set('primary_release_date.gte', `${from}-01-01`);
    }

    url.searchParams.set('vote_count.gte', '150');
    url.searchParams.set('sort_by', 'vote_average.desc');

    const results = await this.pagedResults({
      apiKey,
      url,
      includeAdult: Boolean(params.includeAdult),
      maxItems: Math.min(800, limit * 10),
      maxPages: 10,
    });

    const out: TmdbMovieCandidate[] = [];
    const seen = new Set<number>();
    for (const r of results) {
      if (!r || !Number.isFinite(r.id) || r.id <= 0) continue;
      const tmdbId = Math.trunc(r.id);
      if (seen.has(tmdbId)) continue;
      const title = (r.title ?? '').trim();
      if (!title) continue;
      seen.add(tmdbId);
      out.push({
        tmdbId,
        title,
        releaseDate:
          typeof r.release_date === 'string' && r.release_date.trim()
            ? r.release_date.trim()
            : null,
        voteAverage:
          typeof r.vote_average === 'number' && Number.isFinite(r.vote_average)
            ? Number(r.vote_average)
            : null,
        voteCount:
          typeof r.vote_count === 'number' && Number.isFinite(r.vote_count)
            ? Math.max(0, Math.trunc(r.vote_count))
            : null,
        popularity:
          typeof r.popularity === 'number' && Number.isFinite(r.popularity)
            ? Number(r.popularity)
            : null,
        sources: ['discover_fallback'],
      });
      if (out.length >= limit) break;
    }

    return out;
  }

  async discoverFallbackTvCandidates(params: {
    apiKey: string;
    limit: number;
    seedYear?: number | null;
    genreIds?: number[] | null;
    includeAdult?: boolean;
    timezone?: string | null;
  }): Promise<TmdbTvCandidate[]> {
    const apiKey = params.apiKey.trim();
    const limit = Math.max(1, Math.min(500, Math.trunc(params.limit || 50)));
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');

    const tz = normalizeTimezone(params.timezone) ?? 'America/Toronto';
    const today = this.formatTodayInTimezone(tz);

    const url = new URL('https://api.themoviedb.org/3/discover/tv');
    const genreIds = Array.isArray(params.genreIds)
      ? params.genreIds
          .map((n) => (Number.isFinite(n) ? Math.trunc(n) : NaN))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (genreIds.length)
      url.searchParams.set('with_genres', genreIds.slice(0, 4).join(','));
    url.searchParams.set('first_air_date.lte', today);

    const y = Math.trunc(params.seedYear ?? NaN);
    if (Number.isFinite(y) && y > 1800) {
      const from = Math.max(1900, y - 20);
      url.searchParams.set('first_air_date.gte', `${from}-01-01`);
    }

    url.searchParams.set('vote_count.gte', '150');
    url.searchParams.set('sort_by', 'vote_average.desc');

    const results = await this.pagedTvResults({
      apiKey,
      url,
      includeAdult: Boolean(params.includeAdult),
      maxItems: Math.min(800, limit * 10),
      maxPages: 10,
    });

    const out: TmdbTvCandidate[] = [];
    const seen = new Set<number>();
    for (const r of results) {
      if (!r || !Number.isFinite(r.id) || r.id <= 0) continue;
      const tmdbId = Math.trunc(r.id);
      if (seen.has(tmdbId)) continue;
      const title = (r.name ?? '').trim();
      if (!title) continue;
      seen.add(tmdbId);
      out.push({
        tmdbId,
        title,
        releaseDate:
          typeof r.first_air_date === 'string' && r.first_air_date.trim()
            ? r.first_air_date.trim()
            : null,
        voteAverage:
          typeof r.vote_average === 'number' && Number.isFinite(r.vote_average)
            ? Number(r.vote_average)
            : null,
        voteCount:
          typeof r.vote_count === 'number' && Number.isFinite(r.vote_count)
            ? Math.max(0, Math.trunc(r.vote_count))
            : null,
        popularity:
          typeof r.popularity === 'number' && Number.isFinite(r.popularity)
            ? Number(r.popularity)
            : null,
        sources: ['discover_fallback'],
      });
      if (out.length >= limit) break;
    }

    return out;
  }

  async getAdvancedMovieRecommendations(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
    limit: number;
    includeAdult?: boolean;
  }): Promise<string[]> {
    const apiKey = params.apiKey.trim();
    const seedTitle = normalizeTitleForMatching(params.seedTitle.trim());
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 25)));
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) return [];

    const seedResults = await this.searchMovie({
      apiKey,
      query: seedTitle,
      year: params.seedYear ?? null,
      includeAdult: Boolean(params.includeAdult),
    });
    const seedBest = bestSeedResult(
      seedTitle,
      seedResults,
      params.seedYear ?? null,
    );
    if (!seedBest) return [];

    const seedDetails = await this.getMovie({
      apiKey,
      tmdbId: seedBest.id,
    }).catch(() => null);
    const seedGenreIds = new Set(
      (seedDetails?.genres ?? [])
        .map((g) => {
          const id =
            typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
          return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
        .filter((n) => Number.isFinite(n) && n > 0),
    );

    const candidates = new Map<number, { title: string; score: number }>();
    const seen = new Set<number>([seedBest.id]);

    const addResults = (results: TmdbMovieSearchResult[], boost: number) => {
      for (const m of results) {
        if (!m || !Number.isFinite(m.id) || m.id <= 0) continue;
        if (seen.has(m.id)) continue;
        if (!m.title) continue;

        const voteCount = Number.isFinite(m.vote_count)
          ? Number(m.vote_count)
          : 0;
        if (voteCount < 100) continue;

        const movieGenres = new Set(m.genre_ids ?? []);
        if (seedGenreIds.size && movieGenres.size) {
          const overlaps = Array.from(movieGenres).some((g) =>
            seedGenreIds.has(g),
          );
          if (!overlaps) continue;
        }

        const voteAvg = Number.isFinite(m.vote_average)
          ? Number(m.vote_average)
          : 0;
        const score = voteAvg + boost;

        const existing = candidates.get(m.id);
        if (!existing || score > existing.score) {
          candidates.set(m.id, { title: m.title, score });
        }
        seen.add(m.id);
      }
    };

    const includeAdult = Boolean(params.includeAdult);
    const desiredPool = Math.min(200, limit * 3);

    const recResults = await this.pagedResults({
      apiKey,
      url: new URL(
        `https://api.themoviedb.org/3/movie/${seedBest.id}/recommendations`,
      ),
      includeAdult,
      maxItems: desiredPool,
      maxPages: 5,
    });
    addResults(recResults, 1.0);

    const simResults = await this.pagedResults({
      apiKey,
      url: new URL(`https://api.themoviedb.org/3/movie/${seedBest.id}/similar`),
      includeAdult,
      maxItems: desiredPool,
      maxPages: 5,
    });
    addResults(simResults, 0.4);

    if (candidates.size < limit && seedGenreIds.size) {
      const withGenres = Array.from(seedGenreIds).slice(0, 3).join(',');
      const discUrl = new URL('https://api.themoviedb.org/3/discover/movie');
      discUrl.searchParams.set('with_genres', withGenres);
      discUrl.searchParams.set('vote_count.gte', '200');
      discUrl.searchParams.set('sort_by', 'vote_average.desc');

      const discResults = await this.pagedResults({
        apiKey,
        url: discUrl,
        includeAdult,
        maxItems: Math.min(300, limit * 5),
        maxPages: 10,
      });
      addResults(discResults, 0.0);
    }

    const ranked = Array.from(candidates.values()).sort(
      (a, b) => b.score - a.score,
    );
    return ranked.slice(0, limit).map((c) => c.title);
  }

  async getContrastMovieRecommendations(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
    limit: number;
  }): Promise<string[]> {
    const apiKey = params.apiKey.trim();
    const seedTitle = normalizeTitleForMatching(params.seedTitle.trim());
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 15)));
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) return [];

    const seedResults = await this.searchMovie({
      apiKey,
      query: seedTitle,
      year: params.seedYear ?? null,
      includeAdult: false,
    });
    const seedBest = bestSeedResult(
      seedTitle,
      seedResults,
      params.seedYear ?? null,
    );
    if (!seedBest) return [];

    const seedDetails = await this.getMovie({
      apiKey,
      tmdbId: seedBest.id,
    }).catch(() => null);
    const seedGenreIds = (seedDetails?.genres ?? [])
      .map((g) => {
        const id =
          typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
        return Number.isFinite(id) ? Math.trunc(id) : NaN;
      })
      .filter((n) => Number.isFinite(n) && n > 0);

    const url = new URL('https://api.themoviedb.org/3/discover/movie');
    if (seedGenreIds.length) {
      url.searchParams.set(
        'without_genres',
        seedGenreIds.slice(0, 5).join(','),
      );
    }
    url.searchParams.set('vote_count.gte', '200');
    url.searchParams.set('sort_by', 'vote_average.desc');

    const results = await this.pagedResults({
      apiKey,
      url,
      includeAdult: false,
      maxItems: Math.min(250, limit * 6),
      maxPages: 10,
    });

    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      const title = r.title?.trim();
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(title);
      if (out.length >= limit) break;
    }
    return out;
  }

  async getContrastTvRecommendations(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
    limit: number;
  }): Promise<string[]> {
    const apiKey = params.apiKey.trim();
    const seedTitle = normalizeTitleForMatching(params.seedTitle.trim());
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 15)));
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) return [];

    const seedResults = await this.searchTv({
      apiKey,
      query: seedTitle,
      firstAirDateYear: params.seedYear ?? null,
      includeAdult: false,
    });
    const seedBest = bestSeedTvResult(
      seedTitle,
      seedResults,
      params.seedYear ?? null,
    );
    if (!seedBest) return [];

    const seedDetails = await this.getTv({
      apiKey,
      tmdbId: seedBest.id,
    }).catch(() => null);
    const seedGenreIds = (seedDetails?.genres ?? [])
      .map((g) => {
        const id =
          typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
        return Number.isFinite(id) ? Math.trunc(id) : NaN;
      })
      .filter((n) => Number.isFinite(n) && n > 0);

    const today = this.formatTodayInTimezone('America/Toronto');
    const url = new URL('https://api.themoviedb.org/3/discover/tv');
    if (seedGenreIds.length) {
      url.searchParams.set(
        'without_genres',
        seedGenreIds.slice(0, 5).join(','),
      );
    }
    url.searchParams.set('first_air_date.lte', today);
    url.searchParams.set('vote_count.gte', '150');
    url.searchParams.set('sort_by', 'vote_average.desc');

    const results = await this.pagedTvResults({
      apiKey,
      url,
      includeAdult: false,
      maxItems: Math.min(250, limit * 6),
      maxPages: 10,
    });

    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      const title = r.name?.trim();
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(title);
      if (out.length >= limit) break;
    }
    return out;
  }

  async getSplitRecommendationCandidatePools(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
    includeAdult?: boolean;
    timezone?: string | null;
    upcomingWindowMonths?: number;
  }): Promise<{
    seed: {
      tmdbId: number;
      title: string;
      genreIds: number[];
      releaseDate: string | null;
    };
    meta: { today: string; timezone: string; upcomingWindowEnd: string };
    released: TmdbMovieCandidate[];
    upcoming: TmdbMovieCandidate[];
    unknown: TmdbMovieCandidate[];
  }> {
    const apiKey = params.apiKey.trim();
    const seedTitle = normalizeTitleForMatching(params.seedTitle.trim());
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) {
      return {
        seed: { tmdbId: 0, title: '', genreIds: [], releaseDate: null },
        meta: {
          today: this.formatTodayInTimezone('America/Toronto'),
          timezone: 'America/Toronto',
          upcomingWindowEnd: this.formatDateInTimezone(
            addMonths(new Date(), 24),
            'America/Toronto',
          ),
        },
        released: [],
        upcoming: [],
        unknown: [],
      };
    }

    const tz = normalizeTimezone(params.timezone) ?? 'America/Toronto';
    const today = this.formatTodayInTimezone(tz);
    const upcomingWindowMonthsRaw = params.upcomingWindowMonths ?? 24;
    const upcomingWindowMonths = Number.isFinite(upcomingWindowMonthsRaw)
      ? Math.max(1, Math.min(60, Math.trunc(upcomingWindowMonthsRaw)))
      : 24;
    const upcomingWindowEnd = this.formatDateInTimezone(
      addMonths(new Date(), upcomingWindowMonths),
      tz,
    );
    const tomorrow = this.formatDateInTimezone(addDays(new Date(), 1), tz);

    const variants = buildTitleQueryVariants(seedTitle);
    let seedBest: TmdbMovieSearchResult | null = null;
    for (const q of variants.length ? variants : [seedTitle]) {
      const seedResults = await this.searchMovie({
        apiKey,
        query: q,
        year: params.seedYear ?? null,
        includeAdult: Boolean(params.includeAdult),
      });
      seedBest = bestSeedResult(q, seedResults, params.seedYear ?? null);
      if (seedBest) break;
    }
    if (!seedBest) {
      return {
        seed: { tmdbId: 0, title: seedTitle, genreIds: [], releaseDate: null },
        meta: { today, timezone: tz, upcomingWindowEnd },
        released: [],
        upcoming: [],
        unknown: [],
      };
    }

    const seedDetails = await this.getMovie({
      apiKey,
      tmdbId: seedBest.id,
    }).catch(() => null);
    const seedGenreIds = new Set(
      (seedDetails?.genres ?? [])
        .map((g) => {
          const id =
            typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
          return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
        .filter((n) => Number.isFinite(n) && n > 0),
    );

    const candidates = new Map<
      number,
      {
        tmdbId: number;
        title: string;
        releaseDate: string | null;
        voteAverage: number | null;
        voteCount: number | null;
        popularity: number | null;
        sources: Set<string>;
      }
    >();

    const addResults = (results: TmdbMovieSearchResult[], source: string) => {
      for (const m of results) {
        if (!m || !Number.isFinite(m.id) || m.id <= 0) continue;
        if (m.id === seedBest.id) continue;
        if (!m.title) continue;

        const tmdbId = Math.trunc(m.id);
        const title = m.title.trim();
        if (!title) continue;

        const releaseDate =
          typeof m.release_date === 'string' && m.release_date.trim()
            ? m.release_date.trim()
            : null;
        const voteAverage =
          typeof m.vote_average === 'number' && Number.isFinite(m.vote_average)
            ? Number(m.vote_average)
            : null;
        const voteCount =
          typeof m.vote_count === 'number' && Number.isFinite(m.vote_count)
            ? Math.max(0, Math.trunc(m.vote_count))
            : null;
        const popularity =
          typeof m.popularity === 'number' && Number.isFinite(m.popularity)
            ? Number(m.popularity)
            : null;

        const existing = candidates.get(tmdbId);
        if (!existing) {
          candidates.set(tmdbId, {
            tmdbId,
            title,
            releaseDate,
            voteAverage,
            voteCount,
            popularity,
            sources: new Set([source]),
          });
          continue;
        }

        existing.sources.add(source);
        // Merge metadata (prefer non-null, keep earliest-known title)
        if (!existing.title && title) existing.title = title;
        if (!existing.releaseDate && releaseDate)
          existing.releaseDate = releaseDate;
        if (existing.voteAverage === null && voteAverage !== null)
          existing.voteAverage = voteAverage;
        if (existing.voteCount === null && voteCount !== null)
          existing.voteCount = voteCount;
        if (existing.popularity === null && popularity !== null)
          existing.popularity = popularity;
      }
    };

    const includeAdult = Boolean(params.includeAdult);

    // --- Released pool: recommendations + similar + genre discover ---
    const recResults = await this.pagedResults({
      apiKey,
      url: new URL(
        `https://api.themoviedb.org/3/movie/${seedBest.id}/recommendations`,
      ),
      includeAdult,
      maxItems: 120,
      maxPages: 6,
    });
    addResults(recResults, 'recommendations');

    const simResults = await this.pagedResults({
      apiKey,
      url: new URL(`https://api.themoviedb.org/3/movie/${seedBest.id}/similar`),
      includeAdult,
      maxItems: 120,
      maxPages: 6,
    });
    addResults(simResults, 'similar');

    if (seedGenreIds.size) {
      const withGenres = Array.from(seedGenreIds).slice(0, 4).join(',');

      const releasedDiscoverUrl = new URL(
        'https://api.themoviedb.org/3/discover/movie',
      );
      releasedDiscoverUrl.searchParams.set('with_genres', withGenres);
      releasedDiscoverUrl.searchParams.set('primary_release_date.lte', today);
      releasedDiscoverUrl.searchParams.set('vote_count.gte', '150');
      releasedDiscoverUrl.searchParams.set('sort_by', 'vote_average.desc');

      const discResults = await this.pagedResults({
        apiKey,
        url: releasedDiscoverUrl,
        includeAdult,
        maxItems: 200,
        maxPages: 10,
      });
      addResults(discResults, 'discover_released');
    }

    // --- Upcoming pool: future-window discover ---
    if (seedGenreIds.size) {
      const withGenres = Array.from(seedGenreIds).slice(0, 4).join(',');

      const upcomingDiscoverUrl = new URL(
        'https://api.themoviedb.org/3/discover/movie',
      );
      upcomingDiscoverUrl.searchParams.set('with_genres', withGenres);
      upcomingDiscoverUrl.searchParams.set(
        'primary_release_date.gte',
        tomorrow,
      );
      upcomingDiscoverUrl.searchParams.set(
        'primary_release_date.lte',
        upcomingWindowEnd,
      );
      upcomingDiscoverUrl.searchParams.set('sort_by', 'popularity.desc');

      const upcomingResults = await this.pagedResults({
        apiKey,
        url: upcomingDiscoverUrl,
        includeAdult,
        maxItems: 200,
        maxPages: 10,
      });
      addResults(upcomingResults, 'discover_upcoming');
    }

    const released: TmdbMovieCandidate[] = [];
    const upcoming: TmdbMovieCandidate[] = [];
    const unknown: TmdbMovieCandidate[] = [];

    for (const c of candidates.values()) {
      const bucket = classifyByReleaseDate(c.releaseDate, today);
      const item: TmdbMovieCandidate = {
        tmdbId: c.tmdbId,
        title: c.title,
        releaseDate: c.releaseDate,
        voteAverage: c.voteAverage,
        voteCount: c.voteCount,
        popularity: c.popularity,
        sources: Array.from(c.sources),
      };
      if (bucket === 'released') released.push(item);
      else if (bucket === 'upcoming') upcoming.push(item);
      else unknown.push(item);
    }

    released.sort((a, b) => {
      const av = a.voteAverage ?? 0;
      const bv = b.voteAverage ?? 0;
      if (bv !== av) return bv - av;
      const ac = a.voteCount ?? 0;
      const bc = b.voteCount ?? 0;
      if (bc !== ac) return bc - ac;
      const ap = a.popularity ?? 0;
      const bp = b.popularity ?? 0;
      if (bp !== ap) return bp - ap;
      return a.tmdbId - b.tmdbId;
    });
    upcoming.sort((a, b) => {
      const ap = a.popularity ?? 0;
      const bp = b.popularity ?? 0;
      if (bp !== ap) return bp - ap;
      const ar = a.releaseDate ?? '';
      const br = b.releaseDate ?? '';
      if (ar && br && ar !== br) return ar.localeCompare(br);
      return a.tmdbId - b.tmdbId;
    });

    return {
      seed: {
        tmdbId: seedBest.id,
        title: seedDetails?.title ?? seedBest.title ?? seedTitle,
        genreIds: Array.from(seedGenreIds),
        releaseDate: seedDetails?.release_date ?? seedBest.release_date ?? null,
      },
      meta: { today, timezone: tz, upcomingWindowEnd },
      released,
      upcoming,
      unknown,
    };
  }

  async getSplitContrastRecommendationCandidatePools(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
    includeAdult?: boolean;
    timezone?: string | null;
    upcomingWindowMonths?: number;
  }): Promise<{
    seed: {
      tmdbId: number;
      title: string;
      genreIds: number[];
      releaseDate: string | null;
    };
    meta: { today: string; timezone: string; upcomingWindowEnd: string };
    released: TmdbMovieCandidate[];
    upcoming: TmdbMovieCandidate[];
    unknown: TmdbMovieCandidate[];
  }> {
    const apiKey = params.apiKey.trim();
    const seedTitle = params.seedTitle.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) {
      return {
        seed: { tmdbId: 0, title: '', genreIds: [], releaseDate: null },
        meta: {
          today: this.formatTodayInTimezone('America/Toronto'),
          timezone: 'America/Toronto',
          upcomingWindowEnd: this.formatDateInTimezone(
            addMonths(new Date(), 24),
            'America/Toronto',
          ),
        },
        released: [],
        upcoming: [],
        unknown: [],
      };
    }

    const tz = normalizeTimezone(params.timezone) ?? 'America/Toronto';
    const today = this.formatTodayInTimezone(tz);
    const upcomingWindowMonthsRaw = params.upcomingWindowMonths ?? 24;
    const upcomingWindowMonths = Number.isFinite(upcomingWindowMonthsRaw)
      ? Math.max(1, Math.min(60, Math.trunc(upcomingWindowMonthsRaw)))
      : 24;
    const upcomingWindowEnd = this.formatDateInTimezone(
      addMonths(new Date(), upcomingWindowMonths),
      tz,
    );
    const tomorrow = this.formatDateInTimezone(addDays(new Date(), 1), tz);

    const variants = buildTitleQueryVariants(seedTitle);
    let seedBest: TmdbMovieSearchResult | null = null;
    for (const q of variants.length ? variants : [seedTitle]) {
      const seedResults = await this.searchMovie({
        apiKey,
        query: q,
        year: params.seedYear ?? null,
        includeAdult: Boolean(params.includeAdult),
      });
      seedBest = bestSeedResult(q, seedResults, params.seedYear ?? null);
      if (seedBest) break;
    }
    if (!seedBest) {
      return {
        seed: { tmdbId: 0, title: seedTitle, genreIds: [], releaseDate: null },
        meta: { today, timezone: tz, upcomingWindowEnd },
        released: [],
        upcoming: [],
        unknown: [],
      };
    }

    const seedDetails = await this.getMovie({
      apiKey,
      tmdbId: seedBest.id,
    }).catch(() => null);
    const seedGenreIds = new Set(
      (seedDetails?.genres ?? [])
        .map((g) => {
          const id =
            typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
          return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
        .filter((n) => Number.isFinite(n) && n > 0),
    );

    const candidates = new Map<
      number,
      {
        tmdbId: number;
        title: string;
        releaseDate: string | null;
        voteAverage: number | null;
        voteCount: number | null;
        popularity: number | null;
        sources: Set<string>;
      }
    >();

    const addResults = (results: TmdbMovieSearchResult[], source: string) => {
      for (const m of results) {
        if (!m || !Number.isFinite(m.id) || m.id <= 0) continue;
        if (m.id === seedBest.id) continue;
        if (!m.title) continue;

        const tmdbId = Math.trunc(m.id);
        const title = m.title.trim();
        if (!title) continue;

        const releaseDate =
          typeof m.release_date === 'string' && m.release_date.trim()
            ? m.release_date.trim()
            : null;
        const voteAverage =
          typeof m.vote_average === 'number' && Number.isFinite(m.vote_average)
            ? Number(m.vote_average)
            : null;
        const voteCount =
          typeof m.vote_count === 'number' && Number.isFinite(m.vote_count)
            ? Math.max(0, Math.trunc(m.vote_count))
            : null;
        const popularity =
          typeof m.popularity === 'number' && Number.isFinite(m.popularity)
            ? Number(m.popularity)
            : null;

        const existing = candidates.get(tmdbId);
        if (!existing) {
          candidates.set(tmdbId, {
            tmdbId,
            title,
            releaseDate,
            voteAverage,
            voteCount,
            popularity,
            sources: new Set([source]),
          });
          continue;
        }

        existing.sources.add(source);
        if (!existing.title && title) existing.title = title;
        if (!existing.releaseDate && releaseDate)
          existing.releaseDate = releaseDate;
        if (existing.voteAverage === null && voteAverage !== null)
          existing.voteAverage = voteAverage;
        if (existing.voteCount === null && voteCount !== null)
          existing.voteCount = voteCount;
        if (existing.popularity === null && popularity !== null)
          existing.popularity = popularity;
      }
    };

    const includeAdult = Boolean(params.includeAdult);

    // --- Released pool: discover excluding the seed genres ---
    const releasedDiscoverUrl = new URL(
      'https://api.themoviedb.org/3/discover/movie',
    );
    if (seedGenreIds.size) {
      releasedDiscoverUrl.searchParams.set(
        'without_genres',
        Array.from(seedGenreIds).slice(0, 5).join(','),
      );
    }
    releasedDiscoverUrl.searchParams.set('primary_release_date.lte', today);
    releasedDiscoverUrl.searchParams.set('vote_count.gte', '150');
    releasedDiscoverUrl.searchParams.set('sort_by', 'vote_average.desc');

    const discResults = await this.pagedResults({
      apiKey,
      url: releasedDiscoverUrl,
      includeAdult,
      maxItems: 300,
      maxPages: 10,
    });
    addResults(discResults, 'discover_released');

    // --- Upcoming pool: future-window discover excluding the seed genres ---
    const upcomingDiscoverUrl = new URL(
      'https://api.themoviedb.org/3/discover/movie',
    );
    if (seedGenreIds.size) {
      upcomingDiscoverUrl.searchParams.set(
        'without_genres',
        Array.from(seedGenreIds).slice(0, 5).join(','),
      );
    }
    upcomingDiscoverUrl.searchParams.set('primary_release_date.gte', tomorrow);
    upcomingDiscoverUrl.searchParams.set(
      'primary_release_date.lte',
      upcomingWindowEnd,
    );
    upcomingDiscoverUrl.searchParams.set('sort_by', 'popularity.desc');

    const upcomingResults = await this.pagedResults({
      apiKey,
      url: upcomingDiscoverUrl,
      includeAdult,
      maxItems: 300,
      maxPages: 10,
    });
    addResults(upcomingResults, 'discover_upcoming');

    const released: TmdbMovieCandidate[] = [];
    const upcoming: TmdbMovieCandidate[] = [];
    const unknown: TmdbMovieCandidate[] = [];

    for (const c of candidates.values()) {
      const bucket = classifyByReleaseDate(c.releaseDate, today);
      const item: TmdbMovieCandidate = {
        tmdbId: c.tmdbId,
        title: c.title,
        releaseDate: c.releaseDate,
        voteAverage: c.voteAverage,
        voteCount: c.voteCount,
        popularity: c.popularity,
        sources: Array.from(c.sources),
      };
      if (bucket === 'released') released.push(item);
      else if (bucket === 'upcoming') upcoming.push(item);
      else unknown.push(item);
    }

    released.sort((a, b) => {
      const av = a.voteAverage ?? 0;
      const bv = b.voteAverage ?? 0;
      if (bv !== av) return bv - av;
      const ac = a.voteCount ?? 0;
      const bc = b.voteCount ?? 0;
      if (bc !== ac) return bc - ac;
      const ap = a.popularity ?? 0;
      const bp = b.popularity ?? 0;
      if (bp !== ap) return bp - ap;
      return a.tmdbId - b.tmdbId;
    });
    upcoming.sort((a, b) => {
      const ap = a.popularity ?? 0;
      const bp = b.popularity ?? 0;
      if (bp !== ap) return bp - ap;
      const ar = a.releaseDate ?? '';
      const br = b.releaseDate ?? '';
      if (ar && br && ar !== br) return ar.localeCompare(br);
      return a.tmdbId - b.tmdbId;
    });

    return {
      seed: {
        tmdbId: seedBest.id,
        title: seedDetails?.title ?? seedBest.title ?? seedTitle,
        genreIds: Array.from(seedGenreIds),
        releaseDate: seedDetails?.release_date ?? seedBest.release_date ?? null,
      },
      meta: { today, timezone: tz, upcomingWindowEnd },
      released,
      upcoming,
      unknown,
    };
  }

  async getSplitTvRecommendationCandidatePools(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
    includeAdult?: boolean;
    timezone?: string | null;
    upcomingWindowMonths?: number;
  }): Promise<{
    seed: {
      tmdbId: number;
      title: string;
      genreIds: number[];
      releaseDate: string | null;
    };
    meta: { today: string; timezone: string; upcomingWindowEnd: string };
    released: TmdbTvCandidate[];
    upcoming: TmdbTvCandidate[];
    unknown: TmdbTvCandidate[];
  }> {
    const apiKey = params.apiKey.trim();
    const seedTitle = params.seedTitle.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) {
      return {
        seed: { tmdbId: 0, title: '', genreIds: [], releaseDate: null },
        meta: {
          today: this.formatTodayInTimezone('America/Toronto'),
          timezone: 'America/Toronto',
          upcomingWindowEnd: this.formatDateInTimezone(
            addMonths(new Date(), 24),
            'America/Toronto',
          ),
        },
        released: [],
        upcoming: [],
        unknown: [],
      };
    }

    const tz = normalizeTimezone(params.timezone) ?? 'America/Toronto';
    const today = this.formatTodayInTimezone(tz);
    const upcomingWindowMonthsRaw = params.upcomingWindowMonths ?? 24;
    const upcomingWindowMonths = Number.isFinite(upcomingWindowMonthsRaw)
      ? Math.max(1, Math.min(60, Math.trunc(upcomingWindowMonthsRaw)))
      : 24;
    const upcomingWindowEnd = this.formatDateInTimezone(
      addMonths(new Date(), upcomingWindowMonths),
      tz,
    );
    const tomorrow = this.formatDateInTimezone(addDays(new Date(), 1), tz);

    const variants = buildTitleQueryVariants(seedTitle);
    let seedBest: TmdbTvSearchResult | null = null;
    for (const q of variants.length ? variants : [seedTitle]) {
      const seedResults = await this.searchTv({
        apiKey,
        query: q,
        firstAirDateYear: params.seedYear ?? null,
        includeAdult: Boolean(params.includeAdult),
      });
      seedBest = bestSeedTvResult(q, seedResults, params.seedYear ?? null);
      if (seedBest) break;
    }
    if (!seedBest) {
      return {
        seed: { tmdbId: 0, title: seedTitle, genreIds: [], releaseDate: null },
        meta: { today, timezone: tz, upcomingWindowEnd },
        released: [],
        upcoming: [],
        unknown: [],
      };
    }

    const seedDetails = await this.getTv({
      apiKey,
      tmdbId: seedBest.id,
    }).catch(() => null);
    const seedGenreIds = new Set(
      (seedDetails?.genres ?? [])
        .map((g) => {
          const id =
            typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
          return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
        .filter((n) => Number.isFinite(n) && n > 0),
    );

    const candidates = new Map<
      number,
      {
        tmdbId: number;
        title: string;
        releaseDate: string | null;
        voteAverage: number | null;
        voteCount: number | null;
        popularity: number | null;
        sources: Set<string>;
      }
    >();

    const addResults = (results: TmdbTvSearchResult[], source: string) => {
      for (const s of results) {
        if (!s || !Number.isFinite(s.id) || s.id <= 0) continue;
        if (s.id === seedBest.id) continue;
        if (!s.name) continue;

        const tmdbId = Math.trunc(s.id);
        const title = s.name.trim();
        if (!title) continue;

        const releaseDate =
          typeof s.first_air_date === 'string' && s.first_air_date.trim()
            ? s.first_air_date.trim()
            : null;
        const voteAverage =
          typeof s.vote_average === 'number' && Number.isFinite(s.vote_average)
            ? Number(s.vote_average)
            : null;
        const voteCount =
          typeof s.vote_count === 'number' && Number.isFinite(s.vote_count)
            ? Math.max(0, Math.trunc(s.vote_count))
            : null;
        const popularity =
          typeof s.popularity === 'number' && Number.isFinite(s.popularity)
            ? Number(s.popularity)
            : null;

        const existing = candidates.get(tmdbId);
        if (!existing) {
          candidates.set(tmdbId, {
            tmdbId,
            title,
            releaseDate,
            voteAverage,
            voteCount,
            popularity,
            sources: new Set([source]),
          });
          continue;
        }

        existing.sources.add(source);
        if (!existing.title && title) existing.title = title;
        if (!existing.releaseDate && releaseDate)
          existing.releaseDate = releaseDate;
        if (existing.voteAverage === null && voteAverage !== null)
          existing.voteAverage = voteAverage;
        if (existing.voteCount === null && voteCount !== null)
          existing.voteCount = voteCount;
        if (existing.popularity === null && popularity !== null)
          existing.popularity = popularity;
      }
    };

    const includeAdult = Boolean(params.includeAdult);

    // --- Released pool: recommendations + similar + genre discover ---
    const recResults = await this.pagedTvResults({
      apiKey,
      url: new URL(
        `https://api.themoviedb.org/3/tv/${seedBest.id}/recommendations`,
      ),
      includeAdult,
      maxItems: 120,
      maxPages: 6,
    });
    addResults(recResults, 'recommendations');

    const simResults = await this.pagedTvResults({
      apiKey,
      url: new URL(`https://api.themoviedb.org/3/tv/${seedBest.id}/similar`),
      includeAdult,
      maxItems: 120,
      maxPages: 6,
    });
    addResults(simResults, 'similar');

    if (seedGenreIds.size) {
      const withGenres = Array.from(seedGenreIds).slice(0, 4).join(',');

      const releasedDiscoverUrl = new URL(
        'https://api.themoviedb.org/3/discover/tv',
      );
      releasedDiscoverUrl.searchParams.set('with_genres', withGenres);
      releasedDiscoverUrl.searchParams.set('first_air_date.lte', today);
      releasedDiscoverUrl.searchParams.set('vote_count.gte', '150');
      releasedDiscoverUrl.searchParams.set('sort_by', 'vote_average.desc');

      const discResults = await this.pagedTvResults({
        apiKey,
        url: releasedDiscoverUrl,
        includeAdult,
        maxItems: 200,
        maxPages: 10,
      });
      addResults(discResults, 'discover_released');
    }

    // --- Upcoming pool: future-window discover ---
    if (seedGenreIds.size) {
      const withGenres = Array.from(seedGenreIds).slice(0, 4).join(',');

      const upcomingDiscoverUrl = new URL(
        'https://api.themoviedb.org/3/discover/tv',
      );
      upcomingDiscoverUrl.searchParams.set('with_genres', withGenres);
      upcomingDiscoverUrl.searchParams.set('first_air_date.gte', tomorrow);
      upcomingDiscoverUrl.searchParams.set(
        'first_air_date.lte',
        upcomingWindowEnd,
      );
      upcomingDiscoverUrl.searchParams.set('sort_by', 'popularity.desc');

      const upcomingResults = await this.pagedTvResults({
        apiKey,
        url: upcomingDiscoverUrl,
        includeAdult,
        maxItems: 200,
        maxPages: 10,
      });
      addResults(upcomingResults, 'discover_upcoming');
    }

    const released: TmdbTvCandidate[] = [];
    const upcoming: TmdbTvCandidate[] = [];
    const unknown: TmdbTvCandidate[] = [];

    for (const c of candidates.values()) {
      const bucket = classifyByReleaseDate(c.releaseDate, today);
      const item: TmdbTvCandidate = {
        tmdbId: c.tmdbId,
        title: c.title,
        releaseDate: c.releaseDate,
        voteAverage: c.voteAverage,
        voteCount: c.voteCount,
        popularity: c.popularity,
        sources: Array.from(c.sources),
      };
      if (bucket === 'released') released.push(item);
      else if (bucket === 'upcoming') upcoming.push(item);
      else unknown.push(item);
    }

    released.sort((a, b) => {
      const av = a.voteAverage ?? 0;
      const bv = b.voteAverage ?? 0;
      if (bv !== av) return bv - av;
      const ac = a.voteCount ?? 0;
      const bc = b.voteCount ?? 0;
      if (bc !== ac) return bc - ac;
      const ap = a.popularity ?? 0;
      const bp = b.popularity ?? 0;
      if (bp !== ap) return bp - ap;
      return a.tmdbId - b.tmdbId;
    });
    upcoming.sort((a, b) => {
      const ap = a.popularity ?? 0;
      const bp = b.popularity ?? 0;
      if (bp !== ap) return bp - ap;
      const ar = a.releaseDate ?? '';
      const br = b.releaseDate ?? '';
      if (ar && br && ar !== br) return ar.localeCompare(br);
      return a.tmdbId - b.tmdbId;
    });

    return {
      seed: {
        tmdbId: seedBest.id,
        title: seedDetails?.name ?? seedBest.name ?? seedTitle,
        genreIds: Array.from(seedGenreIds),
        releaseDate:
          seedDetails?.first_air_date ?? seedBest.first_air_date ?? null,
      },
      meta: { today, timezone: tz, upcomingWindowEnd },
      released,
      upcoming,
      unknown,
    };
  }

  async getSplitContrastTvRecommendationCandidatePools(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
    includeAdult?: boolean;
    timezone?: string | null;
    upcomingWindowMonths?: number;
  }): Promise<{
    seed: {
      tmdbId: number;
      title: string;
      genreIds: number[];
      releaseDate: string | null;
    };
    meta: { today: string; timezone: string; upcomingWindowEnd: string };
    released: TmdbTvCandidate[];
    upcoming: TmdbTvCandidate[];
    unknown: TmdbTvCandidate[];
  }> {
    const apiKey = params.apiKey.trim();
    const seedTitle = params.seedTitle.trim();
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) {
      return {
        seed: { tmdbId: 0, title: '', genreIds: [], releaseDate: null },
        meta: {
          today: this.formatTodayInTimezone('America/Toronto'),
          timezone: 'America/Toronto',
          upcomingWindowEnd: this.formatDateInTimezone(
            addMonths(new Date(), 24),
            'America/Toronto',
          ),
        },
        released: [],
        upcoming: [],
        unknown: [],
      };
    }

    const tz = normalizeTimezone(params.timezone) ?? 'America/Toronto';
    const today = this.formatTodayInTimezone(tz);
    const upcomingWindowMonthsRaw = params.upcomingWindowMonths ?? 24;
    const upcomingWindowMonths = Number.isFinite(upcomingWindowMonthsRaw)
      ? Math.max(1, Math.min(60, Math.trunc(upcomingWindowMonthsRaw)))
      : 24;
    const upcomingWindowEnd = this.formatDateInTimezone(
      addMonths(new Date(), upcomingWindowMonths),
      tz,
    );
    const tomorrow = this.formatDateInTimezone(addDays(new Date(), 1), tz);

    const variants = buildTitleQueryVariants(seedTitle);
    let seedBest: TmdbTvSearchResult | null = null;
    for (const q of variants.length ? variants : [seedTitle]) {
      const seedResults = await this.searchTv({
        apiKey,
        query: q,
        firstAirDateYear: params.seedYear ?? null,
        includeAdult: Boolean(params.includeAdult),
      });
      seedBest = bestSeedTvResult(q, seedResults, params.seedYear ?? null);
      if (seedBest) break;
    }
    if (!seedBest) {
      return {
        seed: { tmdbId: 0, title: seedTitle, genreIds: [], releaseDate: null },
        meta: { today, timezone: tz, upcomingWindowEnd },
        released: [],
        upcoming: [],
        unknown: [],
      };
    }

    const seedDetails = await this.getTv({
      apiKey,
      tmdbId: seedBest.id,
    }).catch(() => null);
    const seedGenreIds = new Set(
      (seedDetails?.genres ?? [])
        .map((g) => {
          const id =
            typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
          return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
        .filter((n) => Number.isFinite(n) && n > 0),
    );

    const candidates = new Map<
      number,
      {
        tmdbId: number;
        title: string;
        releaseDate: string | null;
        voteAverage: number | null;
        voteCount: number | null;
        popularity: number | null;
        sources: Set<string>;
      }
    >();

    const addResults = (results: TmdbTvSearchResult[], source: string) => {
      for (const s of results) {
        if (!s || !Number.isFinite(s.id) || s.id <= 0) continue;
        if (s.id === seedBest.id) continue;
        if (!s.name) continue;

        const tmdbId = Math.trunc(s.id);
        const title = s.name.trim();
        if (!title) continue;

        const releaseDate =
          typeof s.first_air_date === 'string' && s.first_air_date.trim()
            ? s.first_air_date.trim()
            : null;
        const voteAverage =
          typeof s.vote_average === 'number' && Number.isFinite(s.vote_average)
            ? Number(s.vote_average)
            : null;
        const voteCount =
          typeof s.vote_count === 'number' && Number.isFinite(s.vote_count)
            ? Math.max(0, Math.trunc(s.vote_count))
            : null;
        const popularity =
          typeof s.popularity === 'number' && Number.isFinite(s.popularity)
            ? Number(s.popularity)
            : null;

        const existing = candidates.get(tmdbId);
        if (!existing) {
          candidates.set(tmdbId, {
            tmdbId,
            title,
            releaseDate,
            voteAverage,
            voteCount,
            popularity,
            sources: new Set([source]),
          });
          continue;
        }

        existing.sources.add(source);
        if (!existing.title && title) existing.title = title;
        if (!existing.releaseDate && releaseDate)
          existing.releaseDate = releaseDate;
        if (existing.voteAverage === null && voteAverage !== null)
          existing.voteAverage = voteAverage;
        if (existing.voteCount === null && voteCount !== null)
          existing.voteCount = voteCount;
        if (existing.popularity === null && popularity !== null)
          existing.popularity = popularity;
      }
    };

    const includeAdult = Boolean(params.includeAdult);

    // --- Released pool: discover excluding the seed genres ---
    const releasedDiscoverUrl = new URL(
      'https://api.themoviedb.org/3/discover/tv',
    );
    if (seedGenreIds.size) {
      releasedDiscoverUrl.searchParams.set(
        'without_genres',
        Array.from(seedGenreIds).slice(0, 5).join(','),
      );
    }
    releasedDiscoverUrl.searchParams.set('first_air_date.lte', today);
    releasedDiscoverUrl.searchParams.set('vote_count.gte', '150');
    releasedDiscoverUrl.searchParams.set('sort_by', 'vote_average.desc');

    const discResults = await this.pagedTvResults({
      apiKey,
      url: releasedDiscoverUrl,
      includeAdult,
      maxItems: 300,
      maxPages: 10,
    });
    addResults(discResults, 'discover_released');

    // --- Upcoming pool: future-window discover excluding the seed genres ---
    const upcomingDiscoverUrl = new URL(
      'https://api.themoviedb.org/3/discover/tv',
    );
    if (seedGenreIds.size) {
      upcomingDiscoverUrl.searchParams.set(
        'without_genres',
        Array.from(seedGenreIds).slice(0, 5).join(','),
      );
    }
    upcomingDiscoverUrl.searchParams.set('first_air_date.gte', tomorrow);
    upcomingDiscoverUrl.searchParams.set(
      'first_air_date.lte',
      upcomingWindowEnd,
    );
    upcomingDiscoverUrl.searchParams.set('sort_by', 'popularity.desc');

    const upcomingResults = await this.pagedTvResults({
      apiKey,
      url: upcomingDiscoverUrl,
      includeAdult,
      maxItems: 300,
      maxPages: 10,
    });
    addResults(upcomingResults, 'discover_upcoming');

    const released: TmdbTvCandidate[] = [];
    const upcoming: TmdbTvCandidate[] = [];
    const unknown: TmdbTvCandidate[] = [];

    for (const c of candidates.values()) {
      const bucket = classifyByReleaseDate(c.releaseDate, today);
      const item: TmdbTvCandidate = {
        tmdbId: c.tmdbId,
        title: c.title,
        releaseDate: c.releaseDate,
        voteAverage: c.voteAverage,
        voteCount: c.voteCount,
        popularity: c.popularity,
        sources: Array.from(c.sources),
      };
      if (bucket === 'released') released.push(item);
      else if (bucket === 'upcoming') upcoming.push(item);
      else unknown.push(item);
    }

    released.sort((a, b) => {
      const av = a.voteAverage ?? 0;
      const bv = b.voteAverage ?? 0;
      if (bv !== av) return bv - av;
      const ac = a.voteCount ?? 0;
      const bc = b.voteCount ?? 0;
      if (bc !== ac) return bc - ac;
      const ap = a.popularity ?? 0;
      const bp = b.popularity ?? 0;
      if (bp !== ap) return bp - ap;
      return a.tmdbId - b.tmdbId;
    });
    upcoming.sort((a, b) => {
      const ap = a.popularity ?? 0;
      const bp = b.popularity ?? 0;
      if (bp !== ap) return bp - ap;
      const ar = a.releaseDate ?? '';
      const br = b.releaseDate ?? '';
      if (ar && br && ar !== br) return ar.localeCompare(br);
      return a.tmdbId - b.tmdbId;
    });

    return {
      seed: {
        tmdbId: seedBest.id,
        title: seedDetails?.name ?? seedBest.name ?? seedTitle,
        genreIds: Array.from(seedGenreIds),
        releaseDate:
          seedDetails?.first_air_date ?? seedBest.first_air_date ?? null,
      },
      meta: { today, timezone: tz, upcomingWindowEnd },
      released,
      upcoming,
      unknown,
    };
  }

  private async pagedResults(params: {
    apiKey: string;
    url: URL;
    includeAdult: boolean;
    maxItems: number;
    maxPages: number;
    startPage?: number;
  }): Promise<TmdbMovieSearchResult[]> {
    const out: TmdbMovieSearchResult[] = [];
    let page = Math.max(1, Math.trunc(params.startPage ?? 1));
    let pagesScanned = 0;

    while (out.length < params.maxItems && pagesScanned < params.maxPages) {
      const url = new URL(params.url.toString());
      url.searchParams.set('api_key', params.apiKey.trim());
      url.searchParams.set(
        'include_adult',
        String(Boolean(params.includeAdult)),
      );
      url.searchParams.set('page', String(page));

      const data = (await this.fetchTmdbJson(url, 20000)) as TmdbPagedResponse;
      const results = Array.isArray(data.results)
        ? (data.results as unknown[])
        : [];
      if (!results.length) break;

      for (const r of results) {
        if (!r || typeof r !== 'object') continue;
        const rec = r as Record<string, unknown>;
        const id =
          typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
        const title =
          typeof rec['title'] === 'string' ? rec['title'].trim() : '';
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!title) continue;

        out.push({
          id: Math.trunc(id),
          title,
          release_date:
            typeof rec['release_date'] === 'string'
              ? rec['release_date']
              : undefined,
          genre_ids: Array.isArray(rec['genre_ids'])
            ? (rec['genre_ids'] as unknown[])
                .map((x) => (typeof x === 'number' ? x : Number(x)))
                .filter((n) => Number.isFinite(n) && n > 0)
            : undefined,
          vote_count:
            typeof rec['vote_count'] === 'number'
              ? rec['vote_count']
              : Number(rec['vote_count']),
          vote_average:
            typeof rec['vote_average'] === 'number'
              ? rec['vote_average']
              : Number(rec['vote_average']),
          popularity:
            typeof rec['popularity'] === 'number'
              ? rec['popularity']
              : Number(rec['popularity']),
          original_language:
            typeof rec['original_language'] === 'string'
              ? rec['original_language'].trim()
              : undefined,
        });
        if (out.length >= params.maxItems) break;
      }

      const totalPagesRaw = data.total_pages;
      const totalPages =
        typeof totalPagesRaw === 'number'
          ? totalPagesRaw
          : Number(totalPagesRaw);
      if (Number.isFinite(totalPages) && page >= totalPages) break;
      pagesScanned += 1;
      page += 1;
    }

    return out.slice(0, params.maxItems);
  }

  private async pagedTvResults(params: {
    apiKey: string;
    url: URL;
    includeAdult: boolean;
    maxItems: number;
    maxPages: number;
  }): Promise<TmdbTvSearchResult[]> {
    const out: TmdbTvSearchResult[] = [];
    let page = 1;

    while (out.length < params.maxItems && page <= params.maxPages) {
      const url = new URL(params.url.toString());
      url.searchParams.set('api_key', params.apiKey.trim());
      url.searchParams.set(
        'include_adult',
        String(Boolean(params.includeAdult)),
      );
      url.searchParams.set('page', String(page));

      const data = (await this.fetchTmdbJson(url, 20000)) as TmdbPagedResponse;
      const results = Array.isArray(data.results)
        ? (data.results as unknown[])
        : [];
      if (!results.length) break;

      for (const r of results) {
        if (!r || typeof r !== 'object') continue;
        const rec = r as Record<string, unknown>;
        const id =
          typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
        const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!name) continue;

        out.push({
          id: Math.trunc(id),
          name,
          first_air_date:
            typeof rec['first_air_date'] === 'string'
              ? rec['first_air_date']
              : undefined,
          genre_ids: Array.isArray(rec['genre_ids'])
            ? (rec['genre_ids'] as unknown[])
                .map((x) => (typeof x === 'number' ? x : Number(x)))
                .filter((n) => Number.isFinite(n) && n > 0)
            : undefined,
          vote_count:
            typeof rec['vote_count'] === 'number'
              ? rec['vote_count']
              : Number(rec['vote_count']),
          vote_average:
            typeof rec['vote_average'] === 'number'
              ? rec['vote_average']
              : Number(rec['vote_average']),
          popularity:
            typeof rec['popularity'] === 'number'
              ? rec['popularity']
              : Number(rec['popularity']),
        });
        if (out.length >= params.maxItems) break;
      }

      const totalPagesRaw = data.total_pages;
      const totalPages =
        typeof totalPagesRaw === 'number'
          ? totalPagesRaw
          : Number(totalPagesRaw);
      if (Number.isFinite(totalPages) && page >= totalPages) break;
      page += 1;
    }

    return out.slice(0, params.maxItems);
  }

  private async fetchTmdbJson(
    url: URL,
    timeoutMs: number,
    errorPrefix = 'TMDB request failed',
  ): Promise<unknown> {
    try {
      return await this.fetchTmdbJsonViaFetch(url, timeoutMs, errorPrefix);
    } catch (primaryError) {
      if (primaryError instanceof BadGatewayException) throw primaryError;
      if (!isTmdbConnectivityFailure(primaryError)) {
        throw new BadGatewayException(
          `${errorPrefix}: ${errorMessageWithCause(primaryError)}`,
        );
      }

      this.logger.warn(
        `TMDB connectivity failure on ${url.pathname}; retrying with IPv4 fallback`,
      );

      try {
        return await this.fetchTmdbJsonWithIpv4(url, timeoutMs, errorPrefix);
      } catch (fallbackError) {
        if (fallbackError instanceof BadGatewayException) throw fallbackError;
        throw new BadGatewayException(
          `${errorPrefix}: ${errorMessageWithCause(primaryError)} (ipv4 fallback failed: ${errorMessageWithCause(fallbackError)})`,
        );
      }
    }
  }

  private async fetchTmdbJsonViaFetch(
    url: URL,
    timeoutMs: number,
    errorPrefix: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `${errorPrefix}: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return (await res.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchTmdbJsonWithIpv4(
    url: URL,
    timeoutMs: number,
    errorPrefix: string,
  ): Promise<unknown> {
    const records = await lookup(url.hostname, { family: 4, all: true });
    const ipv4Addresses = Array.from(
      new Set(records.map((record) => record.address.trim()).filter(Boolean)),
    );
    if (!ipv4Addresses.length) {
      throw new Error(`No IPv4 records found for ${url.hostname}`);
    }

    let lastConnectivityError: unknown = null;
    for (const ipv4Address of ipv4Addresses) {
      try {
        return await this.fetchTmdbJsonFromIpv4Address(
          url,
          ipv4Address,
          timeoutMs,
          errorPrefix,
        );
      } catch (attemptError) {
        if (attemptError instanceof BadGatewayException) throw attemptError;
        lastConnectivityError = attemptError;
        if (!isTmdbConnectivityFailure(attemptError)) throw attemptError;
      }
    }

    if (lastConnectivityError instanceof Error) {
      throw lastConnectivityError;
    }
    throw new Error(`Unable to reach ${url.hostname} over IPv4 fallback`);
  }

  private async fetchTmdbJsonFromIpv4Address(
    url: URL,
    ipv4Address: string,
    timeoutMs: number,
    errorPrefix: string,
  ): Promise<unknown> {
    return await new Promise<unknown>((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: 'https:',
          hostname: ipv4Address,
          port: Number.parseInt(url.port || '443', 10),
          method: 'GET',
          path: `${url.pathname}${url.search}`,
          headers: {
            Accept: 'application/json',
            Host: url.host,
          },
          // Preserve SNI so TLS cert validation still targets the TMDB hostname.
          servername: url.hostname,
          family: 4,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer | string) => {
            chunks.push(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'),
            );
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(
                new BadGatewayException(
                  `${errorPrefix}: HTTP ${status} ${body}`.trim(),
                ),
              );
              return;
            }

            try {
              resolve(body ? (JSON.parse(body) as unknown) : {});
            } catch {
              reject(
                new BadGatewayException(
                  `${errorPrefix}: Invalid JSON response from TMDB`,
                ),
              );
            }
          });
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('TMDB IPv4 fallback request timed out'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  private formatTodayInTimezone(timezone: string): string {
    return this.formatDateInTimezone(new Date(), timezone);
  }

  private formatDateInTimezone(date: Date, timezone: string): string {
    const tz = normalizeTimezone(timezone) ?? 'UTC';
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = fmt.formatToParts(date);
      const y = parts.find((p) => p.type === 'year')?.value ?? '';
      const m = parts.find((p) => p.type === 'month')?.value ?? '';
      const d = parts.find((p) => p.type === 'day')?.value ?? '';
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // ignore
    }
    // Fallback: UTC YYYY-MM-DD
    return date.toISOString().slice(0, 10);
  }
}
