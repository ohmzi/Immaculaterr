import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type RadarrSystemStatus = Record<string, unknown>;
export type RadarrMovie = Record<string, unknown> & {
  id: number;
  title?: string;
  tmdbId?: number;
  monitored?: boolean;
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
          (errorText.includes('path') || errorText.includes('moviepathvalidator'))
        ) {
          const title = typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`;
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

  private buildApiUrl(baseUrl: string, path: string) {
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL(path, normalized).toString();
  }
}
