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
import type { JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

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
    const setProgress = (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
      unit?: string;
      extra?: JsonObject;
    }) => {
      const { step, message, current, total, unit, extra } = params;
      void ctx
        .patchSummary({
          phase: 'monitorConfirm',
          progress: {
            step,
            message,
            ...(typeof current === 'number' ? { current } : {}),
            ...(typeof total === 'number' ? { total } : {}),
            ...(unit ? { unit } : {}),
            ...(extra ? { extra } : {}),
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
    };

    const summary: JsonObject = {
      phase: 'monitorConfirm',
      dryRun: ctx.dryRun,
      plex: {
        totalLibraries: 0,
        movieLibraries: [],
        tvLibraries: [],
        tmdbIds: 0,
        tvdbShows: 0,
      },
      radarr: {
        totalMonitored: 0,
        checked: 0,
        missingTmdbId: 0,
        alreadyInPlex: 0,
        keptMonitored: 0,
        unmonitored: 0,
        skippedPathConflicts: 0,
        sampleTitles: [],
      },
      sonarr: {
        totalSeries: 0,
        seriesProcessed: 0,
        episodesMonitoredBefore: 0,
        episodesChecked: 0,
        episodesInPlex: 0,
        episodesUnmonitored: 0,
        seriesWithMissing: 0,
        seasonsUnmonitored: 0,
        seriesUnmonitored: 0,
        missingEpisodeSearchQueued: false,
      },
    };

    await ctx.setSummary({
      ...summary,
      progress: {
        step: 'init',
        message: 'Initializing…',
        updatedAt: new Date().toISOString(),
      },
    });

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
    setProgress({
      step: 'plex_discovery',
      message: 'Discovering Plex libraries…',
    });

    // --- Plex libraries (scan ALL movie/show libraries)
    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'movie',
    );
    const tvSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'show',
    );

    await ctx.info('plex: discovered libraries', {
      total: sections.length,
      movieLibraries: movieSections.map((s) => s.title),
      tvLibraries: tvSections.map((s) => s.title),
    });
    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((s) => s.title),
      tvLibraries: tvSections.map((s) => s.title),
      tmdbIds: 0,
      tvdbShows: 0,
    };
    await ctx.patchSummary({ plex: summary.plex as unknown as JsonObject });

    // --- Plex TMDB set (movies across all movie libraries)
    await ctx.info('plex: building TMDB id set (all movie libraries)', {
      libraries: movieSections.map((s) => s.title),
    });
    setProgress({
      step: 'plex_tmdb_index',
      message: 'Scanning Plex movie libraries for TMDB ids…',
      current: 0,
      total: movieSections.length,
      unit: 'libraries',
    });

    const plexTmdbIds = new Set<number>();
    let movieLibIdx = 0;
    for (const sec of movieSections) {
      movieLibIdx += 1;
      setProgress({
        step: 'plex_tmdb_index',
        message: `Scanning Plex movie library: ${sec.title}`,
        current: movieLibIdx,
        total: movieSections.length,
        unit: 'libraries',
      });
      const ids = await this.plexServer.getMovieTmdbIdSetForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      for (const id of ids) plexTmdbIds.add(id);
      summary.plex = {
        ...(summary.plex as unknown as Record<string, unknown>),
        tmdbIds: plexTmdbIds.size,
      } as unknown as JsonObject;
      void ctx.patchSummary({ plex: summary.plex as unknown as JsonObject }).catch(
        () => undefined,
      );
    }
    await ctx.info('plex: TMDB id set built', {
      size: plexTmdbIds.size,
      sample: Array.from(plexTmdbIds).slice(0, 10),
    });
    summary.plex = {
      ...(summary.plex as unknown as Record<string, unknown>),
      tmdbIds: plexTmdbIds.size,
    } as unknown as JsonObject;
    await ctx.patchSummary({ plex: summary.plex as unknown as JsonObject });

    // --- Radarr confirm
    await ctx.info('radarr: loading monitored movies');
    setProgress({
      step: 'radarr_scan',
      message: 'Loading Radarr monitored movies…',
    });
    const monitoredMovies = await this.radarr.listMonitoredMovies({
      baseUrl: radarrBaseUrl,
      apiKey: radarrApiKey,
    });

    const radarrTotalMonitored = monitoredMovies.length;
    let radarrAlreadyInPlex = 0;
    let radarrUnmonitored = 0;
    let radarrSkippedPathConflicts = 0;
    let radarrChecked = 0;
    let radarrKeptMonitored = 0;
    let radarrMissingTmdbId = 0;
    const radarrSample: string[] = [];
    summary.radarr = {
      totalMonitored: radarrTotalMonitored,
      checked: 0,
      missingTmdbId: 0,
      alreadyInPlex: 0,
      keptMonitored: 0,
      unmonitored: 0,
      skippedPathConflicts: 0,
      sampleTitles: [],
    };
    await ctx.patchSummary({ radarr: summary.radarr as unknown as JsonObject });
    setProgress({
      step: 'radarr_scan',
      message: 'Scanning Radarr monitored movies…',
      current: 0,
      total: radarrTotalMonitored,
      unit: 'movies',
    });

    for (const movie of monitoredMovies) {
      radarrChecked += 1;
      const tmdbId = toInt(movie.tmdbId);
      if (!tmdbId) {
        radarrMissingTmdbId += 1;
        await ctx.warn('radarr: movie missing tmdbId (skipping)', {
          title:
            typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`,
          id: movie.id,
        });
        continue;
      }

      if (!plexTmdbIds.has(tmdbId)) {
        radarrKeptMonitored += 1;
        continue;
      }

      radarrAlreadyInPlex += 1;
      const title =
        typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`;
      if (radarrSample.length < 25) radarrSample.push(title);

      if (ctx.dryRun) {
        radarrUnmonitored += 1;
      } else {
        const success = await this.radarr.setMovieMonitored({
          baseUrl: radarrBaseUrl,
          apiKey: radarrApiKey,
          movie,
          monitored: false,
        });

        if (success) {
          radarrUnmonitored += 1;
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

      if (
        radarrChecked % 50 === 0 ||
        radarrChecked === radarrTotalMonitored
      ) {
        await ctx.info('radarr: progress', {
          checked: radarrChecked,
          totalMonitored: radarrTotalMonitored,
          alreadyInPlex: radarrAlreadyInPlex,
          unmonitored: radarrUnmonitored,
          keptMonitored: radarrKeptMonitored,
          skippedPathConflicts: radarrSkippedPathConflicts,
        });
        summary.radarr = {
          totalMonitored: radarrTotalMonitored,
          checked: radarrChecked,
          missingTmdbId: radarrMissingTmdbId,
          alreadyInPlex: radarrAlreadyInPlex,
          keptMonitored: radarrKeptMonitored,
          unmonitored: radarrUnmonitored,
          skippedPathConflicts: radarrSkippedPathConflicts,
          sampleTitles: radarrSample,
        };
        void ctx
          .patchSummary({ radarr: summary.radarr as unknown as JsonObject })
          .catch(() => undefined);
        setProgress({
          step: 'radarr_scan',
          message: 'Scanning Radarr monitored movies…',
          current: radarrChecked,
          total: radarrTotalMonitored,
          unit: 'movies',
        });
      }
    }

    await ctx.info('radarr: summary', {
      totalMonitored: radarrTotalMonitored,
      alreadyInPlex: radarrAlreadyInPlex,
      unmonitored: radarrUnmonitored,
      skippedPathConflicts: radarrSkippedPathConflicts,
      dryRun: ctx.dryRun,
    });
    summary.radarr = {
      totalMonitored: radarrTotalMonitored,
      checked: radarrChecked,
      missingTmdbId: radarrMissingTmdbId,
      alreadyInPlex: radarrAlreadyInPlex,
      keptMonitored: radarrKeptMonitored,
      unmonitored: radarrUnmonitored,
      skippedPathConflicts: radarrSkippedPathConflicts,
      sampleTitles: radarrSample,
    };
    await ctx.patchSummary({ radarr: summary.radarr as unknown as JsonObject });

    // --- Plex TVDB map (shows across all TV libraries)
    await ctx.info('plex: building TVDB show map (all TV libraries)', {
      libraries: tvSections.map((s) => s.title),
    });
    setProgress({
      step: 'plex_tvdb_index',
      message: 'Scanning Plex TV libraries for TVDB ids…',
      current: 0,
      total: tvSections.length,
      unit: 'libraries',
    });
    const plexTvdbRatingKeys = new Map<number, string[]>();
    let tvLibIdx = 0;
    for (const sec of tvSections) {
      tvLibIdx += 1;
      setProgress({
        step: 'plex_tvdb_index',
        message: `Scanning Plex TV library: ${sec.title}`,
        current: tvLibIdx,
        total: tvSections.length,
        unit: 'libraries',
      });
      const map = await this.plexServer.getTvdbShowMapForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      for (const [tvdbId, ratingKey] of map.entries()) {
        const prev = plexTvdbRatingKeys.get(tvdbId) ?? [];
        if (!prev.includes(ratingKey)) prev.push(ratingKey);
        plexTvdbRatingKeys.set(tvdbId, prev);
      }
      summary.plex = {
        ...(summary.plex as unknown as Record<string, unknown>),
        tvdbShows: plexTvdbRatingKeys.size,
      } as unknown as JsonObject;
      void ctx.patchSummary({ plex: summary.plex as unknown as JsonObject }).catch(
        () => undefined,
      );
    }
    await ctx.info('plex: TVDB show map built', {
      size: plexTvdbRatingKeys.size,
      sampleTvdbIds: Array.from(plexTvdbRatingKeys.keys()).slice(0, 10),
    });
    summary.plex = {
      ...(summary.plex as unknown as Record<string, unknown>),
      tvdbShows: plexTvdbRatingKeys.size,
    } as unknown as JsonObject;
    await ctx.patchSummary({ plex: summary.plex as unknown as JsonObject });

    // --- Sonarr confirm (episodes)
    await ctx.info('sonarr: loading monitored series');
    setProgress({
      step: 'sonarr_scan',
      message: 'Loading Sonarr monitored series…',
    });
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
    let sonarrSeriesProcessed = 0;
    let sonarrEpisodesMonitoredBefore = 0;

    summary.sonarr = {
      totalSeries: sonarrSeriesTotal,
      seriesProcessed: 0,
      episodesMonitoredBefore: 0,
      episodesChecked: 0,
      episodesInPlex: 0,
      episodesUnmonitored: 0,
      seriesWithMissing: 0,
      seasonsUnmonitored: 0,
      seriesUnmonitored: 0,
      missingEpisodeSearchQueued: false,
    };
    await ctx.patchSummary({ sonarr: summary.sonarr as unknown as JsonObject });
    setProgress({
      step: 'sonarr_scan',
      message: 'Scanning Sonarr monitored series…',
      current: 0,
      total: sonarrSeriesTotal,
      unit: 'series',
    });

    for (const series of monitoredSeries) {
      sonarrSeriesProcessed += 1;
      const tvdbId = toInt(series.tvdbId);
      const title =
        typeof series.title === 'string' ? series.title : `series#${series.id}`;
      if (!tvdbId) {
        await ctx.warn('sonarr: series missing tvdbId (skipping)', { title });
        continue;
      }

      const showRatingKeys = plexTvdbRatingKeys.get(tvdbId) ?? [];
      if (showRatingKeys.length === 0) {
        continue;
      }

      // Union episodes across all Plex libraries where the show exists.
      const plexEpisodes = new Set<string>();
      for (const ratingKey of showRatingKeys) {
        const eps = await this.plexServer.getEpisodesSet({
          baseUrl: plexBaseUrl,
          token: plexToken,
          showRatingKey: ratingKey,
        });
        for (const k of eps) plexEpisodes.add(k);
      }

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
          if (isMonitored) sonarrEpisodesMonitoredBefore += 1;

          if (isInPlex) {
            sonarrEpisodesInPlex += 1;
            seasonEpisodesInPlex += 1;
            if (isMonitored) {
              seasonEpisodesToUnmonitor.push(ep);
            }
          } else {
            seasonMissing += 1;
            hasMissing = true;
          }
        }

        // Unmonitor episodes that are in Plex (matching Python script logic)
        if (seasonEpisodesToUnmonitor.length > 0) {
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

          await ctx.info('sonarr: season episode unmonitor complete', {
            title,
            season,
            episodesUnmonitored: seasonEpisodesToUnmonitor.length,
            dryRun: ctx.dryRun,
          });
        }

        // Check if season is complete (all episodes in Plex)
        if (seasonMissing === 0 && seasonEpisodes.length > 0) {
          completeSeasons.push(season);
        } else if (seasonMissing > 0) {
          incompleteSeasons.push(season);
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

      if (sonarrSeriesProcessed % 10 === 0 || sonarrSeriesProcessed === sonarrSeriesTotal) {
        await ctx.info('sonarr: progress', {
          seriesProcessed: sonarrSeriesProcessed,
          totalSeries: sonarrSeriesTotal,
          episodesChecked: sonarrEpisodesChecked,
          episodesUnmonitored: sonarrEpisodesUnmonitored,
          seasonsUnmonitored: sonarrSeasonsUnmonitored,
          seriesUnmonitored: sonarrSeriesUnmonitored,
        });
        summary.sonarr = {
          totalSeries: sonarrSeriesTotal,
          seriesProcessed: sonarrSeriesProcessed,
          episodesMonitoredBefore: sonarrEpisodesMonitoredBefore,
          episodesChecked: sonarrEpisodesChecked,
          episodesInPlex: sonarrEpisodesInPlex,
          episodesUnmonitored: sonarrEpisodesUnmonitored,
          seriesWithMissing: sonarrSeriesWithMissing,
          seasonsUnmonitored: sonarrSeasonsUnmonitored,
          seriesUnmonitored: sonarrSeriesUnmonitored,
          missingEpisodeSearchQueued: false,
        };
        void ctx
          .patchSummary({ sonarr: summary.sonarr as unknown as JsonObject })
          .catch(() => undefined);
        setProgress({
          step: 'sonarr_scan',
          message: 'Scanning Sonarr monitored series…',
          current: sonarrSeriesProcessed,
          total: sonarrSeriesTotal,
          unit: 'series',
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

    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((s) => s.title),
      tvLibraries: tvSections.map((s) => s.title),
      tmdbIds: plexTmdbIds.size,
      tvdbShows: plexTvdbRatingKeys.size,
    };
    summary.radarr = {
      totalMonitored: radarrTotalMonitored,
      checked: radarrChecked,
      missingTmdbId: radarrMissingTmdbId,
      alreadyInPlex: radarrAlreadyInPlex,
      keptMonitored: radarrKeptMonitored,
      unmonitored: radarrUnmonitored,
      skippedPathConflicts: radarrSkippedPathConflicts,
      sampleTitles: radarrSample,
    };
    summary.sonarr = {
      totalSeries: sonarrSeriesTotal,
      seriesProcessed: sonarrSeriesProcessed,
      episodesMonitoredBefore: sonarrEpisodesMonitoredBefore,
      episodesChecked: sonarrEpisodesChecked,
      episodesInPlex: sonarrEpisodesInPlex,
      episodesUnmonitored: sonarrEpisodesUnmonitored,
      seriesWithMissing: sonarrSeriesWithMissing,
      seasonsUnmonitored: sonarrSeasonsUnmonitored,
      seriesUnmonitored: sonarrSeriesUnmonitored,
      missingEpisodeSearchQueued: sonarrSearchQueued,
    };
    await ctx.patchSummary({
      plex: summary.plex as unknown as JsonObject,
      radarr: summary.radarr as unknown as JsonObject,
      sonarr: summary.sonarr as unknown as JsonObject,
      progress: {
        step: 'done',
        message: 'Completed.',
        updatedAt: new Date().toISOString(),
      },
    });

    await ctx.info('monitorConfirm: done', summary);
    const report = buildMonitorConfirmReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function buildMonitorConfirmReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;

  const plex = isPlainObject(raw.plex) ? raw.plex : {};
  const radarr = isPlainObject(raw.radarr) ? raw.radarr : {};
  const sonarr = isPlainObject(raw.sonarr) ? raw.sonarr : {};

  const plexMovieLibraries = Array.isArray(plex.movieLibraries)
    ? plex.movieLibraries.length
    : null;
  const plexTvLibraries = Array.isArray(plex.tvLibraries) ? plex.tvLibraries.length : null;

  const radarrTotalMonitored = asNum(radarr.totalMonitored) ?? 0;
  const radarrUnmonitored = asNum(radarr.unmonitored) ?? 0;
  const radarrEndMonitored = Math.max(0, radarrTotalMonitored - radarrUnmonitored);
  const radarrAlreadyInPlex = asNum(radarr.alreadyInPlex) ?? 0;
  const radarrSkippedPathConflicts = asNum(radarr.skippedPathConflicts) ?? 0;
  const radarrMissingTmdbId = asNum(radarr.missingTmdbId) ?? 0;

  const sonarrTotalSeries = asNum(sonarr.totalSeries) ?? 0;
  const sonarrSeriesUnmonitored = asNum(sonarr.seriesUnmonitored) ?? 0;
  const sonarrEndSeriesMonitored = Math.max(0, sonarrTotalSeries - sonarrSeriesUnmonitored);
  const sonarrEpisodesMonitoredBefore = asNum(sonarr.episodesMonitoredBefore) ?? null;
  const sonarrEpisodesUnmonitored = asNum(sonarr.episodesUnmonitored) ?? 0;
  const sonarrEpisodesMonitoredAfter =
    sonarrEpisodesMonitoredBefore !== null
      ? Math.max(0, sonarrEpisodesMonitoredBefore - sonarrEpisodesUnmonitored)
      : null;
  const sonarrSearchQueued =
    typeof sonarr.missingEpisodeSearchQueued === 'boolean'
      ? sonarr.missingEpisodeSearchQueued
      : null;

  const issues = [
    ...(radarrMissingTmdbId
      ? [
          issue(
            'warn',
            `Radarr: ${radarrMissingTmdbId} monitored movie(s) missing TMDB id (skipped).`,
          ),
        ]
      : []),
    ...(radarrSkippedPathConflicts
      ? [
          issue(
            'warn',
            `Radarr: ${radarrSkippedPathConflicts} unmonitor(s) skipped due to path conflicts.`,
          ),
        ]
      : []),
    ...(!ctx.dryRun && sonarrSearchQueued === false
      ? [issue('warn', 'Sonarr: MissingEpisodeSearch was not queued.')]
      : []),
  ];

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline: ctx.dryRun ? 'Dry-run complete.' : 'Monitor confirm complete.',
    sections: [
      {
        id: 'plex',
        title: 'Plex',
        rows: [
          metricRow({
            label: 'Movie libraries',
            end: plexMovieLibraries,
            unit: 'libraries',
          }),
          metricRow({ label: 'TV libraries', end: plexTvLibraries, unit: 'libraries' }),
          metricRow({ label: 'TMDB ids indexed', end: asNum(plex.tmdbIds), unit: 'ids' }),
          metricRow({ label: 'TVDB shows indexed', end: asNum(plex.tvdbShows), unit: 'shows' }),
        ],
      },
      {
        id: 'radarr',
        title: 'Radarr',
        rows: [
          metricRow({
            label: 'Monitored movies',
            start: radarrTotalMonitored,
            changed: -radarrUnmonitored,
            end: radarrEndMonitored,
            unit: 'movies',
          }),
          metricRow({
            label: 'Already in Plex',
            end: radarrAlreadyInPlex,
            unit: 'movies',
          }),
          metricRow({
            label: 'Skipped (missing TMDB id)',
            end: radarrMissingTmdbId,
            unit: 'movies',
          }),
          metricRow({
            label: 'Skipped (path conflicts)',
            end: radarrSkippedPathConflicts,
            unit: 'movies',
          }),
        ],
      },
      {
        id: 'sonarr',
        title: 'Sonarr',
        rows: [
          metricRow({
            label: 'Monitored series',
            start: sonarrTotalSeries,
            changed: -sonarrSeriesUnmonitored,
            end: sonarrEndSeriesMonitored,
            unit: 'series',
          }),
          metricRow({
            label: 'Monitored episodes',
            start: sonarrEpisodesMonitoredBefore,
            changed: -sonarrEpisodesUnmonitored,
            end: sonarrEpisodesMonitoredAfter,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Episodes checked',
            end: asNum(sonarr.episodesChecked),
            unit: 'episodes',
          }),
          metricRow({
            label: 'Episodes found in Plex',
            end: asNum(sonarr.episodesInPlex),
            unit: 'episodes',
          }),
        ],
      },
    ],
    tasks: [
      {
        id: 'plex_inventory',
        title: 'Plex inventory',
        status: 'success',
        rows: [
          metricRow({ label: 'TMDB ids indexed', end: asNum(plex.tmdbIds), unit: 'ids' }),
          metricRow({ label: 'TVDB shows indexed', end: asNum(plex.tvdbShows), unit: 'shows' }),
        ],
      },
      {
        id: 'radarr_monitor_confirm',
        title: 'Radarr: unmonitor movies already in Plex',
        status: 'success',
        rows: [
          metricRow({
            label: 'Monitored movies',
            start: radarrTotalMonitored,
            changed: -radarrUnmonitored,
            end: radarrEndMonitored,
            unit: 'movies',
          }),
          metricRow({ label: 'Already in Plex', end: radarrAlreadyInPlex, unit: 'movies' }),
        ],
        issues: [
          ...(radarrMissingTmdbId
            ? [issue('warn', `${radarrMissingTmdbId} missing TMDB id (skipped).`)]
            : []),
          ...(radarrSkippedPathConflicts
            ? [issue('warn', `${radarrSkippedPathConflicts} path conflicts.`)]
            : []),
        ],
      },
      {
        id: 'sonarr_monitor_confirm',
        title: 'Sonarr: unmonitor episodes already in Plex',
        status: 'success',
        rows: [
          metricRow({
            label: 'Monitored episodes',
            start: sonarrEpisodesMonitoredBefore,
            changed: -sonarrEpisodesUnmonitored,
            end: sonarrEpisodesMonitoredAfter,
            unit: 'episodes',
          }),
          metricRow({ label: 'Episodes checked', end: asNum(sonarr.episodesChecked), unit: 'episodes' }),
        ],
      },
      {
        id: 'sonarr_missing_episode_search',
        title: 'Sonarr: MissingEpisodeSearch',
        status: ctx.dryRun ? 'skipped' : sonarrSearchQueued ? 'success' : 'failed',
        facts: [
          { label: 'queued', value: sonarrSearchQueued },
          { label: 'dryRun', value: ctx.dryRun },
        ],
        issues:
          !ctx.dryRun && sonarrSearchQueued === false
            ? [issue('error', 'Search was not queued.')]
            : [],
      },
    ],
    issues,
    raw,
  };
}
