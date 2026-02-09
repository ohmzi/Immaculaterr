"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CleanupAfterAddingNewContentJob = void 0;
const common_1 = require("@nestjs/common");
const settings_service_1 = require("../settings/settings.service");
const plex_server_service_1 = require("../plex/plex-server.service");
const plex_watchlist_service_1 = require("../plex/plex-watchlist.service");
const plex_duplicates_service_1 = require("../plex/plex-duplicates.service");
const radarr_service_1 = require("../radarr/radarr.service");
const sonarr_service_1 = require("../sonarr/sonarr.service");
const job_report_v1_1 = require("./job-report-v1");
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function pick(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const part of parts) {
        if (!isPlainObject(cur))
            return undefined;
        cur = cur[part];
    }
    return cur;
}
function pickString(obj, path) {
    const v = pick(obj, path);
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    return s ? s : null;
}
function pickNumber(obj, path) {
    const v = pick(obj, path);
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim()) {
        const n = Number.parseInt(v.trim(), 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function pickStringArray(obj, path) {
    const v = pick(obj, path);
    if (Array.isArray(v)) {
        return v
            .filter((x) => typeof x === 'string')
            .map((s) => s.trim())
            .filter(Boolean);
    }
    if (typeof v === 'string' && v.trim())
        return [v.trim()];
    return [];
}
function normalizeHttpUrl(raw) {
    const trimmed = raw.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
function normTitle(s) {
    return (s ?? '')
        .toLowerCase()
        .split('')
        .filter((ch) => /[a-z0-9]/.test(ch))
        .join('');
}
function diceCoefficient(a, b) {
    const s1 = normTitle(a);
    const s2 = normTitle(b);
    if (!s1 || !s2)
        return 0;
    if (s1 === s2)
        return 1;
    if (s1.length < 2 || s2.length < 2)
        return 0;
    const bigrams = (s) => {
        const map = new Map();
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
function toInt(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value !== 'string')
        return null;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}
function episodeKey(season, episode) {
    return `${season}:${episode}`;
}
function parseSeasonTitleFallback(title) {
    const raw = title.trim();
    if (!raw)
        return { seriesTitle: null, seasonNumber: null };
    if (!raw.includes(' - Season '))
        return { seriesTitle: null, seasonNumber: null };
    const [seriesTitleRaw, seasonPartRaw] = raw.split(' - Season ', 2);
    const seriesTitle = seriesTitleRaw.trim() || null;
    const match = seasonPartRaw.match(/(\d+)/);
    const seasonNumber = match ? Number.parseInt(match[1], 10) : null;
    return {
        seriesTitle,
        seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : null,
    };
}
function coerceDeletePreference(raw) {
    const v = (raw ?? '').trim();
    if (v === 'smallest_file')
        return 'smallest_file';
    if (v === 'largest_file')
        return 'largest_file';
    if (v === 'newest')
        return 'newest';
    if (v === 'oldest')
        return 'oldest';
    return 'smallest_file';
}
function resolutionPriority(resolution) {
    if (!resolution)
        return 1;
    const r = String(resolution).toLowerCase().trim();
    if (r.includes('4k') || r.includes('2160'))
        return 4;
    if (r.includes('1080'))
        return 3;
    if (r.includes('720'))
        return 2;
    if (r.includes('480'))
        return 1;
    return 1;
}
let CleanupAfterAddingNewContentJob = class CleanupAfterAddingNewContentJob {
    settingsService;
    plexServer;
    plexWatchlist;
    plexDuplicates;
    radarr;
    sonarr;
    constructor(settingsService, plexServer, plexWatchlist, plexDuplicates, radarr, sonarr) {
        this.settingsService = settingsService;
        this.plexServer = plexServer;
        this.plexWatchlist = plexWatchlist;
        this.plexDuplicates = plexDuplicates;
        this.radarr = radarr;
        this.sonarr = sonarr;
    }
    async run(ctx) {
        const PROGRESS_TOTAL_STEPS = 6;
        const setProgress = async (current, step, message, extra) => {
            await ctx.patchSummary({
                phase: 'running',
                progress: {
                    step,
                    message,
                    current,
                    total: PROGRESS_TOTAL_STEPS,
                    updatedAt: new Date().toISOString(),
                    ...(extra ?? {}),
                },
            });
        };
        await setProgress(1, 'starting', 'Starting cleanup…');
        const { settings, secrets } = await this.settingsService.getInternalSettings(ctx.userId);
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') ??
            pickString(settings, 'plex.url') ??
            null;
        const plexToken = pickString(secrets, 'plex.token') ?? null;
        if (!plexBaseUrlRaw || !plexToken) {
            throw new Error('Missing Plex configuration (plex.baseUrl + secrets.plex.token)');
        }
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        const plexSections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const plexMovieSections = plexSections.filter((s) => (s.type ?? '').toLowerCase() === 'movie');
        const plexTvSections = plexSections.filter((s) => (s.type ?? '').toLowerCase() === 'show');
        const deletePreference = coerceDeletePreference(pickString(settings, 'plex.deletePreference') ??
            pickString(settings, 'plex.delete_preference') ??
            null);
        const preserveQualityTerms = [
            ...pickStringArray(settings, 'plex.preserveQuality'),
            ...pickStringArray(settings, 'plex.preserve_quality'),
        ];
        const radarrBaseUrlRaw = pickString(settings, 'radarr.baseUrl') ??
            pickString(settings, 'radarr.url') ??
            null;
        const radarrApiKey = pickString(secrets, 'radarr.apiKey') ?? null;
        const radarrBaseUrl = radarrBaseUrlRaw && radarrApiKey
            ? normalizeHttpUrl(radarrBaseUrlRaw)
            : null;
        const sonarrBaseUrlRaw = pickString(settings, 'sonarr.baseUrl') ??
            pickString(settings, 'sonarr.url') ??
            null;
        const sonarrApiKey = pickString(secrets, 'sonarr.apiKey') ?? null;
        const sonarrBaseUrl = sonarrBaseUrlRaw && sonarrApiKey
            ? normalizeHttpUrl(sonarrBaseUrlRaw)
            : null;
        const input = ctx.trigger === 'manual' ? {} : (ctx.input ?? {});
        const mediaType = (pickString(input, 'mediaType') ?? '').toLowerCase();
        const title = pickString(input, 'title') ?? '';
        const year = pickNumber(input, 'year') ?? null;
        const ratingKey = pickString(input, 'ratingKey') ?? null;
        const showTitle = pickString(input, 'showTitle') ??
            pickString(input, 'grandparentTitle') ??
            null;
        const showRatingKey = pickString(input, 'showRatingKey') ??
            pickString(input, 'grandparentRatingKey') ??
            null;
        const seasonNumber = pickNumber(input, 'seasonNumber') ?? null;
        const episodeNumber = pickNumber(input, 'episodeNumber') ?? null;
        const tvdbIdInput = pickNumber(input, 'tvdbId');
        const tmdbIdInput = pickNumber(input, 'tmdbId');
        const plexEvent = pickString(input, 'plexEvent') ?? null;
        const persistedPath = pickString(input, 'persistedPath') ?? null;
        await ctx.info('mediaAddedCleanup: start', {
            dryRun: ctx.dryRun,
            plexEvent,
            mediaType,
            title,
            year,
            ratingKey,
            showTitle,
            showRatingKey,
            seasonNumber,
            episodeNumber,
            persistedPath,
            deletePreference,
            preserveQualityTerms,
            radarrConfigured: Boolean(radarrBaseUrl && radarrApiKey),
            sonarrConfigured: Boolean(sonarrBaseUrl && sonarrApiKey),
        });
        const summary = {
            dryRun: ctx.dryRun,
            plexEvent,
            mediaType,
            title,
            year,
            ratingKey,
            showTitle,
            showRatingKey,
            seasonNumber,
            episodeNumber,
            radarr: {
                configured: Boolean(radarrBaseUrl && radarrApiKey),
                connected: null,
                moviesUnmonitored: 0,
                moviesWouldUnmonitor: 0,
                error: null,
            },
            sonarr: {
                configured: Boolean(sonarrBaseUrl && sonarrApiKey),
                connected: null,
                episodesUnmonitored: 0,
                episodesWouldUnmonitor: 0,
                error: null,
            },
            watchlist: { removed: 0, attempted: 0, matchedBy: 'none' },
            duplicates: null,
            skipped: false,
            warnings: [],
        };
        await ctx.setSummary({
            phase: 'running',
            ...summary,
            progress: {
                step: 'starting',
                message: 'Starting cleanup…',
                current: 1,
                total: PROGRESS_TOTAL_STEPS,
                updatedAt: new Date().toISOString(),
            },
        });
        const toReport = (rawSummary) => {
            const report = buildMediaAddedCleanupReport({ ctx, raw: rawSummary });
            return { summary: report };
        };
        if (!mediaType) {
            await ctx.info('mediaAddedCleanup: no mediaType provided; running full duplicates sweep', {
                trigger: ctx.trigger,
                dryRun: ctx.dryRun,
            });
            const sweepWarnings = [];
            const pushItem = (list, item, max, onTruncate) => {
                if (list.length >= max) {
                    onTruncate();
                    return;
                }
                const s = String(item ?? '').trim();
                if (!s)
                    return;
                list.push(s);
            };
            await setProgress(2, 'scan_movies', 'Scanning Plex movies for duplicates…', {
                libraries: plexMovieSections.map((s) => s.title),
            });
            let radarrMovies = [];
            const radarrByTmdb = new Map();
            const radarrByNormTitle = new Map();
            if (radarrBaseUrl && radarrApiKey) {
                try {
                    radarrMovies = await this.radarr.listMovies({
                        baseUrl: radarrBaseUrl,
                        apiKey: radarrApiKey,
                    });
                    for (const m of radarrMovies) {
                        const tmdb = toInt(m.tmdbId);
                        if (tmdb)
                            radarrByTmdb.set(tmdb, m);
                        const t = typeof m.title === 'string' ? m.title : '';
                        if (t)
                            radarrByNormTitle.set(normTitle(t), m);
                    }
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    sweepWarnings.push(`radarr: failed to load movies (continuing): ${msg}`);
                    await ctx.warn('radarr: failed to load movies (continuing)', {
                        error: msg,
                    });
                }
            }
            let sonarrSeriesList = [];
            const sonarrByTvdb = new Map();
            const sonarrByNormTitle = new Map();
            const sonarrEpisodesCache = new Map();
            if (sonarrBaseUrl && sonarrApiKey) {
                try {
                    sonarrSeriesList = await this.sonarr.listSeries({
                        baseUrl: sonarrBaseUrl,
                        apiKey: sonarrApiKey,
                    });
                    for (const s of sonarrSeriesList) {
                        const tvdb = toInt(s.tvdbId);
                        if (tvdb)
                            sonarrByTvdb.set(tvdb, s);
                        const t = typeof s.title === 'string' ? s.title : '';
                        if (t)
                            sonarrByNormTitle.set(normTitle(t), s);
                    }
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    sweepWarnings.push(`sonarr: failed to load series (continuing): ${msg}`);
                    await ctx.warn('sonarr: failed to load series (continuing)', {
                        error: msg,
                    });
                }
            }
            const findSonarrSeriesFromCache = (params) => {
                const tvdbId = params.tvdbId ?? null;
                if (tvdbId) {
                    const byTvdb = sonarrByTvdb.get(tvdbId);
                    if (byTvdb)
                        return byTvdb;
                }
                const q = params.title.trim();
                if (!q)
                    return null;
                const norm = normTitle(q);
                const exact = sonarrByNormTitle.get(norm);
                if (exact)
                    return exact;
                let best = null;
                for (const s of sonarrSeriesList) {
                    const t = typeof s.title === 'string' ? s.title : '';
                    if (!t)
                        continue;
                    const score = diceCoefficient(q, t);
                    if (!best || score > best.score)
                        best = { s, score };
                }
                if (best && best.score >= 0.7)
                    return best.s;
                return null;
            };
            const getSonarrEpisodeMap = async (seriesId) => {
                const cached = sonarrEpisodesCache.get(seriesId);
                if (cached)
                    return cached;
                if (!sonarrBaseUrl || !sonarrApiKey)
                    return new Map();
                const eps = await this.sonarr.getEpisodesBySeries({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    seriesId,
                });
                const map = new Map();
                for (const ep of eps) {
                    const season = toInt(ep.seasonNumber);
                    const epNum = toInt(ep.episodeNumber);
                    if (!season || !epNum)
                        continue;
                    map.set(episodeKey(season, epNum), ep);
                }
                sonarrEpisodesCache.set(seriesId, map);
                return map;
            };
            const preserveTerms = preserveQualityTerms
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean);
            const metaHasPreservedCopy = (meta) => {
                if (!preserveTerms.length)
                    return false;
                for (const m of meta.media ?? []) {
                    for (const p of m.parts ?? []) {
                        const target = `${m.videoResolution ?? ''} ${p.file ?? ''}`.toLowerCase();
                        if (preserveTerms.some((t) => target.includes(t)))
                            return true;
                    }
                }
                return false;
            };
            const pickRadarrMovie = (tmdbId, title) => {
                if (tmdbId) {
                    const byTmdb = radarrByTmdb.get(tmdbId);
                    if (byTmdb)
                        return byTmdb;
                }
                const byTitle = radarrByNormTitle.get(normTitle(title));
                return byTitle ?? null;
            };
            const movieStats = {
                scanned: 0,
                groups: 0,
                groupsWithDuplicates: 0,
                metadataDeleted: 0,
                metadataWouldDelete: 0,
                partsDeleted: 0,
                partsWouldDelete: 0,
                failures: 0,
                radarrUnmonitored: 0,
                radarrWouldUnmonitor: 0,
                radarrNotFound: 0,
                deletedMetadataItems: [],
                deletedVersionItems: [],
                radarrUnmonitoredItems: [],
                itemsTruncated: false,
            };
            const deletedMovieRatingKeys = new Set();
            const movies = [];
            try {
                await ctx.info('plex: loading movies (tmdb index)', {
                    libraries: plexMovieSections.map((s) => s.title),
                });
                for (const sec of plexMovieSections) {
                    try {
                        const items = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            librarySectionKey: sec.key,
                            sectionTitle: sec.title,
                        });
                        for (const it of items) {
                            movies.push({ ...it, libraryTitle: sec.title });
                        }
                    }
                    catch (err) {
                        const msg = err?.message ?? String(err);
                        sweepWarnings.push(`plex: failed listing movies for section=${sec.title} (continuing): ${msg}`);
                        await ctx.warn('plex: failed listing movies for section (continuing)', {
                            section: sec.title,
                            error: msg,
                        });
                    }
                }
                movieStats.scanned = movies.length;
                const groups = new Map();
                for (const m of movies) {
                    if (!m.tmdbId)
                        continue;
                    const list = groups.get(m.tmdbId) ?? [];
                    list.push({
                        ratingKey: m.ratingKey,
                        title: m.title,
                        addedAt: m.addedAt,
                    });
                    groups.set(m.tmdbId, list);
                }
                movieStats.groups = groups.size;
                await setProgress(3, 'clean_movies', 'Deleting duplicate movies (Plex) and unmonitoring in Radarr…');
                for (const [tmdbId, items] of groups.entries()) {
                    if (items.length < 2)
                        continue;
                    movieStats.groupsWithDuplicates += 1;
                    await ctx.info('plex: duplicate movie group found', {
                        tmdbId,
                        candidates: items.length,
                        ratingKeys: items.map((i) => i.ratingKey),
                    });
                    const metas = [];
                    for (const it of items) {
                        try {
                            const meta = await this.plexServer.getMetadataDetails({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: it.ratingKey,
                            });
                            if (!meta)
                                continue;
                            let bestRes = 1;
                            let bestSize = null;
                            for (const m of meta.media ?? []) {
                                bestRes = Math.max(bestRes, resolutionPriority(m.videoResolution));
                                for (const p of m.parts ?? []) {
                                    if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                                        bestSize =
                                            bestSize === null ? p.size : Math.max(bestSize, p.size);
                                    }
                                }
                            }
                            metas.push({
                                ratingKey: meta.ratingKey,
                                title: meta.title || it.title,
                                addedAt: meta.addedAt ?? it.addedAt ?? null,
                                preserved: metaHasPreservedCopy(meta),
                                bestResolution: bestRes,
                                bestSize,
                            });
                        }
                        catch (err) {
                            movieStats.failures += 1;
                            await ctx.warn('plex: failed loading movie metadata (continuing)', {
                                ratingKey: it.ratingKey,
                                error: err?.message ?? String(err),
                            });
                        }
                    }
                    if (metas.length < 2)
                        continue;
                    const pref = deletePreference;
                    const pool = metas.some((m) => m.preserved)
                        ? metas.filter((m) => m.preserved)
                        : metas;
                    const sorted = pool.slice().sort((a, b) => {
                        if (pref === 'newest' || pref === 'oldest') {
                            const aa = a.addedAt ?? 0;
                            const bb = b.addedAt ?? 0;
                            if (aa !== bb)
                                return pref === 'newest' ? aa - bb : bb - aa;
                        }
                        else if (pref === 'largest_file' || pref === 'smallest_file') {
                            const sa = a.bestSize ??
                                (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
                            const sb = b.bestSize ??
                                (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
                            if (sa !== sb)
                                return pref === 'smallest_file' ? sb - sa : sa - sb;
                        }
                        if (a.bestResolution !== b.bestResolution) {
                            return b.bestResolution - a.bestResolution;
                        }
                        const sa2 = a.bestSize ?? 0;
                        const sb2 = b.bestSize ?? 0;
                        return sb2 - sa2;
                    });
                    const keep = sorted[0];
                    const deleteKeys = metas
                        .map((m) => m.ratingKey)
                        .filter((rk) => rk !== keep.ratingKey);
                    await ctx.info('plex: keeping best movie candidate', {
                        tmdbId,
                        keepRatingKey: keep.ratingKey,
                        keepTitle: keep.title,
                        preference: deletePreference,
                        preservedPreferred: metas.some((m) => m.preserved),
                        deleteRatingKeys: deleteKeys,
                    });
                    if (radarrBaseUrl && radarrApiKey) {
                        const candidate = pickRadarrMovie(tmdbId, keep.title);
                        if (!candidate) {
                            movieStats.radarrNotFound += 1;
                            await ctx.warn('radarr: movie not found for duplicate group', {
                                tmdbId,
                                title: keep.title,
                            });
                        }
                        else if (!candidate.monitored) {
                            await ctx.debug('radarr: already unmonitored (duplicate group)', {
                                tmdbId,
                                title: typeof candidate.title === 'string'
                                    ? candidate.title
                                    : keep.title,
                            });
                        }
                        else if (ctx.dryRun) {
                            movieStats.radarrWouldUnmonitor += 1;
                            await ctx.info('radarr: dry-run would unmonitor (duplicate group)', {
                                tmdbId,
                                title: typeof candidate.title === 'string'
                                    ? candidate.title
                                    : keep.title,
                            });
                        }
                        else {
                            const ok = await this.radarr
                                .setMovieMonitored({
                                baseUrl: radarrBaseUrl,
                                apiKey: radarrApiKey,
                                movie: candidate,
                                monitored: false,
                            })
                                .catch(() => false);
                            if (ok)
                                movieStats.radarrUnmonitored += 1;
                            if (ok) {
                                pushItem(movieStats.radarrUnmonitoredItems, `${keep.title} [tmdbId=${tmdbId}]`, 200, () => (movieStats.itemsTruncated = true));
                            }
                            if (!ok) {
                                await ctx.warn('radarr: failed to unmonitor (duplicate group)', {
                                    tmdbId,
                                    radarrId: toInt(candidate['id']),
                                    title: typeof candidate.title === 'string'
                                        ? candidate.title
                                        : keep.title,
                                });
                            }
                            await ctx.info('radarr: unmonitor result (duplicate group)', {
                                ok,
                                tmdbId,
                                title: typeof candidate.title === 'string'
                                    ? candidate.title
                                    : keep.title,
                            });
                        }
                    }
                    for (const rk of deleteKeys) {
                        if (ctx.dryRun) {
                            movieStats.metadataWouldDelete += 1;
                            continue;
                        }
                        try {
                            await this.plexServer.deleteMetadataByRatingKey({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: rk,
                            });
                            movieStats.metadataDeleted += 1;
                            deletedMovieRatingKeys.add(rk);
                            const metaTitle = metas.find((m) => m.ratingKey === rk)?.title ?? `ratingKey=${rk}`;
                            pushItem(movieStats.deletedMetadataItems, `${metaTitle} [ratingKey=${rk}]`, 200, () => (movieStats.itemsTruncated = true));
                        }
                        catch (err) {
                            movieStats.failures += 1;
                            await ctx.warn('plex: failed deleting duplicate movie metadata (continuing)', {
                                ratingKey: rk,
                                tmdbId,
                                error: err?.message ?? String(err),
                            });
                        }
                    }
                    try {
                        const dup = await this.plexDuplicates.cleanupMovieDuplicates({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            ratingKey: keep.ratingKey,
                            dryRun: ctx.dryRun,
                            deletePreference,
                            preserveQualityTerms,
                        });
                        movieStats.partsDeleted += dup.deleted;
                        movieStats.partsWouldDelete += dup.wouldDelete;
                        const relevantDeletes = (dup.deletions ?? []).filter((d) => ctx.dryRun ? Boolean(d) : d.deleted === true);
                        for (const d of relevantDeletes) {
                            const mid = d.mediaId ? `mediaId=${d.mediaId}` : 'mediaId=?';
                            pushItem(movieStats.deletedVersionItems, `${dup.title} [ratingKey=${dup.ratingKey}] ${mid}`, 200, () => (movieStats.itemsTruncated = true));
                        }
                        try {
                            const post = await this.plexServer.getMetadataDetails({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: keep.ratingKey,
                            });
                            const mediaCount = post?.media?.length ?? 0;
                            if (mediaCount > 1) {
                                sweepWarnings.push(`plex: movie still has multiple media versions after cleanup ratingKey=${keep.ratingKey} media=${mediaCount}`);
                                await ctx.warn('plex: movie still has multiple media versions after cleanup', {
                                    ratingKey: keep.ratingKey,
                                    tmdbId,
                                    mediaCount,
                                });
                            }
                        }
                        catch {
                        }
                    }
                    catch (err) {
                        movieStats.failures += 1;
                        await ctx.warn('plex: failed cleaning movie versions (continuing)', {
                            ratingKey: keep.ratingKey,
                            tmdbId,
                            error: err?.message ?? String(err),
                        });
                    }
                }
                try {
                    const dupKeys = [];
                    for (const sec of plexMovieSections) {
                        try {
                            const items = await this.plexServer.listDuplicateMovieRatingKeysForSectionKey({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                librarySectionKey: sec.key,
                            });
                            for (const it of items)
                                dupKeys.push({
                                    ratingKey: it.ratingKey,
                                    libraryTitle: sec.title,
                                });
                        }
                        catch (err) {
                            const msg = err?.message ?? String(err);
                            sweepWarnings.push(`plex: movie duplicate listing failed section=${sec.title} (continuing): ${msg}`);
                            await ctx.warn('plex: movie duplicate listing failed (continuing)', {
                                section: sec.title,
                                error: msg,
                            });
                        }
                    }
                    for (const { ratingKey: rk, libraryTitle } of dupKeys) {
                        if (deletedMovieRatingKeys.has(rk))
                            continue;
                        try {
                            const dup = await this.plexDuplicates.cleanupMovieDuplicates({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: rk,
                                dryRun: ctx.dryRun,
                                deletePreference,
                                preserveQualityTerms,
                            });
                            if (dup.deleted || dup.wouldDelete) {
                                movieStats.partsDeleted += dup.deleted;
                                movieStats.partsWouldDelete += dup.wouldDelete;
                                const relevantDeletes = (dup.deletions ?? []).filter((d) => ctx.dryRun ? Boolean(d) : d.deleted === true);
                                for (const d of relevantDeletes) {
                                    const mid = d.mediaId ? `mediaId=${d.mediaId}` : 'mediaId=?';
                                    pushItem(movieStats.deletedVersionItems, `${dup.title} [ratingKey=${dup.ratingKey}] ${mid}`, 200, () => (movieStats.itemsTruncated = true));
                                }
                                const tmdbId = dup.metadata.tmdbIds[0] ?? null;
                                const candidate = radarrBaseUrl && radarrApiKey
                                    ? pickRadarrMovie(tmdbId, dup.title)
                                    : null;
                                if (radarrBaseUrl && radarrApiKey) {
                                    if (!candidate) {
                                        movieStats.radarrNotFound += 1;
                                        await ctx.warn('radarr: movie not found for duplicate-only item', {
                                            ratingKey: rk,
                                            tmdbId,
                                            title: dup.title,
                                        });
                                    }
                                    else if (candidate.monitored) {
                                        if (ctx.dryRun) {
                                            movieStats.radarrWouldUnmonitor += 1;
                                        }
                                        else {
                                            const ok = await this.radarr
                                                .setMovieMonitored({
                                                baseUrl: radarrBaseUrl,
                                                apiKey: radarrApiKey,
                                                movie: candidate,
                                                monitored: false,
                                            })
                                                .catch(() => false);
                                            if (ok)
                                                movieStats.radarrUnmonitored += 1;
                                            if (ok) {
                                                pushItem(movieStats.radarrUnmonitoredItems, `${dup.title}${dup.metadata.year ? ` (${dup.metadata.year})` : ''} [tmdbId=${tmdbId ?? 'unknown'}]`, 200, () => (movieStats.itemsTruncated = true));
                                            }
                                            if (!ok) {
                                                await ctx.warn('radarr: failed to unmonitor (duplicate-only item)', {
                                                    ratingKey: rk,
                                                    tmdbId,
                                                    radarrId: toInt(candidate['id']),
                                                    title: typeof candidate.title === 'string'
                                                        ? candidate.title
                                                        : dup.title,
                                                });
                                            }
                                        }
                                    }
                                    else {
                                        await ctx.debug('radarr: already unmonitored (duplicate-only item)', {
                                            ratingKey: rk,
                                            tmdbId,
                                            title: typeof candidate.title === 'string'
                                                ? candidate.title
                                                : dup.title,
                                        });
                                    }
                                }
                            }
                            try {
                                const post = await this.plexServer.getMetadataDetails({
                                    baseUrl: plexBaseUrl,
                                    token: plexToken,
                                    ratingKey: rk,
                                });
                                const mediaCount = post?.media?.length ?? 0;
                                if (mediaCount > 1) {
                                    sweepWarnings.push(`plex: movie still has multiple media versions after cleanup ratingKey=${rk} media=${mediaCount}`);
                                    await ctx.warn('plex: movie still has multiple media versions after cleanup', {
                                        ratingKey: rk,
                                        tmdbId: dup.metadata.tmdbIds[0] ?? null,
                                        mediaCount,
                                    });
                                }
                            }
                            catch {
                            }
                        }
                        catch (err) {
                            movieStats.failures += 1;
                            await ctx.warn('plex: failed cleaning duplicate movie (continuing)', {
                                ratingKey: rk,
                                section: libraryTitle,
                                error: err?.message ?? String(err),
                            });
                        }
                    }
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    sweepWarnings.push(`plex: movie duplicate listing failed: ${msg}`);
                    await ctx.warn('plex: movie duplicate listing failed (continuing)', {
                        error: msg,
                    });
                }
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                sweepWarnings.push(`plex: movie scan failed: ${msg}`);
                await ctx.warn('plex: movie scan failed (continuing)', { error: msg });
            }
            const episodeStats = {
                candidates: 0,
                groupsWithDuplicates: 0,
                metadataDeleted: 0,
                metadataWouldDelete: 0,
                partsDeleted: 0,
                partsWouldDelete: 0,
                failures: 0,
                sonarrUnmonitored: 0,
                sonarrWouldUnmonitor: 0,
                sonarrNotFound: 0,
                deletedMetadataItems: [],
                deletedVersionItems: [],
                sonarrUnmonitoredItems: [],
                itemsTruncated: false,
            };
            const episodeCandidates = [];
            await setProgress(4, 'scan_episodes', 'Scanning Plex episodes for duplicates…', {
                libraries: plexTvSections.map((s) => s.title),
            });
            const loadDuplicateEpisodeKeys = async () => {
                const out = new Set();
                let anySucceeded = false;
                for (const sec of plexTvSections) {
                    try {
                        const rows = await this.plexServer.listDuplicateEpisodeRatingKeysForSectionKey({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            librarySectionKey: sec.key,
                        });
                        for (const r of rows)
                            out.add(r.ratingKey);
                        anySucceeded = true;
                    }
                    catch (err) {
                        await ctx.warn('plex: duplicate episode listing failed for section (continuing)', {
                            section: sec.title,
                            error: err?.message ?? String(err),
                        });
                    }
                }
                if (anySucceeded)
                    return Array.from(out);
                await ctx.warn('plex: duplicate episode listing failed; falling back to per-show scan');
                try {
                    for (const sec of plexTvSections) {
                        const shows = await this.plexServer.listTvShowsForSectionKey({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            librarySectionKey: sec.key,
                        });
                        for (const show of shows) {
                            try {
                                const eps = await this.plexServer.listEpisodesForShow({
                                    baseUrl: plexBaseUrl,
                                    token: plexToken,
                                    showRatingKey: show.ratingKey,
                                    duplicateOnly: true,
                                });
                                for (const ep of eps)
                                    out.add(ep.ratingKey);
                            }
                            catch {
                            }
                        }
                    }
                }
                catch {
                }
                return Array.from(out);
            };
            try {
                const dupEpisodeKeys = await loadDuplicateEpisodeKeys();
                episodeStats.candidates = dupEpisodeKeys.length;
                for (const rk of dupEpisodeKeys) {
                    try {
                        const meta = await this.plexServer.getMetadataDetails({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            ratingKey: rk,
                        });
                        if (!meta)
                            continue;
                        const showTitle = meta.grandparentTitle;
                        const season = meta.parentIndex;
                        const epNum = meta.index;
                        let bestRes = 1;
                        let bestSize = null;
                        for (const m of meta.media ?? []) {
                            bestRes = Math.max(bestRes, resolutionPriority(m.videoResolution));
                            for (const p of m.parts ?? []) {
                                if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                                    bestSize =
                                        bestSize === null ? p.size : Math.max(bestSize, p.size);
                                }
                            }
                        }
                        episodeCandidates.push({
                            ratingKey: meta.ratingKey,
                            showTitle,
                            season,
                            episode: epNum,
                            bestResolution: bestRes,
                            bestSize,
                        });
                    }
                    catch (err) {
                        episodeStats.failures += 1;
                        await ctx.warn('plex: failed loading episode metadata (continuing)', {
                            ratingKey: rk,
                            error: err?.message ?? String(err),
                        });
                    }
                }
                const byKey = new Map();
                for (const c of episodeCandidates) {
                    const show = typeof c.showTitle === 'string' && c.showTitle.trim()
                        ? normTitle(c.showTitle)
                        : null;
                    const season = typeof c.season === 'number' && Number.isFinite(c.season)
                        ? c.season
                        : null;
                    const ep = typeof c.episode === 'number' && Number.isFinite(c.episode)
                        ? c.episode
                        : null;
                    const key = show && season !== null && ep !== null
                        ? `${show}:${season}:${ep}`
                        : `rk:${c.ratingKey}`;
                    const list = byKey.get(key) ?? [];
                    list.push(c);
                    byKey.set(key, list);
                }
                await setProgress(5, 'clean_episodes', 'Deleting duplicate episodes (Plex) and unmonitoring in Sonarr…');
                for (const [key, group] of byKey.entries()) {
                    if (!key || group.length === 0)
                        continue;
                    const season = group[0]?.season ?? null;
                    const epNum = group[0]?.episode ?? null;
                    const showTitle = group[0]?.showTitle ?? null;
                    const sorted = group.slice().sort((a, b) => {
                        if (a.bestResolution !== b.bestResolution)
                            return b.bestResolution - a.bestResolution;
                        const sa = a.bestSize ?? 0;
                        const sb = b.bestSize ?? 0;
                        return sb - sa;
                    });
                    const keep = sorted[0];
                    const deleteKeys = group
                        .map((g) => g.ratingKey)
                        .filter((rk) => rk !== keep.ratingKey);
                    if (group.length > 1)
                        episodeStats.groupsWithDuplicates += 1;
                    if (sonarrBaseUrl &&
                        sonarrApiKey &&
                        showTitle &&
                        typeof season === 'number' &&
                        typeof epNum === 'number') {
                        const series = findSonarrSeriesFromCache({ title: showTitle });
                        if (!series) {
                            episodeStats.sonarrNotFound += 1;
                        }
                        else {
                            try {
                                const epMap = await getSonarrEpisodeMap(series.id);
                                const sonarrEp = epMap.get(episodeKey(season, epNum)) ?? null;
                                if (!sonarrEp) {
                                    episodeStats.sonarrNotFound += 1;
                                }
                                else if (!sonarrEp.monitored) {
                                }
                                else if (ctx.dryRun) {
                                    episodeStats.sonarrWouldUnmonitor += 1;
                                }
                                else {
                                    const ok = await this.sonarr
                                        .setEpisodeMonitored({
                                        baseUrl: sonarrBaseUrl,
                                        apiKey: sonarrApiKey,
                                        episode: sonarrEp,
                                        monitored: false,
                                    })
                                        .then(() => true)
                                        .catch(() => false);
                                    if (ok)
                                        episodeStats.sonarrUnmonitored += 1;
                                    if (ok) {
                                        const s = String(showTitle ?? '').trim() || 'Unknown show';
                                        pushItem(episodeStats.sonarrUnmonitoredItems, `${s} S${String(season).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`, 200, () => (episodeStats.itemsTruncated = true));
                                    }
                                    else {
                                        await ctx.warn('sonarr: failed to unmonitor episode (duplicate group)', {
                                            title: showTitle,
                                            season,
                                            episode: epNum,
                                            sonarrSeriesId: toInt(series['id']),
                                            sonarrEpisodeId: toInt(sonarrEp['id']),
                                        });
                                    }
                                }
                            }
                            catch (err) {
                                episodeStats.failures += 1;
                                await ctx.warn('sonarr: failed unmonitoring episode (continuing)', {
                                    title: showTitle,
                                    season,
                                    episode: epNum,
                                    error: err?.message ?? String(err),
                                });
                            }
                        }
                    }
                    for (const rk of deleteKeys) {
                        if (ctx.dryRun) {
                            episodeStats.metadataWouldDelete += 1;
                            continue;
                        }
                        try {
                            await this.plexServer.deleteMetadataByRatingKey({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: rk,
                            });
                            episodeStats.metadataDeleted += 1;
                            const s = String(showTitle ?? '').trim() || 'Unknown show';
                            pushItem(episodeStats.deletedMetadataItems, `${s} S${String(season).padStart(2, '0')}E${String(epNum).padStart(2, '0')} [ratingKey=${rk}]`, 200, () => (episodeStats.itemsTruncated = true));
                        }
                        catch (err) {
                            episodeStats.failures += 1;
                            await ctx.warn('plex: failed deleting duplicate episode metadata (continuing)', {
                                ratingKey: rk,
                                error: err?.message ?? String(err),
                            });
                        }
                    }
                    try {
                        const dup = await this.plexDuplicates.cleanupEpisodeDuplicates({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            ratingKey: keep.ratingKey,
                            dryRun: ctx.dryRun,
                        });
                        episodeStats.partsDeleted += dup.deleted;
                        episodeStats.partsWouldDelete += dup.wouldDelete;
                        const relevantDeletes = (dup.deletions ?? []).filter((d) => ctx.dryRun ? Boolean(d) : d.deleted === true);
                        for (const d of relevantDeletes) {
                            const mid = d.mediaId ? `mediaId=${d.mediaId}` : 'mediaId=?';
                            pushItem(episodeStats.deletedVersionItems, `${dup.title} [ratingKey=${dup.ratingKey}] ${mid}`, 200, () => (episodeStats.itemsTruncated = true));
                        }
                        try {
                            const post = await this.plexServer.getMetadataDetails({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: keep.ratingKey,
                            });
                            const mediaCount = post?.media?.length ?? 0;
                            if (mediaCount > 1) {
                                sweepWarnings.push(`plex: episode still has multiple media versions after cleanup ratingKey=${keep.ratingKey} media=${mediaCount}`);
                                await ctx.warn('plex: episode still has multiple media versions after cleanup', {
                                    ratingKey: keep.ratingKey,
                                    showTitle,
                                    season,
                                    episode: epNum,
                                    mediaCount,
                                });
                            }
                        }
                        catch {
                        }
                        try {
                            const post = await this.plexServer.getMetadataDetails({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: keep.ratingKey,
                            });
                            const mediaCount = post?.media?.length ?? 0;
                            if (mediaCount > 1) {
                                sweepWarnings.push(`plex: episode still has multiple media versions after cleanup ratingKey=${keep.ratingKey} media=${mediaCount}`);
                                await ctx.warn('plex: episode still has multiple media versions after cleanup', {
                                    ratingKey: keep.ratingKey,
                                    tvdbId: post?.tvdbIds?.[0] ?? null,
                                    mediaCount,
                                });
                            }
                        }
                        catch {
                        }
                    }
                    catch (err) {
                        episodeStats.failures += 1;
                        await ctx.warn('plex: failed cleaning episode versions (continuing)', {
                            ratingKey: keep.ratingKey,
                            error: err?.message ?? String(err),
                        });
                    }
                }
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                sweepWarnings.push(`plex: episode scan failed: ${msg}`);
                await ctx.warn('plex: episode scan failed (continuing)', {
                    error: msg,
                });
            }
            let plexTvdbRatingKeysForSweep = null;
            try {
                if (plexTvSections.length > 0) {
                    await ctx.info('plex: scanning cross-library episode duplicates', {
                        tvLibraries: plexTvSections.map((s) => s.title),
                    });
                    const plexTvdbRatingKeys = new Map();
                    for (const sec of plexTvSections) {
                        try {
                            const map = await this.plexServer.getTvdbShowMapForSectionKey({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                librarySectionKey: sec.key,
                                sectionTitle: sec.title,
                            });
                            for (const [tvdbId, rk] of map.entries()) {
                                const prev = plexTvdbRatingKeys.get(tvdbId) ?? [];
                                if (!prev.includes(rk))
                                    prev.push(rk);
                                plexTvdbRatingKeys.set(tvdbId, prev);
                            }
                        }
                        catch (err) {
                            await ctx.warn('plex: failed building TVDB map for section (continuing)', {
                                section: sec.title,
                                error: err?.message ?? String(err),
                            });
                        }
                    }
                    plexTvdbRatingKeysForSweep = plexTvdbRatingKeys;
                    const dupSeries = Array.from(plexTvdbRatingKeys.entries()).filter(([, rks]) => rks.length > 1);
                    for (const [tvdbId, showRatingKeys] of dupSeries) {
                        const episodeToRatingKeys = new Map();
                        for (const showRk of showRatingKeys) {
                            const eps = await this.plexServer.listEpisodesForShow({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                showRatingKey: showRk,
                            });
                            for (const ep of eps) {
                                const s = ep.seasonNumber;
                                const e = ep.episodeNumber;
                                if (!s || !e)
                                    continue;
                                const key = episodeKey(s, e);
                                const list = episodeToRatingKeys.get(key) ?? [];
                                if (!list.includes(ep.ratingKey))
                                    list.push(ep.ratingKey);
                                episodeToRatingKeys.set(key, list);
                            }
                        }
                        const series = sonarrByTvdb.get(tvdbId) ?? null;
                        const epMap = series ? await getSonarrEpisodeMap(series.id) : null;
                        for (const [key, rks] of episodeToRatingKeys.entries()) {
                            if (rks.length < 2)
                                continue;
                            const metas = [];
                            for (const rk of rks) {
                                try {
                                    const meta = await this.plexServer.getMetadataDetails({
                                        baseUrl: plexBaseUrl,
                                        token: plexToken,
                                        ratingKey: rk,
                                    });
                                    if (!meta)
                                        continue;
                                    let bestRes = 1;
                                    let bestSize = null;
                                    for (const m of meta.media ?? []) {
                                        bestRes = Math.max(bestRes, resolutionPriority(m.videoResolution));
                                        for (const p of m.parts ?? []) {
                                            if (typeof p.size === 'number' &&
                                                Number.isFinite(p.size)) {
                                                bestSize =
                                                    bestSize === null
                                                        ? p.size
                                                        : Math.max(bestSize, p.size);
                                            }
                                        }
                                    }
                                    metas.push({
                                        ratingKey: rk,
                                        bestResolution: bestRes,
                                        bestSize,
                                    });
                                }
                                catch {
                                }
                            }
                            const sorted = metas.slice().sort((a, b) => {
                                if (a.bestResolution !== b.bestResolution)
                                    return b.bestResolution - a.bestResolution;
                                const sa = a.bestSize ?? 0;
                                const sb = b.bestSize ?? 0;
                                return sb - sa;
                            });
                            const keep = sorted[0];
                            if (!keep)
                                continue;
                            const deleteKeys = rks.filter((rk) => rk !== keep.ratingKey);
                            if (epMap) {
                                const sonarrEp = epMap.get(key) ?? null;
                                if (sonarrEp && sonarrEp.monitored) {
                                    if (ctx.dryRun) {
                                        episodeStats.sonarrWouldUnmonitor += 1;
                                    }
                                    else {
                                        const ok = await this.sonarr
                                            .setEpisodeMonitored({
                                            baseUrl: sonarrBaseUrl,
                                            apiKey: sonarrApiKey,
                                            episode: sonarrEp,
                                            monitored: false,
                                        })
                                            .then(() => true)
                                            .catch(() => false);
                                        if (ok)
                                            episodeStats.sonarrUnmonitored += 1;
                                    }
                                }
                            }
                            for (const rk of deleteKeys) {
                                if (ctx.dryRun) {
                                    episodeStats.metadataWouldDelete += 1;
                                    continue;
                                }
                                try {
                                    await this.plexServer.deleteMetadataByRatingKey({
                                        baseUrl: plexBaseUrl,
                                        token: plexToken,
                                        ratingKey: rk,
                                    });
                                    episodeStats.metadataDeleted += 1;
                                }
                                catch (err) {
                                    episodeStats.failures += 1;
                                    await ctx.warn('plex: failed deleting duplicate episode metadata (continuing)', {
                                        ratingKey: rk,
                                        error: err?.message ?? String(err),
                                    });
                                }
                            }
                            try {
                                const dup = await this.plexDuplicates.cleanupEpisodeDuplicates({
                                    baseUrl: plexBaseUrl,
                                    token: plexToken,
                                    ratingKey: keep.ratingKey,
                                    dryRun: ctx.dryRun,
                                });
                                episodeStats.partsDeleted += dup.deleted;
                                episodeStats.partsWouldDelete += dup.wouldDelete;
                                const relevantDeletes = (dup.deletions ?? []).filter((d) => ctx.dryRun ? Boolean(d) : d.deleted === true);
                                for (const d of relevantDeletes) {
                                    const mid = d.mediaId ? `mediaId=${d.mediaId}` : 'mediaId=?';
                                    pushItem(episodeStats.deletedVersionItems, `${dup.title} [ratingKey=${dup.ratingKey}] ${mid}`, 200, () => (episodeStats.itemsTruncated = true));
                                }
                            }
                            catch (err) {
                                episodeStats.failures += 1;
                                await ctx.warn('plex: failed cleaning episode versions (continuing)', {
                                    ratingKey: keep.ratingKey,
                                    error: err?.message ?? String(err),
                                });
                            }
                        }
                    }
                }
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                sweepWarnings.push(`plex: cross-library episode scan failed: ${msg}`);
                await ctx.warn('plex: cross-library episode scan failed (continuing)', {
                    error: msg,
                });
            }
            const watchlistWarnings = [];
            const watchlistStats = {
                mode: 'reconcile',
                movies: {
                    total: 0,
                    inPlex: 0,
                    removed: 0,
                    wouldRemove: 0,
                    failures: 0,
                    radarrUnmonitored: 0,
                    radarrWouldUnmonitor: 0,
                    radarrNotFound: 0,
                    removedItems: [],
                    radarrUnmonitoredItems: [],
                    itemsTruncated: false,
                },
                shows: {
                    total: 0,
                    completeInPlex: 0,
                    removed: 0,
                    wouldRemove: 0,
                    failures: 0,
                    skippedNotInPlex: 0,
                    skippedNotComplete: 0,
                    skippedNoSonarr: 0,
                    sonarrUnmonitored: 0,
                    sonarrWouldUnmonitor: 0,
                    removedItems: [],
                    sonarrUnmonitoredItems: [],
                    itemsTruncated: false,
                },
                warnings: watchlistWarnings,
            };
            const plexMovieYearsByNormTitle = new Map();
            for (const m of movies) {
                const t = m.title?.trim();
                if (!t)
                    continue;
                const norm = normTitle(t);
                if (!norm)
                    continue;
                const set = plexMovieYearsByNormTitle.get(norm) ?? new Set();
                set.add(m.year ?? null);
                plexMovieYearsByNormTitle.set(norm, set);
            }
            await setProgress(6, 'watchlist', 'Reconciling Plex watchlist (and unmonitoring in Radarr/Sonarr)…');
            try {
                const wlMovies = await this.plexWatchlist.listWatchlist({
                    token: plexToken,
                    kind: 'movie',
                });
                watchlistStats.movies.total = wlMovies.items.length;
                for (const it of wlMovies.items) {
                    const norm = normTitle(it.title);
                    const years = plexMovieYearsByNormTitle.get(norm) ?? null;
                    const inPlex = (() => {
                        if (!years)
                            return false;
                        if (typeof it.year === 'number' && Number.isFinite(it.year)) {
                            return years.has(it.year);
                        }
                        return true;
                    })();
                    if (!inPlex)
                        continue;
                    watchlistStats.movies.inPlex += 1;
                    if (ctx.dryRun) {
                        watchlistStats.movies.wouldRemove += 1;
                    }
                    else {
                        const ok = await this.plexWatchlist
                            .removeFromWatchlistByRatingKey({
                            token: plexToken,
                            ratingKey: it.ratingKey,
                        })
                            .catch(() => false);
                        if (ok)
                            watchlistStats.movies.removed += 1;
                        else
                            watchlistStats.movies.failures += 1;
                        if (ok) {
                            pushItem(watchlistStats.movies.removedItems, `${it.title}${it.year ? ` (${it.year})` : ''} [ratingKey=${it.ratingKey}]`, 200, () => (watchlistStats.movies.itemsTruncated = true));
                        }
                    }
                    if (radarrBaseUrl && radarrApiKey) {
                        const candidate = radarrByNormTitle.get(normTitle(it.title)) ?? null;
                        if (!candidate) {
                            watchlistStats.movies.radarrNotFound += 1;
                        }
                        else if (!candidate.monitored) {
                        }
                        else if (ctx.dryRun) {
                            watchlistStats.movies.radarrWouldUnmonitor += 1;
                        }
                        else {
                            const ok = await this.radarr
                                .setMovieMonitored({
                                baseUrl: radarrBaseUrl,
                                apiKey: radarrApiKey,
                                movie: candidate,
                                monitored: false,
                            })
                                .catch(() => false);
                            if (ok)
                                watchlistStats.movies.radarrUnmonitored += 1;
                            if (ok) {
                                pushItem(watchlistStats.movies.radarrUnmonitoredItems, `${it.title}${it.year ? ` (${it.year})` : ''}`, 200, () => (watchlistStats.movies.itemsTruncated = true));
                            }
                        }
                    }
                }
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                watchlistWarnings.push(`plex: failed loading movie watchlist (continuing): ${msg}`);
                await ctx.warn('plex: failed loading movie watchlist (continuing)', {
                    error: msg,
                });
            }
            if (!sonarrBaseUrl || !sonarrApiKey) {
                watchlistWarnings.push('sonarr: not configured; skipping show watchlist reconciliation');
            }
            else {
                try {
                    const wlShows = await this.plexWatchlist.listWatchlist({
                        token: plexToken,
                        kind: 'show',
                    });
                    watchlistStats.shows.total = wlShows.items.length;
                    const plexTvdbRatingKeys = plexTvdbRatingKeysForSweep ?? new Map();
                    if (!plexTvdbRatingKeysForSweep) {
                        for (const sec of plexTvSections) {
                            try {
                                const map = await this.plexServer.getTvdbShowMapForSectionKey({
                                    baseUrl: plexBaseUrl,
                                    token: plexToken,
                                    librarySectionKey: sec.key,
                                    sectionTitle: sec.title,
                                });
                                for (const [tvdbId, rk] of map.entries()) {
                                    const prev = plexTvdbRatingKeys.get(tvdbId) ?? [];
                                    if (!prev.includes(rk))
                                        prev.push(rk);
                                    plexTvdbRatingKeys.set(tvdbId, prev);
                                }
                            }
                            catch (err) {
                                const msg = err?.message ?? String(err);
                                watchlistWarnings.push(`plex: failed building TVDB map for section=${sec.title} (continuing): ${msg}`);
                                await ctx.warn('plex: failed building TVDB map for section (continuing)', {
                                    section: sec.title,
                                    error: msg,
                                });
                            }
                        }
                        plexTvdbRatingKeysForSweep = plexTvdbRatingKeys;
                    }
                    const plexEpisodesCache = new Map();
                    for (const it of wlShows.items) {
                        const title = it.title.trim();
                        if (!title)
                            continue;
                        const series = findSonarrSeriesFromCache({ title });
                        if (!series) {
                            watchlistStats.shows.skippedNoSonarr += 1;
                            continue;
                        }
                        const tvdbId = toInt(series.tvdbId) ?? null;
                        if (!tvdbId) {
                            watchlistStats.shows.skippedNoSonarr += 1;
                            continue;
                        }
                        const ratingKeys = plexTvdbRatingKeys.get(tvdbId) ?? [];
                        if (ratingKeys.length === 0) {
                            watchlistStats.shows.skippedNotInPlex += 1;
                            continue;
                        }
                        const plexEpisodes = new Set();
                        for (const rk of ratingKeys) {
                            const cached = plexEpisodesCache.get(rk);
                            const eps = cached ??
                                (await this.plexServer.getEpisodesSet({
                                    baseUrl: plexBaseUrl,
                                    token: plexToken,
                                    showRatingKey: rk,
                                }));
                            if (!cached)
                                plexEpisodesCache.set(rk, eps);
                            for (const k of eps)
                                plexEpisodes.add(k);
                        }
                        const epMap = await getSonarrEpisodeMap(series.id);
                        const desired = Array.from(epMap.keys()).filter((k) => {
                            const [sRaw] = k.split(':', 1);
                            const s = Number.parseInt(sRaw, 10);
                            return Number.isFinite(s) && s > 0;
                        });
                        const missing = desired.filter((k) => !plexEpisodes.has(k));
                        if (missing.length > 0) {
                            watchlistStats.shows.skippedNotComplete += 1;
                            continue;
                        }
                        watchlistStats.shows.completeInPlex += 1;
                        if (ctx.dryRun) {
                            watchlistStats.shows.wouldRemove += 1;
                        }
                        else {
                            const ok = await this.plexWatchlist
                                .removeFromWatchlistByRatingKey({
                                token: plexToken,
                                ratingKey: it.ratingKey,
                            })
                                .catch(() => false);
                            if (ok)
                                watchlistStats.shows.removed += 1;
                            else
                                watchlistStats.shows.failures += 1;
                            if (ok) {
                                pushItem(watchlistStats.shows.removedItems, `${it.title}${it.year ? ` (${it.year})` : ''} [ratingKey=${it.ratingKey}]`, 200, () => (watchlistStats.shows.itemsTruncated = true));
                            }
                        }
                        if (!series.monitored) {
                        }
                        else if (ctx.dryRun) {
                            watchlistStats.shows.sonarrWouldUnmonitor += 1;
                        }
                        else {
                            try {
                                await this.sonarr.updateSeries({
                                    baseUrl: sonarrBaseUrl,
                                    apiKey: sonarrApiKey,
                                    series: { ...series, monitored: false },
                                });
                                watchlistStats.shows.sonarrUnmonitored += 1;
                                pushItem(watchlistStats.shows.sonarrUnmonitoredItems, `${it.title}${it.year ? ` (${it.year})` : ''}`, 200, () => (watchlistStats.shows.itemsTruncated = true));
                            }
                            catch {
                                watchlistWarnings.push(`sonarr: failed to unmonitor series title=${title}`);
                            }
                        }
                    }
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    watchlistWarnings.push(`plex: failed loading show watchlist (continuing): ${msg}`);
                    await ctx.warn('plex: failed loading show watchlist (continuing)', {
                        error: msg,
                    });
                }
            }
            let sonarrSeasonsUnmonitored = 0;
            let sonarrSeasonsWouldUnmonitor = 0;
            const seasonSyncWarnings = [];
            if (ctx.trigger === 'manual' && sonarrBaseUrl && sonarrApiKey) {
                try {
                    const plexTvdbRatingKeys = plexTvdbRatingKeysForSweep ?? new Map();
                    if (!plexTvdbRatingKeysForSweep) {
                        for (const sec of plexTvSections) {
                            try {
                                const map = await this.plexServer.getTvdbShowMapForSectionKey({
                                    baseUrl: plexBaseUrl,
                                    token: plexToken,
                                    librarySectionKey: sec.key,
                                    sectionTitle: sec.title,
                                });
                                for (const [tvdbId, rk] of map.entries()) {
                                    const prev = plexTvdbRatingKeys.get(tvdbId) ?? [];
                                    if (!prev.includes(rk))
                                        prev.push(rk);
                                    plexTvdbRatingKeys.set(tvdbId, prev);
                                }
                            }
                            catch (err) {
                                const msg = err?.message ?? String(err);
                                seasonSyncWarnings.push(`plex: failed building TVDB map for section=${sec.title} (season sync continuing): ${msg}`);
                                await ctx.warn('plex: failed building TVDB map for section (season sync continuing)', { section: sec.title, error: msg });
                            }
                        }
                        plexTvdbRatingKeysForSweep = plexTvdbRatingKeys;
                    }
                    const plexEpisodesCache = new Map();
                    const getPlexEpisodesSet = async (rk) => {
                        const key = rk.trim();
                        if (!key)
                            return new Set();
                        const cached = plexEpisodesCache.get(key);
                        if (cached)
                            return cached;
                        const eps = await this.plexServer.getEpisodesSet({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            showRatingKey: key,
                        });
                        plexEpisodesCache.set(key, eps);
                        return eps;
                    };
                    const getUnionEpisodesAcrossShows = async (ratingKeys) => {
                        const set = new Set();
                        for (const rk of ratingKeys) {
                            try {
                                const eps = await getPlexEpisodesSet(rk);
                                for (const k of eps)
                                    set.add(k);
                            }
                            catch (err) {
                                const msg = err?.message ?? String(err);
                                seasonSyncWarnings.push(`plex: failed loading episodes for showRatingKey=${rk} (season sync continuing): ${msg}`);
                            }
                        }
                        return set;
                    };
                    for (const series of sonarrSeriesList) {
                        if (!series.monitored)
                            continue;
                        const tvdbId = toInt(series.tvdbId) ?? null;
                        if (!tvdbId)
                            continue;
                        const showRatingKeys = plexTvdbRatingKeys.get(tvdbId) ?? [];
                        if (showRatingKeys.length === 0)
                            continue;
                        const seasons = Array.isArray(series.seasons) ? series.seasons : [];
                        const monitoredSeasonNums = seasons
                            .map((s) => ({
                            n: toInt(s.seasonNumber),
                            monitored: typeof s.monitored === 'boolean' ? s.monitored : null,
                        }))
                            .filter((x) => typeof x.n === 'number' && x.n > 0 && x.monitored === true)
                            .map((x) => x.n);
                        if (monitoredSeasonNums.length === 0)
                            continue;
                        const epMap = await getSonarrEpisodeMap(series.id);
                        const desiredBySeason = new Map();
                        for (const k of epMap.keys()) {
                            const [sRaw] = k.split(':', 1);
                            const sNum = Number.parseInt(sRaw, 10);
                            if (!Number.isFinite(sNum) || sNum <= 0)
                                continue;
                            const list = desiredBySeason.get(sNum) ?? [];
                            list.push(k);
                            desiredBySeason.set(sNum, list);
                        }
                        const plexEpisodes = await getUnionEpisodesAcrossShows(showRatingKeys);
                        const seasonsToUnmonitor = [];
                        for (const seasonNum of monitoredSeasonNums) {
                            const desired = desiredBySeason.get(seasonNum) ?? [];
                            if (desired.length === 0)
                                continue;
                            const missing = desired.filter((k) => !plexEpisodes.has(k));
                            if (missing.length === 0)
                                seasonsToUnmonitor.push(seasonNum);
                        }
                        if (seasonsToUnmonitor.length === 0)
                            continue;
                        if (ctx.dryRun) {
                            sonarrSeasonsWouldUnmonitor += seasonsToUnmonitor.length;
                            continue;
                        }
                        try {
                            const nextSeasons = seasons.map((s) => {
                                const n = toInt(s.seasonNumber);
                                if (!n || n <= 0)
                                    return s;
                                if (!seasonsToUnmonitor.includes(n))
                                    return s;
                                if (typeof s.monitored !== 'boolean' || s.monitored !== true)
                                    return s;
                                return { ...s, monitored: false };
                            });
                            await this.sonarr.updateSeries({
                                baseUrl: sonarrBaseUrl,
                                apiKey: sonarrApiKey,
                                series: { ...series, seasons: nextSeasons },
                            });
                            sonarrSeasonsUnmonitored += seasonsToUnmonitor.length;
                        }
                        catch (err) {
                            const msg = err?.message ?? String(err);
                            seasonSyncWarnings.push(`sonarr: failed unmonitoring seasons for seriesId=${series.id} (continuing): ${msg}`);
                            await ctx.warn('sonarr: failed unmonitoring seasons (continuing)', { seriesId: series.id, tvdbId, seasons: seasonsToUnmonitor, error: msg });
                        }
                    }
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    seasonSyncWarnings.push(`sonarr: season sync failed (continuing): ${msg}`);
                    await ctx.warn('sonarr: season sync failed (continuing)', { error: msg });
                }
            }
            const sweepRadarrUnmonitored = ctx.dryRun
                ? movieStats.radarrWouldUnmonitor + watchlistStats.movies.radarrWouldUnmonitor
                : movieStats.radarrUnmonitored + watchlistStats.movies.radarrUnmonitored;
            const sweepSonarrEpisodeUnmonitored = ctx.dryRun
                ? episodeStats.sonarrWouldUnmonitor
                : episodeStats.sonarrUnmonitored;
            summary.radarr = {
                ...summary.radarr,
                moviesUnmonitored: ctx.dryRun ? 0 : sweepRadarrUnmonitored,
                moviesWouldUnmonitor: ctx.dryRun ? sweepRadarrUnmonitored : 0,
            };
            summary.sonarr = {
                ...summary.sonarr,
                episodesUnmonitored: ctx.dryRun ? 0 : sweepSonarrEpisodeUnmonitored,
                episodesWouldUnmonitor: ctx.dryRun ? sweepSonarrEpisodeUnmonitored : 0,
                seasonsUnmonitored: ctx.dryRun ? 0 : sonarrSeasonsUnmonitored,
                seasonsWouldUnmonitor: ctx.dryRun ? sonarrSeasonsWouldUnmonitor : 0,
            };
            summary.warnings.push(...seasonSyncWarnings);
            summary.watchlist = watchlistStats;
            summary.duplicates = {
                mode: 'fullSweep',
                movie: movieStats,
                episode: episodeStats,
                warnings: sweepWarnings,
            };
            summary.warnings.push(...sweepWarnings, ...watchlistWarnings);
            await ctx.info('mediaAddedCleanup(duplicatesSweep): done', summary);
            return toReport(summary);
        }
        const findSonarrSeries = async (params) => {
            if (!sonarrBaseUrl || !sonarrApiKey)
                return null;
            const all = await this.sonarr.listSeries({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
            });
            if (params.tvdbId) {
                const byTvdb = all.find((s) => toInt(s.tvdbId) === params.tvdbId);
                if (byTvdb)
                    return byTvdb;
            }
            const q = params.title.trim();
            if (!q)
                return null;
            const exact = all.find((s) => typeof s.title === 'string' &&
                s.title.toLowerCase() === q.toLowerCase());
            if (exact)
                return exact;
            let best = null;
            for (const s of all) {
                const t = typeof s.title === 'string' ? s.title : '';
                if (!t)
                    continue;
                const score = diceCoefficient(q, t);
                if (!best || score > best.score)
                    best = { s, score };
            }
            if (best && best.score >= 0.7)
                return best.s;
            return null;
        };
        let plexTvdbRatingKeysCache = null;
        const plexEpisodesByShowRatingKey = new Map();
        const getPlexTvdbRatingKeys = async () => {
            if (plexTvdbRatingKeysCache)
                return plexTvdbRatingKeysCache;
            const out = new Map();
            for (const sec of plexTvSections) {
                try {
                    const map = await this.plexServer.getTvdbShowMapForSectionKey({
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        librarySectionKey: sec.key,
                        sectionTitle: sec.title,
                    });
                    for (const [tvdbId, rk] of map.entries()) {
                        const prev = out.get(tvdbId) ?? [];
                        if (!prev.includes(rk))
                            prev.push(rk);
                        out.set(tvdbId, prev);
                    }
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    summary.warnings.push(`plex: failed building TVDB map for section=${sec.title} (continuing): ${msg}`);
                    await ctx.warn('plex: failed building TVDB map for section (continuing)', {
                        section: sec.title,
                        error: msg,
                    });
                }
            }
            plexTvdbRatingKeysCache = out;
            return out;
        };
        const getPlexEpisodesSetCached = async (rk) => {
            const key = rk.trim();
            if (!key)
                return new Set();
            const cached = plexEpisodesByShowRatingKey.get(key);
            if (cached)
                return cached;
            const eps = await this.plexServer.getEpisodesSet({
                baseUrl: plexBaseUrl,
                token: plexToken,
                showRatingKey: key,
            });
            plexEpisodesByShowRatingKey.set(key, eps);
            return eps;
        };
        const getUnionEpisodesAcrossShows = async (ratingKeys) => {
            const set = new Set();
            for (const rk of ratingKeys) {
                const eps = await getPlexEpisodesSetCached(rk);
                for (const k of eps)
                    set.add(k);
            }
            return set;
        };
        const resolvePlexLibrarySectionForRatingKey = async (rk) => {
            const ratingKey = (rk ?? '').trim();
            if (!ratingKey)
                return { key: null, title: null };
            try {
                const meta = await this.plexServer.getMetadataDetails({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    ratingKey,
                });
                return {
                    key: meta?.librarySectionId ?? null,
                    title: meta?.librarySectionTitle ?? null,
                };
            }
            catch (err) {
                await ctx.warn('plex: failed resolving library section for ratingKey (continuing)', {
                    ratingKey,
                    error: err?.message ?? String(err),
                });
                return { key: null, title: null };
            }
        };
        const runMovieLibraryDuplicateSweep = async (params) => {
            const { librarySectionKey, librarySectionTitle } = params;
            const warnings = [];
            const movieStats = {
                scanned: 0,
                groups: 0,
                groupsWithDuplicates: 0,
                metadataDeleted: 0,
                metadataWouldDelete: 0,
                partsDeleted: 0,
                partsWouldDelete: 0,
                failures: 0,
            };
            const deletedMovieRatingKeys = new Set();
            const cleanedMovieRatingKeys = new Set();
            const preserveTerms = preserveQualityTerms
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean);
            const metaHasPreservedCopy = (meta) => {
                if (!preserveTerms.length)
                    return false;
                for (const m of meta.media ?? []) {
                    for (const p of m.parts ?? []) {
                        const target = `${m.videoResolution ?? ''} ${p.file ?? ''}`.toLowerCase();
                        if (preserveTerms.some((t) => target.includes(t)))
                            return true;
                    }
                }
                return false;
            };
            try {
                const movies = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey,
                    sectionTitle: librarySectionTitle ?? undefined,
                    duplicateOnly: true,
                });
                movieStats.scanned = movies.length;
                const groups = new Map();
                for (const m of movies) {
                    if (!m.tmdbId)
                        continue;
                    const list = groups.get(m.tmdbId) ?? [];
                    list.push({
                        ratingKey: m.ratingKey,
                        title: m.title,
                        addedAt: m.addedAt,
                    });
                    groups.set(m.tmdbId, list);
                }
                movieStats.groups = groups.size;
                for (const [tmdbId, items] of groups.entries()) {
                    if (items.length < 2)
                        continue;
                    movieStats.groupsWithDuplicates += 1;
                    const metas = [];
                    for (const it of items) {
                        try {
                            const meta = await this.plexServer.getMetadataDetails({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: it.ratingKey,
                            });
                            if (!meta)
                                continue;
                            let bestRes = 1;
                            let bestSize = null;
                            for (const m of meta.media ?? []) {
                                bestRes = Math.max(bestRes, resolutionPriority(m.videoResolution));
                                for (const p of m.parts ?? []) {
                                    if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                                        bestSize = bestSize === null ? p.size : Math.max(bestSize, p.size);
                                    }
                                }
                            }
                            metas.push({
                                ratingKey: meta.ratingKey,
                                title: meta.title || it.title,
                                addedAt: meta.addedAt ?? it.addedAt ?? null,
                                preserved: metaHasPreservedCopy(meta),
                                bestResolution: bestRes,
                                bestSize,
                            });
                        }
                        catch (err) {
                            movieStats.failures += 1;
                            await ctx.warn('plex: failed loading movie metadata (continuing)', {
                                ratingKey: it.ratingKey,
                                tmdbId,
                                error: err?.message ?? String(err),
                            });
                        }
                    }
                    if (metas.length < 2)
                        continue;
                    const pref = deletePreference;
                    const pool = metas.some((m) => m.preserved) ? metas.filter((m) => m.preserved) : metas;
                    const sorted = pool.slice().sort((a, b) => {
                        if (pref === 'newest' || pref === 'oldest') {
                            const aa = a.addedAt ?? 0;
                            const bb = b.addedAt ?? 0;
                            if (aa !== bb)
                                return pref === 'newest' ? aa - bb : bb - aa;
                        }
                        else if (pref === 'largest_file' || pref === 'smallest_file') {
                            const sa = a.bestSize ??
                                (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
                            const sb = b.bestSize ??
                                (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
                            if (sa !== sb)
                                return pref === 'smallest_file' ? sb - sa : sa - sb;
                        }
                        if (a.bestResolution !== b.bestResolution) {
                            return b.bestResolution - a.bestResolution;
                        }
                        const sa2 = a.bestSize ?? 0;
                        const sb2 = b.bestSize ?? 0;
                        return sb2 - sa2;
                    });
                    const keep = sorted[0] ?? null;
                    if (!keep)
                        continue;
                    const deleteKeys = metas.map((m) => m.ratingKey).filter((rk) => rk !== keep.ratingKey);
                    for (const rk of deleteKeys) {
                        if (ctx.dryRun) {
                            movieStats.metadataWouldDelete += 1;
                            deletedMovieRatingKeys.add(rk);
                            continue;
                        }
                        try {
                            await this.plexServer.deleteMetadataByRatingKey({
                                baseUrl: plexBaseUrl,
                                token: plexToken,
                                ratingKey: rk,
                            });
                            movieStats.metadataDeleted += 1;
                            deletedMovieRatingKeys.add(rk);
                        }
                        catch (err) {
                            movieStats.failures += 1;
                            await ctx.warn('plex: failed deleting duplicate movie metadata (continuing)', {
                                ratingKey: rk,
                                tmdbId,
                                error: err?.message ?? String(err),
                            });
                        }
                    }
                    try {
                        const dup = await this.plexDuplicates.cleanupMovieDuplicates({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            ratingKey: keep.ratingKey,
                            dryRun: ctx.dryRun,
                            deletePreference,
                            preserveQualityTerms,
                        });
                        movieStats.partsDeleted += dup.deleted;
                        movieStats.partsWouldDelete += dup.wouldDelete;
                        cleanedMovieRatingKeys.add(keep.ratingKey);
                    }
                    catch (err) {
                        movieStats.failures += 1;
                        warnings.push(`plex: failed cleaning movie versions ratingKey=${keep.ratingKey} (continuing): ${err?.message ?? String(err)}`);
                    }
                }
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                movieStats.failures += 1;
                warnings.push(`plex: failed listing duplicate movies for section=${librarySectionTitle ?? librarySectionKey} (continuing): ${msg}`);
            }
            try {
                const dupKeys = await this.plexServer.listDuplicateMovieRatingKeysForSectionKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey,
                });
                for (const { ratingKey: rk } of dupKeys) {
                    if (!rk)
                        continue;
                    if (deletedMovieRatingKeys.has(rk))
                        continue;
                    if (cleanedMovieRatingKeys.has(rk))
                        continue;
                    try {
                        const dup = await this.plexDuplicates.cleanupMovieDuplicates({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            ratingKey: rk,
                            dryRun: ctx.dryRun,
                            deletePreference,
                            preserveQualityTerms,
                        });
                        movieStats.partsDeleted += dup.deleted;
                        movieStats.partsWouldDelete += dup.wouldDelete;
                        cleanedMovieRatingKeys.add(rk);
                    }
                    catch (err) {
                        movieStats.failures += 1;
                        warnings.push(`plex: failed cleaning movie versions ratingKey=${rk} (continuing): ${err?.message ?? String(err)}`);
                    }
                }
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                movieStats.failures += 1;
                warnings.push(`plex: failed listing duplicate movie keys for section=${librarySectionTitle ?? librarySectionKey} (continuing): ${msg}`);
            }
            return {
                mode: 'librarySweep',
                librarySectionId: librarySectionKey,
                librarySectionTitle,
                movie: movieStats,
                warnings,
            };
        };
        const runTvLibraryEpisodeDuplicateSweep = async (params) => {
            const { librarySectionKey, librarySectionTitle } = params;
            const warnings = [];
            const episodeStats = {
                candidates: 0,
                groupsWithDuplicates: 0,
                metadataDeleted: 0,
                metadataWouldDelete: 0,
                partsDeleted: 0,
                partsWouldDelete: 0,
                failures: 0,
            };
            const candidates = [];
            let dupEpisodeKeys = [];
            try {
                dupEpisodeKeys = await this.plexServer.listDuplicateEpisodeRatingKeysForSectionKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey,
                });
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                episodeStats.failures += 1;
                warnings.push(`plex: duplicate episode listing failed section=${librarySectionTitle ?? librarySectionKey} (continuing): ${msg}`);
                return {
                    mode: 'librarySweep',
                    librarySectionId: librarySectionKey,
                    librarySectionTitle,
                    episode: episodeStats,
                    warnings,
                };
            }
            episodeStats.candidates = dupEpisodeKeys.length;
            for (const { ratingKey: rk } of dupEpisodeKeys) {
                try {
                    const meta = await this.plexServer.getMetadataDetails({
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        ratingKey: rk,
                    });
                    if (!meta)
                        continue;
                    const showTitle = meta.grandparentTitle ?? null;
                    const showRatingKey = meta.grandparentRatingKey ?? null;
                    const season = meta.parentIndex ?? null;
                    const epNum = meta.index ?? null;
                    let bestRes = 1;
                    let bestSize = null;
                    for (const m of meta.media ?? []) {
                        bestRes = Math.max(bestRes, resolutionPriority(m.videoResolution));
                        for (const p of m.parts ?? []) {
                            if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                                bestSize = bestSize === null ? p.size : Math.max(bestSize, p.size);
                            }
                        }
                    }
                    candidates.push({
                        ratingKey: meta.ratingKey,
                        showTitle,
                        showRatingKey,
                        season,
                        episode: epNum,
                        bestResolution: bestRes,
                        bestSize,
                    });
                }
                catch (err) {
                    episodeStats.failures += 1;
                    await ctx.warn('plex: failed loading episode metadata (continuing)', {
                        ratingKey: rk,
                        error: err?.message ?? String(err),
                    });
                }
            }
            const byKey = new Map();
            for (const c of candidates) {
                const showKey = (() => {
                    const rk = (c.showRatingKey ?? '').trim();
                    if (rk)
                        return `showRk:${rk}`;
                    const title = typeof c.showTitle === 'string' ? c.showTitle.trim() : '';
                    return title ? `show:${normTitle(title)}` : null;
                })();
                const season = typeof c.season === 'number' && Number.isFinite(c.season) ? c.season : null;
                const ep = typeof c.episode === 'number' && Number.isFinite(c.episode) ? c.episode : null;
                const key = showKey && season !== null && ep !== null ? `${showKey}:${season}:${ep}` : `rk:${c.ratingKey}`;
                const list = byKey.get(key) ?? [];
                list.push(c);
                byKey.set(key, list);
            }
            for (const [, group] of byKey.entries()) {
                if (group.length === 0)
                    continue;
                const sorted = group.slice().sort((a, b) => {
                    if (a.bestResolution !== b.bestResolution)
                        return b.bestResolution - a.bestResolution;
                    const sa = a.bestSize ?? 0;
                    const sb = b.bestSize ?? 0;
                    return sb - sa;
                });
                const keep = sorted[0];
                const deleteKeys = group.map((g) => g.ratingKey).filter((rk) => rk !== keep.ratingKey);
                if (group.length > 1)
                    episodeStats.groupsWithDuplicates += 1;
                for (const rk of deleteKeys) {
                    if (ctx.dryRun) {
                        episodeStats.metadataWouldDelete += 1;
                        continue;
                    }
                    try {
                        await this.plexServer.deleteMetadataByRatingKey({
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            ratingKey: rk,
                        });
                        episodeStats.metadataDeleted += 1;
                    }
                    catch (err) {
                        episodeStats.failures += 1;
                        await ctx.warn('plex: failed deleting duplicate episode metadata (continuing)', {
                            ratingKey: rk,
                            error: err?.message ?? String(err),
                        });
                    }
                }
                try {
                    const dup = await this.plexDuplicates.cleanupEpisodeDuplicates({
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        ratingKey: keep.ratingKey,
                        dryRun: ctx.dryRun,
                    });
                    episodeStats.partsDeleted += dup.deleted;
                    episodeStats.partsWouldDelete += dup.wouldDelete;
                }
                catch (err) {
                    episodeStats.failures += 1;
                    warnings.push(`plex: failed cleaning episode versions ratingKey=${keep.ratingKey} (continuing): ${err?.message ?? String(err)}`);
                }
            }
            return {
                mode: 'librarySweep',
                librarySectionId: librarySectionKey,
                librarySectionTitle,
                episode: episodeStats,
                warnings,
            };
        };
        if (mediaType === 'movie') {
            if (!title && !ratingKey) {
                await ctx.warn('mediaAddedCleanup(movie): missing title and ratingKey (skipping)');
                summary.skipped = true;
                return toReport(summary);
            }
            let movieRatingKey = ratingKey;
            let movieSectionKeyHint = null;
            let movieSectionTitleHint = null;
            if (!movieRatingKey && title) {
                for (const sec of plexMovieSections) {
                    const found = await this.plexServer
                        .findMovieRatingKeyByTitle({
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        librarySectionKey: sec.key,
                        title,
                    })
                        .catch(() => null);
                    if (found?.ratingKey) {
                        movieRatingKey = found.ratingKey;
                        movieSectionKeyHint = sec.key;
                        movieSectionTitleHint = sec.title;
                        break;
                    }
                }
            }
            let tmdbId = tmdbIdInput ?? null;
            let resolvedTitle = title;
            let resolvedYear = year;
            let resolvedAddedAt = null;
            let movieLibrarySectionKey = movieSectionKeyHint;
            let movieLibrarySectionTitle = movieSectionTitleHint;
            if (movieRatingKey) {
                try {
                    const meta = await this.plexServer.getMetadataDetails({
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        ratingKey: movieRatingKey,
                    });
                    tmdbId = tmdbId ?? meta?.tmdbIds?.[0] ?? null;
                    resolvedTitle = meta?.title?.trim() || resolvedTitle;
                    resolvedYear = meta?.year ?? resolvedYear;
                    resolvedAddedAt = meta?.addedAt ?? resolvedAddedAt;
                    movieLibrarySectionKey =
                        meta?.librarySectionId ?? movieLibrarySectionKey;
                    movieLibrarySectionTitle =
                        meta?.librarySectionTitle ?? movieLibrarySectionTitle;
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    summary.warnings.push(`plex: failed to read movie metadata (continuing): ${msg}`);
                    await ctx.warn('plex: failed to read movie metadata (continuing)', {
                        ratingKey: movieRatingKey,
                        error: msg,
                    });
                }
            }
            if (movieLibrarySectionKey) {
                summary.duplicates = await runMovieLibraryDuplicateSweep({
                    librarySectionKey: movieLibrarySectionKey,
                    librarySectionTitle: movieLibrarySectionTitle,
                });
            }
            else {
                summary.warnings.push('plex: could not resolve movie library section; skipping duplicate sweep');
                summary.duplicates = null;
            }
            summary.title = resolvedTitle;
            summary.year = resolvedYear;
            const radarrSummary = {
                configured: Boolean(radarrBaseUrl && radarrApiKey),
                connected: null,
                movieFound: null,
                movieId: null,
                monitoredBefore: null,
                unmonitored: false,
                wouldUnmonitor: false,
                moviesUnmonitored: 0,
                moviesWouldUnmonitor: 0,
                error: null,
            };
            if (radarrBaseUrl && radarrApiKey) {
                try {
                    const movieTitle = resolvedTitle || title;
                    await ctx.info('radarr: attempting unmonitor for movie', {
                        title: movieTitle,
                    });
                    const movies = await this.radarr.listMovies({
                        baseUrl: radarrBaseUrl,
                        apiKey: radarrApiKey,
                    });
                    radarrSummary.connected = true;
                    const tmdbIdForRadarr = tmdbId;
                    const normalizedWanted = normTitle(movieTitle);
                    const findByTitle = (m) => {
                        const t = typeof m.title === 'string' ? m.title : '';
                        return t && normTitle(t) === normalizedWanted;
                    };
                    const candidate = (tmdbIdForRadarr
                        ? movies.find((m) => toInt(m.tmdbId) === tmdbIdForRadarr)
                        : null) ??
                        movies.find(findByTitle) ??
                        null;
                    if (!candidate) {
                        radarrSummary.movieFound = false;
                        await ctx.warn('radarr: movie not found (skipping unmonitor)', {
                            title: movieTitle,
                            tmdbId: tmdbIdForRadarr ?? null,
                        });
                    }
                    else if (!candidate.monitored) {
                        radarrSummary.movieFound = true;
                        radarrSummary.movieId = typeof candidate.id === 'number' ? candidate.id : null;
                        radarrSummary.monitoredBefore = false;
                        await ctx.info('radarr: already unmonitored', {
                            title: typeof candidate.title === 'string'
                                ? candidate.title
                                : movieTitle,
                            id: candidate.id,
                        });
                    }
                    else if (ctx.dryRun) {
                        radarrSummary.movieFound = true;
                        radarrSummary.movieId = typeof candidate.id === 'number' ? candidate.id : null;
                        radarrSummary.monitoredBefore = true;
                        radarrSummary.wouldUnmonitor = true;
                        radarrSummary.moviesWouldUnmonitor = 1;
                        await ctx.info('radarr: dry-run would unmonitor', {
                            title: typeof candidate.title === 'string'
                                ? candidate.title
                                : movieTitle,
                            id: candidate.id,
                        });
                    }
                    else {
                        const ok = await this.radarr.setMovieMonitored({
                            baseUrl: radarrBaseUrl,
                            apiKey: radarrApiKey,
                            movie: candidate,
                            monitored: false,
                        });
                        radarrSummary.movieFound = true;
                        radarrSummary.movieId = typeof candidate.id === 'number' ? candidate.id : null;
                        radarrSummary.monitoredBefore = true;
                        radarrSummary.unmonitored = Boolean(ok);
                        radarrSummary.moviesUnmonitored = ok ? 1 : 0;
                        await ctx.info('radarr: unmonitor result', {
                            ok,
                            title: typeof candidate.title === 'string'
                                ? candidate.title
                                : movieTitle,
                            id: candidate.id,
                            tmdbId: candidate.tmdbId ?? tmdbIdForRadarr ?? null,
                        });
                    }
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    radarrSummary.connected = false;
                    radarrSummary.error = msg;
                    summary.warnings.push(`radarr: failed (continuing): ${msg}`);
                    await ctx.warn('radarr: failed (continuing)', { error: msg });
                }
            }
            else {
                radarrSummary.connected = null;
                await ctx.info('radarr: not configured (skipping)', {});
            }
            summary.radarr = radarrSummary;
            {
                const movieTitle = resolvedTitle || title;
                const movieYear = resolvedYear ?? year;
                if (!movieTitle) {
                    await ctx.info('plex: missing movie title (skipping watchlist removal)');
                }
                else {
                    await ctx.info('plex: removing movie from watchlist (best-effort)', {
                        title: movieTitle,
                        year: movieYear,
                        dryRun: ctx.dryRun,
                    });
                    try {
                        const wl = await this.plexWatchlist.removeMovieFromWatchlistByTitle({
                            token: plexToken,
                            title: movieTitle,
                            year: movieYear,
                            dryRun: ctx.dryRun,
                        });
                        summary.watchlist = wl;
                    }
                    catch (err) {
                        const msg = err?.message ?? String(err);
                        summary.warnings.push(`plex: watchlist removal failed (non-critical): ${msg}`);
                        await ctx.warn('plex: watchlist removal failed (non-critical)', {
                            error: msg,
                        });
                        summary.watchlist = {
                            ok: false,
                            error: msg,
                        };
                    }
                }
            }
            await ctx.info('mediaAddedCleanup(movie): done', summary);
            return toReport(summary);
        }
        if (mediaType === 'show') {
            const seriesTitle = title;
            if (!seriesTitle && !ratingKey) {
                await ctx.warn('mediaAddedCleanup(show): missing title and ratingKey (skipping)');
                summary.skipped = true;
                return toReport(summary);
            }
            let tvdbId = tvdbIdInput ?? null;
            const plexShowKeyForMeta = ratingKey ?? showRatingKey ?? null;
            if (!tvdbId && plexShowKeyForMeta) {
                try {
                    const meta = await this.plexServer.getMetadataDetails({
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        ratingKey: plexShowKeyForMeta,
                    });
                    tvdbId = meta?.tvdbIds?.[0] ?? null;
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    summary.warnings.push(`plex: failed to read show tvdbId from metadata (continuing): ${msg}`);
                    await ctx.warn('plex: failed to read show tvdbId from metadata', {
                        ratingKey: plexShowKeyForMeta,
                        error: msg,
                    });
                }
            }
            {
                const sec = await resolvePlexLibrarySectionForRatingKey(ratingKey ?? showRatingKey ?? null);
                if (sec.key) {
                    summary.duplicates = await runTvLibraryEpisodeDuplicateSweep({
                        librarySectionKey: sec.key,
                        librarySectionTitle: sec.title,
                    });
                }
                else {
                    summary.warnings.push('plex: could not resolve TV library section; skipping duplicate sweep');
                    summary.duplicates = null;
                }
            }
            const sonarrSummary = {
                configured: Boolean(sonarrBaseUrl && sonarrApiKey),
                connected: null,
                seriesFound: null,
                seriesId: null,
                monitoredBefore: null,
                seriesUnmonitored: false,
                wouldUnmonitor: false,
                error: null,
            };
            if (!sonarrBaseUrl || !sonarrApiKey || !seriesTitle) {
                await ctx.info('sonarr: not configured or missing title (skipping show flow)', {});
                summary.sonarr = sonarrSummary;
                summary.skipped = true;
                return toReport(summary);
            }
            let series = null;
            try {
                series = await findSonarrSeries({ tvdbId, title: seriesTitle });
                sonarrSummary.connected = true;
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                sonarrSummary.connected = false;
                sonarrSummary.error = msg;
                summary.warnings.push(`sonarr: failed to load series list (skipping show flow): ${msg}`);
                await ctx.warn('sonarr: failed to load series list (skipping show flow)', {
                    error: msg,
                });
                summary.sonarr = sonarrSummary;
                summary.skipped = true;
                return toReport(summary);
            }
            if (!series) {
                sonarrSummary.seriesFound = false;
                summary.sonarr = sonarrSummary;
                await ctx.warn('sonarr: series not found (skipping show flow)', {
                    title: seriesTitle,
                    tvdbId,
                });
                summary.skipped = true;
                return toReport(summary);
            }
            sonarrSummary.seriesFound = true;
            sonarrSummary.seriesId = typeof series.id === 'number' ? series.id : null;
            const seriesTvdbId = toInt(series.tvdbId) ?? tvdbId ?? null;
            let plexShowRatingKeys = seriesTvdbId
                ? ((await getPlexTvdbRatingKeys()).get(seriesTvdbId) ?? [])
                : [];
            if (plexShowRatingKeys.length === 0 && plexShowKeyForMeta) {
                plexShowRatingKeys = [plexShowKeyForMeta];
            }
            if (plexShowRatingKeys.length === 0) {
                summary.sonarr = sonarrSummary;
                await ctx.warn('plex: show not found in any Plex TV library (skipping)', {
                    title: seriesTitle,
                    tvdbId: seriesTvdbId ?? tvdbId ?? null,
                });
                summary.skipped = true;
                return toReport(summary);
            }
            const plexEpisodes = await getUnionEpisodesAcrossShows(plexShowRatingKeys);
            const episodes = await this.sonarr.getEpisodesBySeries({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
                seriesId: series.id,
            });
            const episodeRows = episodes
                .map((ep) => {
                const season = toInt(ep.seasonNumber);
                const epNum = toInt(ep.episodeNumber);
                if (!season || !epNum)
                    return null;
                if (season <= 0 || epNum <= 0)
                    return null;
                const key = episodeKey(season, epNum);
                return {
                    ep,
                    key,
                    inPlex: plexEpisodes.has(key),
                    monitored: Boolean(ep.monitored),
                };
            })
                .filter(Boolean);
            const missingKeys = episodeRows.filter((r) => !r.inPlex).map((r) => r.key);
            const showCompleteInPlex = missingKeys.length === 0;
            const toUnmonitor = episodeRows.filter((r) => r.inPlex && r.monitored);
            const toMonitor = episodeRows.filter((r) => !r.inPlex && !r.monitored);
            await ctx.info('sonarr: syncing episode monitoring vs Plex availability', {
                title: seriesTitle,
                seriesId: series.id,
                tvdbId: seriesTvdbId ?? tvdbId ?? null,
                episodesTotal: episodeRows.length,
                episodesInPlex: episodeRows.length - missingKeys.length,
                episodesMissing: missingKeys.length,
                willUnmonitor: toUnmonitor.length,
                willMonitor: toMonitor.length,
                dryRun: ctx.dryRun,
            });
            let episodesUnmonitored = 0;
            let episodesMonitored = 0;
            let failures = 0;
            for (const r of toUnmonitor) {
                if (ctx.dryRun) {
                    episodesUnmonitored += 1;
                    continue;
                }
                const ok = await this.sonarr
                    .setEpisodeMonitored({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    episode: r.ep,
                    monitored: false,
                })
                    .then(() => true)
                    .catch((err) => {
                    failures += 1;
                    const msg = err?.message ?? String(err);
                    summary.warnings.push(`sonarr episode: failed to unmonitor ${r.key} (continuing): ${msg}`);
                    return false;
                });
                if (ok)
                    episodesUnmonitored += 1;
            }
            for (const r of toMonitor) {
                if (ctx.dryRun) {
                    episodesMonitored += 1;
                    continue;
                }
                const ok = await this.sonarr
                    .setEpisodeMonitored({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    episode: r.ep,
                    monitored: true,
                })
                    .then(() => true)
                    .catch((err) => {
                    failures += 1;
                    const msg = err?.message ?? String(err);
                    summary.warnings.push(`sonarr episode: failed to monitor ${r.key} (continuing): ${msg}`);
                    return false;
                });
                if (ok)
                    episodesMonitored += 1;
            }
            summary.sonarr = {
                ...sonarrSummary,
                connected: true,
                seriesFound: true,
                seriesId: series.id,
                tvdbId: seriesTvdbId ?? tvdbId ?? null,
                showCompleteInPlex,
                episodesInPlex: episodeRows.length - missingKeys.length,
                episodesMissing: missingKeys.length,
                episodesUnmonitored: ctx.dryRun ? 0 : episodesUnmonitored,
                episodesWouldUnmonitor: ctx.dryRun ? episodesUnmonitored : 0,
                episodesMonitored: ctx.dryRun ? 0 : episodesMonitored,
                episodesWouldMonitor: ctx.dryRun ? episodesMonitored : 0,
                failures,
            };
            if (seriesTitle) {
                const watchlistDryRun = showCompleteInPlex ? ctx.dryRun : true;
                await ctx.info(showCompleteInPlex
                    ? 'plex: removing show from watchlist (show complete)'
                    : 'plex: checking show watchlist (show incomplete; keeping)', { title: seriesTitle, dryRun: watchlistDryRun });
                try {
                    const wl = await this.plexWatchlist.removeShowFromWatchlistByTitle({
                        token: plexToken,
                        title: seriesTitle,
                        dryRun: watchlistDryRun,
                    });
                    summary.watchlist = wl;
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    summary.warnings.push(`plex: watchlist check/removal failed (non-critical): ${msg}`);
                    await ctx.warn('plex: watchlist check/removal failed (non-critical)', {
                        error: msg,
                    });
                    summary.watchlist = { ok: false, error: msg };
                }
            }
            await ctx.info('mediaAddedCleanup(show): done', summary);
            return toReport(summary);
        }
        if (mediaType === 'season') {
            const parsed = parseSeasonTitleFallback(title);
            const seriesTitle = showTitle ?? parsed.seriesTitle ?? null;
            const seasonNum = seasonNumber ?? parsed.seasonNumber ?? null;
            {
                const sec = await resolvePlexLibrarySectionForRatingKey(ratingKey ?? showRatingKey ?? null);
                if (sec.key) {
                    summary.duplicates = await runTvLibraryEpisodeDuplicateSweep({
                        librarySectionKey: sec.key,
                        librarySectionTitle: sec.title,
                    });
                }
                else {
                    summary.warnings.push('plex: could not resolve TV library section; skipping duplicate sweep');
                    summary.duplicates = null;
                }
            }
            if (!seriesTitle || !seasonNum) {
                await ctx.warn('mediaAddedCleanup(season): missing seriesTitle/seasonNumber (skipping)', {
                    title,
                    showTitle,
                    seasonNumber,
                });
                summary.skipped = true;
                return toReport(summary);
            }
            if (!sonarrBaseUrl || !sonarrApiKey) {
                await ctx.warn('sonarr: not configured (skipping season flow)', {});
                summary.skipped = true;
                return toReport(summary);
            }
            try {
                const series = await findSonarrSeries({
                    tvdbId: tvdbIdInput ?? null,
                    title: seriesTitle,
                });
                if (!series) {
                    await ctx.warn('sonarr: series not found (skipping season flow)', {
                        title: seriesTitle,
                        tvdbId: tvdbIdInput ?? null,
                    });
                    summary.skipped = true;
                    return toReport(summary);
                }
                const seriesTvdbId = toInt(series.tvdbId) ?? tvdbIdInput ?? null;
                let plexShowRatingKeys = seriesTvdbId
                    ? ((await getPlexTvdbRatingKeys()).get(seriesTvdbId) ?? [])
                    : [];
                if (plexShowRatingKeys.length === 0 && showRatingKey) {
                    plexShowRatingKeys = [showRatingKey];
                }
                if (plexShowRatingKeys.length === 0) {
                    await ctx.warn('plex: show not found (cannot verify season completeness across libraries; skipping)', {
                        title: seriesTitle,
                        season: seasonNum,
                    });
                    summary.skipped = true;
                    return toReport(summary);
                }
                const plexEpisodes = await getUnionEpisodesAcrossShows(plexShowRatingKeys);
                const episodes = await this.sonarr.getEpisodesBySeries({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    seriesId: series.id,
                });
                const seasonEpisodes = episodes.filter((ep) => toInt(ep.seasonNumber) === seasonNum);
                const desiredSeason = new Set();
                const desiredAll = new Set();
                for (const ep of seasonEpisodes) {
                    const epNum = toInt(ep.episodeNumber);
                    if (!epNum)
                        continue;
                    desiredSeason.add(episodeKey(seasonNum, epNum));
                }
                for (const ep of episodes) {
                    const s = toInt(ep.seasonNumber);
                    const e = toInt(ep.episodeNumber);
                    if (!s || !e)
                        continue;
                    desiredAll.add(episodeKey(s, e));
                }
                const missingSeason = Array.from(desiredSeason).filter((k) => !plexEpisodes.has(k));
                const seasonCompleteInPlex = missingSeason.length === 0;
                const seasonEpisodeRows = seasonEpisodes
                    .map((ep) => {
                    const epNum = toInt(ep.episodeNumber);
                    if (!epNum || epNum <= 0)
                        return null;
                    const key = episodeKey(seasonNum, epNum);
                    return {
                        ep,
                        key,
                        inPlex: plexEpisodes.has(key),
                        monitored: Boolean(ep.monitored),
                    };
                })
                    .filter(Boolean);
                const toUnmonitor = seasonEpisodeRows.filter((r) => r.inPlex && r.monitored);
                const toMonitor = seasonEpisodeRows.filter((r) => !r.inPlex && !r.monitored);
                await ctx.info('sonarr: syncing season episode monitoring vs Plex availability', {
                    title: seriesTitle,
                    seriesId: series.id,
                    season: seasonNum,
                    seasonCompleteInPlex,
                    seasonEpisodes: seasonEpisodeRows.length,
                    seasonEpisodesInPlex: seasonEpisodeRows.length - missingSeason.length,
                    seasonEpisodesMissing: missingSeason.length,
                    willUnmonitor: toUnmonitor.length,
                    willMonitor: toMonitor.length,
                    dryRun: ctx.dryRun,
                });
                let episodesUnmonitored = 0;
                let episodesMonitored = 0;
                let failures = 0;
                for (const r of toUnmonitor) {
                    if (ctx.dryRun) {
                        episodesUnmonitored += 1;
                        continue;
                    }
                    const ok = await this.sonarr
                        .setEpisodeMonitored({
                        baseUrl: sonarrBaseUrl,
                        apiKey: sonarrApiKey,
                        episode: r.ep,
                        monitored: false,
                    })
                        .then(() => true)
                        .catch((err) => {
                        failures += 1;
                        const msg = err?.message ?? String(err);
                        summary.warnings.push(`sonarr episode: failed to unmonitor ${r.key} (continuing): ${msg}`);
                        return false;
                    });
                    if (ok)
                        episodesUnmonitored += 1;
                }
                for (const r of toMonitor) {
                    if (ctx.dryRun) {
                        episodesMonitored += 1;
                        continue;
                    }
                    const ok = await this.sonarr
                        .setEpisodeMonitored({
                        baseUrl: sonarrBaseUrl,
                        apiKey: sonarrApiKey,
                        episode: r.ep,
                        monitored: true,
                    })
                        .then(() => true)
                        .catch((err) => {
                        failures += 1;
                        const msg = err?.message ?? String(err);
                        summary.warnings.push(`sonarr episode: failed to monitor ${r.key} (continuing): ${msg}`);
                        return false;
                    });
                    if (ok)
                        episodesMonitored += 1;
                }
                const updatedSeries = { ...series };
                const seasons = Array.isArray(series.seasons)
                    ? series.seasons.map((s) => ({ ...s }))
                    : [];
                const seasonObj = seasons.find((s) => toInt(s.seasonNumber) === seasonNum);
                const seasonWasMonitored = Boolean(seasonObj?.monitored);
                if (seasonObj && seasonCompleteInPlex)
                    seasonObj.monitored = false;
                updatedSeries.seasons = seasons;
                const seasonChanged = seasonCompleteInPlex && seasonWasMonitored;
                if (!ctx.dryRun && seasonChanged) {
                    await this.sonarr.updateSeries({
                        baseUrl: sonarrBaseUrl,
                        apiKey: sonarrApiKey,
                        series: updatedSeries,
                    });
                }
                summary.sonarr = {
                    configured: true,
                    connected: true,
                    seriesFound: true,
                    seriesId: series.id,
                    season: seasonNum,
                    seasonCompleteInPlex,
                    episodesInPlex: seasonEpisodeRows.length - missingSeason.length,
                    episodesMissing: missingSeason.length,
                    episodesUnmonitored: ctx.dryRun ? 0 : episodesUnmonitored,
                    episodesWouldUnmonitor: ctx.dryRun ? episodesUnmonitored : 0,
                    episodesMonitored: ctx.dryRun ? 0 : episodesMonitored,
                    episodesWouldMonitor: ctx.dryRun ? episodesMonitored : 0,
                    seasonUnmonitored: !ctx.dryRun && seasonChanged ? true : false,
                    seasonWouldUnmonitor: ctx.dryRun && seasonChanged ? true : false,
                    failures,
                };
                const missingAll = Array.from(desiredAll).filter((k) => !plexEpisodes.has(k));
                const seriesCompleteInPlex = missingAll.length === 0;
                const watchlistDryRun = seriesCompleteInPlex ? ctx.dryRun : true;
                await ctx.info(seriesCompleteInPlex
                    ? 'plex: removing show from watchlist (series complete)'
                    : 'plex: checking show watchlist (series incomplete; keeping)', {
                    title: seriesTitle,
                    missingCount: missingAll.length,
                    sampleMissing: missingAll.slice(0, 25),
                    dryRun: watchlistDryRun,
                });
                try {
                    const wl = await this.plexWatchlist.removeShowFromWatchlistByTitle({
                        token: plexToken,
                        title: seriesTitle,
                        dryRun: watchlistDryRun,
                    });
                    summary.watchlist = wl;
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    summary.warnings.push(`plex: watchlist check/removal failed (non-critical): ${msg}`);
                    await ctx.warn('plex: watchlist check/removal failed (non-critical)', {
                        error: msg,
                    });
                    summary.watchlist = {
                        ok: false,
                        error: msg,
                    };
                }
                await ctx.info('mediaAddedCleanup(season): done', summary);
                return toReport(summary);
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                summary.warnings.push(`season flow failed (continuing): ${msg}`);
                await ctx.warn('mediaAddedCleanup(season): failed (continuing)', {
                    error: msg,
                });
                summary.skipped = true;
                return toReport(summary);
            }
        }
        if (mediaType === 'episode') {
            const seriesTitle = showTitle;
            const seasonNum = seasonNumber;
            const epNum = episodeNumber;
            {
                const sec = await resolvePlexLibrarySectionForRatingKey(ratingKey ?? showRatingKey ?? null);
                if (sec.key) {
                    summary.duplicates = await runTvLibraryEpisodeDuplicateSweep({
                        librarySectionKey: sec.key,
                        librarySectionTitle: sec.title,
                    });
                }
                else {
                    summary.warnings.push('plex: could not resolve TV library section; skipping duplicate sweep');
                    summary.duplicates = null;
                }
            }
            if (!seriesTitle || !seasonNum || !epNum) {
                await ctx.warn('mediaAddedCleanup(episode): missing seriesTitle/season/episode (skipping)', {
                    title,
                    showTitle,
                    seasonNumber,
                    episodeNumber,
                });
                summary.skipped = true;
                return toReport(summary);
            }
            const sonarrSummary = {
                configured: Boolean(sonarrBaseUrl && sonarrApiKey),
                connected: null,
                seriesFound: null,
                seriesId: null,
                episodeFound: null,
                season: seasonNum,
                episode: epNum,
                monitoredBefore: null,
                episodeUnmonitored: false,
                wouldUnmonitor: false,
                episodesUnmonitored: 0,
                episodesWouldUnmonitor: 0,
                error: null,
            };
            if (sonarrBaseUrl && sonarrApiKey) {
                try {
                    const series = await findSonarrSeries({
                        tvdbId: tvdbIdInput ?? null,
                        title: seriesTitle,
                    });
                    if (!series) {
                        sonarrSummary.connected = true;
                        sonarrSummary.seriesFound = false;
                        await ctx.warn('sonarr: series not found (skipping episode unmonitor)', {
                            title: seriesTitle,
                            tvdbId: tvdbIdInput ?? null,
                        });
                    }
                    else {
                        sonarrSummary.connected = true;
                        sonarrSummary.seriesFound = true;
                        sonarrSummary.seriesId = typeof series.id === 'number' ? series.id : null;
                        const episodes = await this.sonarr.getEpisodesBySeries({
                            baseUrl: sonarrBaseUrl,
                            apiKey: sonarrApiKey,
                            seriesId: series.id,
                        });
                        const episode = episodes.find((ep) => toInt(ep.seasonNumber) === seasonNum &&
                            toInt(ep.episodeNumber) === epNum);
                        if (!episode) {
                            sonarrSummary.episodeFound = false;
                            await ctx.warn('sonarr: episode not found (skipping)', {
                                title: seriesTitle,
                                season: seasonNum,
                                episode: epNum,
                            });
                        }
                        else if (!episode.monitored) {
                            sonarrSummary.episodeFound = true;
                            sonarrSummary.monitoredBefore = false;
                            await ctx.info('sonarr: episode already unmonitored', {
                                title: seriesTitle,
                                season: seasonNum,
                                episode: epNum,
                            });
                        }
                        else if (ctx.dryRun) {
                            sonarrSummary.episodeFound = true;
                            sonarrSummary.monitoredBefore = true;
                            sonarrSummary.wouldUnmonitor = true;
                            sonarrSummary.episodesWouldUnmonitor = 1;
                            await ctx.info('sonarr: dry-run would unmonitor episode', {
                                title: seriesTitle,
                                season: seasonNum,
                                episode: epNum,
                            });
                        }
                        else {
                            await this.sonarr.setEpisodeMonitored({
                                baseUrl: sonarrBaseUrl,
                                apiKey: sonarrApiKey,
                                episode,
                                monitored: false,
                            });
                            sonarrSummary.episodeFound = true;
                            sonarrSummary.monitoredBefore = true;
                            sonarrSummary.episodeUnmonitored = true;
                            sonarrSummary.episodesUnmonitored = 1;
                            await ctx.info('sonarr: episode unmonitored', {
                                title: seriesTitle,
                                season: seasonNum,
                                episode: epNum,
                            });
                        }
                    }
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    sonarrSummary.connected = false;
                    sonarrSummary.error = msg;
                    summary.warnings.push(`sonarr: episode unmonitor failed (continuing): ${msg}`);
                    await ctx.warn('sonarr: episode unmonitor failed (continuing)', {
                        error: msg,
                    });
                }
            }
            else {
                sonarrSummary.connected = null;
                await ctx.info('sonarr: not configured (skipping episode unmonitor)', {});
            }
            summary.sonarr = sonarrSummary;
            await ctx.info('mediaAddedCleanup(episode): done', summary);
            return toReport(summary);
        }
        await ctx.warn('mediaAddedCleanup: unsupported mediaType (skipping)', {
            mediaType,
        });
        summary.skipped = true;
        return toReport(summary);
    }
};
exports.CleanupAfterAddingNewContentJob = CleanupAfterAddingNewContentJob;
exports.CleanupAfterAddingNewContentJob = CleanupAfterAddingNewContentJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService,
        plex_watchlist_service_1.PlexWatchlistService,
        plex_duplicates_service_1.PlexDuplicatesService,
        radarr_service_1.RadarrService,
        sonarr_service_1.SonarrService])
], CleanupAfterAddingNewContentJob);
function asNum(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function buildMediaAddedCleanupReport(params) {
    const { ctx, raw } = params;
    const rawRec = raw;
    const issues = [];
    const warningsRaw = Array.isArray(rawRec.warnings)
        ? rawRec.warnings
            .map((w) => String(w ?? '').trim())
            .filter(Boolean)
        : [];
    const mediaType = (pickString(rawRec, 'mediaType') ?? '').toLowerCase();
    const plexEvent = pickString(rawRec, 'plexEvent') ?? null;
    const title = pickString(rawRec, 'title') ?? '';
    const year = pickNumber(rawRec, 'year');
    const ratingKey = pickString(rawRec, 'ratingKey') ?? null;
    const showTitle = pickString(rawRec, 'showTitle') ?? null;
    const showRatingKey = pickString(rawRec, 'showRatingKey') ?? null;
    const seasonNumber = pickNumber(rawRec, 'seasonNumber');
    const episodeNumber = pickNumber(rawRec, 'episodeNumber');
    const duplicates = isPlainObject(rawRec.duplicates)
        ? rawRec.duplicates
        : null;
    const watchlist = isPlainObject(rawRec.watchlist)
        ? rawRec.watchlist
        : null;
    const radarr = isPlainObject(rawRec.radarr)
        ? rawRec.radarr
        : null;
    const sonarr = isPlainObject(rawRec.sonarr)
        ? rawRec.sonarr
        : null;
    const asBool = (v) => typeof v === 'boolean' ? v : null;
    const radarrConfigured = radarr ? asBool(radarr.configured) : null;
    const radarrConnected = radarr ? asBool(radarr.connected) : null;
    const sonarrConfigured = sonarr ? asBool(sonarr.configured) : null;
    const sonarrConnected = sonarr ? asBool(sonarr.connected) : null;
    const hasRadarrIssue = (radarrConfigured === true && radarrConnected === false) ||
        warningsRaw.some((w) => w.toLowerCase().startsWith('radarr:'));
    const hasSonarrIssue = (sonarrConfigured === true && sonarrConnected === false) ||
        warningsRaw.some((w) => w.toLowerCase().startsWith('sonarr:'));
    if (hasRadarrIssue)
        issues.push((0, job_report_v1_1.issue)('warn', 'Unable to connect to Radarr.'));
    if (hasSonarrIssue)
        issues.push((0, job_report_v1_1.issue)('warn', 'Unable to connect to Sonarr.'));
    for (const w of warningsRaw) {
        const lower = w.toLowerCase();
        if (lower.startsWith('radarr:'))
            continue;
        if (lower.startsWith('sonarr:'))
            continue;
        issues.push((0, job_report_v1_1.issue)('warn', w));
    }
    const num = (v) => {
        if (typeof v === 'number' && Number.isFinite(v))
            return v;
        if (typeof v === 'string' && v.trim()) {
            const n = Number.parseInt(v.trim(), 10);
            return Number.isFinite(n) ? n : null;
        }
        return null;
    };
    const versionDeletedCount = (vc) => {
        if (!isPlainObject(vc))
            return 0;
        const rec = vc;
        const deleted = num(rec.deleted) ?? 0;
        const wouldDelete = num(rec.wouldDelete) ?? 0;
        return ctx.dryRun ? wouldDelete : deleted;
    };
    const versionCopiesCount = (vc) => {
        if (!isPlainObject(vc))
            return null;
        return num(vc.copies);
    };
    let movieDuplicatesDeleted = 0;
    let episodeDuplicatesDeleted = 0;
    let movieDuplicatesFound = null;
    let episodeDuplicatesFound = null;
    if (duplicates) {
        const mode = typeof duplicates.mode === 'string' ? duplicates.mode.trim() : '';
        if (isPlainObject(duplicates.movie) || isPlainObject(duplicates.episode)) {
            const m = isPlainObject(duplicates.movie)
                ? duplicates.movie
                : null;
            const e = isPlainObject(duplicates.episode)
                ? duplicates.episode
                : null;
            const mMeta = m
                ? (ctx.dryRun ? num(m.metadataWouldDelete) : num(m.metadataDeleted)) ?? 0
                : 0;
            const mParts = m
                ? (ctx.dryRun ? num(m.partsWouldDelete) : num(m.partsDeleted)) ?? 0
                : 0;
            movieDuplicatesDeleted = mMeta + mParts;
            movieDuplicatesFound = m
                ? movieDuplicatesDeleted > 0 || (num(m.groupsWithDuplicates) ?? 0) > 0
                : null;
            const eMeta = e
                ? (ctx.dryRun ? num(e.metadataWouldDelete) : num(e.metadataDeleted)) ?? 0
                : 0;
            const eParts = e
                ? (ctx.dryRun ? num(e.partsWouldDelete) : num(e.partsDeleted)) ?? 0
                : 0;
            episodeDuplicatesDeleted = eMeta + eParts;
            episodeDuplicatesFound = e
                ? episodeDuplicatesDeleted > 0 || (num(e.groupsWithDuplicates) ?? 0) > 0
                : null;
        }
        else if (mode.startsWith('movie')) {
            const metaDeleted = (ctx.dryRun
                ? num(duplicates.wouldDeleteMetadata)
                : num(duplicates.deletedMetadata)) ?? 0;
            const partsDeleted = versionDeletedCount(duplicates.versionCleanup);
            movieDuplicatesDeleted = metaDeleted + partsDeleted;
            const candidates = num(duplicates.candidates) ?? 0;
            const copies = versionCopiesCount(duplicates.versionCleanup);
            movieDuplicatesFound =
                movieDuplicatesDeleted > 0 || candidates > 1 || (copies !== null && copies > 1);
        }
        else if (mode.startsWith('episode')) {
            const metaDeleted = (ctx.dryRun
                ? num(duplicates.wouldDeleteMetadata)
                : num(duplicates.deletedMetadata)) ?? 0;
            const partsDeleted = versionDeletedCount(duplicates.versionCleanup);
            episodeDuplicatesDeleted = metaDeleted + partsDeleted;
            const candidates = num(duplicates.candidates) ?? 0;
            const copies = versionCopiesCount(duplicates.versionCleanup);
            episodeDuplicatesFound =
                episodeDuplicatesDeleted > 0 || candidates > 1 || (copies !== null && copies > 1);
        }
        if (Array.isArray(duplicates.warnings)) {
            issues.push(...(0, job_report_v1_1.issuesFromWarnings)(duplicates.warnings));
        }
    }
    let watchlistMovieRemoved = 0;
    let watchlistShowRemoved = 0;
    let watchlistChecked = false;
    let watchlistAttempted = null;
    let watchlistRemoved = null;
    let watchlistMatchedBy = null;
    let watchlistError = null;
    if (watchlist) {
        const mode = typeof watchlist.mode === 'string' ? watchlist.mode.trim() : null;
        if (mode === 'reconcile') {
            watchlistChecked = true;
            const wlMovies = isPlainObject(watchlist.movies)
                ? watchlist.movies
                : null;
            const wlShows = isPlainObject(watchlist.shows)
                ? watchlist.shows
                : null;
            watchlistMovieRemoved =
                wlMovies && (ctx.dryRun ? num(wlMovies.wouldRemove) : num(wlMovies.removed))
                    ? ((ctx.dryRun ? num(wlMovies.wouldRemove) : num(wlMovies.removed)) ?? 0)
                    : 0;
            watchlistShowRemoved =
                wlShows && (ctx.dryRun ? num(wlShows.wouldRemove) : num(wlShows.removed))
                    ? ((ctx.dryRun ? num(wlShows.wouldRemove) : num(wlShows.removed)) ?? 0)
                    : 0;
        }
        else {
            if ('baseUrlTried' in watchlist || 'error' in watchlist) {
                watchlistChecked = true;
            }
            watchlistAttempted = num(watchlist.attempted);
            watchlistRemoved = num(watchlist.removed);
            watchlistMatchedBy =
                typeof watchlist.matchedBy === 'string' ? watchlist.matchedBy : null;
            watchlistError = typeof watchlist.error === 'string' ? watchlist.error : null;
            const removed = watchlistRemoved ?? 0;
            if (mediaType === 'movie')
                watchlistMovieRemoved = removed;
            else if (mediaType === 'show' || mediaType === 'season')
                watchlistShowRemoved = removed;
        }
    }
    const radarrMovieUnmonitored = (() => {
        if (!radarr)
            return 0;
        if (ctx.dryRun) {
            const n = num(radarr.moviesWouldUnmonitor);
            if (n !== null)
                return n;
            return asBool(radarr.wouldUnmonitor) ? 1 : 0;
        }
        const n = num(radarr.moviesUnmonitored);
        if (n !== null)
            return n;
        return asBool(radarr.unmonitored) ? 1 : 0;
    })();
    const sonarrEpisodeUnmonitored = (() => {
        if (!sonarr)
            return 0;
        if (ctx.dryRun) {
            const n = num(sonarr.episodesWouldUnmonitor);
            if (n !== null)
                return n;
            return asBool(sonarr.wouldUnmonitor) ? 1 : 0;
        }
        const n = num(sonarr.episodesUnmonitored);
        if (n !== null)
            return n;
        return asBool(sonarr.episodeUnmonitored) ? 1 : 0;
    })();
    const sonarrSeasonUnmonitored = (() => {
        if (!sonarr)
            return null;
        const n = ctx.dryRun
            ? num(sonarr.seasonsWouldUnmonitor)
            : num(sonarr.seasonsUnmonitored);
        return n;
    })();
    const pad2 = (n) => typeof n === 'number' && Number.isFinite(n) ? String(n).padStart(2, '0') : '??';
    const addedLabel = (() => {
        if (mediaType === 'movie') {
            return `${title || 'Movie'}${year ? ` (${year})` : ''}`;
        }
        if (mediaType === 'episode') {
            const ep = `S${pad2(seasonNumber)}E${pad2(episodeNumber)}`;
            const show = showTitle || 'Show';
            return `${show} ${ep}${title ? ` — ${title}` : ''}`;
        }
        if (mediaType === 'season') {
            const show = showTitle || title || 'Show';
            return `${show} — Season ${seasonNumber ?? '??'}`;
        }
        if (mediaType === 'show')
            return title || 'Show';
        return title || mediaType || 'Unknown';
    })();
    const duplicatesApplicable = mediaType === 'movie' ||
        mediaType === 'episode' ||
        mediaType === 'season' ||
        mediaType === 'show';
    const duplicatesFound = mediaType === 'movie'
        ? movieDuplicatesFound ?? movieDuplicatesDeleted > 0
        : mediaType === 'episode' || mediaType === 'season' || mediaType === 'show'
            ? episodeDuplicatesFound ?? episodeDuplicatesDeleted > 0
            : null;
    const duplicatesDeleted = mediaType === 'movie'
        ? movieDuplicatesDeleted
        : mediaType === 'episode' || mediaType === 'season' || mediaType === 'show'
            ? episodeDuplicatesDeleted
            : 0;
    const watchlistApplicable = mediaType === 'movie' || mediaType === 'show' || mediaType === 'season';
    const isFullSweep = duplicates && typeof duplicates.mode === 'string'
        ? String(duplicates.mode).trim() === 'fullSweep'
        : false;
    const arrService = mediaType === 'movie'
        ? 'radarr'
        : mediaType === 'episode' || mediaType === 'show' || mediaType === 'season'
            ? 'sonarr'
            : null;
    const arrTask = (() => {
        if (!arrService) {
            return {
                status: 'skipped',
                facts: [
                    { label: 'Service', value: 'n/a' },
                    { label: 'Note', value: 'Not applicable for this media type.' },
                ],
                issues: [],
            };
        }
        const rec = arrService === 'radarr' ? radarr : sonarr;
        const configured = rec ? asBool(rec.configured) : null;
        const connected = rec ? asBool(rec.connected) : null;
        const error = rec && typeof rec.error === 'string' ? rec.error : null;
        const unmonitored = (() => {
            if (!rec)
                return null;
            if (arrService === 'radarr') {
                const c = ctx.dryRun ? num(rec.moviesWouldUnmonitor) : num(rec.moviesUnmonitored);
                if (c !== null)
                    return c;
                return asBool(ctx.dryRun ? rec.wouldUnmonitor : rec.unmonitored) ? 1 : 0;
            }
            const c = ctx.dryRun ? num(rec.episodesWouldUnmonitor) : num(rec.episodesUnmonitored);
            if (c !== null)
                return c;
            return asBool(ctx.dryRun ? rec.wouldUnmonitor : rec.episodeUnmonitored) ? 1 : 0;
        })();
        const facts = [
            { label: 'Service', value: arrService === 'radarr' ? 'Radarr' : 'Sonarr' },
            { label: 'Configured', value: configured },
            { label: 'Connected', value: connected },
            ...(error ? [{ label: 'Error', value: error }] : []),
        ];
        if (arrService === 'radarr' && rec) {
            facts.push({ label: 'Movie found', value: asBool(rec.movieFound) }, { label: 'Unmonitored', value: unmonitored });
        }
        if (arrService === 'sonarr' && rec) {
            facts.push({ label: 'Series found', value: asBool(rec.seriesFound) }, ...(mediaType === 'episode' ? [{ label: 'Episode found', value: asBool(rec.episodeFound) }] : []), { label: 'Unmonitored', value: unmonitored });
        }
        const failReasons = [];
        if (configured === false) {
            failReasons.push(`${arrService === 'radarr' ? 'Radarr' : 'Sonarr'} not configured.`);
        }
        else if (configured === true && connected === false) {
            failReasons.push(`Unable to connect to ${arrService === 'radarr' ? 'Radarr' : 'Sonarr'}.`);
        }
        const status = failReasons.length ? 'skipped' : 'success';
        const issues = failReasons.length ? failReasons.map((m) => (0, job_report_v1_1.issue)('warn', m)) : [];
        return { status, facts, issues };
    })();
    const tasks = isFullSweep
        ? [
            {
                id: 'duplicates',
                title: 'Full sweep: cleaned Plex duplicates',
                status: 'success',
                facts: [
                    { label: ctx.dryRun ? 'Would delete (movie)' : 'Deleted (movie)', value: movieDuplicatesDeleted },
                    { label: ctx.dryRun ? 'Would delete (episode)' : 'Deleted (episode)', value: episodeDuplicatesDeleted },
                    ...(duplicates && isPlainObject(duplicates.movie)
                        ? [
                            { label: 'Movie groups (dup)', value: num(duplicates.movie.groupsWithDuplicates) ?? 0 },
                            {
                                label: ctx.dryRun ? 'Radarr would unmonitor' : 'Radarr unmonitored',
                                value: (ctx.dryRun
                                    ? num(duplicates.movie.radarrWouldUnmonitor)
                                    : num(duplicates.movie.radarrUnmonitored)) ?? 0,
                            },
                            ...(Array.isArray(duplicates.movie.deletedMetadataItems)
                                ? [
                                    {
                                        label: 'Deleted movie metadata (items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(duplicates.movie.metadataWouldDelete) ?? 0
                                                : num(duplicates.movie.metadataDeleted) ?? 0,
                                            unit: 'items',
                                            items: duplicates.movie.deletedMetadataItems,
                                        },
                                    },
                                ]
                                : []),
                            ...(Array.isArray(duplicates.movie.deletedVersionItems)
                                ? [
                                    {
                                        label: 'Deleted movie versions (items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(duplicates.movie.partsWouldDelete) ?? 0
                                                : num(duplicates.movie.partsDeleted) ?? 0,
                                            unit: 'versions',
                                            items: duplicates.movie.deletedVersionItems,
                                        },
                                    },
                                ]
                                : []),
                            ...(Array.isArray(duplicates.movie.radarrUnmonitoredItems)
                                ? [
                                    {
                                        label: ctx.dryRun ? 'Radarr would unmonitor (items)' : 'Radarr unmonitored (items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(duplicates.movie.radarrWouldUnmonitor) ?? 0
                                                : num(duplicates.movie.radarrUnmonitored) ?? 0,
                                            unit: 'movies',
                                            items: duplicates.movie.radarrUnmonitoredItems,
                                        },
                                    },
                                ]
                                : []),
                        ]
                        : []),
                    ...(duplicates && isPlainObject(duplicates.episode)
                        ? [
                            { label: 'Episode groups (dup)', value: num(duplicates.episode.groupsWithDuplicates) ?? 0 },
                            {
                                label: ctx.dryRun ? 'Sonarr would unmonitor (ep)' : 'Sonarr unmonitored (ep)',
                                value: (ctx.dryRun
                                    ? num(duplicates.episode.sonarrWouldUnmonitor)
                                    : num(duplicates.episode.sonarrUnmonitored)) ?? 0,
                            },
                            ...(Array.isArray(duplicates.episode.deletedMetadataItems)
                                ? [
                                    {
                                        label: 'Deleted episode metadata (items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(duplicates.episode.metadataWouldDelete) ?? 0
                                                : num(duplicates.episode.metadataDeleted) ?? 0,
                                            unit: 'items',
                                            items: duplicates.episode.deletedMetadataItems,
                                        },
                                    },
                                ]
                                : []),
                            ...(Array.isArray(duplicates.episode.deletedVersionItems)
                                ? [
                                    {
                                        label: 'Deleted episode versions (items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(duplicates.episode.partsWouldDelete) ?? 0
                                                : num(duplicates.episode.partsDeleted) ?? 0,
                                            unit: 'versions',
                                            items: duplicates.episode.deletedVersionItems,
                                        },
                                    },
                                ]
                                : []),
                            ...(Array.isArray(duplicates.episode.sonarrUnmonitoredItems)
                                ? [
                                    {
                                        label: ctx.dryRun
                                            ? 'Sonarr would unmonitor (items)'
                                            : 'Sonarr unmonitored (items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(duplicates.episode.sonarrWouldUnmonitor) ?? 0
                                                : num(duplicates.episode.sonarrUnmonitored) ?? 0,
                                            unit: 'episodes',
                                            items: duplicates.episode.sonarrUnmonitoredItems,
                                        },
                                    },
                                ]
                                : []),
                        ]
                        : []),
                ],
                issues: [],
            },
            {
                id: 'watchlist',
                title: 'Full sweep: reconciled Plex watchlist',
                status: watchlistChecked ? 'success' : 'failed',
                facts: [
                    { label: ctx.dryRun ? 'Would remove (movies)' : 'Removed (movies)', value: watchlistMovieRemoved },
                    { label: ctx.dryRun ? 'Would remove (shows)' : 'Removed (shows)', value: watchlistShowRemoved },
                    ...(watchlist && isPlainObject(watchlist.movies)
                        ? [
                            {
                                label: ctx.dryRun ? 'Radarr would unmonitor' : 'Radarr unmonitored',
                                value: (ctx.dryRun
                                    ? num(watchlist.movies.radarrWouldUnmonitor)
                                    : num(watchlist.movies.radarrUnmonitored)) ?? 0,
                            },
                            ...(Array.isArray(watchlist.movies.removedItems)
                                ? [
                                    {
                                        label: ctx.dryRun ? 'Would remove (movie items)' : 'Removed (movie items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(watchlist.movies.wouldRemove) ?? 0
                                                : num(watchlist.movies.removed) ?? 0,
                                            unit: 'movies',
                                            items: watchlist.movies.removedItems,
                                        },
                                    },
                                ]
                                : []),
                            ...(Array.isArray(watchlist.movies.radarrUnmonitoredItems)
                                ? [
                                    {
                                        label: ctx.dryRun
                                            ? 'Radarr would unmonitor (movie items)'
                                            : 'Radarr unmonitored (movie items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(watchlist.movies.radarrWouldUnmonitor) ?? 0
                                                : num(watchlist.movies.radarrUnmonitored) ?? 0,
                                            unit: 'movies',
                                            items: watchlist.movies.radarrUnmonitoredItems,
                                        },
                                    },
                                ]
                                : []),
                        ]
                        : []),
                    ...(watchlist && isPlainObject(watchlist.shows)
                        ? [
                            {
                                label: ctx.dryRun ? 'Sonarr would unmonitor (series)' : 'Sonarr unmonitored (series)',
                                value: (ctx.dryRun
                                    ? num(watchlist.shows.sonarrWouldUnmonitor)
                                    : num(watchlist.shows.sonarrUnmonitored)) ?? 0,
                            },
                            ...(Array.isArray(watchlist.shows.removedItems)
                                ? [
                                    {
                                        label: ctx.dryRun ? 'Would remove (show items)' : 'Removed (show items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(watchlist.shows.wouldRemove) ?? 0
                                                : num(watchlist.shows.removed) ?? 0,
                                            unit: 'shows',
                                            items: watchlist.shows.removedItems,
                                        },
                                    },
                                ]
                                : []),
                            ...(Array.isArray(watchlist.shows.sonarrUnmonitoredItems)
                                ? [
                                    {
                                        label: ctx.dryRun
                                            ? 'Sonarr would unmonitor (show items)'
                                            : 'Sonarr unmonitored (show items)',
                                        value: {
                                            count: ctx.dryRun
                                                ? num(watchlist.shows.sonarrWouldUnmonitor) ?? 0
                                                : num(watchlist.shows.sonarrUnmonitored) ?? 0,
                                            unit: 'shows',
                                            items: watchlist.shows.sonarrUnmonitoredItems,
                                        },
                                    },
                                ]
                                : []),
                        ]
                        : []),
                ],
                issues: watchlistChecked ? [] : [(0, job_report_v1_1.issue)('error', 'Plex watchlist reconciliation was not executed.')],
            },
            {
                id: 'arr',
                title: 'Updated Radarr/Sonarr monitoring',
                status: (radarr && asBool(radarr.configured) === false) &&
                    (sonarr && asBool(sonarr.configured) === false)
                    ? 'skipped'
                    : 'success',
                facts: [
                    { label: 'Radarr movies', value: radarrMovieUnmonitored },
                    { label: 'Sonarr episodes', value: sonarrEpisodeUnmonitored },
                    ...(sonarr && num(sonarr.seasonsUnmonitored) !== null
                        ? [{ label: 'Sonarr seasons', value: num(sonarr.seasonsUnmonitored) ?? 0 }]
                        : []),
                    ...(ctx.dryRun && sonarr && num(sonarr.seasonsWouldUnmonitor) !== null
                        ? [{ label: 'Sonarr seasons (dry-run)', value: num(sonarr.seasonsWouldUnmonitor) ?? 0 }]
                        : []),
                ],
                issues: [
                    ...(radarr && asBool(radarr.configured) === false
                        ? [(0, job_report_v1_1.issue)('warn', 'Radarr not configured.')]
                        : []),
                    ...(sonarr && asBool(sonarr.configured) === false
                        ? [(0, job_report_v1_1.issue)('warn', 'Sonarr not configured.')]
                        : []),
                ],
            },
        ]
        : [
            {
                id: 'added',
                title: 'Added content',
                status: 'success',
                facts: [
                    ...(plexEvent ? [{ label: 'Plex event', value: plexEvent }] : []),
                    { label: 'Media', value: addedLabel },
                    ...(ratingKey ? [{ label: 'Plex ratingKey', value: ratingKey }] : []),
                ],
                issues: [],
            },
            {
                id: 'duplicates',
                title: 'Scanned for duplicates',
                status: duplicatesApplicable ? 'success' : 'skipped',
                facts: duplicatesApplicable
                    ? [
                        { label: 'Found', value: duplicatesFound ? 'found' : 'not found' },
                        { label: ctx.dryRun ? 'Would delete' : 'Deleted', value: duplicatesDeleted },
                        ...(duplicates && typeof duplicates.librarySectionTitle === 'string'
                            ? [{ label: 'Library', value: duplicates.librarySectionTitle }]
                            : []),
                        ...(mediaType === 'episode' &&
                            duplicates &&
                            typeof duplicates.showRatingKey === 'string'
                            ? [{ label: 'Show ratingKey', value: duplicates.showRatingKey }]
                            : []),
                    ]
                    : [{ label: 'Note', value: 'Not scanned for this media type.' }],
                issues: [],
            },
            {
                id: 'watchlist',
                title: 'Checked Plex watchlist',
                status: watchlistApplicable ? (watchlistChecked ? 'success' : 'failed') : 'skipped',
                facts: watchlistApplicable
                    ? [
                        { label: 'Found', value: (watchlistAttempted ?? 0) > 0 ? 'found' : 'not found' },
                        { label: ctx.dryRun ? 'Would remove' : 'Removed', value: watchlistRemoved ?? 0 },
                        ...(watchlistMatchedBy ? [{ label: 'Matched by', value: watchlistMatchedBy }] : []),
                        ...(watchlistError ? [{ label: 'Error', value: watchlistError }] : []),
                    ]
                    : [{ label: 'Note', value: 'Not checked for episodes.' }],
                issues: watchlistApplicable && !watchlistChecked
                    ? [(0, job_report_v1_1.issue)('error', 'Plex watchlist check was not executed.')]
                    : [],
            },
            {
                id: 'arr',
                title: arrService === 'radarr'
                    ? 'Scanned in Radarr'
                    : arrService === 'sonarr'
                        ? 'Scanned in Sonarr'
                        : 'Scanned in Radarr/Sonarr',
                status: arrTask.status,
                facts: arrTask.facts,
                issues: arrTask.issues,
            },
        ];
    const sections = [
        {
            id: 'unmonitored',
            title: 'Unmonitored',
            rows: [
                (0, job_report_v1_1.metricRow)({
                    label: 'Radarr (movie)',
                    end: radarrMovieUnmonitored,
                    unit: 'items',
                    note: ctx.dryRun ? 'dry-run (would unmonitor)' : null,
                }),
                (0, job_report_v1_1.metricRow)({
                    label: 'Sonarr (episode)',
                    end: sonarrEpisodeUnmonitored,
                    unit: 'items',
                    note: ctx.dryRun ? 'dry-run (would unmonitor)' : null,
                }),
                ...(sonarrSeasonUnmonitored !== null && sonarrSeasonUnmonitored > 0
                    ? [
                        (0, job_report_v1_1.metricRow)({
                            label: 'Sonarr (season)',
                            end: sonarrSeasonUnmonitored,
                            unit: 'items',
                            note: ctx.dryRun ? 'dry-run (would unmonitor)' : null,
                        }),
                    ]
                    : []),
            ],
        },
        {
            id: 'duplicates',
            title: 'Duplicates',
            rows: [
                (0, job_report_v1_1.metricRow)({
                    label: 'Movie deleted',
                    end: movieDuplicatesDeleted,
                    unit: 'copies',
                    note: ctx.dryRun ? 'dry-run (would delete)' : null,
                }),
                (0, job_report_v1_1.metricRow)({
                    label: 'Episode deleted',
                    end: episodeDuplicatesDeleted,
                    unit: 'copies',
                    note: ctx.dryRun ? 'dry-run (would delete)' : null,
                }),
            ],
        },
        {
            id: 'watchlist',
            title: 'Watchlist',
            rows: [
                (0, job_report_v1_1.metricRow)({
                    label: 'Movie removed',
                    end: watchlistMovieRemoved,
                    unit: 'items',
                    note: ctx.dryRun ? 'dry-run (would remove)' : null,
                }),
                (0, job_report_v1_1.metricRow)({
                    label: 'Show removed',
                    end: watchlistShowRemoved,
                    unit: 'items',
                    note: ctx.dryRun ? 'dry-run (would remove)' : null,
                }),
            ],
        },
    ];
    return {
        template: 'jobReportV1',
        version: 1,
        jobId: ctx.jobId,
        dryRun: ctx.dryRun,
        trigger: ctx.trigger,
        headline: '',
        sections,
        tasks,
        issues,
        raw,
    };
}
//# sourceMappingURL=cleanup-after-adding-new-content.job.js.map