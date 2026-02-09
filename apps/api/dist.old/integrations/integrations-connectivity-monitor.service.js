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
var IntegrationsConnectivityMonitorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsConnectivityMonitorService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../db/prisma.service");
const settings_service_1 = require("../settings/settings.service");
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
function pickBool(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'boolean' ? v : null;
}
function errToMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
function normalizeHttpUrl(raw) {
    const trimmed = raw.trim();
    const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('baseUrl must be a valid http(s) URL');
    }
    return baseUrl;
}
let IntegrationsConnectivityMonitorService = class IntegrationsConnectivityMonitorService {
    static { IntegrationsConnectivityMonitorService_1 = this; }
    prisma;
    settingsService;
    logger = new common_1.Logger(IntegrationsConnectivityMonitorService_1.name);
    static INTERVAL_MS = 5 * 60_000;
    static OFFLINE_REMINDER_MS = 15 * 60_000;
    static FAILS_TO_MARK_OFFLINE = 2;
    state = new Map();
    onModuleInit() {
        setTimeout(() => void this.checkOnce(), 12_000);
    }
    async poll() {
        await this.checkOnce();
    }
    getState(key) {
        const existing = this.state.get(key);
        if (existing)
            return existing;
        const init = {
            status: 'unknown',
            consecutiveFails: 0,
            lastError: null,
            lastNoisyOfflineLogAtMs: null,
        };
        this.state.set(key, init);
        return init;
    }
    setStatus(key, next, error, meta) {
        const now = Date.now();
        const st = this.getState(key);
        const changed = next !== st.status;
        if (changed) {
            st.status = next;
            st.lastError = error;
            st.lastNoisyOfflineLogAtMs = null;
            if (next === 'online') {
                this.logger.log(`Integration connectivity: ${key.toUpperCase()} ONLINE${meta ? ` ${JSON.stringify(meta)}` : ''}`);
            }
            else if (next === 'offline') {
                this.logger.warn(`Integration connectivity: ${key.toUpperCase()} OFFLINE error=${JSON.stringify(error ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
                st.lastNoisyOfflineLogAtMs = now;
            }
            else if (next === 'not_configured') {
                this.logger.debug(`Integration connectivity: ${key.toUpperCase()} not configured${meta ? ` ${JSON.stringify(meta)}` : ''}`);
            }
            return;
        }
        if (next === 'offline') {
            const last = st.lastNoisyOfflineLogAtMs ?? 0;
            if (now - last >= IntegrationsConnectivityMonitorService_1.OFFLINE_REMINDER_MS) {
                this.logger.warn(`Integration connectivity: ${key.toUpperCase()} still OFFLINE error=${JSON.stringify(error ?? st.lastError ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
                st.lastNoisyOfflineLogAtMs = now;
            }
        }
        st.lastError = error ?? st.lastError;
    }
    async checkOnce() {
        const user = await this.prisma.user
            .findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
            .catch(() => null);
        const userId = user?.id ?? null;
        if (!userId)
            return;
        const { settings, secrets } = await this.settingsService
            .getInternalSettings(userId)
            .catch(() => ({
            settings: {},
            secrets: {},
        }));
        const s = settings;
        const sec = secrets;
        await Promise.all([
            this.checkTmdb(s, sec),
            this.checkRadarr(s, sec),
            this.checkSonarr(s, sec),
            this.checkOpenAi(s, sec),
            this.checkGoogle(s, sec),
        ]);
    }
    constructor(prisma, settingsService) {
        this.prisma = prisma;
        this.settingsService = settingsService;
    }
    async checkTmdb(settings, secrets) {
        const apiKey = pickString(secrets, 'tmdb.apiKey') ||
            pickString(secrets, 'tmdbApiKey') ||
            pickString(secrets, 'tmdb.api_key');
        if (!apiKey) {
            this.setStatus('tmdb', 'not_configured', null, { reason: 'missing_apiKey' });
            return;
        }
        const url = new URL('https://api.themoviedb.org/3/configuration');
        url.searchParams.set('api_key', apiKey);
        await this.probeHttp('tmdb', url.toString(), {
            headers: { Accept: 'application/json' },
            timeoutMs: 10_000,
        });
    }
    async checkRadarr(settings, secrets) {
        const enabled = (pickBool(settings, 'radarr.enabled') ?? Boolean(pickString(secrets, 'radarr.apiKey'))) &&
            Boolean(pickString(settings, 'radarr.baseUrl')) &&
            Boolean(pickString(secrets, 'radarr.apiKey'));
        if (!enabled) {
            this.setStatus('radarr', 'not_configured', null, { reason: 'disabled_or_missing' });
            return;
        }
        const baseUrl = normalizeHttpUrl(pickString(settings, 'radarr.baseUrl'));
        const apiKey = pickString(secrets, 'radarr.apiKey');
        const url = new URL('api/v3/system/status', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
        await this.probeHttp('radarr', url, {
            headers: { Accept: 'application/json', 'X-Api-Key': apiKey },
            timeoutMs: 10_000,
        });
    }
    async checkSonarr(settings, secrets) {
        const enabled = (pickBool(settings, 'sonarr.enabled') ?? Boolean(pickString(secrets, 'sonarr.apiKey'))) &&
            Boolean(pickString(settings, 'sonarr.baseUrl')) &&
            Boolean(pickString(secrets, 'sonarr.apiKey'));
        if (!enabled) {
            this.setStatus('sonarr', 'not_configured', null, { reason: 'disabled_or_missing' });
            return;
        }
        const baseUrl = normalizeHttpUrl(pickString(settings, 'sonarr.baseUrl'));
        const apiKey = pickString(secrets, 'sonarr.apiKey');
        const url = new URL('api/v3/system/status', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
        await this.probeHttp('sonarr', url, {
            headers: { Accept: 'application/json', 'X-Api-Key': apiKey },
            timeoutMs: 10_000,
        });
    }
    async checkOpenAi(settings, secrets) {
        const enabled = (pickBool(settings, 'openai.enabled') ?? false) && Boolean(pickString(secrets, 'openai.apiKey'));
        if (!enabled) {
            this.setStatus('openai', 'not_configured', null, { reason: 'disabled_or_missing' });
            return;
        }
        const apiKey = pickString(secrets, 'openai.apiKey');
        const url = 'https://api.openai.com/v1/models';
        await this.probeHttp('openai', url, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
            timeoutMs: 10_000,
        });
    }
    async checkGoogle(settings, secrets) {
        const enabled = (pickBool(settings, 'google.enabled') ?? false) &&
            Boolean(pickString(secrets, 'google.apiKey')) &&
            Boolean(pickString(settings, 'google.searchEngineId'));
        if (!enabled) {
            this.setStatus('google', 'not_configured', null, { reason: 'disabled_or_missing' });
            return;
        }
        const apiKey = pickString(secrets, 'google.apiKey');
        const cseId = pickString(settings, 'google.searchEngineId');
        const url = new URL('https://www.googleapis.com/customsearch/v1');
        url.searchParams.set('key', apiKey);
        url.searchParams.set('cx', cseId);
        url.searchParams.set('q', 'immaculaterr');
        url.searchParams.set('num', '1');
        await this.probeHttp('google', url.toString(), {
            headers: { Accept: 'application/json' },
            timeoutMs: 12_000,
        });
    }
    async probeHttp(key, url, params) {
        const st = this.getState(key);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
        const startedAt = Date.now();
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: params.headers,
                signal: controller.signal,
            });
            const ms = Date.now() - startedAt;
            if (res.ok) {
                st.consecutiveFails = 0;
                this.setStatus(key, 'online', null, { ms });
                return;
            }
            const body = await res.text().catch(() => '');
            const msg = `HTTP ${res.status} ${body}`.trim();
            st.consecutiveFails += 1;
            st.lastError = msg;
            if (st.consecutiveFails >= IntegrationsConnectivityMonitorService_1.FAILS_TO_MARK_OFFLINE) {
                this.setStatus(key, 'offline', msg, { ms });
            }
        }
        catch (err) {
            const ms = Date.now() - startedAt;
            const msg = errToMessage(err);
            st.consecutiveFails += 1;
            st.lastError = msg;
            if (st.consecutiveFails >= IntegrationsConnectivityMonitorService_1.FAILS_TO_MARK_OFFLINE) {
                this.setStatus(key, 'offline', msg, { ms });
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
};
exports.IntegrationsConnectivityMonitorService = IntegrationsConnectivityMonitorService;
__decorate([
    (0, schedule_1.Interval)(IntegrationsConnectivityMonitorService.INTERVAL_MS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], IntegrationsConnectivityMonitorService.prototype, "poll", null);
exports.IntegrationsConnectivityMonitorService = IntegrationsConnectivityMonitorService = IntegrationsConnectivityMonitorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService])
], IntegrationsConnectivityMonitorService);
//# sourceMappingURL=integrations-connectivity-monitor.service.js.map