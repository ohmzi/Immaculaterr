"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var TmdbService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TmdbService = void 0;
const common_1 = require("@nestjs/common");
const title_normalize_1 = require("../lib/title-normalize");
let TmdbService = TmdbService_1 = class TmdbService {
    logger = new common_1.Logger(TmdbService_1.name);
    async testConnection(params) {
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
                throw new common_1.BadGatewayException(`TMDB test failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            const images = (data['images'] ?? null);
            const secureBaseUrl = images && typeof images['secure_base_url'] === 'string'
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
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`TMDB test failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async searchMovie(params) {
        const apiKey = params.apiKey.trim();
        const query = params.query.trim();
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!query)
            return [];
        const url = new URL('https://api.themoviedb.org/3/search/movie');
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('query', query);
        url.searchParams.set('include_adult', String(Boolean(params.includeAdult)));
        if (params.year && Number.isFinite(params.year)) {
            url.searchParams.set('year', String(Math.trunc(params.year)));
        }
        const data = (await this.fetchTmdbJson(url, 20000));
        const results = Array.isArray(data.results)
            ? data.results
            : [];
        const out = [];
        for (const r of results) {
            if (!r || typeof r !== 'object')
                continue;
            const rec = r;
            const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
            const title = typeof rec['title'] === 'string' ? rec['title'].trim() : '';
            if (!Number.isFinite(id) || id <= 0)
                continue;
            if (!title)
                continue;
            out.push({
                id: Math.trunc(id),
                title,
                release_date: typeof rec['release_date'] === 'string'
                    ? rec['release_date']
                    : undefined,
                genre_ids: Array.isArray(rec['genre_ids'])
                    ? rec['genre_ids']
                        .map((x) => (typeof x === 'number' ? x : Number(x)))
                        .filter((n) => Number.isFinite(n) && n > 0)
                    : undefined,
                vote_count: typeof rec['vote_count'] === 'number'
                    ? rec['vote_count']
                    : Number(rec['vote_count']),
                vote_average: typeof rec['vote_average'] === 'number'
                    ? rec['vote_average']
                    : Number(rec['vote_average']),
                popularity: typeof rec['popularity'] === 'number'
                    ? rec['popularity']
                    : Number(rec['popularity']),
            });
        }
        return out;
    }
    async searchTv(params) {
        const apiKey = params.apiKey.trim();
        const query = params.query.trim();
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!query)
            return [];
        const url = new URL('https://api.themoviedb.org/3/search/tv');
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('query', query);
        url.searchParams.set('include_adult', String(Boolean(params.includeAdult)));
        if (typeof params.firstAirDateYear === 'number' &&
            Number.isFinite(params.firstAirDateYear)) {
            url.searchParams.set('first_air_date_year', String(Math.trunc(params.firstAirDateYear)));
        }
        const data = (await this.fetchTmdbJson(url, 20000));
        const results = Array.isArray(data.results)
            ? data.results
            : [];
        const out = [];
        for (const r of results) {
            if (!r || typeof r !== 'object')
                continue;
            const rec = r;
            const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
            const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
            if (!Number.isFinite(id) || id <= 0)
                continue;
            if (!name)
                continue;
            out.push({
                id: Math.trunc(id),
                name,
                first_air_date: typeof rec['first_air_date'] === 'string'
                    ? rec['first_air_date']
                    : undefined,
                genre_ids: Array.isArray(rec['genre_ids'])
                    ? rec['genre_ids']
                        .map((x) => (typeof x === 'number' ? x : Number(x)))
                        .filter((n) => Number.isFinite(n) && n > 0)
                    : undefined,
                vote_count: typeof rec['vote_count'] === 'number'
                    ? rec['vote_count']
                    : Number(rec['vote_count']),
                vote_average: typeof rec['vote_average'] === 'number'
                    ? rec['vote_average']
                    : Number(rec['vote_average']),
                popularity: typeof rec['popularity'] === 'number'
                    ? rec['popularity']
                    : Number(rec['popularity']),
            });
        }
        return out;
    }
    async getMovie(params) {
        const apiKey = params.apiKey.trim();
        const tmdbId = Math.trunc(params.tmdbId);
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!Number.isFinite(tmdbId) || tmdbId <= 0)
            return null;
        const url = new URL(`https://api.themoviedb.org/3/movie/${tmdbId}`);
        url.searchParams.set('api_key', apiKey);
        const data = await this.fetchTmdbJson(url, 20000);
        if (!data || typeof data !== 'object')
            return null;
        const rec = data;
        const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
        if (!Number.isFinite(id) || id <= 0)
            return null;
        const voteAverageRaw = rec['vote_average'];
        const voteAverage = typeof voteAverageRaw === 'number'
            ? voteAverageRaw
            : typeof voteAverageRaw === 'string' && voteAverageRaw.trim()
                ? Number(voteAverageRaw)
                : NaN;
        const voteCountRaw = rec['vote_count'];
        const voteCount = typeof voteCountRaw === 'number'
            ? voteCountRaw
            : typeof voteCountRaw === 'string' && voteCountRaw.trim()
                ? Number(voteCountRaw)
                : NaN;
        return {
            id: Math.trunc(id),
            title: typeof rec['title'] === 'string' ? rec['title'] : undefined,
            release_date: typeof rec['release_date'] === 'string'
                ? rec['release_date']
                : undefined,
            overview: typeof rec['overview'] === 'string' ? rec['overview'] : undefined,
            poster_path: typeof rec['poster_path'] === 'string' ? rec['poster_path'] : undefined,
            genres: Array.isArray(rec['genres'])
                ? rec['genres']
                : undefined,
            vote_average: Number.isFinite(voteAverage) ? voteAverage : undefined,
            vote_count: Number.isFinite(voteCount)
                ? Math.max(0, Math.trunc(voteCount))
                : undefined,
        };
    }
    async getTv(params) {
        const apiKey = params.apiKey.trim();
        const tmdbId = Math.trunc(params.tmdbId);
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!Number.isFinite(tmdbId) || tmdbId <= 0)
            return null;
        const url = new URL(`https://api.themoviedb.org/3/tv/${tmdbId}`);
        url.searchParams.set('api_key', apiKey);
        if (params.appendExternalIds) {
            url.searchParams.set('append_to_response', 'external_ids');
        }
        const data = await this.fetchTmdbJson(url, 20000);
        if (!data || typeof data !== 'object')
            return null;
        const rec = data;
        const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
        if (!Number.isFinite(id) || id <= 0)
            return null;
        const voteAverageRaw = rec['vote_average'];
        const voteAverage = typeof voteAverageRaw === 'number'
            ? voteAverageRaw
            : typeof voteAverageRaw === 'string' && voteAverageRaw.trim()
                ? Number(voteAverageRaw)
                : NaN;
        const voteCountRaw = rec['vote_count'];
        const voteCount = typeof voteCountRaw === 'number'
            ? voteCountRaw
            : typeof voteCountRaw === 'string' && voteCountRaw.trim()
                ? Number(voteCountRaw)
                : NaN;
        const externalIdsRaw = rec['external_ids'];
        const external_ids = externalIdsRaw && typeof externalIdsRaw === 'object'
            ? {
                tvdb_id: typeof externalIdsRaw['tvdb_id'] ===
                    'number'
                    ? externalIdsRaw['tvdb_id']
                    : typeof externalIdsRaw['tvdb_id'] ===
                        'string'
                        ? Number(externalIdsRaw['tvdb_id'])
                        : null,
            }
            : undefined;
        return {
            id: Math.trunc(id),
            name: typeof rec['name'] === 'string' ? rec['name'] : undefined,
            first_air_date: typeof rec['first_air_date'] === 'string'
                ? rec['first_air_date']
                : undefined,
            overview: typeof rec['overview'] === 'string' ? rec['overview'] : undefined,
            poster_path: typeof rec['poster_path'] === 'string' ? rec['poster_path'] : undefined,
            genres: Array.isArray(rec['genres'])
                ? rec['genres']
                : undefined,
            vote_average: Number.isFinite(voteAverage) ? voteAverage : undefined,
            vote_count: Number.isFinite(voteCount)
                ? Math.max(0, Math.trunc(voteCount))
                : undefined,
            ...(external_ids ? { external_ids } : {}),
        };
    }
    async getTvExternalIds(params) {
        const apiKey = params.apiKey.trim();
        const tmdbId = Math.trunc(params.tmdbId);
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!Number.isFinite(tmdbId) || tmdbId <= 0)
            return null;
        const url = new URL(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids`);
        url.searchParams.set('api_key', apiKey);
        const data = await this.fetchTmdbJson(url, 20000);
        if (!data || typeof data !== 'object')
            return null;
        const rec = data;
        const tvdbRaw = rec['tvdb_id'];
        const tvdb = typeof tvdbRaw === 'number'
            ? tvdbRaw
            : typeof tvdbRaw === 'string' && tvdbRaw.trim()
                ? Number(tvdbRaw)
                : NaN;
        return { tvdb_id: Number.isFinite(tvdb) ? Math.trunc(tvdb) : null };
    }
    async getMovieVoteStats(params) {
        const details = await this.getMovie({
            apiKey: params.apiKey,
            tmdbId: params.tmdbId,
        });
        if (!details)
            return null;
        const vote_average = typeof details.vote_average === 'number' &&
            Number.isFinite(details.vote_average)
            ? Number(details.vote_average)
            : null;
        const vote_count = typeof details.vote_count === 'number' &&
            Number.isFinite(details.vote_count)
            ? Math.max(0, Math.trunc(details.vote_count))
            : null;
        return { vote_average, vote_count };
    }
    async getTvVoteStats(params) {
        const details = await this.getTv({
            apiKey: params.apiKey,
            tmdbId: params.tmdbId,
        });
        if (!details)
            return null;
        const vote_average = typeof details.vote_average === 'number' &&
            Number.isFinite(details.vote_average)
            ? Number(details.vote_average)
            : null;
        const vote_count = typeof details.vote_count === 'number' &&
            Number.isFinite(details.vote_count)
            ? Math.max(0, Math.trunc(details.vote_count))
            : null;
        return { vote_average, vote_count };
    }
    async getSeedMetadata(params) {
        const seedTitle = (0, title_normalize_1.normalizeTitleForMatching)(params.seedTitle.trim());
        const apiKey = params.apiKey.trim();
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle)
            return { seed_title: '' };
        try {
            const variants = (0, title_normalize_1.buildTitleQueryVariants)(seedTitle);
            let best = null;
            for (const q of variants.length ? variants : [seedTitle]) {
                const results = await this.searchMovie({
                    apiKey,
                    query: q,
                    year: params.seedYear ?? null,
                    includeAdult: false,
                });
                best = bestSeedResult(q, results, params.seedYear ?? null);
                if (best)
                    break;
            }
            if (!best)
                return { seed_title: seedTitle };
            const details = await this.getMovie({ apiKey, tmdbId: best.id }).catch(() => null);
            const genres = Array.isArray(details?.genres)
                ? details.genres
                    .map((g) => {
                    if (!g || typeof g !== 'object')
                        return null;
                    const name = typeof g.name === 'string' ? g.name.trim() : '';
                    return name || null;
                })
                    .filter((x) => Boolean(x))
                : [];
            return {
                seed_title: seedTitle,
                tmdb_id: best.id,
                title: details?.title ?? best.title ?? seedTitle,
                year: (details?.release_date ?? best.release_date ?? '').slice(0, 4),
                genres,
                overview: details?.overview ?? '',
            };
        }
        catch {
            return { seed_title: seedTitle };
        }
    }
    async getTvSeedMetadata(params) {
        const seedTitle = (0, title_normalize_1.normalizeTitleForMatching)(params.seedTitle.trim());
        const apiKey = params.apiKey.trim();
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle)
            return { seed_title: '' };
        try {
            const variants = (0, title_normalize_1.buildTitleQueryVariants)(seedTitle);
            let best = null;
            for (const q of variants.length ? variants : [seedTitle]) {
                const results = await this.searchTv({
                    apiKey,
                    query: q,
                    firstAirDateYear: params.seedYear ?? null,
                    includeAdult: false,
                });
                best = bestSeedTvResult(q, results, params.seedYear ?? null);
                if (best)
                    break;
            }
            if (!best)
                return { seed_title: seedTitle };
            const details = await this.getTv({
                apiKey,
                tmdbId: best.id,
            }).catch(() => null);
            const genres = Array.isArray(details?.genres)
                ? details.genres
                    .map((g) => {
                    if (!g || typeof g !== 'object')
                        return null;
                    const name = typeof g.name === 'string' ? g.name.trim() : '';
                    return name || null;
                })
                    .filter((x) => Boolean(x))
                : [];
            return {
                seed_title: seedTitle,
                tmdb_id: best.id,
                title: details?.name ?? best.name ?? seedTitle,
                year: (details?.first_air_date ?? best.first_air_date ?? '').slice(0, 4),
                genres,
                overview: details?.overview ?? '',
                media_type: 'tv',
            };
        }
        catch {
            return { seed_title: seedTitle, media_type: 'tv' };
        }
    }
    async discoverFallbackMovieCandidates(params) {
        const apiKey = params.apiKey.trim();
        const limit = Math.max(1, Math.min(500, Math.trunc(params.limit || 50)));
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
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
        const out = [];
        const seen = new Set();
        for (const r of results) {
            if (!r || !Number.isFinite(r.id) || r.id <= 0)
                continue;
            const tmdbId = Math.trunc(r.id);
            if (seen.has(tmdbId))
                continue;
            const title = (r.title ?? '').trim();
            if (!title)
                continue;
            seen.add(tmdbId);
            out.push({
                tmdbId,
                title,
                releaseDate: typeof r.release_date === 'string' && r.release_date.trim()
                    ? r.release_date.trim()
                    : null,
                voteAverage: typeof r.vote_average === 'number' && Number.isFinite(r.vote_average)
                    ? Number(r.vote_average)
                    : null,
                voteCount: typeof r.vote_count === 'number' && Number.isFinite(r.vote_count)
                    ? Math.max(0, Math.trunc(r.vote_count))
                    : null,
                popularity: typeof r.popularity === 'number' && Number.isFinite(r.popularity)
                    ? Number(r.popularity)
                    : null,
                sources: ['discover_fallback'],
            });
            if (out.length >= limit)
                break;
        }
        return out;
    }
    async discoverFallbackTvCandidates(params) {
        const apiKey = params.apiKey.trim();
        const limit = Math.max(1, Math.min(500, Math.trunc(params.limit || 50)));
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
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
        const out = [];
        const seen = new Set();
        for (const r of results) {
            if (!r || !Number.isFinite(r.id) || r.id <= 0)
                continue;
            const tmdbId = Math.trunc(r.id);
            if (seen.has(tmdbId))
                continue;
            const title = (r.name ?? '').trim();
            if (!title)
                continue;
            seen.add(tmdbId);
            out.push({
                tmdbId,
                title,
                releaseDate: typeof r.first_air_date === 'string' && r.first_air_date.trim()
                    ? r.first_air_date.trim()
                    : null,
                voteAverage: typeof r.vote_average === 'number' && Number.isFinite(r.vote_average)
                    ? Number(r.vote_average)
                    : null,
                voteCount: typeof r.vote_count === 'number' && Number.isFinite(r.vote_count)
                    ? Math.max(0, Math.trunc(r.vote_count))
                    : null,
                popularity: typeof r.popularity === 'number' && Number.isFinite(r.popularity)
                    ? Number(r.popularity)
                    : null,
                sources: ['discover_fallback'],
            });
            if (out.length >= limit)
                break;
        }
        return out;
    }
    async getAdvancedMovieRecommendations(params) {
        const apiKey = params.apiKey.trim();
        const seedTitle = (0, title_normalize_1.normalizeTitleForMatching)(params.seedTitle.trim());
        const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 25)));
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle)
            return [];
        const seedResults = await this.searchMovie({
            apiKey,
            query: seedTitle,
            year: params.seedYear ?? null,
            includeAdult: Boolean(params.includeAdult),
        });
        const seedBest = bestSeedResult(seedTitle, seedResults, params.seedYear ?? null);
        if (!seedBest)
            return [];
        const seedDetails = await this.getMovie({
            apiKey,
            tmdbId: seedBest.id,
        }).catch(() => null);
        const seedGenreIds = new Set((seedDetails?.genres ?? [])
            .map((g) => {
            const id = typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
            return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
            .filter((n) => Number.isFinite(n) && n > 0));
        const candidates = new Map();
        const seen = new Set([seedBest.id]);
        const addResults = (results, boost) => {
            for (const m of results) {
                if (!m || !Number.isFinite(m.id) || m.id <= 0)
                    continue;
                if (seen.has(m.id))
                    continue;
                if (!m.title)
                    continue;
                const voteCount = Number.isFinite(m.vote_count)
                    ? Number(m.vote_count)
                    : 0;
                if (voteCount < 100)
                    continue;
                const movieGenres = new Set(m.genre_ids ?? []);
                if (seedGenreIds.size && movieGenres.size) {
                    const overlaps = Array.from(movieGenres).some((g) => seedGenreIds.has(g));
                    if (!overlaps)
                        continue;
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
            url: new URL(`https://api.themoviedb.org/3/movie/${seedBest.id}/recommendations`),
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
        const ranked = Array.from(candidates.values()).sort((a, b) => b.score - a.score);
        return ranked.slice(0, limit).map((c) => c.title);
    }
    async getContrastMovieRecommendations(params) {
        const apiKey = params.apiKey.trim();
        const seedTitle = (0, title_normalize_1.normalizeTitleForMatching)(params.seedTitle.trim());
        const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 15)));
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle)
            return [];
        const seedResults = await this.searchMovie({
            apiKey,
            query: seedTitle,
            year: params.seedYear ?? null,
            includeAdult: false,
        });
        const seedBest = bestSeedResult(seedTitle, seedResults, params.seedYear ?? null);
        if (!seedBest)
            return [];
        const seedDetails = await this.getMovie({
            apiKey,
            tmdbId: seedBest.id,
        }).catch(() => null);
        const seedGenreIds = (seedDetails?.genres ?? [])
            .map((g) => {
            const id = typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
            return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
            .filter((n) => Number.isFinite(n) && n > 0);
        const url = new URL('https://api.themoviedb.org/3/discover/movie');
        if (seedGenreIds.length) {
            url.searchParams.set('without_genres', seedGenreIds.slice(0, 5).join(','));
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
        const out = [];
        const seen = new Set();
        for (const r of results) {
            const title = r.title?.trim();
            if (!title)
                continue;
            const key = title.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(title);
            if (out.length >= limit)
                break;
        }
        return out;
    }
    async getContrastTvRecommendations(params) {
        const apiKey = params.apiKey.trim();
        const seedTitle = (0, title_normalize_1.normalizeTitleForMatching)(params.seedTitle.trim());
        const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 15)));
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle)
            return [];
        const seedResults = await this.searchTv({
            apiKey,
            query: seedTitle,
            firstAirDateYear: params.seedYear ?? null,
            includeAdult: false,
        });
        const seedBest = bestSeedTvResult(seedTitle, seedResults, params.seedYear ?? null);
        if (!seedBest)
            return [];
        const seedDetails = await this.getTv({
            apiKey,
            tmdbId: seedBest.id,
        }).catch(() => null);
        const seedGenreIds = (seedDetails?.genres ?? [])
            .map((g) => {
            const id = typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
            return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
            .filter((n) => Number.isFinite(n) && n > 0);
        const today = this.formatTodayInTimezone('America/Toronto');
        const url = new URL('https://api.themoviedb.org/3/discover/tv');
        if (seedGenreIds.length) {
            url.searchParams.set('without_genres', seedGenreIds.slice(0, 5).join(','));
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
        const out = [];
        const seen = new Set();
        for (const r of results) {
            const title = r.name?.trim();
            if (!title)
                continue;
            const key = title.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(title);
            if (out.length >= limit)
                break;
        }
        return out;
    }
    async getSplitRecommendationCandidatePools(params) {
        const apiKey = params.apiKey.trim();
        const seedTitle = (0, title_normalize_1.normalizeTitleForMatching)(params.seedTitle.trim());
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle) {
            return {
                seed: { tmdbId: 0, title: '', genreIds: [], releaseDate: null },
                meta: {
                    today: this.formatTodayInTimezone('America/Toronto'),
                    timezone: 'America/Toronto',
                    upcomingWindowEnd: this.formatDateInTimezone(addMonths(new Date(), 24), 'America/Toronto'),
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
        const upcomingWindowEnd = this.formatDateInTimezone(addMonths(new Date(), upcomingWindowMonths), tz);
        const tomorrow = this.formatDateInTimezone(addDays(new Date(), 1), tz);
        const variants = (0, title_normalize_1.buildTitleQueryVariants)(seedTitle);
        let seedBest = null;
        for (const q of variants.length ? variants : [seedTitle]) {
            const seedResults = await this.searchMovie({
                apiKey,
                query: q,
                year: params.seedYear ?? null,
                includeAdult: Boolean(params.includeAdult),
            });
            seedBest = bestSeedResult(q, seedResults, params.seedYear ?? null);
            if (seedBest)
                break;
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
        const seedGenreIds = new Set((seedDetails?.genres ?? [])
            .map((g) => {
            const id = typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
            return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
            .filter((n) => Number.isFinite(n) && n > 0));
        const candidates = new Map();
        const addResults = (results, source) => {
            for (const m of results) {
                if (!m || !Number.isFinite(m.id) || m.id <= 0)
                    continue;
                if (m.id === seedBest.id)
                    continue;
                if (!m.title)
                    continue;
                const tmdbId = Math.trunc(m.id);
                const title = m.title.trim();
                if (!title)
                    continue;
                const releaseDate = typeof m.release_date === 'string' && m.release_date.trim()
                    ? m.release_date.trim()
                    : null;
                const voteAverage = typeof m.vote_average === 'number' && Number.isFinite(m.vote_average)
                    ? Number(m.vote_average)
                    : null;
                const voteCount = typeof m.vote_count === 'number' && Number.isFinite(m.vote_count)
                    ? Math.max(0, Math.trunc(m.vote_count))
                    : null;
                const popularity = typeof m.popularity === 'number' && Number.isFinite(m.popularity)
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
                if (!existing.title && title)
                    existing.title = title;
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
        const recResults = await this.pagedResults({
            apiKey,
            url: new URL(`https://api.themoviedb.org/3/movie/${seedBest.id}/recommendations`),
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
            const releasedDiscoverUrl = new URL('https://api.themoviedb.org/3/discover/movie');
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
        if (seedGenreIds.size) {
            const withGenres = Array.from(seedGenreIds).slice(0, 4).join(',');
            const upcomingDiscoverUrl = new URL('https://api.themoviedb.org/3/discover/movie');
            upcomingDiscoverUrl.searchParams.set('with_genres', withGenres);
            upcomingDiscoverUrl.searchParams.set('primary_release_date.gte', tomorrow);
            upcomingDiscoverUrl.searchParams.set('primary_release_date.lte', upcomingWindowEnd);
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
        const released = [];
        const upcoming = [];
        const unknown = [];
        for (const c of candidates.values()) {
            const bucket = classifyByReleaseDate(c.releaseDate, today);
            const item = {
                tmdbId: c.tmdbId,
                title: c.title,
                releaseDate: c.releaseDate,
                voteAverage: c.voteAverage,
                voteCount: c.voteCount,
                popularity: c.popularity,
                sources: Array.from(c.sources),
            };
            if (bucket === 'released')
                released.push(item);
            else if (bucket === 'upcoming')
                upcoming.push(item);
            else
                unknown.push(item);
        }
        released.sort((a, b) => {
            const av = a.voteAverage ?? 0;
            const bv = b.voteAverage ?? 0;
            if (bv !== av)
                return bv - av;
            const ac = a.voteCount ?? 0;
            const bc = b.voteCount ?? 0;
            if (bc !== ac)
                return bc - ac;
            const ap = a.popularity ?? 0;
            const bp = b.popularity ?? 0;
            if (bp !== ap)
                return bp - ap;
            return a.tmdbId - b.tmdbId;
        });
        upcoming.sort((a, b) => {
            const ap = a.popularity ?? 0;
            const bp = b.popularity ?? 0;
            if (bp !== ap)
                return bp - ap;
            const ar = a.releaseDate ?? '';
            const br = b.releaseDate ?? '';
            if (ar && br && ar !== br)
                return ar.localeCompare(br);
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
    async getSplitContrastRecommendationCandidatePools(params) {
        const apiKey = params.apiKey.trim();
        const seedTitle = params.seedTitle.trim();
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle) {
            return {
                seed: { tmdbId: 0, title: '', genreIds: [], releaseDate: null },
                meta: {
                    today: this.formatTodayInTimezone('America/Toronto'),
                    timezone: 'America/Toronto',
                    upcomingWindowEnd: this.formatDateInTimezone(addMonths(new Date(), 24), 'America/Toronto'),
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
        const upcomingWindowEnd = this.formatDateInTimezone(addMonths(new Date(), upcomingWindowMonths), tz);
        const tomorrow = this.formatDateInTimezone(addDays(new Date(), 1), tz);
        const variants = (0, title_normalize_1.buildTitleQueryVariants)(seedTitle);
        let seedBest = null;
        for (const q of variants.length ? variants : [seedTitle]) {
            const seedResults = await this.searchMovie({
                apiKey,
                query: q,
                year: params.seedYear ?? null,
                includeAdult: Boolean(params.includeAdult),
            });
            seedBest = bestSeedResult(q, seedResults, params.seedYear ?? null);
            if (seedBest)
                break;
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
        const seedGenreIds = new Set((seedDetails?.genres ?? [])
            .map((g) => {
            const id = typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
            return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
            .filter((n) => Number.isFinite(n) && n > 0));
        const candidates = new Map();
        const addResults = (results, source) => {
            for (const m of results) {
                if (!m || !Number.isFinite(m.id) || m.id <= 0)
                    continue;
                if (m.id === seedBest.id)
                    continue;
                if (!m.title)
                    continue;
                const tmdbId = Math.trunc(m.id);
                const title = m.title.trim();
                if (!title)
                    continue;
                const releaseDate = typeof m.release_date === 'string' && m.release_date.trim()
                    ? m.release_date.trim()
                    : null;
                const voteAverage = typeof m.vote_average === 'number' && Number.isFinite(m.vote_average)
                    ? Number(m.vote_average)
                    : null;
                const voteCount = typeof m.vote_count === 'number' && Number.isFinite(m.vote_count)
                    ? Math.max(0, Math.trunc(m.vote_count))
                    : null;
                const popularity = typeof m.popularity === 'number' && Number.isFinite(m.popularity)
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
                if (!existing.title && title)
                    existing.title = title;
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
        {
            const releasedDiscoverUrl = new URL('https://api.themoviedb.org/3/discover/movie');
            if (seedGenreIds.size) {
                releasedDiscoverUrl.searchParams.set('without_genres', Array.from(seedGenreIds).slice(0, 5).join(','));
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
        }
        {
            const upcomingDiscoverUrl = new URL('https://api.themoviedb.org/3/discover/movie');
            if (seedGenreIds.size) {
                upcomingDiscoverUrl.searchParams.set('without_genres', Array.from(seedGenreIds).slice(0, 5).join(','));
            }
            upcomingDiscoverUrl.searchParams.set('primary_release_date.gte', tomorrow);
            upcomingDiscoverUrl.searchParams.set('primary_release_date.lte', upcomingWindowEnd);
            upcomingDiscoverUrl.searchParams.set('sort_by', 'popularity.desc');
            const upcomingResults = await this.pagedResults({
                apiKey,
                url: upcomingDiscoverUrl,
                includeAdult,
                maxItems: 300,
                maxPages: 10,
            });
            addResults(upcomingResults, 'discover_upcoming');
        }
        const released = [];
        const upcoming = [];
        const unknown = [];
        for (const c of candidates.values()) {
            const bucket = classifyByReleaseDate(c.releaseDate, today);
            const item = {
                tmdbId: c.tmdbId,
                title: c.title,
                releaseDate: c.releaseDate,
                voteAverage: c.voteAverage,
                voteCount: c.voteCount,
                popularity: c.popularity,
                sources: Array.from(c.sources),
            };
            if (bucket === 'released')
                released.push(item);
            else if (bucket === 'upcoming')
                upcoming.push(item);
            else
                unknown.push(item);
        }
        released.sort((a, b) => {
            const av = a.voteAverage ?? 0;
            const bv = b.voteAverage ?? 0;
            if (bv !== av)
                return bv - av;
            const ac = a.voteCount ?? 0;
            const bc = b.voteCount ?? 0;
            if (bc !== ac)
                return bc - ac;
            const ap = a.popularity ?? 0;
            const bp = b.popularity ?? 0;
            if (bp !== ap)
                return bp - ap;
            return a.tmdbId - b.tmdbId;
        });
        upcoming.sort((a, b) => {
            const ap = a.popularity ?? 0;
            const bp = b.popularity ?? 0;
            if (bp !== ap)
                return bp - ap;
            const ar = a.releaseDate ?? '';
            const br = b.releaseDate ?? '';
            if (ar && br && ar !== br)
                return ar.localeCompare(br);
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
    async getSplitTvRecommendationCandidatePools(params) {
        const apiKey = params.apiKey.trim();
        const seedTitle = params.seedTitle.trim();
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle) {
            return {
                seed: { tmdbId: 0, title: '', genreIds: [], releaseDate: null },
                meta: {
                    today: this.formatTodayInTimezone('America/Toronto'),
                    timezone: 'America/Toronto',
                    upcomingWindowEnd: this.formatDateInTimezone(addMonths(new Date(), 24), 'America/Toronto'),
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
        const upcomingWindowEnd = this.formatDateInTimezone(addMonths(new Date(), upcomingWindowMonths), tz);
        const tomorrow = this.formatDateInTimezone(addDays(new Date(), 1), tz);
        const variants = (0, title_normalize_1.buildTitleQueryVariants)(seedTitle);
        let seedBest = null;
        for (const q of variants.length ? variants : [seedTitle]) {
            const seedResults = await this.searchTv({
                apiKey,
                query: q,
                firstAirDateYear: params.seedYear ?? null,
                includeAdult: Boolean(params.includeAdult),
            });
            seedBest = bestSeedTvResult(q, seedResults, params.seedYear ?? null);
            if (seedBest)
                break;
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
        const seedGenreIds = new Set((seedDetails?.genres ?? [])
            .map((g) => {
            const id = typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
            return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
            .filter((n) => Number.isFinite(n) && n > 0));
        const candidates = new Map();
        const addResults = (results, source) => {
            for (const s of results) {
                if (!s || !Number.isFinite(s.id) || s.id <= 0)
                    continue;
                if (s.id === seedBest.id)
                    continue;
                if (!s.name)
                    continue;
                const tmdbId = Math.trunc(s.id);
                const title = s.name.trim();
                if (!title)
                    continue;
                const releaseDate = typeof s.first_air_date === 'string' && s.first_air_date.trim()
                    ? s.first_air_date.trim()
                    : null;
                const voteAverage = typeof s.vote_average === 'number' && Number.isFinite(s.vote_average)
                    ? Number(s.vote_average)
                    : null;
                const voteCount = typeof s.vote_count === 'number' && Number.isFinite(s.vote_count)
                    ? Math.max(0, Math.trunc(s.vote_count))
                    : null;
                const popularity = typeof s.popularity === 'number' && Number.isFinite(s.popularity)
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
                if (!existing.title && title)
                    existing.title = title;
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
        const recResults = await this.pagedTvResults({
            apiKey,
            url: new URL(`https://api.themoviedb.org/3/tv/${seedBest.id}/recommendations`),
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
            const releasedDiscoverUrl = new URL('https://api.themoviedb.org/3/discover/tv');
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
        if (seedGenreIds.size) {
            const withGenres = Array.from(seedGenreIds).slice(0, 4).join(',');
            const upcomingDiscoverUrl = new URL('https://api.themoviedb.org/3/discover/tv');
            upcomingDiscoverUrl.searchParams.set('with_genres', withGenres);
            upcomingDiscoverUrl.searchParams.set('first_air_date.gte', tomorrow);
            upcomingDiscoverUrl.searchParams.set('first_air_date.lte', upcomingWindowEnd);
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
        const released = [];
        const upcoming = [];
        const unknown = [];
        for (const c of candidates.values()) {
            const bucket = classifyByReleaseDate(c.releaseDate, today);
            const item = {
                tmdbId: c.tmdbId,
                title: c.title,
                releaseDate: c.releaseDate,
                voteAverage: c.voteAverage,
                voteCount: c.voteCount,
                popularity: c.popularity,
                sources: Array.from(c.sources),
            };
            if (bucket === 'released')
                released.push(item);
            else if (bucket === 'upcoming')
                upcoming.push(item);
            else
                unknown.push(item);
        }
        released.sort((a, b) => {
            const av = a.voteAverage ?? 0;
            const bv = b.voteAverage ?? 0;
            if (bv !== av)
                return bv - av;
            const ac = a.voteCount ?? 0;
            const bc = b.voteCount ?? 0;
            if (bc !== ac)
                return bc - ac;
            const ap = a.popularity ?? 0;
            const bp = b.popularity ?? 0;
            if (bp !== ap)
                return bp - ap;
            return a.tmdbId - b.tmdbId;
        });
        upcoming.sort((a, b) => {
            const ap = a.popularity ?? 0;
            const bp = b.popularity ?? 0;
            if (bp !== ap)
                return bp - ap;
            const ar = a.releaseDate ?? '';
            const br = b.releaseDate ?? '';
            if (ar && br && ar !== br)
                return ar.localeCompare(br);
            return a.tmdbId - b.tmdbId;
        });
        return {
            seed: {
                tmdbId: seedBest.id,
                title: seedDetails?.name ?? seedBest.name ?? seedTitle,
                genreIds: Array.from(seedGenreIds),
                releaseDate: seedDetails?.first_air_date ?? seedBest.first_air_date ?? null,
            },
            meta: { today, timezone: tz, upcomingWindowEnd },
            released,
            upcoming,
            unknown,
        };
    }
    async getSplitContrastTvRecommendationCandidatePools(params) {
        const apiKey = params.apiKey.trim();
        const seedTitle = params.seedTitle.trim();
        if (!apiKey)
            throw new common_1.BadGatewayException('TMDB apiKey is required');
        if (!seedTitle) {
            return {
                seed: { tmdbId: 0, title: '', genreIds: [], releaseDate: null },
                meta: {
                    today: this.formatTodayInTimezone('America/Toronto'),
                    timezone: 'America/Toronto',
                    upcomingWindowEnd: this.formatDateInTimezone(addMonths(new Date(), 24), 'America/Toronto'),
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
        const upcomingWindowEnd = this.formatDateInTimezone(addMonths(new Date(), upcomingWindowMonths), tz);
        const tomorrow = this.formatDateInTimezone(addDays(new Date(), 1), tz);
        const variants = (0, title_normalize_1.buildTitleQueryVariants)(seedTitle);
        let seedBest = null;
        for (const q of variants.length ? variants : [seedTitle]) {
            const seedResults = await this.searchTv({
                apiKey,
                query: q,
                firstAirDateYear: params.seedYear ?? null,
                includeAdult: Boolean(params.includeAdult),
            });
            seedBest = bestSeedTvResult(q, seedResults, params.seedYear ?? null);
            if (seedBest)
                break;
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
        const seedGenreIds = new Set((seedDetails?.genres ?? [])
            .map((g) => {
            const id = typeof g?.id === 'number' ? g.id : g?.id ? Number(g.id) : NaN;
            return Number.isFinite(id) ? Math.trunc(id) : NaN;
        })
            .filter((n) => Number.isFinite(n) && n > 0));
        const candidates = new Map();
        const addResults = (results, source) => {
            for (const s of results) {
                if (!s || !Number.isFinite(s.id) || s.id <= 0)
                    continue;
                if (s.id === seedBest.id)
                    continue;
                if (!s.name)
                    continue;
                const tmdbId = Math.trunc(s.id);
                const title = s.name.trim();
                if (!title)
                    continue;
                const releaseDate = typeof s.first_air_date === 'string' && s.first_air_date.trim()
                    ? s.first_air_date.trim()
                    : null;
                const voteAverage = typeof s.vote_average === 'number' && Number.isFinite(s.vote_average)
                    ? Number(s.vote_average)
                    : null;
                const voteCount = typeof s.vote_count === 'number' && Number.isFinite(s.vote_count)
                    ? Math.max(0, Math.trunc(s.vote_count))
                    : null;
                const popularity = typeof s.popularity === 'number' && Number.isFinite(s.popularity)
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
                if (!existing.title && title)
                    existing.title = title;
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
        {
            const releasedDiscoverUrl = new URL('https://api.themoviedb.org/3/discover/tv');
            if (seedGenreIds.size) {
                releasedDiscoverUrl.searchParams.set('without_genres', Array.from(seedGenreIds).slice(0, 5).join(','));
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
        }
        {
            const upcomingDiscoverUrl = new URL('https://api.themoviedb.org/3/discover/tv');
            if (seedGenreIds.size) {
                upcomingDiscoverUrl.searchParams.set('without_genres', Array.from(seedGenreIds).slice(0, 5).join(','));
            }
            upcomingDiscoverUrl.searchParams.set('first_air_date.gte', tomorrow);
            upcomingDiscoverUrl.searchParams.set('first_air_date.lte', upcomingWindowEnd);
            upcomingDiscoverUrl.searchParams.set('sort_by', 'popularity.desc');
            const upcomingResults = await this.pagedTvResults({
                apiKey,
                url: upcomingDiscoverUrl,
                includeAdult,
                maxItems: 300,
                maxPages: 10,
            });
            addResults(upcomingResults, 'discover_upcoming');
        }
        const released = [];
        const upcoming = [];
        const unknown = [];
        for (const c of candidates.values()) {
            const bucket = classifyByReleaseDate(c.releaseDate, today);
            const item = {
                tmdbId: c.tmdbId,
                title: c.title,
                releaseDate: c.releaseDate,
                voteAverage: c.voteAverage,
                voteCount: c.voteCount,
                popularity: c.popularity,
                sources: Array.from(c.sources),
            };
            if (bucket === 'released')
                released.push(item);
            else if (bucket === 'upcoming')
                upcoming.push(item);
            else
                unknown.push(item);
        }
        released.sort((a, b) => {
            const av = a.voteAverage ?? 0;
            const bv = b.voteAverage ?? 0;
            if (bv !== av)
                return bv - av;
            const ac = a.voteCount ?? 0;
            const bc = b.voteCount ?? 0;
            if (bc !== ac)
                return bc - ac;
            const ap = a.popularity ?? 0;
            const bp = b.popularity ?? 0;
            if (bp !== ap)
                return bp - ap;
            return a.tmdbId - b.tmdbId;
        });
        upcoming.sort((a, b) => {
            const ap = a.popularity ?? 0;
            const bp = b.popularity ?? 0;
            if (bp !== ap)
                return bp - ap;
            const ar = a.releaseDate ?? '';
            const br = b.releaseDate ?? '';
            if (ar && br && ar !== br)
                return ar.localeCompare(br);
            return a.tmdbId - b.tmdbId;
        });
        return {
            seed: {
                tmdbId: seedBest.id,
                title: seedDetails?.name ?? seedBest.name ?? seedTitle,
                genreIds: Array.from(seedGenreIds),
                releaseDate: seedDetails?.first_air_date ?? seedBest.first_air_date ?? null,
            },
            meta: { today, timezone: tz, upcomingWindowEnd },
            released,
            upcoming,
            unknown,
        };
    }
    async pagedResults(params) {
        const out = [];
        let page = 1;
        while (out.length < params.maxItems && page <= params.maxPages) {
            const url = new URL(params.url.toString());
            url.searchParams.set('api_key', params.apiKey.trim());
            url.searchParams.set('include_adult', String(Boolean(params.includeAdult)));
            url.searchParams.set('page', String(page));
            const data = (await this.fetchTmdbJson(url, 20000));
            const results = Array.isArray(data.results)
                ? data.results
                : [];
            if (!results.length)
                break;
            for (const r of results) {
                if (!r || typeof r !== 'object')
                    continue;
                const rec = r;
                const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
                const title = typeof rec['title'] === 'string' ? rec['title'].trim() : '';
                if (!Number.isFinite(id) || id <= 0)
                    continue;
                if (!title)
                    continue;
                out.push({
                    id: Math.trunc(id),
                    title,
                    release_date: typeof rec['release_date'] === 'string'
                        ? rec['release_date']
                        : undefined,
                    genre_ids: Array.isArray(rec['genre_ids'])
                        ? rec['genre_ids']
                            .map((x) => (typeof x === 'number' ? x : Number(x)))
                            .filter((n) => Number.isFinite(n) && n > 0)
                        : undefined,
                    vote_count: typeof rec['vote_count'] === 'number'
                        ? rec['vote_count']
                        : Number(rec['vote_count']),
                    vote_average: typeof rec['vote_average'] === 'number'
                        ? rec['vote_average']
                        : Number(rec['vote_average']),
                    popularity: typeof rec['popularity'] === 'number'
                        ? rec['popularity']
                        : Number(rec['popularity']),
                });
                if (out.length >= params.maxItems)
                    break;
            }
            const totalPagesRaw = data.total_pages;
            const totalPages = typeof totalPagesRaw === 'number'
                ? totalPagesRaw
                : Number(totalPagesRaw);
            if (Number.isFinite(totalPages) && page >= totalPages)
                break;
            page += 1;
        }
        return out.slice(0, params.maxItems);
    }
    async pagedTvResults(params) {
        const out = [];
        let page = 1;
        while (out.length < params.maxItems && page <= params.maxPages) {
            const url = new URL(params.url.toString());
            url.searchParams.set('api_key', params.apiKey.trim());
            url.searchParams.set('include_adult', String(Boolean(params.includeAdult)));
            url.searchParams.set('page', String(page));
            const data = (await this.fetchTmdbJson(url, 20000));
            const results = Array.isArray(data.results)
                ? data.results
                : [];
            if (!results.length)
                break;
            for (const r of results) {
                if (!r || typeof r !== 'object')
                    continue;
                const rec = r;
                const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
                const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
                if (!Number.isFinite(id) || id <= 0)
                    continue;
                if (!name)
                    continue;
                out.push({
                    id: Math.trunc(id),
                    name,
                    first_air_date: typeof rec['first_air_date'] === 'string'
                        ? rec['first_air_date']
                        : undefined,
                    genre_ids: Array.isArray(rec['genre_ids'])
                        ? rec['genre_ids']
                            .map((x) => (typeof x === 'number' ? x : Number(x)))
                            .filter((n) => Number.isFinite(n) && n > 0)
                        : undefined,
                    vote_count: typeof rec['vote_count'] === 'number'
                        ? rec['vote_count']
                        : Number(rec['vote_count']),
                    vote_average: typeof rec['vote_average'] === 'number'
                        ? rec['vote_average']
                        : Number(rec['vote_average']),
                    popularity: typeof rec['popularity'] === 'number'
                        ? rec['popularity']
                        : Number(rec['popularity']),
                });
                if (out.length >= params.maxItems)
                    break;
            }
            const totalPagesRaw = data.total_pages;
            const totalPages = typeof totalPagesRaw === 'number'
                ? totalPagesRaw
                : Number(totalPagesRaw);
            if (Number.isFinite(totalPages) && page >= totalPages)
                break;
            page += 1;
        }
        return out.slice(0, params.maxItems);
    }
    async fetchTmdbJson(url, timeoutMs) {
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
                throw new common_1.BadGatewayException(`TMDB request failed: HTTP ${res.status} ${body}`.trim());
            }
            return (await res.json());
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            const cause = err?.cause;
            const causeMsg = cause instanceof Error
                ? cause.message
                : typeof cause === 'string'
                    ? cause
                    : cause
                        ? String(cause)
                        : '';
            throw new common_1.BadGatewayException(`TMDB request failed: ${err?.message ?? String(err)}${causeMsg ? ` (cause: ${causeMsg})` : ''}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    formatTodayInTimezone(timezone) {
        return this.formatDateInTimezone(new Date(), timezone);
    }
    formatDateInTimezone(date, timezone) {
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
            if (y && m && d)
                return `${y}-${m}-${d}`;
        }
        catch {
        }
        return date.toISOString().slice(0, 10);
    }
};
exports.TmdbService = TmdbService;
exports.TmdbService = TmdbService = TmdbService_1 = __decorate([
    (0, common_1.Injectable)()
], TmdbService);
function bestSeedResult(query, results, seedYear) {
    const q = query.trim().toLowerCase();
    if (!results.length)
        return null;
    const score = (r) => {
        const title = (r.title || '').trim().toLowerCase();
        const pop = Number.isFinite(r.popularity) ? Number(r.popularity) : 0;
        const votes = Number.isFinite(r.vote_count) ? Number(r.vote_count) : 0;
        const vavg = Number.isFinite(r.vote_average) ? Number(r.vote_average) : 0;
        const genreIds = new Set(r.genre_ids ?? []);
        const isDoc = genreIds.has(99);
        const docPenalty = isDoc && !q.includes('documentary') ? -1000 : 0;
        const starts = q && title.startsWith(q) ? 80 : 0;
        const contains = q && title.includes(q) ? 30 : 0;
        const franchiseBoost = q === 'harry potter' && title.startsWith('harry potter and the') ? 60 : 0;
        const yearBoost = (() => {
            const y = Math.trunc(seedYear ?? NaN);
            if (!Number.isFinite(y) || y <= 1800)
                return 0;
            const ry = typeof r.release_date === 'string' ? Number(r.release_date.slice(0, 4)) : NaN;
            if (!Number.isFinite(ry))
                return 0;
            const d = Math.abs(ry - y);
            if (d === 0)
                return 200;
            if (d === 1)
                return 50;
            if (d === 2)
                return 10;
            return 0;
        })();
        const engagement = votes * 0.05 + pop * 0.5 + vavg * 2.0;
        return docPenalty + starts + contains + franchiseBoost + yearBoost + engagement;
    };
    return results.reduce((best, cur) => (score(cur) > score(best) ? cur : best));
}
function bestSeedTvResult(query, results, seedYear) {
    const q = query.trim().toLowerCase();
    if (!results.length)
        return null;
    const score = (r) => {
        const title = (r.name || '').trim().toLowerCase();
        const pop = Number.isFinite(r.popularity) ? Number(r.popularity) : 0;
        const votes = Number.isFinite(r.vote_count) ? Number(r.vote_count) : 0;
        const vavg = Number.isFinite(r.vote_average) ? Number(r.vote_average) : 0;
        const genreIds = new Set(r.genre_ids ?? []);
        const isDoc = genreIds.has(99);
        const docPenalty = isDoc && !q.includes('documentary') ? -1000 : 0;
        const starts = q && title.startsWith(q) ? 80 : 0;
        const contains = q && title.includes(q) ? 30 : 0;
        const yearBoost = (() => {
            const y = Math.trunc(seedYear ?? NaN);
            if (!Number.isFinite(y) || y <= 1800)
                return 0;
            const ry = typeof r.first_air_date === 'string' ? Number(r.first_air_date.slice(0, 4)) : NaN;
            if (!Number.isFinite(ry))
                return 0;
            const d = Math.abs(ry - y);
            if (d === 0)
                return 200;
            if (d === 1)
                return 50;
            if (d === 2)
                return 10;
            return 0;
        })();
        const engagement = votes * 0.05 + pop * 0.5 + vavg * 2.0;
        return docPenalty + starts + contains + yearBoost + engagement;
    };
    return results.reduce((best, cur) => (score(cur) > score(best) ? cur : best));
}
function classifyByReleaseDate(releaseDate, today) {
    const d = (releaseDate ?? '').trim();
    if (!d)
        return 'unknown';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        return 'unknown';
    if (today && /^\d{4}-\d{2}-\d{2}$/.test(today) && d > today)
        return 'upcoming';
    return 'released';
}
function normalizeTimezone(raw) {
    if (typeof raw !== 'string')
        return null;
    const tz = raw.trim();
    if (!tz)
        return null;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return tz;
    }
    catch {
        return null;
    }
}
function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
}
function addMonths(date, months) {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
}
//# sourceMappingURL=tmdb.service.js.map