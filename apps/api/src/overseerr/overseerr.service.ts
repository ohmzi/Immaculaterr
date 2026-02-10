import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

export type OverseerrRequestStatus = 'requested' | 'exists' | 'failed';

export type OverseerrRequestResult = {
  status: OverseerrRequestStatus;
  requestId: number | null;
  error: string | null;
};

export type OverseerrClearAllRequestsResult = {
  total: number;
  deleted: number;
  failed: number;
  failedRequestIds: number[];
};

type OverseerrAuthMe = Record<string, unknown>;
type OverseerrRequestResponse = Record<string, unknown>;
type OverseerrRequestListResponse = {
  results?: unknown;
};

@Injectable()
export class OverseerrService {
  private readonly logger = new Logger(OverseerrService.name);

  async testConnection(params: { baseUrl: string; apiKey: string }) {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, '/auth/me');

    this.logger.log(`Testing Overseerr connection: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': apiKey,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Overseerr test failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as OverseerrAuthMe;
      return { ok: true, user: data };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Overseerr test failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestMovie(params: {
    baseUrl: string;
    apiKey: string;
    tmdbId: number;
    is4k?: boolean;
  }): Promise<OverseerrRequestResult> {
    return this.requestMedia({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      payload: {
        mediaType: 'movie',
        mediaId: Math.trunc(params.tmdbId),
        ...(typeof params.is4k === 'boolean' ? { is4k: params.is4k } : {}),
      },
    });
  }

  async requestTvAllSeasons(params: {
    baseUrl: string;
    apiKey: string;
    tmdbId: number;
    tvdbId: number;
    is4k?: boolean;
  }): Promise<OverseerrRequestResult> {
    return this.requestMedia({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      payload: {
        mediaType: 'tv',
        mediaId: Math.trunc(params.tmdbId),
        tvdbId: Math.trunc(params.tvdbId),
        seasons: 'all',
        ...(typeof params.is4k === 'boolean' ? { is4k: params.is4k } : {}),
      },
    });
  }

  async clearAllRequests(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<OverseerrClearAllRequestsResult> {
    const { baseUrl, apiKey } = params;
    const requestIds = await this.listAllRequestIds({ baseUrl, apiKey });
    if (!requestIds.length) {
      return { total: 0, deleted: 0, failed: 0, failedRequestIds: [] };
    }

    let deleted = 0;
    const failedRequestIds: number[] = [];

    for (const requestId of requestIds) {
      const url = this.buildApiUrl(baseUrl, `/request/${requestId}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch(url, {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            'X-Api-Key': apiKey,
          },
          signal: controller.signal,
        });

        // Treat already-missing request IDs as deleted; this can happen under race.
        if (res.ok || res.status === 404) {
          deleted += 1;
          continue;
        }

        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Overseerr request delete failed (${requestId}): HTTP ${res.status} ${body}`.trim(),
        );
        failedRequestIds.push(requestId);
      } catch (err) {
        this.logger.warn(
          `Overseerr request delete failed (${requestId}): ${(err as Error)?.message ?? String(err)}`,
        );
        failedRequestIds.push(requestId);
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      total: requestIds.length,
      deleted,
      failed: failedRequestIds.length,
      failedRequestIds,
    };
  }

  private async requestMedia(params: {
    baseUrl: string;
    apiKey: string;
    payload: Record<string, unknown>;
  }): Promise<OverseerrRequestResult> {
    const { baseUrl, apiKey, payload } = params;
    const url = this.buildApiUrl(baseUrl, '/request');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (res.ok) {
        const data =
          (await res.json().catch(() => null)) as OverseerrRequestResponse | null;
        const requestId =
          typeof data?.id === 'number' && Number.isFinite(data.id)
            ? Math.trunc(data.id)
            : null;
        return {
          status: 'requested',
          requestId,
          error: null,
        };
      }

      const body = await res.text().catch(() => '');
      const lower = body.toLowerCase();
      if (this.isDuplicateLike(res.status, lower)) {
        return {
          status: 'exists',
          requestId: null,
          error: null,
        };
      }

      const message =
        `Overseerr request failed: HTTP ${res.status} ${body}`.trim();
      return {
        status: 'failed',
        requestId: null,
        error: message,
      };
    } catch (err) {
      return {
        status: 'failed',
        requestId: null,
        error: `Overseerr request failed: ${(err as Error)?.message ?? String(err)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private isDuplicateLike(status: number, bodyLower: string): boolean {
    if (status === 409) return true;
    if (![400, 422].includes(status)) return false;

    return (
      bodyLower.includes('already') ||
      bodyLower.includes('exists') ||
      bodyLower.includes('duplicate') ||
      bodyLower.includes('requested') ||
      bodyLower.includes('pending')
    );
  }

  private async listAllRequestIds(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<number[]> {
    const { baseUrl, apiKey } = params;
    const take = 100;
    let skip = 0;
    const requestIds: number[] = [];
    const seen = new Set<number>();

    for (;;) {
      const url = this.buildApiUrl(baseUrl, `/request?take=${take}&skip=${skip}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Api-Key': apiKey,
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new BadGatewayException(
            `Overseerr list requests failed: HTTP ${res.status} ${body}`.trim(),
          );
        }

        const data = (await res.json()) as OverseerrRequestListResponse;
        const rows = Array.isArray(data?.results) ? data.results : [];
        for (const row of rows) {
          const requestId = this.parseRequestId(row);
          if (requestId === null || seen.has(requestId)) continue;
          seen.add(requestId);
          requestIds.push(requestId);
        }

        if (rows.length < take) break;
        skip += take;
      } catch (err) {
        if (err instanceof BadGatewayException) throw err;
        throw new BadGatewayException(
          `Overseerr list requests failed: ${(err as Error)?.message ?? String(err)}`,
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    return requestIds;
  }

  private parseRequestId(value: unknown): number | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = (value as Record<string, unknown>).id;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === 'string' && raw.trim()) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  private buildApiUrl(baseUrlRaw: string, path: string): string {
    const normalizedInput = this.normalizeHttpUrl(baseUrlRaw);
    const parsed = new URL(normalizedInput);

    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    const lowerPath = normalizedPath.toLowerCase();
    const rootPath = lowerPath.endsWith('/api/v1')
      ? normalizedPath.slice(0, normalizedPath.length - '/api/v1'.length)
      : normalizedPath;

    parsed.pathname = `${rootPath || ''}/`;

    const apiPath = path.replace(/^\/+/, '');
    return new URL(`api/v1/${apiPath}`, parsed.toString()).toString();
  }

  private normalizeHttpUrl(raw: string): string {
    const trimmed = raw.trim();
    const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new BadGatewayException('baseUrl must be a valid http(s) URL');
    }
    return baseUrl;
  }
}
