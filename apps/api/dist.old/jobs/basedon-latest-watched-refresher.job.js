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
exports.BasedonLatestWatchedRefresherJob = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../db/prisma.service");
const plex_library_selection_utils_1 = require("../plex/plex-library-selection.utils");
const plex_server_service_1 = require("../plex/plex-server.service");
const plex_users_service_1 = require("../plex/plex-users.service");
const settings_service_1 = require("../settings/settings.service");
const watched_collections_refresher_service_1 = require("../watched-movie-recommendations/watched-collections-refresher.service");
const job_report_v1_1 = require("./job-report-v1");
const refresher_sweep_utils_1 = require("./refresher-sweep.utils");
const MOVIE_COLLECTIONS = [
    'Based on your recently watched movie',
    'Change of Taste',
];
const TV_COLLECTIONS = [
    'Based on your recently watched show',
    'Change of Taste',
];
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
function asNum(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    const out = [];
    for (const it of v) {
        if (typeof it !== 'string')
            continue;
        const s = it.trim();
        if (!s)
            continue;
        out.push(s);
    }
    return out;
}
function uniqueStrings(list) {
    const seen = new Set();
    const out = [];
    for (const it of list) {
        const s = String(it ?? '').trim();
        if (!s)
            continue;
        if (seen.has(s))
            continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}
function normalizeSectionKeys(value) {
    if (!Array.isArray(value))
        return [];
    const out = new Set();
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const key = item.trim();
        if (!key)
            continue;
        out.add(key);
    }
    return Array.from(out);
}
let BasedonLatestWatchedRefresherJob = class BasedonLatestWatchedRefresherJob {
    prisma;
    settingsService;
    plexServer;
    plexUsers;
    watchedRefresher;
    constructor(prisma, settingsService, plexServer, plexUsers, watchedRefresher) {
        this.prisma = prisma;
        this.settingsService = settingsService;
        this.plexServer = plexServer;
        this.plexUsers = plexUsers;
        this.watchedRefresher = watchedRefresher;
    }
    async run(ctx) {
        const input = ctx.input ?? {};
        const mode = (0, refresher_sweep_utils_1.hasExplicitRefresherScopeInput)(input)
            ? 'targeted'
            : 'sweep';
        if (mode === 'sweep') {
            return await this.runSweep(ctx, input);
        }
        const includeMovies = typeof input['includeMovies'] === 'boolean' ? input['includeMovies'] : true;
        const includeTv = typeof input['includeTv'] === 'boolean' ? input['includeTv'] : true;
        const forcedMovieSectionKeys = normalizeSectionKeys(input['__movieSectionKeys']);
        const forcedTvSectionKeys = normalizeSectionKeys(input['__tvSectionKeys']);
        const { plexUserId, plexUserTitle, pinCollections } = await this.resolvePlexUserContext(ctx);
        const pinTarget = pinCollections ? 'admin' : 'friends';
        const limitRaw = typeof input['limit'] === 'number' ? input['limit'] : null;
        const inputLimit = typeof limitRaw === 'number' && Number.isFinite(limitRaw)
            ? Math.max(1, Math.trunc(limitRaw))
            : null;
        const { settings, secrets } = await this.settingsService.getInternalSettings(ctx.userId);
        void ctx
            .patchSummary({
            progress: {
                step: 'plex_libraries',
                message: 'Scanning Plex movie + TV libraries…',
                updatedAt: new Date().toISOString(),
            },
        })
            .catch(() => undefined);
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const plexToken = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!plexBaseUrlRaw)
            throw new Error('Plex baseUrl is not set');
        if (!plexToken)
            throw new Error('Plex token is not set');
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        const sections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const librarySelection = (0, plex_library_selection_utils_1.resolvePlexLibrarySelection)({ settings, sections });
        const selectedSectionKeySet = new Set(librarySelection.selectedSectionKeys);
        const movieSectionsAll = sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'movie' &&
            selectedSectionKeySet.has(s.key))
            .sort((a, b) => a.title.localeCompare(b.title));
        const tvSectionsAll = sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'show' &&
            selectedSectionKeySet.has(s.key))
            .sort((a, b) => a.title.localeCompare(b.title));
        let movieSections = includeMovies ? movieSectionsAll : [];
        let tvSections = includeTv ? tvSectionsAll : [];
        if (forcedMovieSectionKeys.length) {
            const movieKeySet = new Set(forcedMovieSectionKeys);
            movieSections = movieSections.filter((s) => movieKeySet.has(s.key));
        }
        if (forcedTvSectionKeys.length) {
            const tvKeySet = new Set(forcedTvSectionKeys);
            tvSections = tvSections.filter((s) => tvKeySet.has(s.key));
        }
        const configuredLimitRaw = pickNumber(settings, 'recommendations.collectionLimit') ?? 15;
        const configuredLimit = Math.max(1, Math.min(200, Math.trunc(configuredLimitRaw || 15)));
        const limit = inputLimit ?? configuredLimit;
        const noMovieLibrariesForScope = includeMovies && movieSections.length === 0;
        const noTvLibrariesForScope = includeTv && tvSections.length === 0;
        if ((!includeMovies || noMovieLibrariesForScope) &&
            (!includeTv || noTvLibrariesForScope)) {
            const skippedRefresh = {
                skipped: true,
                reasons: [
                    ...(noMovieLibrariesForScope ? ['no_selected_movie_libraries'] : []),
                    ...(noTvLibrariesForScope ? ['no_selected_tv_libraries'] : []),
                ],
                movie: includeMovies
                    ? {
                        skipped: true,
                        reason: 'no_selected_movie_libraries',
                    }
                    : {
                        skipped: true,
                        reason: 'disabled',
                    },
                tv: includeTv
                    ? {
                        skipped: true,
                        reason: 'no_selected_tv_libraries',
                    }
                    : {
                        skipped: true,
                        reason: 'disabled',
                    },
            };
            const summary = {
                mode,
                dryRun: ctx.dryRun,
                plexUserId,
                plexUserTitle,
                pinTarget,
                limit,
                refresh: skippedRefresh,
            };
            await ctx.info('recentlyWatchedRefresher: skipped (no selected libraries)', {
                includeMovies,
                includeTv,
                forcedMovieSectionKeys,
                forcedTvSectionKeys,
                selectedSectionKeys: librarySelection.selectedSectionKeys,
            });
            const report = buildRecentlyWatchedRefresherReport({ ctx, raw: summary });
            return { summary: report };
        }
        const machineIdentifier = await this.plexServer.getMachineIdentifier({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        await ctx.info('recentlyWatchedRefresher: start', {
            mode,
            dryRun: ctx.dryRun,
            plexUserId,
            plexUserTitle,
            movieLibraries: movieSections.map((s) => s.title),
            tvLibraries: tvSections.map((s) => s.title),
            collectionsMovie: Array.from(MOVIE_COLLECTIONS),
            collectionsTv: Array.from(TV_COLLECTIONS),
            pinTarget,
            includeMovies,
            includeTv,
            limit,
            inputLimit,
            configuredLimit,
        });
        const refresh = await this.watchedRefresher.refresh({
            ctx,
            plexBaseUrl,
            plexToken,
            machineIdentifier,
            plexUserId,
            plexUserTitle,
            pinCollections: true,
            pinTarget,
            movieSections,
            tvSections,
            limit,
            scope: null,
        });
        const summary = {
            mode,
            dryRun: ctx.dryRun,
            plexUserId,
            plexUserTitle,
            pinTarget,
            limit,
            refresh,
        };
        await ctx.info('recentlyWatchedRefresher: done', summary);
        const report = buildRecentlyWatchedRefresherReport({ ctx, raw: summary });
        return { summary: report };
    }
    async runSweep(ctx, input) {
        const includeMovies = typeof input['includeMovies'] === 'boolean' ? input['includeMovies'] : true;
        const includeTv = typeof input['includeTv'] === 'boolean' ? input['includeTv'] : true;
        const limitRaw = typeof input['limit'] === 'number' ? input['limit'] : null;
        const inputLimit = typeof limitRaw === 'number' && Number.isFinite(limitRaw)
            ? Math.max(1, Math.trunc(limitRaw))
            : null;
        const { settings, secrets } = await this.settingsService.getInternalSettings(ctx.userId);
        void ctx
            .patchSummary({
            progress: {
                step: 'plex_libraries',
                message: 'Scanning Plex movie + TV libraries…',
                updatedAt: new Date().toISOString(),
            },
        })
            .catch(() => undefined);
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const plexToken = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!plexBaseUrlRaw)
            throw new Error('Plex baseUrl is not set');
        if (!plexToken)
            throw new Error('Plex token is not set');
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        const sections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const librarySelection = (0, plex_library_selection_utils_1.resolvePlexLibrarySelection)({ settings, sections });
        const selectedSectionKeySet = new Set(librarySelection.selectedSectionKeys);
        const movieSectionsAll = sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'movie' &&
            selectedSectionKeySet.has(s.key))
            .sort((a, b) => a.title.localeCompare(b.title));
        const tvSectionsAll = sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'show' &&
            selectedSectionKeySet.has(s.key))
            .sort((a, b) => a.title.localeCompare(b.title));
        const configuredLimitRaw = pickNumber(settings, 'recommendations.collectionLimit') ?? 15;
        const configuredLimit = Math.max(1, Math.min(200, Math.trunc(configuredLimitRaw || 15)));
        const limit = inputLimit ?? configuredLimit;
        const noMovieLibrariesForScope = includeMovies && movieSectionsAll.length === 0;
        const noTvLibrariesForScope = includeTv && tvSectionsAll.length === 0;
        if ((!includeMovies || noMovieLibrariesForScope) &&
            (!includeTv || noTvLibrariesForScope)) {
            const summary = {
                mode: 'sweep',
                dryRun: ctx.dryRun,
                limit,
                includeMovies,
                includeTv,
                sweepOrder: refresher_sweep_utils_1.SWEEP_ORDER,
                usersProcessed: 0,
                usersSucceeded: 0,
                usersFailed: 0,
                users: [],
                skipped: true,
                reasons: [
                    ...(noMovieLibrariesForScope ? ['no_selected_movie_libraries'] : []),
                    ...(noTvLibrariesForScope ? ['no_selected_tv_libraries'] : []),
                ],
            };
            await ctx.info('recentlyWatchedRefresher: sweep skipped (no selected libraries)', {
                includeMovies,
                includeTv,
                selectedSectionKeys: librarySelection.selectedSectionKeys,
            });
            const report = buildRecentlyWatchedRefresherReport({ ctx, raw: summary });
            return { summary: report };
        }
        const machineIdentifier = await this.plexServer.getMachineIdentifier({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const userIds = new Set();
        if (includeMovies) {
            const movieRows = await this.prisma.watchedMovieRecommendationLibrary.findMany({
                select: { plexUserId: true },
                distinct: ['plexUserId'],
            });
            for (const row of movieRows)
                userIds.add(row.plexUserId);
        }
        if (includeTv) {
            const tvRows = await this.prisma.watchedShowRecommendationLibrary.findMany({
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
        await ctx.info('recentlyWatchedRefresher: sweep start', {
            mode: 'sweep',
            includeMovies,
            includeTv,
            sweepOrder: refresher_sweep_utils_1.SWEEP_ORDER,
            usersSelected: orderedUsers.map((u) => ({
                plexUserId: u.id,
                plexUserTitle: u.plexAccountTitle,
                isAdmin: isAdminUser(u),
            })),
            limit,
            inputLimit,
            configuredLimit,
        });
        const userSummaries = [];
        let usersSucceeded = 0;
        let usersFailed = 0;
        let usersSkipped = 0;
        for (const user of orderedUsers) {
            const userIsAdmin = isAdminUser(user);
            const pinTarget = userIsAdmin ? 'admin' : 'friends';
            const movieLibraryRows = includeMovies
                ? await this.prisma.watchedMovieRecommendationLibrary.findMany({
                    where: { plexUserId: user.id },
                    select: { librarySectionKey: true },
                    distinct: ['librarySectionKey'],
                })
                : [];
            const tvLibraryRows = includeTv
                ? await this.prisma.watchedShowRecommendationLibrary.findMany({
                    where: { plexUserId: user.id },
                    select: { librarySectionKey: true },
                    distinct: ['librarySectionKey'],
                })
                : [];
            const movieLibraryKeys = new Set(movieLibraryRows.map((r) => r.librarySectionKey));
            const tvLibraryKeys = new Set(tvLibraryRows.map((r) => r.librarySectionKey));
            const movieSections = includeMovies
                ? movieSectionsAll.filter((s) => movieLibraryKeys.has(s.key))
                : [];
            const tvSections = includeTv
                ? tvSectionsAll.filter((s) => tvLibraryKeys.has(s.key))
                : [];
            const movieSkippedForScope = includeMovies && movieSections.length === 0;
            const tvSkippedForScope = includeTv && tvSections.length === 0;
            if ((!includeMovies || movieSkippedForScope) &&
                (!includeTv || tvSkippedForScope)) {
                usersSkipped += 1;
                userSummaries.push({
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    isAdmin: userIsAdmin,
                    pinTarget,
                    refresh: {
                        skipped: true,
                        reasons: [
                            ...(movieSkippedForScope ? ['no_selected_movie_libraries'] : []),
                            ...(tvSkippedForScope ? ['no_selected_tv_libraries'] : []),
                        ],
                        movie: includeMovies
                            ? { skipped: true, reason: 'no_selected_movie_libraries' }
                            : { skipped: true, reason: 'disabled' },
                        tv: includeTv
                            ? { skipped: true, reason: 'no_selected_tv_libraries' }
                            : { skipped: true, reason: 'disabled' },
                    },
                });
                await ctx.info('recentlyWatchedRefresher: sweep user skipped (no selected libraries)', {
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    includeMovies,
                    includeTv,
                    movieLibraryKeys: Array.from(movieLibraryKeys),
                    tvLibraryKeys: Array.from(tvLibraryKeys),
                });
                continue;
            }
            await ctx.info('recentlyWatchedRefresher: sweep user start', {
                plexUserId: user.id,
                plexUserTitle: user.plexAccountTitle,
                isAdmin: userIsAdmin,
                pinTarget,
                movieLibraries: movieSections.map((s) => s.title),
                tvLibraries: tvSections.map((s) => s.title),
            });
            try {
                const refresh = await this.watchedRefresher.refresh({
                    ctx,
                    plexBaseUrl,
                    plexToken,
                    machineIdentifier,
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    pinCollections: true,
                    pinTarget,
                    movieSections,
                    tvSections,
                    limit,
                    scope: null,
                });
                usersSucceeded += 1;
                userSummaries.push({
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    isAdmin: userIsAdmin,
                    pinTarget,
                    refresh,
                });
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                usersFailed += 1;
                userSummaries.push({
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    isAdmin: userIsAdmin,
                    pinTarget,
                    error: msg,
                });
                await ctx.warn('recentlyWatchedRefresher: sweep user failed (continuing)', {
                    plexUserId: user.id,
                    plexUserTitle: user.plexAccountTitle,
                    error: msg,
                });
            }
        }
        const summary = {
            mode: 'sweep',
            dryRun: ctx.dryRun,
            limit,
            includeMovies,
            includeTv,
            sweepOrder: refresher_sweep_utils_1.SWEEP_ORDER,
            usersProcessed: orderedUsers.length,
            usersSucceeded,
            usersFailed,
            usersSkipped,
            users: userSummaries,
        };
        await ctx.info('recentlyWatchedRefresher: sweep done', summary);
        const report = buildRecentlyWatchedRefresherReport({ ctx, raw: summary });
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
exports.BasedonLatestWatchedRefresherJob = BasedonLatestWatchedRefresherJob;
exports.BasedonLatestWatchedRefresherJob = BasedonLatestWatchedRefresherJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService,
        plex_users_service_1.PlexUsersService,
        watched_collections_refresher_service_1.WatchedCollectionsRefresherService])
], BasedonLatestWatchedRefresherJob);
function buildRecentlyWatchedRefresherReport(params) {
    const { ctx, raw } = params;
    const mode = typeof raw.mode === 'string'
        ? String(raw.mode)
        : 'targeted';
    const tasks = [];
    const issues = [];
    const addSideFromRefresh = (params) => {
        const sideRaw = params.refresh ? params.refresh[params.prefix] : null;
        const side = isPlainObject(sideRaw) ? sideRaw : null;
        const byLibraryRaw = side?.byLibrary;
        const byLibrary = Array.isArray(byLibraryRaw)
            ? byLibraryRaw.filter((b) => isPlainObject(b))
            : [];
        for (const lib of byLibrary) {
            const library = String(lib.library ?? lib.librarySectionKey ?? 'Library');
            const librarySectionKey = String(lib.librarySectionKey ?? library);
            const colsRaw = lib.collections;
            const cols = Array.isArray(colsRaw)
                ? colsRaw.filter((c) => isPlainObject(c))
                : [];
            for (const collectionName of params.collections) {
                const col = cols.find((c) => String(c.collectionName ?? '').trim() === collectionName);
                if (!col)
                    continue;
                const desiredTitles = uniqueStrings(asStringArray(col.desiredTitles));
                const applying = asNum(col.applying) ?? desiredTitles.length;
                if (applying <= 0)
                    continue;
                const plex = isPlainObject(col.plex) ? col.plex : null;
                const existingCount = plex ? asNum(plex.existingCount) : null;
                const desiredCount = (plex ? asNum(plex.desiredCount) : null) ??
                    (asNum(col.applying) ?? desiredTitles.length);
                const activatedNow = asNum(col.activatedNow) ?? 0;
                const tmdbBackfilled = asNum(col.tmdbBackfilled) ?? 0;
                const sent = params.prefix === 'movie'
                    ? asNum(col.sentToRadarr) ?? 0
                    : asNum(col.sentToSonarr) ?? 0;
                tasks.push({
                    id: `${params.userPrefix}${params.prefix}_${librarySectionKey}_${collectionName}`,
                    title: `${params.titlePrefix} ${library}${params.userSuffix} — ${collectionName}`,
                    status: 'success',
                    rows: [
                        (0, job_report_v1_1.metricRow)({
                            label: 'Collection items',
                            start: existingCount,
                            changed: existingCount !== null && desiredCount !== null
                                ? desiredCount - existingCount
                                : null,
                            end: desiredCount,
                            unit: 'items',
                        }),
                        (0, job_report_v1_1.metricRow)({ label: 'Activated now', end: activatedNow, unit: 'items' }),
                        (0, job_report_v1_1.metricRow)({ label: params.sentLabel, end: sent, unit: 'titles' }),
                        (0, job_report_v1_1.metricRow)({
                            label: 'TMDB ratings backfilled',
                            end: tmdbBackfilled,
                            unit: 'items',
                        }),
                    ],
                });
            }
        }
    };
    if (mode === 'sweep') {
        const usersRaw = raw.users;
        const users = Array.isArray(usersRaw)
            ? usersRaw.filter((u) => isPlainObject(u))
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
                    value: asNum(raw.usersProcessed) ?? users.length,
                },
                {
                    label: 'Users succeeded',
                    value: asNum(raw.usersSucceeded) ?? 0,
                },
                {
                    label: 'Users failed',
                    value: asNum(raw.usersFailed) ?? 0,
                },
            ],
        });
        for (const user of users) {
            const plexUserId = String(user.plexUserId ?? '').trim() || 'unknown';
            const plexUserTitle = String(user.plexUserTitle ?? '').trim() || 'Unknown';
            const error = typeof user.error === 'string' && user.error.trim()
                ? user.error.trim()
                : null;
            tasks.push({
                id: `context_${plexUserId}`,
                title: `Context — ${plexUserTitle}`,
                status: error ? 'failed' : 'success',
                facts: [
                    { label: 'Plex user', value: plexUserTitle },
                    { label: 'Plex user id', value: plexUserId },
                    {
                        label: 'Pin target',
                        value: String(user.pinTarget ?? ''),
                    },
                ],
            });
            if (error) {
                issues.push({
                    level: 'error',
                    message: `${plexUserTitle}: ${error}`,
                });
                continue;
            }
            const refreshRaw = user.refresh;
            const refresh = isPlainObject(refreshRaw)
                ? refreshRaw
                : null;
            addSideFromRefresh({
                refresh,
                userPrefix: `${plexUserId}_`,
                userSuffix: ` (${plexUserTitle})`,
                prefix: 'movie',
                titlePrefix: 'Movie library:',
                collections: MOVIE_COLLECTIONS,
                sentLabel: 'Sent to Radarr',
            });
            addSideFromRefresh({
                refresh,
                userPrefix: `${plexUserId}_`,
                userSuffix: ` (${plexUserTitle})`,
                prefix: 'tv',
                titlePrefix: 'TV library:',
                collections: TV_COLLECTIONS,
                sentLabel: 'Sent to Sonarr',
            });
        }
    }
    else {
        const refreshRaw = raw.refresh;
        const refresh = isPlainObject(refreshRaw)
            ? refreshRaw
            : null;
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
        addSideFromRefresh({
            refresh,
            userPrefix: '',
            userSuffix: '',
            prefix: 'movie',
            titlePrefix: 'Movie library:',
            collections: MOVIE_COLLECTIONS,
            sentLabel: 'Sent to Radarr',
        });
        addSideFromRefresh({
            refresh,
            userPrefix: '',
            userSuffix: '',
            prefix: 'tv',
            titlePrefix: 'TV library:',
            collections: TV_COLLECTIONS,
            sentLabel: 'Sent to Sonarr',
        });
    }
    if (tasks.length === 0) {
        tasks.push({
            id: 'nothing_to_do',
            title: 'well i got paid to do nothing',
            status: 'success',
            facts: [
                {
                    label: 'Note',
                    value: 'this database will start suggesting as you watch more movies or run the Based on Latest Watched Collection task manually',
                },
            ],
        });
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
//# sourceMappingURL=basedon-latest-watched-refresher.job.js.map