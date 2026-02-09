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
exports.WatchedCollectionsRefresherService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../db/prisma.service");
const plex_curated_collections_service_1 = require("../plex/plex-curated-collections.service");
const plex_collections_utils_1 = require("../plex/plex-collections.utils");
const plex_server_service_1 = require("../plex/plex-server.service");
const MOVIE_COLLECTIONS = [
    'Based on your recently watched movie',
    'Change of Taste',
];
const TV_COLLECTIONS = [
    'Based on your recently watched show',
    'Change of Taste',
];
function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}
let WatchedCollectionsRefresherService = class WatchedCollectionsRefresherService {
    prisma;
    plexServer;
    plexCurated;
    constructor(prisma, plexServer, plexCurated) {
        this.prisma = prisma;
        this.plexServer = plexServer;
        this.plexCurated = plexCurated;
    }
    async refresh(params) {
        const { ctx } = params;
        const limit = Math.max(1, Math.min(200, Math.trunc(params.limit || 15)));
        const scope = params.scope ?? null;
        const pinCollections = params.pinCollections ?? true;
        const pinTarget = params.pinTarget ?? 'admin';
        const movieSections = scope?.mode === 'movie'
            ? params.movieSections.filter((s) => s.key === scope.librarySectionKey)
            : scope
                ? []
                : params.movieSections;
        const tvSections = scope?.mode === 'tv'
            ? params.tvSections.filter((s) => s.key === scope.librarySectionKey)
            : scope
                ? []
                : params.tvSections;
        const movie = await this.refreshMovieCollections({
            ctx,
            plexBaseUrl: params.plexBaseUrl,
            plexToken: params.plexToken,
            machineIdentifier: params.machineIdentifier,
            plexUserId: params.plexUserId,
            plexUserTitle: params.plexUserTitle,
            pinCollections,
            pinTarget,
            movieSections,
            limit,
        });
        const tv = await this.refreshTvCollections({
            ctx,
            plexBaseUrl: params.plexBaseUrl,
            plexToken: params.plexToken,
            machineIdentifier: params.machineIdentifier,
            plexUserId: params.plexUserId,
            plexUserTitle: params.plexUserTitle,
            pinCollections,
            pinTarget,
            tvSections,
            limit,
        });
        return { limit, movie, tv };
    }
    async refreshMovieCollections(params) {
        const { ctx, plexBaseUrl, plexToken, machineIdentifier, plexUserId, plexUserTitle, pinCollections, pinTarget, movieSections, limit, } = params;
        const outByLibrary = [];
        const collectionHubOrder = (0, plex_collections_utils_1.buildUserCollectionHubOrder)(plex_collections_utils_1.CURATED_MOVIE_COLLECTION_HUB_ORDER, plexUserTitle);
        for (const sec of movieSections) {
            const rows = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                librarySectionKey: sec.key,
                sectionTitle: sec.title,
            });
            const tmdbMap = new Map();
            for (const r of rows) {
                if (!r.tmdbId)
                    continue;
                if (!tmdbMap.has(r.tmdbId))
                    tmdbMap.set(r.tmdbId, { ratingKey: r.ratingKey, title: r.title });
            }
            const perCollection = [];
            for (const collectionName of MOVIE_COLLECTIONS) {
                const pending = await this.prisma.watchedMovieRecommendationLibrary.findMany({
                    where: {
                        plexUserId,
                        collectionName,
                        librarySectionKey: sec.key,
                        status: 'pending',
                    },
                    select: { tmdbId: true },
                });
                const toActivate = pending
                    .map((p) => p.tmdbId)
                    .filter((id) => tmdbMap.has(id));
                const activatedNow = ctx.dryRun
                    ? toActivate.length
                    : (await this.prisma.watchedMovieRecommendationLibrary.updateMany({
                        where: {
                            plexUserId,
                            collectionName,
                            librarySectionKey: sec.key,
                            status: 'pending',
                            tmdbId: { in: toActivate },
                        },
                        data: { status: 'active' },
                    })).count;
                const active = await this.prisma.watchedMovieRecommendationLibrary.findMany({
                    where: {
                        plexUserId,
                        collectionName,
                        librarySectionKey: sec.key,
                        status: 'active',
                    },
                    select: { tmdbId: true },
                });
                const activeTmdbIds = active
                    .map((a) => a.tmdbId)
                    .filter((id) => tmdbMap.has(id));
                shuffleInPlace(activeTmdbIds);
                const desiredItems = activeTmdbIds
                    .slice(0, limit)
                    .map((id) => tmdbMap.get(id))
                    .filter((v) => Boolean(v));
                const plex = !ctx.dryRun
                    ? await this.plexCurated.rebuildMovieCollection({
                        ctx,
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        machineIdentifier,
                        movieSectionKey: sec.key,
                        itemType: 1,
                        collectionName: (0, plex_collections_utils_1.buildUserCollectionName)(collectionName, plexUserTitle),
                        desiredItems,
                        randomizeOrder: false,
                        pinCollections,
                        pinTarget,
                        collectionHubOrder,
                    })
                    : null;
                perCollection.push({
                    collectionName,
                    activatedNow,
                    active: activeTmdbIds.length,
                    applying: desiredItems.length,
                    desiredTitles: desiredItems.map((d) => d.title),
                    plex,
                });
            }
            outByLibrary.push({
                librarySectionKey: sec.key,
                library: sec.title,
                collections: perCollection,
            });
        }
        return { collections: Array.from(MOVIE_COLLECTIONS), byLibrary: outByLibrary };
    }
    async refreshTvCollections(params) {
        const { ctx, plexBaseUrl, plexToken, machineIdentifier, plexUserId, plexUserTitle, pinCollections, pinTarget, tvSections, limit, } = params;
        const outByLibrary = [];
        const collectionHubOrder = (0, plex_collections_utils_1.buildUserCollectionHubOrder)(plex_collections_utils_1.CURATED_TV_COLLECTION_HUB_ORDER, plexUserTitle);
        for (const sec of tvSections) {
            const rows = await this.plexServer.listShowsWithTvdbIdsForSectionKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                librarySectionKey: sec.key,
                sectionTitle: sec.title,
            });
            const tvdbMap = new Map();
            for (const r of rows) {
                if (!r.tvdbId)
                    continue;
                if (!tvdbMap.has(r.tvdbId))
                    tvdbMap.set(r.tvdbId, { ratingKey: r.ratingKey, title: r.title });
            }
            const perCollection = [];
            for (const collectionName of TV_COLLECTIONS) {
                const pending = await this.prisma.watchedShowRecommendationLibrary.findMany({
                    where: {
                        plexUserId,
                        collectionName,
                        librarySectionKey: sec.key,
                        status: 'pending',
                    },
                    select: { tvdbId: true },
                });
                const toActivate = pending
                    .map((p) => p.tvdbId)
                    .filter((id) => tvdbMap.has(id));
                const activatedNow = ctx.dryRun
                    ? toActivate.length
                    : (await this.prisma.watchedShowRecommendationLibrary.updateMany({
                        where: {
                            plexUserId,
                            collectionName,
                            librarySectionKey: sec.key,
                            status: 'pending',
                            tvdbId: { in: toActivate },
                        },
                        data: { status: 'active' },
                    })).count;
                const active = await this.prisma.watchedShowRecommendationLibrary.findMany({
                    where: {
                        plexUserId,
                        collectionName,
                        librarySectionKey: sec.key,
                        status: 'active',
                    },
                    select: { tvdbId: true },
                });
                const activeTvdbIds = active
                    .map((a) => a.tvdbId)
                    .filter((id) => tvdbMap.has(id));
                shuffleInPlace(activeTvdbIds);
                const desiredItems = activeTvdbIds
                    .slice(0, limit)
                    .map((id) => tvdbMap.get(id))
                    .filter((v) => Boolean(v));
                const plex = !ctx.dryRun
                    ? await this.plexCurated.rebuildMovieCollection({
                        ctx,
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        machineIdentifier,
                        movieSectionKey: sec.key,
                        itemType: 2,
                        collectionName: (0, plex_collections_utils_1.buildUserCollectionName)(collectionName, plexUserTitle),
                        desiredItems,
                        randomizeOrder: false,
                        pinCollections,
                        pinTarget,
                        collectionHubOrder,
                    })
                    : null;
                perCollection.push({
                    collectionName,
                    activatedNow,
                    active: activeTvdbIds.length,
                    applying: desiredItems.length,
                    desiredTitles: desiredItems.map((d) => d.title),
                    plex,
                });
            }
            outByLibrary.push({
                librarySectionKey: sec.key,
                library: sec.title,
                collections: perCollection,
            });
        }
        return { collections: Array.from(TV_COLLECTIONS), byLibrary: outByLibrary };
    }
};
exports.WatchedCollectionsRefresherService = WatchedCollectionsRefresherService;
exports.WatchedCollectionsRefresherService = WatchedCollectionsRefresherService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plex_server_service_1.PlexServerService,
        plex_curated_collections_service_1.PlexCuratedCollectionsService])
], WatchedCollectionsRefresherService);
//# sourceMappingURL=watched-collections-refresher.service.js.map