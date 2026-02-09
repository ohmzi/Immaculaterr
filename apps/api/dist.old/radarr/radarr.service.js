"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var RadarrService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RadarrService = void 0;
const common_1 = require("@nestjs/common");
let RadarrService = RadarrService_1 = class RadarrService {
    logger = new common_1.Logger(RadarrService_1.name);
    async testConnection(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/system/status');
        this.logger.log(`Testing Radarr connection: ${url}`);
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
                throw new common_1.BadGatewayException(`Radarr test failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            return { ok: true, status: data };
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Radarr test failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listMovies(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/movie');
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
                throw new common_1.BadGatewayException(`Radarr list movies failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            return Array.isArray(data) ? data : [];
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Radarr list movies failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listMonitoredMovies(params) {
        const movies = await this.listMovies(params);
        return movies.filter((m) => Boolean(m && m.monitored));
    }
    async getMovieById(params) {
        const { baseUrl, apiKey, movieId } = params;
        const url = this.buildApiUrl(baseUrl, `api/v3/movie/${movieId}`);
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
                if (res.status === 404)
                    return null;
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Radarr get movie failed: HTTP ${res.status} ${body}`.trim());
            }
            const data = (await res.json());
            return data;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Radarr get movie failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async setMovieMonitored(params) {
        const { baseUrl, apiKey, movie, monitored } = params;
        if (movie.monitored === monitored) {
            return true;
        }
        const url = this.buildApiUrl(baseUrl, `api/v3/movie/${movie.id}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const updated = { ...movie, monitored };
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
                const errorText = body.toLowerCase();
                if (res.status === 400 &&
                    (errorText.includes('path') ||
                        errorText.includes('moviepathvalidator'))) {
                    const title = typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`;
                    this.logger.warn(`Radarr path validation error for movie ${movie.id} (${title}): ${body}. This may indicate duplicate movies in Radarr with the same path. Skipping this movie.`);
                    return false;
                }
                throw new common_1.BadGatewayException(`Radarr update movie failed: HTTP ${res.status} ${body}`.trim());
            }
            return true;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Radarr update movie failed: ${err?.message ?? String(err)}`);
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
                throw new common_1.BadGatewayException(`Radarr list root folders failed: HTTP ${res.status} ${body}`.trim());
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
            throw new common_1.BadGatewayException(`Radarr list root folders failed: ${err?.message ?? String(err)}`);
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
                throw new common_1.BadGatewayException(`Radarr list quality profiles failed: HTTP ${res.status} ${body}`.trim());
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
            throw new common_1.BadGatewayException(`Radarr list quality profiles failed: ${err?.message ?? String(err)}`);
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
                throw new common_1.BadGatewayException(`Radarr list tags failed: HTTP ${res.status} ${body}`.trim());
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
            throw new common_1.BadGatewayException(`Radarr list tags failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async addMovie(params) {
        const { baseUrl, apiKey } = params;
        const url = this.buildApiUrl(baseUrl, 'api/v3/movie');
        const payload = {
            title: params.title,
            tmdbId: Math.trunc(params.tmdbId),
            year: params.year && Number.isFinite(params.year)
                ? Math.trunc(params.year)
                : undefined,
            qualityProfileId: Math.trunc(params.qualityProfileId),
            rootFolderPath: params.rootFolderPath,
            tags: Array.isArray(params.tags)
                ? params.tags.map((t) => Math.trunc(t))
                : undefined,
            monitored: params.monitored ?? true,
            minimumAvailability: params.minimumAvailability ?? 'announced',
            addOptions: {
                searchForMovie: params.searchForMovie ?? true,
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
                return { status: 'added', movie: data ?? null };
            }
            const body = await res.text().catch(() => '');
            const lower = body.toLowerCase();
            if (res.status === 400 &&
                (lower.includes('already been added') ||
                    lower.includes('already exists') ||
                    lower.includes('movie exists'))) {
                this.logger.log(`Radarr add movie: already exists tmdbId=${params.tmdbId} title=${JSON.stringify(params.title)}`);
                return { status: 'exists', movie: null };
            }
            throw new common_1.BadGatewayException(`Radarr add movie failed: HTTP ${res.status} ${body}`.trim());
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Radarr add movie failed: ${err?.message ?? String(err)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async searchMonitoredMovies(params) {
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
                    name: 'MissingMoviesSearch',
                    filterKey: 'monitored',
                    filterValue: 'true',
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new common_1.BadGatewayException(`Radarr search monitored failed: HTTP ${res.status} ${body}`.trim());
            }
            return true;
        }
        catch (err) {
            if (err instanceof common_1.BadGatewayException)
                throw err;
            throw new common_1.BadGatewayException(`Radarr search monitored failed: ${err?.message ?? String(err)}`);
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
exports.RadarrService = RadarrService;
exports.RadarrService = RadarrService = RadarrService_1 = __decorate([
    (0, common_1.Injectable)()
], RadarrService);
//# sourceMappingURL=radarr.service.js.map