import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { fetchWithTransientRetry } from '../http.utils';
import { truncateErrorMessage, truncateForLog } from '../log.utils';
import { LOG_BODY_MAX_LENGTH } from '../app.constants';

type RadarrSystemStatus = Record<string, unknown>;
export type RadarrMovie = Record<string, unknown> & {
  id: number;
  title?: string;
  tmdbId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  movieFileId?: number;
  year?: number;
  added?: string;
  status?: string;
  path?: string;
  rootFolderPath?: string;
  folderName?: string;
  sizeOnDisk?: number;
  tags?: number[];
  ratings?: Record<
    string,
    Record<string, unknown> & { value?: number; votes?: number }
  >;
  movieFile?: Record<string, unknown> & {
    id?: number;
    path?: string;
    relativePath?: string;
    size?: number;
  };
};

export type ArrDiskSpace = {
  path: string;
  label: string | null;
  freeSpace: number;
  totalSpace: number;
};

export type RadarrHistoryRecord = {
  id: number;
  movieId: number | null;
  eventType: string | null;
  sourceTitle: string | null;
  date: string | null;
};

export type RadarrRootFolder = {
  id: number;
  path: string;
};

export type RadarrQualityProfile = {
  id: number;
  name: string;
};

export type RadarrTag = {
  id: number;
  label: string;
};

@Injectable()
export class RadarrService {
  private readonly logger = new Logger(RadarrService.name);

  async testConnection(params: { baseUrl: string; apiKey: string }) {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/system/status');

    this.logger.log(`Testing Radarr connection: ${url}`);

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
          `Radarr test failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      const data = (await res.json()) as RadarrSystemStatus;
      return { ok: true, status: data };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr test failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listMovies(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrMovie[]> {
    const data = await this.apiJsonRequest<unknown>({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      path: 'api/v3/movie',
      label: 'list movies',
      timeoutMs: 60000,
    });
    return Array.isArray(data) ? (data as RadarrMovie[]) : [];
  }

  private readonly moviesListCache = new Map<
    string,
    { at: number; data: RadarrMovie[] }
  >();

  /**
   * listMovies with a short per-process cache keyed by server. Only for
   * read-only flows that tolerate ~30s staleness — never call after a
   * mutation you need reflected.
   */
  async listMoviesCached(params: {
    baseUrl: string;
    apiKey: string;
    maxAgeMs?: number;
  }): Promise<RadarrMovie[]> {
    const maxAgeMs = params.maxAgeMs ?? 30_000;
    const now = Date.now();
    for (const [key, entry] of this.moviesListCache) {
      if (now - entry.at >= maxAgeMs) this.moviesListCache.delete(key);
    }
    const hit = this.moviesListCache.get(params.baseUrl);
    if (hit) return hit.data;
    const data = await this.listMovies(params);
    this.moviesListCache.set(params.baseUrl, { at: now, data });
    return data;
  }

  async listMonitoredMovies(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrMovie[]> {
    const movies = await this.listMovies(params);
    return movies.filter((m) => Boolean(m?.monitored));
  }

  async getMovieById(params: {
    baseUrl: string;
    apiKey: string;
    movieId: number;
  }): Promise<RadarrMovie | null> {
    const { baseUrl, apiKey, movieId } = params;
    const url = this.buildApiUrl(baseUrl, `api/v3/movie/${movieId}`);

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
        if (res.status === 404) return null;
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Radarr get movie failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      return data as RadarrMovie;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr get movie failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async setMovieMonitored(params: {
    baseUrl: string;
    apiKey: string;
    movie: RadarrMovie;
    monitored: boolean;
  }): Promise<boolean> {
    const { baseUrl, apiKey, movie, monitored } = params;

    // Check if already in the desired state (like Python script does)
    if (movie.monitored === monitored) {
      return true;
    }

    const url = this.buildApiUrl(baseUrl, `api/v3/movie/${movie.id}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      // Match Python script behavior: use the movie object directly from the list
      // and only update the monitored field
      const updated: RadarrMovie = { ...movie, monitored };

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
        const errorText = body.toLowerCase();

        // If path validation fails, this indicates duplicate movies in Radarr
        // This is a Radarr data integrity issue, not a code issue
        // Log a warning and return false so the job can continue processing other movies
        if (
          res.status === 400 &&
          (errorText.includes('path') ||
            errorText.includes('moviepathvalidator'))
        ) {
          const title =
            typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`;
          this.logger.warn(
            `Radarr path validation error for movie ${movie.id} (${title}): ${truncateForLog(body, LOG_BODY_MAX_LENGTH)}. This may indicate duplicate movies in Radarr with the same path. Skipping this movie.`,
          );
          return false;
        }

        throw new BadGatewayException(
          `Radarr update movie failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr update movie failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listRootFolders(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrRootFolder[]> {
    const data = await this.apiJsonRequest<unknown>({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      path: 'api/v3/rootfolder',
      label: 'list root folders',
    });
    return Array.isArray(data) ? (data as RadarrRootFolder[]) : [];
  }

  async listQualityProfiles(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrQualityProfile[]> {
    const data = await this.apiJsonRequest<unknown>({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      path: 'api/v3/qualityprofile',
      label: 'list quality profiles',
    });
    return Array.isArray(data) ? (data as RadarrQualityProfile[]) : [];
  }

  async listTags(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrTag[]> {
    const data = await this.apiJsonRequest<unknown>({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      path: 'api/v3/tag',
      label: 'list tags',
    });
    return Array.isArray(data) ? (data as RadarrTag[]) : [];
  }

  async lookupMovies(params: {
    baseUrl: string;
    apiKey: string;
    term: string;
  }): Promise<RadarrMovie[]> {
    const { baseUrl, apiKey } = params;
    const term = (params.term ?? '').trim();
    if (!term) return [];

    const url = this.buildApiUrl(
      baseUrl,
      `api/v3/movie/lookup?term=${encodeURIComponent(term)}`,
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
          `Radarr lookup movies failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as RadarrMovie[]) : [];
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr lookup movies failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async addMovie(params: {
    baseUrl: string;
    apiKey: string;
    title: string;
    tmdbId: number;
    year?: number | null;
    qualityProfileId: number;
    rootFolderPath: string;
    tags?: number[];
    monitored?: boolean;
    minimumAvailability?: 'announced' | 'inCinemas' | 'released';
    searchForMovie?: boolean;
  }): Promise<{ status: 'added' | 'exists'; movie: RadarrMovie | null }> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/movie');

    const payload = {
      title: params.title,
      tmdbId: Math.trunc(params.tmdbId),
      year:
        params.year && Number.isFinite(params.year)
          ? Math.trunc(params.year)
          : undefined,
      qualityProfileId: Math.trunc(params.qualityProfileId),
      rootFolderPath: params.rootFolderPath,
      tags: Array.isArray(params.tags)
        ? params.tags.map((t) => Math.trunc(t))
        : undefined,
      monitored: params.monitored ?? true,
      minimumAvailability: params.minimumAvailability ?? 'announced',
      addOptions: {
        searchForMovie: params.searchForMovie ?? true,
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
        return { status: 'added', movie: (data as RadarrMovie) ?? null };
      }

      const body = await res.text().catch(() => '');
      const lower = body.toLowerCase();
      if (
        res.status === 400 &&
        (lower.includes('already been added') ||
          lower.includes('already exists') ||
          lower.includes('movie exists'))
      ) {
        this.logger.log(
          `Radarr add movie: already exists tmdbId=${params.tmdbId} title=${JSON.stringify(
            params.title,
          )}`,
        );
        return { status: 'exists', movie: null };
      }

      throw new BadGatewayException(
        `Radarr add movie failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
      );
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr add movie failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchMonitoredMovies(params: {
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
          name: 'MissingMoviesSearch',
          filterKey: 'monitored',
          filterValue: 'true',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Radarr search monitored failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr search monitored failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteMovieFile(params: {
    baseUrl: string;
    apiKey: string;
    movieFileId: number;
  }): Promise<boolean> {
    const { baseUrl, apiKey, movieFileId } = params;
    const url = this.buildApiUrl(baseUrl, `api/v3/moviefile/${movieFileId}`);

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
          `Radarr delete movie file failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr delete movie file failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listMovieHistory(params: {
    baseUrl: string;
    apiKey: string;
    movieId: number;
  }): Promise<RadarrHistoryRecord[]> {
    const { baseUrl, apiKey, movieId } = params;
    const url = this.buildApiUrl(
      baseUrl,
      `api/v3/history/movie?movieId=${movieId}&eventType=1`,
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
          `Radarr list movie history failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const records =
        isRecord(data) && Array.isArray(data['records'])
          ? (data['records'] as Array<Record<string, unknown>>)
          : Array.isArray(data)
            ? (data as Array<Record<string, unknown>>)
            : [];

      const out: RadarrHistoryRecord[] = [];
      for (const r of records) {
        const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id']);
        if (!Number.isFinite(id) || id <= 0) continue;
        const movieRaw =
          typeof r['movieId'] === 'number'
            ? r['movieId']
            : Number(r['movieId']);
        out.push({
          id: Math.trunc(id),
          movieId: Number.isFinite(movieRaw) ? Math.trunc(movieRaw) : null,
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
        `Radarr list movie history failed: ${truncateErrorMessage(err)}`,
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
          `Radarr mark history failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr mark history failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchMovies(params: {
    baseUrl: string;
    apiKey: string;
    movieIds: number[];
  }): Promise<boolean> {
    const { baseUrl, apiKey } = params;
    const movieIds = (params.movieIds ?? [])
      .map((id) => Math.trunc(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (movieIds.length === 0) return false;

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
        body: JSON.stringify({ name: 'MoviesSearch', movieIds }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Radarr movie search failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr movie search failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async createTag(params: {
    baseUrl: string;
    apiKey: string;
    label: string;
  }): Promise<RadarrTag> {
    const { baseUrl, apiKey } = params;
    const label = (params.label ?? '').trim();
    if (!label) {
      throw new BadGatewayException('Radarr create tag failed: empty label');
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
          `Radarr create tag failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const id =
        isRecord(data) && typeof data['id'] === 'number' ? data['id'] : NaN;
      if (!Number.isFinite(id) || id <= 0) {
        throw new BadGatewayException(
          'Radarr create tag failed: response missing tag id',
        );
      }
      return { id: Math.trunc(id), label };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr create tag failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async updateMoviesEditor(params: {
    baseUrl: string;
    apiKey: string;
    movieIds: number[];
    tags?: number[];
    applyTags?: 'add' | 'remove' | 'replace';
    monitored?: boolean;
    qualityProfileId?: number;
  }): Promise<boolean> {
    const { baseUrl, apiKey } = params;
    const movieIds = (params.movieIds ?? [])
      .map((id) => Math.trunc(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (movieIds.length === 0) return false;

    const payload: Record<string, unknown> = { movieIds };
    if (Array.isArray(params.tags) && params.tags.length > 0) {
      payload['tags'] = params.tags.map((t) => Math.trunc(t));
      payload['applyTags'] = params.applyTags ?? 'add';
    }
    if (typeof params.monitored === 'boolean') {
      payload['monitored'] = params.monitored;
    }
    if (
      typeof params.qualityProfileId === 'number' &&
      params.qualityProfileId > 0
    ) {
      payload['qualityProfileId'] = Math.trunc(params.qualityProfileId);
    }

    const url = this.buildApiUrl(baseUrl, 'api/v3/movie/editor');

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
          `Radarr movie editor update failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr movie editor update failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Minimal JSON request helper for the size-capped-profile endpoints
   * (custom formats + quality profiles). GET on body=undefined, else POST.
   */
  /**
   * Shared JSON request for Radarr: timeout, one transient retry on
   * idempotent GETs, and truncated secret-free error text.
   */
  private async apiJsonRequest<T>(params: {
    baseUrl: string;
    apiKey: string;
    path: string;
    label: string;
    body?: unknown;
    timeoutMs?: number;
  }): Promise<T> {
    const url = this.buildApiUrl(params.baseUrl, params.path);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      params.timeoutMs ?? 30000,
    );
    const isGet = params.body === undefined;
    try {
      const doFetch = () =>
        fetch(url, {
          method: isGet ? 'GET' : 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Api-Key': params.apiKey,
          },
          body: isGet ? undefined : JSON.stringify(params.body),
          signal: controller.signal,
        });
      const res = isGet
        ? await fetchWithTransientRetry(doFetch)
        : await doFetch();
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Radarr ${params.label} failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr ${params.label} failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async profileApiRequest<T>(params: {
    baseUrl: string;
    apiKey: string;
    path: string;
    body?: unknown;
  }): Promise<T> {
    return await this.apiJsonRequest<T>({ ...params, label: params.path });
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

  async deleteMovie(params: {
    baseUrl: string;
    apiKey: string;
    movieId: number;
    deleteFiles: boolean;
    addImportExclusion: boolean;
  }): Promise<boolean> {
    const { baseUrl, apiKey, movieId } = params;
    const query = `deleteFiles=${params.deleteFiles ? 'true' : 'false'}&addImportExclusion=${
      params.addImportExclusion ? 'true' : 'false'
    }`;
    const url = this.buildApiUrl(baseUrl, `api/v3/movie/${movieId}?${query}`);

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
          `Radarr delete movie failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr delete movie failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDiskSpace(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<ArrDiskSpace[]> {
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
          `Radarr disk space failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: ArrDiskSpace[] = [];
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
        `Radarr disk space failed: ${truncateErrorMessage(err)}`,
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
          `Radarr media management config failed: HTTP ${res.status} ${truncateForLog(body)}`.trim(),
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
        `Radarr media management config failed: ${truncateErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private readonly buildApiUrl = (baseUrl: string, path: string) => {
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL(path, normalized).toString();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
