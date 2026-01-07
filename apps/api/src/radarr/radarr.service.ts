import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type RadarrSystemStatus = Record<string, unknown>;
export type RadarrMovie = Record<string, unknown> & {
  id: number;
  title?: string;
  tmdbId?: number;
  monitored?: boolean;
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
          `Radarr test failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as RadarrSystemStatus;
      return { ok: true, status: data };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr test failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listMovies(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrMovie[]> {
    const { baseUrl, apiKey } = params;
    const url = this.buildApiUrl(baseUrl, 'api/v3/movie');

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
          `Radarr list movies failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as RadarrMovie[]) : [];
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr list movies failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listMonitoredMovies(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrMovie[]> {
    const movies = await this.listMovies(params);
    return movies.filter((m) => Boolean(m && m.monitored));
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
          `Radarr get movie failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      return data as RadarrMovie;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr get movie failed: ${(err as Error)?.message ?? String(err)}`,
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
            `Radarr path validation error for movie ${movie.id} (${title}): ${body}. This may indicate duplicate movies in Radarr with the same path. Skipping this movie.`,
          );
          return false;
        }

        throw new BadGatewayException(
          `Radarr update movie failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr update movie failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listRootFolders(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrRootFolder[]> {
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
          `Radarr list root folders failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: RadarrRootFolder[] = [];
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
        `Radarr list root folders failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listQualityProfiles(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrQualityProfile[]> {
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
          `Radarr list quality profiles failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: RadarrQualityProfile[] = [];
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
        `Radarr list quality profiles failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listTags(params: {
    baseUrl: string;
    apiKey: string;
  }): Promise<RadarrTag[]> {
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
          `Radarr list tags failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      const out: RadarrTag[] = [];
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
        `Radarr list tags failed: ${(err as Error)?.message ?? String(err)}`,
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
        `Radarr add movie failed: HTTP ${res.status} ${body}`.trim(),
      );
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr add movie failed: ${(err as Error)?.message ?? String(err)}`,
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
          `Radarr search monitored failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Radarr search monitored failed: ${(err as Error)?.message ?? String(err)}`,
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
