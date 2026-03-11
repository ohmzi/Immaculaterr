import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';

type GoogleCseItem = {
  title?: unknown;
  snippet?: unknown;
  link?: unknown;
};

type GoogleCseResponse = {
  items?: unknown;
};

export type GoogleSearchResult = {
  title: string;
  snippet: string;
  link: string;
};

const GOOGLE_CONNECTIVITY_ERROR_MARKERS = [
  'fetch failed',
  'failed to fetch',
  'network',
  'timeout',
  'timed out',
  'aborted',
  'econnrefused',
  'enotfound',
  'eai_again',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'socket hang up',
  'getaddrinfo',
] as const;

const googleErrorWithCause = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  const cause = (error as { cause?: unknown } | null)?.cause;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : '';
  return `${message}${causeMessage ? ` (cause: ${causeMessage})` : ''}`;
};

const isGoogleConnectivityFailure = (error: unknown): boolean => {
  const message = googleErrorWithCause(error).toLowerCase();
  return GOOGLE_CONNECTIVITY_ERROR_MARKERS.some((marker) =>
    message.includes(marker),
  );
};

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);

  async search(params: {
    apiKey: string;
    cseId: string;
    query: string;
    numResults: number;
  }): Promise<{
    results: GoogleSearchResult[];
    meta: { requested: number; returned: number };
  }> {
    const { results, meta } = await this.executeSearch({
      apiKey: params.apiKey,
      cseId: params.cseId,
      query: params.query,
      numResults: params.numResults,
      purpose: 'runtime',
    });
    return { results, meta };
  }

  async testConnection(params: {
    apiKey: string;
    cseId: string;
    query: string;
    numResults: number;
  }) {
    const { results, meta } = await this.executeSearch({
      apiKey: params.apiKey,
      cseId: params.cseId,
      query: params.query,
      numResults: params.numResults,
      purpose: 'test',
    });
    return { ok: true, results, meta };
  }

  formatForPrompt(results: GoogleSearchResult[]): string {
    const lines: string[] = [];
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      const title = (r.title || '').trim();
      const snippet = (r.snippet || '').trim();
      const link = (r.link || '').trim();
      if (!title && !snippet) continue;
      if (!link) continue;
      lines.push(
        [
          `${i + 1}. ${title || '(untitled)'}`.trim(),
          snippet ? `Snippet: ${snippet}` : null,
          `Link: ${link}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      lines.push(''); // spacer
    }
    return lines.join('\n').trim();
  }

  private coerceWanted(value: number) {
    const n = Number.isFinite(value) ? Math.trunc(value) : 15;
    if (n < 0) return 0;
    return n;
  }

  private async executeSearch(params: {
    apiKey: string;
    cseId: string;
    query: string;
    numResults: number;
    purpose: 'test' | 'runtime';
  }): Promise<{
    results: GoogleSearchResult[];
    meta: { requested: number; returned: number };
  }> {
    const apiKey = params.apiKey.trim();
    const cseId = params.cseId.trim();
    const query = params.query.trim();
    const wanted = this.coerceWanted(params.numResults);

    // Google CSE constraints: num ∈ [1,10] per request; use pagination via start=1,11,21...
    const hardCap = Math.min(wanted, 50);

    if (params.purpose === 'test') {
      this.logger.log(
        `Testing Google CSE: query=${JSON.stringify(query)} wanted=${hardCap}`,
      );
    } else {
      this.logger.log(
        `Google CSE search: query=${JSON.stringify(query)} wanted=${hardCap}`,
      );
    }

    if (hardCap === 0) {
      return {
        results: [] as GoogleSearchResult[],
        meta: { requested: 0, returned: 0 },
      };
    }

    const results: GoogleSearchResult[] = [];
    const seenLinks = new Set<string>();

    let start = 1;
    while (results.length < hardCap) {
      const remaining = hardCap - results.length;
      const pageSize = Math.max(1, Math.min(remaining, 10));

      const url = new URL('https://www.googleapis.com/customsearch/v1');
      url.searchParams.set('key', apiKey);
      url.searchParams.set('cx', cseId);
      url.searchParams.set('q', query);
      url.searchParams.set('num', String(pageSize));
      url.searchParams.set('start', String(start));

      try {
        const res = await this.fetchGoogleResponseWithFallback(url, 15000);

        if (!res.ok) {
          const detail = await this.extractGoogleErrorDetail(res);
          throw new BadGatewayException(
            `Google CSE failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`.trim(),
          );
        }

        const data = (await res.json()) as GoogleCseResponse;
        const items = Array.isArray(data.items)
          ? (data.items as GoogleCseItem[])
          : [];
        if (!items.length) break;

        let added = 0;
        for (const it of items) {
          const title = typeof it.title === 'string' ? it.title.trim() : '';
          const snippet =
            typeof it.snippet === 'string' ? it.snippet.trim() : '';
          const link = typeof it.link === 'string' ? it.link.trim() : '';

          if (!link) continue;
          if (!title && !snippet) continue;
          if (seenLinks.has(link)) continue;

          seenLinks.add(link);
          results.push({ title, snippet, link });
          added++;
          if (results.length >= hardCap) break;
        }

        if (added === 0) break;

        start += pageSize;
        // Google API start index has limits; stop before it becomes invalid
        if (start > 91) break;
      } catch (err) {
        if (err instanceof BadGatewayException) throw err;
        throw new BadGatewayException(
          `Google CSE failed: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }

    return {
      results,
      meta: {
        requested: hardCap,
        returned: results.length,
      },
    };
  }

  private async extractGoogleErrorDetail(res: Response) {
    // Try to surface Google's structured error (very helpful for 403s / API not enabled / billing)
    try {
      const payload = (await res.json()) as unknown;
      if (!payload || typeof payload !== 'object') return '';
      const err = (payload as Record<string, unknown>)['error'];
      if (!err || typeof err !== 'object') return '';

      const msg = (err as Record<string, unknown>)['message'];
      const errors = (err as Record<string, unknown>)['errors'];
      let reason: unknown = null;
      if (
        Array.isArray(errors) &&
        errors.length &&
        errors[0] &&
        typeof errors[0] === 'object'
      ) {
        reason = (errors[0] as Record<string, unknown>)['reason'] ?? null;
      }

      return `message=${JSON.stringify(msg)} reason=${JSON.stringify(reason)}`;
    } catch {
      try {
        const text = await res.text();
        return text ? `body=${JSON.stringify(text.slice(0, 300))}` : '';
      } catch {
        return '';
      }
    }
  }

  private async fetchGoogleResponseWithFallback(
    url: URL,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (primaryError) {
      if (!isGoogleConnectivityFailure(primaryError)) throw primaryError;

      this.logger.warn(
        `Google CSE connectivity failure on ${url.pathname}; retrying with IPv4 fallback`,
      );
      try {
        return await this.fetchGoogleResponseWithIpv4(url, timeoutMs);
      } catch (fallbackError) {
        throw new Error(
          `${googleErrorWithCause(primaryError)} (ipv4 fallback failed: ${googleErrorWithCause(fallbackError)})`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchGoogleResponseWithIpv4(
    url: URL,
    timeoutMs: number,
  ): Promise<Response> {
    const records = await lookup(url.hostname, { family: 4, all: true });
    const ipv4Addresses = Array.from(
      new Set(records.map((record) => record.address.trim()).filter(Boolean)),
    );
    if (!ipv4Addresses.length) {
      throw new Error(`No IPv4 records found for ${url.hostname}`);
    }

    let lastConnectivityError: unknown = null;
    for (const ipv4Address of ipv4Addresses) {
      try {
        return await this.fetchGoogleResponseFromIpv4Address(
          url,
          ipv4Address,
          timeoutMs,
        );
      } catch (attemptError) {
        lastConnectivityError = attemptError;
        if (!isGoogleConnectivityFailure(attemptError)) throw attemptError;
      }
    }

    if (lastConnectivityError instanceof Error) throw lastConnectivityError;
    throw new Error(`Unable to reach ${url.hostname} over IPv4 fallback`);
  }

  private async fetchGoogleResponseFromIpv4Address(
    url: URL,
    ipv4Address: string,
    timeoutMs: number,
  ): Promise<Response> {
    return await new Promise<Response>((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: 'https:',
          hostname: ipv4Address,
          port: Number.parseInt(url.port || '443', 10),
          method: 'GET',
          path: `${url.pathname}${url.search}`,
          headers: {
            Accept: 'application/json',
            Host: url.host,
          },
          servername: url.hostname,
          family: 4,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer | string) => {
            chunks.push(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'),
            );
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') {
                headers.set(key, value);
              } else if (Array.isArray(value)) {
                headers.set(key, value.join(', '));
              }
            }
            resolve(
              new Response(body, {
                status: res.statusCode ?? 0,
                headers,
              }),
            );
          });
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Google IPv4 fallback request timed out'));
      });
      req.on('error', reject);
      req.end();
    });
  }
}
