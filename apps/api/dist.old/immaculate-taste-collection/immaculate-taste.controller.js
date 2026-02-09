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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImmaculateTasteController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const prisma_service_1 = require("../db/prisma.service");
const plex_collections_utils_1 = require("../plex/plex-collections.utils");
const plex_server_service_1 = require("../plex/plex-server.service");
const plex_users_service_1 = require("../plex/plex-users.service");
const settings_service_1 = require("../settings/settings.service");
const immaculate_taste_reset_1 = require("./immaculate-taste-reset");
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
function normalizeHttpUrl(raw) {
    const trimmed = raw.trim();
    const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const parsed = new URL(baseUrl);
        if (!/^https?:$/i.test(parsed.protocol)) {
            throw new Error('Unsupported protocol');
        }
    }
    catch {
        throw new common_1.BadRequestException('Plex baseUrl must be a valid http(s) URL');
    }
    return baseUrl;
}
const IMMACULATE_PLEX_COLLECTION_BASE_NAME = 'Inspired by your Immaculate Taste';
let ImmaculateTasteController = class ImmaculateTasteController {
    prisma;
    settingsService;
    plexServer;
    plexUsers;
    constructor(prisma, settingsService, plexServer, plexUsers) {
        this.prisma = prisma;
        this.settingsService = settingsService;
        this.plexServer = plexServer;
        this.plexUsers = plexUsers;
    }
    async listCollections(req) {
        const userId = req.user.id;
        const adminPlexUser = await this.plexUsers.ensureAdminPlexUser({ userId });
        const plexUserId = adminPlexUser.id;
        const plexUserTitle = adminPlexUser.plexAccountTitle;
        const { settings, secrets } = await this.settingsService.getInternalSettings(userId);
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const plexToken = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!plexBaseUrlRaw)
            throw new common_1.BadRequestException('Plex baseUrl is not set');
        if (!plexToken)
            throw new common_1.BadRequestException('Plex token is not set');
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        const sections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const movieSections = sections.filter((s) => (s.type ?? '').toLowerCase() === 'movie');
        const tvSections = sections.filter((s) => (s.type ?? '').toLowerCase() === 'show');
        const collectionName = (0, plex_collections_utils_1.buildUserCollectionName)(IMMACULATE_PLEX_COLLECTION_BASE_NAME, plexUserTitle);
        const movieEntries = await Promise.all(movieSections.map(async (sec) => {
            const [total, active, pending] = await Promise.all([
                this.prisma.immaculateTasteMovieLibrary.count({
                    where: { plexUserId, librarySectionKey: sec.key },
                }),
                this.prisma.immaculateTasteMovieLibrary.count({
                    where: {
                        plexUserId,
                        librarySectionKey: sec.key,
                        status: 'active',
                        points: { gt: 0 },
                    },
                }),
                this.prisma.immaculateTasteMovieLibrary.count({
                    where: { plexUserId, librarySectionKey: sec.key, status: 'pending' },
                }),
            ]);
            let collectionRatingKey = null;
            let plexItemCount = null;
            try {
                collectionRatingKey = await this.plexServer.findCollectionRatingKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey: sec.key,
                    collectionName,
                });
                if (collectionRatingKey) {
                    const items = await this.plexServer.getCollectionItems({
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        collectionRatingKey,
                    });
                    plexItemCount = items.length;
                }
            }
            catch {
            }
            return {
                mediaType: 'movie',
                librarySectionKey: sec.key,
                libraryTitle: sec.title,
                dataset: { total, active, pending },
                plex: {
                    collectionName,
                    collectionRatingKey,
                    itemCount: plexItemCount,
                },
            };
        }));
        const tvEntries = await Promise.all(tvSections.map(async (sec) => {
            const [total, active, pending] = await Promise.all([
                this.prisma.immaculateTasteShowLibrary.count({
                    where: { plexUserId, librarySectionKey: sec.key },
                }),
                this.prisma.immaculateTasteShowLibrary.count({
                    where: {
                        plexUserId,
                        librarySectionKey: sec.key,
                        status: 'active',
                        points: { gt: 0 },
                    },
                }),
                this.prisma.immaculateTasteShowLibrary.count({
                    where: { plexUserId, librarySectionKey: sec.key, status: 'pending' },
                }),
            ]);
            let collectionRatingKey = null;
            let plexItemCount = null;
            try {
                collectionRatingKey = await this.plexServer.findCollectionRatingKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey: sec.key,
                    collectionName,
                });
                if (collectionRatingKey) {
                    const items = await this.plexServer.getCollectionItems({
                        baseUrl: plexBaseUrl,
                        token: plexToken,
                        collectionRatingKey,
                    });
                    plexItemCount = items.length;
                }
            }
            catch {
            }
            return {
                mediaType: 'tv',
                librarySectionKey: sec.key,
                libraryTitle: sec.title,
                dataset: { total, active, pending },
                plex: {
                    collectionName,
                    collectionRatingKey,
                    itemCount: plexItemCount,
                },
            };
        }));
        return {
            collectionName,
            collections: [...movieEntries, ...tvEntries],
        };
    }
    async listCollectionUsers(req) {
        await this.plexUsers.ensureAdminPlexUser({ userId: req.user.id });
        const users = await this.prisma.plexUser.findMany({
            orderBy: [{ isAdmin: 'desc' }, { createdAt: 'asc' }],
        });
        const movieCounts = await this.prisma.immaculateTasteMovieLibrary.groupBy({
            by: ['plexUserId'],
            _count: { _all: true },
        });
        const tvCounts = await this.prisma.immaculateTasteShowLibrary.groupBy({
            by: ['plexUserId'],
            _count: { _all: true },
        });
        const movieByUser = new Map(movieCounts.map((row) => [row.plexUserId, row._count._all]));
        const tvByUser = new Map(tvCounts.map((row) => [row.plexUserId, row._count._all]));
        return {
            users: users.map((user) => ({
                id: user.id,
                plexAccountTitle: user.plexAccountTitle,
                isAdmin: user.isAdmin,
                movieCount: movieByUser.get(user.id) ?? 0,
                tvCount: tvByUser.get(user.id) ?? 0,
            })),
        };
    }
    async resetCollection(req, body) {
        const userId = req.user.id;
        const mediaTypeRaw = typeof body?.mediaType === 'string' ? body.mediaType.trim() : '';
        const mediaType = mediaTypeRaw.toLowerCase();
        const librarySectionKey = typeof body?.librarySectionKey === 'string' ? body.librarySectionKey.trim() : '';
        if (mediaType !== 'movie' && mediaType !== 'tv') {
            throw new common_1.BadRequestException('mediaType must be "movie" or "tv"');
        }
        if (!librarySectionKey) {
            throw new common_1.BadRequestException('librarySectionKey is required');
        }
        const adminPlexUser = await this.plexUsers.ensureAdminPlexUser({ userId });
        const plexUserId = adminPlexUser.id;
        const plexUserTitle = adminPlexUser.plexAccountTitle;
        const collectionName = (0, plex_collections_utils_1.buildUserCollectionName)(IMMACULATE_PLEX_COLLECTION_BASE_NAME, plexUserTitle);
        const { settings, secrets } = await this.settingsService.getInternalSettings(userId);
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const plexToken = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!plexBaseUrlRaw)
            throw new common_1.BadRequestException('Plex baseUrl is not set');
        if (!plexToken)
            throw new common_1.BadRequestException('Plex token is not set');
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        const sections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const sec = sections.find((s) => s.key === librarySectionKey) ?? null;
        if (!sec) {
            throw new common_1.BadRequestException('Plex library section not found');
        }
        const secType = (sec.type ?? '').toLowerCase();
        if (mediaType === 'movie' && secType !== 'movie') {
            throw new common_1.BadRequestException('librarySectionKey is not a movie library');
        }
        if (mediaType === 'tv' && secType !== 'show') {
            throw new common_1.BadRequestException('librarySectionKey is not a TV library');
        }
        let plexDeleted = false;
        let collectionRatingKey = null;
        try {
            collectionRatingKey = await this.plexServer.findCollectionRatingKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                librarySectionKey,
                collectionName,
            });
            if (collectionRatingKey) {
                await this.plexServer.deleteCollection({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    collectionRatingKey,
                });
                plexDeleted = true;
            }
        }
        catch {
        }
        const datasetDeleted = mediaType === 'movie'
            ? await this.prisma.immaculateTasteMovieLibrary.deleteMany({
                where: { plexUserId, librarySectionKey },
            })
            : await this.prisma.immaculateTasteShowLibrary.deleteMany({
                where: { plexUserId, librarySectionKey },
            });
        await this.prisma.setting
            .upsert({
            where: { key: (0, immaculate_taste_reset_1.immaculateTasteResetMarkerKey)({ mediaType, librarySectionKey }) },
            update: { value: new Date().toISOString(), encrypted: false },
            create: {
                key: (0, immaculate_taste_reset_1.immaculateTasteResetMarkerKey)({ mediaType, librarySectionKey }),
                value: new Date().toISOString(),
                encrypted: false,
            },
        })
            .catch(() => undefined);
        return {
            ok: true,
            mediaType,
            librarySectionKey,
            libraryTitle: sec.title,
            plex: {
                collectionName,
                collectionRatingKey,
                deleted: plexDeleted,
            },
            dataset: {
                deleted: datasetDeleted.count,
            },
        };
    }
    async resetUserCollections(req, body) {
        const userId = req.user.id;
        await this.plexUsers.ensureAdminPlexUser({ userId });
        const mediaTypeRaw = typeof body?.mediaType === 'string' ? body.mediaType.trim() : '';
        const mediaType = mediaTypeRaw.toLowerCase();
        const plexUserId = typeof body?.plexUserId === 'string' ? body.plexUserId.trim() : '';
        if (mediaType !== 'movie' && mediaType !== 'tv') {
            throw new common_1.BadRequestException('mediaType must be "movie" or "tv"');
        }
        if (!plexUserId) {
            throw new common_1.BadRequestException('plexUserId is required');
        }
        const plexUser = await this.plexUsers.getPlexUserById(plexUserId);
        if (!plexUser) {
            throw new common_1.BadRequestException('Plex user not found');
        }
        const { settings, secrets } = await this.settingsService.getInternalSettings(userId);
        const plexBaseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const plexToken = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!plexBaseUrlRaw)
            throw new common_1.BadRequestException('Plex baseUrl is not set');
        if (!plexToken)
            throw new common_1.BadRequestException('Plex token is not set');
        const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
        const sections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: plexToken,
        });
        const targetType = mediaType === 'movie' ? 'movie' : 'show';
        const targetSections = sections.filter((s) => (s.type ?? '').toLowerCase() === targetType);
        const collectionName = (0, plex_collections_utils_1.buildUserCollectionName)(IMMACULATE_PLEX_COLLECTION_BASE_NAME, plexUser.plexAccountTitle);
        let plexDeleted = 0;
        for (const sec of targetSections) {
            try {
                const collectionRatingKey = await this.plexServer.findCollectionRatingKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey: sec.key,
                    collectionName,
                });
                if (!collectionRatingKey)
                    continue;
                await this.plexServer.deleteCollection({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    collectionRatingKey,
                });
                plexDeleted += 1;
            }
            catch {
            }
        }
        const datasetDeleted = mediaType === 'movie'
            ? await this.prisma.immaculateTasteMovieLibrary.deleteMany({
                where: { plexUserId: plexUser.id },
            })
            : await this.prisma.immaculateTasteShowLibrary.deleteMany({
                where: { plexUserId: plexUser.id },
            });
        const resetAt = new Date().toISOString();
        await Promise.all(targetSections.map((sec) => this.prisma.setting
            .upsert({
            where: {
                key: (0, immaculate_taste_reset_1.immaculateTasteResetMarkerKey)({
                    mediaType,
                    librarySectionKey: sec.key,
                }),
            },
            update: { value: resetAt, encrypted: false },
            create: {
                key: (0, immaculate_taste_reset_1.immaculateTasteResetMarkerKey)({
                    mediaType,
                    librarySectionKey: sec.key,
                }),
                value: resetAt,
                encrypted: false,
            },
        })
            .catch(() => undefined)));
        return {
            ok: true,
            mediaType,
            plexUserId: plexUser.id,
            plexUserTitle: plexUser.plexAccountTitle,
            plex: {
                collectionName,
                deleted: plexDeleted,
                libraries: targetSections.length,
            },
            dataset: { deleted: datasetDeleted.count },
        };
    }
};
exports.ImmaculateTasteController = ImmaculateTasteController;
__decorate([
    (0, common_1.Get)('collections'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ImmaculateTasteController.prototype, "listCollections", null);
__decorate([
    (0, common_1.Get)('collections/users'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ImmaculateTasteController.prototype, "listCollectionUsers", null);
__decorate([
    (0, common_1.Post)('collections/reset'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImmaculateTasteController.prototype, "resetCollection", null);
__decorate([
    (0, common_1.Post)('collections/reset-user'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImmaculateTasteController.prototype, "resetUserCollections", null);
exports.ImmaculateTasteController = ImmaculateTasteController = __decorate([
    (0, common_1.Controller)('immaculate-taste'),
    (0, swagger_1.ApiTags)('immaculate-taste'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService,
        plex_users_service_1.PlexUsersService])
], ImmaculateTasteController);
//# sourceMappingURL=immaculate-taste.controller.js.map