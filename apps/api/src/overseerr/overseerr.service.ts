import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type OverseerrStatus = Record<string, unknown>;
type OverseerrSettingsMain = Record<string, unknown>;

@Injectable()
export class OverseerrService {
  private readonly logger = new Logger(OverseerrService.name);

  async testConnection(params: { baseUrl: string; apiKey: string }) {
    const baseUrl = params.baseUrl.trim();
    const apiKey = params.apiKey.trim();

    const statusUrl = this.buildApiUrl(baseUrl, 'api/v1/status');
    const settingsUrl = this.buildApiUrl(baseUrl, 'api/v1/settings/main');

    this.logger.log(`Testing Overseerr connection: ${statusUrl}`);

    const status = (await this.getJson(
      statusUrl,
      undefined,
    )) as OverseerrStatus;
    const settings = (await this.getJson(
      settingsUrl,
      apiKey,
    )) as OverseerrSettingsMain;

    // Return a small subset from settings to avoid dumping everything.
    const summary = {
      applicationTitle:
        typeof settings['applicationTitle'] === 'string'
          ? settings['applicationTitle']
          : null,
      applicationUrl:
        typeof settings['applicationUrl'] === 'string'
          ? settings['applicationUrl']
          : null,
    };

    return { ok: true, status, summary };
  }

  private async getJson(url: string, apiKey?: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (apiKey) {
        headers['X-Api-Key'] = apiKey;
      }

      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Overseerr request failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Overseerr request failed: ${(err as Error)?.message ?? String(err)}`,
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
