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
var PlexWatchlistService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexWatchlistService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const fast_xml_parser_1 = require("fast-xml-parser");
const parser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    allowBooleanAttributes: true,
});
function asArray(value) {
    if (!value)
        return [];
    return Array.isArray(value) ? value : [value];
}
function asPlexXml(value) {
    return value && typeof value === 'object' ? value : {};
}
function asWatchlistItems(container) {
    const items = (container?.Metadata ??
        container?.Video ??
        container?.Directory ??
        container?.Hub ??
        []);
    return asArray(items);
}
function toInt(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim()) {
        const n = Number.parseInt(value.trim(), 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function normalizeBaseUrl(baseUrl) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}
function sanitizeUrlForLogs(raw) {
    try {
        const u = new URL(raw);
        u.username = '';
        u.password = '';
        for (const k of [
            'X-Plex-Token',
            'x-plex-token',
            'token',
            'authToken',
            'auth_token',
            'plexToken',
            'plex_token',
        ]) {
            if (u.searchParams.has(k))
                u.searchParams.set(k, 'REDACTED');
        }
        return u.toString();
    }
    catch {
        return raw;
    }
}
function normTitle(s) {
    return (s ?? '')
        .toLowerCase()
        .split('')
        .filter((ch) => /[a-z0-9]/.test(ch))
        .join('');
}
function diceCoefficient(a, b) {
    const s1 = normTitle(a);
    const s2 = normTitle(b);
    if (!s1 || !s2)
        return 0;
    if (s1 === s2)
        return 1;
    if (s1.length < 2 || s2.length < 2)
        return 0;
    const bigrams = (s) => {
        const map = new Map();
        for (let i = 0; i < s.length - 1; i += 1) {
            const bg = s.slice(i, i + 2);
            map.set(bg, (map.get(bg) ?? 0) + 1);
        }
        return map;
    };
    const m1 = bigrams(s1);
    const m2 = bigrams(s2);
    let intersection = 0;
    for (const [bg, c1] of m1.entries()) {
        const c2 = m2.get(bg) ?? 0;
        intersection += Math.min(c1, c2);
    }
    return (2 * intersection) / (s1.length - 1 + (s2.length - 1));
}
let PlexWatchlistService = PlexWatchlistService_1 = class PlexWatchlistService {
    logger = new common_1.Logger(PlexWatchlistService_1.name);
    clientIdentifier;
    constructor() {
        this.clientIdentifier = process.env.PLEX_CLIENT_IDENTIFIER ?? (0, node_crypto_1.randomUUID)();
    }
    async listWatchlist(params) {
        const { token, kind } = params;
        const typeNum = kind === 'movie' ? 1 : 2;
        const bases = [
            'https://discover.provider.plex.tv/',
            'https://metadata.provider.plex.tv/',
        ];
        const paths = [
            `library/sections/watchlist/all?type=${typeNum}`,
            `library/sections/watchlist/all?type=${typeNum}&includeGuids=1`,
        ];
        let lastErr = null;
        for (const base of bases) {
            for (const p of paths) {
                const url = new URL(p, normalizeBaseUrl(base)).toString();
                try {
                    const xml = asPlexXml(await this.fetchXml(url, token, 20000));
                    const container = xml.MediaContainer;
                    const items = asWatchlistItems(container);
                    const out = items
                        .map((it) => ({
                        ratingKey: it.ratingKey ? String(it.ratingKey) : '',
                        title: typeof it.title === 'string' ? it.title : '',
                        year: toInt(it.year),
                        type: typeof it.type === 'string' ? it.type : null,
                    }))
                        .filter((it) => it.ratingKey && it.title);
                    return { ok: true, baseUrl: base, items: out };
                }
                catch (err) {
                    lastErr = err;
                    this.logger.debug(`Watchlist fetch failed base=${base} path=${p}: ${err?.message ?? String(err)}`);
                }
            }
        }
        throw new common_1.BadGatewayException(`Failed to load Plex watchlist: ${lastErr?.message ?? String(lastErr)}`);
    }
    async removeMovieFromWatchlistByTitle(params) {
        const { token, title, year, dryRun = false } = params;
        const q = title.trim();
        if (!q) {
            return {
                ok: true,
                removed: 0,
                attempted: 0,
                matchedBy: 'none',
                sample: [],
                baseUrlTried: null,
            };
        }
        const wl = await this.listWatchlist({ token, kind: 'movie' });
        const wantedNorm = normTitle(q);
        const candidatesNorm = wl.items.filter((it) => {
            if (normTitle(it.title) !== wantedNorm)
                return false;
            if (typeof year === 'number' && Number.isFinite(year)) {
                return it.year === year;
            }
            return true;
        });
        let candidates = candidatesNorm;
        let matchedBy = candidatesNorm.length > 0 ? 'normalized' : 'none';
        if (candidates.length === 0) {
            let best = null;
            for (const it of wl.items) {
                const score = diceCoefficient(q, it.title);
                if (!best || score > best.score)
                    best = { item: it, score };
            }
            if (best && best.score >= 0.8) {
                candidates = wl.items.filter((it) => it.title === best.item.title);
                matchedBy = candidates.length > 0 ? 'fuzzy' : 'none';
            }
        }
        let removed = 0;
        for (const it of candidates) {
            if (dryRun)
                continue;
            const ok = await this.removeFromWatchlistByRatingKey({
                token,
                ratingKey: it.ratingKey,
            }).catch(() => false);
            if (ok)
                removed += 1;
        }
        return {
            ok: true,
            removed,
            attempted: candidates.length,
            matchedBy,
            sample: candidates.slice(0, 10),
            baseUrlTried: wl.baseUrl,
        };
    }
    async removeShowFromWatchlistByTitle(params) {
        const { token, title, dryRun = false } = params;
        const q = title.trim();
        if (!q) {
            return {
                ok: true,
                removed: 0,
                attempted: 0,
                matchedBy: 'none',
                sample: [],
                baseUrlTried: null,
            };
        }
        const wl = await this.listWatchlist({ token, kind: 'show' });
        const wantedNorm = normTitle(q);
        const candidatesNorm = wl.items.filter((it) => normTitle(it.title) === wantedNorm);
        let candidates = candidatesNorm;
        let matchedBy = candidatesNorm.length > 0 ? 'normalized' : 'none';
        if (candidates.length === 0) {
            let best = null;
            for (const it of wl.items) {
                const score = diceCoefficient(q, it.title);
                if (!best || score > best.score)
                    best = { item: it, score };
            }
            if (best && best.score >= 0.8) {
                candidates = wl.items.filter((it) => it.title === best.item.title);
                matchedBy = candidates.length > 0 ? 'fuzzy' : 'none';
            }
        }
        let removed = 0;
        for (const it of candidates) {
            if (dryRun)
                continue;
            const ok = await this.removeFromWatchlistByRatingKey({
                token,
                ratingKey: it.ratingKey,
            }).catch(() => false);
            if (ok)
                removed += 1;
        }
        return {
            ok: true,
            removed,
            attempted: candidates.length,
            matchedBy,
            sample: candidates.slice(0, 10),
            baseUrlTried: wl.baseUrl,
        };
    }
    async removeFromWatchlistByRatingKey(params) {
        const { token, ratingKey } = params;
        const key = ratingKey.trim();
        if (!key)
            return false;
        const bases = [
            'https://discover.provider.plex.tv/',
            'https://metadata.provider.plex.tv/',
        ];
        const candidates = [
            {
                method: 'PUT',
                path: `actions/removeFromWatchlist?ratingKey=${encodeURIComponent(key)}`,
            },
            {
                method: 'PUT',
                path: `actions/removeFromWatchlist?key=${encodeURIComponent(key)}`,
            },
            {
                method: 'PUT',
                path: `library/metadata/${encodeURIComponent(key)}/actions/removeFromWatchlist`,
            },
            {
                method: 'POST',
                path: `library/metadata/${encodeURIComponent(key)}/actions/removeFromWatchlist`,
            },
            {
                method: 'PUT',
                path: `library/metadata/${encodeURIComponent(key)}/removeFromWatchlist`,
            },
            {
                method: 'POST',
                path: `library/metadata/${encodeURIComponent(key)}/removeFromWatchlist`,
            },
            {
                method: 'DELETE',
                path: `library/metadata/${encodeURIComponent(key)}/watchlist`,
            },
        ];
        for (const base of bases) {
            for (const c of candidates) {
                const url = new URL(c.path, normalizeBaseUrl(base)).toString();
                try {
                    const ok = await this.fetchNoContent(url, token, c.method, 15000);
                    if (ok)
                        return true;
                }
                catch (err) {
                    this.logger.debug(`Watchlist remove failed ${c.method} ${sanitizeUrlForLogs(url)}: ${err?.message ?? String(err)}`);
                }
            }
        }
        return false;
    }
    getPlexHeaders(params) {
        return {
            Accept: 'application/xml',
            'X-Plex-Client-Identifier': this.clientIdentifier,
            'X-Plex-Product': 'Immaculaterr',
            'X-Plex-Version': '0.0.0',
            'X-Plex-Device': 'Server',
            'X-Plex-Device-Name': 'Immaculaterr',
            'X-Plex-Platform': 'Web',
            'X-Plex-Platform-Version': process.version,
            ...(params.token ? { 'X-Plex-Token': params.token } : {}),
        };
    }
    async fetchNoContent(url, token, method, timeoutMs) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const safeUrl = sanitizeUrlForLogs(url);
        const startedAt = Date.now();
        try {
            const res = await fetch(url, {
                method,
                headers: {
                    ...this.getPlexHeaders({ token }),
                    Accept: 'application/json',
                },
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                const ms = Date.now() - startedAt;
                this.logger.debug(`Plex watchlist HTTP ${method} ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim());
                return false;
            }
            const ms = Date.now() - startedAt;
            this.logger.log(`Plex watchlist HTTP ${method} ${safeUrl} -> ${res.status} (${ms}ms)`);
            return true;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async fetchXml(url, token, timeoutMs) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const safeUrl = sanitizeUrlForLogs(url);
        const startedAt = Date.now();
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: this.getPlexHeaders({ token }),
                signal: controller.signal,
            });
            const text = await res.text().catch(() => '');
            const ms = Date.now() - startedAt;
            if (!res.ok) {
                this.logger.debug(`Plex watchlist HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${text}`.trim());
                throw new common_1.BadGatewayException(`Plex watchlist request failed: HTTP ${res.status} ${text}`.trim());
            }
            this.logger.log(`Plex watchlist HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);
            return parser.parse(text);
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            const ms = Date.now() - startedAt;
            this.logger.debug(`Plex watchlist HTTP GET ${safeUrl} -> FAILED (${ms}ms): ${err?.message ?? String(err)}`.trim());
            throw new common_1.BadGatewayException(`Plex watchlist request failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
};
exports.PlexWatchlistService = PlexWatchlistService;
exports.PlexWatchlistService = PlexWatchlistService = PlexWatchlistService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PlexWatchlistService);
//# sourceMappingURL=plex-watchlist.service.js.map