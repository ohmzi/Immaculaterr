import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AuthService } from '../auth/auth.service';
import { JobsService } from '../jobs/jobs.service';
import { PlexAnalyticsService } from '../plex/plex-analytics.service';
import {
  PlexNowPlayingSession,
  PlexRecentlyAddedItem,
  PlexServerService,
} from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
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
  lastSeenAtMs: number;
  lastViewOffsetMs: number | null;
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
  private readonly scrobbleThreshold = (() => {
    const v = parseFloatEnv(process.env.PLEX_POLLING_SCROBBLE_THRESHOLD, 0.9);
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

  private lastRecentlyAddedPollAtMs: number | null = null;
  private lastSeenAddedAtSec: number | null = null;
  private lastLibraryNewTriggeredAtMs: number | null = null;

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
      `Plex polling ${this.enabled ? 'ENABLED' : 'disabled'} intervalMs=${this.intervalMs} scrobbleThreshold=${this.scrobbleThreshold} minDurationMs=${this.minDurationMs}`,
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
        await this.handleEndedSession({ userId, prev, settings: settings as Record<string, unknown> });
        this.lastBySessionKey.delete(key);
        continue;
      }

      const prevRatingKey = prev.ratingKey ?? '';
      const curRatingKey = current.ratingKey ?? '';
      if (prevRatingKey && curRatingKey && prevRatingKey !== curRatingKey) {
        await this.handleEndedSession({ userId, prev, settings: settings as Record<string, unknown> });
        this.lastBySessionKey.set(key, this.toSnapshot(current, now));
      } else {
        this.lastBySessionKey.set(key, this.mergeSnapshot(prev, current, now));
      }
    }

    // Add new sessions.
    for (const s of sessions) {
      if (!this.lastBySessionKey.has(s.sessionKey)) {
        this.lastBySessionKey.set(s.sessionKey, this.toSnapshot(s, now));
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
      items = await this.plexServer.listRecentlyAdded({ baseUrl, token, take: 50 });
    } catch (err) {
      this.logger.debug(
        `Polling /library/recentlyAdded failed: ${(err as Error)?.message ?? String(err)}`,
      );
      return;
    }

    const maxAddedAt =
      items.reduce((max, it) => Math.max(max, it.addedAt ?? 0), 0) || 0;
    if (!maxAddedAt) return;

    // Baseline on first successful poll (avoid "startup storm" runs).
    if (this.lastSeenAddedAtSec === null) {
      this.lastSeenAddedAtSec = maxAddedAt;
      return;
    }

    const since = this.lastSeenAddedAtSec;
    const newItems = items.filter((it) => (it.addedAt ?? 0) > since);
    this.lastSeenAddedAtSec = Math.max(this.lastSeenAddedAtSec, maxAddedAt);

    if (!newItems.length) return;

    // Debounce "library.new" cleanup runs.
    const lastRun = this.lastLibraryNewTriggeredAtMs ?? 0;
    if (this.lastLibraryNewTriggeredAtMs !== null && now - lastRun < this.libraryNewDebounceMs) {
      return;
    }
    this.lastLibraryNewTriggeredAtMs = now;

    // Use the newest item as representative metadata for logs + job input.
    const newest = [...newItems].sort(
      (a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0),
    )[newItems.length - 1]!;

    const mediaType = (newest.type ?? '').toLowerCase();
    if (!['movie', 'show', 'season', 'episode'].includes(mediaType)) return;

    const title = newest.title ?? '';
    const ratingKey = newest.ratingKey ?? '';

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
        addedAt: newest.addedAt ?? undefined,
        librarySectionID: newest.librarySectionId ?? undefined,
        librarySectionTitle: newest.librarySectionTitle ?? undefined,
      },
      source: {
        type: 'plexPolling',
        newlyAddedCount: newItems.length,
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
        showTitle: newest.grandparentTitle || null,
        showRatingKey: newest.grandparentRatingKey || null,
        seasonNumber: newest.parentIndex ?? null,
        episodeNumber: newest.index ?? null,
        persistedPath: persisted.path,
        newlyAddedCount: newItems.length,
        newestAddedAt: newest.addedAt ?? null,
      } as const;

      const run = await this.jobsService.runJob({
        jobId: 'mediaAddedCleanup',
        trigger: 'manual',
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
    return {
      ...s,
      lastSeenAtMs: nowMs,
      lastViewOffsetMs: s.viewOffsetMs ?? null,
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
      lastSeenAtMs: nowMs,
      lastViewOffsetMs,
    };
  }

  private async handleEndedSession(params: {
    userId: string;
    prev: SessionSnapshot;
    settings: Record<string, unknown>;
  }) {
    const { userId, prev, settings } = params;

    // Only trigger for video scrobbles (movie/episode).
    if (prev.type !== 'movie' && prev.type !== 'episode') return;

    const duration = prev.durationMs ?? null;
    const viewOffset = prev.lastViewOffsetMs ?? prev.viewOffsetMs ?? null;

    if (!duration || duration < this.minDurationMs) return;
    if (!viewOffset || viewOffset <= 0) return;

    const ratio = Math.min(1, viewOffset / duration);
    if (ratio < this.scrobbleThreshold) return;

    // De-dupe across short time windows (protects against both polling quirks and "double triggers"
    // if the user ever enables Plex webhooks too).
    const dedupeKey = `${prev.type}:${prev.ratingKey ?? 'unknown'}:${prev.librarySectionId ?? 'unknown'}`;
    const now = Date.now();
    const last = this.recentTriggers.get(dedupeKey) ?? 0;
    if (now - last < PlexPollingService.RECENT_TRIGGER_TTL_MS) return;
    this.recentTriggers.set(dedupeKey, now);

    // Respect per-job auto-run toggles (same settings as webhooks).
    const watchedEnabled =
      pickBool(settings, 'jobs.webhookEnabled.watchedMovieRecommendations') ?? false;
    const immaculateEnabled =
      pickBool(settings, 'jobs.webhookEnabled.immaculateTastePoints') ?? false;

    if (!watchedEnabled && !immaculateEnabled) return;

    const payload: Record<string, unknown> = {
      event: 'media.scrobble',
      Metadata: {
        type: prev.type,
        title: prev.title ?? undefined,
        year: prev.year ?? undefined,
        ratingKey: prev.ratingKey ?? undefined,
        grandparentTitle: prev.grandparentTitle ?? undefined,
        grandparentRatingKey: prev.grandparentRatingKey ?? undefined,
        parentIndex: prev.parentIndex ?? undefined,
        index: prev.index ?? undefined,
        librarySectionID: prev.librarySectionId ?? undefined,
        librarySectionTitle: prev.librarySectionTitle ?? undefined,
        viewOffset: viewOffset,
        duration: duration,
      },
      Account: {
        title: prev.userTitle ?? undefined,
        id: prev.userId ?? undefined,
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
    const mediaTypeLower = prev.type;
    const showTitle = mediaTypeLower === 'episode' ? (prev.grandparentTitle ?? '') : '';
    const episodeTitle = mediaTypeLower === 'episode' ? (prev.title ?? '') : '';
    const seedTitle = mediaTypeLower === 'episode' ? showTitle : (prev.title ?? '');

    if (!seedTitle) return;

    const payloadInput = {
      source: 'plexPolling',
      plexEvent: 'media.scrobble',
      mediaType: mediaTypeLower,
      seedTitle,
      seedYear: mediaTypeLower === 'movie' ? (prev.year ?? null) : null,
      seedRatingKey: prev.ratingKey ?? null,
      seedLibrarySectionId: prev.librarySectionId ?? null,
      seedLibrarySectionTitle: prev.librarySectionTitle ?? null,
      ...(mediaTypeLower === 'episode'
        ? {
            showTitle: showTitle || null,
            showRatingKey: prev.grandparentRatingKey ?? null,
            seasonNumber: prev.parentIndex ?? null,
            episodeNumber: prev.index ?? null,
            episodeTitle: episodeTitle || null,
          }
        : {}),
      persistedPath: persisted.path,
      progress: ratio,
    } as const;

    const runs: Record<string, string> = {};
    const errors: Record<string, string> = {};
    const skipped: Record<string, string> = {};

    if (!watchedEnabled) {
      skipped.watchedMovieRecommendations = 'disabled';
    } else {
      try {
        const run = await this.jobsService.runJob({
          jobId: 'watchedMovieRecommendations',
          trigger: 'manual',
          dryRun: false,
          userId,
          input: payloadInput,
        });
        runs.watchedMovieRecommendations = run.id;
      } catch (err) {
        errors.watchedMovieRecommendations = (err as Error)?.message ?? String(err);
      }
    }

    if (!immaculateEnabled) {
      skipped.immaculateTastePoints = 'disabled';
    } else {
      try {
        const run = await this.jobsService.runJob({
          jobId: 'immaculateTastePoints',
          trigger: 'manual',
          dryRun: false,
          userId,
          input: payloadInput,
        });
        runs.immaculateTastePoints = run.id;
      } catch (err) {
        errors.immaculateTastePoints = (err as Error)?.message ?? String(err);
      }
    }

    this.webhooksService.logPlexWebhookAutomation({
      plexEvent: 'media.scrobble',
      mediaType: prev.type,
      seedTitle,
      ...(Object.keys(runs).length ? { runs } : {}),
      ...(Object.keys(skipped).length ? { skipped } : {}),
      ...(Object.keys(errors).length ? { errors } : {}),
    });
  }
}

