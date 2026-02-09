"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var GoogleService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleService = void 0;
const common_1 = require("@nestjs/common");
let GoogleService = GoogleService_1 = class GoogleService {
    logger = new common_1.Logger(GoogleService_1.name);
    async search(params) {
        const { results, meta } = await this.executeSearch({
            apiKey: params.apiKey,
            cseId: params.cseId,
            query: params.query,
            numResults: params.numResults,
            purpose: 'runtime',
        });
        return { results, meta };
    }
    async testConnection(params) {
        const { results, meta } = await this.executeSearch({
            apiKey: params.apiKey,
            cseId: params.cseId,
            query: params.query,
            numResults: params.numResults,
            purpose: 'test',
        });
        return { ok: true, results, meta };
    }
    formatForPrompt(results) {
        const lines = [];
        for (let i = 0; i < results.length; i += 1) {
            const r = results[i];
            const title = (r.title || '').trim();
            const snippet = (r.snippet || '').trim();
            const link = (r.link || '').trim();
            if (!title && !snippet)
                continue;
            if (!link)
                continue;
            lines.push([
                `${i + 1}. ${title || '(untitled)'}`.trim(),
                snippet ? `Snippet: ${snippet}` : null,
                `Link: ${link}`,
            ]
                .filter(Boolean)
                .join('\n'));
            lines.push('');
        }
        return lines.join('\n').trim();
    }
    coerceWanted(value) {
        const n = Number.isFinite(value) ? Math.trunc(value) : 15;
        if (n < 0)
            return 0;
        return n;
    }
    async executeSearch(params) {
        const apiKey = params.apiKey.trim();
        const cseId = params.cseId.trim();
        const query = params.query.trim();
        const wanted = this.coerceWanted(params.numResults);
        const hardCap = Math.min(wanted, 50);
        if (params.purpose === 'test') {
            this.logger.log(`Testing Google CSE: query=${JSON.stringify(query)} wanted=${hardCap}`);
        }
        else {
            this.logger.log(`Google CSE search: query=${JSON.stringify(query)} wanted=${hardCap}`);
        }
        if (hardCap === 0) {
            return {
                results: [],
                meta: { requested: 0, returned: 0 },
            };
        }
        const results = [];
        const seenLinks = new Set();
        let start = 1;
        while (results.length < hardCap) {
            const remaining = hardCap - results.length;
            const pageSize = Math.max(1, Math.min(remaining, 10));
            const url = new URL('https://www.googleapis.com/customsearch/v1');
            url.searchParams.set('key', apiKey);
            url.searchParams.set('cx', cseId);
            url.searchParams.set('q', query);
            url.searchParams.set('num', String(pageSize));
            url.searchParams.set('start', String(start));
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            try {
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                    signal: controller.signal,
                });
                if (!res.ok) {
                    const detail = await this.extractGoogleErrorDetail(res);
                    throw new common_1.BadGatewayException(`Google CSE failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`.trim());
                }
                const data = (await res.json());
                const items = Array.isArray(data.items)
                    ? data.items
                    : [];
                if (!items.length)
                    break;
                let added = 0;
                for (const it of items) {
                    const title = typeof it.title === 'string' ? it.title.trim() : '';
                    const snippet = typeof it.snippet === 'string' ? it.snippet.trim() : '';
                    const link = typeof it.link === 'string' ? it.link.trim() : '';
                    if (!link)
                        continue;
                    if (!title && !snippet)
                        continue;
                    if (seenLinks.has(link))
                        continue;
                    seenLinks.add(link);
                    results.push({ title, snippet, link });
                    added++;
                    if (results.length >= hardCap)
                        break;
                }
                if (added === 0)
                    break;
                start += pageSize;
                if (start > 91)
                    break;
            }
            catch (err) {
                if (err instanceof common_1.BadGatewayException)
                    throw err;
                throw new common_1.BadGatewayException(`Google CSE failed: ${err?.message ?? String(err)}`);
            }
            finally {
                clearTimeout(timeout);
            }
        }
        return {
            results,
            meta: {
                requested: hardCap,
                returned: results.length,
            },
        };
    }
    async extractGoogleErrorDetail(res) {
        try {
            const payload = (await res.json());
            if (!payload || typeof payload !== 'object')
                return '';
            const err = payload['error'];
            if (!err || typeof err !== 'object')
                return '';
            const msg = err['message'];
            const errors = err['errors'];
            let reason = null;
            if (Array.isArray(errors) &&
                errors.length &&
                errors[0] &&
                typeof errors[0] === 'object') {
                reason = errors[0]['reason'] ?? null;
            }
            return `message=${JSON.stringify(msg)} reason=${JSON.stringify(reason)}`;
        }
        catch {
            try {
                const text = await res.text();
                return text ? `body=${JSON.stringify(text.slice(0, 300))}` : '';
            }
            catch {
                return '';
            }
        }
    }
};
exports.GoogleService = GoogleService;
exports.GoogleService = GoogleService = GoogleService_1 = __decorate([
    (0, common_1.Injectable)()
], GoogleService);
//# sourceMappingURL=google.service.js.map