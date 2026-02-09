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
exports.PlexDuplicatesService = void 0;
const common_1 = require("@nestjs/common");
const plex_server_service_1 = require("./plex-server.service");
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
function buildMediaCandidates(meta, preserveQualityTerms) {
    const terms = (preserveQualityTerms ?? [])
        .map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
        .filter(Boolean);
    const byMedia = new Map();
    for (const m of meta.media ?? []) {
        const mediaId = m.id ?? null;
        if (!mediaId)
            continue;
        const existing = byMedia.get(mediaId);
        let bestSize = existing?.bestPartSize ?? null;
        for (const p of m.parts ?? []) {
            if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                bestSize = bestSize === null ? p.size : Math.max(bestSize, p.size);
            }
        }
        let preserved = existing?.preserved ?? false;
        if (!preserved && terms.length > 0) {
            const target = `${m.videoResolution ?? ''} ${m.parts
                .map((p) => p.file ?? '')
                .join(' ')}`.toLowerCase();
            preserved = terms.some((t) => target.includes(t));
        }
        byMedia.set(mediaId, {
            mediaId,
            videoResolution: m.videoResolution ?? null,
            bestPartSize: bestSize,
            preserved,
        });
    }
    return Array.from(byMedia.values());
}
function sortBySizeAsc(a, b) {
    const sa = typeof a.size === 'number' ? a.size : Number.POSITIVE_INFINITY;
    const sb = typeof b.size === 'number' ? b.size : Number.POSITIVE_INFINITY;
    return sa - sb;
}
function sortBySizeDesc(a, b) {
    const sa = typeof a.size === 'number' ? a.size : Number.NEGATIVE_INFINITY;
    const sb = typeof b.size === 'number' ? b.size : Number.NEGATIVE_INFINITY;
    return sb - sa;
}
function buildCopies(meta, preserveQualityTerms) {
    const terms = (preserveQualityTerms ?? [])
        .map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
        .filter(Boolean);
    const copies = [];
    for (const m of meta.media ?? []) {
        for (const p of m.parts ?? []) {
            const target = `${m.videoResolution ?? ''} ${p.file ?? ''}`.toLowerCase();
            const preserved = terms.length > 0 ? terms.some((t) => target.includes(t)) : false;
            copies.push({
                mediaId: m.id,
                videoResolution: m.videoResolution,
                partId: p.id,
                partKey: p.key,
                file: p.file,
                size: p.size,
                preserved,
            });
        }
    }
    return copies;
}
let PlexDuplicatesService = class PlexDuplicatesService {
    plex;
    constructor(plex) {
        this.plex = plex;
    }
    pickRepresentativeCopyForMedia(copies, mediaId) {
        const reps = copies.filter((c) => c.mediaId === mediaId).slice().sort(sortBySizeDesc);
        return reps[0] ?? null;
    }
    async cleanupMovieDuplicates(params) {
        const { baseUrl, token, ratingKey, dryRun, deletePreference, preserveQualityTerms, } = params;
        const meta = await this.plex.getMetadataDetails({
            baseUrl,
            token,
            ratingKey,
        });
        if (!meta) {
            return {
                dryRun,
                ratingKey,
                title: '',
                type: null,
                copies: 0,
                kept: null,
                deleted: 0,
                wouldDelete: 0,
                failures: 0,
                warnings: ['plex: metadata not found'],
                deletions: [],
                metadata: {
                    tmdbIds: [],
                    tvdbIds: [],
                    year: null,
                    parentIndex: null,
                    index: null,
                },
            };
        }
        const warnings = [];
        const copies = buildCopies(meta, preserveQualityTerms);
        if (copies.length <= 1) {
            return {
                dryRun,
                ratingKey: meta.ratingKey,
                title: meta.title,
                type: meta.type,
                copies: copies.length,
                kept: copies[0] ?? null,
                deleted: 0,
                wouldDelete: 0,
                failures: 0,
                warnings,
                deletions: [],
                metadata: {
                    tmdbIds: meta.tmdbIds,
                    tvdbIds: meta.tvdbIds,
                    year: meta.year,
                    parentIndex: meta.parentIndex,
                    index: meta.index,
                },
            };
        }
        const mediaCandidates = buildMediaCandidates(meta, preserveQualityTerms);
        if (mediaCandidates.length > 1) {
            let pref = deletePreference;
            if (pref === 'newest' || pref === 'oldest') {
                warnings.push(`plex: deletePreference=${pref} not supported for per-item version cleanup; falling back to smallest_file`);
                pref = 'smallest_file';
            }
            const keepPool = mediaCandidates.some((m) => m.preserved)
                ? mediaCandidates.filter((m) => m.preserved)
                : mediaCandidates;
            const orderedKeep = keepPool.slice().sort((a, b) => {
                const sa = a.bestPartSize ??
                    (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
                const sb = b.bestPartSize ??
                    (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
                if (sa !== sb)
                    return pref === 'smallest_file' ? sb - sa : sa - sb;
                const ra = resolutionPriority(a.videoResolution);
                const rb = resolutionPriority(b.videoResolution);
                if (ra !== rb)
                    return rb - ra;
                return (b.bestPartSize ?? 0) - (a.bestPartSize ?? 0);
            });
            const keptMediaId = orderedKeep[0]?.mediaId ?? null;
            if (keptMediaId) {
                const kept = copies
                    .filter((c) => c.mediaId === keptMediaId)
                    .slice()
                    .sort(sortBySizeDesc)[0] ?? null;
                const toDeleteMediaIds = Array.from(new Set(copies
                    .filter((c) => c.mediaId && c.mediaId !== keptMediaId)
                    .map((c) => c.mediaId)));
                let deleted = 0;
                let wouldDelete = 0;
                let failures = 0;
                const deletions = [];
                for (const mediaId of toDeleteMediaIds) {
                    const rep = this.pickRepresentativeCopyForMedia(copies, mediaId);
                    const base = rep ?? {
                        mediaId,
                        videoResolution: null,
                        partId: null,
                        partKey: null,
                        file: null,
                        size: null,
                        preserved: false,
                    };
                    if (dryRun) {
                        wouldDelete += 1;
                        deletions.push({ ...base, deleted: false });
                        continue;
                    }
                    try {
                        await this.plex.deleteMediaVersion({
                            baseUrl,
                            token,
                            ratingKey: meta.ratingKey,
                            mediaId,
                        });
                        deleted += 1;
                        deletions.push({ ...base, deleted: true });
                    }
                    catch (err) {
                        failures += 1;
                        deletions.push({
                            ...base,
                            deleted: false,
                            error: err?.message ?? String(err),
                        });
                    }
                }
                return {
                    dryRun,
                    ratingKey: meta.ratingKey,
                    title: meta.title,
                    type: meta.type,
                    copies: copies.length,
                    kept,
                    deleted,
                    wouldDelete,
                    failures,
                    warnings,
                    deletions,
                    metadata: {
                        tmdbIds: meta.tmdbIds,
                        tvdbIds: meta.tvdbIds,
                        year: meta.year,
                        parentIndex: meta.parentIndex,
                        index: meta.index,
                    },
                };
            }
        }
        const preservedCopies = copies.filter((c) => c.preserved);
        let pref = deletePreference;
        if (pref === 'newest' || pref === 'oldest') {
            warnings.push(`plex: deletePreference=${pref} not supported for per-item version cleanup; falling back to smallest_file`);
            pref = 'smallest_file';
        }
        const keepSort = pref === 'largest_file' ? sortBySizeAsc : sortBySizeDesc;
        const keepPool = preservedCopies.length > 0 ? preservedCopies : copies;
        const orderedKeep = keepPool.slice().sort(keepSort);
        const kept = orderedKeep[0] ?? null;
        const keptKey = kept?.partKey ?? kept?.partId ?? null;
        const toDelete = (() => {
            if (!kept || !keptKey) {
                warnings.push('plex: unable to identify a stable kept copy (missing partKey/partId); skipping deletion for safety');
                return [];
            }
            return copies.filter((c) => (c.partKey ?? c.partId ?? null) !== keptKey);
        })();
        let deleted = 0;
        let wouldDelete = 0;
        let failures = 0;
        const deletions = [];
        for (const copy of toDelete) {
            if (!copy.partKey) {
                failures += 1;
                deletions.push({
                    ...copy,
                    deleted: false,
                    error: 'missing partKey',
                });
                continue;
            }
            if (dryRun) {
                wouldDelete += 1;
                deletions.push({ ...copy, deleted: false });
                continue;
            }
            try {
                await this.plex.deletePartByKey({
                    baseUrl,
                    token,
                    partKey: copy.partKey,
                });
                deleted += 1;
                deletions.push({ ...copy, deleted: true });
            }
            catch (err) {
                failures += 1;
                deletions.push({
                    ...copy,
                    deleted: false,
                    error: err?.message ?? String(err),
                });
            }
        }
        return {
            dryRun,
            ratingKey: meta.ratingKey,
            title: meta.title,
            type: meta.type,
            copies: copies.length,
            kept,
            deleted,
            wouldDelete,
            failures,
            warnings,
            deletions,
            metadata: {
                tmdbIds: meta.tmdbIds,
                tvdbIds: meta.tvdbIds,
                year: meta.year,
                parentIndex: meta.parentIndex,
                index: meta.index,
            },
        };
    }
    async cleanupEpisodeDuplicates(params) {
        const { baseUrl, token, ratingKey, dryRun } = params;
        const meta = await this.plex.getMetadataDetails({
            baseUrl,
            token,
            ratingKey,
        });
        if (!meta) {
            return {
                dryRun,
                ratingKey,
                title: '',
                type: null,
                copies: 0,
                kept: null,
                deleted: 0,
                wouldDelete: 0,
                failures: 0,
                warnings: ['plex: metadata not found'],
                deletions: [],
                metadata: {
                    tmdbIds: [],
                    tvdbIds: [],
                    year: null,
                    parentIndex: null,
                    index: null,
                },
            };
        }
        const copies = buildCopies(meta, []);
        const warnings = [];
        if (copies.length <= 1) {
            return {
                dryRun,
                ratingKey: meta.ratingKey,
                title: meta.title,
                type: meta.type,
                copies: copies.length,
                kept: copies[0] ?? null,
                deleted: 0,
                wouldDelete: 0,
                failures: 0,
                warnings,
                deletions: [],
                metadata: {
                    tmdbIds: meta.tmdbIds,
                    tvdbIds: meta.tvdbIds,
                    year: meta.year,
                    parentIndex: meta.parentIndex,
                    index: meta.index,
                },
            };
        }
        const mediaCandidates = buildMediaCandidates(meta, []);
        if (mediaCandidates.length > 1) {
            const orderedMedia = mediaCandidates.slice().sort((a, b) => {
                const pa = resolutionPriority(a.videoResolution);
                const pb = resolutionPriority(b.videoResolution);
                if (pa !== pb)
                    return pb - pa;
                const sa = a.bestPartSize ?? 0;
                const sb = b.bestPartSize ?? 0;
                return sb - sa;
            });
            const keptMediaId = orderedMedia[0]?.mediaId ?? null;
            if (keptMediaId) {
                const kept = copies
                    .filter((c) => c.mediaId === keptMediaId)
                    .slice()
                    .sort(sortBySizeDesc)[0] ?? null;
                const toDeleteMediaIds = Array.from(new Set(copies
                    .filter((c) => c.mediaId && c.mediaId !== keptMediaId)
                    .map((c) => c.mediaId)));
                let deleted = 0;
                let wouldDelete = 0;
                let failures = 0;
                const deletions = [];
                for (const mediaId of toDeleteMediaIds) {
                    const rep = this.pickRepresentativeCopyForMedia(copies, mediaId);
                    const base = rep ?? {
                        mediaId,
                        videoResolution: null,
                        partId: null,
                        partKey: null,
                        file: null,
                        size: null,
                        preserved: false,
                    };
                    if (dryRun) {
                        wouldDelete += 1;
                        deletions.push({ ...base, deleted: false });
                        continue;
                    }
                    try {
                        await this.plex.deleteMediaVersion({
                            baseUrl,
                            token,
                            ratingKey: meta.ratingKey,
                            mediaId,
                        });
                        deleted += 1;
                        deletions.push({ ...base, deleted: true });
                    }
                    catch (err) {
                        failures += 1;
                        deletions.push({
                            ...base,
                            deleted: false,
                            error: err?.message ?? String(err),
                        });
                    }
                }
                return {
                    dryRun,
                    ratingKey: meta.ratingKey,
                    title: meta.title,
                    type: meta.type,
                    copies: copies.length,
                    kept,
                    deleted,
                    wouldDelete,
                    failures,
                    warnings,
                    deletions,
                    metadata: {
                        tmdbIds: meta.tmdbIds,
                        tvdbIds: meta.tvdbIds,
                        year: meta.year,
                        parentIndex: meta.parentIndex,
                        index: meta.index,
                    },
                };
            }
        }
        const ordered = copies.slice().sort((a, b) => {
            const pa = resolutionPriority(a.videoResolution);
            const pb = resolutionPriority(b.videoResolution);
            if (pa !== pb)
                return pa - pb;
            return sortBySizeAsc(a, b);
        });
        const toDelete = ordered.slice(0, -1);
        const kept = ordered.at(-1) ?? null;
        let deleted = 0;
        let wouldDelete = 0;
        let failures = 0;
        const deletions = [];
        for (const copy of toDelete) {
            if (!copy.partKey) {
                failures += 1;
                deletions.push({
                    ...copy,
                    deleted: false,
                    error: 'missing partKey',
                });
                continue;
            }
            if (dryRun) {
                wouldDelete += 1;
                deletions.push({ ...copy, deleted: false });
                continue;
            }
            try {
                await this.plex.deletePartByKey({
                    baseUrl,
                    token,
                    partKey: copy.partKey,
                });
                deleted += 1;
                deletions.push({ ...copy, deleted: true });
            }
            catch (err) {
                failures += 1;
                deletions.push({
                    ...copy,
                    deleted: false,
                    error: err?.message ?? String(err),
                });
            }
        }
        return {
            dryRun,
            ratingKey: meta.ratingKey,
            title: meta.title,
            type: meta.type,
            copies: copies.length,
            kept,
            deleted,
            wouldDelete,
            failures,
            warnings,
            deletions,
            metadata: {
                tmdbIds: meta.tmdbIds,
                tvdbIds: meta.tvdbIds,
                year: meta.year,
                parentIndex: meta.parentIndex,
                index: meta.index,
            },
        };
    }
};
exports.PlexDuplicatesService = PlexDuplicatesService;
exports.PlexDuplicatesService = PlexDuplicatesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [plex_server_service_1.PlexServerService])
], PlexDuplicatesService);
//# sourceMappingURL=plex-duplicates.service.js.map