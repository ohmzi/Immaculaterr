"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SonarrService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonarrService = void 0;
const common_1 = require("@nestjs/common");
let SonarrService = SonarrService_1 = class SonarrService {
    logger = new common_1.Logger(SonarrService_1.name);
    async testConnection(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/system/status');
        this.logger.log(`Testing Sonarr connection: ${url}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Api-Key': apiKey,
                },
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr test failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            return { ok: true, status: data };
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr test failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listSeries(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/series');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Api-Key': apiKey,
                },
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr list series failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            return Array.isArray(data) ? data : [];
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr list series failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listMonitoredSeries(params) {
        const series = await this.listSeries(params);
        return series.filter((s) => Boolean(s && s.monitored));
    }
    async getEpisodesBySeries(params) {
        const { baseUrl, apiKey, seriesId } = params;
        const url = this.buildApiUrl(baseUrl, `api/v3/episode?seriesId=${seriesId}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Api-Key': apiKey,
                },
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr list episodes failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            return Array.isArray(data) ? data : [];
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr list episodes failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async setEpisodeMonitored(params) {
        const { baseUrl, apiKey, episode, monitored } = params;
        const url = this.buildApiUrl(baseUrl, `api/v3/episode/${episode.id}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const updated = { ...episode, monitored };
            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-Api-Key': apiKey,
                },
                body: JSON.stringify(updated),
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr update episode failed: HTTP ${res.status} ${body}`.trim());
            }
            return true;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr update episode failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async updateSeries(params) {
        const { baseUrl, apiKey, series } = params;
        const url = this.buildApiUrl(baseUrl, `api/v3/series/${series.id}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-Api-Key': apiKey,
                },
                body: JSON.stringify(series),
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr update series failed: HTTP ${res.status} ${body}`.trim());
            }
            return true;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr update series failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async searchMonitoredEpisodes(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/command');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-Api-Key': apiKey,
                },
                body: JSON.stringify({
                    name: 'MissingEpisodeSearch',
                    filterKey: 'monitored',
                    filterValue: 'true',
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr search monitored failed: HTTP ${res.status} ${body}`.trim());
            }
            return true;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr search monitored failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listRootFolders(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/rootfolder');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Api-Key': apiKey,
                },
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr list root folders failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            const rows = Array.isArray(data)
                ? data
                : [];
            const out = [];
            for (const r of rows) {
                const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
                const path = typeof r['path'] === 'string' ? r['path'].trim() : '';
                if (!Number.isFinite(id) || id <= 0)
                    continue;
                if (!path)
                    continue;
                out.push({ id: Math.trunc(id), path });
            }
            return out;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr list root folders failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listQualityProfiles(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/qualityprofile');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Api-Key': apiKey,
                },
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr list quality profiles failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            const rows = Array.isArray(data)
                ? data
                : [];
            const out = [];
            for (const r of rows) {
                const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
                const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
                if (!Number.isFinite(id) || id <= 0)
                    continue;
                if (!name)
                    continue;
                out.push({ id: Math.trunc(id), name });
            }
            return out;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr list quality profiles failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listTags(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/tag');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Api-Key': apiKey,
                },
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr list tags failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            const rows = Array.isArray(data)
                ? data
                : [];
            const out = [];
            for (const r of rows) {
                const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
                const label = typeof r['label'] === 'string' ? r['label'].trim() : '';
                if (!Number.isFinite(id) || id <= 0)
                    continue;
                if (!label)
                    continue;
                out.push({ id: Math.trunc(id), label });
            }
            return out;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr list tags failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async lookupSeries(params) {
        const { baseUrl, apiKey } = params;
        const term = (params.term ?? '').trim();
        if (!term)
            return [];
        const url = this.buildApiUrl(baseUrl, `api/v3/series/lookup?term=${encodeURIComponent(term)}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Api-Key': apiKey,
                },
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Sonarr lookup series failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            return Array.isArray(data) ? data : [];
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr lookup series failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async addSeries(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/series');
        const payload = {
            title: params.title,
            tvdbId: Math.trunc(params.tvdbId),
            qualityProfileId: Math.trunc(params.qualityProfileId),
            rootFolderPath: params.rootFolderPath,
            tags: Array.isArray(params.tags)
                ? params.tags.map((t) => Math.trunc(t))
                : undefined,
            monitored: params.monitored ?? true,
            addOptions: {
                searchForMissingEpisodes: params.searchForMissingEpisodes ?? true,
                searchForCutoffUnmetEpisodes: params.searchForCutoffUnmetEpisodes ?? true,
            },
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-Api-Key': apiKey,
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            if (res.ok) {
                const data = (await res.json().catch(() => null));
                return { status: 'added', series: data ?? null };
            }
            const body = await res.text().catch(() => '');
            const lower = body.toLowerCase();
            if (res.status === 400 &&
                (lower.includes('already been added') ||
                    lower.includes('already exists') ||
                    lower.includes('series exists'))) {
                this.logger.log(`Sonarr add series: already exists tvdbId=${params.tvdbId} title=${JSON.stringify(params.title)}`);
                return { status: 'exists', series: null };
            }
            throw new common_1.BadGatewayException(`Sonarr add series failed: HTTP ${res.status} ${body}`.trim());
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Sonarr add series failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    buildApiUrl(baseUrl, path) {
        const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        return new URL(path, normalized).toString();
    }
};
exports.SonarrService = SonarrService;
exports.SonarrService = SonarrService = SonarrService_1 = __decorate([
    (0, common_1.Injectable)()
], SonarrService);
//# sourceMappingURL=sonarr.service.js.map