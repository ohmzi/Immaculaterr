import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AuthService } from '../auth/auth.service';
import { JobsService } from '../jobs/jobs.service';
import type { JsonObject } from '../jobs/jobs.types';
import { PlexAnalyticsService } from '../plex/plex-analytics.service';
import {
  PlexNowPlayingSession,
  PlexRecentlyAddedItem,
  PlexServerService,
} from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import { normalizeTitleForMatching } from '../lib/title-normalize';
import { WebhooksService } from './webhooks.service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
}

function parseBoolEnv(raw: string | undefined, defaultValue: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (!v) return defaultValue;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultValue;
}

function parseNumberEnv(raw: string | undefined, defaultValue: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function parseFloatEnv(raw: string | undefined, defaultValue: number): number {
  const n = Number.parseFloat(raw ?? '');
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

type SessionSnapshot = PlexNowPlayingSession & {
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  firstViewOffsetMs: number | null;
  lastViewOffsetMs: number | null;
  watchedTriggered: boolean;
  watchedTriggeredAtMs: number | null;
  immaculateTriggered: boolean;
  immaculateTriggeredAtMs: number | null;
};

type CollectionJobId = 'watchedMovieRecommendations' | 'immaculateTastePoints';

type PendingCollectionRun = {
  jobId: CollectionJobId;
  userId: string;
  input: JsonObject;
  mediaType: string;
  seedTitle: string;
  enqueuedAtMs: number;
};

type PendingCollectionRunsByJob = {
  watched?: PendingCollectionRun;
  immaculate?: PendingCollectionRun;
};

@Injectable()
export class PlexPollingService implements OnModuleInit {
  private readonly logger = new Logger(PlexPollingService.name);

  private readonly enabled = parseBoolEnv(
    process.env.PLEX_POLLING_ENABLED,
    true,
  );
  private readonly intervalMs = parseNumberEnv(
    process.env.PLEX_POLLING_INTERVAL_MS,
    5_000,
  );
  private readonly watchedScrobbleThreshold = (() => {
    const v = parseFloatEnv(process.env.PLEX_POLLING_WATCHED_THRESHOLD, 0.6);
    return v > 1 ? v / 100 : v;
  })();
  private readonly immaculateScrobbleThreshold = (() => {
    const v = parseFloatEnv(
      process.env.PLEX_POLLING_IMMACULATE_THRESHOLD ??
        process.env.PLEX_POLLING_SCROBBLE_THRESHOLD,
      0.7,
    );
    return v > 1 ? v / 100 : v;
  })();
  private readonly minDurationMs = parseNumberEnv(
    process.env.PLEX_POLLING_MIN_DURATION_MS,
    60_000,
  );

  private readonly recentlyAddedIntervalMs = parseNumberEnv(
    process.env.PLEX_POLLING_RECENTLY_ADDED_INTERVAL_MS,
    60_000,
  );
  private readonly libraryNewDebounceMs = parseNumberEnv(
    process.env.PLEX_POLLING_LIBRARY_NEW_DEBOUNCE_MS,
    120_000,
  );

  private readonly lastBySessionKey = new Map<string, SessionSnapshot>();
  private readonly recentTriggers = new Map<string, number>();
  private static readonly RECENT_TRIGGER_TTL_MS = 10 * 60_000;

  // Polling-only cooldown/queue for the two collection jobs.
  // This does NOT affect other jobs/triggers.
  private static readonly COLLECTION_COOLDOWN_MS = 10 * 60_000;
  private readonly collectionCooldownUntilByUser = new Map<string, number>();
  private readonly pendingCollectionRunsByUser = new Map<
    string,
    PendingCollectionRunsByJob
  >();

  private lastRecentlyAddedPollAtMs: number | null = null;
  private lastSeenAddedAtSec: number | null = null;
  private lastLibraryNewTriggeredAtMs: number | null = null;
  private pendingLibraryNew: {
    newest: PlexRecentlyAddedItem;
    newlyAddedCount: number;
    sinceSec: number;
  } | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
    private readonly jobsService: JobsService,
    private readonly plexServer: PlexServerService,
    private readonly webhooksService: WebhooksService,
    private readonly plexAnalytics: PlexAnalyticsService,
  ) {}

  onModuleInit() {
    this.logger.log(
      `Plex polling ${this.enabled ? 'ENABLED' : 'disabled'} intervalMs=${this.intervalMs} watchedThreshold=${this.watchedScrobbleThreshold} immaculateThreshold=${this.immaculateScrobbleThreshold} minDurationMs=${this.minDurationMs}`,
    );
    // Let the app fully boot first.
    setTimeout(() => void this.pollOnce(), 15_000);
  }

  @Interval(5_000)
  async poll() {
    // We still want the interval decorator to be constant; use intervalMs as a gate.
    // This runs the cheap check and self-throttles to the configured cadence.
    await this.pollOnce();
  }

  private lastPolledAtMs: number | null = null;

  private setCollectionCooldown(params: { userId: string; nowMs: number }) {
    this.collectionCooldownUntilByUser.set(
      params.userId,
      params.nowMs + PlexPollingService.COLLECTION_COOLDOWN_MS,
    );
  }

  private enqueueCollectionRun(params: PendingCollectionRun) {
    const cur = this.pendingCollectionRunsByUser.get(params.userId) ?? {};
    const next: PendingCollectionRunsByJob = { ...cur };
    if (params.jobId === 'watchedMovieRecommendations') next.watched = params;
    else next.immaculate = params;
    this.pendingCollectionRunsByUser.set(params.userId, next);
  }

  private dequeueNextPendingCollectionRun(params: { userId: string }) {
    const cur = this.pendingCollectionRunsByUser.get(params.userId) ?? null;
    if (!cur) return null;
    if (cur.watched) {
      const next = { ...cur };
      const run = next.watched;
      delete next.watched;
      if (!next.watched && !next.immaculate)
        this.pendingCollectionRunsByUser.delete(params.userId);
      else this.pendingCollectionRunsByUser.set(params.userId, next);
      return run;
    }
    if (cur.immaculate) {
      const next = { ...cur };
      const run = next.immaculate;
      delete next.immaculate;
      if (!next.watched && !next.immaculate)
        this.pendingCollectionRunsByUser.delete(params.userId);
      else this.pendingCollectionRunsByUser.set(params.userId, next);
      return run;
    }
    this.pendingCollectionRunsByUser.delete(params.userId);
    return null;
  }

  private async flushPendingCollectionRuns(params: {
    userId: string;
    settings: Record<string, unknown>;
  }) {
    const now = Date.now();
    const cooldownUntil = this.collectionCooldownUntilByUser.get(params.userId) ?? 0;
    if (now < cooldownUntil) return;

    const pending = this.dequeueNextPendingCollectionRun({ userId: params.userId });
    if (!pending) return;

    const watchedEnabled =
      pickBool(params.settings, 'jobs.webhookEnabled.watchedMovieRecommendations') ??
      false;
    const immaculateEnabled =
      pickBool(params.settings, 'jobs.webhookEnabled.immaculateTastePoints') ?? false;

    const enabled =
      pending.jobId === 'watchedMovieRecommendations'
        ? watchedEnabled
        : immaculateEnabled;
    if (!enabled) {
      this.webhooksService.logPlexWebhookAutomation({
        plexEvent: 'plexPolling.cooldown',
        mediaType: pending.mediaType,
        seedTitle: pending.seedTitle,
        skipped: { [pending.jobId]: 'cooldown_pending_dropped_disabled' },
      });
      return;
    }

    // Apply cooldown once we decide to run (regardless of success/failure), to protect Plex.
    this.setCollectionCooldown({ userId: params.userId, nowMs: now });
    try {
      const run = await this.jobsService.runJob({
        jobId: pending.jobId,
        trigger: 'auto',
        dryRun: false,
        userId: params.userId,
        input: pending.input,
      });
      this.webhooksService.logPlexWebhookAutomation({
        plexEvent: 'plexPolling.cooldown',
        mediaType: pending.mediaType,
        seedTitle: pending.seedTitle,
        runs: { [pending.jobId]: run.id },
      });
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.webhooksService.logPlexWebhookAutomation({
        plexEvent: 'plexPolling.cooldown',
        mediaType: pending.mediaType,
        seedTitle: pending.seedTitle,
        errors: { [pending.jobId]: msg },
      });
    }
  }

  private async pollOnce() {
    if (!this.enabled) return;

    const now = Date.now();
    const last = this.lastPolledAtMs ?? 0;
    if (this.lastPolledAtMs !== null && now - last < this.intervalMs) return;
    this.lastPolledAtMs = now;

    const userId = await this.authService.getFirstAdminUserId();
    if (!userId) return;

    const { settings, secrets } = await this.settingsService
      .getInternalSettings(userId)
      .catch(() => ({ settings: {}, secrets: {} }));

    // Drain any pending collection runs even if no active sessions exist.
    await this.flushPendingCollectionRuns({
      userId,
      settings: settings as Record<string, unknown>,
    });

    const baseUrl = pickString(settings as Record<string, unknown>, 'plex.baseUrl');
    const token = pickString(secrets as Record<string, unknown>, 'plex.token');

    if (!baseUrl || !token) return;

    // Poll recently-added on a slower cadence (for library.new-style triggers).
    await this.pollRecentlyAdded({
      userId,
      baseUrl,
      token,
      settings: settings as Record<string, unknown>,
    });

    let sessions: PlexNowPlayingSession[] = [];
    try {
      sessions = await this.plexServer.listNowPlayingSessions({ baseUrl, token });
    } catch (err) {
      // Keep logs quiet unless this keeps failing; PlexConnectivityMonitor already covers reachability.
      this.logger.debug(
        `Polling /status/sessions failed: ${(err as Error)?.message ?? String(err)}`,
      );
      return;
    }

    const currentKeys = new Set(sessions.map((s) => s.sessionKey));

    // Handle ended sessions (or sessions that changed media within the same sessionKey).
    for (const [key, prev] of this.lastBySessionKey) {
      const current = sessions.find((s) => s.sessionKey === key) ?? null;
      if (!current) {
        await this.handleEndedSession({
          userId,
          prev,
          settings: settings as Record<string, unknown>,
        });
        this.lastBySessionKey.delete(key);
        continue;
      }

      const prevRatingKey = prev.ratingKey ?? '';
      const curRatingKey = current.ratingKey ?? '';
      if (prevRatingKey && curRatingKey && prevRatingKey !== curRatingKey) {
        await this.handleEndedSession({
          userId,
          prev,
          settings: settings as Record<string, unknown>,
        });
        const nextSnap = this.toSnapshot(current, now);
        const nextWithTrigger = await this.maybeTriggerWatchedAutomation({
          userId,
          snap: nextSnap,
          settings: settings as Record<string, unknown>,
          reason: 'progress',
        });
        this.lastBySessionKey.set(key, nextWithTrigger);
      } else {
        const merged = this.mergeSnapshot(prev, current, now);
        const mergedWithTrigger = await this.maybeTriggerWatchedAutomation({
          userId,
          snap: merged,
          settings: settings as Record<string, unknown>,
          reason: 'progress',
        });
        this.lastBySessionKey.set(key, mergedWithTrigger);
      }
    }

    // Add new sessions.
    for (const s of sessions) {
      if (!this.lastBySessionKey.has(s.sessionKey)) {
        const snap = this.toSnapshot(s, now);
        const snapWithTrigger = await this.maybeTriggerWatchedAutomation({
          userId,
          snap,
          settings: settings as Record<string, unknown>,
          reason: 'progress',
        });
        this.lastBySessionKey.set(s.sessionKey, snapWithTrigger);
      }
    }

    // Best-effort cleanup of recent trigger dedupe map.
    for (const [k, ts] of this.recentTriggers) {
      if (now - ts > PlexPollingService.RECENT_TRIGGER_TTL_MS) {
        this.recentTriggers.delete(k);
      }
    }

    // Defensive: if Plex returns no sessions, currentKeys is empty; that's fine.
    void currentKeys;
  }

  private async pollRecentlyAdded(params: {
    userId: string;
    baseUrl: string;
    token: string;
    settings: Record<string, unknown>;
  }) {
    const { userId, baseUrl, token, settings } = params;

    const enabled =
      pickBool(settings, 'jobs.webhookEnabled.mediaAddedCleanup') ?? false;
    if (!enabled) return;

    const now = Date.now();
    const last = this.lastRecentlyAddedPollAtMs ?? 0;
    if (this.lastRecentlyAddedPollAtMs !== null && now - last < this.recentlyAddedIntervalMs) {
      return;
    }
    this.lastRecentlyAddedPollAtMs = now;

    let items: PlexRecentlyAddedItem[] = [];
    try {
      // Request a deeper window so TV items aren't pushed out by frequent movie imports.
      items = await this.plexServer.listRecentlyAdded({ baseUrl, token, take: 200 });
    } catch (err) {
      this.logger.debug(
        `Polling /library/recentlyAdded failed: ${(err as Error)?.message ?? String(err)}`,
      );
      return;
    }

    // Plex should provide `addedAt` as a unix timestamp in seconds. Some servers/libraries
    // occasionally emit bogus "future" timestamps (e.g. year 2098), which would permanently
    // break our watermark logic. Clamp those out and self-heal if the watermark was poisoned.
    // If `addedAt` is invalid, fall back to `updatedAt` when present.
    const nowSec = Math.floor(now / 1000);
    const MAX_FUTURE_SKEW_SEC = 24 * 60 * 60;
    const safePlexTimestampSec = (tsSec: number | null): number | null => {
      if (tsSec === null) return null;
      if (!Number.isFinite(tsSec)) return null;
      const n = Math.trunc(tsSec);
      if (n <= 0) return null;
      if (n > nowSec + MAX_FUTURE_SKEW_SEC) return null;
      return n;
    };
    const itemTimestampSec = (it: PlexRecentlyAddedItem): number | null => {
      // Prefer addedAt when it's sane; otherwise use updatedAt (some servers return broken addedAt).
      const a = safePlexTimestampSec(it.addedAt);
      if (a !== null) return a;
      return safePlexTimestampSec(it.updatedAt);
    };

    const invalidFutureCount = items.reduce((acc, it) => {
      const raw = it.addedAt;
      if (raw === null) return acc;
      if (!Number.isFinite(raw)) return acc;
      return Math.trunc(raw) > nowSec + MAX_FUTURE_SKEW_SEC ? acc + 1 : acc;
    }, 0);
    if (invalidFutureCount > 0) {
      this.logger.debug(
        `Plex recentlyAdded: ${invalidFutureCount} item(s) had invalid future addedAt; using updatedAt fallback`,
      );
    }

    const maxAddedAt =
      items.reduce((max, it) => Math.max(max, itemTimestampSec(it) ?? 0), 0) || 0;
    if (!maxAddedAt) return;

    if (
      this.lastSeenAddedAtSec !== null &&
      this.lastSeenAddedAtSec > nowSec + MAX_FUTURE_SKEW_SEC
    ) {
      this.logger.warn(
        `Plex recentlyAdded watermark was in the future (lastSeenAddedAtSec=${this.lastSeenAddedAtSec}); resetting to ${maxAddedAt}`,
      );
      this.lastSeenAddedAtSec = maxAddedAt;
    }

    // Baseline on first successful poll (avoid "startup storm" runs).
    if (this.lastSeenAddedAtSec === null) {
      this.lastSeenAddedAtSec = maxAddedAt;
      return;
    }

    const since = this.lastSeenAddedAtSec;
    const newItems = items.filter((it) => (itemTimestampSec(it) ?? 0) > since);

    // Always advance the "seen" watermark so we don't repeatedly treat the same items as new.
    this.lastSeenAddedAtSec = Math.max(this.lastSeenAddedAtSec, maxAddedAt);

    const canRunNow =
      this.lastLibraryNewTriggeredAtMs === null ||
      now - this.lastLibraryNewTriggeredAtMs >= this.libraryNewDebounceMs;

    const pickNewer = (a: PlexRecentlyAddedItem, b: PlexRecentlyAddedItem) =>
      (itemTimestampSec(b) ?? 0) > (itemTimestampSec(a) ?? 0) ? b : a;

    // If we saw new items but are within the debounce window, stash the newest one and run later.
    if (newItems.length > 0 && !canRunNow) {
      const newest = newItems.reduce((best, it) => pickNewer(best, it), newItems[0]!);
      if (!this.pendingLibraryNew) {
        this.pendingLibraryNew = { newest, newlyAddedCount: newItems.length, sinceSec: since };
      } else {
        this.pendingLibraryNew = {
          newest: pickNewer(this.pendingLibraryNew.newest, newest),
          newlyAddedCount: Math.max(this.pendingLibraryNew.newlyAddedCount, newItems.length),
          // Keep the earliest window start so we can derive TV types from episodes later.
          sinceSec: this.pendingLibraryNew.sinceSec,
        };
      }
      return;
    }

    // If no new items were detected in this poll, but we have a pending item and debounce has passed,
    // run it now so TV additions don't get dropped.
    if (newItems.length === 0) {
      if (!canRunNow || !this.pendingLibraryNew) return;
    }

    // Use the newest item (from this poll or pending) as representative metadata for logs + job input.
    const newest = (() => {
      const newestFromPoll =
        newItems.length > 0
          ? newItems.reduce((best, it) => pickNewer(best, it), newItems[0]!)
          : null;
      if (newestFromPoll && this.pendingLibraryNew) {
        return pickNewer(this.pendingLibraryNew.newest, newestFromPoll);
      }
      return newestFromPoll ?? this.pendingLibraryNew!.newest;
    })();
    const newlyAddedCount =
      newItems.length > 0
        ? Math.max(newItems.length, this.pendingLibraryNew?.newlyAddedCount ?? 0)
        : (this.pendingLibraryNew?.newlyAddedCount ?? 1);
    const windowSinceSec =
      newItems.length > 0
        ? (this.pendingLibraryNew?.sinceSec ?? since)
        : this.pendingLibraryNew!.sinceSec;

    // Clear pending now that we're going to run.
    this.pendingLibraryNew = null;
    this.lastLibraryNewTriggeredAtMs = now;

    const mediaTypeRaw = (newest.type ?? '').toLowerCase();
    if (!['movie', 'show', 'season', 'episode'].includes(mediaTypeRaw)) return;

    // Derive accurate TV type from the *section-specific* recentlyAdded feed.
    // Plex's global /library/recentlyAdded often reports TV changes as "season" even
    // when a single episode was added. For reports and job routing, we want:
    // - 1 new episode => episode
    // - multiple new episodes within one season => season
    // - multiple new episodes across multiple seasons => show
    const librarySectionKey =
      typeof newest.librarySectionId === 'number' && Number.isFinite(newest.librarySectionId)
        ? String(Math.trunc(newest.librarySectionId))
        : null;
    const derivedTv = await (async () => {
      if (!librarySectionKey) return null;
      // Only attempt this for TV-ish items (and only when we can identify the section).
      if (mediaTypeRaw === 'movie') return null;

      let sectionItems: PlexRecentlyAddedItem[] = [];
      try {
        sectionItems = await this.plexServer.listRecentlyAddedForSectionKey({
          baseUrl,
          token,
          librarySectionKey,
          take: 200,
        });
      } catch (err) {
        this.logger.debug(
          `Polling /library/sections/${librarySectionKey}/recentlyAdded failed: ${(err as Error)?.message ?? String(err)}`,
        );
        return null;
      }

      const episodeItems = sectionItems.filter(
        (it) => (it.type ?? '').toLowerCase() === 'episode',
      );
      const newEpisodes = episodeItems.filter(
        (it) => (itemTimestampSec(it) ?? 0) > windowSinceSec,
      );
      if (newEpisodes.length === 0) return null;

      const newestEpisode = newEpisodes.reduce((best, it) => pickNewer(best, it), newEpisodes[0]!);

      const showRatingKey =
        newestEpisode.grandparentRatingKey ?? newestEpisode.parentRatingKey ?? null;
      const showTitle =
        newestEpisode.grandparentTitle ?? newestEpisode.parentTitle ?? null;

      const belongsToSameShow = (it: PlexRecentlyAddedItem) => {
        const rk = it.grandparentRatingKey ?? it.parentRatingKey ?? null;
        if (showRatingKey && rk) return rk === showRatingKey;
        const t = (it.grandparentTitle ?? it.parentTitle ?? '').trim().toLowerCase();
        return showTitle ? t === showTitle.trim().toLowerCase() : false;
      };

      const episodesForShow = newEpisodes.filter(belongsToSameShow);
      const seasons = new Set<number>();
      for (const it of episodesForShow) {
        const s =
          typeof it.parentIndex === 'number' && Number.isFinite(it.parentIndex)
            ? Math.trunc(it.parentIndex)
            : null;
        if (s && s > 0) seasons.add(s);
      }

      if (episodesForShow.length === 1) {
        const s = newestEpisode.parentIndex ?? null;
        const e = newestEpisode.index ?? null;
        return {
          mediaType: 'episode' as const,
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
          mediaType: 'season' as const,
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
        mediaType: 'show' as const,
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

    const payload: Record<string, unknown> = {
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
      source: { type: 'plexPolling' as const },
    };
    const persisted = await this.webhooksService.persistPlexWebhookEvent(event);
    this.webhooksService.logPlexWebhookSummary({
      payload,
      persistedPath: persisted.path,
      receivedAtIso: event.receivedAt,
      source: { ip: 'plexPolling', userAgent: null },
    });

    // New media has been added to Plex; bump the dashboard graph version and clear the
    // server-side growth cache so the next request recomputes quickly.
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
      } as const;

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
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.webhooksService.logPlexWebhookAutomation({
        plexEvent: 'library.new',
        mediaType,
        seedTitle: title || undefined,
        errors: { mediaAddedCleanup: msg },
      });
    }
  }

  private toSnapshot(s: PlexNowPlayingSession, nowMs: number): SessionSnapshot {
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

  private mergeSnapshot(
    prev: SessionSnapshot,
    cur: PlexNowPlayingSession,
    nowMs: number,
  ): SessionSnapshot {
    const viewOffset =
      typeof cur.viewOffsetMs === 'number' && Number.isFinite(cur.viewOffsetMs)
        ? cur.viewOffsetMs
        : null;
    const lastViewOffsetMs =
      viewOffset !== null
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

  private getProgressRatio(snapshot: SessionSnapshot): number | null {
    const duration = snapshot.durationMs ?? null;
    const viewOffset =
      snapshot.lastViewOffsetMs ?? snapshot.viewOffsetMs ?? null;
    if (!duration || duration <= 0) return null;
    if (viewOffset === null || viewOffset <= 0) return null;
    return Math.min(1, viewOffset / duration);
  }

  private async maybeTriggerWatchedAutomation(params: {
    userId: string;
    snap: SessionSnapshot;
    settings: Record<string, unknown>;
    reason: 'progress' | 'ended';
  }): Promise<SessionSnapshot> {
    const { userId, snap, settings } = params;

    // Only trigger for video scrobbles (movie/episode).
    if (snap.type !== 'movie' && snap.type !== 'episode') return snap;

    const duration = snap.durationMs ?? null;
    if (!duration || duration < this.minDurationMs) return snap;

    const ratio = this.getProgressRatio(snap);
    if (ratio === null) return snap;

    // Respect per-job auto-run toggles (same settings as webhooks).
    const watchedEnabled =
      pickBool(settings, 'jobs.webhookEnabled.watchedMovieRecommendations') ??
      false;
    const immaculateEnabled =
      pickBool(settings, 'jobs.webhookEnabled.immaculateTastePoints') ?? false;
    if (!watchedEnabled && !immaculateEnabled) return snap;

    const shouldConsiderWatched =
      watchedEnabled &&
      !snap.watchedTriggered &&
      ratio >= this.watchedScrobbleThreshold;
    const shouldConsiderImmaculate =
      immaculateEnabled &&
      !snap.immaculateTriggered &&
      ratio >= this.immaculateScrobbleThreshold;
    if (!shouldConsiderWatched && !shouldConsiderImmaculate) return snap;

    // De-dupe across short time windows (protects against polling quirks and sessionKey resets).
    const now = Date.now();
    const makeDedupeKey = (jobId: string) =>
      `${jobId}:${snap.type}:${snap.ratingKey ?? 'unknown'}:${snap.librarySectionId ?? 'unknown'}`;

    let runWatched = false;
    let runImmaculate = false;

    let next: SessionSnapshot = { ...snap };

    if (shouldConsiderWatched) {
      const key = makeDedupeKey('watchedMovieRecommendations');
      const last = this.recentTriggers.get(key) ?? 0;
      if (now - last < PlexPollingService.RECENT_TRIGGER_TTL_MS) {
        next = { ...next, watchedTriggered: true, watchedTriggeredAtMs: now };
      } else {
        this.recentTriggers.set(key, now);
        runWatched = true;
      }
    }

    if (shouldConsiderImmaculate) {
      const key = makeDedupeKey('immaculateTastePoints');
      const last = this.recentTriggers.get(key) ?? 0;
      if (now - last < PlexPollingService.RECENT_TRIGGER_TTL_MS) {
        next = { ...next, immaculateTriggered: true, immaculateTriggeredAtMs: now };
      } else {
        this.recentTriggers.set(key, now);
        runImmaculate = true;
      }
    }

    // If we decided not to run anything (dedupe-only), just mark triggered flags and exit.
    if (!runWatched && !runImmaculate) return next;

    const viewOffset =
      snap.lastViewOffsetMs ?? snap.viewOffsetMs ?? null;

    const payload: Record<string, unknown> = {
      event: 'media.scrobble',
      Metadata: {
        type: snap.type,
        title: snap.title ? normalizeTitleForMatching(snap.title) : undefined,
        year: snap.year ?? undefined,
        ratingKey: snap.ratingKey ?? undefined,
        grandparentTitle: snap.grandparentTitle
          ? normalizeTitleForMatching(snap.grandparentTitle)
          : undefined,
        grandparentRatingKey: snap.grandparentRatingKey ?? undefined,
        parentIndex: snap.parentIndex ?? undefined,
        index: snap.index ?? undefined,
        librarySectionID: snap.librarySectionId ?? undefined,
        librarySectionTitle: snap.librarySectionTitle
          ? normalizeTitleForMatching(snap.librarySectionTitle)
          : undefined,
        viewOffset: viewOffset ?? undefined,
        duration: duration,
        progress: ratio,
        source: params.reason,
        thresholdWatchedMovieRecommendations: this.watchedScrobbleThreshold,
        thresholdImmaculateTastePoints: this.immaculateScrobbleThreshold,
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
      source: { type: 'plexPolling' as const },
    };
    const persisted = await this.webhooksService.persistPlexWebhookEvent(event);
    this.webhooksService.logPlexWebhookSummary({
      payload,
      persistedPath: persisted.path,
      receivedAtIso: event.receivedAt,
      source: { ip: 'plexPolling', userAgent: null },
    });

    // Build the same "seed" input structure the webhook controller uses.
    const mediaTypeLower = snap.type;
    const showTitle =
      mediaTypeLower === 'episode' ? (snap.grandparentTitle ?? '') : '';
    const episodeTitle =
      mediaTypeLower === 'episode' ? (snap.title ?? '') : '';
    const seedTitle = normalizeTitleForMatching(
      mediaTypeLower === 'episode' ? showTitle : (snap.title ?? ''),
    );
    if (!seedTitle) return snap;

    const payloadInput = {
      source: 'plexPolling',
      plexEvent: 'media.scrobble',
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
    } as const;
    const watchedInput = {
      ...payloadInput,
      threshold: this.watchedScrobbleThreshold,
    } as const;
    const immaculateInput = {
      ...payloadInput,
      threshold: this.immaculateScrobbleThreshold,
    } as const;

    const runs: Record<string, string> = {};
    const errors: Record<string, string> = {};
    const skipped: Record<string, string> = {};

    if (watchedEnabled && !runWatched) {
      skipped.watchedMovieRecommendations = 'dedupe_or_already_triggered';
    }
    if (immaculateEnabled && !runImmaculate) {
      skipped.immaculateTastePoints = 'dedupe_or_already_triggered';
    }

    // Shared cooldown for collection jobs (polling-only).
    const cooldownUntil = this.collectionCooldownUntilByUser.get(userId) ?? 0;
    const cooldownActive = now < cooldownUntil;

    const enqueue = (jobId: CollectionJobId) => {
      this.enqueueCollectionRun({
        jobId,
        userId,
        input:
          jobId === 'watchedMovieRecommendations'
            ? (watchedInput as unknown as JsonObject)
            : (immaculateInput as unknown as JsonObject),
        mediaType: snap.type,
        seedTitle,
        enqueuedAtMs: now,
      });
      if (jobId === 'watchedMovieRecommendations') {
        skipped.watchedMovieRecommendations = 'cooldown_pending';
        next = { ...next, watchedTriggered: true, watchedTriggeredAtMs: now };
      } else {
        skipped.immaculateTastePoints = 'cooldown_pending';
        next = { ...next, immaculateTriggered: true, immaculateTriggeredAtMs: now };
      }
    };

    let ranNow = false;

    if (cooldownActive) {
      if (runWatched) enqueue('watchedMovieRecommendations');
      if (runImmaculate) enqueue('immaculateTastePoints');
    } else {
      // If both are eligible, we prefer watched first and queue immaculate behind cooldown.
      if (runWatched && runImmaculate) {
        // Run watched now.
        try {
          const run = await this.jobsService.runJob({
            jobId: 'watchedMovieRecommendations',
            trigger: 'auto',
            dryRun: false,
            userId,
            input: watchedInput,
          });
          runs.watchedMovieRecommendations = run.id;
        } catch (err) {
          errors.watchedMovieRecommendations =
            (err as Error)?.message ?? String(err);
        } finally {
          ranNow = true;
          next = { ...next, watchedTriggered: true, watchedTriggeredAtMs: now };
          this.setCollectionCooldown({ userId, nowMs: now });
        }

        // Queue immaculate for after cooldown.
        enqueue('immaculateTastePoints');
      } else if (runWatched) {
        try {
          const run = await this.jobsService.runJob({
            jobId: 'watchedMovieRecommendations',
            trigger: 'auto',
            dryRun: false,
            userId,
            input: watchedInput,
          });
          runs.watchedMovieRecommendations = run.id;
        } catch (err) {
          errors.watchedMovieRecommendations =
            (err as Error)?.message ?? String(err);
        } finally {
          ranNow = true;
          next = { ...next, watchedTriggered: true, watchedTriggeredAtMs: now };
          this.setCollectionCooldown({ userId, nowMs: now });
        }
      } else if (runImmaculate) {
        try {
          const run = await this.jobsService.runJob({
            jobId: 'immaculateTastePoints',
            trigger: 'auto',
            dryRun: false,
            userId,
            input: immaculateInput,
          });
          runs.immaculateTastePoints = run.id;
        } catch (err) {
          errors.immaculateTastePoints =
            (err as Error)?.message ?? String(err);
        } finally {
          ranNow = true;
          next = { ...next, immaculateTriggered: true, immaculateTriggeredAtMs: now };
          this.setCollectionCooldown({ userId, nowMs: now });
        }
      }
    }

    this.webhooksService.logPlexWebhookAutomation({
      plexEvent: 'media.scrobble',
      mediaType: snap.type,
      seedTitle,
      ...(Object.keys(runs).length ? { runs } : {}),
      ...(Object.keys(skipped).length ? { skipped } : {}),
      ...(Object.keys(errors).length ? { errors } : {}),
    });

    // `next` already contains the appropriate triggered flags (dedupe, queued, or ran-now).
    // ranNow is unused beyond readability, but kept here to make intent explicit.
    void ranNow;
    return next;
  }

  private async handleEndedSession(params: {
    userId: string;
    prev: SessionSnapshot;
    settings: Record<string, unknown>;
  }) {
    const { userId, prev, settings } = params;
    await this.maybeTriggerWatchedAutomation({
      userId,
      snap: prev,
      settings,
      reason: 'ended',
    });
  }
}

