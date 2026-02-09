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
var PlexPollingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexPollingService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const auth_service_1 = require("../auth/auth.service");
const jobs_service_1 = require("../jobs/jobs.service");
const plex_analytics_service_1 = require("../plex/plex-analytics.service");
const plex_library_selection_utils_1 = require("../plex/plex-library-selection.utils");
const plex_server_service_1 = require("../plex/plex-server.service");
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
function pickBool(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'boolean' ? v : null;
}
function parseBoolEnv(raw, defaultValue) {
    const v = raw?.trim().toLowerCase();
    if (!v)
        return defaultValue;
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on')
        return true;
    if (v === '0' || v === 'false' || v === 'no' || v === 'off')
        return false;
    return defaultValue;
}
function parseNumberEnv(raw, defaultValue) {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : defaultValue;
}
function parseFloatEnv(raw, defaultValue) {
    const n = Number.parseFloat(raw ?? '');
    return Number.isFinite(n) && n > 0 ? n : defaultValue;
}
let PlexPollingService = class PlexPollingService {
    static { PlexPollingService_1 = this; }
    authService;
    settingsService;
    jobsService;
    plexServer;
    plexUsers;
    webhooksService;
    plexAnalytics;
    logger = new common_1.Logger(PlexPollingService_1.name);
    enabled = parseBoolEnv(process.env.PLEX_POLLING_ENABLED, true);
    intervalMs = parseNumberEnv(process.env.PLEX_POLLING_INTERVAL_MS, 5_000);
    watchedScrobbleThreshold = (() => {
        const v = parseFloatEnv(process.env.PLEX_POLLING_WATCHED_THRESHOLD, 0.6);
        return v > 1 ? v / 100 : v;
    })();
    immaculateScrobbleThreshold = (() => {
        const v = parseFloatEnv(process.env.PLEX_POLLING_IMMACULATE_THRESHOLD ??
            process.env.PLEX_POLLING_SCROBBLE_THRESHOLD, 0.7);
        return v > 1 ? v / 100 : v;
    })();
    forceBothScrobbleThreshold = (() => {
        const v = parseFloatEnv(process.env.PLEX_POLLING_FORCE_BOTH_THRESHOLD, 0.9);
        const normalized = v > 1 ? v / 100 : v;
        return Math.min(1, Math.max(0, normalized));
    })();
    minDurationMs = parseNumberEnv(process.env.PLEX_POLLING_MIN_DURATION_MS, 60_000);
    nowPlayingLogIntervalMs = parseNumberEnv(process.env.PLEX_POLLING_NOW_PLAYING_LOG_INTERVAL_MS, 30_000);
    nowPlayingLogProgressStepMs = parseNumberEnv(process.env.PLEX_POLLING_NOW_PLAYING_PROGRESS_STEP_MS, 60_000);
    recentlyAddedIntervalMs = parseNumberEnv(process.env.PLEX_POLLING_RECENTLY_ADDED_INTERVAL_MS, 60_000);
    libraryNewDebounceMs = parseNumberEnv(process.env.PLEX_POLLING_LIBRARY_NEW_DEBOUNCE_MS, 120_000);
    lastBySessionKey = new Map();
    static SESSION_AUTOMATION_STATE_TTL_MS = 12 * 60 * 60_000;
    static MAX_COLLECTION_JOB_ATTEMPTS = 3;
    sessionAutomationStateById = new Map();
    nowPlayingLogStateBySessionKey = new Map();
    static COLLECTION_COOLDOWN_MS = 10 * 60_000;
    collectionCooldownUntilByPlexUser = new Map();
    pendingCollectionRunsByPlexUser = new Map();
    lastRecentlyAddedPollAtMs = null;
    lastSeenAddedAtSec = null;
    lastLibraryNewTriggeredAtMs = null;
    pendingLibraryNew = null;
    constructor(authService, settingsService, jobsService, plexServer, plexUsers, webhooksService, plexAnalytics) {
        this.authService = authService;
        this.settingsService = settingsService;
        this.jobsService = jobsService;
        this.plexServer = plexServer;
        this.plexUsers = plexUsers;
        this.webhooksService = webhooksService;
        this.plexAnalytics = plexAnalytics;
    }
    onModuleInit() {
        this.logger.log(`Plex polling ${this.enabled ? 'ENABLED' : 'disabled'} intervalMs=${this.intervalMs} watchedThreshold=${this.watchedScrobbleThreshold} immaculateThreshold=${this.immaculateScrobbleThreshold} forceBothThreshold=${this.forceBothScrobbleThreshold} minDurationMs=${this.minDurationMs}`);
        setTimeout(() => void this.pollOnce(), 15_000);
    }
    async poll() {
        await this.pollOnce();
    }
    lastPolledAtMs = null;
    setCollectionCooldown(params) {
        this.collectionCooldownUntilByPlexUser.set(params.plexUserId, params.nowMs + PlexPollingService_1.COLLECTION_COOLDOWN_MS);
    }
    buildSessionAutomationId(params) {
        return `${params.plexUserId}:${params.mediaType}:${params.ratingKey}:${params.sessionKey}`;
    }
    getOrCreateSessionAutomationState(params) {
        const existing = this.sessionAutomationStateById.get(params.sessionAutomationId);
        if (existing) {
            existing.lastSeenAtMs = params.nowMs;
            existing.maxProgressRatio = Math.max(existing.maxProgressRatio, params.progressRatio);
            if (!existing.seedTitle && params.seedTitle)
                existing.seedTitle = params.seedTitle;
            return existing;
        }
        const created = {
            sessionAutomationId: params.sessionAutomationId,
            sessionKey: params.sessionKey,
            plexUserId: params.plexUserId,
            plexUserTitle: params.plexUserTitle,
            mediaType: params.mediaType,
            ratingKey: params.ratingKey,
            seedTitle: params.seedTitle,
            createdAtMs: params.nowMs,
            lastSeenAtMs: params.nowMs,
            maxProgressRatio: params.progressRatio,
            jobs: {
                watchedMovieRecommendations: 'idle',
                immaculateTastePoints: 'idle',
            },
        };
        this.sessionAutomationStateById.set(params.sessionAutomationId, created);
        return created;
    }
    getSessionJobStatus(sessionAutomationId, jobId) {
        const state = this.sessionAutomationStateById.get(sessionAutomationId);
        if (!state)
            return 'idle';
        return state.jobs[jobId];
    }
    setSessionJobStatus(sessionAutomationId, jobId, status, nowMs) {
        const state = this.sessionAutomationStateById.get(sessionAutomationId);
        if (!state)
            return;
        state.jobs[jobId] = status;
        state.lastSeenAtMs = nowMs;
    }
    canScheduleSessionJob(sessionAutomationId, jobId) {
        const status = this.getSessionJobStatus(sessionAutomationId, jobId);
        return status !== 'queued' && status !== 'running' && status !== 'success';
    }
    pruneSessionAutomationState(nowMs) {
        for (const [id, state] of this.sessionAutomationStateById) {
            const ageMs = nowMs - state.lastSeenAtMs;
            if (ageMs < PlexPollingService_1.SESSION_AUTOMATION_STATE_TTL_MS)
                continue;
            const hasInFlight = state.jobs.watchedMovieRecommendations === 'queued' ||
                state.jobs.watchedMovieRecommendations === 'running' ||
                state.jobs.immaculateTastePoints === 'queued' ||
                state.jobs.immaculateTastePoints === 'running';
            if (hasInFlight)
                continue;
            this.sessionAutomationStateById.delete(id);
        }
    }
    enqueueCollectionRun(params) {
        const queue = this.pendingCollectionRunsByPlexUser.get(params.plexUserId) ?? [];
        const exists = queue.some((run) => run.jobId === params.jobId &&
            run.sessionAutomationId === params.sessionAutomationId);
        if (exists)
            return false;
        queue.push(params);
        queue.sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
        this.pendingCollectionRunsByPlexUser.set(params.plexUserId, queue);
        this.setSessionJobStatus(params.sessionAutomationId, params.jobId, 'queued', params.enqueuedAtMs);
        return true;
    }
    dequeueNextPendingCollectionRun(params) {
        const queue = this.pendingCollectionRunsByPlexUser.get(params.plexUserId) ?? [];
        if (!queue.length) {
            this.pendingCollectionRunsByPlexUser.delete(params.plexUserId);
            return null;
        }
        while (queue.length) {
            const run = queue.shift();
            const state = this.getSessionJobStatus(run.sessionAutomationId, run.jobId);
            if (state === 'success' || state === 'running')
                continue;
            if (!queue.length)
                this.pendingCollectionRunsByPlexUser.delete(params.plexUserId);
            else
                this.pendingCollectionRunsByPlexUser.set(params.plexUserId, queue);
            return run;
        }
        this.pendingCollectionRunsByPlexUser.delete(params.plexUserId);
        return null;
    }
    async runCollectionJobNow(params) {
        this.setSessionJobStatus(params.sessionAutomationId, params.jobId, 'running', params.nowMs);
        try {
            const run = await this.jobsService.runJob({
                jobId: params.jobId,
                trigger: 'auto',
                dryRun: false,
                userId: params.adminUserId,
                input: params.input,
            });
            this.setSessionJobStatus(params.sessionAutomationId, params.jobId, 'success', Date.now());
            return { runId: run.id, error: null };
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            this.setSessionJobStatus(params.sessionAutomationId, params.jobId, 'failed', Date.now());
            return { runId: null, error: msg };
        }
    }
    async flushPendingCollectionRuns(params) {
        const now = Date.now();
        const cooldownUntil = this.collectionCooldownUntilByPlexUser.get(params.plexUserId) ?? 0;
        if (now < cooldownUntil)
            return;
        const pending = this.dequeueNextPendingCollectionRun({
            plexUserId: params.plexUserId,
        });
        if (!pending)
            return;
        const watchedEnabled = pickBool(params.settings, 'jobs.webhookEnabled.watchedMovieRecommendations') ??
            false;
        const immaculateEnabled = pickBool(params.settings, 'jobs.webhookEnabled.immaculateTastePoints') ?? false;
        const enabled = pending.jobId === 'watchedMovieRecommendations'
            ? watchedEnabled
            : immaculateEnabled;
        if (!enabled) {
            this.setSessionJobStatus(pending.sessionAutomationId, pending.jobId, 'failed', now);
            this.webhooksService.logPlexWebhookAutomation({
                plexEvent: 'plexPolling.cooldown',
                mediaType: pending.mediaType,
                seedTitle: pending.seedTitle,
                plexUserId: pending.plexUserId,
                plexUserTitle: pending.plexUserTitle,
                skipped: { [pending.jobId]: 'cooldown_pending_dropped_disabled' },
            });
            return;
        }
        this.setCollectionCooldown({ plexUserId: pending.plexUserId, nowMs: now });
        const result = await this.runCollectionJobNow({
            jobId: pending.jobId,
            adminUserId: pending.adminUserId,
            input: pending.input,
            sessionAutomationId: pending.sessionAutomationId,
            nowMs: now,
        });
        if (result.runId) {
            this.webhooksService.logPlexWebhookAutomation({
                plexEvent: 'plexPolling.cooldown',
                mediaType: pending.mediaType,
                seedTitle: pending.seedTitle,
                plexUserId: pending.plexUserId,
                plexUserTitle: pending.plexUserTitle,
                runs: { [pending.jobId]: result.runId },
            });
            return;
        }
        const errors = {};
        errors[pending.jobId] = result.error ?? 'unknown_error';
        const skipped = {};
        if (pending.attempt < PlexPollingService_1.MAX_COLLECTION_JOB_ATTEMPTS) {
            const nextAttempt = pending.attempt + 1;
            const queued = this.enqueueCollectionRun({
                ...pending,
                enqueuedAtMs: Date.now(),
                attempt: nextAttempt,
            });
            if (queued) {
                skipped[pending.jobId] = `retry_queued_attempt_${nextAttempt}`;
            }
        }
        this.webhooksService.logPlexWebhookAutomation({
            plexEvent: 'plexPolling.cooldown',
            mediaType: pending.mediaType,
            seedTitle: pending.seedTitle,
            plexUserId: pending.plexUserId,
            plexUserTitle: pending.plexUserTitle,
            ...(Object.keys(skipped).length ? { skipped } : {}),
            errors,
        });
    }
    async pollOnce() {
        if (!this.enabled)
            return;
        const now = Date.now();
        const last = this.lastPolledAtMs ?? 0;
        if (this.lastPolledAtMs !== null && now - last < this.intervalMs)
            return;
        this.lastPolledAtMs = now;
        const userId = await this.authService.getFirstAdminUserId();
        if (!userId)
            return;
        const { settings, secrets } = await this.settingsService
            .getInternalSettings(userId)
            .catch(() => ({ settings: {}, secrets: {} }));
        const pendingPlexUsers = Array.from(this.pendingCollectionRunsByPlexUser.keys());
        for (const plexUserId of pendingPlexUsers) {
            await this.flushPendingCollectionRuns({
                plexUserId,
                settings: settings,
            });
        }
        const baseUrl = pickString(settings, 'plex.baseUrl');
        const token = pickString(secrets, 'plex.token');
        if (!baseUrl || !token)
            return;
        await this.pollRecentlyAdded({
            userId,
            baseUrl,
            token,
            settings: settings,
        });
        let sessions = [];
        try {
            sessions = await this.plexServer.listNowPlayingSessions({ baseUrl, token });
        }
        catch (err) {
            this.logger.debug(`Polling /status/sessions failed: ${err?.message ?? String(err)}`);
            return;
        }
        const currentKeys = new Set(sessions.map((s) => s.sessionKey));
        for (const [key, prev] of this.lastBySessionKey) {
            const current = sessions.find((s) => s.sessionKey === key) ?? null;
            if (!current) {
                this.logNowPlayingEnded(prev, now);
                await this.handleEndedSession({
                    userId,
                    prev,
                    settings: settings,
                });
                this.lastBySessionKey.delete(key);
                this.nowPlayingLogStateBySessionKey.delete(key);
                continue;
            }
            const prevRatingKey = prev.ratingKey ?? '';
            const curRatingKey = current.ratingKey ?? '';
            if (prevRatingKey && curRatingKey && prevRatingKey !== curRatingKey) {
                this.logNowPlayingEnded(prev, now);
                await this.handleEndedSession({
                    userId,
                    prev,
                    settings: settings,
                });
                const nextSnap = this.toSnapshot(current, now);
                const nextWithTrigger = await this.maybeTriggerWatchedAutomation({
                    userId,
                    snap: nextSnap,
                    settings: settings,
                    reason: 'progress',
                });
                this.lastBySessionKey.set(key, nextWithTrigger);
                this.logNowPlayingStarted(nextWithTrigger, now);
            }
            else {
                const merged = this.mergeSnapshot(prev, current, now);
                const mergedWithTrigger = await this.maybeTriggerWatchedAutomation({
                    userId,
                    snap: merged,
                    settings: settings,
                    reason: 'progress',
                });
                this.lastBySessionKey.set(key, mergedWithTrigger);
                this.logNowPlayingProgress(mergedWithTrigger, now);
            }
        }
        for (const s of sessions) {
            if (!this.lastBySessionKey.has(s.sessionKey)) {
                const snap = this.toSnapshot(s, now);
                const snapWithTrigger = await this.maybeTriggerWatchedAutomation({
                    userId,
                    snap,
                    settings: settings,
                    reason: 'progress',
                });
                this.lastBySessionKey.set(s.sessionKey, snapWithTrigger);
                this.logNowPlayingStarted(snapWithTrigger, now);
            }
        }
        this.pruneSessionAutomationState(now);
        void currentKeys;
    }
    async pollRecentlyAdded(params) {
        const { userId, baseUrl, token, settings } = params;
        const enabled = pickBool(settings, 'jobs.webhookEnabled.mediaAddedCleanup') ?? false;
        if (!enabled)
            return;
        const now = Date.now();
        const last = this.lastRecentlyAddedPollAtMs ?? 0;
        if (this.lastRecentlyAddedPollAtMs !== null && now - last < this.recentlyAddedIntervalMs) {
            return;
        }
        this.lastRecentlyAddedPollAtMs = now;
        let items = [];
        try {
            items = await this.plexServer.listRecentlyAdded({ baseUrl, token, take: 200 });
        }
        catch (err) {
            this.logger.debug(`Polling /library/recentlyAdded failed: ${err?.message ?? String(err)}`);
            return;
        }
        const nowSec = Math.floor(now / 1000);
        const MAX_FUTURE_SKEW_SEC = 24 * 60 * 60;
        const safePlexTimestampSec = (tsSec) => {
            if (tsSec === null)
                return null;
            if (!Number.isFinite(tsSec))
                return null;
            const n = Math.trunc(tsSec);
            if (n <= 0)
                return null;
            if (n > nowSec + MAX_FUTURE_SKEW_SEC)
                return null;
            return n;
        };
        const itemTimestampSec = (it) => {
            const a = safePlexTimestampSec(it.addedAt);
            if (a !== null)
                return a;
            return safePlexTimestampSec(it.updatedAt);
        };
        const invalidFutureCount = items.reduce((acc, it) => {
            const raw = it.addedAt;
            if (raw === null)
                return acc;
            if (!Number.isFinite(raw))
                return acc;
            return Math.trunc(raw) > nowSec + MAX_FUTURE_SKEW_SEC ? acc + 1 : acc;
        }, 0);
        if (invalidFutureCount > 0) {
            this.logger.debug(`Plex recentlyAdded: ${invalidFutureCount} item(s) had invalid future addedAt; using updatedAt fallback`);
        }
        const maxAddedAt = items.reduce((max, it) => Math.max(max, itemTimestampSec(it) ?? 0), 0) || 0;
        if (!maxAddedAt)
            return;
        if (this.lastSeenAddedAtSec !== null &&
            this.lastSeenAddedAtSec > nowSec + MAX_FUTURE_SKEW_SEC) {
            this.logger.warn(`Plex recentlyAdded watermark was in the future (lastSeenAddedAtSec=${this.lastSeenAddedAtSec}); resetting to ${maxAddedAt}`);
            this.lastSeenAddedAtSec = maxAddedAt;
        }
        if (this.lastSeenAddedAtSec === null) {
            this.lastSeenAddedAtSec = maxAddedAt;
            return;
        }
        const since = this.lastSeenAddedAtSec;
        const newItems = items.filter((it) => (itemTimestampSec(it) ?? 0) > since);
        this.lastSeenAddedAtSec = Math.max(this.lastSeenAddedAtSec, maxAddedAt);
        const canRunNow = this.lastLibraryNewTriggeredAtMs === null ||
            now - this.lastLibraryNewTriggeredAtMs >= this.libraryNewDebounceMs;
        const pickNewer = (a, b) => (itemTimestampSec(b) ?? 0) > (itemTimestampSec(a) ?? 0) ? b : a;
        if (newItems.length > 0 && !canRunNow) {
            const newest = newItems.reduce((best, it) => pickNewer(best, it), newItems[0]);
            if (!this.pendingLibraryNew) {
                this.pendingLibraryNew = { newest, newlyAddedCount: newItems.length, sinceSec: since };
            }
            else {
                this.pendingLibraryNew = {
                    newest: pickNewer(this.pendingLibraryNew.newest, newest),
                    newlyAddedCount: Math.max(this.pendingLibraryNew.newlyAddedCount, newItems.length),
                    sinceSec: this.pendingLibraryNew.sinceSec,
                };
            }
            return;
        }
        if (newItems.length === 0) {
            if (!canRunNow || !this.pendingLibraryNew)
                return;
        }
        const newest = (() => {
            const newestFromPoll = newItems.length > 0
                ? newItems.reduce((best, it) => pickNewer(best, it), newItems[0])
                : null;
            if (newestFromPoll && this.pendingLibraryNew) {
                return pickNewer(this.pendingLibraryNew.newest, newestFromPoll);
            }
            return newestFromPoll ?? this.pendingLibraryNew.newest;
        })();
        const newlyAddedCount = newItems.length > 0
            ? Math.max(newItems.length, this.pendingLibraryNew?.newlyAddedCount ?? 0)
            : (this.pendingLibraryNew?.newlyAddedCount ?? 1);
        const windowSinceSec = newItems.length > 0
            ? (this.pendingLibraryNew?.sinceSec ?? since)
            : this.pendingLibraryNew.sinceSec;
        this.pendingLibraryNew = null;
        this.lastLibraryNewTriggeredAtMs = now;
        const mediaTypeRaw = (newest.type ?? '').toLowerCase();
        if (!['movie', 'show', 'season', 'episode'].includes(mediaTypeRaw))
            return;
        const librarySectionKey = typeof newest.librarySectionId === 'number' && Number.isFinite(newest.librarySectionId)
            ? String(Math.trunc(newest.librarySectionId))
            : null;
        const derivedTv = await (async () => {
            if (!librarySectionKey)
                return null;
            if (mediaTypeRaw === 'movie')
                return null;
            let sectionItems = [];
            try {
                sectionItems = await this.plexServer.listRecentlyAddedForSectionKey({
                    baseUrl,
                    token,
                    librarySectionKey,
                    take: 200,
                });
            }
            catch (err) {
                this.logger.debug(`Polling /library/sections/${librarySectionKey}/recentlyAdded failed: ${err?.message ?? String(err)}`);
                return null;
            }
            const episodeItems = sectionItems.filter((it) => (it.type ?? '').toLowerCase() === 'episode');
            const newEpisodes = episodeItems.filter((it) => (itemTimestampSec(it) ?? 0) > windowSinceSec);
            if (newEpisodes.length === 0)
                return null;
            const newestEpisode = newEpisodes.reduce((best, it) => pickNewer(best, it), newEpisodes[0]);
            const showRatingKey = newestEpisode.grandparentRatingKey ?? newestEpisode.parentRatingKey ?? null;
            const showTitle = newestEpisode.grandparentTitle ?? newestEpisode.parentTitle ?? null;
            const belongsToSameShow = (it) => {
                const rk = it.grandparentRatingKey ?? it.parentRatingKey ?? null;
                if (showRatingKey && rk)
                    return rk === showRatingKey;
                const t = (it.grandparentTitle ?? it.parentTitle ?? '').trim().toLowerCase();
                return showTitle ? t === showTitle.trim().toLowerCase() : false;
            };
            const episodesForShow = newEpisodes.filter(belongsToSameShow);
            const seasons = new Set();
            for (const it of episodesForShow) {
                const s = typeof it.parentIndex === 'number' && Number.isFinite(it.parentIndex)
                    ? Math.trunc(it.parentIndex)
                    : null;
                if (s && s > 0)
                    seasons.add(s);
            }
            if (episodesForShow.length === 1) {
                const s = newestEpisode.parentIndex ?? null;
                const e = newestEpisode.index ?? null;
                return {
                    mediaType: 'episode',
                    title: newestEpisode.title ?? '',
                    ratingKey: newestEpisode.ratingKey,
                    showTitle,
                    showRatingKey,
                    seasonNumber: typeof s === 'number' && Number.isFinite(s) ? Math.trunc(s) : null,
                    episodeNumber: typeof e === 'number' && Number.isFinite(e) ? Math.trunc(e) : null,
                    newestAddedAt: itemTimestampSec(newestEpisode) ?? null,
                    newlyAddedCount: episodesForShow.length,
                };
            }
            if (seasons.size === 1) {
                const seasonNumber = Array.from(seasons)[0] ?? null;
                return {
                    mediaType: 'season',
                    title: newestEpisode.parentTitle ?? (seasonNumber ? `Season ${seasonNumber}` : ''),
                    ratingKey: newestEpisode.parentRatingKey ?? newestEpisode.ratingKey,
                    showTitle,
                    showRatingKey,
                    seasonNumber,
                    episodeNumber: null,
                    newestAddedAt: itemTimestampSec(newestEpisode) ?? null,
                    newlyAddedCount: episodesForShow.length,
                };
            }
            return {
                mediaType: 'show',
                title: showTitle ?? newestEpisode.grandparentTitle ?? '',
                ratingKey: newestEpisode.grandparentRatingKey ?? newestEpisode.parentRatingKey ?? newestEpisode.ratingKey,
                showTitle,
                showRatingKey,
                seasonNumber: null,
                episodeNumber: null,
                newestAddedAt: itemTimestampSec(newestEpisode) ?? null,
                newlyAddedCount: episodesForShow.length,
            };
        })();
        const mediaType = derivedTv?.mediaType ?? mediaTypeRaw;
        const title = derivedTv?.title ?? (newest.title ?? '');
        const ratingKey = derivedTv?.ratingKey ?? (newest.ratingKey ?? '');
        const showTitle = derivedTv?.showTitle ?? (newest.grandparentTitle || newest.parentTitle || null);
        const showRatingKey = derivedTv?.showRatingKey ?? (newest.grandparentRatingKey || newest.parentRatingKey || null);
        const seasonNumber = derivedTv
            ? derivedTv.seasonNumber
            : mediaType === 'season'
                ? (newest.index ?? newest.parentIndex ?? null)
                : newest.parentIndex ?? null;
        const episodeNumber = derivedTv ? derivedTv.episodeNumber : mediaType === 'episode' ? newest.index ?? null : null;
        const newestAddedAt = derivedTv?.newestAddedAt ?? itemTimestampSec(newest);
        const payload = {
            event: 'library.new',
            Metadata: {
                type: mediaType,
                title: title || undefined,
                ratingKey: ratingKey || undefined,
                year: newest.year ?? undefined,
                grandparentTitle: newest.grandparentTitle ?? undefined,
                grandparentRatingKey: newest.grandparentRatingKey ?? undefined,
                parentIndex: newest.parentIndex ?? undefined,
                index: newest.index ?? undefined,
                addedAt: newestAddedAt ?? undefined,
                librarySectionID: newest.librarySectionId ?? undefined,
                librarySectionTitle: newest.librarySectionTitle ?? undefined,
            },
            source: {
                type: 'plexPolling',
                newlyAddedCount,
            },
        };
        const event = {
            receivedAt: new Date().toISOString(),
            payload,
            files: [],
            source: { type: 'plexPolling' },
        };
        const persisted = await this.webhooksService.persistPlexWebhookEvent(event);
        this.webhooksService.logPlexWebhookSummary({
            payload,
            persistedPath: persisted.path,
            receivedAtIso: event.receivedAt,
            source: { ip: 'plexPolling', userAgent: null },
        });
        this.plexAnalytics.invalidateLibraryGrowth(userId);
        try {
            const input = {
                source: 'plexPolling',
                plexEvent: 'library.new',
                mediaType,
                title,
                year: newest.year ?? null,
                ratingKey: ratingKey || null,
                showTitle,
                showRatingKey,
                seasonNumber,
                episodeNumber,
                persistedPath: persisted.path,
                newlyAddedCount: derivedTv?.newlyAddedCount ?? newlyAddedCount,
                newestAddedAt: newestAddedAt ?? null,
            };
            const run = await this.jobsService.runJob({
                jobId: 'mediaAddedCleanup',
                trigger: 'auto',
                dryRun: false,
                userId,
                input,
            });
            this.webhooksService.logPlexWebhookAutomation({
                plexEvent: 'library.new',
                mediaType,
                seedTitle: title || undefined,
                runs: { mediaAddedCleanup: run.id },
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            this.webhooksService.logPlexWebhookAutomation({
                plexEvent: 'library.new',
                mediaType,
                seedTitle: title || undefined,
                errors: { mediaAddedCleanup: msg },
            });
        }
    }
    toSnapshot(s, nowMs) {
        const firstViewOffsetMs = s.viewOffsetMs ?? null;
        return {
            ...s,
            firstSeenAtMs: nowMs,
            lastSeenAtMs: nowMs,
            firstViewOffsetMs,
            lastViewOffsetMs: firstViewOffsetMs,
            watchedTriggered: false,
            watchedTriggeredAtMs: null,
            immaculateTriggered: false,
            immaculateTriggeredAtMs: null,
        };
    }
    mergeSnapshot(prev, cur, nowMs) {
        const viewOffset = typeof cur.viewOffsetMs === 'number' && Number.isFinite(cur.viewOffsetMs)
            ? cur.viewOffsetMs
            : null;
        const lastViewOffsetMs = viewOffset !== null
            ? Math.max(viewOffset, prev.lastViewOffsetMs ?? 0)
            : prev.lastViewOffsetMs ?? null;
        return {
            ...prev,
            ...cur,
            firstSeenAtMs: prev.firstSeenAtMs,
            firstViewOffsetMs: prev.firstViewOffsetMs ?? viewOffset ?? null,
            lastSeenAtMs: nowMs,
            lastViewOffsetMs,
            watchedTriggered: prev.watchedTriggered,
            watchedTriggeredAtMs: prev.watchedTriggeredAtMs,
            immaculateTriggered: prev.immaculateTriggered,
            immaculateTriggeredAtMs: prev.immaculateTriggeredAtMs,
        };
    }
    formatNowPlayingTitle(snap) {
        if (snap.type === 'episode') {
            const show = snap.grandparentTitle ?? '(show)';
            const season = snap.parentIndex ? `S${snap.parentIndex}` : '';
            const ep = snap.index ? `E${snap.index}` : '';
            const se = season || ep ? ` ${[season, ep].filter(Boolean).join('')}` : '';
            const episodeTitle = snap.title ? ` — ${snap.title}` : '';
            return `${show}${se}${episodeTitle}`;
        }
        const title = snap.title ?? '(title)';
        return snap.year ? `${title} (${snap.year})` : title;
    }
    formatNowPlayingProgress(snap) {
        const duration = snap.durationMs ?? null;
        const viewOffset = snap.lastViewOffsetMs ?? snap.viewOffsetMs ?? null;
        if (!duration || duration <= 0 || viewOffset === null || viewOffset < 0)
            return null;
        const pct = Math.min(100, Math.max(0, Math.round((viewOffset / duration) * 100)));
        const fmt = (ms) => {
            const totalSeconds = Math.max(0, Math.floor(ms / 1000));
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            if (hours > 0) {
                return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }
            return `${minutes}:${String(seconds).padStart(2, '0')}`;
        };
        return `${pct}% (${fmt(viewOffset)}/${fmt(duration)})`;
    }
    shouldLogNowPlaying(snap, nowMs) {
        const state = this.nowPlayingLogStateBySessionKey.get(snap.sessionKey) ?? null;
        if (!state)
            return true;
        if (state.lastRatingKey && snap.ratingKey && state.lastRatingKey !== snap.ratingKey)
            return true;
        if (nowMs - state.lastLogAtMs >= this.nowPlayingLogIntervalMs)
            return true;
        const viewOffset = snap.lastViewOffsetMs ?? snap.viewOffsetMs ?? null;
        if (viewOffset !== null &&
            state.lastViewOffsetMs !== null &&
            viewOffset - state.lastViewOffsetMs >= this.nowPlayingLogProgressStepMs) {
            return true;
        }
        return false;
    }
    updateNowPlayingLogState(snap, nowMs) {
        const viewOffset = snap.lastViewOffsetMs ?? snap.viewOffsetMs ?? null;
        this.nowPlayingLogStateBySessionKey.set(snap.sessionKey, {
            lastLogAtMs: nowMs,
            lastViewOffsetMs: viewOffset,
            lastRatingKey: snap.ratingKey ?? null,
        });
    }
    logNowPlayingStarted(snap, nowMs) {
        if (!this.shouldLogNowPlaying(snap, nowMs))
            return;
        const user = snap.userTitle ? ` user=${JSON.stringify(snap.userTitle)}` : '';
        const progress = this.formatNowPlayingProgress(snap);
        const progressLabel = progress ? ` progress=${progress}` : '';
        const library = snap.librarySectionTitle
            ? ` library=${JSON.stringify(snap.librarySectionTitle)}`
            : '';
        const msg = `Plex now playing: started type=${snap.type} title=${JSON.stringify(this.formatNowPlayingTitle(snap))}${user}${progressLabel}${library} session=${snap.sessionKey}`;
        this.logger.log(msg);
        this.updateNowPlayingLogState(snap, nowMs);
    }
    logNowPlayingProgress(snap, nowMs) {
        if (!this.shouldLogNowPlaying(snap, nowMs))
            return;
        const user = snap.userTitle ? ` user=${JSON.stringify(snap.userTitle)}` : '';
        const progress = this.formatNowPlayingProgress(snap);
        const progressLabel = progress ? ` progress=${progress}` : '';
        const library = snap.librarySectionTitle
            ? ` library=${JSON.stringify(snap.librarySectionTitle)}`
            : '';
        const msg = `Plex now playing: progress type=${snap.type} title=${JSON.stringify(this.formatNowPlayingTitle(snap))}${user}${progressLabel}${library} session=${snap.sessionKey}`;
        this.logger.log(msg);
        this.updateNowPlayingLogState(snap, nowMs);
    }
    logNowPlayingEnded(snap, nowMs) {
        const user = snap.userTitle ? ` user=${JSON.stringify(snap.userTitle)}` : '';
        const progress = this.formatNowPlayingProgress(snap);
        const progressLabel = progress ? ` progress=${progress}` : '';
        const library = snap.librarySectionTitle
            ? ` library=${JSON.stringify(snap.librarySectionTitle)}`
            : '';
        const msg = `Plex now playing: ended type=${snap.type} title=${JSON.stringify(this.formatNowPlayingTitle(snap))}${user}${progressLabel}${library} session=${snap.sessionKey}`;
        this.logger.log(msg);
        this.updateNowPlayingLogState(snap, nowMs);
    }
    getProgressRatio(snapshot) {
        const duration = snapshot.durationMs ?? null;
        const viewOffset = snapshot.lastViewOffsetMs ?? snapshot.viewOffsetMs ?? null;
        if (!duration || duration <= 0)
            return null;
        if (viewOffset === null || viewOffset <= 0)
            return null;
        return Math.min(1, viewOffset / duration);
    }
    async maybeTriggerWatchedAutomation(params) {
        const { userId, snap, settings } = params;
        if (snap.type !== 'movie' && snap.type !== 'episode')
            return snap;
        const duration = snap.durationMs ?? null;
        if (!duration || duration < this.minDurationMs)
            return snap;
        const ratio = this.getProgressRatio(snap);
        if (ratio === null)
            return snap;
        const watchedEnabled = pickBool(settings, 'jobs.webhookEnabled.watchedMovieRecommendations') ??
            false;
        const immaculateEnabled = pickBool(settings, 'jobs.webhookEnabled.immaculateTastePoints') ?? false;
        if (!watchedEnabled && !immaculateEnabled)
            return snap;
        const mediaTypeLower = snap.type;
        const showTitle = mediaTypeLower === 'episode' ? (snap.grandparentTitle ?? '') : '';
        const seedTitle = (0, title_normalize_1.normalizeTitleForMatching)(mediaTypeLower === 'episode' ? showTitle : (snap.title ?? ''));
        if (!seedTitle)
            return snap;
        const resolvedPlexUser = await this.plexUsers.resolvePlexUser({
            plexAccountId: snap.userId ?? null,
            plexAccountTitle: snap.userTitle ?? null,
            userId,
        });
        const plexUserId = resolvedPlexUser.id;
        const plexUserTitle = resolvedPlexUser.plexAccountTitle;
        const now = Date.now();
        const sessionAutomationId = this.buildSessionAutomationId({
            sessionKey: snap.sessionKey,
            plexUserId,
            mediaType: snap.type,
            ratingKey: snap.ratingKey ?? 'unknown',
        });
        this.getOrCreateSessionAutomationState({
            sessionAutomationId,
            sessionKey: snap.sessionKey,
            plexUserId,
            plexUserTitle,
            mediaType: snap.type,
            ratingKey: snap.ratingKey ?? 'unknown',
            seedTitle,
            nowMs: now,
            progressRatio: ratio,
        });
        const forceBothAtNinetyPercent = ratio >= this.forceBothScrobbleThreshold;
        const shouldConsiderWatched = watchedEnabled &&
            this.canScheduleSessionJob(sessionAutomationId, 'watchedMovieRecommendations') &&
            (ratio >= this.watchedScrobbleThreshold || forceBothAtNinetyPercent);
        const shouldConsiderImmaculate = immaculateEnabled &&
            this.canScheduleSessionJob(sessionAutomationId, 'immaculateTastePoints') &&
            (ratio >= this.immaculateScrobbleThreshold || forceBothAtNinetyPercent);
        if (!shouldConsiderWatched && !shouldConsiderImmaculate)
            return snap;
        const seedLibrarySectionKey = typeof snap.librarySectionId === 'number' &&
            Number.isFinite(snap.librarySectionId)
            ? String(Math.trunc(snap.librarySectionId))
            : '';
        if (seedLibrarySectionKey &&
            (0, plex_library_selection_utils_1.isPlexLibrarySectionExcluded)({
                settings,
                sectionKey: seedLibrarySectionKey,
            })) {
            const skipped = {};
            if (shouldConsiderWatched) {
                skipped.watchedMovieRecommendations = 'library_excluded';
            }
            if (shouldConsiderImmaculate) {
                skipped.immaculateTastePoints = 'library_excluded';
            }
            this.webhooksService.logPlexWebhookAutomation({
                plexEvent: 'media.scrobble',
                mediaType: snap.type,
                seedTitle,
                plexUserId,
                plexUserTitle,
                skipped,
            });
            return snap;
        }
        let next = { ...snap };
        const viewOffset = snap.lastViewOffsetMs ?? snap.viewOffsetMs ?? null;
        const payload = {
            event: 'media.scrobble',
            Metadata: {
                type: snap.type,
                title: snap.title ? (0, title_normalize_1.normalizeTitleForMatching)(snap.title) : undefined,
                year: snap.year ?? undefined,
                ratingKey: snap.ratingKey ?? undefined,
                grandparentTitle: snap.grandparentTitle
                    ? (0, title_normalize_1.normalizeTitleForMatching)(snap.grandparentTitle)
                    : undefined,
                grandparentRatingKey: snap.grandparentRatingKey ?? undefined,
                parentIndex: snap.parentIndex ?? undefined,
                index: snap.index ?? undefined,
                librarySectionID: snap.librarySectionId ?? undefined,
                librarySectionTitle: snap.librarySectionTitle
                    ? (0, title_normalize_1.normalizeTitleForMatching)(snap.librarySectionTitle)
                    : undefined,
                viewOffset: viewOffset ?? undefined,
                duration: duration,
                progress: ratio,
                source: params.reason,
                thresholdWatchedMovieRecommendations: this.watchedScrobbleThreshold,
                thresholdImmaculateTastePoints: this.immaculateScrobbleThreshold,
                thresholdForceBothCollections: this.forceBothScrobbleThreshold,
                forceBothCollections: forceBothAtNinetyPercent,
                sessionKey: snap.sessionKey,
                sessionAutomationId,
            },
            Account: {
                title: snap.userTitle ?? undefined,
                id: snap.userId ?? undefined,
            },
        };
        const event = {
            receivedAt: new Date().toISOString(),
            payload,
            files: [],
            source: { type: 'plexPolling' },
        };
        const persisted = await this.webhooksService.persistPlexWebhookEvent(event);
        this.webhooksService.logPlexWebhookSummary({
            payload,
            persistedPath: persisted.path,
            receivedAtIso: event.receivedAt,
            source: { ip: 'plexPolling', userAgent: null },
        });
        const episodeTitle = mediaTypeLower === 'episode' ? (snap.title ?? '') : '';
        const payloadInput = {
            source: 'plexPolling',
            plexEvent: 'media.scrobble',
            plexUserId,
            plexUserTitle,
            plexAccountId: snap.userId ?? null,
            plexAccountTitle: snap.userTitle ?? null,
            mediaType: mediaTypeLower,
            seedTitle,
            seedYear: mediaTypeLower === 'movie' ? (snap.year ?? null) : null,
            seedRatingKey: snap.ratingKey ?? null,
            seedLibrarySectionId: snap.librarySectionId ?? null,
            seedLibrarySectionTitle: snap.librarySectionTitle ?? null,
            ...(mediaTypeLower === 'episode'
                ? {
                    showTitle: showTitle || null,
                    showRatingKey: snap.grandparentRatingKey ?? null,
                    seasonNumber: snap.parentIndex ?? null,
                    episodeNumber: snap.index ?? null,
                    episodeTitle: episodeTitle || null,
                }
                : {}),
            persistedPath: persisted.path,
            progress: ratio,
            reason: params.reason,
            sessionKey: snap.sessionKey,
            sessionAutomationId,
            forceBothAtNinetyPercent,
        };
        const watchedInput = {
            ...payloadInput,
            threshold: this.watchedScrobbleThreshold,
        };
        const immaculateInput = {
            ...payloadInput,
            threshold: this.immaculateScrobbleThreshold,
        };
        const runs = {};
        const errors = {};
        const skipped = {};
        const jobsToHandle = [];
        if (shouldConsiderWatched) {
            jobsToHandle.push({
                jobId: 'watchedMovieRecommendations',
                input: watchedInput,
            });
        }
        else if (watchedEnabled) {
            const status = this.getSessionJobStatus(sessionAutomationId, 'watchedMovieRecommendations');
            skipped.watchedMovieRecommendations = `already_${status}`;
        }
        if (shouldConsiderImmaculate) {
            jobsToHandle.push({
                jobId: 'immaculateTastePoints',
                input: immaculateInput,
            });
        }
        else if (immaculateEnabled) {
            const status = this.getSessionJobStatus(sessionAutomationId, 'immaculateTastePoints');
            skipped.immaculateTastePoints = `already_${status}`;
        }
        if (!jobsToHandle.length)
            return next;
        const cooldownUntil = this.collectionCooldownUntilByPlexUser.get(plexUserId) ?? 0;
        const cooldownActive = now < cooldownUntil;
        const enqueue = (params) => {
            const queued = this.enqueueCollectionRun({
                jobId: params.jobId,
                adminUserId: userId,
                plexUserId,
                plexUserTitle,
                input: params.input,
                mediaType: snap.type,
                seedTitle,
                sessionAutomationId,
                enqueuedAtMs: now,
                attempt: 1,
            });
            if (params.jobId === 'watchedMovieRecommendations') {
                skipped.watchedMovieRecommendations = queued
                    ? params.reason
                    : 'already_queued_or_processed';
                next = { ...next, watchedTriggered: true, watchedTriggeredAtMs: now };
            }
            else {
                skipped.immaculateTastePoints = queued
                    ? params.reason
                    : 'already_queued_or_processed';
                next = { ...next, immaculateTriggered: true, immaculateTriggeredAtMs: now };
            }
        };
        if (cooldownActive) {
            for (const job of jobsToHandle) {
                enqueue({
                    jobId: job.jobId,
                    input: job.input,
                    reason: 'cooldown_pending',
                });
            }
        }
        else {
            const [first, ...rest] = jobsToHandle;
            if (first) {
                const result = await this.runCollectionJobNow({
                    jobId: first.jobId,
                    adminUserId: userId,
                    input: first.input,
                    sessionAutomationId,
                    nowMs: now,
                });
                if (result.runId)
                    runs[first.jobId] = result.runId;
                else if (result.error)
                    errors[first.jobId] = result.error;
                if (first.jobId === 'watchedMovieRecommendations') {
                    next = { ...next, watchedTriggered: true, watchedTriggeredAtMs: now };
                }
                else {
                    next = { ...next, immaculateTriggered: true, immaculateTriggeredAtMs: now };
                }
                this.setCollectionCooldown({ plexUserId, nowMs: now });
            }
            for (const job of rest) {
                enqueue({
                    jobId: job.jobId,
                    input: job.input,
                    reason: 'queued_after_first_run',
                });
            }
        }
        this.webhooksService.logPlexWebhookAutomation({
            plexEvent: 'media.scrobble',
            mediaType: snap.type,
            seedTitle,
            plexUserId,
            plexUserTitle,
            ...(Object.keys(runs).length ? { runs } : {}),
            ...(Object.keys(skipped).length ? { skipped } : {}),
            ...(Object.keys(errors).length ? { errors } : {}),
        });
        return next;
    }
    async handleEndedSession(params) {
        const { userId, prev, settings } = params;
        await this.maybeTriggerWatchedAutomation({
            userId,
            snap: prev,
            settings,
            reason: 'ended',
        });
    }
};
exports.PlexPollingService = PlexPollingService;
__decorate([
    (0, schedule_1.Interval)(5_000),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PlexPollingService.prototype, "poll", null);
exports.PlexPollingService = PlexPollingService = PlexPollingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        settings_service_1.SettingsService,
        jobs_service_1.JobsService,
        plex_server_service_1.PlexServerService,
        plex_users_service_1.PlexUsersService,
        webhooks_service_1.WebhooksService,
        plex_analytics_service_1.PlexAnalyticsService])
], PlexPollingService);
//# sourceMappingURL=plex-polling.service.js.map