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
var ImmaculateTasteRefresherJob_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImmaculateTasteRefresherJob = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../db/prisma.service");
const plex_curated_collections_service_1 = require("../plex/plex-curated-collections.service");
const plex_collections_utils_1 = require("../plex/plex-collections.utils");
const plex_library_selection_utils_1 = require("../plex/plex-library-selection.utils");
const plex_server_service_1 = require("../plex/plex-server.service");
const plex_users_service_1 = require("../plex/plex-users.service");
const settings_service_1 = require("../settings/settings.service");
const immaculate_taste_collection_service_1 = require("../immaculate-taste-collection/immaculate-taste-collection.service");
const immaculate_taste_show_collection_service_1 = require("../immaculate-taste-collection/immaculate-taste-show-collection.service");
const tmdb_service_1 = require("../tmdb/tmdb.service");
const job_report_v1_1 = require("./job-report-v1");
const immaculate_taste_reset_1 = require("../immaculate-taste-collection/immaculate-taste-reset");
const refresher_sweep_utils_1 = require("./refresher-sweep.utils");
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
    return typeof v === 'string' ? v.trim() : '';
}
function pickNumber(obj, path) {
    const v = pick(obj, path);
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim()) {
        const n = Number.parseFloat(v.trim());
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function normalizeHttpUrl(raw) {
    const trimmed = raw.trim();
    const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('baseUrl must be a valid http(s) URL');
    }
    return baseUrl;
}
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
let ImmaculateTasteRefresherJob = class ImmaculateTasteRefresherJob {
    static { ImmaculateTasteRefresherJob_1 = this; }
    prisma;
    settingsService;
    plexServer;
    plexCurated;
    plexUsers;
    immaculateTaste;
    immaculateTasteTv;
    tmdb;
    static COLLECTION_NAME = 'Inspired by your Immaculate Taste';
    static ACTIVATION_POINTS = 50;
    constructor(prisma, settingsService, plexServer, plexCurated, plexUsers, immaculateTaste, immaculateTasteTv, tmdb) {
        this.prisma = prisma;
        this.settingsService = settingsService;
        this.plexServer = plexServer;
        this.plexCurated = plexCurated;
        this.plexUsers = plexUsers;
        this.immaculateTaste = immaculateTaste;
        this.immaculateTasteTv = immaculateTasteTv;
        this.tmdb = tmdb;
    }
    async run(ctx) {
        const input = ctx.input ?? {};
        const mode = (0, refresher_sweep_utils_1.hasExplicitRefresherScopeInput)(input)
            ? 'targeted'
            : 'sweep';
        if (mode === 'sweep') {
            return await this.runSweep(ctx, input);
        }
        const forceAllLibraries = input['__forceAllLibraries'] === true;
        const { plexUserId, plexUserTitle, pinCollections } = await this.resolvePlexUserContext(ctx);
        const pinTarget = pinCollections
            ? 'admin'
            : 'friends';
        const limitRaw = typeof input['limit'] === 'number' ? input['limit'] : null;
        const limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw)
            ? Math.max(1, Math.trunc(limitRaw))
            : null;
        const includeMovies = typeof input['includeMovies'] === 'boolean' ? input['includeMovies'] : true;
        const includeTv = typeof input['includeTv'] === 'boolean' ? input['includeTv'] : true;
        const inputMovieSectionKey = typeof input['movieSectionKey'] === 'string' ? input['movieSectionKey'].trim() : '';
        const inputTvSectionKey = typeof input['tvSectionKey'] === 'string' ? input['tvSectionKey'].trim() : '';
        const seedLibrarySectionId = typeof input['seedLibrarySectionId'] === 'number' &&
            Number.isFinite(input['seedLibrarySectionId'])
            ? String(Math.trunc(input['seedLibrarySectionId']))
            : typeof input['seedLibrarySectionId'] === 'string'
                ? input['seedLibrarySectionId'].trim()
                : '';
        const { settings, secrets } = await this.settingsService.getInternalSettings(ctx.userId);
        if (ctx.jobId === 'immaculateTasteRefresher') {
            void ctx
                .patchSummary({
                progress: {
                    step: 'dataset',
                    message: 'Locating Immaculate Taste datasets…',
                    updatedAt: new Date().toISOString(),
                },
            })
                .catch(() => undefined);
        }
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const plexToken = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!plexBaseUrlRaw)
            throw new Error('Plex baseUrl is not set');
        if (!plexToken)
            throw new Error('Plex token is not set');
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        let preferredMovieSectionKey = inputMovieSectionKey || seedLibrarySectionId || '';
        let preferredTvSectionKey = inputTvSectionKey || seedLibrarySectionId || '';
        const sections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const librarySelection = (0, plex_library_selection_utils_1.resolvePlexLibrarySelection)({ settings, sections });
        const selectedSectionKeySet = new Set(librarySelection.selectedSectionKeys);
        const allMovieSectionKeySet = new Set(sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
            .map((s) => s.key));
        const allTvSectionKeySet = new Set(sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'show')
            .map((s) => s.key));
        const movieSectionsAll = sections.filter((s) => (s.type ?? '').toLowerCase() === 'movie' &&
            selectedSectionKeySet.has(s.key));
        const tvSectionsAll = sections.filter((s) => (s.type ?? '').toLowerCase() === 'show' &&
            selectedSectionKeySet.has(s.key));
        if (ctx.jobId === 'immaculateTasteRefresher') {
            void ctx
                .patchSummary({
                progress: {
                    step: 'plex_libraries',
                    message: 'Scanning Plex movie + TV libraries…',
                    updatedAt: new Date().toISOString(),
                },
            })
                .catch(() => undefined);
        }
        const movieSections = inputMovieSectionKey
            ? movieSectionsAll.filter((s) => s.key === inputMovieSectionKey)
            : movieSectionsAll;
        const tvSections = inputTvSectionKey
            ? tvSectionsAll.filter((s) => s.key === inputTvSectionKey)
            : tvSectionsAll;
        const explicitMovieScopeExcluded = Boolean(inputMovieSectionKey) &&
            allMovieSectionKeySet.has(inputMovieSectionKey) &&
            !selectedSectionKeySet.has(inputMovieSectionKey);
        const explicitTvScopeExcluded = Boolean(inputTvSectionKey) &&
            allTvSectionKeySet.has(inputTvSectionKey) &&
            !selectedSectionKeySet.has(inputTvSectionKey);
        if (inputMovieSectionKey && includeMovies && !movieSections.length) {
            await ctx.warn(explicitMovieScopeExcluded
                ? 'immaculateTasteRefresher: requested movieSectionKey is excluded (skipping movie scope)'
                : 'immaculateTasteRefresher: requested movieSectionKey not found in selected libraries (falling back to selected movie libraries)', {
                movieSectionKey: inputMovieSectionKey,
                excluded: explicitMovieScopeExcluded,
            });
        }
        if (inputTvSectionKey && includeTv && !tvSections.length) {
            await ctx.warn(explicitTvScopeExcluded
                ? 'immaculateTasteRefresher: requested tvSectionKey is excluded (skipping TV scope)'
                : 'immaculateTasteRefresher: requested tvSectionKey not found in selected libraries (falling back to selected TV libraries)', {
                tvSectionKey: inputTvSectionKey,
                excluded: explicitTvScopeExcluded,
            });
        }
        const effectiveMovieSections = inputMovieSectionKey && includeMovies && !movieSections.length
            ? explicitMovieScopeExcluded
                ? []
                : movieSectionsAll
            : movieSections;
        const effectiveTvSections = inputTvSectionKey && includeTv && !tvSections.length
            ? explicitTvScopeExcluded
                ? []
                : tvSectionsAll
            : tvSections;
        let scopedMovieSections = effectiveMovieSections.slice();
        let scopedTvSections = effectiveTvSections.slice();
        let movieScopeSource = inputMovieSectionKey ? 'input_movieSectionKey' : 'auto';
        let tvScopeSource = inputTvSectionKey ? 'input_tvSectionKey' : 'auto';
        if (forceAllLibraries && includeMovies) {
            const movieRows = await this.prisma.immaculateTasteMovieLibrary.findMany({
                where: { plexUserId },
                select: { librarySectionKey: true },
                distinct: ['librarySectionKey'],
            });
            const movieKeySet = new Set(movieRows.map((row) => row.librarySectionKey));
            scopedMovieSections = scopedMovieSections.filter((s) => movieKeySet.has(s.key));
            movieScopeSource = 'dataset_movie_libraries';
            if (preferredMovieSectionKey && !movieKeySet.has(preferredMovieSectionKey)) {
                preferredMovieSectionKey = '';
            }
        }
        if (forceAllLibraries && includeTv) {
            const tvRows = await this.prisma.immaculateTasteShowLibrary.findMany({
                where: { plexUserId },
                select: { librarySectionKey: true },
                distinct: ['librarySectionKey'],
            });
            const tvKeySet = new Set(tvRows.map((row) => row.librarySectionKey));
            scopedTvSections = scopedTvSections.filter((s) => tvKeySet.has(s.key));
            tvScopeSource = 'dataset_tv_libraries';
            if (preferredTvSectionKey && !tvKeySet.has(preferredTvSectionKey)) {
                preferredTvSectionKey = '';
            }
        }
        if (includeMovies &&
            scopedMovieSections.length &&
            !inputMovieSectionKey &&
            !forceAllLibraries) {
            const scopedMovieSectionKeys = new Set(scopedMovieSections.map((s) => s.key));
            const recentMovieLibraries = await this.prisma.immaculateTasteMovieLibrary.findMany({
                where: {
                    plexUserId,
                    librarySectionKey: { in: scopedMovieSections.map((s) => s.key) },
                },
                select: { librarySectionKey: true, updatedAt: true },
                orderBy: { updatedAt: 'desc' },
                distinct: ['librarySectionKey'],
            });
            const latestScopedMovieSectionKey = recentMovieLibraries
                .map((row) => row.librarySectionKey)
                .find((key) => scopedMovieSectionKeys.has(key));
            const fallbackMovieSection = scopedMovieSections.find((s) => s.key === preferredMovieSectionKey) ??
                scopedMovieSections.find((s) => s.title.toLowerCase() === 'movies') ??
                scopedMovieSections[0];
            const selectedMovieSectionKey = preferredMovieSectionKey && scopedMovieSectionKeys.has(preferredMovieSectionKey)
                ? preferredMovieSectionKey
                : latestScopedMovieSectionKey ?? fallbackMovieSection?.key ?? '';
            if (selectedMovieSectionKey) {
                scopedMovieSections = scopedMovieSections.filter((s) => s.key === selectedMovieSectionKey);
                preferredMovieSectionKey = selectedMovieSectionKey;
                movieScopeSource = latestScopedMovieSectionKey
                    ? 'latest_movie_dataset'
                    : 'default_movie_library';
            }
        }
        if (includeTv && scopedTvSections.length && !inputTvSectionKey && !forceAllLibraries) {
            const scopedTvSectionKeys = new Set(scopedTvSections.map((s) => s.key));
            const recentTvLibraries = await this.prisma.immaculateTasteShowLibrary.findMany({
                where: {
                    plexUserId,
                    librarySectionKey: { in: scopedTvSections.map((s) => s.key) },
                },
                select: { librarySectionKey: true, updatedAt: true },
                orderBy: { updatedAt: 'desc' },
                distinct: ['librarySectionKey'],
            });
            const latestScopedTvSectionKey = recentTvLibraries
                .map((row) => row.librarySectionKey)
                .find((key) => scopedTvSectionKeys.has(key));
            const fallbackTvSection = scopedTvSections.find((s) => s.key === preferredTvSectionKey) ??
                scopedTvSections.find((s) => s.title.toLowerCase() === 'tv shows') ??
                scopedTvSections.find((s) => s.title.toLowerCase() === 'shows') ??
                scopedTvSections[0];
            const selectedTvSectionKey = preferredTvSectionKey && scopedTvSectionKeys.has(preferredTvSectionKey)
                ? preferredTvSectionKey
                : latestScopedTvSectionKey ?? fallbackTvSection?.key ?? '';
            if (selectedTvSectionKey) {
                scopedTvSections = scopedTvSections.filter((s) => s.key === selectedTvSectionKey);
                preferredTvSectionKey = selectedTvSectionKey;
                tvScopeSource = latestScopedTvSectionKey
                    ? 'latest_tv_dataset'
                    : 'default_tv_library';
            }
        }
        let orderedMovieSections = scopedMovieSections.slice().sort((a, b) => {
            if (a.key === preferredMovieSectionKey)
                return -1;
            if (b.key === preferredMovieSectionKey)
                return 1;
            return a.title.localeCompare(b.title);
        });
        const machineIdentifier = await this.plexServer.getMachineIdentifier({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const maxPoints = Math.trunc(pickNumber(settings, 'immaculateTaste.maxPoints') ?? 50) || 50;
        const plexCollectionName = (0, plex_collections_utils_1.buildUserCollectionName)(ImmaculateTasteRefresherJob_1.COLLECTION_NAME, plexUserTitle);
        const movieCollectionHubOrder = (0, plex_collections_utils_1.buildUserCollectionHubOrder)(plex_collections_utils_1.CURATED_MOVIE_COLLECTION_HUB_ORDER, plexUserTitle);
        const tvCollectionHubOrder = (0, plex_collections_utils_1.buildUserCollectionHubOrder)(plex_collections_utils_1.CURATED_TV_COLLECTION_HUB_ORDER, plexUserTitle);
        await ctx.info('immaculateTasteRefresher: start', {
            mode,
            dryRun: ctx.dryRun,
            plexUserId,
            plexUserTitle,
            pinCollections,
            pinTarget,
            forceAllLibraries,
            includeMovies,
            includeTv,
            movieLibraries: includeMovies ? orderedMovieSections.map((s) => s.title) : [],
            tvLibraries: includeTv ? scopedTvSections.map((s) => s.title) : [],
            movieScopeSource,
            tvScopeSource,
            collectionName: ImmaculateTasteRefresherJob_1.COLLECTION_NAME,
            plexCollectionName,
            maxPoints,
            activationPoints: ImmaculateTasteRefresherJob_1.ACTIVATION_POINTS,
            limit,
        });
        const tmdbApiKey = pickString(secrets, 'tmdb.apiKey') ||
            pickString(secrets, 'tmdbApiKey') ||
            pickString(secrets, 'tmdb.api_key') ||
            '';
        let movieSummary = {
            skipped: true,
            reason: 'no_selected_movie_libraries',
        };
        let tvSummary = {
            skipped: true,
            reason: 'no_selected_tv_libraries',
        };
        if (includeMovies && orderedMovieSections.length) {
            const sectionTmdbToItem = new Map();
            for (const sec of orderedMovieSections) {
                const tmdbMap = new Map();
                const rows = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey: sec.key,
                    sectionTitle: sec.title,
                });
                for (const r of rows) {
                    if (!r.tmdbId)
                        continue;
                    if (!tmdbMap.has(r.tmdbId))
                        tmdbMap.set(r.tmdbId, { ratingKey: r.ratingKey, title: r.title });
                }
                sectionTmdbToItem.set(sec.key, tmdbMap);
            }
            const canonicalMovieSectionKey = (() => {
                const movies = scopedMovieSections.find((s) => s.title.toLowerCase() === 'movies');
                if (movies)
                    return movies.key;
                const sorted = scopedMovieSections.slice().sort((a, b) => {
                    const aCount = sectionTmdbToItem.get(a.key)?.size ?? 0;
                    const bCount = sectionTmdbToItem.get(b.key)?.size ?? 0;
                    if (aCount !== bCount)
                        return bCount - aCount;
                    return a.title.localeCompare(b.title);
                });
                return sorted[0]?.key ?? scopedMovieSections[0].key;
            })();
            const canonicalMovieLibraryName = scopedMovieSections.find((s) => s.key === canonicalMovieSectionKey)?.title ??
                scopedMovieSections[0].title;
            orderedMovieSections = scopedMovieSections.slice().sort((a, b) => {
                if (a.key === preferredMovieSectionKey)
                    return -1;
                if (b.key === preferredMovieSectionKey)
                    return 1;
                if (a.key === canonicalMovieSectionKey)
                    return -1;
                if (b.key === canonicalMovieSectionKey)
                    return 1;
                return a.title.localeCompare(b.title);
            });
            await ctx.info('immaculateTasteRefresher: canonical library selected', {
                canonicalMovieLibraryName,
                canonicalMovieSectionKey,
            });
            if (!ctx.dryRun) {
                const legacyRows = await this.prisma.immaculateTasteMovie
                    .findMany({
                    select: {
                        tmdbId: true,
                        title: true,
                        status: true,
                        points: true,
                        tmdbVoteAvg: true,
                        tmdbVoteCount: true,
                    },
                })
                    .catch(() => []);
                if (legacyRows.length) {
                    let bootstrapped = 0;
                    for (const sec of orderedMovieSections) {
                        const resetMarkerKey = (0, immaculate_taste_reset_1.immaculateTasteResetMarkerKey)({
                            mediaType: 'movie',
                            librarySectionKey: sec.key,
                        });
                        const resetMarker = await this.prisma.setting
                            .findUnique({ where: { key: resetMarkerKey } })
                            .catch(() => null);
                        if (resetMarker) {
                            await ctx.info('immaculateTasteRefresher: skipping legacy bootstrap for reset library', { library: sec.title, movieSectionKey: sec.key });
                            continue;
                        }
                        const existing = await this.prisma.immaculateTasteMovieLibrary.count({
                            where: { plexUserId, librarySectionKey: sec.key },
                        });
                        if (existing > 0)
                            continue;
                        const batches = chunk(legacyRows, 200);
                        for (const batch of batches) {
                            await this.prisma.immaculateTasteMovieLibrary.createMany({
                                data: batch.map((r) => ({
                                    plexUserId,
                                    librarySectionKey: sec.key,
                                    tmdbId: r.tmdbId,
                                    title: r.title ?? undefined,
                                    status: r.status,
                                    points: r.points,
                                    tmdbVoteAvg: r.tmdbVoteAvg ?? undefined,
                                    tmdbVoteCount: r.tmdbVoteCount ?? undefined,
                                })),
                            });
                        }
                        bootstrapped += 1;
                    }
                    if (bootstrapped) {
                        await ctx.info('immaculateTasteRefresher: bootstrapped per-library movie datasets', {
                            librariesBootstrapped: bootstrapped,
                            legacyRows: legacyRows.length,
                        });
                    }
                }
            }
            const seedLibrarySectionKey = preferredMovieSectionKey || canonicalMovieSectionKey;
            await this.immaculateTaste.ensureLegacyImported({
                ctx,
                plexUserId,
                librarySectionKey: seedLibrarySectionKey,
                maxPoints,
            });
            const plexByLibrary = [];
            let canonicalSnapshot = [];
            let activatedNowTotal = 0;
            let tmdbBackfilledTotal = 0;
            for (const sec of orderedMovieSections) {
                const tmdbMap = sectionTmdbToItem.get(sec.key) ??
                    new Map();
                const pendingRows = await this.prisma.immaculateTasteMovieLibrary.findMany({
                    where: { plexUserId, librarySectionKey: sec.key, status: 'pending' },
                    select: { tmdbId: true },
                });
                const toActivate = pendingRows
                    .map((p) => p.tmdbId)
                    .filter((id) => tmdbMap.has(id));
                const sentToRadarr = Math.max(0, pendingRows.length - toActivate.length);
                const activatedNow = ctx.dryRun
                    ? toActivate.length
                    : (await this.immaculateTaste.activatePendingNowInPlex({
                        ctx,
                        plexUserId,
                        librarySectionKey: sec.key,
                        tmdbIds: toActivate,
                        pointsOnActivation: ImmaculateTasteRefresherJob_1.ACTIVATION_POINTS,
                        tmdbApiKey,
                    })).activated;
                activatedNowTotal += activatedNow;
                if (ctx.dryRun && activatedNow) {
                    await ctx.info('immaculateTasteRefresher: dry-run would activate pending titles now in Plex', {
                        library: sec.title,
                        movieSectionKey: sec.key,
                        activated: activatedNow,
                        pointsOnActivation: ImmaculateTasteRefresherJob_1.ACTIVATION_POINTS,
                    });
                }
                const activeRows = await this.prisma.immaculateTasteMovieLibrary.findMany({
                    where: {
                        plexUserId,
                        librarySectionKey: sec.key,
                        status: 'active',
                        points: { gt: 0 },
                    },
                    select: {
                        tmdbId: true,
                        title: true,
                        points: true,
                        tmdbVoteAvg: true,
                        tmdbVoteCount: true,
                    },
                });
                if (!activeRows.length) {
                    plexByLibrary.push({
                        library: sec.title,
                        movieSectionKey: sec.key,
                        totalInLibrary: 0,
                        totalApplying: 0,
                        skipped: true,
                        reason: 'no_active_rows_for_library',
                        sentToRadarr,
                    });
                    continue;
                }
                let tmdbBackfilled = 0;
                const backfillLimit = 200;
                const backfillIds = activeRows
                    .filter((m) => m.tmdbVoteAvg === null)
                    .map((m) => m.tmdbId)
                    .slice(0, backfillLimit);
                if (!ctx.dryRun && backfillIds.length && tmdbApiKey) {
                    const batches = chunk(backfillIds, 6);
                    for (const batch of batches) {
                        await Promise.all(batch.map(async (tmdbId) => {
                            const details = await this.tmdb
                                .getMovieVoteStats({ apiKey: tmdbApiKey, tmdbId })
                                .catch(() => null);
                            const voteAvg = details?.vote_average ?? null;
                            const voteCount = details?.vote_count ?? null;
                            if (voteAvg === null && voteCount === null)
                                return;
                            await this.prisma.immaculateTasteMovieLibrary
                                .update({
                                where: {
                                    plexUserId_librarySectionKey_tmdbId: {
                                        plexUserId,
                                        librarySectionKey: sec.key,
                                        tmdbId,
                                    },
                                },
                                data: {
                                    ...(voteAvg !== null ? { tmdbVoteAvg: voteAvg } : {}),
                                    ...(voteCount !== null ? { tmdbVoteCount: voteCount } : {}),
                                },
                            })
                                .catch(() => null);
                            const row = activeRows.find((r) => r.tmdbId === tmdbId);
                            if (row) {
                                row.tmdbVoteAvg = voteAvg ?? row.tmdbVoteAvg;
                                row.tmdbVoteCount = voteCount ?? row.tmdbVoteCount;
                            }
                            tmdbBackfilled += 1;
                        }));
                    }
                }
                else if (backfillIds.length && !tmdbApiKey) {
                    await ctx.warn('immaculateTasteRefresher: TMDB apiKey missing; cannot backfill ratings', { library: sec.title, movieSectionKey: sec.key, missingRatings: backfillIds.length });
                }
                tmdbBackfilledTotal += tmdbBackfilled;
                const orderedTmdb = this.immaculateTaste.buildThreeTierTmdbRatingShuffleOrder({
                    movies: activeRows.map((m) => ({
                        tmdbId: m.tmdbId,
                        tmdbVoteAvg: m.tmdbVoteAvg ?? null,
                        tmdbVoteCount: m.tmdbVoteCount ?? null,
                    })),
                });
                const desiredInLibrary = orderedTmdb
                    .map((id) => tmdbMap.get(id))
                    .filter((v) => Boolean(v));
                const desiredLimited = limit && desiredInLibrary.length > limit
                    ? desiredInLibrary.slice(0, limit)
                    : desiredInLibrary;
                if (sec.key === canonicalMovieSectionKey) {
                    canonicalSnapshot = desiredLimited;
                }
                if (!desiredLimited.length) {
                    await ctx.info('immaculateTasteRefresher: skipping library (no matches)', {
                        library: sec.title,
                        movieSectionKey: sec.key,
                    });
                    plexByLibrary.push({
                        library: sec.title,
                        movieSectionKey: sec.key,
                        totalInLibrary: desiredInLibrary.length,
                        totalApplying: 0,
                        skipped: true,
                        reason: 'no_matches',
                    });
                    continue;
                }
                await ctx.info('immaculateTasteRefresher: rebuilding library collection', {
                    library: sec.title,
                    movieSectionKey: sec.key,
                    totalInLibrary: desiredInLibrary.length,
                    totalApplying: desiredLimited.length,
                });
                let plex = null;
                if (!ctx.dryRun) {
                    try {
                        plex = await this.plexCurated.rebuildMovieCollection({
                            ctx,
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            machineIdentifier,
                            movieSectionKey: sec.key,
                            collectionName: plexCollectionName,
                            desiredItems: desiredLimited,
                            randomizeOrder: false,
                            pinCollections: true,
                            pinTarget,
                            collectionHubOrder: movieCollectionHubOrder,
                        });
                    }
                    catch (err) {
                        const msg = err?.message ?? String(err);
                        await ctx.warn('immaculateTasteRefresher: rebuild failed (movie)', {
                            library: sec.title,
                            movieSectionKey: sec.key,
                            error: msg,
                        });
                        plex = { error: msg };
                    }
                }
                plexByLibrary.push({
                    library: sec.title,
                    movieSectionKey: sec.key,
                    totalInLibrary: desiredInLibrary.length,
                    totalApplying: desiredLimited.length,
                    plex,
                    activatedNow,
                    sentToRadarr,
                    tmdbBackfilled,
                    top3: desiredLimited.slice(0, 3).map((d) => d.title),
                    sampleTop10: desiredLimited.slice(0, 10).map((d) => d.title),
                });
            }
            let dbSaved = false;
            let curatedCollectionId = null;
            if (!ctx.dryRun) {
                const col = await this.prisma.curatedCollection.upsert({
                    where: { name: ImmaculateTasteRefresherJob_1.COLLECTION_NAME },
                    update: {},
                    create: { name: ImmaculateTasteRefresherJob_1.COLLECTION_NAME },
                    select: { id: true },
                });
                curatedCollectionId = col.id;
                await this.prisma.curatedCollectionItem.deleteMany({
                    where: { collectionId: col.id },
                });
                const canonicalLimited = limit && canonicalSnapshot.length > limit
                    ? canonicalSnapshot.slice(0, limit)
                    : canonicalSnapshot;
                const batches = chunk(canonicalLimited, 200);
                for (const batch of batches) {
                    await this.prisma.curatedCollectionItem.createMany({
                        data: batch.map((it) => ({
                            collectionId: col.id,
                            ratingKey: it.ratingKey,
                            title: it.title,
                        })),
                    });
                }
                dbSaved = true;
                await ctx.info('immaculateTasteRefresher: db snapshot saved', {
                    curatedCollectionId,
                    movieLibraryName: canonicalMovieLibraryName,
                    movieSectionKey: canonicalMovieSectionKey,
                    savedItems: canonicalLimited.length,
                    activatedNow: activatedNowTotal,
                    tmdbBackfilled: tmdbBackfilledTotal,
                });
            }
            movieSummary = {
                collectionName: ImmaculateTasteRefresherJob_1.COLLECTION_NAME,
                totalLibraries: orderedMovieSections.length,
                dbSaved,
                curatedCollectionId,
                activatedNow: activatedNowTotal,
                tmdbBackfilled: tmdbBackfilledTotal,
                plexByLibrary,
            };
            await ctx.info('immaculateTasteRefresher(movie): done', movieSummary);
        }
        else if (!includeMovies) {
            movieSummary = { skipped: true, reason: 'disabled' };
            await ctx.info('immaculateTasteRefresher: movies disabled (skipping movie collection)');
        }
        else {
            await ctx.info('immaculateTasteRefresher: no selected movie libraries (skipping movie collection)');
        }
        if (includeTv && scopedTvSections.length) {
            const sectionTvdbToItem = new Map();
            for (const sec of scopedTvSections) {
                const tvdbMap = new Map();
                const rows = await this.plexServer.listShowsWithTvdbIdsForSectionKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey: sec.key,
                    sectionTitle: sec.title,
                });
                for (const r of rows) {
                    if (!r.tvdbId)
                        continue;
                    if (!tvdbMap.has(r.tvdbId))
                        tvdbMap.set(r.tvdbId, { ratingKey: r.ratingKey, title: r.title });
                }
                sectionTvdbToItem.set(sec.key, tvdbMap);
            }
            const canonicalTvSectionKey = (() => {
                const preferred = scopedTvSections.find((s) => s.title.toLowerCase() === 'tv shows') ??
                    scopedTvSections.find((s) => s.title.toLowerCase() === 'shows') ??
                    null;
                if (preferred)
                    return preferred.key;
                const sorted = scopedTvSections.slice().sort((a, b) => {
                    const aCount = sectionTvdbToItem.get(a.key)?.size ?? 0;
                    const bCount = sectionTvdbToItem.get(b.key)?.size ?? 0;
                    if (aCount !== bCount)
                        return bCount - aCount;
                    return a.title.localeCompare(b.title);
                });
                return sorted[0]?.key ?? scopedTvSections[0].key;
            })();
            const canonicalTvLibraryName = scopedTvSections.find((s) => s.key === canonicalTvSectionKey)?.title ??
                scopedTvSections[0].title;
            const orderedTvSections = scopedTvSections.slice().sort((a, b) => {
                if (a.key === preferredTvSectionKey)
                    return -1;
                if (b.key === preferredTvSectionKey)
                    return 1;
                if (a.key === canonicalTvSectionKey)
                    return -1;
                if (b.key === canonicalTvSectionKey)
                    return 1;
                return a.title.localeCompare(b.title);
            });
            await ctx.info('immaculateTasteRefresher(tv): canonical library selected', {
                canonicalTvLibraryName,
                canonicalTvSectionKey,
            });
            if (!ctx.dryRun) {
                const legacyRows = await this.prisma.immaculateTasteShow
                    .findMany({
                    select: {
                        tvdbId: true,
                        tmdbId: true,
                        title: true,
                        status: true,
                        points: true,
                        tmdbVoteAvg: true,
                        tmdbVoteCount: true,
                    },
                })
                    .catch(() => []);
                if (legacyRows.length) {
                    let bootstrapped = 0;
                    for (const sec of orderedTvSections) {
                        const resetMarkerKey = (0, immaculate_taste_reset_1.immaculateTasteResetMarkerKey)({
                            mediaType: 'tv',
                            librarySectionKey: sec.key,
                        });
                        const resetMarker = await this.prisma.setting
                            .findUnique({ where: { key: resetMarkerKey } })
                            .catch(() => null);
                        if (resetMarker) {
                            await ctx.info('immaculateTasteRefresher: skipping legacy bootstrap for reset library', { library: sec.title, tvSectionKey: sec.key });
                            continue;
                        }
                        const existing = await this.prisma.immaculateTasteShowLibrary.count({
                            where: { plexUserId, librarySectionKey: sec.key },
                        });
                        if (existing > 0)
                            continue;
                        const batches = chunk(legacyRows, 200);
                        for (const batch of batches) {
                            await this.prisma.immaculateTasteShowLibrary.createMany({
                                data: batch.map((r) => ({
                                    plexUserId,
                                    librarySectionKey: sec.key,
                                    tvdbId: r.tvdbId,
                                    tmdbId: r.tmdbId ?? undefined,
                                    title: r.title ?? undefined,
                                    status: r.status,
                                    points: r.points,
                                    tmdbVoteAvg: r.tmdbVoteAvg ?? undefined,
                                    tmdbVoteCount: r.tmdbVoteCount ?? undefined,
                                })),
                            });
                        }
                        bootstrapped += 1;
                    }
                    if (bootstrapped) {
                        await ctx.info('immaculateTasteRefresher: bootstrapped per-library tv datasets', {
                            librariesBootstrapped: bootstrapped,
                            legacyRows: legacyRows.length,
                        });
                    }
                }
            }
            const plexByLibrary = [];
            let activatedNowTotal = 0;
            let tmdbBackfilledTotal = 0;
            for (const sec of orderedTvSections) {
                const tvdbMap = sectionTvdbToItem.get(sec.key) ??
                    new Map();
                const pendingRows = await this.prisma.immaculateTasteShowLibrary.findMany({
                    where: { plexUserId, librarySectionKey: sec.key, status: 'pending' },
                    select: { tvdbId: true },
                });
                const toActivate = pendingRows
                    .map((p) => p.tvdbId)
                    .filter((id) => tvdbMap.has(id));
                const sentToSonarr = Math.max(0, pendingRows.length - toActivate.length);
                const activatedNow = ctx.dryRun
                    ? toActivate.length
                    : (await this.immaculateTasteTv.activatePendingNowInPlex({
                        ctx,
                        plexUserId,
                        librarySectionKey: sec.key,
                        tvdbIds: toActivate,
                        pointsOnActivation: ImmaculateTasteRefresherJob_1.ACTIVATION_POINTS,
                        tmdbApiKey,
                    })).activated;
                activatedNowTotal += activatedNow;
                if (ctx.dryRun && activatedNow) {
                    await ctx.info('immaculateTasteRefresher(tv): dry-run would activate pending shows now in Plex', {
                        library: sec.title,
                        tvSectionKey: sec.key,
                        activated: activatedNow,
                        pointsOnActivation: ImmaculateTasteRefresherJob_1.ACTIVATION_POINTS,
                    });
                }
                const activeRows = await this.prisma.immaculateTasteShowLibrary.findMany({
                    where: {
                        plexUserId,
                        librarySectionKey: sec.key,
                        status: 'active',
                        points: { gt: 0 },
                    },
                    select: {
                        tvdbId: true,
                        tmdbId: true,
                        title: true,
                        points: true,
                        tmdbVoteAvg: true,
                        tmdbVoteCount: true,
                    },
                });
                if (!activeRows.length) {
                    plexByLibrary.push({
                        library: sec.title,
                        tvSectionKey: sec.key,
                        totalInLibrary: 0,
                        totalApplying: 0,
                        skipped: true,
                        reason: 'no_active_rows_for_library',
                        sentToSonarr,
                    });
                    continue;
                }
                let tmdbBackfilled = 0;
                const backfillLimit = 200;
                const backfillIds = Array.from(new Set(activeRows
                    .filter((m) => m.tmdbVoteAvg === null && typeof m.tmdbId === 'number')
                    .map((m) => Math.trunc(m.tmdbId)))).slice(0, backfillLimit);
                if (!ctx.dryRun && backfillIds.length && tmdbApiKey) {
                    const batches = chunk(backfillIds, 6);
                    for (const batch of batches) {
                        await Promise.all(batch.map(async (tmdbId) => {
                            const details = await this.tmdb
                                .getTvVoteStats({ apiKey: tmdbApiKey, tmdbId })
                                .catch(() => null);
                            const voteAvg = details?.vote_average ?? null;
                            const voteCount = details?.vote_count ?? null;
                            if (voteAvg === null && voteCount === null)
                                return;
                            await this.prisma.immaculateTasteShowLibrary
                                .updateMany({
                                where: { plexUserId, librarySectionKey: sec.key, tmdbId },
                                data: {
                                    ...(voteAvg !== null ? { tmdbVoteAvg: voteAvg } : {}),
                                    ...(voteCount !== null ? { tmdbVoteCount: voteCount } : {}),
                                },
                            })
                                .catch(() => null);
                            for (const row of activeRows) {
                                if (row.tmdbId !== tmdbId)
                                    continue;
                                row.tmdbVoteAvg = voteAvg ?? row.tmdbVoteAvg;
                                row.tmdbVoteCount = voteCount ?? row.tmdbVoteCount;
                            }
                            tmdbBackfilled += 1;
                        }));
                    }
                }
                else if (backfillIds.length && !tmdbApiKey) {
                    await ctx.warn('immaculateTasteRefresher(tv): TMDB apiKey missing; cannot backfill ratings', { library: sec.title, tvSectionKey: sec.key, missingRatings: backfillIds.length });
                }
                tmdbBackfilledTotal += tmdbBackfilled;
                const candidates = activeRows
                    .filter((m) => tvdbMap.has(m.tvdbId))
                    .map((m) => ({
                    tvdbId: m.tvdbId,
                    tmdbVoteAvg: m.tmdbVoteAvg ?? null,
                    tmdbVoteCount: m.tmdbVoteCount ?? null,
                }));
                const orderedTvdb = this.immaculateTasteTv.buildThreeTierTmdbRatingShuffleOrder({
                    shows: candidates,
                });
                const desiredInLibrary = orderedTvdb
                    .map((id) => tvdbMap.get(id))
                    .filter((v) => Boolean(v));
                const desiredLimited = limit && desiredInLibrary.length > limit
                    ? desiredInLibrary.slice(0, limit)
                    : desiredInLibrary;
                if (!desiredLimited.length) {
                    await ctx.info('immaculateTasteRefresher(tv): skipping library (no matches)', {
                        library: sec.title,
                        tvSectionKey: sec.key,
                    });
                    plexByLibrary.push({
                        library: sec.title,
                        tvSectionKey: sec.key,
                        totalInLibrary: desiredInLibrary.length,
                        totalApplying: 0,
                        skipped: true,
                        reason: 'no_matches',
                    });
                    continue;
                }
                await ctx.info('immaculateTasteRefresher(tv): rebuilding library collection', {
                    library: sec.title,
                    tvSectionKey: sec.key,
                    totalInLibrary: desiredInLibrary.length,
                    totalApplying: desiredLimited.length,
                });
                let plex = null;
                if (!ctx.dryRun) {
                    try {
                        plex = await this.plexCurated.rebuildMovieCollection({
                            ctx,
                            baseUrl: plexBaseUrl,
                            token: plexToken,
                            machineIdentifier,
                            movieSectionKey: sec.key,
                            itemType: 2,
                            collectionName: plexCollectionName,
                            desiredItems: desiredLimited,
                            randomizeOrder: false,
                            pinCollections: true,
                            pinTarget,
                            collectionHubOrder: tvCollectionHubOrder,
                        });
                    }
                    catch (err) {
                        const msg = err?.message ?? String(err);
                        await ctx.warn('immaculateTasteRefresher: rebuild failed (tv)', {
                            library: sec.title,
                            tvSectionKey: sec.key,
                            error: msg,
                        });
                        plex = { error: msg };
                    }
                }
                plexByLibrary.push({
                    library: sec.title,
                    tvSectionKey: sec.key,
                    totalInLibrary: desiredInLibrary.length,
                    totalApplying: desiredLimited.length,
                    plex,
                    activatedNow,
                    sentToSonarr,
                    tmdbBackfilled,
                    top3: desiredLimited.slice(0, 3).map((d) => d.title),
                    sampleTop10: desiredLimited.slice(0, 10).map((d) => d.title),
                });
            }
            tvSummary = {
                collectionName: ImmaculateTasteRefresherJob_1.COLLECTION_NAME,
                totalLibraries: orderedTvSections.length,
                activatedNow: activatedNowTotal,
                tmdbBackfilled: tmdbBackfilledTotal,
                plexByLibrary,
            };
            await ctx.info('immaculateTasteRefresher(tv): done', tvSummary);
        }
        else if (!includeTv) {
            tvSummary = { skipped: true, reason: 'disabled' };
            await ctx.info('immaculateTasteRefresher: TV disabled (skipping tv collection)');
        }
        else {
            await ctx.info('immaculateTasteRefresher: no selected TV libraries (skipping tv collection)');
        }
        const summary = {
            mode,
            plexUserId,
            plexUserTitle,
            pinTarget,
            collectionName: ImmaculateTasteRefresherJob_1.COLLECTION_NAME,
            movie: movieSummary,
            tv: tvSummary,
        };
        await ctx.info('immaculateTasteRefresher: done', summary);
        const report = buildImmaculateTasteRefresherReport({ ctx, raw: summary });
        return { summary: report };
    }
    async runSweep(ctx, input) {
        const includeMovies = typeof input['includeMovies'] === 'boolean' ? input['includeMovies'] : true;
        const includeTv = typeof input['includeTv'] === 'boolean' ? input['includeTv'] : true;
        const limitRaw = typeof input['limit'] === 'number' ? input['limit'] : null;
        const limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw)
            ? Math.max(1, Math.trunc(limitRaw))
            : null;
        const userIds = new Set();
        if (includeMovies) {
            const movieRows = await this.prisma.immaculateTasteMovieLibrary.findMany({
                select: { plexUserId: true },
                distinct: ['plexUserId'],
            });
            for (const row of movieRows)
                userIds.add(row.plexUserId);
        }
        if (includeTv) {
            const tvRows = await this.prisma.immaculateTasteShowLibrary.findMany({
                select: { plexUserId: true },
                distinct: ['plexUserId'],
            });
            for (const row of tvRows)
                userIds.add(row.plexUserId);
        }
        const users = userIds.size
            ? await this.prisma.plexUser.findMany({
                where: { id: { in: Array.from(userIds) } },
                select: {
                    id: true,
                    plexAccountId: true,
                    plexAccountTitle: true,
                    isAdmin: true,
                    lastSeenAt: true,
                },
            })
            : [];
        const orderedUsers = (0, refresher_sweep_utils_1.sortSweepUsers)(users);
        const admin = await this.plexUsers.ensureAdminPlexUser({ userId: ctx.userId });
        const normalize = (value) => String(value ?? '').trim().toLowerCase();
        const isAdminUser = (user) => {
            if (user.id === admin.id)
                return true;
            if (user.plexAccountId !== null &&
                admin.plexAccountId !== null &&
                user.plexAccountId === admin.plexAccountId) {
                return true;
            }
            const userTitle = normalize(user.plexAccountTitle);
            const adminTitle = normalize(admin.plexAccountTitle);
            if (userTitle && adminTitle && userTitle === adminTitle)
                return true;
            return user.isAdmin;
        };
        await ctx.info('immaculateTasteRefresher: sweep start', {
            mode: 'sweep',
            includeMovies,
            includeTv,
            limit,
            sweepOrder: refresher_sweep_utils_1.SWEEP_ORDER,
            usersSelected: orderedUsers.map((u) => ({
                plexUserId: u.id,
                plexUserTitle: u.plexAccountTitle,
                isAdmin: isAdminUser(u),
            })),
        });
        const usersSummary = [];
        let usersSucceeded = 0;
        let usersFailed = 0;
        for (const user of orderedUsers) {
            const userIsAdmin = isAdminUser(user);
            const pinTarget = userIsAdmin ? 'admin' : 'friends';
            try {
                const childInput = {
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    includeMovies,
                    includeTv,
                    __forceAllLibraries: true,
                    ...(limit !== null ? { limit } : {}),
                };
                const childRun = await this.run({
                    ...ctx,
                    input: childInput,
                });
                const childSummary = isPlainObject(childRun.summary)
                    ? childRun.summary
                    : null;
                const childRaw = childSummary && isPlainObject(childSummary['raw'])
                    ? childSummary['raw']
                    : null;
                usersSummary.push({
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    isAdmin: userIsAdmin,
                    pinTarget,
                    movie: childRaw && isPlainObject(childRaw['movie'])
                        ? childRaw['movie']
                        : { skipped: true, reason: 'missing' },
                    tv: childRaw && isPlainObject(childRaw['tv'])
                        ? childRaw['tv']
                        : { skipped: true, reason: 'missing' },
                });
                usersSucceeded += 1;
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                usersSummary.push({
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    isAdmin: userIsAdmin,
                    pinTarget,
                    error: msg,
                });
                usersFailed += 1;
                await ctx.warn('immaculateTasteRefresher: sweep user failed (continuing)', {
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    error: msg,
                });
            }
        }
        const summary = {
            mode: 'sweep',
            sweepOrder: refresher_sweep_utils_1.SWEEP_ORDER,
            includeMovies,
            includeTv,
            ...(limit !== null ? { limit } : {}),
            usersProcessed: orderedUsers.length,
            usersSucceeded,
            usersFailed,
            users: usersSummary,
        };
        await ctx.info('immaculateTasteRefresher: sweep done', summary);
        const report = buildImmaculateTasteRefresherReport({ ctx, raw: summary });
        return { summary: report };
    }
    async resolvePlexUserContext(ctx) {
        const input = ctx.input ?? {};
        const admin = await this.plexUsers.ensureAdminPlexUser({ userId: ctx.userId });
        const plexUserIdRaw = typeof input['plexUserId'] === 'string' ? input['plexUserId'].trim() : '';
        const plexUserTitleRaw = typeof input['plexUserTitle'] === 'string'
            ? input['plexUserTitle'].trim()
            : '';
        const plexAccountIdRaw = input['plexAccountId'];
        const plexAccountId = typeof plexAccountIdRaw === 'number' && Number.isFinite(plexAccountIdRaw)
            ? Math.trunc(plexAccountIdRaw)
            : typeof plexAccountIdRaw === 'string' && plexAccountIdRaw.trim()
                ? Number.parseInt(plexAccountIdRaw.trim(), 10)
                : null;
        const plexAccountTitleRaw = typeof input['plexAccountTitle'] === 'string'
            ? input['plexAccountTitle'].trim()
            : '';
        const plexAccountTitle = plexAccountTitleRaw || plexUserTitleRaw;
        const fromInput = plexUserIdRaw
            ? await this.plexUsers.getPlexUserById(plexUserIdRaw)
            : null;
        const normalize = (value) => String(value ?? '').trim().toLowerCase();
        const isAdminUser = (row) => {
            if (row.id === admin.id)
                return true;
            if (row.plexAccountId !== null &&
                admin.plexAccountId !== null &&
                row.plexAccountId === admin.plexAccountId) {
                return true;
            }
            const rowTitle = normalize(row.plexAccountTitle);
            const adminTitle = normalize(admin.plexAccountTitle);
            if (rowTitle && adminTitle && rowTitle === adminTitle)
                return true;
            return row.isAdmin === true;
        };
        const titleMismatch = Boolean(fromInput) &&
            Boolean(plexAccountTitle) &&
            normalize(fromInput?.plexAccountTitle) !== normalize(plexAccountTitle);
        if (fromInput && !titleMismatch) {
            return {
                plexUserId: fromInput.id,
                plexUserTitle: fromInput.plexAccountTitle,
                pinCollections: isAdminUser(fromInput),
            };
        }
        if (plexAccountTitle) {
            const byTitle = await this.plexUsers.getOrCreateByPlexAccount({
                plexAccountTitle,
            });
            if (byTitle) {
                return {
                    plexUserId: byTitle.id,
                    plexUserTitle: byTitle.plexAccountTitle,
                    pinCollections: isAdminUser(byTitle),
                };
            }
        }
        if (plexAccountId) {
            const byAccount = await this.plexUsers.getOrCreateByPlexAccount({
                plexAccountId,
                plexAccountTitle,
            });
            if (byAccount) {
                return {
                    plexUserId: byAccount.id,
                    plexUserTitle: byAccount.plexAccountTitle,
                    pinCollections: isAdminUser(byAccount),
                };
            }
        }
        return {
            plexUserId: admin.id,
            plexUserTitle: admin.plexAccountTitle,
            pinCollections: true,
        };
    }
};
exports.ImmaculateTasteRefresherJob = ImmaculateTasteRefresherJob;
exports.ImmaculateTasteRefresherJob = ImmaculateTasteRefresherJob = ImmaculateTasteRefresherJob_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService,
        plex_curated_collections_service_1.PlexCuratedCollectionsService,
        plex_users_service_1.PlexUsersService,
        immaculate_taste_collection_service_1.ImmaculateTasteCollectionService,
        immaculate_taste_show_collection_service_1.ImmaculateTasteShowCollectionService,
        tmdb_service_1.TmdbService])
], ImmaculateTasteRefresherJob);
function asNum(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function buildImmaculateTasteRefresherReport(params) {
    const { ctx, raw } = params;
    const mode = typeof raw.mode === 'string'
        ? String(raw.mode)
        : 'targeted';
    const tasks = [];
    const issues = [];
    const asStringArray = (v) => {
        if (!Array.isArray(v))
            return [];
        const out = [];
        for (const it of v) {
            const s = String(it ?? '').trim();
            if (!s)
                continue;
            out.push(s);
        }
        return out;
    };
    const addLibraryTasks = (params) => {
        const byLibrary = Array.isArray(params.byLibrary)
            ? params.byLibrary.filter((x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x))
            : [];
        for (const lib of byLibrary) {
            const name = String(lib.library ?? lib.title ?? 'Library');
            const plex = isPlainObject(lib.plex) ? lib.plex : null;
            const plexSkipped = plex ? Boolean(plex.skipped) : false;
            const plexError = plex && typeof plex.error === 'string'
                ? String(plex.error).trim()
                : null;
            const skipped = Boolean(lib.skipped) || plexSkipped;
            const reason = typeof lib.reason === 'string'
                ? lib.reason
                : plex && typeof plex.reason === 'string'
                    ? String(plex.reason)
                    : null;
            const existingCount = plex ? asNum(plex.existingCount) : null;
            const desiredCount = plex
                ? asNum(plex.desiredCount)
                : asNum(lib.totalApplying) ?? null;
            const plexItems = plex
                ? asStringArray(plex.collectionItems)
                : [];
            const facts = plexItems.length
                ? [
                    {
                        label: 'Collection order',
                        value: {
                            count: plexItems.length,
                            unit: params.unit ?? 'items',
                            items: plexItems,
                            order: 'plex',
                        },
                    },
                ]
                : [];
            const failed = Boolean(plexError);
            if (failed) {
                issues.push((0, job_report_v1_1.issue)('error', `${params.titlePrefix} ${name}: ${plexError}`));
            }
            else if (skipped) {
                issues.push((0, job_report_v1_1.issue)('warn', `${params.titlePrefix} ${name}: skipped${reason ? ` (${reason})` : ''}.`));
            }
            tasks.push({
                id: `${params.prefix}_${name}`,
                title: `${params.titlePrefix} ${name}`,
                status: failed ? 'failed' : skipped ? 'skipped' : 'success',
                rows: [
                    (0, job_report_v1_1.metricRow)({
                        label: 'Collection items',
                        start: existingCount,
                        changed: existingCount !== null && desiredCount !== null ? desiredCount - existingCount : null,
                        end: desiredCount,
                        unit: 'items',
                    }),
                    (0, job_report_v1_1.metricRow)({ label: 'Activated now', end: asNum(lib.activatedNow), unit: 'items' }),
                    ...(params.sentLabel && params.sentField
                        ? [
                            (0, job_report_v1_1.metricRow)({
                                label: params.sentLabel,
                                end: asNum(lib[params.sentField]),
                                unit: 'titles',
                            }),
                        ]
                        : []),
                    (0, job_report_v1_1.metricRow)({ label: 'TMDB ratings backfilled', end: asNum(lib.tmdbBackfilled), unit: 'items' }),
                ],
                facts: facts.length ? facts : undefined,
                issues: plexError ? [(0, job_report_v1_1.issue)('error', plexError)] : undefined,
            });
        }
    };
    if (mode === 'sweep') {
        const usersRaw = raw.users;
        const users = Array.isArray(usersRaw)
            ? usersRaw.filter((u) => Boolean(u) && typeof u === 'object' && !Array.isArray(u))
            : [];
        tasks.push({
            id: 'sweep_context',
            title: 'Sweep context',
            status: 'success',
            facts: [
                {
                    label: 'Order',
                    value: String(raw.sweepOrder ?? refresher_sweep_utils_1.SWEEP_ORDER),
                },
                {
                    label: 'Users processed',
                    value: asNum(raw.usersProcessed),
                },
                {
                    label: 'Users succeeded',
                    value: asNum(raw.usersSucceeded),
                },
                {
                    label: 'Users failed',
                    value: asNum(raw.usersFailed),
                },
            ],
        });
        for (const user of users) {
            const userId = String(user.plexUserId ?? '').trim() || 'unknown';
            const userTitle = String(user.plexUserTitle ?? '').trim() || 'Unknown';
            const userError = typeof user.error === 'string' && user.error.trim() ? user.error.trim() : null;
            tasks.push({
                id: `context_${userId}`,
                title: `Context — ${userTitle}`,
                status: userError ? 'failed' : 'success',
                facts: [
                    { label: 'Plex user', value: userTitle },
                    { label: 'Plex user id', value: userId },
                    { label: 'Pin target', value: String(user.pinTarget ?? '') },
                ],
            });
            if (userError) {
                issues.push((0, job_report_v1_1.issue)('error', `${userTitle}: ${userError}`));
                continue;
            }
            const movie = isPlainObject(user.movie) ? user.movie : null;
            const tv = isPlainObject(user.tv) ? user.tv : null;
            if (movie) {
                addLibraryTasks({
                    prefix: `movie_library_${userId}`,
                    titlePrefix: `Movie library (${userTitle}):`,
                    byLibrary: movie.plexByLibrary,
                    sentLabel: 'Sent to Radarr',
                    sentField: 'sentToRadarr',
                    unit: 'movies',
                });
            }
            if (tv) {
                addLibraryTasks({
                    prefix: `tv_library_${userId}`,
                    titlePrefix: `TV library (${userTitle}):`,
                    byLibrary: tv.plexByLibrary,
                    sentLabel: 'Sent to Sonarr',
                    sentField: 'sentToSonarr',
                    unit: 'shows',
                });
            }
        }
    }
    else {
        const movie = isPlainObject(raw.movie) ? raw.movie : null;
        const tv = isPlainObject(raw.tv) ? raw.tv : null;
        const plexUserId = String(raw.plexUserId ?? '').trim();
        const plexUserTitle = String(raw.plexUserTitle ?? '').trim();
        const contextFacts = [];
        if (plexUserTitle)
            contextFacts.push({ label: 'Plex user', value: plexUserTitle });
        if (plexUserId)
            contextFacts.push({ label: 'Plex user id', value: plexUserId });
        if (contextFacts.length) {
            tasks.push({
                id: 'context',
                title: 'Context',
                status: 'success',
                facts: contextFacts,
            });
        }
        if (movie) {
            addLibraryTasks({
                prefix: 'movie_library',
                titlePrefix: 'Movie library:',
                byLibrary: movie.plexByLibrary,
                sentLabel: 'Sent to Radarr',
                sentField: 'sentToRadarr',
                unit: 'movies',
            });
        }
        if (tv) {
            addLibraryTasks({
                prefix: 'tv_library',
                titlePrefix: 'TV library:',
                byLibrary: tv.plexByLibrary,
                sentLabel: 'Sent to Sonarr',
                sentField: 'sentToSonarr',
                unit: 'shows',
            });
        }
    }
    return {
        template: 'jobReportV1',
        version: 1,
        jobId: ctx.jobId,
        dryRun: ctx.dryRun,
        trigger: ctx.trigger,
        headline: 'Refresher complete.',
        sections: [],
        tasks,
        issues,
        raw,
    };
}
//# sourceMappingURL=immaculate-taste-refresher.job.js.map