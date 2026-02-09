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
var PlexActivitiesMonitorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexActivitiesMonitorService = void 0;
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
let PlexActivitiesMonitorService = class PlexActivitiesMonitorService {
    static { PlexActivitiesMonitorService_1 = this; }
    prisma;
    settingsService;
    plexServer;
    logger = new common_1.Logger(PlexActivitiesMonitorService_1.name);
    status = 'unknown';
    lastError = null;
    lastNoisyErrorLogAtMs = null;
    lastByUuid = new Map();
    static INTERVAL_MS = 5_000;
    static ERROR_REMINDER_MS = 10 * 60_000;
    onModuleInit() {
        setTimeout(() => void this.checkOnce(), 12_000);
    }
    constructor(prisma, settingsService, plexServer) {
        this.prisma = prisma;
        this.settingsService = settingsService;
        this.plexServer = plexServer;
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
            const activities = await this.plexServer.listActivities({ baseUrl, token });
            const ms = Date.now() - startedAt;
            this.setStatus('ok', null, { ms, count: activities.length });
            this.diffAndLog(activities);
        }
        catch (err) {
            const ms = Date.now() - startedAt;
            const msg = errToMessage(err);
            this.setStatus('error', msg, { ms });
        }
    }
    setStatus(next, error, meta) {
        const now = Date.now();
        const changed = next !== this.status;
        if (changed) {
            this.status = next;
            this.lastError = error;
            this.lastNoisyErrorLogAtMs = null;
            if (next === 'error') {
                this.logger.warn(`Plex activities polling: FAILED error=${JSON.stringify(error ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
                this.lastNoisyErrorLogAtMs = now;
            }
            else if (next === 'not_configured') {
                this.logger.debug(`Plex activities polling: not configured${meta ? ` ${JSON.stringify(meta)}` : ''}`);
            }
            return;
        }
        if (next === 'error') {
            const last = this.lastNoisyErrorLogAtMs ?? 0;
            if (now - last >= PlexActivitiesMonitorService_1.ERROR_REMINDER_MS) {
                this.logger.warn(`Plex activities polling: still FAILING error=${JSON.stringify(error ?? this.lastError ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
                this.lastNoisyErrorLogAtMs = now;
            }
        }
        this.lastError = error ?? this.lastError;
    }
    diffAndLog(next) {
        const now = Date.now();
        const nextUuids = new Set(next.map((a) => a.uuid));
        for (const [uuid, prev] of this.lastByUuid) {
            if (!nextUuids.has(uuid)) {
                this.logger.debug({
                    NotificationContainer: {
                        type: 'activity',
                        size: 1,
                        ActivityNotification: [
                            {
                                event: 'removed',
                                uuid,
                                Activity: {
                                    uuid,
                                    type: prev.type,
                                    cancellable: prev.cancellable,
                                    userID: prev.userId,
                                    title: prev.title,
                                    subtitle: prev.subtitle,
                                    progress: prev.progress,
                                    ...(prev.librarySectionId
                                        ? { Context: { librarySectionID: prev.librarySectionId } }
                                        : {}),
                                },
                            },
                        ],
                    },
                });
                this.lastByUuid.delete(uuid);
            }
        }
        for (const act of next) {
            const prev = this.lastByUuid.get(act.uuid) ?? null;
            if (!prev) {
                this.logger.debug({
                    NotificationContainer: {
                        type: 'activity',
                        size: 1,
                        ActivityNotification: [
                            {
                                event: 'added',
                                uuid: act.uuid,
                                Activity: {
                                    uuid: act.uuid,
                                    type: act.type,
                                    cancellable: act.cancellable,
                                    userID: act.userId,
                                    title: act.title,
                                    subtitle: act.subtitle,
                                    progress: act.progress,
                                    ...(act.librarySectionId
                                        ? { Context: { librarySectionID: act.librarySectionId } }
                                        : {}),
                                },
                            },
                        ],
                    },
                });
                this.logProgressIfUseful({ act, when: 'start' });
                this.lastByUuid.set(act.uuid, {
                    ...act,
                    lastLoggedAtMs: now,
                    lastLoggedProgress: act.progress ?? null,
                    lastLoggedSubtitle: act.subtitle ?? null,
                });
                continue;
            }
            const progressChanged = act.progress !== null &&
                (prev.lastLoggedProgress === null ||
                    Math.abs(act.progress - prev.lastLoggedProgress) >= 1);
            const subtitleChanged = (act.subtitle ?? null) !== (prev.lastLoggedSubtitle ?? null);
            const otherChanged = act.type !== prev.type ||
                act.title !== prev.title ||
                act.librarySectionId !== prev.librarySectionId;
            if (progressChanged || subtitleChanged || otherChanged) {
                this.logger.debug({
                    NotificationContainer: {
                        type: 'activity',
                        size: 1,
                        ActivityNotification: [
                            {
                                event: 'updated',
                                uuid: act.uuid,
                                Activity: {
                                    uuid: act.uuid,
                                    type: act.type,
                                    cancellable: act.cancellable,
                                    userID: act.userId,
                                    title: act.title,
                                    subtitle: act.subtitle,
                                    progress: act.progress,
                                    ...(act.librarySectionId
                                        ? { Context: { librarySectionID: act.librarySectionId } }
                                        : {}),
                                },
                            },
                        ],
                    },
                });
                this.logProgressIfUseful({ act, when: subtitleChanged ? 'subtitle' : 'progress' });
                this.lastByUuid.set(act.uuid, {
                    ...act,
                    lastLoggedAtMs: now,
                    lastLoggedProgress: act.progress ?? prev.lastLoggedProgress ?? null,
                    lastLoggedSubtitle: act.subtitle ?? prev.lastLoggedSubtitle ?? null,
                });
            }
            else {
                this.lastByUuid.set(act.uuid, { ...prev, ...act });
            }
        }
    }
    logProgressIfUseful(params) {
        const { act, when } = params;
        if (when === 'progress')
            return;
        const raw = (act.subtitle ?? act.title ?? '').trim();
        if (!raw)
            return;
        const message = /^scanning\b/i.test(raw) ? raw : `Scanning ${raw}`;
        this.logger.debug({
            NotificationContainer: {
                type: 'progress',
                size: 1,
                ProgressNotification: [{ message }],
            },
        });
    }
};
exports.PlexActivitiesMonitorService = PlexActivitiesMonitorService;
__decorate([
    (0, schedule_1.Interval)(PlexActivitiesMonitorService.INTERVAL_MS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PlexActivitiesMonitorService.prototype, "poll", null);
exports.PlexActivitiesMonitorService = PlexActivitiesMonitorService = PlexActivitiesMonitorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService])
], PlexActivitiesMonitorService);
//# sourceMappingURL=plex-activities-monitor.service.js.map