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
var PlexUsersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexUsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../db/prisma.service");
const settings_service_1 = require("../settings/settings.service");
const plex_service_1 = require("./plex.service");
const DEFAULT_ADMIN_ID = 'plex-admin';
function coerceAccountId(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const n = Number.parseInt(value.trim(), 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function normalizeTitle(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
let PlexUsersService = PlexUsersService_1 = class PlexUsersService {
    prisma;
    settingsService;
    plexService;
    logger = new common_1.Logger(PlexUsersService_1.name);
    constructor(prisma, settingsService, plexService) {
        this.prisma = prisma;
        this.settingsService = settingsService;
        this.plexService = plexService;
    }
    async resolvePlexUser(params) {
        const { plexAccountId, plexAccountTitle, userId } = params;
        const hasIdentity = Boolean(plexAccountId) || Boolean(plexAccountTitle);
        if (hasIdentity) {
            const resolved = await this.getOrCreateByPlexAccount({
                plexAccountId,
                plexAccountTitle,
            });
            if (resolved)
                return resolved;
        }
        const admin = await this.ensureAdminPlexUser({ userId });
        return admin;
    }
    async getAdminPlexUser() {
        const admin = await this.prisma.plexUser.findFirst({
            where: { isAdmin: true },
            orderBy: { createdAt: 'asc' },
        });
        if (admin)
            return admin;
        return await this.createAdminPlaceholder();
    }
    async getPlexUserById(id) {
        const plexUserId = id.trim();
        if (!plexUserId)
            return null;
        return await this.prisma.plexUser.findUnique({
            where: { id: plexUserId },
        });
    }
    async getOrCreateByPlexAccount(params) {
        const accountId = coerceAccountId(params.plexAccountId);
        const title = normalizeTitle(params.plexAccountTitle);
        if (!accountId && !title)
            return null;
        const byAccount = accountId
            ? await this.prisma.plexUser.findUnique({
                where: { plexAccountId: accountId },
            })
            : null;
        const byTitle = title
            ? await this.prisma.plexUser.findFirst({
                where: { plexAccountTitle: title },
            })
            : null;
        if (byAccount && byTitle && byAccount.id !== byTitle.id) {
            await this.mergePlexUserData({ fromId: byTitle.id, toId: byAccount.id });
        }
        const target = byAccount ?? byTitle;
        if (target) {
            return await this.prisma.plexUser.update({
                where: { id: target.id },
                data: {
                    plexAccountId: accountId ?? target.plexAccountId,
                    plexAccountTitle: title ?? target.plexAccountTitle,
                    lastSeenAt: new Date(),
                },
            });
        }
        return await this.prisma.plexUser.create({
            data: {
                plexAccountId: accountId ?? null,
                plexAccountTitle: title ?? 'Unknown',
                isAdmin: false,
                lastSeenAt: new Date(),
            },
        });
    }
    async ensureAdminPlexUser(params) {
        const adminUserId = params.userId ?? (await this.getFirstAdminUserId());
        const identity = await this.getAdminIdentity(adminUserId);
        const accountId = coerceAccountId(identity?.plexAccountId);
        const title = normalizeTitle(identity?.plexAccountTitle);
        let admin = await this.prisma.plexUser.findFirst({
            where: { isAdmin: true },
            orderBy: { createdAt: 'asc' },
        });
        if (!admin) {
            if (accountId) {
                const existing = await this.prisma.plexUser.findUnique({
                    where: { plexAccountId: accountId },
                });
                if (existing) {
                    admin = await this.prisma.plexUser.update({
                        where: { id: existing.id },
                        data: {
                            plexAccountTitle: title ?? existing.plexAccountTitle,
                            isAdmin: true,
                            lastSeenAt: new Date(),
                        },
                    });
                }
            }
        }
        if (!admin) {
            admin = await this.createAdminPlaceholder();
        }
        if (accountId) {
            const duplicate = await this.prisma.plexUser.findUnique({
                where: { plexAccountId: accountId },
            });
            if (duplicate && duplicate.id !== admin.id) {
                await this.mergePlexUserData({ fromId: duplicate.id, toId: admin.id });
            }
        }
        await this.prisma.plexUser.updateMany({
            where: { id: { not: admin.id }, isAdmin: true },
            data: { isAdmin: false },
        });
        return await this.prisma.plexUser.update({
            where: { id: admin.id },
            data: {
                plexAccountId: accountId ?? admin.plexAccountId,
                plexAccountTitle: title ?? admin.plexAccountTitle,
                isAdmin: true,
                lastSeenAt: new Date(),
            },
        });
    }
    async backfillAdminOnMissing() {
        const admin = await this.getAdminPlexUser();
        const adminId = admin.id;
        await this.prisma.$executeRaw `
      UPDATE "ImmaculateTasteMovieLibrary" SET "plexUserId" = ${adminId} WHERE "plexUserId" IS NULL
    `;
        await this.prisma.$executeRaw `
      UPDATE "ImmaculateTasteShowLibrary" SET "plexUserId" = ${adminId} WHERE "plexUserId" IS NULL
    `;
        await this.prisma.$executeRaw `
      UPDATE "WatchedMovieRecommendationLibrary" SET "plexUserId" = ${adminId} WHERE "plexUserId" IS NULL
    `;
        await this.prisma.$executeRaw `
      UPDATE "WatchedShowRecommendationLibrary" SET "plexUserId" = ${adminId} WHERE "plexUserId" IS NULL
    `;
    }
    async createAdminPlaceholder() {
        try {
            return await this.prisma.plexUser.create({
                data: {
                    id: DEFAULT_ADMIN_ID,
                    plexAccountTitle: 'Admin',
                    isAdmin: true,
                    lastSeenAt: new Date(),
                },
            });
        }
        catch {
            const existing = await this.prisma.plexUser.findFirst({
                where: { id: DEFAULT_ADMIN_ID },
            });
            if (existing)
                return existing;
            return await this.prisma.plexUser.create({
                data: {
                    plexAccountTitle: 'Admin',
                    isAdmin: true,
                    lastSeenAt: new Date(),
                },
            });
        }
    }
    async getFirstAdminUserId() {
        const user = await this.prisma.user.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });
        return user?.id ?? null;
    }
    async getAdminIdentity(userId) {
        if (!userId)
            return null;
        const { secrets } = await this.settingsService
            .getInternalSettings(userId)
            .catch(() => ({ secrets: {} }));
        const tokenRaw = secrets['plex'];
        const token = typeof tokenRaw === 'object' && tokenRaw
            ? normalizeTitle(tokenRaw['token'])
            : normalizeTitle(secrets['plex.token']);
        if (!token)
            return null;
        try {
            const who = await this.plexService.whoami(token);
            return {
                plexAccountId: coerceAccountId(who.id),
                plexAccountTitle: normalizeTitle(who.title) ?? normalizeTitle(who.username),
            };
        }
        catch (err) {
            this.logger.warn(`Plex whoami failed while ensuring admin user: ${err?.message ?? String(err)}`);
            return null;
        }
    }
    async mergePlexUserData(params) {
        const { fromId, toId } = params;
        if (fromId === toId)
            return;
        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `
        DELETE FROM "ImmaculateTasteMovieLibrary"
        WHERE "plexUserId" = ${fromId}
          AND EXISTS (
            SELECT 1
            FROM "ImmaculateTasteMovieLibrary" AS target
            WHERE target."plexUserId" = ${toId}
              AND target."librarySectionKey" = "ImmaculateTasteMovieLibrary"."librarySectionKey"
              AND target."tmdbId" = "ImmaculateTasteMovieLibrary"."tmdbId"
          )
      `;
            await tx.$executeRaw `
        DELETE FROM "ImmaculateTasteShowLibrary"
        WHERE "plexUserId" = ${fromId}
          AND EXISTS (
            SELECT 1
            FROM "ImmaculateTasteShowLibrary" AS target
            WHERE target."plexUserId" = ${toId}
              AND target."librarySectionKey" = "ImmaculateTasteShowLibrary"."librarySectionKey"
              AND target."tvdbId" = "ImmaculateTasteShowLibrary"."tvdbId"
          )
      `;
            await tx.$executeRaw `
        DELETE FROM "WatchedMovieRecommendationLibrary"
        WHERE "plexUserId" = ${fromId}
          AND EXISTS (
            SELECT 1
            FROM "WatchedMovieRecommendationLibrary" AS target
            WHERE target."plexUserId" = ${toId}
              AND target."collectionName" = "WatchedMovieRecommendationLibrary"."collectionName"
              AND target."librarySectionKey" = "WatchedMovieRecommendationLibrary"."librarySectionKey"
              AND target."tmdbId" = "WatchedMovieRecommendationLibrary"."tmdbId"
          )
      `;
            await tx.$executeRaw `
        DELETE FROM "WatchedShowRecommendationLibrary"
        WHERE "plexUserId" = ${fromId}
          AND EXISTS (
            SELECT 1
            FROM "WatchedShowRecommendationLibrary" AS target
            WHERE target."plexUserId" = ${toId}
              AND target."collectionName" = "WatchedShowRecommendationLibrary"."collectionName"
              AND target."librarySectionKey" = "WatchedShowRecommendationLibrary"."librarySectionKey"
              AND target."tvdbId" = "WatchedShowRecommendationLibrary"."tvdbId"
          )
      `;
            await tx.immaculateTasteMovieLibrary.updateMany({
                where: { plexUserId: fromId },
                data: { plexUserId: toId },
            });
            await tx.immaculateTasteShowLibrary.updateMany({
                where: { plexUserId: fromId },
                data: { plexUserId: toId },
            });
            await tx.watchedMovieRecommendationLibrary.updateMany({
                where: { plexUserId: fromId },
                data: { plexUserId: toId },
            });
            await tx.watchedShowRecommendationLibrary.updateMany({
                where: { plexUserId: fromId },
                data: { plexUserId: toId },
            });
            await tx.plexUser.delete({ where: { id: fromId } });
        });
    }
};
exports.PlexUsersService = PlexUsersService;
exports.PlexUsersService = PlexUsersService = PlexUsersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        plex_service_1.PlexService])
], PlexUsersService);
//# sourceMappingURL=plex-users.service.js.map