import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { PlexActivityDetails } from './plex-server.service';
import { PlexServerService } from './plex-server.service';

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

function errToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

type PollStatus = 'unknown' | 'not_configured' | 'ok' | 'error';

type ActivitySnapshot = PlexActivityDetails & {
  lastLoggedAtMs: number;
  lastLoggedProgress: number | null;
  lastLoggedSubtitle: string | null;
};

@Injectable()
export class PlexActivitiesMonitorService implements OnModuleInit {
  private readonly logger = new Logger(PlexActivitiesMonitorService.name);

  private status: PollStatus = 'unknown';
  private lastError: string | null = null;
  private lastNoisyErrorLogAtMs: number | null = null;

  private readonly lastByUuid = new Map<string, ActivitySnapshot>();

  private static readonly INTERVAL_MS = 5_000;
  private static readonly ERROR_REMINDER_MS = 10 * 60_000;

  onModuleInit() {
    // Wait a bit after startup so Plex/base settings have time to load.
    setTimeout(() => void this.checkOnce(), 12_000);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
  ) {}

  @Interval(PlexActivitiesMonitorService.INTERVAL_MS)
  async poll() {
    await this.checkOnce();
  }

  private async checkOnce() {
    const user = await this.prisma.user
      .findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
      .catch(() => null);
    const userId = user?.id ?? null;
    if (!userId) return;

    const { settings, secrets } = await this.settingsService
      .getInternalSettings(userId)
      .catch(() => ({
        settings: {} as Record<string, unknown>,
        secrets: {} as Record<string, unknown>,
      }));

    const baseUrl = pickString(settings as Record<string, unknown>, 'plex.baseUrl');
    const token = pickString(secrets as Record<string, unknown>, 'plex.token');

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
    } catch (err) {
      const ms = Date.now() - startedAt;
      const msg = errToMessage(err);
      this.setStatus('error', msg, { ms });
    }
  }

  private setStatus(
    next: PollStatus,
    error: string | null,
    meta?: Record<string, unknown>,
  ) {
    const now = Date.now();
    const changed = next !== this.status;

    if (changed) {
      this.status = next;
      this.lastError = error;
      this.lastNoisyErrorLogAtMs = null;

      if (next === 'error') {
        this.logger.warn(
          `Plex activities polling: FAILED error=${JSON.stringify(error ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
        this.lastNoisyErrorLogAtMs = now;
      } else if (next === 'ok') {
        this.logger.debug(
          `Plex activities polling: OK${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
      } else if (next === 'not_configured') {
        this.logger.debug(
          `Plex activities polling: not configured${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
      }
      return;
    }

    if (next === 'error') {
      const last = this.lastNoisyErrorLogAtMs ?? 0;
      if (now - last >= PlexActivitiesMonitorService.ERROR_REMINDER_MS) {
        this.logger.warn(
          `Plex activities polling: still FAILING error=${JSON.stringify(error ?? this.lastError ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
        this.lastNoisyErrorLogAtMs = now;
      }
    }

    this.lastError = error ?? this.lastError;
  }

  private diffAndLog(next: PlexActivityDetails[]) {
    const now = Date.now();
    const nextUuids = new Set(next.map((a) => a.uuid));

    // Log ended activities.
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

    // Log started/updated activities.
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

      const progressChanged =
        act.progress !== null &&
        (prev.lastLoggedProgress === null ||
          Math.abs(act.progress - prev.lastLoggedProgress) >= 1);
      const subtitleChanged =
        (act.subtitle ?? null) !== (prev.lastLoggedSubtitle ?? null);
      const otherChanged =
        act.type !== prev.type ||
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
      } else {
        // No meaningful change; keep snapshot but do not spam logs.
        this.lastByUuid.set(act.uuid, { ...prev, ...act });
      }
    }
  }

  private logProgressIfUseful(params: { act: PlexActivityDetails; when: 'start' | 'subtitle' | 'progress' }) {
    const { act, when } = params;
    if (when === 'progress') return;

    const raw = (act.subtitle ?? act.title ?? '').trim();
    if (!raw) return;
    const message = /^scanning\b/i.test(raw) ? raw : `Scanning ${raw}`;

    this.logger.debug({
      NotificationContainer: {
        type: 'progress',
        size: 1,
        ProgressNotification: [{ message }],
      },
    });
  }
}

