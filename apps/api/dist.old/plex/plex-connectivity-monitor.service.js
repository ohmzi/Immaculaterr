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
var PlexConnectivityMonitorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexConnectivityMonitorService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../db/prisma.service");
const settings_service_1 = require("../settings/settings.service");
const plex_server_service_1 = require("./plex-server.service");
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
function errToMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
let PlexConnectivityMonitorService = class PlexConnectivityMonitorService {
    static { PlexConnectivityMonitorService_1 = this; }
    prisma;
    settingsService;
    plexServer;
    logger = new common_1.Logger(PlexConnectivityMonitorService_1.name);
    status = 'unknown';
    lastError = null;
    lastStatusChangeAtMs = null;
    lastNoisyOfflineLogAtMs = null;
    static INTERVAL_MS = 60_000;
    static OFFLINE_REMINDER_MS = 10 * 60_000;
    constructor(prisma, settingsService, plexServer) {
        this.prisma = prisma;
        this.settingsService = settingsService;
        this.plexServer = plexServer;
    }
    onModuleInit() {
        setTimeout(() => void this.checkOnce(), 8_000);
    }
    async poll() {
        await this.checkOnce();
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
        const baseUrl = pickString(settings, 'plex.baseUrl');
        const token = pickString(secrets, 'plex.token');
        if (!baseUrl || !token) {
            this.setStatus('not_configured', null, {
                reason: !baseUrl && !token ? 'missing_baseUrl_and_token' : !baseUrl ? 'missing_baseUrl' : 'missing_token',
            });
            return;
        }
        const startedAt = Date.now();
        try {
            const machineIdentifier = await this.plexServer.getMachineIdentifier({
                baseUrl,
                token,
            });
            const ms = Date.now() - startedAt;
            this.setStatus('online', null, {
                baseUrl,
                ms,
                machineIdentifier,
            });
        }
        catch (err) {
            const ms = Date.now() - startedAt;
            const msg = errToMessage(err);
            this.setStatus('offline', msg, { baseUrl, ms });
        }
    }
    setStatus(next, error, meta) {
        const now = Date.now();
        const changed = next !== this.status;
        if (changed) {
            this.status = next;
            this.lastError = error;
            this.lastStatusChangeAtMs = now;
            this.lastNoisyOfflineLogAtMs = null;
            if (next === 'online') {
                this.logger.log(`Plex connectivity: ONLINE${meta ? ` ${JSON.stringify(meta)}` : ''}`);
            }
            else if (next === 'offline') {
                this.logger.warn(`Plex connectivity: OFFLINE error=${JSON.stringify(error ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
                this.lastNoisyOfflineLogAtMs = now;
            }
            else if (next === 'not_configured') {
                this.logger.debug(`Plex connectivity: not configured${meta ? ` ${JSON.stringify(meta)}` : ''}`);
            }
            return;
        }
        if (next === 'offline') {
            const last = this.lastNoisyOfflineLogAtMs ?? 0;
            if (now - last >= PlexConnectivityMonitorService_1.OFFLINE_REMINDER_MS) {
                this.logger.warn(`Plex connectivity: still OFFLINE error=${JSON.stringify(error ?? this.lastError ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
                this.lastNoisyOfflineLogAtMs = now;
            }
        }
        this.lastError = error ?? this.lastError;
    }
};
exports.PlexConnectivityMonitorService = PlexConnectivityMonitorService;
__decorate([
    (0, schedule_1.Interval)(PlexConnectivityMonitorService.INTERVAL_MS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PlexConnectivityMonitorService.prototype, "poll", null);
exports.PlexConnectivityMonitorService = PlexConnectivityMonitorService = PlexConnectivityMonitorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService])
], PlexConnectivityMonitorService);
//# sourceMappingURL=plex-connectivity-monitor.service.js.map