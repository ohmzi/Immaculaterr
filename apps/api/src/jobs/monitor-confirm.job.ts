import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import {
  SonarrService,
  type SonarrEpisode,
  type SonarrSeries,
} from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string | null {
  const v = pick(obj, path);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function requireString(obj: Record<string, unknown>, path: string): string {
  const s = pickString(obj, path);
  if (!s) throw new Error(`Missing required setting: ${path}`);
  return s;
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function episodeKey(season: number, episode: number) {
  return `${season}:${episode}`;
}

@Injectable()
export class MonitorConfirmJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') ??
      pickString(settings, 'plex.url') ??
      requireString(settings, 'plex.baseUrl');
    const plexToken =
      pickString(secrets, 'plex.token') ??
      pickString(secrets, 'plexToken') ??
      requireString(secrets, 'plex.token');

    const movieLibraryName =
      pickString(settings, 'plex.movieLibraryName') ??
      pickString(settings, 'plex.movie_library_name') ??
      'Movies';
    const tvLibraryName =
      pickString(settings, 'plex.tvLibraryName') ??
      pickString(settings, 'plex.tv_library_name') ??
      'TV Shows';

    const radarrBaseUrl =
      pickString(settings, 'radarr.baseUrl') ??
      pickString(settings, 'radarr.url') ??
      requireString(settings, 'radarr.baseUrl');
    const radarrApiKey =
      pickString(secrets, 'radarr.apiKey') ??
      pickString(secrets, 'radarrApiKey') ??
      requireString(secrets, 'radarr.apiKey');

    const sonarrBaseUrl =
      pickString(settings, 'sonarr.baseUrl') ??
      pickString(settings, 'sonarr.url') ??
      requireString(settings, 'sonarr.baseUrl');
    const sonarrApiKey =
      pickString(secrets, 'sonarr.apiKey') ??
      pickString(secrets, 'sonarrApiKey') ??
      requireString(secrets, 'sonarr.apiKey');

    await ctx.info('monitorConfirm: start', {
      dryRun: ctx.dryRun,
      radarrBaseUrl,
      sonarrBaseUrl,
      plexBaseUrl,
    });

    // --- Plex TMDB set (movies)
    await ctx.info('plex: building TMDB id set', { movieLibraryName });
    const plexTmdbIds = await this.plexServer.getMovieTmdbIdSet({
      baseUrl: plexBaseUrl,
      token: plexToken,
      movieLibraryName,
    });
    await ctx.info('plex: TMDB id set built', {
      size: plexTmdbIds.size,
      sample: Array.from(plexTmdbIds).slice(0, 10),
    });

    // --- Radarr confirm
    await ctx.info('radarr: loading monitored movies');
    const monitoredMovies = await this.radarr.listMonitoredMovies({
      baseUrl: radarrBaseUrl,
      apiKey: radarrApiKey,
    });

    const radarrTotalMonitored = monitoredMovies.length;
    let radarrAlreadyInPlex = 0;
    let radarrUnmonitored = 0;
    let radarrSkippedPathConflicts = 0;
    const radarrSample: string[] = [];

    for (const movie of monitoredMovies) {
      const tmdbId = toInt(movie.tmdbId);
      if (!tmdbId) {
        await ctx.warn('radarr: movie missing tmdbId (skipping)', {
          title:
            typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`,
          id: movie.id,
        });
        continue;
      }

      if (!plexTmdbIds.has(tmdbId)) {
        await ctx.debug('radarr: movie not in Plex (keep monitored)', {
          title:
            typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`,
          tmdbId,
        });
        continue;
      }

      radarrAlreadyInPlex += 1;
      const title =
        typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`;
      if (radarrSample.length < 25) radarrSample.push(title);

      await ctx.info('radarr: movie in Plex, unmonitoring', {
        title,
        tmdbId,
        dryRun: ctx.dryRun,
      });

      if (ctx.dryRun) {
        radarrUnmonitored += 1;
        continue;
      }

      const success = await this.radarr.setMovieMonitored({
        baseUrl: radarrBaseUrl,
        apiKey: radarrApiKey,
        movie,
        monitored: false,
      });

      if (success) {
        radarrUnmonitored += 1;
        await ctx.info('radarr: successfully unmonitored movie', {
          title,
          tmdbId,
        });
      } else {
        radarrSkippedPathConflicts += 1;
        await ctx.warn(
          'radarr: skipped unmonitor due to path conflict (duplicate path in Radarr)',
          {
            title,
            tmdbId,
          },
        );
      }
    }

    await ctx.info('radarr: summary', {
      totalMonitored: radarrTotalMonitored,
      alreadyInPlex: radarrAlreadyInPlex,
      unmonitored: radarrUnmonitored,
      skippedPathConflicts: radarrSkippedPathConflicts,
      dryRun: ctx.dryRun,
    });

    // --- Plex TVDB map (shows)
    await ctx.info('plex: building TVDB show map', { tvLibraryName });
    const plexTvdbMap = await this.plexServer.getTvdbShowMap({
      baseUrl: plexBaseUrl,
      token: plexToken,
      tvLibraryName,
    });
    await ctx.info('plex: TVDB show map built', {
      size: plexTvdbMap.size,
      sampleTvdbIds: Array.from(plexTvdbMap.keys()).slice(0, 10),
    });

    // --- Sonarr confirm (episodes)
    await ctx.info('sonarr: loading monitored series');
    const monitoredSeries = await this.sonarr.listMonitoredSeries({
      baseUrl: sonarrBaseUrl,
      apiKey: sonarrApiKey,
    });

    const sonarrSeriesTotal = monitoredSeries.length;
    let sonarrEpisodesChecked = 0;
    let sonarrEpisodesInPlex = 0;
    let sonarrEpisodesUnmonitored = 0;
    let sonarrSeriesWithMissing = 0;
    let sonarrSeriesUnmonitored = 0;
    let sonarrSeasonsUnmonitored = 0;

    for (const series of monitoredSeries) {
      const tvdbId = toInt(series.tvdbId);
      const title =
        typeof series.title === 'string' ? series.title : `series#${series.id}`;
      if (!tvdbId) {
        await ctx.warn('sonarr: series missing tvdbId (skipping)', { title });
        continue;
      }

      const showRatingKey = plexTvdbMap.get(tvdbId);
      if (!showRatingKey) {
        await ctx.info('sonarr: series not found in Plex (keep monitored)', {
          title,
          tvdbId,
        });
        continue;
      }

      const plexEpisodes = await this.plexServer.getEpisodesSet({
        baseUrl: plexBaseUrl,
        token: plexToken,
        showRatingKey,
      });
      await ctx.debug('sonarr: Plex episodes retrieved', {
        title,
        tvdbId,
        episodeCount: plexEpisodes.size,
        sample: Array.from(plexEpisodes).slice(0, 10),
      });

      const episodes = await this.sonarr.getEpisodesBySeries({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
        seriesId: series.id,
      });

      const episodesBySeason = new Map<number, SonarrEpisode[]>();
      for (const ep of episodes) {
        const season = toInt(ep.seasonNumber);
        if (!season) continue;
        const list = episodesBySeason.get(season) ?? [];
        list.push(ep);
        episodesBySeason.set(season, list);
      }

      let hasMissing = false;
      const completeSeasons: number[] = [];
      const incompleteSeasons: number[] = [];

      for (const [season, seasonEpisodes] of episodesBySeason.entries()) {
        let seasonMissing = 0;
        let seasonEpisodesInPlex = 0;
        const seasonEpisodesToUnmonitor: SonarrEpisode[] = [];

        // Process all episodes in the season (matching Python script logic)
        for (const ep of seasonEpisodes) {
          const epNum = toInt(ep.episodeNumber);
          if (!epNum) continue;
          sonarrEpisodesChecked += 1;

          const epKey = episodeKey(season, epNum);
          const isInPlex = plexEpisodes.has(epKey);
          const isMonitored = Boolean(ep.monitored);

          if (isInPlex) {
            sonarrEpisodesInPlex += 1;
            seasonEpisodesInPlex += 1;
            if (isMonitored) {
              seasonEpisodesToUnmonitor.push(ep);
              await ctx.debug('sonarr: episode in Plex, will unmonitor', {
                title,
                season,
                episode: epNum,
                dryRun: ctx.dryRun,
              });
            }
          } else {
            seasonMissing += 1;
            hasMissing = true;
            if (isMonitored) {
              await ctx.debug(
                'sonarr: episode missing from Plex (keep monitored)',
                {
                  title,
                  season,
                  episode: epNum,
                },
              );
            }
          }
        }

        // Unmonitor episodes that are in Plex (matching Python script logic)
        if (seasonEpisodesToUnmonitor.length > 0) {
          await ctx.info('sonarr: unmonitoring episodes in Plex', {
            title,
            season,
            count: seasonEpisodesToUnmonitor.length,
            dryRun: ctx.dryRun,
          });

          for (const ep of seasonEpisodesToUnmonitor) {
            if (ctx.dryRun) {
              sonarrEpisodesUnmonitored += 1;
            } else {
              const success = await this.sonarr.setEpisodeMonitored({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
                episode: ep,
                monitored: false,
              });
              if (success) {
                sonarrEpisodesUnmonitored += 1;
              } else {
                await ctx.warn('sonarr: failed to unmonitor episode', {
                  title,
                  season,
                  episode: toInt(ep.episodeNumber),
                });
              }
            }
          }
        }

        // Check if season is complete (all episodes in Plex)
        if (seasonMissing === 0 && seasonEpisodes.length > 0) {
          completeSeasons.push(season);
          await ctx.info('sonarr: season complete (all episodes in Plex)', {
            title,
            season,
          });
        } else if (seasonMissing > 0) {
          incompleteSeasons.push(season);
          await ctx.debug('sonarr: season incomplete (has missing episodes)', {
            title,
            season,
            missing: seasonMissing,
            inPlex: seasonEpisodesInPlex,
            total: seasonEpisodes.length,
          });
        }
      }

      if (hasMissing) {
        sonarrSeriesWithMissing += 1;
      }

      // Season/series unmonitoring (via series update)
      const updatedSeries: SonarrSeries = { ...series };
      const seasons = Array.isArray(series.seasons)
        ? series.seasons.map((s) => ({ ...s }))
        : [];
      let changedSeries = false;

      for (const seasonNum of completeSeasons) {
        const seasonObj = seasons.find(
          (s) => toInt(s.seasonNumber) === seasonNum,
        );
        if (seasonObj && seasonObj.monitored) {
          seasonObj.monitored = false;
          sonarrSeasonsUnmonitored += 1;
          changedSeries = true;
        }
      }

      const seriesComplete =
        incompleteSeasons.length === 0 && completeSeasons.length > 0;
      if (seriesComplete && updatedSeries.monitored) {
        updatedSeries.monitored = false;
        sonarrSeriesUnmonitored += 1;
        changedSeries = true;
      }

      if (changedSeries) {
        updatedSeries.seasons = seasons;
        if (!ctx.dryRun) {
          await this.sonarr.updateSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
            series: updatedSeries,
          });
        }
        await ctx.info('sonarr: updated series monitoring', {
          title,
          completeSeasons,
          seriesComplete,
          dryRun: ctx.dryRun,
        });
      }
    }

    // Sonarr search monitored
    let sonarrSearchQueued = false;
    if (ctx.dryRun) {
      await ctx.info('sonarr: dry-run; skipping MissingEpisodeSearch trigger');
    } else {
      sonarrSearchQueued = await this.sonarr.searchMonitoredEpisodes({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
      });
      await ctx.info('sonarr: MissingEpisodeSearch queued', {
        ok: sonarrSearchQueued,
      });
    }

    const summary: JsonObject = {
      dryRun: ctx.dryRun,
      radarr: {
        totalMonitored: radarrTotalMonitored,
        alreadyInPlex: radarrAlreadyInPlex,
        unmonitored: radarrUnmonitored,
        skippedPathConflicts: radarrSkippedPathConflicts,
        sampleTitles: radarrSample,
      },
      sonarr: {
        totalSeries: sonarrSeriesTotal,
        episodesChecked: sonarrEpisodesChecked,
        episodesInPlex: sonarrEpisodesInPlex,
        episodesUnmonitored: sonarrEpisodesUnmonitored,
        seriesWithMissing: sonarrSeriesWithMissing,
        seasonsUnmonitored: sonarrSeasonsUnmonitored,
        seriesUnmonitored: sonarrSeriesUnmonitored,
        missingEpisodeSearchQueued: sonarrSearchQueued,
      },
    };

    await ctx.info('monitorConfirm: done', summary);
    return { summary };
  }
}
