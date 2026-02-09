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
var PlexAnalyticsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexAnalyticsService = void 0;
const common_1 = require("@nestjs/common");
const settings_service_1 = require("../settings/settings.service");
const plex_server_service_1 = require("./plex-server.service");
const crypto_1 = require("crypto");
const LIBRARY_GROWTH_ALGO_REV = '2';
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
        if (!/^https?:$/i.test(parsed.protocol))
            throw new Error('Unsupported protocol');
    }
    catch {
        throw new common_1.BadRequestException('baseUrl must be a valid http(s) URL');
    }
    return baseUrl;
}
function monthKeyUtc(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}
function dayKeyUtc(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function startOfMonthUtc(tsSeconds) {
    const d = new Date(tsSeconds * 1000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonthsUtc(date, months) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}
function buildCumulativeMonthlySeries(params) {
    const all = [...params.movieAddedAtSeconds, ...params.tvAddedAtSeconds];
    if (!all.length)
        return [];
    let minTs = all[0];
    for (const ts of all) {
        if (ts < minTs)
            minTs = ts;
    }
    const minStart = new Date(Date.UTC(2015, 0, 1));
    const rawStart = startOfMonthUtc(minTs);
    const start = rawStart < minStart ? minStart : rawStart;
    const startSeconds = Math.floor(start.getTime() / 1000);
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const movieAdds = new Map();
    let movies = 0;
    for (const ts of params.movieAddedAtSeconds) {
        if (ts < startSeconds) {
            movies += 1;
            continue;
        }
        const key = monthKeyUtc(new Date(ts * 1000));
        movieAdds.set(key, (movieAdds.get(key) ?? 0) + 1);
    }
    const tvAdds = new Map();
    let tv = 0;
    for (const ts of params.tvAddedAtSeconds) {
        if (ts < startSeconds) {
            tv += 1;
            continue;
        }
        const key = monthKeyUtc(new Date(ts * 1000));
        tvAdds.set(key, (tvAdds.get(key) ?? 0) + 1);
    }
    const series = [];
    for (let cursor = start; cursor <= end; cursor = addMonthsUtc(cursor, 1)) {
        const key = monthKeyUtc(cursor);
        movies += movieAdds.get(key) ?? 0;
        tv += tvAdds.get(key) ?? 0;
        series.push({ month: key, movies, tv });
    }
    const today = new Date();
    const todayKey = dayKeyUtc(today);
    const lastKey = series.at(-1)?.month ?? '';
    if (todayKey && lastKey !== todayKey) {
        series.push({ month: todayKey, movies, tv });
    }
    return series;
}
let PlexAnalyticsService = PlexAnalyticsService_1 = class PlexAnalyticsService {
    settings;
    plexServer;
    logger = new common_1.Logger(PlexAnalyticsService_1.name);
    cache = new Map();
    growthBustCounterByUserId = new Map();
    constructor(settings, plexServer) {
        this.settings = settings;
        this.plexServer = plexServer;
    }
    invalidateLibraryGrowth(userId) {
        this.cache.delete(userId);
        this.growthBustCounterByUserId.set(userId, (this.growthBustCounterByUserId.get(userId) ?? 0) + 1);
    }
    async getLibraryGrowthVersion(userId) {
        const { settings, secrets } = await this.settings.getInternalSettings(userId);
        const baseUrlRaw = pickString(settings, 'plex.baseUrl');
        const token = pickString(secrets, 'plex.token');
        const signatureSeed = (() => {
            if (!baseUrlRaw || !token)
                return 'unconfigured';
            const baseUrl = normalizeHttpUrl(baseUrlRaw);
            return baseUrl;
        })();
        const signatureHash = (0, crypto_1.createHash)('sha256')
            .update(`${signatureSeed}:${LIBRARY_GROWTH_ALGO_REV}`)
            .digest('hex')
            .slice(0, 16);
        const counter = this.growthBustCounterByUserId.get(userId) ?? 0;
        const dayBucket = Math.floor(Date.now() / 86_400_000);
        return { ok: true, version: `${signatureHash}:${counter}:${dayBucket}` };
    }
    async getLibraryGrowth(userId) {
        const { settings, secrets } = await this.settings.getInternalSettings(userId);
        const baseUrlRaw = pickString(settings, 'plex.baseUrl');
        const token = pickString(secrets, 'plex.token');
        if (!baseUrlRaw || !token) {
            return {
                ok: true,
                series: [],
                summary: {
                    startMonth: null,
                    endMonth: null,
                    movies: 0,
                    tv: 0,
                    total: 0,
                },
            };
        }
        const baseUrl = normalizeHttpUrl(baseUrlRaw);
        const signature = JSON.stringify({ baseUrl, token });
        const cached = this.cache.get(userId);
        const now = Date.now();
        if (cached && cached.signature === signature && cached.expiresAt > now) {
            return cached.data;
        }
        const sections = await this.plexServer.getSections({ baseUrl, token });
        const movieSections = sections.filter((s) => (s.type ?? '').toLowerCase() === 'movie');
        const tvSections = sections.filter((s) => (s.type ?? '').toLowerCase() === 'show');
        if (!movieSections.length && !tvSections.length) {
            const data = {
                ok: true,
                series: [],
                summary: {
                    startMonth: null,
                    endMonth: null,
                    movies: 0,
                    tv: 0,
                    total: 0,
                },
            };
            this.cache.set(userId, {
                signature,
                expiresAt: now + 60 * 60_000,
                data,
            });
            return data;
        }
        this.logger.log(`Computing Plex library growth userId=${userId} movieLibraries=${movieSections.length} tvLibraries=${tvSections.length}`);
        const loadAddedAtForSections = async (kind, targetSections) => {
            if (!targetSections.length)
                return [];
            const perSection = await Promise.all(targetSections.map(async (sec) => {
                try {
                    const values = await this.plexServer.getAddedAtTimestampsForSection({
                        baseUrl,
                        token,
                        librarySectionKey: sec.key,
                    });
                    this.logger.log(`Plex growth source kind=${kind} section=${sec.title} key=${sec.key} items=${values.length}`);
                    return values;
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    this.logger.warn(`Failed loading Plex growth timestamps kind=${kind} section=${sec.title} key=${sec.key}: ${msg}`);
                    return [];
                }
            }));
            return perSection.flat();
        };
        const [movieAddedAtSeconds, tvAddedAtSeconds] = await Promise.all([
            loadAddedAtForSections('movie', movieSections),
            loadAddedAtForSections('tv', tvSections),
        ]);
        const series = buildCumulativeMonthlySeries({
            movieAddedAtSeconds,
            tvAddedAtSeconds,
        });
        const last = series.at(-1);
        const movies = last?.movies ?? 0;
        const tvCount = last?.tv ?? 0;
        const data = {
            ok: true,
            series,
            summary: {
                startMonth: series[0]?.month ?? null,
                endMonth: last?.month ?? null,
                movies,
                tv: tvCount,
                total: movies + tvCount,
            },
        };
        this.cache.set(userId, { signature, expiresAt: now + 60 * 60_000, data });
        return data;
    }
};
exports.PlexAnalyticsService = PlexAnalyticsService;
exports.PlexAnalyticsService = PlexAnalyticsService = PlexAnalyticsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService])
], PlexAnalyticsService);
//# sourceMappingURL=plex-analytics.service.js.map