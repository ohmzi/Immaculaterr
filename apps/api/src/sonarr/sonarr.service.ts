import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type SonarrSystemStatus = Record<string, unknown>;
export type SonarrSeries = Record<string, unknown> & {
  id: number;
  title?: string;
  tvdbId?: number;
  monitored?: boolean;
  year?: number;
  added?: string;
  status?: string;
  ended?: boolean;
  path?: string;
  rootFolderPath?: string;
  tags?: number[];
  ratings?: Record<string, unknown> & { value?: number; votes?: number };
  statistics?: Record<string, unknown> & {
    seasonCount?: number;
    episodeCount?: number;
    episodeFileCount?: number;
    totalEpisodeCount?: number;
    sizeOnDisk?: number;
  };
  seasons?: Array<
    Record<string, unknown> & { seasonNumber?: number; monitored?: boolean }
  >;
};

export type SonarrEpisode = Record<string, unknown> & {
  id: number;
  seasonNumber?: number;
  episodeNumber?: number;
  monitored?: boolean;
  hasFile?: boolean;
  episodeFileId?: number;
};

export type SonarrEpisodeFile = {
  id: number;
  seriesId: number | null;
  seasonNumber: number | null;
  path: string;
  relativePath: string | null;
  size: number;
};

export type SonarrHistoryRecord = {
  id: number;
  episodeId: number | null;
  eventType: string | null;
  sourceTitle: string | null;
  date: string | null;
};

export type SonarrRootFolder = {
  id: number;
  path: string;
};

export type SonarrQualityProfile = {
  id: number;
  name: string;
};

export type SonarrTag = {
  id: number;
  label: string;
};

export type SonarrDiskSpace = {
  path: string;
  label: string | null;
  freeSpace: number;
  totalSpace: number;
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

  async listSeries(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<SonarrSeries[]> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/series');

    const controller = new AbortController();
    // Large libraries can take a while to serialize with statistics included.
    const timeout = setTimeout(() => controller.abort(), 60000);

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

  async listMonitoredSeries(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<SonarrSeries[]> {
    const series = await this.listSeries(params);
    return series.filter((s) => Boolean(s?.monitored));
  }

  async getEpisodesBySeries(params: {
    baseUrl: string;
    apiKey: string;
    seriesId: number;
  }): Promise<SonarrEpisode[]> {
    const { baseUrl, apiKey, seriesId } = params;
    const url = this.buildApiUrl(
      baseUrl,
      `api/v3/episode?seriesId=${seriesId}`,
    );

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

  async updateSeries(params: {
    baseUrl: string;
    apiKey: string;
    series: SonarrSeries;
  }) {
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

  async searchMonitoredEpisodes(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<boolean> {
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

  async listRootFolders(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<SonarrRootFolder[]> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/rootfolder');

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
          `Sonarr list root folders failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: SonarrRootFolder[] = [];
      for (const r of rows) {
        const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
        const path = typeof r['path'] === 'string' ? r['path'].trim() : '';
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!path) continue;
        out.push({ id: Math.trunc(id), path });
      }
      return out;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr list root folders failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listQualityProfiles(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<SonarrQualityProfile[]> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/qualityprofile');

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
          `Sonarr list quality profiles failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: SonarrQualityProfile[] = [];
      for (const r of rows) {
        const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
        const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!name) continue;
        out.push({ id: Math.trunc(id), name });
      }
      return out;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr list quality profiles failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listTags(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<SonarrTag[]> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/tag');

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
          `Sonarr list tags failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: SonarrTag[] = [];
      for (const r of rows) {
        const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
        const label = typeof r['label'] === 'string' ? r['label'].trim() : '';
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!label) continue;
        out.push({ id: Math.trunc(id), label });
      }
      return out;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr list tags failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async lookupSeries(params: {
    baseUrl: string;
    apiKey: string;
    term: string;
  }): Promise<SonarrSeries[]> {
    const { baseUrl, apiKey } = params;
    const term = (params.term ?? '').trim();
    if (!term) return [];

    const url = this.buildApiUrl(
      baseUrl,
      `api/v3/series/lookup?term=${encodeURIComponent(term)}`,
    );

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
          `Sonarr lookup series failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as SonarrSeries[]) : [];
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr lookup series failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async addSeries(params: {
    baseUrl: string;
    apiKey: string;
    title: string;
    tvdbId: number;
    qualityProfileId: number;
    rootFolderPath: string;
    tags?: number[];
    monitored?: boolean;
    searchForMissingEpisodes?: boolean;
    searchForCutoffUnmetEpisodes?: boolean;
  }): Promise<{ status: 'added' | 'exists'; series: SonarrSeries | null }> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/series');

    const payload = {
      title: params.title,
      tvdbId: Math.trunc(params.tvdbId),
      qualityProfileId: Math.trunc(params.qualityProfileId),
      rootFolderPath: params.rootFolderPath,
      tags: Array.isArray(params.tags)
        ? params.tags.map((t) => Math.trunc(t))
        : undefined,
      monitored: params.monitored ?? true,
      addOptions: {
        searchForMissingEpisodes: params.searchForMissingEpisodes ?? true,
        searchForCutoffUnmetEpisodes:
          params.searchForCutoffUnmetEpisodes ?? true,
      },
    };

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
        const data = (await res.json().catch(() => null)) as unknown;
        return { status: 'added', series: (data as SonarrSeries) ?? null };
      }

      const body = await res.text().catch(() => '');
      const lower = body.toLowerCase();
      if (
        res.status === 400 &&
        (lower.includes('already been added') ||
          lower.includes('already exists') ||
          lower.includes('series exists'))
      ) {
        this.logger.log(
          `Sonarr add series: already exists tvdbId=${params.tvdbId} title=${JSON.stringify(
            params.title,
          )}`,
        );
        return { status: 'exists', series: null };
      }

      throw new BadGatewayException(
        `Sonarr add series failed: HTTP ${res.status} ${body}`.trim(),
      );
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr add series failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getEpisodeFiles(params: {
    baseUrl: string;
    apiKey: string;
    seriesId: number;
  }): Promise<SonarrEpisodeFile[]> {
    const { baseUrl, apiKey, seriesId } = params;
    const url = this.buildApiUrl(
      baseUrl,
      `api/v3/episodefile?seriesId=${seriesId}`,
    );

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
          `Sonarr list episode files failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: SonarrEpisodeFile[] = [];
      for (const r of rows) {
        const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
        if (!Number.isFinite(id) || id <= 0) continue;
        const path = typeof r['path'] === 'string' ? r['path'].trim() : '';
        if (!path) continue;
        const seriesIdRaw =
          typeof r['seriesId'] === 'number'
            ? r['seriesId']
            : Number(r['seriesId']);
        const seasonRaw =
          typeof r['seasonNumber'] === 'number'
            ? r['seasonNumber']
            : Number(r['seasonNumber']);
        const relativePath =
          typeof r['relativePath'] === 'string' ? r['relativePath'].trim() : '';
        const sizeRaw =
          typeof r['size'] === 'number' ? r['size'] : Number(r['size']);
        out.push({
          id: Math.trunc(id),
          seriesId: Number.isFinite(seriesIdRaw)
            ? Math.trunc(seriesIdRaw)
            : null,
          seasonNumber: Number.isFinite(seasonRaw)
            ? Math.trunc(seasonRaw)
            : null,
          path,
          relativePath: relativePath || null,
          size: Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : 0,
        });
      }
      return out;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr list episode files failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteEpisodeFile(params: {
    baseUrl: string;
    apiKey: string;
    episodeFileId: number;
  }): Promise<boolean> {
    const { baseUrl, apiKey, episodeFileId } = params;
    const url = this.buildApiUrl(
      baseUrl,
      `api/v3/episodefile/${episodeFileId}`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': apiKey,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr delete episode file failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr delete episode file failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listEpisodeHistory(params: {
    baseUrl: string;
    apiKey: string;
    episodeId: number;
  }): Promise<SonarrHistoryRecord[]> {
    const { baseUrl, apiKey, episodeId } = params;
    const url = this.buildApiUrl(
      baseUrl,
      `api/v3/history?episodeId=${episodeId}&eventType=1`,
    );

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
          `Sonarr list episode history failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const records =
        isRecord(data) && Array.isArray(data['records'])
          ? (data['records'] as Array<Record<string, unknown>>)
          : Array.isArray(data)
            ? (data as Array<Record<string, unknown>>)
            : [];

      const out: SonarrHistoryRecord[] = [];
      for (const r of records) {
        const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
        if (!Number.isFinite(id) || id <= 0) continue;
        const epRaw =
          typeof r['episodeId'] === 'number'
            ? r['episodeId']
            : Number(r['episodeId']);
        out.push({
          id: Math.trunc(id),
          episodeId: Number.isFinite(epRaw) ? Math.trunc(epRaw) : null,
          eventType: typeof r['eventType'] === 'string' ? r['eventType'] : null,
          sourceTitle:
            typeof r['sourceTitle'] === 'string' ? r['sourceTitle'] : null,
          date: typeof r['date'] === 'string' ? r['date'] : null,
        });
      }
      return out;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr list episode history failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async markHistoryFailed(params: {
    baseUrl: string;
    apiKey: string;
    historyId: number;
  }): Promise<boolean> {
    const { baseUrl, apiKey, historyId } = params;
    const url = this.buildApiUrl(baseUrl, `api/v3/history/failed/${historyId}`);

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
        body: '{}',
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr mark history failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr mark history failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchEpisodes(params: {
    baseUrl: string;
    apiKey: string;
    episodeIds: number[];
  }): Promise<boolean> {
    const { baseUrl, apiKey } = params;
    const episodeIds = (params.episodeIds ?? [])
      .map((id) => Math.trunc(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (episodeIds.length === 0) return false;

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
        body: JSON.stringify({ name: 'EpisodeSearch', episodeIds }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr episode search failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr episode search failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async createTag(params: {
    baseUrl: string;
    apiKey: string;
    label: string;
  }): Promise<SonarrTag> {
    const { baseUrl, apiKey } = params;
    const label = (params.label ?? '').trim();
    if (!label) {
      throw new BadGatewayException('Sonarr create tag failed: empty label');
    }
    const url = this.buildApiUrl(baseUrl, 'api/v3/tag');

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
        body: JSON.stringify({ label }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr create tag failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const id =
        isRecord(data) && typeof data['id'] === 'number' ? data['id'] : NaN;
      if (!Number.isFinite(id) || id <= 0) {
        throw new BadGatewayException(
          'Sonarr create tag failed: response missing tag id',
        );
      }
      return { id: Math.trunc(id), label };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr create tag failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async updateSeriesEditor(params: {
    baseUrl: string;
    apiKey: string;
    seriesIds: number[];
    tags?: number[];
    applyTags?: 'add' | 'remove' | 'replace';
    monitored?: boolean;
  }): Promise<boolean> {
    const { baseUrl, apiKey } = params;
    const seriesIds = (params.seriesIds ?? [])
      .map((id) => Math.trunc(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (seriesIds.length === 0) return false;

    const payload: Record<string, unknown> = { seriesIds };
    if (Array.isArray(params.tags) && params.tags.length > 0) {
      payload['tags'] = params.tags.map((t) => Math.trunc(t));
      payload['applyTags'] = params.applyTags ?? 'add';
    }
    if (typeof params.monitored === 'boolean') {
      payload['monitored'] = params.monitored;
    }

    const url = this.buildApiUrl(baseUrl, 'api/v3/series/editor');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr series editor update failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr series editor update failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Minimal JSON request helper for the size-capped-profile endpoints
   * (custom formats + quality profiles). GET on body=undefined, else POST.
   */
  private async profileApiRequest<T>(params: {
    baseUrl: string;
    apiKey: string;
    path: string;
    body?: unknown;
  }): Promise<T> {
    const url = this.buildApiUrl(params.baseUrl, params.path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        method: params.body === undefined ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': params.apiKey,
        },
        body:
          params.body === undefined ? undefined : JSON.stringify(params.body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr ${params.path} failed: HTTP ${res.status} ${body}`.trim(),
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr ${params.path} failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listCustomFormats(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<Array<Record<string, unknown> & { id: number; name?: string }>> {
    return await this.profileApiRequest({
      ...params,
      path: 'api/v3/customformat',
    });
  }

  async createCustomFormat(params: {
    baseUrl: string;
    apiKey: string;
    format: Record<string, unknown>;
  }): Promise<Record<string, unknown> & { id: number }> {
    return await this.profileApiRequest({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      path: 'api/v3/customformat',
      body: params.format,
    });
  }

  async getQualityProfileSchema(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<Record<string, unknown>> {
    return await this.profileApiRequest({
      ...params,
      path: 'api/v3/qualityprofile/schema',
    });
  }

  async createQualityProfile(params: {
    baseUrl: string;
    apiKey: string;
    profile: Record<string, unknown>;
  }): Promise<Record<string, unknown> & { id: number }> {
    return await this.profileApiRequest({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      path: 'api/v3/qualityprofile',
      body: params.profile,
    });
  }

  async deleteSeries(params: {
    baseUrl: string;
    apiKey: string;
    seriesId: number;
    deleteFiles: boolean;
    addImportListExclusion: boolean;
  }): Promise<boolean> {
    const { baseUrl, apiKey, seriesId } = params;
    const query = `deleteFiles=${params.deleteFiles ? 'true' : 'false'}&addImportListExclusion=${
      params.addImportListExclusion ? 'true' : 'false'
    }`;
    const url = this.buildApiUrl(baseUrl, `api/v3/series/${seriesId}?${query}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': apiKey,
        },
        signal: controller.signal,
      });

      if (!res.ok && res.status !== 404) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr delete series failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr delete series failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteEpisodeFilesBulk(params: {
    baseUrl: string;
    apiKey: string;
    episodeFileIds: number[];
  }): Promise<boolean> {
    const { baseUrl, apiKey } = params;
    const episodeFileIds = (params.episodeFileIds ?? [])
      .map((id) => Math.trunc(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (episodeFileIds.length === 0) return true;

    const url = this.buildApiUrl(baseUrl, 'api/v3/episodefile/bulk');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify({ episodeFileIds }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr bulk delete episode files failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr bulk delete episode files failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchSeries(params: {
    baseUrl: string;
    apiKey: string;
    seriesId: number;
  }): Promise<boolean> {
    const { baseUrl, apiKey, seriesId } = params;
    if (!Number.isFinite(seriesId) || seriesId <= 0) return false;

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
          name: 'SeriesSearch',
          seriesId: Math.trunc(seriesId),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Sonarr series search failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr series search failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDiskSpace(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<SonarrDiskSpace[]> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/diskspace');

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
          `Sonarr disk space failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: SonarrDiskSpace[] = [];
      for (const r of rows) {
        const path = typeof r['path'] === 'string' ? r['path'].trim() : '';
        if (!path) continue;
        const free = Number(r['freeSpace']);
        const total = Number(r['totalSpace']);
        out.push({
          path,
          label: typeof r['label'] === 'string' ? r['label'] : null,
          freeSpace: Number.isFinite(free) ? free : 0,
          totalSpace: Number.isFinite(total) ? total : 0,
        });
      }
      return out;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr disk space failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getRecycleBinPath(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<string | null> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/config/mediamanagement');

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
          `Sonarr media management config failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const bin =
        isRecord(data) && typeof data['recycleBin'] === 'string'
          ? data['recycleBin'].trim()
          : '';
      return bin.length > 0 ? bin : null;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sonarr media management config failed: ${(err as Error)?.message ?? String(err)}`,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
