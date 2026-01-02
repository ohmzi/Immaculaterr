import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type TmdbConfiguration = Record<string, unknown>;

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);

  async testConnection(params: { apiKey: string }) {
    const apiKey = params.apiKey.trim();

    this.logger.log('Testing TMDB connection');

    const url = new URL('https://api.themoviedb.org/3/configuration');
    url.searchParams.set('api_key', apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `TMDB test failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as TmdbConfiguration;

      // Return a small subset + raw for now; we’ll store settings later.
      const images = (data['images'] ?? null) as Record<string, unknown> | null;
      const secureBaseUrl =
        images && typeof images['secure_base_url'] === 'string'
          ? (images['secure_base_url'] as string)
          : null;

      return {
        ok: true,
        summary: {
          secureBaseUrl,
        },
        configuration: data,
      };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `TMDB test failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}


