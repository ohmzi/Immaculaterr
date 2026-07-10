import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type TautulliEnvelope = {
  response?: {
    result?: string;
    message?: string | null;
    data?: unknown;
  };
};

export type TautulliServerInfo = Record<string, unknown>;

export type TautulliHistoryEntry = {
  ratingKey: string | null;
  grandparentRatingKey: string | null;
  mediaType: string | null;
  userId: number | null;
  friendlyName: string | null;
  watchedStatus: number | null;
  percentComplete: number | null;
  date: number | null;
};

export type TautulliLibraryMediaInfoEntry = {
  ratingKey: string | null;
  playCount: number;
  lastPlayed: number | null;
  fileSize: number;
  addedAt: number | null;
};

export type TautulliUser = {
  userId: number;
  username: string | null;
  friendlyName: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

@Injectable()
export class TautulliService {
  private readonly logger = new Logger(TautulliService.name);

  async testConnection(params: { baseUrl: string; apiKey: string }) {
    const data = await this.apiCall<TautulliServerInfo>({
      ...params,
      cmd: 'get_server_info',
      timeoutMs: 8000,
      label: 'test',
    });
    return { ok: true, server: isRecord(data) ? data : {} };
  }

  /**
   * Full play history across all Tautulli-tracked users, newest first.
   * Paginated internally; callers get one flat list.
   */
  async getHistory(params: {
    baseUrl: string;
    apiKey: string;
    maxRecords?: number;
  }): Promise<TautulliHistoryEntry[]> {
    const pageSize = 1000;
    const maxRecords = Math.max(1, params.maxRecords ?? 100000);
    const out: TautulliHistoryEntry[] = [];

    for (let start = 0; start < maxRecords; start += pageSize) {
      const data = await this.apiCall<Record<string, unknown>>({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        cmd: 'get_history',
        query: { start: String(start), length: String(pageSize) },
        timeoutMs: 60000,
        label: 'history',
      });
      const rows =
        isRecord(data) && Array.isArray(data['data'])
          ? (data['data'] as Array<Record<string, unknown>>)
          : [];
      for (const r of rows) {
        out.push({
          ratingKey: toStringOrNull(r['rating_key']),
          grandparentRatingKey: toStringOrNull(r['grandparent_rating_key']),
          mediaType: toStringOrNull(r['media_type']),
          userId: toFiniteNumber(r['user_id']),
          friendlyName: toStringOrNull(r['friendly_name']),
          watchedStatus: toFiniteNumber(r['watched_status']),
          percentComplete: toFiniteNumber(r['percent_complete']),
          date: toFiniteNumber(r['date']),
        });
      }
      const total = isRecord(data)
        ? (toFiniteNumber(data['recordsFiltered']) ??
          toFiniteNumber(data['recordsTotal']))
        : null;
      if (rows.length === 0 || (total !== null && start + pageSize >= total)) {
        break;
      }
    }

    return out;
  }

  /**
   * Per-item play counts / last played / file sizes for one Plex section.
   * Serves as an all-user watch signal plus a size source.
   */
  async getLibraryMediaInfo(params: {
    baseUrl: string;
    apiKey: string;
    sectionId: string;
    maxRecords?: number;
  }): Promise<TautulliLibraryMediaInfoEntry[]> {
    const data = await this.apiCall<Record<string, unknown>>({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      cmd: 'get_library_media_info',
      query: {
        section_id: params.sectionId,
        length: String(Math.max(1, params.maxRecords ?? 100000)),
      },
      timeoutMs: 120000,
      label: 'library media info',
    });
    const rows =
      isRecord(data) && Array.isArray(data['data'])
        ? (data['data'] as Array<Record<string, unknown>>)
        : [];
    return rows.map((r) => ({
      ratingKey: toStringOrNull(r['rating_key']),
      playCount: toFiniteNumber(r['play_count']) ?? 0,
      lastPlayed: toFiniteNumber(r['last_played']),
      fileSize: toFiniteNumber(r['file_size']) ?? 0,
      addedAt: toFiniteNumber(r['added_at']),
    }));
  }

  async getUsers(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<TautulliUser[]> {
    const data = await this.apiCall<unknown>({
      ...params,
      cmd: 'get_users',
      timeoutMs: 20000,
      label: 'users',
    });
    const rows = Array.isArray(data)
      ? (data as Array<Record<string, unknown>>)
      : [];
    const out: TautulliUser[] = [];
    for (const r of rows) {
      const userId = toFiniteNumber(r['user_id']);
      if (userId === null) continue;
      out.push({
        userId: Math.trunc(userId),
        username: toStringOrNull(r['username']),
        friendlyName: toStringOrNull(r['friendly_name']),
      });
    }
    return out;
  }

  private async apiCall<T>(params: {
    baseUrl: string;
    apiKey: string;
    cmd: string;
    query?: Record<string, string>;
    timeoutMs: number;
    label: string;
  }): Promise<T> {
    const { baseUrl, apiKey, cmd, query, timeoutMs, label } = params;
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = new URL('api/v2', normalized);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('cmd', cmd);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const safeUrl = url.toString().replace(apiKey, '***');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Tautulli ${label} failed: HTTP ${res.status} url=${safeUrl}`,
        );
        throw new BadGatewayException(
          `Tautulli ${label} failed: HTTP ${res.status} ${body.slice(0, 200)}`.trim(),
        );
      }

      const payload = (await res.json().catch(() => null)) as unknown;
      const envelope = isRecord(payload) ? (payload as TautulliEnvelope) : null;
      const response = envelope?.response;
      if (!response || response.result !== 'success') {
        const message = response?.message ?? 'unexpected response shape';
        throw new BadGatewayException(
          `Tautulli ${label} failed: ${String(message)}`,
        );
      }
      return response.data as T;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Tautulli ${label} failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
