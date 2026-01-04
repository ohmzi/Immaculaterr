import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

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

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

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
      } finally {
        clearTimeout(timeout);
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
}
