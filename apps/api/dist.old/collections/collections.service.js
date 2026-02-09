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
exports.CollectionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../db/prisma.service");
const plex_server_service_1 = require("../plex/plex-server.service");
const settings_service_1 = require("../settings/settings.service");
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeHttpUrl(raw) {
    const trimmed = raw.trim();
    const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const parsed = new URL(baseUrl);
        if (!/^https?:$/i.test(parsed.protocol))
            throw new Error('Unsupported protocol');
    }
    catch {
        throw new common_1.BadRequestException('baseUrl must be a valid http(s) URL');
    }
    return baseUrl;
}
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
    return asString(pick(obj, path));
}
let CollectionsService = class CollectionsService {
    prisma;
    settings;
    plexServer;
    constructor(prisma, settings, plexServer) {
        this.prisma = prisma;
        this.settings = settings;
        this.plexServer = plexServer;
    }
    async listCollections() {
        const rows = await this.prisma.curatedCollection.findMany({
            orderBy: { name: 'asc' },
            include: {
                _count: { select: { items: true } },
            },
        });
        return rows.map((c) => ({
            id: c.id,
            name: c.name,
            itemCount: c._count.items,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
        }));
    }
    async createCollection(name) {
        const trimmed = name.trim();
        if (!trimmed)
            throw new common_1.BadRequestException('name is required');
        if (trimmed.length > 200)
            throw new common_1.BadRequestException('name is too long');
        try {
            const c = await this.prisma.curatedCollection.create({
                data: { name: trimmed },
                select: { id: true, name: true, createdAt: true, updatedAt: true },
            });
            return {
                id: c.id,
                name: c.name,
                itemCount: 0,
                createdAt: c.createdAt.toISOString(),
                updatedAt: c.updatedAt.toISOString(),
            };
        }
        catch (err) {
            const code = err
                ?.code;
            if (code === 'P2002')
                throw new common_1.BadRequestException('A collection with this name already exists');
            throw err;
        }
    }
    async seedDefaults() {
        const defaults = [
            'Based on your recently watched movie',
            'Change of Taste',
        ];
        for (const name of defaults) {
            await this.prisma.curatedCollection.upsert({
                where: { name },
                update: {},
                create: { name },
            });
        }
        return await this.listCollections();
    }
    async deleteCollection(collectionId) {
        await this.prisma.curatedCollection.delete({ where: { id: collectionId } });
    }
    async listItems(collectionId) {
        await this.prisma.curatedCollection
            .findUnique({ where: { id: collectionId } })
            .then((c) => {
            if (!c)
                throw new common_1.BadRequestException('collection not found');
        });
        const items = await this.prisma.curatedCollectionItem.findMany({
            where: { collectionId },
            orderBy: { id: 'asc' },
        });
        return items.map((i) => ({
            id: i.id,
            ratingKey: i.ratingKey,
            title: i.title,
        }));
    }
    async addItem(params) {
        const { userId, collectionId } = params;
        const ratingKeyInput = asString(params.ratingKey);
        const titleInput = asString(params.title);
        await this.prisma.curatedCollection
            .findUnique({ where: { id: collectionId } })
            .then((c) => {
            if (!c)
                throw new common_1.BadRequestException('collection not found');
        });
        let ratingKey = ratingKeyInput;
        let title = titleInput;
        if (!ratingKey && title) {
            const resolved = await this.resolveMovieTitle(userId, title);
            ratingKey = resolved.ratingKey;
            title = resolved.title;
        }
        if (!ratingKey)
            throw new common_1.BadRequestException('ratingKey or title is required');
        if (!title)
            title = ratingKey;
        const item = await this.prisma.curatedCollectionItem.upsert({
            where: {
                collectionId_ratingKey: {
                    collectionId,
                    ratingKey,
                },
            },
            update: { title },
            create: { collectionId, ratingKey, title },
        });
        return { id: item.id, ratingKey: item.ratingKey, title: item.title };
    }
    async deleteItem(params) {
        const { collectionId, itemId } = params;
        const result = await this.prisma.curatedCollectionItem.deleteMany({
            where: { id: itemId, collectionId },
        });
        if (result.count === 0)
            throw new common_1.BadRequestException('item not found');
    }
    async importFromJson(params) {
        const { userId, collectionId, json } = params;
        const raw = json.trim();
        if (!raw)
            throw new common_1.BadRequestException('json is required');
        await this.prisma.curatedCollection
            .findUnique({ where: { id: collectionId } })
            .then((c) => {
            if (!c)
                throw new common_1.BadRequestException('collection not found');
        });
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (err) {
            throw new common_1.BadRequestException(`Invalid JSON: ${err?.message ?? String(err)}`);
        }
        if (!Array.isArray(parsed)) {
            throw new common_1.BadRequestException('Expected JSON array (strings or objects).');
        }
        const entries = parsed;
        const resolved = [];
        let skipped = 0;
        for (const entry of entries) {
            if (typeof entry === 'string') {
                const title = entry.trim();
                if (!title)
                    continue;
                const found = await this.resolveMovieTitle(userId, title).catch(() => null);
                if (found)
                    resolved.push(found);
                else
                    skipped += 1;
                continue;
            }
            if (entry && typeof entry === 'object') {
                const obj = entry;
                const titleRaw = obj['title'];
                const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
                const ratingKeyRaw = obj['rating_key'] ?? obj['ratingKey'] ?? obj['rating_key'];
                const ratingKey = typeof ratingKeyRaw === 'string'
                    ? ratingKeyRaw.trim()
                    : typeof ratingKeyRaw === 'number'
                        ? String(ratingKeyRaw)
                        : '';
                if (ratingKey) {
                    resolved.push({ ratingKey, title: title || ratingKey });
                    continue;
                }
                if (title) {
                    const found = await this.resolveMovieTitle(userId, title).catch(() => null);
                    if (found)
                        resolved.push(found);
                    else
                        skipped += 1;
                }
            }
        }
        if (!resolved.length) {
            return { imported: 0, skipped };
        }
        const unique = new Map();
        for (const item of resolved) {
            if (!unique.has(item.ratingKey))
                unique.set(item.ratingKey, item.title);
        }
        const ratingKeys = Array.from(unique.keys());
        const existing = await this.prisma.curatedCollectionItem.findMany({
            where: {
                collectionId,
                ratingKey: { in: ratingKeys },
            },
            select: { ratingKey: true },
        });
        const existingSet = new Set(existing.map((e) => e.ratingKey));
        const imported = ratingKeys.filter((rk) => !existingSet.has(rk)).length;
        for (const [ratingKey, title] of unique.entries()) {
            await this.prisma.curatedCollectionItem.upsert({
                where: {
                    collectionId_ratingKey: {
                        collectionId,
                        ratingKey,
                    },
                },
                update: { title },
                create: { collectionId, ratingKey, title },
            });
        }
        return { imported, skipped };
    }
    async exportToJson(collectionId) {
        await this.prisma.curatedCollection
            .findUnique({ where: { id: collectionId } })
            .then((c) => {
            if (!c)
                throw new common_1.BadRequestException('collection not found');
        });
        const items = await this.prisma.curatedCollectionItem.findMany({
            where: { collectionId },
            orderBy: { id: 'asc' },
            select: { ratingKey: true, title: true },
        });
        return items.map((i) => ({ ratingKey: i.ratingKey, title: i.title }));
    }
    async resolveMovieTitle(userId, title) {
        const { settings, secrets } = await this.settings.getInternalSettings(userId);
        const baseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const token = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!baseUrlRaw)
            throw new common_1.BadRequestException('Plex baseUrl is not set');
        if (!token)
            throw new common_1.BadRequestException('Plex token is not set');
        const baseUrl = normalizeHttpUrl(baseUrlRaw);
        const sections = await this.plexServer.getSections({ baseUrl, token });
        const movieSections = sections
            .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
            .sort((a, b) => {
            const aIsMovies = a.title.toLowerCase() === 'movies';
            const bIsMovies = b.title.toLowerCase() === 'movies';
            if (aIsMovies && !bIsMovies)
                return -1;
            if (!aIsMovies && bIsMovies)
                return 1;
            return a.title.localeCompare(b.title);
        });
        if (!movieSections.length) {
            throw new common_1.BadRequestException('No Plex movie libraries found');
        }
        for (const sec of movieSections) {
            const found = await this.plexServer.findMovieRatingKeyByTitle({
                baseUrl,
                token,
                librarySectionKey: sec.key,
                title,
            });
            if (found)
                return found;
        }
        throw new common_1.BadRequestException(`Movie not found in any Plex movie library: ${title}`);
    }
};
exports.CollectionsService = CollectionsService;
exports.CollectionsService = CollectionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService])
], CollectionsService);
//# sourceMappingURL=collections.service.js.map