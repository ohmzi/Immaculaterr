import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type TmdbConfiguration = Record<string, unknown>;

type TmdbMovieSearchResult = {
  id: number;
  title: string;
  release_date?: string;
  genre_ids?: number[];
  vote_count?: number;
  vote_average?: number;
  popularity?: number;
};

type TmdbMovieDetails = {
  id: number;
  title?: string;
  release_date?: string;
  overview?: string;
  genres?: Array<{ id?: unknown; name?: unknown }>;
};

type TmdbPagedResponse = {
  results?: unknown;
  total_pages?: unknown;
};

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);

  async testConnection(params: { apiKey: string }) {
    const apiKey = params.apiKey.trim();

    this.logger.log('Testing TMDB connection');

    const url = new URL('https://api.themoviedb.org/3/configuration');
    url.searchParams.set('api_key', apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `TMDB test failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as TmdbConfiguration;

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
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `TMDB test failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
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
          typeof rec['release_date'] === 'string' ? rec['release_date'] : undefined,
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

    const data = (await this.fetchTmdbJson(url, 20000)) as unknown;
    if (!data || typeof data !== 'object') return null;
    const rec = data as Record<string, unknown>;
    const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
    if (!Number.isFinite(id) || id <= 0) return null;

    return {
      id: Math.trunc(id),
      title: typeof rec['title'] === 'string' ? rec['title'] : undefined,
      release_date:
        typeof rec['release_date'] === 'string' ? rec['release_date'] : undefined,
      overview: typeof rec['overview'] === 'string' ? rec['overview'] : undefined,
      genres: Array.isArray(rec['genres'])
        ? (rec['genres'] as Array<{ id?: unknown; name?: unknown }>)
        : undefined,
    };
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
      const results = await this.searchMovie({
        apiKey,
        query: seedTitle,
        year: params.seedYear ?? null,
        includeAdult: false,
      });
      const best = bestSeedResult(seedTitle, results);
      if (!best) return { seed_title: seedTitle };

      const details = await this.getMovie({ apiKey, tmdbId: best.id }).catch(
        () => null,
      );
      const genres = Array.isArray(details?.genres)
        ? details!.genres!
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

  async getAdvancedMovieRecommendations(params: {
    apiKey: string;
    seedTitle: string;
    seedYear?: number | null;
    limit: number;
    includeAdult?: boolean;
  }): Promise<string[]> {
    const apiKey = params.apiKey.trim();
    const seedTitle = params.seedTitle.trim();
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 25)));
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) return [];

    const seedResults = await this.searchMovie({
      apiKey,
      query: seedTitle,
      year: params.seedYear ?? null,
      includeAdult: Boolean(params.includeAdult),
    });
    const seedBest = bestSeedResult(seedTitle, seedResults);
    if (!seedBest) return [];

    const seedDetails = await this.getMovie({ apiKey, tmdbId: seedBest.id }).catch(
      () => null,
    );
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

    const addResults = (
      results: TmdbMovieSearchResult[],
      boost: number,
    ) => {
      for (const m of results) {
        if (!m || !Number.isFinite(m.id) || m.id <= 0) continue;
        if (seen.has(m.id)) continue;
        if (!m.title) continue;

        const voteCount = Number.isFinite(m.vote_count) ? Number(m.vote_count) : 0;
        if (voteCount < 100) continue;

        const movieGenres = new Set(m.genre_ids ?? []);
        if (seedGenreIds.size && movieGenres.size) {
          const overlaps = Array.from(movieGenres).some((g) => seedGenreIds.has(g));
          if (!overlaps) continue;
        }

        const voteAvg = Number.isFinite(m.vote_average) ? Number(m.vote_average) : 0;
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
    const seedTitle = params.seedTitle.trim();
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 15)));
    if (!apiKey) throw new BadGatewayException('TMDB apiKey is required');
    if (!seedTitle) return [];

    const seedResults = await this.searchMovie({
      apiKey,
      query: seedTitle,
      year: params.seedYear ?? null,
      includeAdult: false,
    });
    const seedBest = bestSeedResult(seedTitle, seedResults);
    if (!seedBest) return [];

    const seedDetails = await this.getMovie({ apiKey, tmdbId: seedBest.id }).catch(
      () => null,
    );
    const seedGenreIds = (seedDetails?.genres ?? [])
      .map((g) => {
        const id = typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
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

  private async pagedResults(params: {
    apiKey: string;
    url: URL;
    includeAdult: boolean;
    maxItems: number;
    maxPages: number;
  }): Promise<TmdbMovieSearchResult[]> {
    const out: TmdbMovieSearchResult[] = [];
    let page = 1;

    while (out.length < params.maxItems && page <= params.maxPages) {
      const url = new URL(params.url.toString());
      url.searchParams.set('api_key', params.apiKey.trim());
      url.searchParams.set('include_adult', String(Boolean(params.includeAdult)));
      url.searchParams.set('page', String(page));

      const data = (await this.fetchTmdbJson(url, 20000)) as TmdbPagedResponse;
      const results = Array.isArray(data.results)
        ? (data.results as unknown[])
        : [];
      if (!results.length) break;

      for (const r of results) {
        if (!r || typeof r !== 'object') continue;
        const rec = r as Record<string, unknown>;
        const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
        const title =
          typeof rec['title'] === 'string' ? rec['title'].trim() : '';
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!title) continue;

        out.push({
          id: Math.trunc(id),
          title,
          release_date:
            typeof rec['release_date'] === 'string' ? rec['release_date'] : undefined,
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

  private async fetchTmdbJson(url: URL, timeoutMs: number): Promise<unknown> {
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
          `TMDB request failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `TMDB request failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function bestSeedResult(
  query: string,
  results: TmdbMovieSearchResult[],
): TmdbMovieSearchResult | null {
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

    const engagement = votes * 0.05 + pop * 0.5 + vavg * 2.0;
    return docPenalty + starts + contains + franchiseBoost + engagement;
  };

  return results.reduce((best, cur) => (score(cur) > score(best) ? cur : best));
}
