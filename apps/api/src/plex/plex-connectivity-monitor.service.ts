import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
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

type PlexConnectivityStatus = 'unknown' | 'not_configured' | 'online' | 'offline';

@Injectable()
export class PlexConnectivityMonitorService implements OnModuleInit {
  private readonly logger = new Logger(PlexConnectivityMonitorService.name);
  private status: PlexConnectivityStatus = 'unknown';
  private lastError: string | null = null;
  private lastStatusChangeAtMs: number | null = null;
  private lastNoisyOfflineLogAtMs: number | null = null;

  // Poll often enough to catch outages, but avoid log spam by only logging on change.
  private static readonly INTERVAL_MS = 60_000;
  private static readonly OFFLINE_REMINDER_MS = 10 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
  ) {}

  onModuleInit() {
    // Run once shortly after startup so /logs has an immediate signal.
    setTimeout(() => void this.checkOnce(), 8_000);
  }

  @Interval(PlexConnectivityMonitorService.INTERVAL_MS)
  async poll() {
    await this.checkOnce();
  }

  private async checkOnce() {
    // Pick the first user (matches scheduler behavior). This app is effectively single-tenant.
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
    } catch (err) {
      const ms = Date.now() - startedAt;
      const msg = errToMessage(err);
      this.setStatus('offline', msg, { baseUrl, ms });
    }
  }

  private setStatus(
    next: PlexConnectivityStatus,
    error: string | null,
    meta?: Record<string, unknown>,
  ) {
    const now = Date.now();
    const changed = next !== this.status;

    if (changed) {
      this.status = next;
      this.lastError = error;
      this.lastStatusChangeAtMs = now;
      this.lastNoisyOfflineLogAtMs = null;

      if (next === 'online') {
        this.logger.log(
          `Plex connectivity: ONLINE${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
      } else if (next === 'offline') {
        this.logger.warn(
          `Plex connectivity: OFFLINE error=${JSON.stringify(error ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
        this.lastNoisyOfflineLogAtMs = now;
      } else if (next === 'not_configured') {
        this.logger.debug(
          `Plex connectivity: not configured${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
      }
      return;
    }

    // Same status: avoid spam. If we're offline, emit a periodic reminder.
    if (next === 'offline') {
      const last = this.lastNoisyOfflineLogAtMs ?? 0;
      if (now - last >= PlexConnectivityMonitorService.OFFLINE_REMINDER_MS) {
        this.logger.warn(
          `Plex connectivity: still OFFLINE error=${JSON.stringify(error ?? this.lastError ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
        this.lastNoisyOfflineLogAtMs = now;
      }
    }

    this.lastError = error ?? this.lastError;
  }
}

