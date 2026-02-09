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
exports.ObservatoryService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../db/prisma.service");
const immaculate_taste_collection_service_1 = require("../immaculate-taste-collection/immaculate-taste-collection.service");
const immaculate_taste_show_collection_service_1 = require("../immaculate-taste-collection/immaculate-taste-show-collection.service");
const plex_curated_collections_service_1 = require("../plex/plex-curated-collections.service");
const plex_collections_utils_1 = require("../plex/plex-collections.utils");
const plex_server_service_1 = require("../plex/plex-server.service");
const plex_users_service_1 = require("../plex/plex-users.service");
const radarr_service_1 = require("../radarr/radarr.service");
const settings_service_1 = require("../settings/settings.service");
const sonarr_service_1 = require("../sonarr/sonarr.service");
const tmdb_service_1 = require("../tmdb/tmdb.service");
const watched_collections_refresher_service_1 = require("../watched-movie-recommendations/watched-collections-refresher.service");
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
function pickBool(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'boolean' ? v : null;
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
function normalizeHttpUrl(raw) {
    const trimmed = raw.trim();
    const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('baseUrl must be a valid http(s) URL');
    }
    return baseUrl;
}
function posterUrlFromPath(pathRaw) {
    const p = (pathRaw ?? '').trim();
    if (!p)
        return null;
    const normalized = p.startsWith('/') ? p : `/${p}`;
    return `https://image.tmdb.org/t/p/w500${normalized}`;
}
function watchedCollectionName(params) {
    if (params.kind === 'changeOfTaste')
        return 'Change of Taste';
    return params.mediaType === 'movie'
        ? 'Based on your recently watched movie'
        : 'Based on your recently watched show';
}
let ObservatoryService = class ObservatoryService {
    prisma;
    settings;
    plexServer;
    plexCurated;
    plexUsers;
    radarr;
    sonarr;
    tmdb;
    immaculateMovies;
    immaculateTv;
    watchedRefresher;
    constructor(prisma, settings, plexServer, plexCurated, plexUsers, radarr, sonarr, tmdb, immaculateMovies, immaculateTv, watchedRefresher) {
        this.prisma = prisma;
        this.settings = settings;
        this.plexServer = plexServer;
        this.plexCurated = plexCurated;
        this.plexUsers = plexUsers;
        this.radarr = radarr;
        this.sonarr = sonarr;
        this.tmdb = tmdb;
        this.immaculateMovies = immaculateMovies;
        this.immaculateTv = immaculateTv;
        this.watchedRefresher = watchedRefresher;
    }
    async resolvePlexUserContext(userId) {
        const resolved = await this.plexUsers.ensureAdminPlexUser({ userId });
        const pinTarget = resolved.isAdmin
            ? 'admin'
            : 'friends';
        return {
            plexUserId: resolved.id,
            plexUserTitle: resolved.plexAccountTitle,
            pinCollections: resolved.isAdmin,
            pinTarget,
        };
    }
    async resetRejectedSuggestions(params) {
        const res = await this.prisma.rejectedSuggestion.deleteMany({
            where: { userId: params.userId },
        });
        return { ok: true, deleted: res.count };
    }
    async listRejectedSuggestions(params) {
        const { settings, secrets } = await this.settings.getInternalSettings(params.userId);
        const sonarrBaseUrlRaw = pickString(settings, 'sonarr.baseUrl');
        const sonarrApiKey = pickString(secrets, 'sonarr.apiKey');
        const sonarrBaseUrl = sonarrBaseUrlRaw && sonarrApiKey ? normalizeHttpUrl(sonarrBaseUrlRaw) : '';
        const rows = await this.prisma.rejectedSuggestion.findMany({
            where: { userId: params.userId },
            orderBy: { createdAt: 'desc' },
            take: 1000,
        });
        const tmdbIds = Array.from(new Set(rows
            .filter((r) => r.mediaType === 'movie' && r.externalSource === 'tmdb')
            .map((r) => Number.parseInt(String(r.externalId ?? ''), 10))
            .filter((n) => Number.isFinite(n) && n > 0)));
        const tmdbToTitle = new Map();
        if (tmdbIds.length > 0) {
            const [imm, watched] = await Promise.all([
                this.prisma.immaculateTasteMovieLibrary
                    .findMany({
                    where: { tmdbId: { in: tmdbIds } },
                    select: { tmdbId: true, title: true },
                    take: 5000,
                })
                    .catch(() => []),
                this.prisma.watchedMovieRecommendationLibrary
                    .findMany({
                    where: { tmdbId: { in: tmdbIds } },
                    select: { tmdbId: true, title: true },
                    take: 5000,
                })
                    .catch(() => []),
            ]);
            for (const r of [...imm, ...watched]) {
                const id = r.tmdbId;
                const title = (r.title ?? '').trim();
                if (!title)
                    continue;
                if (!tmdbToTitle.has(id))
                    tmdbToTitle.set(id, title);
            }
        }
        const tvdbIds = Array.from(new Set(rows
            .filter((r) => r.mediaType === 'tv' && r.externalSource === 'tvdb')
            .map((r) => Number.parseInt(String(r.externalId ?? ''), 10))
            .filter((n) => Number.isFinite(n) && n > 0)));
        const tvdbToTitle = new Map();
        if (tvdbIds.length > 0 && sonarrBaseUrl && sonarrApiKey) {
            const series = await this.sonarr
                .listSeries({ baseUrl: sonarrBaseUrl, apiKey: sonarrApiKey })
                .catch(() => []);
            for (const s of series) {
                const id = s?.tvdbId;
                const title = s?.title;
                if (typeof id === 'number' &&
                    Number.isFinite(id) &&
                    typeof title === 'string' &&
                    title.trim()) {
                    tvdbToTitle.set(id, title.trim());
                }
            }
        }
        return {
            ok: true,
            items: rows.map((r) => {
                const tvdbId = r.externalSource === 'tvdb'
                    ? Number.parseInt(String(r.externalId ?? ''), 10)
                    : null;
                const tmdbId = r.externalSource === 'tmdb'
                    ? Number.parseInt(String(r.externalId ?? ''), 10)
                    : null;
                const derivedKind = r.source === 'immaculate'
                    ? 'immaculateTaste'
                    : (String(r.collectionKind ?? '').trim() || 'recentlyWatched');
                return {
                    id: r.id,
                    mediaType: r.mediaType,
                    externalSource: r.externalSource,
                    externalId: r.externalId,
                    externalName: r.mediaType === 'tv' && r.externalSource === 'tvdb' && tvdbId
                        ? tvdbToTitle.get(tvdbId) ?? null
                        : r.mediaType === 'movie' && r.externalSource === 'tmdb' && tmdbId
                            ? tmdbToTitle.get(tmdbId) ?? null
                            : null,
                    source: r.source,
                    collectionKind: derivedKind,
                    reason: (r.reason ?? ''),
                    createdAt: r.createdAt.toISOString(),
                };
            }),
            total: rows.length,
        };
    }
    async deleteRejectedSuggestion(params) {
        const row = await this.prisma.rejectedSuggestion.findFirst({
            where: { id: params.id, userId: params.userId },
        });
        if (!row)
            return { ok: false, error: 'Not found' };
        await this.prisma.rejectedSuggestion.delete({ where: { id: params.id } });
        return { ok: true, deleted: 1 };
    }
    async listMovies(params) {
        const { settings, secrets } = await this.settings.getInternalSettings(params.userId);
        const tmdbApiKey = pickString(secrets, 'tmdb.apiKey');
        const { plexUserId } = await this.resolvePlexUserContext(params.userId);
        const rows = await this.prisma.immaculateTasteMovieLibrary.findMany({
            where: params.mode === 'pendingApproval'
                ? {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    status: 'pending',
                    downloadApproval: 'pending',
                }
                : {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    downloadApproval: { not: 'rejected' },
                },
            orderBy: params.mode === 'pendingApproval'
                ? [{ updatedAt: 'desc' }]
                : [{ points: 'desc' }, { updatedAt: 'desc' }],
            take: 300,
        });
        if (tmdbApiKey) {
            const missing = rows.filter((r) => !r.tmdbPosterPath).slice(0, 20);
            await Promise.all(missing.map(async (r) => {
                const details = await this.tmdb
                    .getMovie({ apiKey: tmdbApiKey, tmdbId: r.tmdbId })
                    .catch(() => null);
                const posterPath = typeof details?.poster_path === 'string'
                    ? String(details.poster_path)
                    : null;
                if (!posterPath)
                    return;
                await this.prisma.immaculateTasteMovieLibrary
                    .update({
                    where: {
                        plexUserId_librarySectionKey_tmdbId: {
                            plexUserId,
                            librarySectionKey: params.librarySectionKey,
                            tmdbId: r.tmdbId,
                        },
                    },
                    data: { tmdbPosterPath: posterPath },
                })
                    .catch(() => null);
            }));
        }
        const out = await this.prisma.immaculateTasteMovieLibrary.findMany({
            where: {
                plexUserId,
                librarySectionKey: params.librarySectionKey,
                tmdbId: { in: rows.map((r) => r.tmdbId) },
                ...(params.mode === 'pendingApproval'
                    ? { status: 'pending', downloadApproval: 'pending' }
                    : { downloadApproval: { not: 'rejected' } }),
            },
            select: {
                tmdbId: true,
                title: true,
                status: true,
                points: true,
                tmdbVoteAvg: true,
                downloadApproval: true,
                sentToRadarrAt: true,
                tmdbPosterPath: true,
            },
            orderBy: params.mode === 'pendingApproval'
                ? [{ sentToRadarrAt: 'desc' }, { tmdbId: 'desc' }]
                : [{ points: 'desc' }, { tmdbId: 'desc' }],
        });
        return {
            ok: true,
            mode: params.mode,
            items: out.map((r) => ({
                id: r.tmdbId,
                mediaType: 'movie',
                title: r.title ?? null,
                status: r.status,
                points: r.points,
                tmdbVoteAvg: typeof r.tmdbVoteAvg === 'number' && Number.isFinite(r.tmdbVoteAvg)
                    ? Number(r.tmdbVoteAvg)
                    : null,
                downloadApproval: r.downloadApproval,
                sentToRadarrAt: r.sentToRadarrAt?.toISOString() ?? null,
                posterUrl: posterUrlFromPath(r.tmdbPosterPath ?? null),
            })),
            approvalRequiredFromObservatory: (pickBool(settings, 'jobs.immaculateTastePoints.approvalRequiredFromObservatory') ??
                false) === true,
        };
    }
    async listTv(params) {
        const { settings, secrets } = await this.settings.getInternalSettings(params.userId);
        const tmdbApiKey = pickString(secrets, 'tmdb.apiKey');
        const { plexUserId } = await this.resolvePlexUserContext(params.userId);
        const rows = await this.prisma.immaculateTasteShowLibrary.findMany({
            where: params.mode === 'pendingApproval'
                ? {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    status: 'pending',
                    downloadApproval: 'pending',
                }
                : {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    downloadApproval: { not: 'rejected' },
                },
            orderBy: params.mode === 'pendingApproval'
                ? [{ updatedAt: 'desc' }]
                : [{ points: 'desc' }, { updatedAt: 'desc' }],
            take: 300,
        });
        if (tmdbApiKey) {
            const missing = rows.filter((r) => !r.tmdbPosterPath && r.tmdbId).slice(0, 20);
            await Promise.all(missing.map(async (r) => {
                const tmdbId = typeof r.tmdbId === 'number' ? r.tmdbId : null;
                if (!tmdbId)
                    return;
                const details = await this.tmdb
                    .getTv({ apiKey: tmdbApiKey, tmdbId })
                    .catch(() => null);
                const posterPath = typeof details?.poster_path === 'string'
                    ? String(details.poster_path)
                    : null;
                if (!posterPath)
                    return;
                await this.prisma.immaculateTasteShowLibrary
                    .update({
                    where: {
                        plexUserId_librarySectionKey_tvdbId: {
                            plexUserId,
                            librarySectionKey: params.librarySectionKey,
                            tvdbId: r.tvdbId,
                        },
                    },
                    data: { tmdbPosterPath: posterPath },
                })
                    .catch(() => null);
            }));
        }
        const out = await this.prisma.immaculateTasteShowLibrary.findMany({
            where: {
                plexUserId,
                librarySectionKey: params.librarySectionKey,
                tvdbId: { in: rows.map((r) => r.tvdbId) },
                ...(params.mode === 'pendingApproval'
                    ? { status: 'pending', downloadApproval: 'pending' }
                    : { downloadApproval: { not: 'rejected' } }),
            },
            select: {
                tvdbId: true,
                tmdbId: true,
                title: true,
                status: true,
                points: true,
                tmdbVoteAvg: true,
                downloadApproval: true,
                sentToSonarrAt: true,
                tmdbPosterPath: true,
            },
            orderBy: params.mode === 'pendingApproval'
                ? [{ sentToSonarrAt: 'desc' }, { tvdbId: 'desc' }]
                : [{ points: 'desc' }, { tvdbId: 'desc' }],
        });
        return {
            ok: true,
            mode: params.mode,
            items: out.map((r) => ({
                id: r.tvdbId,
                mediaType: 'tv',
                tmdbId: r.tmdbId ?? null,
                title: r.title ?? null,
                status: r.status,
                points: r.points,
                tmdbVoteAvg: typeof r.tmdbVoteAvg === 'number' && Number.isFinite(r.tmdbVoteAvg)
                    ? Number(r.tmdbVoteAvg)
                    : null,
                downloadApproval: r.downloadApproval,
                sentToSonarrAt: r.sentToSonarrAt?.toISOString() ?? null,
                posterUrl: posterUrlFromPath(r.tmdbPosterPath ?? null),
            })),
            approvalRequiredFromObservatory: (pickBool(settings, 'jobs.immaculateTastePoints.approvalRequiredFromObservatory') ??
                false) === true,
        };
    }
    async listWatchedMovies(params) {
        const { settings, secrets } = await this.settings.getInternalSettings(params.userId);
        const tmdbApiKey = pickString(secrets, 'tmdb.apiKey');
        const { plexUserId } = await this.resolvePlexUserContext(params.userId);
        const collectionName = watchedCollectionName({
            mediaType: 'movie',
            kind: params.collectionKind,
        });
        const rows = await this.prisma.watchedMovieRecommendationLibrary.findMany({
            where: params.mode === 'pendingApproval'
                ? {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    collectionName,
                    status: 'pending',
                    downloadApproval: 'pending',
                }
                : {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    collectionName,
                    downloadApproval: { not: 'rejected' },
                },
            orderBy: params.mode === 'pendingApproval'
                ? [{ updatedAt: 'desc' }]
                : [{ tmdbVoteAvg: 'desc' }, { updatedAt: 'desc' }],
            take: 300,
        });
        if (tmdbApiKey) {
            const missing = rows.filter((r) => !r.tmdbPosterPath).slice(0, 20);
            await Promise.all(missing.map(async (r) => {
                const details = await this.tmdb
                    .getMovie({ apiKey: tmdbApiKey, tmdbId: r.tmdbId })
                    .catch(() => null);
                const posterPath = typeof details?.poster_path === 'string'
                    ? String(details.poster_path)
                    : null;
                if (!posterPath)
                    return;
                await this.prisma.watchedMovieRecommendationLibrary
                    .update({
                    where: {
                        plexUserId_collectionName_librarySectionKey_tmdbId: {
                            plexUserId,
                            collectionName,
                            librarySectionKey: params.librarySectionKey,
                            tmdbId: r.tmdbId,
                        },
                    },
                    data: { tmdbPosterPath: posterPath },
                })
                    .catch(() => null);
            }));
        }
        const out = await this.prisma.watchedMovieRecommendationLibrary.findMany({
            where: {
                plexUserId,
                librarySectionKey: params.librarySectionKey,
                collectionName,
                tmdbId: { in: rows.map((r) => r.tmdbId) },
                ...(params.mode === 'pendingApproval'
                    ? { status: 'pending', downloadApproval: 'pending' }
                    : { downloadApproval: { not: 'rejected' } }),
            },
            select: {
                tmdbId: true,
                title: true,
                status: true,
                tmdbVoteAvg: true,
                downloadApproval: true,
                sentToRadarrAt: true,
                tmdbPosterPath: true,
            },
            orderBy: params.mode === 'pendingApproval'
                ? [{ sentToRadarrAt: 'desc' }, { tmdbId: 'desc' }]
                : [{ tmdbVoteAvg: 'desc' }, { tmdbId: 'desc' }],
        });
        return {
            ok: true,
            mode: params.mode,
            collectionKind: params.collectionKind,
            items: out.map((r) => ({
                id: r.tmdbId,
                mediaType: 'movie',
                title: r.title ?? null,
                status: r.status,
                points: 0,
                tmdbVoteAvg: typeof r.tmdbVoteAvg === 'number' && Number.isFinite(r.tmdbVoteAvg)
                    ? Number(r.tmdbVoteAvg)
                    : null,
                downloadApproval: r.downloadApproval,
                sentToRadarrAt: r.sentToRadarrAt?.toISOString() ?? null,
                posterUrl: posterUrlFromPath(r.tmdbPosterPath ?? null),
            })),
            approvalRequiredFromObservatory: (pickBool(settings, 'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory') ??
                false) === true,
        };
    }
    async listWatchedTv(params) {
        const { settings, secrets } = await this.settings.getInternalSettings(params.userId);
        const tmdbApiKey = pickString(secrets, 'tmdb.apiKey');
        const { plexUserId } = await this.resolvePlexUserContext(params.userId);
        const collectionName = watchedCollectionName({
            mediaType: 'tv',
            kind: params.collectionKind,
        });
        const rows = await this.prisma.watchedShowRecommendationLibrary.findMany({
            where: params.mode === 'pendingApproval'
                ? {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    collectionName,
                    status: 'pending',
                    downloadApproval: 'pending',
                }
                : {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    collectionName,
                    downloadApproval: { not: 'rejected' },
                },
            orderBy: params.mode === 'pendingApproval'
                ? [{ updatedAt: 'desc' }]
                : [{ tmdbVoteAvg: 'desc' }, { updatedAt: 'desc' }],
            take: 300,
        });
        if (tmdbApiKey) {
            const missing = rows
                .filter((r) => !r.tmdbPosterPath && r.tmdbId)
                .slice(0, 20);
            await Promise.all(missing.map(async (r) => {
                const tmdbId = typeof r.tmdbId === 'number' ? r.tmdbId : null;
                if (!tmdbId)
                    return;
                const details = await this.tmdb
                    .getTv({ apiKey: tmdbApiKey, tmdbId })
                    .catch(() => null);
                const posterPath = typeof details?.poster_path === 'string'
                    ? String(details.poster_path)
                    : null;
                if (!posterPath)
                    return;
                await this.prisma.watchedShowRecommendationLibrary
                    .update({
                    where: {
                        plexUserId_collectionName_librarySectionKey_tvdbId: {
                            plexUserId,
                            collectionName,
                            librarySectionKey: params.librarySectionKey,
                            tvdbId: r.tvdbId,
                        },
                    },
                    data: { tmdbPosterPath: posterPath },
                })
                    .catch(() => null);
            }));
        }
        const out = await this.prisma.watchedShowRecommendationLibrary.findMany({
            where: {
                plexUserId,
                librarySectionKey: params.librarySectionKey,
                collectionName,
                tvdbId: { in: rows.map((r) => r.tvdbId) },
                ...(params.mode === 'pendingApproval'
                    ? { status: 'pending', downloadApproval: 'pending' }
                    : { downloadApproval: { not: 'rejected' } }),
            },
            select: {
                tvdbId: true,
                tmdbId: true,
                title: true,
                status: true,
                tmdbVoteAvg: true,
                downloadApproval: true,
                sentToSonarrAt: true,
                tmdbPosterPath: true,
            },
            orderBy: params.mode === 'pendingApproval'
                ? [{ sentToSonarrAt: 'desc' }, { tvdbId: 'desc' }]
                : [{ tmdbVoteAvg: 'desc' }, { tvdbId: 'desc' }],
        });
        return {
            ok: true,
            mode: params.mode,
            collectionKind: params.collectionKind,
            items: out.map((r) => ({
                id: r.tvdbId,
                mediaType: 'tv',
                tmdbId: r.tmdbId ?? null,
                title: r.title ?? null,
                status: r.status,
                points: 0,
                tmdbVoteAvg: typeof r.tmdbVoteAvg === 'number' && Number.isFinite(r.tmdbVoteAvg)
                    ? Number(r.tmdbVoteAvg)
                    : null,
                downloadApproval: r.downloadApproval,
                sentToSonarrAt: r.sentToSonarrAt?.toISOString() ?? null,
                posterUrl: posterUrlFromPath(r.tmdbPosterPath ?? null),
            })),
            approvalRequiredFromObservatory: (pickBool(settings, 'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory') ??
                false) === true,
        };
    }
    async recordDecisions(params) {
        let applied = 0;
        let ignored = 0;
        const { plexUserId } = await this.resolvePlexUserContext(params.userId);
        const actions = params.decisions
            .map((d) => (isPlainObject(d) ? d : null))
            .filter((d) => Boolean(d))
            .map((d) => ({
            id: typeof d.id === 'number' ? Math.trunc(d.id) : Number(d.id),
            action: typeof d.action === 'string' ? d.action.trim() : '',
        }))
            .filter((d) => Number.isFinite(d.id) && d.id > 0 && Boolean(d.action));
        for (const a of actions) {
            const action = a.action;
            const isApprove = action === 'approve';
            const isReject = action === 'reject' || action === 'remove';
            const isKeep = action === 'keep';
            const isUndo = action === 'undo';
            if (!isApprove && !isReject && !isKeep && !isUndo) {
                ignored += 1;
                continue;
            }
            const nextApproval = isApprove
                ? 'approved'
                : isReject
                    ? 'rejected'
                    : null;
            try {
                if (params.mediaType === 'movie') {
                    if (isUndo) {
                        const row = await this.prisma.immaculateTasteMovieLibrary
                            .findUnique({
                            where: {
                                plexUserId_librarySectionKey_tmdbId: {
                                    plexUserId,
                                    librarySectionKey: params.librarySectionKey,
                                    tmdbId: a.id,
                                },
                            },
                            select: { status: true, downloadApproval: true },
                        })
                            .catch(() => null);
                        if (!row) {
                            ignored += 1;
                            continue;
                        }
                        const restored = row.status === 'pending' ? 'pending' : 'none';
                        await this.prisma.immaculateTasteMovieLibrary.update({
                            where: {
                                plexUserId_librarySectionKey_tmdbId: {
                                    plexUserId,
                                    librarySectionKey: params.librarySectionKey,
                                    tmdbId: a.id,
                                },
                            },
                            data: { downloadApproval: restored },
                        });
                        if (row.downloadApproval === 'rejected') {
                            await this.prisma.rejectedSuggestion
                                .delete({
                                where: {
                                    userId_mediaType_externalSource_externalId: {
                                        userId: params.userId,
                                        mediaType: 'movie',
                                        externalSource: 'tmdb',
                                        externalId: String(a.id),
                                    },
                                },
                            })
                                .catch(() => undefined);
                        }
                        applied += 1;
                        continue;
                    }
                    if (!nextApproval) {
                        applied += 1;
                        continue;
                    }
                    const updated = await this.prisma.immaculateTasteMovieLibrary.update({
                        where: {
                            plexUserId_librarySectionKey_tmdbId: {
                                plexUserId,
                                librarySectionKey: params.librarySectionKey,
                                tmdbId: a.id,
                            },
                        },
                        data: { downloadApproval: nextApproval },
                        select: { title: true },
                    });
                    if (isReject) {
                        await this.prisma.rejectedSuggestion
                            .upsert({
                            where: {
                                userId_mediaType_externalSource_externalId: {
                                    userId: params.userId,
                                    mediaType: 'movie',
                                    externalSource: 'tmdb',
                                    externalId: String(a.id),
                                },
                            },
                            create: {
                                userId: params.userId,
                                mediaType: 'movie',
                                externalSource: 'tmdb',
                                externalId: String(a.id),
                                source: 'immaculate',
                                collectionKind: 'immaculateTaste',
                                reason: action === 'remove' ? 'remove' : 'reject',
                            },
                            update: {
                                source: 'immaculate',
                                collectionKind: 'immaculateTaste',
                                reason: action === 'remove' ? 'remove' : 'reject',
                            },
                        })
                            .catch(() => undefined);
                    }
                    else if (nextApproval === 'approved') {
                        await this.prisma.rejectedSuggestion
                            .delete({
                            where: {
                                userId_mediaType_externalSource_externalId: {
                                    userId: params.userId,
                                    mediaType: 'movie',
                                    externalSource: 'tmdb',
                                    externalId: String(a.id),
                                },
                            },
                        })
                            .catch(() => undefined);
                    }
                    applied += 1;
                }
                else {
                    if (isUndo) {
                        const row = await this.prisma.immaculateTasteShowLibrary
                            .findUnique({
                            where: {
                                plexUserId_librarySectionKey_tvdbId: {
                                    plexUserId,
                                    librarySectionKey: params.librarySectionKey,
                                    tvdbId: a.id,
                                },
                            },
                            select: { status: true, downloadApproval: true },
                        })
                            .catch(() => null);
                        if (!row) {
                            ignored += 1;
                            continue;
                        }
                        const restored = row.status === 'pending' ? 'pending' : 'none';
                        await this.prisma.immaculateTasteShowLibrary.update({
                            where: {
                                plexUserId_librarySectionKey_tvdbId: {
                                    plexUserId,
                                    librarySectionKey: params.librarySectionKey,
                                    tvdbId: a.id,
                                },
                            },
                            data: { downloadApproval: restored },
                        });
                        if (row.downloadApproval === 'rejected') {
                            await this.prisma.rejectedSuggestion
                                .delete({
                                where: {
                                    userId_mediaType_externalSource_externalId: {
                                        userId: params.userId,
                                        mediaType: 'tv',
                                        externalSource: 'tvdb',
                                        externalId: String(a.id),
                                    },
                                },
                            })
                                .catch(() => undefined);
                        }
                        applied += 1;
                        continue;
                    }
                    if (!nextApproval) {
                        applied += 1;
                        continue;
                    }
                    await this.prisma.immaculateTasteShowLibrary.update({
                        where: {
                            plexUserId_librarySectionKey_tvdbId: {
                                plexUserId,
                                librarySectionKey: params.librarySectionKey,
                                tvdbId: a.id,
                            },
                        },
                        data: { downloadApproval: nextApproval },
                    });
                    if (isReject) {
                        await this.prisma.rejectedSuggestion
                            .upsert({
                            where: {
                                userId_mediaType_externalSource_externalId: {
                                    userId: params.userId,
                                    mediaType: 'tv',
                                    externalSource: 'tvdb',
                                    externalId: String(a.id),
                                },
                            },
                            create: {
                                userId: params.userId,
                                mediaType: 'tv',
                                externalSource: 'tvdb',
                                externalId: String(a.id),
                                source: 'immaculate',
                                collectionKind: 'immaculateTaste',
                                reason: action === 'remove' ? 'remove' : 'reject',
                            },
                            update: {
                                source: 'immaculate',
                                collectionKind: 'immaculateTaste',
                                reason: action === 'remove' ? 'remove' : 'reject',
                            },
                        })
                            .catch(() => undefined);
                    }
                    else if (nextApproval === 'approved') {
                        await this.prisma.rejectedSuggestion
                            .delete({
                            where: {
                                userId_mediaType_externalSource_externalId: {
                                    userId: params.userId,
                                    mediaType: 'tv',
                                    externalSource: 'tvdb',
                                    externalId: String(a.id),
                                },
                            },
                        })
                            .catch(() => undefined);
                    }
                    applied += 1;
                }
            }
            catch {
                ignored += 1;
            }
        }
        return { ok: true, applied, ignored };
    }
    async recordWatchedDecisions(params) {
        const { librarySectionKey, mediaType } = params;
        const { plexUserId } = await this.resolvePlexUserContext(params.userId);
        const collectionName = watchedCollectionName({
            mediaType,
            kind: params.collectionKind,
        });
        let applied = 0;
        let ignored = 0;
        for (const raw of params.decisions) {
            try {
                const obj = isPlainObject(raw) ? raw : null;
                const idRaw = obj ? obj['id'] : null;
                const actionRaw = obj ? obj['action'] : null;
                const id = typeof idRaw === 'number' && Number.isFinite(idRaw)
                    ? Math.trunc(idRaw)
                    : null;
                const action = typeof actionRaw === 'string' ? actionRaw.trim().toLowerCase() : '';
                if (!id || id <= 0) {
                    ignored += 1;
                    continue;
                }
                const isUndo = action === 'undo';
                const nextApproval = action === 'approve'
                    ? 'approved'
                    : action === 'reject' || action === 'remove'
                        ? 'rejected'
                        : null;
                if (mediaType === 'movie') {
                    if (isUndo) {
                        const row = await this.prisma.watchedMovieRecommendationLibrary
                            .findUnique({
                            where: {
                                plexUserId_collectionName_librarySectionKey_tmdbId: {
                                    plexUserId,
                                    collectionName,
                                    librarySectionKey,
                                    tmdbId: id,
                                },
                            },
                            select: { status: true, downloadApproval: true },
                        })
                            .catch(() => null);
                        if (!row) {
                            ignored += 1;
                            continue;
                        }
                        const restored = row.status === 'pending' ? 'pending' : 'none';
                        await this.prisma.watchedMovieRecommendationLibrary.update({
                            where: {
                                plexUserId_collectionName_librarySectionKey_tmdbId: {
                                    plexUserId,
                                    collectionName,
                                    librarySectionKey,
                                    tmdbId: id,
                                },
                            },
                            data: { downloadApproval: restored },
                        });
                        if (row.downloadApproval === 'rejected') {
                            await this.prisma.rejectedSuggestion
                                .delete({
                                where: {
                                    userId_mediaType_externalSource_externalId: {
                                        userId: params.userId,
                                        mediaType: 'movie',
                                        externalSource: 'tmdb',
                                        externalId: String(id),
                                    },
                                },
                            })
                                .catch(() => undefined);
                        }
                        applied += 1;
                        continue;
                    }
                    if (!nextApproval) {
                        applied += 1;
                        continue;
                    }
                    await this.prisma.watchedMovieRecommendationLibrary.update({
                        where: {
                            plexUserId_collectionName_librarySectionKey_tmdbId: {
                                plexUserId,
                                collectionName,
                                librarySectionKey,
                                tmdbId: id,
                            },
                        },
                        data: { downloadApproval: nextApproval },
                    });
                    if (nextApproval === 'rejected') {
                        await this.prisma.rejectedSuggestion
                            .upsert({
                            where: {
                                userId_mediaType_externalSource_externalId: {
                                    userId: params.userId,
                                    mediaType: 'movie',
                                    externalSource: 'tmdb',
                                    externalId: String(id),
                                },
                            },
                            create: {
                                userId: params.userId,
                                mediaType: 'movie',
                                externalSource: 'tmdb',
                                externalId: String(id),
                                source: 'watched',
                                collectionKind: params.collectionKind,
                                reason: action === 'remove' ? 'remove' : 'reject',
                            },
                            update: {
                                source: 'watched',
                                collectionKind: params.collectionKind,
                                reason: action === 'remove' ? 'remove' : 'reject',
                            },
                        })
                            .catch(() => undefined);
                    }
                    else if (nextApproval === 'approved') {
                        await this.prisma.rejectedSuggestion
                            .delete({
                            where: {
                                userId_mediaType_externalSource_externalId: {
                                    userId: params.userId,
                                    mediaType: 'movie',
                                    externalSource: 'tmdb',
                                    externalId: String(id),
                                },
                            },
                        })
                            .catch(() => undefined);
                    }
                    applied += 1;
                }
                else {
                    if (isUndo) {
                        const row = await this.prisma.watchedShowRecommendationLibrary
                            .findUnique({
                            where: {
                                plexUserId_collectionName_librarySectionKey_tvdbId: {
                                    plexUserId,
                                    collectionName,
                                    librarySectionKey,
                                    tvdbId: id,
                                },
                            },
                            select: { status: true, downloadApproval: true },
                        })
                            .catch(() => null);
                        if (!row) {
                            ignored += 1;
                            continue;
                        }
                        const restored = row.status === 'pending' ? 'pending' : 'none';
                        await this.prisma.watchedShowRecommendationLibrary.update({
                            where: {
                                plexUserId_collectionName_librarySectionKey_tvdbId: {
                                    plexUserId,
                                    collectionName,
                                    librarySectionKey,
                                    tvdbId: id,
                                },
                            },
                            data: { downloadApproval: restored },
                        });
                        if (row.downloadApproval === 'rejected') {
                            await this.prisma.rejectedSuggestion
                                .delete({
                                where: {
                                    userId_mediaType_externalSource_externalId: {
                                        userId: params.userId,
                                        mediaType: 'tv',
                                        externalSource: 'tvdb',
                                        externalId: String(id),
                                    },
                                },
                            })
                                .catch(() => undefined);
                        }
                        applied += 1;
                        continue;
                    }
                    if (!nextApproval) {
                        applied += 1;
                        continue;
                    }
                    await this.prisma.watchedShowRecommendationLibrary.update({
                        where: {
                            plexUserId_collectionName_librarySectionKey_tvdbId: {
                                plexUserId,
                                collectionName,
                                librarySectionKey,
                                tvdbId: id,
                            },
                        },
                        data: { downloadApproval: nextApproval },
                    });
                    if (nextApproval === 'rejected') {
                        await this.prisma.rejectedSuggestion
                            .upsert({
                            where: {
                                userId_mediaType_externalSource_externalId: {
                                    userId: params.userId,
                                    mediaType: 'tv',
                                    externalSource: 'tvdb',
                                    externalId: String(id),
                                },
                            },
                            create: {
                                userId: params.userId,
                                mediaType: 'tv',
                                externalSource: 'tvdb',
                                externalId: String(id),
                                source: 'watched',
                                collectionKind: params.collectionKind,
                                reason: action === 'remove' ? 'remove' : 'reject',
                            },
                            update: {
                                source: 'watched',
                                collectionKind: params.collectionKind,
                                reason: action === 'remove' ? 'remove' : 'reject',
                            },
                        })
                            .catch(() => undefined);
                    }
                    else if (nextApproval === 'approved') {
                        await this.prisma.rejectedSuggestion
                            .delete({
                            where: {
                                userId_mediaType_externalSource_externalId: {
                                    userId: params.userId,
                                    mediaType: 'tv',
                                    externalSource: 'tvdb',
                                    externalId: String(id),
                                },
                            },
                        })
                            .catch(() => undefined);
                    }
                    applied += 1;
                }
            }
            catch {
                ignored += 1;
            }
        }
        return { ok: true, applied, ignored };
    }
    async applyWatched(params) {
        const { settings, secrets } = await this.settings.getInternalSettings(params.userId);
        const { plexUserId, plexUserTitle, pinTarget } = await this.resolvePlexUserContext(params.userId);
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const plexToken = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!plexBaseUrlRaw)
            throw new common_1.BadGatewayException('Plex baseUrl is not set');
        if (!plexToken)
            throw new common_1.BadGatewayException('Plex token is not set');
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        const approvalRequired = (pickBool(settings, 'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory') ??
            false) === true;
        const ctx = {
            jobId: 'observatoryApplyWatched',
            runId: `observatory-watched-${Date.now()}`,
            userId: params.userId,
            dryRun: false,
            trigger: 'manual',
            input: {},
            getSummary: () => null,
            setSummary: async () => undefined,
            patchSummary: async () => undefined,
            log: async () => undefined,
            debug: async () => undefined,
            info: async () => undefined,
            warn: async () => undefined,
            error: async () => undefined,
        };
        const machineIdentifier = await this.plexServer.getMachineIdentifier({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const sections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const movieSections = sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
            .sort((a, b) => a.title.localeCompare(b.title));
        const tvSections = sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'show')
            .sort((a, b) => a.title.localeCompare(b.title));
        const collectionNames = params.mediaType === 'movie'
            ? ['Based on your recently watched movie', 'Change of Taste']
            : ['Based on your recently watched show', 'Change of Taste'];
        const collectionLimitRaw = pickNumber(settings, 'recommendations.collectionLimit') ?? 15;
        const limit = Math.max(1, Math.min(200, Math.trunc(Number.isFinite(collectionLimitRaw) ? collectionLimitRaw : 15) ||
            15));
        if (params.mediaType === 'movie') {
            const radarrBaseUrlRaw = pickString(settings, 'radarr.baseUrl');
            const radarrApiKey = pickString(secrets, 'radarr.apiKey');
            const fetchMissingRadarr = pickBool(settings, 'jobs.watchedMovieRecommendations.fetchMissing.radarr') ??
                true;
            const radarrEnabled = fetchMissingRadarr &&
                (pickBool(settings, 'radarr.enabled') ?? Boolean(radarrApiKey)) &&
                Boolean(radarrBaseUrlRaw) &&
                Boolean(radarrApiKey);
            const radarrBaseUrl = radarrEnabled ? normalizeHttpUrl(radarrBaseUrlRaw) : '';
            const rejected = await this.prisma.watchedMovieRecommendationLibrary.findMany({
                where: {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    collectionName: { in: collectionNames },
                    downloadApproval: 'rejected',
                },
                select: { tmdbId: true, sentToRadarrAt: true },
                take: 2000,
            });
            const approved = approvalRequired
                ? await this.prisma.watchedMovieRecommendationLibrary.findMany({
                    where: {
                        plexUserId,
                        librarySectionKey: params.librarySectionKey,
                        collectionName: { in: collectionNames },
                        status: 'pending',
                        downloadApproval: 'approved',
                    },
                    select: { tmdbId: true, title: true, sentToRadarrAt: true },
                    take: 2000,
                })
                : [];
            let unmonitored = 0;
            if (radarrEnabled && rejected.some((r) => Boolean(r.sentToRadarrAt))) {
                const movies = await this.radarr.listMovies({
                    baseUrl: radarrBaseUrl,
                    apiKey: radarrApiKey,
                });
                const byTmdb = new Map();
                for (const m of movies) {
                    const tmdbId = typeof m.tmdbId === 'number'
                        ? m.tmdbId
                        : Number(m.tmdbId);
                    if (Number.isFinite(tmdbId) && tmdbId > 0)
                        byTmdb.set(Math.trunc(tmdbId), m);
                }
                for (const r of rejected) {
                    if (!r.sentToRadarrAt)
                        continue;
                    const movie = byTmdb.get(r.tmdbId) ?? null;
                    if (!movie)
                        continue;
                    await this.radarr
                        .setMovieMonitored({
                        baseUrl: radarrBaseUrl,
                        apiKey: radarrApiKey,
                        movie: movie,
                        monitored: false,
                    })
                        .catch(() => undefined);
                    unmonitored += 1;
                }
            }
            let sent = 0;
            if (approvalRequired && radarrEnabled && approved.length) {
                const defaults = await this.resolveRadarrDefaults({
                    baseUrl: radarrBaseUrl,
                    apiKey: radarrApiKey,
                    preferredRootFolderPath: pickString(settings, 'radarr.defaultRootFolderPath') ||
                        pickString(settings, 'radarr.rootFolderPath'),
                    preferredQualityProfileId: Math.max(1, Math.trunc(pickNumber(settings, 'radarr.defaultQualityProfileId') ??
                        pickNumber(settings, 'radarr.qualityProfileId') ??
                        1)) || 1,
                    preferredTagId: (() => {
                        const v = pickNumber(settings, 'radarr.defaultTagId') ?? pickNumber(settings, 'radarr.tagId');
                        return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
                    })(),
                });
                for (const r of approved) {
                    if (r.sentToRadarrAt)
                        continue;
                    const title = r.title ?? `tmdb:${r.tmdbId}`;
                    const result = await this.radarr
                        .addMovie({
                        baseUrl: radarrBaseUrl,
                        apiKey: radarrApiKey,
                        title,
                        tmdbId: r.tmdbId,
                        year: null,
                        qualityProfileId: defaults.qualityProfileId,
                        rootFolderPath: defaults.rootFolderPath,
                        tags: defaults.tagIds,
                        monitored: true,
                        minimumAvailability: 'announced',
                        searchForMovie: true,
                    })
                        .catch(() => null);
                    if (!result)
                        continue;
                    await this.prisma.watchedMovieRecommendationLibrary
                        .updateMany({
                        where: {
                            plexUserId,
                            librarySectionKey: params.librarySectionKey,
                            collectionName: { in: collectionNames },
                            tmdbId: r.tmdbId,
                        },
                        data: { sentToRadarrAt: new Date(), downloadApproval: 'none' },
                    })
                        .catch(() => undefined);
                    sent += 1;
                }
            }
            await this.prisma.watchedMovieRecommendationLibrary.deleteMany({
                where: {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    collectionName: { in: collectionNames },
                    downloadApproval: 'rejected',
                },
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
                tvSections: [],
                limit,
                scope: { librarySectionKey: params.librarySectionKey, mode: 'movie' },
            });
            return { ok: true, approvalRequired, unmonitored, sent, refresh };
        }
        const sonarrBaseUrlRaw = pickString(settings, 'sonarr.baseUrl');
        const sonarrApiKey = pickString(secrets, 'sonarr.apiKey');
        const fetchMissingSonarr = pickBool(settings, 'jobs.watchedMovieRecommendations.fetchMissing.sonarr') ??
            true;
        const sonarrEnabled = fetchMissingSonarr &&
            (pickBool(settings, 'sonarr.enabled') ?? Boolean(sonarrApiKey)) &&
            Boolean(sonarrBaseUrlRaw) &&
            Boolean(sonarrApiKey);
        const sonarrBaseUrl = sonarrEnabled ? normalizeHttpUrl(sonarrBaseUrlRaw) : '';
        const rejected = await this.prisma.watchedShowRecommendationLibrary.findMany({
            where: {
                plexUserId,
                librarySectionKey: params.librarySectionKey,
                collectionName: { in: collectionNames },
                downloadApproval: 'rejected',
            },
            select: { tvdbId: true, sentToSonarrAt: true },
            take: 2000,
        });
        const approved = approvalRequired
            ? await this.prisma.watchedShowRecommendationLibrary.findMany({
                where: {
                    plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    collectionName: { in: collectionNames },
                    status: 'pending',
                    downloadApproval: 'approved',
                },
                select: { tvdbId: true, title: true, sentToSonarrAt: true },
                take: 2000,
            })
            : [];
        let unmonitored = 0;
        if (sonarrEnabled && rejected.some((r) => Boolean(r.sentToSonarrAt))) {
            const series = await this.sonarr.listSeries({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
            });
            const byTvdb = new Map();
            for (const s of series) {
                const tvdbId = typeof s.tvdbId === 'number'
                    ? s.tvdbId
                    : Number(s.tvdbId);
                if (Number.isFinite(tvdbId) && tvdbId > 0)
                    byTvdb.set(Math.trunc(tvdbId), s);
            }
            for (const r of rejected) {
                if (!r.sentToSonarrAt)
                    continue;
                const s = byTvdb.get(r.tvdbId) ?? null;
                if (!s)
                    continue;
                await this.sonarr
                    .updateSeries({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    series: { ...s, monitored: false },
                })
                    .catch(() => undefined);
                unmonitored += 1;
            }
        }
        let sent = 0;
        if (approvalRequired && sonarrEnabled && approved.length) {
            const defaults = await this.resolveSonarrDefaults({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
                preferredRootFolderPath: pickString(settings, 'sonarr.defaultRootFolderPath') ||
                    pickString(settings, 'sonarr.rootFolderPath'),
                preferredQualityProfileId: Math.max(1, Math.trunc(pickNumber(settings, 'sonarr.defaultQualityProfileId') ??
                    pickNumber(settings, 'sonarr.qualityProfileId') ??
                    1)) || 1,
                preferredTagId: (() => {
                    const v = pickNumber(settings, 'sonarr.defaultTagId') ?? pickNumber(settings, 'sonarr.tagId');
                    return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
                })(),
            });
            for (const r of approved) {
                if (r.sentToSonarrAt)
                    continue;
                const title = r.title ?? `tvdb:${r.tvdbId}`;
                const result = await this.sonarr
                    .addSeries({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    title,
                    tvdbId: r.tvdbId,
                    qualityProfileId: defaults.qualityProfileId,
                    rootFolderPath: defaults.rootFolderPath,
                    tags: defaults.tagIds,
                    monitored: true,
                    searchForMissingEpisodes: true,
                    searchForCutoffUnmetEpisodes: true,
                })
                    .catch(() => null);
                if (!result)
                    continue;
                await this.prisma.watchedShowRecommendationLibrary
                    .updateMany({
                    where: {
                        plexUserId,
                        librarySectionKey: params.librarySectionKey,
                        collectionName: { in: collectionNames },
                        tvdbId: r.tvdbId,
                    },
                    data: { sentToSonarrAt: new Date(), downloadApproval: 'none' },
                })
                    .catch(() => undefined);
                sent += 1;
            }
        }
        await this.prisma.watchedShowRecommendationLibrary.deleteMany({
            where: {
                plexUserId,
                librarySectionKey: params.librarySectionKey,
                collectionName: { in: collectionNames },
                downloadApproval: 'rejected',
            },
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
            movieSections: [],
            tvSections,
            limit,
            scope: { librarySectionKey: params.librarySectionKey, mode: 'tv' },
        });
        return { ok: true, approvalRequired, unmonitored, sent, refresh };
    }
    async apply(params) {
        const { settings, secrets } = await this.settings.getInternalSettings(params.userId);
        const { plexUserId, plexUserTitle, pinTarget } = await this.resolvePlexUserContext(params.userId);
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const plexToken = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!plexBaseUrlRaw)
            throw new common_1.BadGatewayException('Plex baseUrl is not set');
        if (!plexToken)
            throw new common_1.BadGatewayException('Plex token is not set');
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        const approvalRequired = (pickBool(settings, 'jobs.immaculateTastePoints.approvalRequiredFromObservatory') ??
            false) === true;
        const ctx = {
            jobId: 'observatoryApply',
            runId: `observatory-${Date.now()}`,
            userId: params.userId,
            dryRun: false,
            trigger: 'manual',
            input: {},
            getSummary: () => null,
            setSummary: async () => undefined,
            patchSummary: async () => undefined,
            log: async () => undefined,
            debug: async () => undefined,
            info: async () => undefined,
            warn: async () => undefined,
            error: async () => undefined,
        };
        const machineIdentifier = await this.plexServer.getMachineIdentifier({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        if (params.mediaType === 'movie') {
            return await this.applyMovies({
                ctx,
                settings,
                secrets,
                plexBaseUrl,
                plexToken,
                machineIdentifier,
                plexUserId,
                plexUserTitle,
                pinTarget,
                librarySectionKey: params.librarySectionKey,
                approvalRequired,
            });
        }
        return await this.applyTv({
            ctx,
            settings,
            secrets,
            plexBaseUrl,
            plexToken,
            machineIdentifier,
            plexUserId,
            plexUserTitle,
            pinTarget,
            librarySectionKey: params.librarySectionKey,
            approvalRequired,
        });
    }
    async applyMovies(params) {
        const radarrBaseUrlRaw = pickString(params.settings, 'radarr.baseUrl');
        const radarrApiKey = pickString(params.secrets, 'radarr.apiKey');
        const fetchMissingRadarr = pickBool(params.settings, 'jobs.immaculateTastePoints.fetchMissing.radarr') ??
            true;
        const radarrEnabled = fetchMissingRadarr &&
            (pickBool(params.settings, 'radarr.enabled') ?? Boolean(radarrApiKey)) &&
            Boolean(radarrBaseUrlRaw) &&
            Boolean(radarrApiKey);
        const radarrBaseUrl = radarrEnabled ? normalizeHttpUrl(radarrBaseUrlRaw) : '';
        const startSearchImmediately = (pickBool(params.settings, 'jobs.immaculateTastePoints.searchImmediately') ??
            false) === true;
        const rejected = await this.prisma.immaculateTasteMovieLibrary.findMany({
            where: {
                plexUserId: params.plexUserId,
                librarySectionKey: params.librarySectionKey,
                downloadApproval: 'rejected',
            },
            select: { tmdbId: true, sentToRadarrAt: true },
            take: 1000,
        });
        const approved = params.approvalRequired
            ? await this.prisma.immaculateTasteMovieLibrary.findMany({
                where: {
                    plexUserId: params.plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    status: 'pending',
                    downloadApproval: 'approved',
                },
                select: { tmdbId: true, title: true, sentToRadarrAt: true },
                take: 1000,
            })
            : [];
        let unmonitored = 0;
        if (radarrEnabled && rejected.some((r) => Boolean(r.sentToRadarrAt))) {
            const movies = await this.radarr.listMovies({
                baseUrl: radarrBaseUrl,
                apiKey: radarrApiKey,
            });
            const byTmdb = new Map();
            for (const m of movies) {
                const tmdbId = typeof m.tmdbId === 'number'
                    ? m.tmdbId
                    : Number(m.tmdbId);
                if (Number.isFinite(tmdbId) && tmdbId > 0)
                    byTmdb.set(Math.trunc(tmdbId), m);
            }
            for (const r of rejected) {
                if (!r.sentToRadarrAt)
                    continue;
                const movie = byTmdb.get(r.tmdbId) ?? null;
                if (!movie)
                    continue;
                await this.radarr
                    .setMovieMonitored({
                    baseUrl: radarrBaseUrl,
                    apiKey: radarrApiKey,
                    movie: movie,
                    monitored: false,
                })
                    .catch(() => undefined);
                unmonitored += 1;
            }
        }
        let sent = 0;
        if (params.approvalRequired && radarrEnabled && approved.length) {
            const defaults = await this.resolveRadarrDefaults({
                baseUrl: radarrBaseUrl,
                apiKey: radarrApiKey,
                preferredRootFolderPath: pickString(params.settings, 'radarr.defaultRootFolderPath') ||
                    pickString(params.settings, 'radarr.rootFolderPath'),
                preferredQualityProfileId: Math.max(1, Math.trunc(pickNumber(params.settings, 'radarr.defaultQualityProfileId') ??
                    pickNumber(params.settings, 'radarr.qualityProfileId') ??
                    1)) || 1,
                preferredTagId: (() => {
                    const v = pickNumber(params.settings, 'radarr.defaultTagId') ??
                        pickNumber(params.settings, 'radarr.tagId');
                    return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
                })(),
            });
            for (const r of approved) {
                if (r.sentToRadarrAt)
                    continue;
                const title = r.title ?? `tmdb:${r.tmdbId}`;
                const result = await this.radarr
                    .addMovie({
                    baseUrl: radarrBaseUrl,
                    apiKey: radarrApiKey,
                    title,
                    tmdbId: r.tmdbId,
                    year: null,
                    qualityProfileId: defaults.qualityProfileId,
                    rootFolderPath: defaults.rootFolderPath,
                    tags: defaults.tagIds,
                    monitored: true,
                    minimumAvailability: 'announced',
                    searchForMovie: startSearchImmediately,
                })
                    .catch(() => null);
                if (!result)
                    continue;
                sent += 1;
                await this.prisma.immaculateTasteMovieLibrary
                    .update({
                    where: {
                        plexUserId_librarySectionKey_tmdbId: {
                            plexUserId: params.plexUserId,
                            librarySectionKey: params.librarySectionKey,
                            tmdbId: r.tmdbId,
                        },
                    },
                    data: { sentToRadarrAt: new Date() },
                })
                    .catch(() => undefined);
            }
        }
        const rejectedIds = rejected.map((r) => r.tmdbId);
        let removedRows = 0;
        if (rejectedIds.length) {
            const res = await this.prisma.immaculateTasteMovieLibrary.deleteMany({
                where: {
                    plexUserId: params.plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    tmdbId: { in: rejectedIds },
                },
            });
            removedRows = res.count;
        }
        const plexItems = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
            baseUrl: params.plexBaseUrl,
            token: params.plexToken,
            librarySectionKey: params.librarySectionKey,
        });
        const tmdbToItem = new Map();
        for (const it of plexItems) {
            if (!it.tmdbId)
                continue;
            tmdbToItem.set(it.tmdbId, { ratingKey: it.ratingKey, title: it.title });
        }
        const activeRows = await this.immaculateMovies.getActiveMovies({
            plexUserId: params.plexUserId,
            librarySectionKey: params.librarySectionKey,
            minPoints: 1,
        });
        const orderedIds = this.immaculateMovies.buildThreeTierTmdbRatingShuffleOrder({
            movies: activeRows.map((m) => ({
                tmdbId: m.tmdbId,
                tmdbVoteAvg: m.tmdbVoteAvg ?? null,
                tmdbVoteCount: m.tmdbVoteCount ?? null,
            })),
        });
        const desiredItems = orderedIds
            .map((id) => tmdbToItem.get(id))
            .filter((v) => Boolean(v));
        const collectionName = (0, plex_collections_utils_1.buildUserCollectionName)('Inspired by your Immaculate Taste', params.plexUserTitle);
        const collectionHubOrder = (0, plex_collections_utils_1.buildUserCollectionHubOrder)(plex_collections_utils_1.CURATED_MOVIE_COLLECTION_HUB_ORDER, params.plexUserTitle);
        const plex = await this.plexCurated.rebuildMovieCollection({
            ctx: params.ctx,
            baseUrl: params.plexBaseUrl,
            token: params.plexToken,
            machineIdentifier: params.machineIdentifier,
            movieSectionKey: params.librarySectionKey,
            collectionName,
            itemType: 1,
            desiredItems,
            randomizeOrder: false,
            pinCollections: true,
            pinTarget: params.pinTarget,
            collectionHubOrder,
        });
        return {
            ok: true,
            mediaType: 'movie',
            librarySectionKey: params.librarySectionKey,
            approvalRequiredFromObservatory: params.approvalRequired,
            radarr: {
                enabled: radarrEnabled,
                sent,
                unmonitored,
            },
            dataset: { removed: removedRows },
            plex,
        };
    }
    async applyTv(params) {
        const sonarrBaseUrlRaw = pickString(params.settings, 'sonarr.baseUrl');
        const sonarrApiKey = pickString(params.secrets, 'sonarr.apiKey');
        const fetchMissingSonarr = pickBool(params.settings, 'jobs.immaculateTastePoints.fetchMissing.sonarr') ??
            true;
        const sonarrEnabled = fetchMissingSonarr &&
            (pickBool(params.settings, 'sonarr.enabled') ?? Boolean(sonarrApiKey)) &&
            Boolean(sonarrBaseUrlRaw) &&
            Boolean(sonarrApiKey);
        const sonarrBaseUrl = sonarrEnabled ? normalizeHttpUrl(sonarrBaseUrlRaw) : '';
        const startSearchImmediately = (pickBool(params.settings, 'jobs.immaculateTastePoints.searchImmediately') ??
            false) === true;
        const rejected = await this.prisma.immaculateTasteShowLibrary.findMany({
            where: {
                plexUserId: params.plexUserId,
                librarySectionKey: params.librarySectionKey,
                downloadApproval: 'rejected',
            },
            select: { tvdbId: true, sentToSonarrAt: true },
            take: 1000,
        });
        const approved = await this.prisma.immaculateTasteShowLibrary.findMany({
            where: {
                plexUserId: params.plexUserId,
                librarySectionKey: params.librarySectionKey,
                status: 'pending',
                downloadApproval: 'approved',
                ...(params.approvalRequired ? {} : { tvdbId: { equals: -1 } }),
            },
            select: { tvdbId: true, title: true, sentToSonarrAt: true },
            take: 1000,
        });
        let unmonitored = 0;
        if (sonarrEnabled && rejected.some((r) => Boolean(r.sentToSonarrAt))) {
            const series = await this.sonarr.listSeries({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
            });
            const byTvdb = new Map();
            for (const s of series) {
                const tvdbId = typeof s.tvdbId === 'number'
                    ? s.tvdbId
                    : Number(s.tvdbId);
                if (Number.isFinite(tvdbId) && tvdbId > 0)
                    byTvdb.set(Math.trunc(tvdbId), s);
            }
            for (const r of rejected) {
                if (!r.sentToSonarrAt)
                    continue;
                const s = byTvdb.get(r.tvdbId) ?? null;
                if (!s)
                    continue;
                if (s.monitored === false)
                    continue;
                await this.sonarr
                    .updateSeries({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    series: { ...s, monitored: false },
                })
                    .catch(() => undefined);
                unmonitored += 1;
            }
        }
        let sent = 0;
        if (params.approvalRequired && sonarrEnabled && approved.length) {
            const defaults = await this.resolveSonarrDefaults({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
                preferredRootFolderPath: pickString(params.settings, 'sonarr.defaultRootFolderPath') ||
                    pickString(params.settings, 'sonarr.rootFolderPath'),
                preferredQualityProfileId: Math.max(1, Math.trunc(pickNumber(params.settings, 'sonarr.defaultQualityProfileId') ??
                    pickNumber(params.settings, 'sonarr.qualityProfileId') ??
                    1)) || 1,
                preferredTagId: (() => {
                    const v = pickNumber(params.settings, 'sonarr.defaultTagId') ??
                        pickNumber(params.settings, 'sonarr.tagId');
                    return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
                })(),
            });
            for (const r of approved) {
                if (r.sentToSonarrAt)
                    continue;
                const title = r.title ?? `tvdb:${r.tvdbId}`;
                const result = await this.sonarr
                    .addSeries({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    title,
                    tvdbId: r.tvdbId,
                    qualityProfileId: defaults.qualityProfileId,
                    rootFolderPath: defaults.rootFolderPath,
                    tags: defaults.tagIds,
                    monitored: true,
                    searchForMissingEpisodes: startSearchImmediately,
                })
                    .catch(() => null);
                if (!result)
                    continue;
                sent += 1;
                await this.prisma.immaculateTasteShowLibrary
                    .update({
                    where: {
                        plexUserId_librarySectionKey_tvdbId: {
                            plexUserId: params.plexUserId,
                            librarySectionKey: params.librarySectionKey,
                            tvdbId: r.tvdbId,
                        },
                    },
                    data: { sentToSonarrAt: new Date() },
                })
                    .catch(() => undefined);
            }
        }
        const rejectedIds = rejected.map((r) => r.tvdbId);
        let removedRows = 0;
        if (rejectedIds.length) {
            const res = await this.prisma.immaculateTasteShowLibrary.deleteMany({
                where: {
                    plexUserId: params.plexUserId,
                    librarySectionKey: params.librarySectionKey,
                    tvdbId: { in: rejectedIds },
                },
            });
            removedRows = res.count;
        }
        const plexItems = await this.plexServer.listShowsWithTvdbIdsForSectionKey({
            baseUrl: params.plexBaseUrl,
            token: params.plexToken,
            librarySectionKey: params.librarySectionKey,
        });
        const tvdbToItem = new Map();
        for (const it of plexItems) {
            if (!it.tvdbId)
                continue;
            tvdbToItem.set(it.tvdbId, { ratingKey: it.ratingKey, title: it.title });
        }
        const activeRows = await this.immaculateTv.getActiveShows({
            plexUserId: params.plexUserId,
            librarySectionKey: params.librarySectionKey,
            minPoints: 1,
        });
        const orderedIds = this.immaculateTv.buildThreeTierTmdbRatingShuffleOrder({
            shows: activeRows.map((s) => ({
                tvdbId: s.tvdbId,
                tmdbVoteAvg: s.tmdbVoteAvg ?? null,
                tmdbVoteCount: s.tmdbVoteCount ?? null,
            })),
        });
        const desiredItems = orderedIds
            .map((id) => tvdbToItem.get(id))
            .filter((v) => Boolean(v));
        const collectionName = (0, plex_collections_utils_1.buildUserCollectionName)('Inspired by your Immaculate Taste', params.plexUserTitle);
        const collectionHubOrder = (0, plex_collections_utils_1.buildUserCollectionHubOrder)(plex_collections_utils_1.CURATED_TV_COLLECTION_HUB_ORDER, params.plexUserTitle);
        const plex = await this.plexCurated.rebuildMovieCollection({
            ctx: params.ctx,
            baseUrl: params.plexBaseUrl,
            token: params.plexToken,
            machineIdentifier: params.machineIdentifier,
            movieSectionKey: params.librarySectionKey,
            collectionName,
            itemType: 2,
            desiredItems,
            randomizeOrder: false,
            pinCollections: true,
            pinTarget: params.pinTarget,
            collectionHubOrder,
        });
        return {
            ok: true,
            mediaType: 'tv',
            librarySectionKey: params.librarySectionKey,
            approvalRequiredFromObservatory: params.approvalRequired,
            sonarr: {
                enabled: sonarrEnabled,
                sent,
                unmonitored,
            },
            dataset: { removed: removedRows },
            plex,
        };
    }
    async resolveRadarrDefaults(params) {
        const [rootFolders, qualityProfiles, tags] = await Promise.all([
            this.radarr.listRootFolders({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
            this.radarr.listQualityProfiles({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
            this.radarr.listTags({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
        ]);
        if (!rootFolders.length)
            throw new common_1.BadGatewayException('Radarr has no root folders');
        if (!qualityProfiles.length)
            throw new common_1.BadGatewayException('Radarr has no quality profiles');
        const rootFolderPath = rootFolders.find((r) => r.path === params.preferredRootFolderPath)?.path ??
            rootFolders[0].path;
        const qualityProfileId = qualityProfiles.find((q) => q.id === params.preferredQualityProfileId)?.id ??
            qualityProfiles[0].id;
        const tagIds = [];
        if (params.preferredTagId) {
            const exists = tags.find((t) => t.id === params.preferredTagId);
            if (exists)
                tagIds.push(exists.id);
        }
        return { rootFolderPath, qualityProfileId, tagIds };
    }
    async resolveSonarrDefaults(params) {
        const [rootFolders, qualityProfiles, tags] = await Promise.all([
            this.sonarr.listRootFolders({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
            this.sonarr.listQualityProfiles({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
            this.sonarr.listTags({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
        ]);
        if (!rootFolders.length)
            throw new common_1.BadGatewayException('Sonarr has no root folders');
        if (!qualityProfiles.length)
            throw new common_1.BadGatewayException('Sonarr has no quality profiles');
        const rootFolderPath = rootFolders.find((r) => r.path === params.preferredRootFolderPath)?.path ??
            rootFolders[0].path;
        const qualityProfileId = qualityProfiles.find((q) => q.id === params.preferredQualityProfileId)?.id ??
            qualityProfiles[0].id;
        const tagIds = [];
        if (params.preferredTagId) {
            const exists = tags.find((t) => t.id === params.preferredTagId);
            if (exists)
                tagIds.push(exists.id);
        }
        return { rootFolderPath, qualityProfileId, tagIds };
    }
};
exports.ObservatoryService = ObservatoryService;
exports.ObservatoryService = ObservatoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService,
        plex_curated_collections_service_1.PlexCuratedCollectionsService,
        plex_users_service_1.PlexUsersService,
        radarr_service_1.RadarrService,
        sonarr_service_1.SonarrService,
        tmdb_service_1.TmdbService,
        immaculate_taste_collection_service_1.ImmaculateTasteCollectionService,
        immaculate_taste_show_collection_service_1.ImmaculateTasteShowCollectionService,
        watched_collections_refresher_service_1.WatchedCollectionsRefresherService])
], ObservatoryService);
//# sourceMappingURL=observatory.service.js.map