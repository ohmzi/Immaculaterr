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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const auth_service_1 = require("../auth/auth.service");
const public_decorator_1 = require("../auth/public.decorator");
const jobs_service_1 = require("../jobs/jobs.service");
const plex_analytics_service_1 = require("../plex/plex-analytics.service");
const plex_library_selection_utils_1 = require("../plex/plex-library-selection.utils");
const plex_users_service_1 = require("../plex/plex-users.service");
const settings_service_1 = require("../settings/settings.service");
const title_normalize_1 = require("../lib/title-normalize");
const webhooks_service_1 = require("./webhooks.service");
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
function pickNumber(obj, path) {
    const v = pick(obj, path);
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim()) {
        const n = Number.parseInt(v.trim(), 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function pickBool(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'boolean' ? v : null;
}
let WebhooksController = class WebhooksController {
    webhooksService;
    jobsService;
    authService;
    settingsService;
    plexUsers;
    plexAnalytics;
    constructor(webhooksService, jobsService, authService, settingsService, plexUsers, plexAnalytics) {
        this.webhooksService = webhooksService;
        this.jobsService = jobsService;
        this.authService = authService;
        this.settingsService = settingsService;
        this.plexUsers = plexUsers;
        this.plexAnalytics = plexAnalytics;
    }
    async plexWebhook(req, body, files) {
        const payloadRaw = body.payload;
        if (typeof payloadRaw !== 'string') {
            throw new common_1.BadRequestException('Expected multipart field "payload"');
        }
        let payload;
        try {
            payload = JSON.parse(payloadRaw);
        }
        catch {
            throw new common_1.BadRequestException('Invalid JSON in "payload" field');
        }
        const payloadObj = isPlainObject(payload) ? payload : null;
        if (payloadObj) {
            const metaRaw = pick(payloadObj, 'Metadata');
            const meta = isPlainObject(metaRaw) ? metaRaw : null;
            if (meta) {
                const fields = [
                    'title',
                    'grandparentTitle',
                    'parentTitle',
                    'originalTitle',
                    'librarySectionTitle',
                ];
                for (const k of fields) {
                    const v = meta[k];
                    if (typeof v === 'string' && v.trim()) {
                        meta[k] = (0, title_normalize_1.normalizeTitleForMatching)(v);
                    }
                }
            }
        }
        const event = {
            receivedAt: new Date().toISOString(),
            payload,
            files: (files ?? []).map((f) => ({
                fieldname: f.fieldname,
                originalname: f.originalname,
                mimetype: f.mimetype,
                size: f.size,
            })),
        };
        const persisted = await this.webhooksService.persistPlexWebhookEvent(event);
        this.webhooksService.logPlexWebhookSummary({
            payload,
            persistedPath: persisted.path,
            receivedAtIso: event.receivedAt,
            files: event.files,
            source: {
                ip: req.ip ?? null,
                userAgent: typeof req.headers['user-agent'] === 'string'
                    ? req.headers['user-agent']
                    : null,
            },
        });
        const plexEvent = payloadObj ? pickString(payloadObj, 'event') : '';
        const mediaType = payloadObj ? pickString(payloadObj, 'Metadata.type') : '';
        const mediaTypeLower = mediaType.toLowerCase();
        if (plexEvent === 'media.scrobble' &&
            (mediaTypeLower === 'movie' || mediaTypeLower === 'episode')) {
            const showTitle = mediaTypeLower === 'episode' && payloadObj
                ? pickString(payloadObj, 'Metadata.grandparentTitle')
                : '';
            const episodeTitle = mediaTypeLower === 'episode' && payloadObj
                ? pickString(payloadObj, 'Metadata.title')
                : '';
            const seedTitle = mediaTypeLower === 'episode' ? showTitle : payloadObj ? pickString(payloadObj, 'Metadata.title') : '';
            const seedRatingKey = payloadObj ? pickString(payloadObj, 'Metadata.ratingKey') : '';
            const showRatingKey = mediaTypeLower === 'episode' && payloadObj
                ? pickString(payloadObj, 'Metadata.grandparentRatingKey')
                : '';
            const seasonNumber = mediaTypeLower === 'episode' && payloadObj
                ? pickNumber(payloadObj, 'Metadata.parentIndex')
                : null;
            const episodeNumber = mediaTypeLower === 'episode' && payloadObj
                ? pickNumber(payloadObj, 'Metadata.index')
                : null;
            const seedYear = mediaTypeLower === 'movie' && payloadObj
                ? pickNumber(payloadObj, 'Metadata.year')
                : null;
            const seedLibrarySectionId = payloadObj
                ? pickNumber(payloadObj, 'Metadata.librarySectionID')
                : null;
            const seedLibrarySectionTitle = payloadObj
                ? pickString(payloadObj, 'Metadata.librarySectionTitle')
                : '';
            const plexAccountId = payloadObj ? pickNumber(payloadObj, 'Account.id') : null;
            const plexAccountTitle = payloadObj ? pickString(payloadObj, 'Account.title') : '';
            if (seedTitle) {
                const userId = await this.authService.getFirstAdminUserId();
                if (userId) {
                    try {
                        const plexUser = await this.plexUsers.resolvePlexUser({
                            plexAccountId,
                            plexAccountTitle,
                            userId,
                        });
                        const plexUserId = plexUser.id;
                        const plexUserTitle = plexUser.plexAccountTitle;
                        const payloadInput = {
                            source: 'plexWebhook',
                            plexEvent,
                            plexUserId,
                            plexUserTitle,
                            plexAccountId,
                            plexAccountTitle: plexAccountTitle || null,
                            mediaType: mediaTypeLower,
                            seedTitle,
                            seedYear: seedYear ?? null,
                            seedRatingKey: seedRatingKey || null,
                            seedLibrarySectionId: seedLibrarySectionId ?? null,
                            seedLibrarySectionTitle: seedLibrarySectionTitle || null,
                            ...(mediaTypeLower === 'episode'
                                ? {
                                    showTitle: showTitle || null,
                                    showRatingKey: showRatingKey || null,
                                    seasonNumber: seasonNumber ?? null,
                                    episodeNumber: episodeNumber ?? null,
                                    episodeTitle: episodeTitle || null,
                                }
                                : {}),
                            persistedPath: persisted.path,
                        };
                        const runs = {};
                        const errors = {};
                        const skipped = {};
                        const { settings } = await this.settingsService
                            .getInternalSettings(userId)
                            .catch(() => ({
                            settings: {},
                            secrets: {},
                        }));
                        const watchedEnabled = pickBool(settings, 'jobs.webhookEnabled.watchedMovieRecommendations') ?? false;
                        const immaculateEnabled = pickBool(settings, 'jobs.webhookEnabled.immaculateTastePoints') ??
                            false;
                        const seedLibrarySectionKey = seedLibrarySectionId !== null
                            ? String(Math.trunc(seedLibrarySectionId))
                            : '';
                        const seedLibraryExcluded = seedLibrarySectionKey &&
                            (0, plex_library_selection_utils_1.isPlexLibrarySectionExcluded)({
                                settings,
                                sectionKey: seedLibrarySectionKey,
                            });
                        skipped.watchedMovieRecommendations = watchedEnabled
                            ? 'polling_only'
                            : 'disabled';
                        if (!immaculateEnabled) {
                            skipped.immaculateTastePoints = 'disabled';
                        }
                        else if (seedLibraryExcluded) {
                            skipped.immaculateTastePoints = 'library_excluded';
                        }
                        else {
                            try {
                                const run = await this.jobsService.runJob({
                                    jobId: 'immaculateTastePoints',
                                    trigger: 'auto',
                                    dryRun: false,
                                    userId,
                                    input: payloadInput,
                                });
                                runs.immaculateTastePoints = run.id;
                            }
                            catch (err) {
                                errors.immaculateTastePoints =
                                    err?.message ?? String(err);
                            }
                        }
                        const triggered = Object.keys(runs).length > 0;
                        this.webhooksService.logPlexWebhookAutomation({
                            plexEvent,
                            mediaType,
                            seedTitle,
                            plexUserId,
                            plexUserTitle,
                            runs,
                            ...(Object.keys(skipped).length ? { skipped } : {}),
                            ...(Object.keys(errors).length ? { errors } : {}),
                        });
                        return {
                            ok: true,
                            ...persisted,
                            triggered,
                            runs,
                            ...(Object.keys(skipped).length ? { skipped } : {}),
                            ...(Object.keys(errors).length ? { errors } : {}),
                        };
                    }
                    catch (err) {
                        const msg = err?.message ?? String(err);
                        this.webhooksService.logPlexWebhookAutomation({
                            plexEvent,
                            mediaType,
                            seedTitle,
                            errors: { webhook: msg },
                        });
                        return { ok: true, ...persisted, triggered: false, error: msg };
                    }
                }
            }
        }
        if (plexEvent === 'library.new' &&
            ['movie', 'show', 'season', 'episode'].includes(mediaType.toLowerCase())) {
            const title = payloadObj ? pickString(payloadObj, 'Metadata.title') : '';
            const ratingKey = payloadObj
                ? pickString(payloadObj, 'Metadata.ratingKey')
                : '';
            const year = payloadObj ? pickNumber(payloadObj, 'Metadata.year') : null;
            const grandparentTitle = payloadObj
                ? pickString(payloadObj, 'Metadata.grandparentTitle')
                : '';
            const grandparentRatingKey = payloadObj
                ? pickString(payloadObj, 'Metadata.grandparentRatingKey')
                : '';
            const parentIndex = payloadObj
                ? pickNumber(payloadObj, 'Metadata.parentIndex')
                : null;
            const index = payloadObj
                ? pickNumber(payloadObj, 'Metadata.index')
                : null;
            const userId = await this.authService.getFirstAdminUserId();
            if (userId) {
                this.plexAnalytics.invalidateLibraryGrowth(userId);
                const { settings } = await this.settingsService
                    .getInternalSettings(userId)
                    .catch(() => ({
                    settings: {},
                    secrets: {},
                }));
                const enabled = pickBool(settings, 'jobs.webhookEnabled.mediaAddedCleanup') ?? false;
                if (!enabled) {
                    this.webhooksService.logPlexWebhookAutomation({
                        plexEvent,
                        mediaType,
                        seedTitle: title || undefined,
                        skipped: { mediaAddedCleanup: 'disabled' },
                    });
                    return {
                        ok: true,
                        ...persisted,
                        triggered: false,
                        skipped: { mediaAddedCleanup: 'disabled' },
                    };
                }
                try {
                    const input = {
                        source: 'plexWebhook',
                        plexEvent,
                        mediaType: mediaType.toLowerCase(),
                        title,
                        year: year ?? null,
                        ratingKey: ratingKey || null,
                        showTitle: grandparentTitle || null,
                        showRatingKey: grandparentRatingKey || null,
                        seasonNumber: parentIndex ?? null,
                        episodeNumber: index ?? null,
                        persistedPath: persisted.path,
                    };
                    const run = await this.jobsService.runJob({
                        jobId: 'mediaAddedCleanup',
                        trigger: 'auto',
                        dryRun: false,
                        userId,
                        input,
                    });
                    this.webhooksService.logPlexWebhookAutomation({
                        plexEvent,
                        mediaType,
                        seedTitle: title || undefined,
                        runs: { mediaAddedCleanup: run.id },
                    });
                    return {
                        ok: true,
                        ...persisted,
                        triggered: true,
                        runs: { mediaAddedCleanup: run.id },
                    };
                }
                catch (err) {
                    const msg = err?.message ?? String(err);
                    this.webhooksService.logPlexWebhookAutomation({
                        plexEvent,
                        mediaType,
                        seedTitle: title || undefined,
                        errors: { mediaAddedCleanup: msg },
                    });
                    return { ok: true, ...persisted, triggered: false, error: msg };
                }
            }
        }
        return { ok: true, ...persisted, triggered: false };
    }
};
exports.WebhooksController = WebhooksController;
__decorate([
    (0, common_1.Post)('plex'),
    (0, public_decorator_1.Public)(),
    (0, common_1.UseInterceptors)((0, platform_express_1.AnyFilesInterceptor)({
        limits: {
            fileSize: 5 * 1024 * 1024,
        },
    })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Array]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "plexWebhook", null);
exports.WebhooksController = WebhooksController = __decorate([
    (0, common_1.Controller)('webhooks'),
    __metadata("design:paramtypes", [webhooks_service_1.WebhooksService,
        jobs_service_1.JobsService,
        auth_service_1.AuthService,
        settings_service_1.SettingsService,
        plex_users_service_1.PlexUsersService,
        plex_analytics_service_1.PlexAnalyticsService])
], WebhooksController);
//# sourceMappingURL=webhooks.controller.js.map