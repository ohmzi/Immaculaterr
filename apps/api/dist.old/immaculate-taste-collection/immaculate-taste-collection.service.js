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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var ImmaculateTasteCollectionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImmaculateTasteCollectionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../db/prisma.service");
const tmdb_service_1 = require("../tmdb/tmdb.service");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const immaculate_taste_reset_1 = require("./immaculate-taste-reset");
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function asInt(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const n = Number.parseInt(value.trim(), 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function resolveLegacyPointsPath(fileName) {
    const appDataDir = process.env['APP_DATA_DIR'];
    if (appDataDir) {
        const candidate = node_path_1.default.resolve(appDataDir, fileName);
        if ((0, node_fs_1.existsSync)(candidate))
            return candidate;
    }
    const cwd = process.cwd();
    const candidates = [
        node_path_1.default.resolve(cwd, 'data', fileName),
        node_path_1.default.resolve(cwd, '..', 'data', fileName),
        node_path_1.default.resolve(cwd, '..', '..', 'data', fileName),
        node_path_1.default.resolve(cwd, '..', '..', '..', 'data', fileName),
        node_path_1.default.resolve(cwd, '..', '..', '..', '..', 'data', fileName),
    ];
    for (const c of candidates) {
        if ((0, node_fs_1.existsSync)(c))
            return c;
    }
    return null;
}
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
let ImmaculateTasteCollectionService = class ImmaculateTasteCollectionService {
    static { ImmaculateTasteCollectionService_1 = this; }
    prisma;
    tmdb;
    static DEFAULT_MAX_POINTS = 50;
    static LEGACY_POINTS_FILE = 'recommendation_points.json';
    constructor(prisma, tmdb) {
        this.prisma = prisma;
        this.tmdb = tmdb;
    }
    async ensureLegacyImported(params) {
        const { ctx } = params;
        const plexUserId = params.plexUserId.trim();
        if (!plexUserId) {
            throw new Error('plexUserId is required');
        }
        const librarySectionKey = params.librarySectionKey.trim();
        if (!librarySectionKey) {
            throw new Error('librarySectionKey is required');
        }
        const maxPoints = clampMaxPoints(params.maxPoints);
        const resetMarkerKey = (0, immaculate_taste_reset_1.immaculateTasteResetMarkerKey)({
            mediaType: 'movie',
            librarySectionKey,
        });
        const resetMarker = await this.prisma.setting
            .findUnique({ where: { key: resetMarkerKey } })
            .catch(() => null);
        if (resetMarker) {
            await ctx.info('immaculateTaste: legacy import blocked (library was reset)', { librarySectionKey, resetMarkerKey });
            return { imported: false, sourcePath: null, importedCount: 0 };
        }
        const existingCount = await this.prisma.immaculateTasteMovieLibrary.count({
            where: { plexUserId, librarySectionKey },
        });
        if (existingCount > 0) {
            await ctx.debug('immaculateTaste: legacy import not needed (library dataset already has rows)', {
                librarySectionKey,
                existingCount,
            });
            return { imported: false, sourcePath: null, importedCount: 0 };
        }
        const sourcePath = resolveLegacyPointsPath(ImmaculateTasteCollectionService_1.LEGACY_POINTS_FILE);
        if (!sourcePath) {
            await ctx.info('immaculateTaste: no legacy points file found (starting fresh)', {
                expectedFile: ImmaculateTasteCollectionService_1.LEGACY_POINTS_FILE,
            });
            return { imported: false, sourcePath: null, importedCount: 0 };
        }
        await ctx.info('immaculateTaste: importing legacy points file', {
            sourcePath,
            maxPoints,
        });
        const raw = await (0, promises_1.readFile)(sourcePath, 'utf-8');
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (err) {
            await ctx.warn('immaculateTaste: legacy points JSON is invalid (skipping import)', {
                sourcePath,
                error: err?.message ?? String(err),
            });
            return { imported: false, sourcePath, importedCount: 0 };
        }
        if (!isPlainObject(parsed)) {
            await ctx.warn('immaculateTaste: legacy points JSON has unexpected shape (skipping import)', {
                sourcePath,
                type: Array.isArray(parsed) ? 'array' : typeof parsed,
            });
            return { imported: false, sourcePath, importedCount: 0 };
        }
        const byTmdbId = new Map();
        for (const [k, v] of Object.entries(parsed)) {
            const legacyKey = String(k).trim();
            if (!legacyKey)
                continue;
            let points = null;
            let title = null;
            let tmdbId = null;
            if (typeof v === 'number' || typeof v === 'string') {
                points = asInt(v);
            }
            else if (isPlainObject(v)) {
                points = asInt(v.points ?? v.score ?? v.value ?? null);
                const titleRaw = v.title;
                title = typeof titleRaw === 'string' ? titleRaw.trim() : null;
                tmdbId = asInt(v.tmdb_id ?? v.tmdbId ?? null);
            }
            if (!tmdbId || tmdbId <= 0)
                continue;
            if (!points || points <= 0)
                continue;
            if (points > maxPoints)
                points = maxPoints;
            const existing = byTmdbId.get(tmdbId);
            const existingPoints = existing &&
                typeof existing.points === 'number' &&
                Number.isFinite(existing.points)
                ? Math.trunc(existing.points)
                : 0;
            if (!existing || points > existingPoints) {
                byTmdbId.set(tmdbId, {
                    plexUserId,
                    librarySectionKey,
                    tmdbId,
                    title: title || undefined,
                    status: 'active',
                    points,
                });
            }
        }
        const rows = Array.from(byTmdbId.values());
        if (!rows.length) {
            await ctx.warn('immaculateTaste: legacy points file had no importable rows', {
                sourcePath,
            });
            return { imported: false, sourcePath, importedCount: 0 };
        }
        const batches = chunk(rows, 200);
        for (const batch of batches) {
            await this.prisma.immaculateTasteMovieLibrary.createMany({ data: batch });
        }
        await ctx.info('immaculateTaste: legacy import complete', {
            sourcePath,
            importedCount: rows.length,
        });
        return { imported: true, sourcePath, importedCount: rows.length };
    }
    async applyPointsUpdate(params) {
        const { ctx } = params;
        const plexUserId = params.plexUserId.trim();
        if (!plexUserId)
            throw new Error('plexUserId is required');
        const librarySectionKey = params.librarySectionKey.trim();
        if (!librarySectionKey)
            throw new Error('librarySectionKey is required');
        const maxPoints = clampMaxPoints(params.maxPoints);
        const suggestedByTmdbId = new Map();
        for (const s of params.suggested ?? []) {
            const tmdbId = typeof s?.tmdbId === 'number' && Number.isFinite(s.tmdbId)
                ? Math.trunc(s.tmdbId)
                : null;
            if (!tmdbId || tmdbId <= 0)
                continue;
            const title = typeof s?.title === 'string' ? s.title.trim() : '';
            const tmdbVoteAvg = typeof s?.tmdbVoteAvg === 'number' && Number.isFinite(s.tmdbVoteAvg)
                ? Number(s.tmdbVoteAvg)
                : null;
            const tmdbVoteCount = typeof s?.tmdbVoteCount === 'number' && Number.isFinite(s.tmdbVoteCount)
                ? Math.max(0, Math.trunc(s.tmdbVoteCount))
                : null;
            const inPlex = Boolean(s?.inPlex);
            const existing = suggestedByTmdbId.get(tmdbId);
            if (!existing) {
                suggestedByTmdbId.set(tmdbId, {
                    tmdbId,
                    title,
                    tmdbVoteAvg,
                    tmdbVoteCount,
                    inPlex,
                });
                continue;
            }
            suggestedByTmdbId.set(tmdbId, {
                tmdbId,
                title: existing.title || title,
                tmdbVoteAvg: existing.tmdbVoteAvg ?? tmdbVoteAvg,
                tmdbVoteCount: existing.tmdbVoteCount ?? tmdbVoteCount,
                inPlex: existing.inPlex || inPlex,
            });
        }
        const suggestedTmdbIds = Array.from(suggestedByTmdbId.keys());
        await ctx.info('immaculateTaste: points update start', {
            librarySectionKey,
            maxPoints,
            suggestedNow: suggestedTmdbIds.length,
            sampleSuggested: suggestedTmdbIds.slice(0, 10),
        });
        const [totalBefore, totalActiveBefore, totalPendingBefore] = await Promise.all([
            this.prisma.immaculateTasteMovieLibrary.count({
                where: { plexUserId, librarySectionKey },
            }),
            this.prisma.immaculateTasteMovieLibrary.count({
                where: { plexUserId, librarySectionKey, status: 'active' },
            }),
            this.prisma.immaculateTasteMovieLibrary.count({
                where: { plexUserId, librarySectionKey, status: 'pending' },
            }),
        ]);
        const existing = suggestedTmdbIds.length
            ? await this.prisma.immaculateTasteMovieLibrary.findMany({
                where: {
                    plexUserId,
                    librarySectionKey,
                    tmdbId: { in: suggestedTmdbIds },
                },
                select: { tmdbId: true, status: true },
            })
            : [];
        const existingStatus = new Map(existing.map((e) => [e.tmdbId, e.status]));
        let createdActive = 0;
        let createdPending = 0;
        let refreshedActive = 0;
        let activatedFromPending = 0;
        let updatedPending = 0;
        for (const s of suggestedByTmdbId.values()) {
            const prev = existingStatus.get(s.tmdbId) ?? null;
            const title = s.title || null;
            const tmdbVoteAvg = s.tmdbVoteAvg;
            const tmdbVoteCount = s.tmdbVoteCount;
            if (!prev) {
                const status = s.inPlex ? 'active' : 'pending';
                await this.prisma.immaculateTasteMovieLibrary.create({
                    data: {
                        plexUserId,
                        librarySectionKey,
                        tmdbId: s.tmdbId,
                        title,
                        status,
                        points: status === 'active' ? maxPoints : 0,
                        tmdbVoteAvg,
                        tmdbVoteCount,
                    },
                });
                if (status === 'active')
                    createdActive += 1;
                else
                    createdPending += 1;
                continue;
            }
            if (prev === 'active') {
                await this.prisma.immaculateTasteMovieLibrary.update({
                    where: {
                        plexUserId_librarySectionKey_tmdbId: {
                            plexUserId,
                            librarySectionKey,
                            tmdbId: s.tmdbId,
                        },
                    },
                    data: {
                        points: maxPoints,
                        ...(title ? { title } : {}),
                        ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
                        ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
                    },
                });
                refreshedActive += 1;
                continue;
            }
            if (s.inPlex) {
                await this.prisma.immaculateTasteMovieLibrary.update({
                    where: {
                        plexUserId_librarySectionKey_tmdbId: {
                            plexUserId,
                            librarySectionKey,
                            tmdbId: s.tmdbId,
                        },
                    },
                    data: {
                        status: 'active',
                        points: maxPoints,
                        ...(title ? { title } : {}),
                        ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
                        ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
                    },
                });
                activatedFromPending += 1;
            }
            else {
                await this.prisma.immaculateTasteMovieLibrary.update({
                    where: {
                        plexUserId_librarySectionKey_tmdbId: {
                            plexUserId,
                            librarySectionKey,
                            tmdbId: s.tmdbId,
                        },
                    },
                    data: {
                        ...(title ? { title } : {}),
                        ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
                        ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
                    },
                });
                updatedPending += 1;
            }
        }
        const decayed = await this.prisma.immaculateTasteMovieLibrary.updateMany({
            where: {
                plexUserId,
                librarySectionKey,
                status: 'active',
                points: { gt: 0 },
                ...(suggestedTmdbIds.length
                    ? { tmdbId: { notIn: suggestedTmdbIds } }
                    : {}),
            },
            data: { points: { decrement: 1 } },
        });
        const removed = await this.prisma.immaculateTasteMovieLibrary.deleteMany({
            where: { plexUserId, librarySectionKey, status: 'active', points: { lte: 0 } },
        });
        const [totalAfter, totalActiveAfter, totalPendingAfter] = await Promise.all([
            this.prisma.immaculateTasteMovieLibrary.count({
                where: { plexUserId, librarySectionKey },
            }),
            this.prisma.immaculateTasteMovieLibrary.count({
                where: { plexUserId, librarySectionKey, status: 'active' },
            }),
            this.prisma.immaculateTasteMovieLibrary.count({
                where: { plexUserId, librarySectionKey, status: 'pending' },
            }),
        ]);
        const summary = {
            librarySectionKey,
            maxPoints,
            suggestedNow: suggestedTmdbIds.length,
            totalBefore,
            totalActiveBefore,
            totalPendingBefore,
            createdActive,
            createdPending,
            refreshedActive,
            activatedFromPending,
            updatedPending,
            decayed: decayed.count,
            removed: removed.count,
            totalAfter,
            totalActiveAfter,
            totalPendingAfter,
        };
        await ctx.info('immaculateTaste: points update done', summary);
        return summary;
    }
    async activatePendingNowInPlex(params) {
        const { ctx } = params;
        const plexUserId = params.plexUserId.trim();
        if (!plexUserId)
            throw new Error('plexUserId is required');
        const librarySectionKey = params.librarySectionKey.trim();
        if (!librarySectionKey)
            throw new Error('librarySectionKey is required');
        const tmdbApiKey = (params.tmdbApiKey ?? '').trim();
        const tmdbIds = Array.from(new Set((params.tmdbIds ?? [])
            .map((id) => typeof id === 'number' && Number.isFinite(id)
            ? Math.trunc(id)
            : NaN)
            .filter((n) => Number.isFinite(n) && n > 0)));
        const pointsOnActivation = clampMaxPoints(params.pointsOnActivation ??
            ImmaculateTasteCollectionService_1.DEFAULT_MAX_POINTS);
        if (!tmdbIds.length)
            return { activated: 0, tmdbRatingsUpdated: 0 };
        const pendingRows = await this.prisma.immaculateTasteMovieLibrary.findMany({
            where: {
                plexUserId,
                librarySectionKey,
                status: 'pending',
                tmdbId: { in: tmdbIds },
            },
            select: { tmdbId: true },
        });
        const pendingIds = pendingRows.map((r) => r.tmdbId);
        if (!pendingIds.length)
            return { activated: 0, tmdbRatingsUpdated: 0 };
        const res = await this.prisma.immaculateTasteMovieLibrary.updateMany({
            where: {
                plexUserId,
                librarySectionKey,
                status: 'pending',
                tmdbId: { in: pendingIds },
            },
            data: { status: 'active', points: pointsOnActivation },
        });
        if (res.count) {
            await ctx.info('immaculateTaste: activated pending titles now in Plex', {
                activated: res.count,
                pointsOnActivation,
            });
        }
        let tmdbRatingsUpdated = 0;
        if (res.count && tmdbApiKey) {
            const batches = chunk(pendingIds, 6);
            for (const batch of batches) {
                await Promise.all(batch.map(async (tmdbId) => {
                    const stats = await this.tmdb
                        .getMovieVoteStats({ apiKey: tmdbApiKey, tmdbId })
                        .catch(() => null);
                    const voteAvg = stats?.vote_average ?? null;
                    const voteCount = stats?.vote_count ?? null;
                    if (voteAvg === null && voteCount === null)
                        return;
                    await this.prisma.immaculateTasteMovieLibrary.update({
                        where: {
                            plexUserId_librarySectionKey_tmdbId: {
                                plexUserId,
                                librarySectionKey,
                                tmdbId,
                            },
                        },
                        data: {
                            tmdbVoteAvg: voteAvg,
                            tmdbVoteCount: voteCount,
                        },
                    });
                    tmdbRatingsUpdated += 1;
                }));
            }
            if (tmdbRatingsUpdated) {
                await ctx.info('immaculateTaste: refreshed TMDB ratings on activation', {
                    updated: tmdbRatingsUpdated,
                    activated: res.count,
                });
            }
        }
        else if (res.count && !tmdbApiKey) {
            await ctx.warn('immaculateTaste: TMDB apiKey missing; skipping rating refresh on activation', {
                activated: res.count,
            });
        }
        return { activated: res.count, tmdbRatingsUpdated };
    }
    async getActiveMovies(params) {
        const librarySectionKey = params.librarySectionKey.trim();
        if (!librarySectionKey)
            throw new Error('librarySectionKey is required');
        const plexUserId = params.plexUserId.trim();
        if (!plexUserId)
            throw new Error('plexUserId is required');
        const minPoints = Math.max(1, Math.trunc(params.minPoints ?? 1));
        const take = params.take ? Math.max(1, Math.trunc(params.take)) : undefined;
        return await this.prisma.immaculateTasteMovieLibrary.findMany({
            where: {
                plexUserId,
                librarySectionKey,
                status: 'active',
                points: { gte: minPoints },
            },
            orderBy: [{ points: 'desc' }, { updatedAt: 'desc' }],
            ...(take ? { take } : {}),
        });
    }
    buildThreeTierTmdbRatingShuffleOrder(params) {
        const uniq = new Map();
        for (const m of params.movies ?? []) {
            const tmdbId = Number.isFinite(m.tmdbId) ? Math.trunc(m.tmdbId) : NaN;
            if (!Number.isFinite(tmdbId) || tmdbId <= 0)
                continue;
            if (!uniq.has(tmdbId))
                uniq.set(tmdbId, {
                    tmdbId,
                    tmdbVoteAvg: m.tmdbVoteAvg ?? null,
                    tmdbVoteCount: m.tmdbVoteCount ?? null,
                });
        }
        const sorted = Array.from(uniq.values()).sort((a, b) => {
            const ar = Number.isFinite(a.tmdbVoteAvg ?? NaN)
                ? Number(a.tmdbVoteAvg)
                : 0;
            const br = Number.isFinite(b.tmdbVoteAvg ?? NaN)
                ? Number(b.tmdbVoteAvg)
                : 0;
            if (br !== ar)
                return br - ar;
            const ac = Number.isFinite(a.tmdbVoteCount ?? NaN)
                ? Number(a.tmdbVoteCount)
                : 0;
            const bc = Number.isFinite(b.tmdbVoteCount ?? NaN)
                ? Number(b.tmdbVoteCount)
                : 0;
            if (bc !== ac)
                return bc - ac;
            return a.tmdbId - b.tmdbId;
        });
        const n = sorted.length;
        if (!n)
            return [];
        const base = Math.floor(n / 3);
        const rem = n % 3;
        const highSize = base + (rem > 0 ? 1 : 0);
        const midSize = base + (rem > 1 ? 1 : 0);
        const high = sorted.slice(0, highSize);
        const mid = sorted.slice(highSize, highSize + midSize);
        const low = sorted.slice(highSize + midSize);
        const pickOne = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
        const picks = [];
        const used = new Set();
        const pickTier = (tier) => {
            const pool = tier.filter((m) => !used.has(m.tmdbId));
            const p = pickOne(pool);
            if (!p)
                return;
            used.add(p.tmdbId);
            picks.push(p.tmdbId);
        };
        pickTier(high);
        pickTier(mid);
        pickTier(low);
        shuffleInPlace(picks);
        const remaining = sorted
            .filter((m) => !used.has(m.tmdbId))
            .map((m) => m.tmdbId);
        shuffleInPlace(remaining);
        return [...picks, ...remaining];
    }
};
exports.ImmaculateTasteCollectionService = ImmaculateTasteCollectionService;
exports.ImmaculateTasteCollectionService = ImmaculateTasteCollectionService = ImmaculateTasteCollectionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        tmdb_service_1.TmdbService])
], ImmaculateTasteCollectionService);
function clampMaxPoints(v) {
    const n = typeof v === 'number' && Number.isFinite(v)
        ? Math.trunc(v)
        : typeof v === 'string' && v.trim()
            ? Number.parseInt(v.trim(), 10)
            : ImmaculateTasteCollectionService.DEFAULT_MAX_POINTS;
    if (!Number.isFinite(n))
        return ImmaculateTasteCollectionService.DEFAULT_MAX_POINTS;
    return Math.max(1, Math.min(100, n));
}
function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}
//# sourceMappingURL=immaculate-taste-collection.service.js.map