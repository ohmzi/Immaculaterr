import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';

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

function errToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(baseUrl);
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

type ServiceKey = 'tmdb' | 'radarr' | 'sonarr' | 'openai' | 'google' | 'overseerr';
type ServiceStatus = 'unknown' | 'not_configured' | 'online' | 'offline';

@Injectable()
export class IntegrationsConnectivityMonitorService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationsConnectivityMonitorService.name);

  // Poll regularly but only log on change / sustained failure.
  private static readonly INTERVAL_MS = 5 * 60_000;
  private static readonly OFFLINE_REMINDER_MS = 15 * 60_000;
  private static readonly FAILS_TO_MARK_OFFLINE = 2;

  private readonly state = new Map<
    ServiceKey,
    {
      status: ServiceStatus;
      consecutiveFails: number;
      lastError: string | null;
      lastNoisyOfflineLogAtMs: number | null;
    }
  >();

  onModuleInit() {
    setTimeout(() => void this.checkOnce(), 12_000);
  }

  @Interval(IntegrationsConnectivityMonitorService.INTERVAL_MS)
  async poll() {
    await this.checkOnce();
  }

  private getState(key: ServiceKey) {
    const existing = this.state.get(key);
    if (existing) return existing;
    const init = {
      status: 'unknown' as ServiceStatus,
      consecutiveFails: 0,
      lastError: null,
      lastNoisyOfflineLogAtMs: null,
    };
    this.state.set(key, init);
    return init;
  }

  private setStatus(
    key: ServiceKey,
    next: ServiceStatus,
    error: string | null,
    meta?: Record<string, unknown>,
  ) {
    const now = Date.now();
    const st = this.getState(key);
    const changed = next !== st.status;

    if (changed) {
      st.status = next;
      st.lastError = error;
      st.lastNoisyOfflineLogAtMs = null;

      if (next === 'online') {
        this.logger.log(
          `Integration connectivity: ${key.toUpperCase()} ONLINE${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
      } else if (next === 'offline') {
        this.logger.warn(
          `Integration connectivity: ${key.toUpperCase()} OFFLINE error=${JSON.stringify(error ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
        st.lastNoisyOfflineLogAtMs = now;
      } else if (next === 'not_configured') {
        this.logger.debug(
          `Integration connectivity: ${key.toUpperCase()} not configured${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
      }
      return;
    }

    if (next === 'offline') {
      const last = st.lastNoisyOfflineLogAtMs ?? 0;
      if (now - last >= IntegrationsConnectivityMonitorService.OFFLINE_REMINDER_MS) {
        this.logger.warn(
          `Integration connectivity: ${key.toUpperCase()} still OFFLINE error=${JSON.stringify(error ?? st.lastError ?? 'unknown')}${meta ? ` ${JSON.stringify(meta)}` : ''}`,
        );
        st.lastNoisyOfflineLogAtMs = now;
      }
    }

    st.lastError = error ?? st.lastError;
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

    const s = settings as Record<string, unknown>;
    const sec = secrets as Record<string, unknown>;

    await Promise.all([
      this.checkTmdb(s, sec),
      this.checkRadarr(s, sec),
      this.checkSonarr(s, sec),
      this.checkOverseerr(s, sec),
      this.checkOpenAi(s, sec),
      this.checkGoogle(s, sec),
    ]);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  private async checkTmdb(settings: Record<string, unknown>, secrets: Record<string, unknown>) {
    const apiKey =
      pickString(secrets, 'tmdb.apiKey') ||
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

  private async checkRadarr(settings: Record<string, unknown>, secrets: Record<string, unknown>) {
    const enabled =
      (pickBool(settings, 'radarr.enabled') ?? Boolean(pickString(secrets, 'radarr.apiKey'))) &&
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

  private async checkSonarr(settings: Record<string, unknown>, secrets: Record<string, unknown>) {
    const enabled =
      (pickBool(settings, 'sonarr.enabled') ?? Boolean(pickString(secrets, 'sonarr.apiKey'))) &&
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

  private async checkOverseerr(settings: Record<string, unknown>, secrets: Record<string, unknown>) {
    const enabled =
      (pickBool(settings, 'overseerr.enabled') ?? Boolean(pickString(secrets, 'overseerr.apiKey'))) &&
      Boolean(pickString(settings, 'overseerr.baseUrl')) &&
      Boolean(pickString(secrets, 'overseerr.apiKey'));
    if (!enabled) {
      this.setStatus('overseerr', 'not_configured', null, {
        reason: 'disabled_or_missing',
      });
      return;
    }

    const baseUrl = normalizeHttpUrl(pickString(settings, 'overseerr.baseUrl'));
    const apiKey = pickString(secrets, 'overseerr.apiKey');
    const root = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const rootPath = root.pathname.replace(/\/+$/, '');
    root.pathname = rootPath.toLowerCase().endsWith('/api/v1')
      ? `${rootPath.slice(0, rootPath.length - '/api/v1'.length) || ''}/`
      : `${rootPath || ''}/`;
    const url = new URL('api/v1/auth/me', root.toString()).toString();

    await this.probeHttp('overseerr', url, {
      headers: { Accept: 'application/json', 'X-Api-Key': apiKey },
      timeoutMs: 10_000,
    });
  }

  private async checkOpenAi(settings: Record<string, unknown>, secrets: Record<string, unknown>) {
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

  private async checkGoogle(settings: Record<string, unknown>, secrets: Record<string, unknown>) {
    const enabled =
      (pickBool(settings, 'google.enabled') ?? false) &&
      Boolean(pickString(secrets, 'google.apiKey')) &&
      Boolean(pickString(settings, 'google.searchEngineId'));
    if (!enabled) {
      this.setStatus('google', 'not_configured', null, { reason: 'disabled_or_missing' });
      return;
    }

    // Keep this extremely lightweight to avoid burning quota; 1 result only, simple query.
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

  private async probeHttp(
    key: ServiceKey,
    url: string,
    params: { headers: Record<string, string>; timeoutMs: number },
  ) {
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

      if (st.consecutiveFails >= IntegrationsConnectivityMonitorService.FAILS_TO_MARK_OFFLINE) {
        this.setStatus(key, 'offline', msg, { ms });
      }
    } catch (err) {
      const ms = Date.now() - startedAt;
      const msg = errToMessage(err);
      st.consecutiveFails += 1;
      st.lastError = msg;
      if (st.consecutiveFails >= IntegrationsConnectivityMonitorService.FAILS_TO_MARK_OFFLINE) {
        this.setStatus(key, 'offline', msg, { ms });
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
