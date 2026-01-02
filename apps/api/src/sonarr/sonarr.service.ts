import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type SonarrSystemStatus = Record<string, unknown>;
export type SonarrSeries = Record<string, unknown> & {
  id: number;
  title?: string;
  tvdbId?: number;
  monitored?: boolean;
  seasons?: Array<Record<string, unknown> & { seasonNumber?: number; monitored?: boolean }>;
};

export type SonarrEpisode = Record<string, unknown> & {
  id: number;
  seasonNumber?: number;
  episodeNumber?: number;
  monitored?: boolean;
};

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

  async listSeries(params: { baseUrl: string; apiKey: string }): Promise<SonarrSeries[]> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/series');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

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
          `Sonarr list series failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as SonarrSeries[]) : [];
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr list series failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listMonitoredSeries(params: { baseUrl: string; apiKey: string }): Promise<SonarrSeries[]> {
    const series = await this.listSeries(params);
    return series.filter((s) => Boolean(s && s.monitored));
  }

  async getEpisodesBySeries(params: {
    baseUrl: string;
    apiKey: string;
    seriesId: number;
  }): Promise<SonarrEpisode[]> {
    const { baseUrl, apiKey, seriesId } = params;
    const url = this.buildApiUrl(baseUrl, `api/v3/episode?seriesId=${seriesId}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

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
          `Sonarr list episodes failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as SonarrEpisode[]) : [];
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr list episodes failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async setEpisodeMonitored(params: {
    baseUrl: string;
    apiKey: string;
    episode: SonarrEpisode;
    monitored: boolean;
  }): Promise<boolean> {
    const { baseUrl, apiKey, episode, monitored } = params;
    const url = this.buildApiUrl(baseUrl, `api/v3/episode/${episode.id}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const updated: SonarrEpisode = { ...episode, monitored };
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(updated),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr update episode failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr update episode failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async updateSeries(params: { baseUrl: string; apiKey: string; series: SonarrSeries }) {
    const { baseUrl, apiKey, series } = params;
    const url = this.buildApiUrl(baseUrl, `api/v3/series/${series.id}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(series),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr update series failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr update series failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchMonitoredEpisodes(params: { baseUrl: string; apiKey: string }): Promise<boolean> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/command');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify({
          name: 'MissingEpisodeSearch',
          filterKey: 'monitored',
          filterValue: 'true',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr search monitored failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr search monitored failed: ${(err as Error)?.message ?? String(err)}`,
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


