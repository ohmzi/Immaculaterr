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
var ImmaculateTasteShowCollectionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImmaculateTasteShowCollectionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../db/prisma.service");
const tmdb_service_1 = require("../tmdb/tmdb.service");
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
let ImmaculateTasteShowCollectionService = class ImmaculateTasteShowCollectionService {
    static { ImmaculateTasteShowCollectionService_1 = this; }
    prisma;
    tmdb;
    static DEFAULT_MAX_POINTS = 50;
    constructor(prisma, tmdb) {
        this.prisma = prisma;
        this.tmdb = tmdb;
    }
    async ensureLegacyImported(_params) {
        return { imported: false, sourcePath: null, importedCount: 0 };
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
        const suggestedByTvdbId = new Map();
        for (const s of params.suggested ?? []) {
            const tvdbId = typeof s?.tvdbId === 'number' && Number.isFinite(s.tvdbId)
                ? Math.trunc(s.tvdbId)
                : null;
            if (!tvdbId || tvdbId <= 0)
                continue;
            const tmdbId = typeof s?.tmdbId === 'number' && Number.isFinite(s.tmdbId)
                ? Math.trunc(s.tmdbId)
                : null;
            const title = typeof s?.title === 'string' ? s.title.trim() : '';
            const tmdbVoteAvg = typeof s?.tmdbVoteAvg === 'number' && Number.isFinite(s.tmdbVoteAvg)
                ? Number(s.tmdbVoteAvg)
                : null;
            const tmdbVoteCount = typeof s?.tmdbVoteCount === 'number' && Number.isFinite(s.tmdbVoteCount)
                ? Math.max(0, Math.trunc(s.tmdbVoteCount))
                : null;
            const inPlex = Boolean(s?.inPlex);
            const existing = suggestedByTvdbId.get(tvdbId);
            if (!existing) {
                suggestedByTvdbId.set(tvdbId, {
                    tvdbId,
                    tmdbId,
                    title,
                    tmdbVoteAvg,
                    tmdbVoteCount,
                    inPlex,
                });
                continue;
            }
            suggestedByTvdbId.set(tvdbId, {
                tvdbId,
                tmdbId: existing.tmdbId ?? tmdbId,
                title: existing.title || title,
                tmdbVoteAvg: existing.tmdbVoteAvg ?? tmdbVoteAvg,
                tmdbVoteCount: existing.tmdbVoteCount ?? tmdbVoteCount,
                inPlex: existing.inPlex || inPlex,
            });
        }
        const suggestedTvdbIds = Array.from(suggestedByTvdbId.keys());
        await ctx.info('immaculateTaste(tv): points update start', {
            librarySectionKey,
            maxPoints,
            suggestedNow: suggestedTvdbIds.length,
            sampleSuggested: suggestedTvdbIds.slice(0, 10),
        });
        const [totalBefore, totalActiveBefore, totalPendingBefore] = await Promise.all([
            this.prisma.immaculateTasteShowLibrary.count({
                where: { plexUserId, librarySectionKey },
            }),
            this.prisma.immaculateTasteShowLibrary.count({
                where: { plexUserId, librarySectionKey, status: 'active' },
            }),
            this.prisma.immaculateTasteShowLibrary.count({
                where: { plexUserId, librarySectionKey, status: 'pending' },
            }),
        ]);
        const existing = suggestedTvdbIds.length
            ? await this.prisma.immaculateTasteShowLibrary.findMany({
                where: { plexUserId, librarySectionKey, tvdbId: { in: suggestedTvdbIds } },
                select: { tvdbId: true, status: true },
            })
            : [];
        const existingStatus = new Map(existing.map((e) => [e.tvdbId, e.status]));
        let createdActive = 0;
        let createdPending = 0;
        let refreshedActive = 0;
        let activatedFromPending = 0;
        let updatedPending = 0;
        for (const s of suggestedByTvdbId.values()) {
            const prev = existingStatus.get(s.tvdbId) ?? null;
            const title = s.title || null;
            const tmdbId = s.tmdbId;
            const tmdbVoteAvg = s.tmdbVoteAvg;
            const tmdbVoteCount = s.tmdbVoteCount;
            if (!prev) {
                const status = s.inPlex ? 'active' : 'pending';
                await this.prisma.immaculateTasteShowLibrary.create({
                    data: {
                        plexUserId,
                        librarySectionKey,
                        tvdbId: s.tvdbId,
                        tmdbId: tmdbId ?? undefined,
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
                await this.prisma.immaculateTasteShowLibrary.update({
                    where: {
                        plexUserId_librarySectionKey_tvdbId: {
                            plexUserId,
                            librarySectionKey,
                            tvdbId: s.tvdbId,
                        },
                    },
                    data: {
                        points: maxPoints,
                        ...(title ? { title } : {}),
                        ...(tmdbId !== null ? { tmdbId } : {}),
                        ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
                        ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
                    },
                });
                refreshedActive += 1;
                continue;
            }
            if (s.inPlex) {
                await this.prisma.immaculateTasteShowLibrary.update({
                    where: {
                        plexUserId_librarySectionKey_tvdbId: {
                            plexUserId,
                            librarySectionKey,
                            tvdbId: s.tvdbId,
                        },
                    },
                    data: {
                        status: 'active',
                        points: maxPoints,
                        ...(title ? { title } : {}),
                        ...(tmdbId !== null ? { tmdbId } : {}),
                        ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
                        ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
                    },
                });
                activatedFromPending += 1;
            }
            else {
                await this.prisma.immaculateTasteShowLibrary.update({
                    where: {
                        plexUserId_librarySectionKey_tvdbId: {
                            plexUserId,
                            librarySectionKey,
                            tvdbId: s.tvdbId,
                        },
                    },
                    data: {
                        ...(title ? { title } : {}),
                        ...(tmdbId !== null ? { tmdbId } : {}),
                        ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
                        ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
                    },
                });
                updatedPending += 1;
            }
        }
        const decayed = await this.prisma.immaculateTasteShowLibrary.updateMany({
            where: {
                plexUserId,
                librarySectionKey,
                status: 'active',
                points: { gt: 0 },
                ...(suggestedTvdbIds.length ? { tvdbId: { notIn: suggestedTvdbIds } } : {}),
            },
            data: { points: { decrement: 1 } },
        });
        const removed = await this.prisma.immaculateTasteShowLibrary.deleteMany({
            where: { plexUserId, librarySectionKey, status: 'active', points: { lte: 0 } },
        });
        const [totalAfter, totalActiveAfter, totalPendingAfter] = await Promise.all([
            this.prisma.immaculateTasteShowLibrary.count({
                where: { plexUserId, librarySectionKey },
            }),
            this.prisma.immaculateTasteShowLibrary.count({
                where: { plexUserId, librarySectionKey, status: 'active' },
            }),
            this.prisma.immaculateTasteShowLibrary.count({
                where: { plexUserId, librarySectionKey, status: 'pending' },
            }),
        ]);
        const summary = {
            librarySectionKey,
            maxPoints,
            suggestedNow: suggestedTvdbIds.length,
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
        await ctx.info('immaculateTaste(tv): points update done', summary);
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
        const tvdbIds = Array.from(new Set((params.tvdbIds ?? [])
            .map((id) => typeof id === 'number' && Number.isFinite(id) ? Math.trunc(id) : NaN)
            .filter((n) => Number.isFinite(n) && n > 0)));
        const pointsOnActivation = clampMaxPoints(params.pointsOnActivation ?? ImmaculateTasteShowCollectionService_1.DEFAULT_MAX_POINTS);
        if (!tvdbIds.length)
            return { activated: 0, tmdbRatingsUpdated: 0 };
        const pendingRows = await this.prisma.immaculateTasteShowLibrary.findMany({
            where: { plexUserId, librarySectionKey, status: 'pending', tvdbId: { in: tvdbIds } },
            select: { tvdbId: true, tmdbId: true },
        });
        const pendingTvdbIds = pendingRows.map((r) => r.tvdbId);
        if (!pendingTvdbIds.length)
            return { activated: 0, tmdbRatingsUpdated: 0 };
        const res = await this.prisma.immaculateTasteShowLibrary.updateMany({
            where: {
                plexUserId,
                librarySectionKey,
                status: 'pending',
                tvdbId: { in: pendingTvdbIds },
            },
            data: { status: 'active', points: pointsOnActivation },
        });
        if (res.count) {
            await ctx.info('immaculateTaste(tv): activated pending shows now in Plex', {
                activated: res.count,
                pointsOnActivation,
            });
        }
        let tmdbRatingsUpdated = 0;
        if (res.count && tmdbApiKey) {
            const tmdbPairs = pendingRows
                .map((r) => ({
                tvdbId: r.tvdbId,
                tmdbId: typeof r.tmdbId === 'number' && Number.isFinite(r.tmdbId)
                    ? Math.trunc(r.tmdbId)
                    : null,
            }))
                .filter((p) => p.tmdbId && p.tmdbId > 0);
            const batches = chunk(tmdbPairs, 6);
            for (const batch of batches) {
                await Promise.all(batch.map(async (p) => {
                    const stats = await this.tmdb
                        .getTvVoteStats({ apiKey: tmdbApiKey, tmdbId: p.tmdbId })
                        .catch(() => null);
                    const voteAvg = stats?.vote_average ?? null;
                    const voteCount = stats?.vote_count ?? null;
                    if (voteAvg === null && voteCount === null)
                        return;
                    await this.prisma.immaculateTasteShowLibrary.update({
                        where: {
                            plexUserId_librarySectionKey_tvdbId: {
                                plexUserId,
                                librarySectionKey,
                                tvdbId: p.tvdbId,
                            },
                        },
                        data: { tmdbVoteAvg: voteAvg, tmdbVoteCount: voteCount },
                    });
                    tmdbRatingsUpdated += 1;
                }));
            }
            if (tmdbRatingsUpdated) {
                await ctx.info('immaculateTaste(tv): refreshed TMDB ratings on activation', {
                    updated: tmdbRatingsUpdated,
                    activated: res.count,
                });
            }
        }
        else if (res.count && !tmdbApiKey) {
            await ctx.warn('immaculateTaste(tv): TMDB apiKey missing; skipping rating refresh on activation', { activated: res.count });
        }
        return { activated: res.count, tmdbRatingsUpdated };
    }
    async getActiveShows(params) {
        const librarySectionKey = params.librarySectionKey.trim();
        if (!librarySectionKey)
            throw new Error('librarySectionKey is required');
        const plexUserId = params.plexUserId.trim();
        if (!plexUserId)
            throw new Error('plexUserId is required');
        const minPoints = Math.max(1, Math.trunc(params.minPoints ?? 1));
        const take = params.take ? Math.max(1, Math.trunc(params.take)) : undefined;
        return await this.prisma.immaculateTasteShowLibrary.findMany({
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
        for (const s of params.shows ?? []) {
            const tvdbId = Number.isFinite(s.tvdbId) ? Math.trunc(s.tvdbId) : NaN;
            if (!Number.isFinite(tvdbId) || tvdbId <= 0)
                continue;
            if (!uniq.has(tvdbId))
                uniq.set(tvdbId, {
                    tvdbId,
                    tmdbVoteAvg: s.tmdbVoteAvg ?? null,
                    tmdbVoteCount: s.tmdbVoteCount ?? null,
                });
        }
        const sorted = Array.from(uniq.values()).sort((a, b) => {
            const ar = Number.isFinite(a.tmdbVoteAvg ?? NaN) ? Number(a.tmdbVoteAvg) : 0;
            const br = Number.isFinite(b.tmdbVoteAvg ?? NaN) ? Number(b.tmdbVoteAvg) : 0;
            if (br !== ar)
                return br - ar;
            const ac = Number.isFinite(a.tmdbVoteCount ?? NaN) ? Number(a.tmdbVoteCount) : 0;
            const bc = Number.isFinite(b.tmdbVoteCount ?? NaN) ? Number(b.tmdbVoteCount) : 0;
            if (bc !== ac)
                return bc - ac;
            return a.tvdbId - b.tvdbId;
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
            const pool = tier.filter((m) => !used.has(m.tvdbId));
            const p = pickOne(pool);
            if (!p)
                return;
            used.add(p.tvdbId);
            picks.push(p.tvdbId);
        };
        pickTier(high);
        pickTier(mid);
        pickTier(low);
        shuffleInPlace(picks);
        const remaining = sorted
            .filter((m) => !used.has(m.tvdbId))
            .map((m) => m.tvdbId);
        shuffleInPlace(remaining);
        return [...picks, ...remaining];
    }
};
exports.ImmaculateTasteShowCollectionService = ImmaculateTasteShowCollectionService;
exports.ImmaculateTasteShowCollectionService = ImmaculateTasteShowCollectionService = ImmaculateTasteShowCollectionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        tmdb_service_1.TmdbService])
], ImmaculateTasteShowCollectionService);
function clampMaxPoints(v) {
    const n = typeof v === 'number' && Number.isFinite(v)
        ? Math.trunc(v)
        : typeof v === 'string' && v.trim()
            ? Number.parseInt(v.trim(), 10)
            : ImmaculateTasteShowCollectionService.DEFAULT_MAX_POINTS;
    if (!Number.isFinite(n))
        return ImmaculateTasteShowCollectionService.DEFAULT_MAX_POINTS;
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
//# sourceMappingURL=immaculate-taste-show-collection.service.js.map