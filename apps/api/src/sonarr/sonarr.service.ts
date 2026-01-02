import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type SonarrSystemStatus = Record<string, unknown>;

@Injectable()
export class SonarrService {
  private readonly logger = new Logger(SonarrService.name);

  async testConnection(params: { baseUrl: string; apiKey: string }) {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/system/status');

    this.logger.log(`Testing Sonarr connection: ${url}`);

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
          `Sonarr test failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as SonarrSystemStatus;
      return { ok: true, status: data };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr test failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildApiUrl(baseUrl: string, path: string) {
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL(path, normalized).toString();
  }
}


