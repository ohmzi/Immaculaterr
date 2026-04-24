import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  PlexServerService,
  type PlexPartPlayableProbeResult,
  type PlexVerifiedEpisodeAvailability,
} from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService, type SonarrSeries } from '../sonarr/sonarr.service';
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

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
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

type SonarrSeasonPassState = {
  hasPositiveEpisodes: boolean;
  hasMonitoredEpisodesAfterEpisodePass: boolean;
};

type SonarrSeriesPassState = {
  series: SonarrSeries;
  title: string;
  showFoundInPlex: boolean;
  seasonStates: Map<number, SonarrSeasonPassState>;
  nextSeasons: SonarrSeries['seasons'];
};

function buildRadarrSummary(params: {
  configured: boolean;
  totalMonitored: number;
  checked: number;
  missingTmdbId: number;
  metadataMatches: number;
  alreadyInPlex: number;
  unverifiedMatches: number;
  probeFailures: number;
  keptMonitored: number;
  unmonitored: number;
  skippedPathConflicts: number;
  sampleTitles: string[];
}): JsonObject {
  return {
    configured: params.configured,
    totalMonitored: params.totalMonitored,
    checked: params.checked,
    missingTmdbId: params.missingTmdbId,
    metadataMatches: params.metadataMatches,
    alreadyInPlex: params.alreadyInPlex,
    unverifiedMatches: params.unverifiedMatches,
    probeFailures: params.probeFailures,
    keptMonitored: params.keptMonitored,
    unmonitored: params.unmonitored,
    skippedPathConflicts: params.skippedPathConflicts,
    sampleTitles: params.sampleTitles,
  };
}

function buildSonarrSummary(params: {
  configured: boolean;
  totalSeries: number;
  seriesProcessed: number;
  episodesMonitoredBefore: number;
  episodesChecked: number;
  episodeMetadataMatches: number;
  episodesInPlex: number;
  unverifiedEpisodes: number;
  probeFailures: number;
  episodesUnmonitored: number;
  seriesWithMissing: number;
  seasonsUnmonitored: number;
  seriesUnmonitored: number;
  missingEpisodeSearchQueued: boolean | null;
}): JsonObject {
  return {
    configured: params.configured,
    totalSeries: params.totalSeries,
    seriesProcessed: params.seriesProcessed,
    episodesMonitoredBefore: params.episodesMonitoredBefore,
    episodesChecked: params.episodesChecked,
    episodeMetadataMatches: params.episodeMetadataMatches,
    episodesInPlex: params.episodesInPlex,
    unverifiedEpisodes: params.unverifiedEpisodes,
    probeFailures: params.probeFailures,
    episodesUnmonitored: params.episodesUnmonitored,
    seriesWithMissing: params.seriesWithMissing,
    seasonsUnmonitored: params.seasonsUnmonitored,
    seriesUnmonitored: params.seriesUnmonitored,
    missingEpisodeSearchQueued: params.missingEpisodeSearchQueued,
  };
}

@Injectable()
export class MonitorConfirmJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  // skipcq: JS-R1005 - Job coordinates Plex/Radarr/Sonarr confirmation flow with explicit branch handling.
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
      radarr: buildRadarrSummary({
        configured: false,
        totalMonitored: 0,
        checked: 0,
        missingTmdbId: 0,
        metadataMatches: 0,
        alreadyInPlex: 0,
        unverifiedMatches: 0,
        probeFailures: 0,
        keptMonitored: 0,
        unmonitored: 0,
        skippedPathConflicts: 0,
        sampleTitles: [],
      }),
      sonarr: buildSonarrSummary({
        configured: false,
        totalSeries: 0,
        seriesProcessed: 0,
        episodesMonitoredBefore: 0,
        episodesChecked: 0,
        episodeMetadataMatches: 0,
        episodesInPlex: 0,
        unverifiedEpisodes: 0,
        probeFailures: 0,
        episodesUnmonitored: 0,
        seriesWithMissing: 0,
        seasonsUnmonitored: 0,
        seriesUnmonitored: 0,
        missingEpisodeSearchQueued: null,
      }),
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
      null;
    const radarrApiKey =
      pickString(secrets, 'radarr.apiKey') ??
      pickString(secrets, 'radarrApiKey') ??
      null;
    const radarrEnabledSetting = pickBool(settings, 'radarr.enabled');
    const radarrIntegrationEnabled =
      (radarrEnabledSetting ?? Boolean(radarrApiKey)) === true;
    const radarrConfigured =
      radarrIntegrationEnabled && Boolean(radarrBaseUrl && radarrApiKey);

    const sonarrBaseUrl =
      pickString(settings, 'sonarr.baseUrl') ??
      pickString(settings, 'sonarr.url') ??
      null;
    const sonarrApiKey =
      pickString(secrets, 'sonarr.apiKey') ??
      pickString(secrets, 'sonarrApiKey') ??
      null;
    const sonarrEnabledSetting = pickBool(settings, 'sonarr.enabled');
    const sonarrIntegrationEnabled =
      (sonarrEnabledSetting ?? Boolean(sonarrApiKey)) === true;
    const sonarrConfigured =
      sonarrIntegrationEnabled && Boolean(sonarrBaseUrl && sonarrApiKey);

    if (!radarrConfigured && !sonarrConfigured) {
      throw new Error(
        'Monitor Confirm requires at least one configured integration: Radarr or Sonarr (baseUrl + apiKey).',
      );
    }

    summary.radarr = buildRadarrSummary({
      configured: radarrConfigured,
      totalMonitored: 0,
      checked: 0,
      missingTmdbId: 0,
      metadataMatches: 0,
      alreadyInPlex: 0,
      unverifiedMatches: 0,
      probeFailures: 0,
      keptMonitored: 0,
      unmonitored: 0,
      skippedPathConflicts: 0,
      sampleTitles: [],
    });
    summary.sonarr = buildSonarrSummary({
      configured: sonarrConfigured,
      totalSeries: 0,
      seriesProcessed: 0,
      episodesMonitoredBefore: 0,
      episodesChecked: 0,
      episodeMetadataMatches: 0,
      episodesInPlex: 0,
      unverifiedEpisodes: 0,
      probeFailures: 0,
      episodesUnmonitored: 0,
      seriesWithMissing: 0,
      seasonsUnmonitored: 0,
      seriesUnmonitored: 0,
      missingEpisodeSearchQueued: sonarrConfigured ? false : null,
    });
    await ctx.patchSummary({
      radarr: summary.radarr as unknown as JsonObject,
      sonarr: summary.sonarr as unknown as JsonObject,
    });

    await ctx.info('monitorConfirm: start', {
      dryRun: ctx.dryRun,
      radarrIntegrationEnabled,
      sonarrIntegrationEnabled,
      radarrConfigured,
      sonarrConfigured,
      ...(radarrConfigured ? { radarrBaseUrl } : {}),
      ...(sonarrConfigured ? { sonarrBaseUrl } : {}),
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

    const partProbeCache = new Map<string, PlexPartPlayableProbeResult>();
    const plexMovieRatingKeys = new Map<number, string[]>();
    if (radarrConfigured) {
      // --- Plex TMDB map (movies across all movie libraries)
      await ctx.info('plex: building TMDB id map (all movie libraries)', {
        libraries: movieSections.map((s) => s.title),
      });
      setProgress({
        step: 'plex_tmdb_index',
        message: 'Scanning Plex movie libraries for TMDB ids…',
        current: 0,
        total: movieSections.length,
        unit: 'libraries',
      });

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
        const map =
          await this.plexServer.getMovieTmdbRatingKeysMapForSectionKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sec.key,
            sectionTitle: sec.title,
          });
        for (const [tmdbId, ratingKeys] of map.entries()) {
          const previous = plexMovieRatingKeys.get(tmdbId) ?? [];
          for (const ratingKey of ratingKeys) {
            if (!previous.includes(ratingKey)) previous.push(ratingKey);
          }
          plexMovieRatingKeys.set(tmdbId, previous);
        }
        summary.plex = {
          ...(summary.plex as unknown as Record<string, unknown>),
          tmdbIds: plexMovieRatingKeys.size,
        } as unknown as JsonObject;
        void ctx
          .patchSummary({ plex: summary.plex as unknown as JsonObject })
          .catch(() => undefined);
      }
      await ctx.info('plex: TMDB id map built', {
        size: plexMovieRatingKeys.size,
        sample: Array.from(plexMovieRatingKeys.keys()).slice(0, 10),
      });
      summary.plex = {
        ...(summary.plex as unknown as Record<string, unknown>),
        tmdbIds: plexMovieRatingKeys.size,
      } as unknown as JsonObject;
      await ctx.patchSummary({ plex: summary.plex as unknown as JsonObject });
    } else {
      await ctx.info('plex: skipped TMDB id index (Radarr not configured)');
    }

    const moviePlayabilityCache = new Map<
      string,
      PlexPartPlayableProbeResult
    >();
    const getMoviePlayability = async (ratingKey: string) => {
      const cached = moviePlayabilityCache.get(ratingKey);
      if (cached) return cached;

      try {
        const result = await this.plexServer.verifyPlayableMetadataByRatingKey({
          baseUrl: plexBaseUrl,
          token: plexToken,
          ratingKey,
          partProbeCache,
        });
        radarrProbeFailures += result.probeFailureCount;
        moviePlayabilityCache.set(ratingKey, result);
        return result;
      } catch (error) {
        const fallback = { playable: false, probeFailureCount: 1 };
        radarrProbeFailures += fallback.probeFailureCount;
        moviePlayabilityCache.set(ratingKey, fallback);
        await ctx.warn('plex: failed verifying Plex movie playability', {
          ratingKey,
          error: (error as Error)?.message ?? String(error),
        });
        return fallback;
      }
    };

    // --- Radarr confirm
    let radarrTotalMonitored = 0;
    let radarrMetadataMatches = 0;
    let radarrAlreadyInPlex = 0;
    let radarrUnverifiedMatches = 0;
    let radarrProbeFailures = 0;
    let radarrUnmonitored = 0;
    let radarrSkippedPathConflicts = 0;
    let radarrChecked = 0;
    let radarrKeptMonitored = 0;
    let radarrMissingTmdbId = 0;
    const radarrSample: string[] = [];
    if (radarrConfigured) {
      await ctx.info('radarr: loading monitored movies');
      setProgress({
        step: 'radarr_scan',
        message: 'Loading Radarr monitored movies…',
      });
      const monitoredMovies = await this.radarr.listMonitoredMovies({
        baseUrl: radarrBaseUrl as string,
        apiKey: radarrApiKey as string,
      });

      radarrTotalMonitored = monitoredMovies.length;
      summary.radarr = buildRadarrSummary({
        configured: true,
        totalMonitored: radarrTotalMonitored,
        checked: 0,
        missingTmdbId: 0,
        metadataMatches: 0,
        alreadyInPlex: 0,
        unverifiedMatches: 0,
        probeFailures: 0,
        keptMonitored: 0,
        unmonitored: 0,
        skippedPathConflicts: 0,
        sampleTitles: [],
      });
      await ctx.patchSummary({
        radarr: summary.radarr as unknown as JsonObject,
      });
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
              typeof movie.title === 'string'
                ? movie.title
                : `movie#${movie.id}`,
            id: movie.id,
          });
          continue;
        }

        const ratingKeys = plexMovieRatingKeys.get(tmdbId) ?? [];
        if (!ratingKeys.length) {
          radarrKeptMonitored += 1;
          continue;
        }

        radarrMetadataMatches += 1;
        const title =
          typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`;
        let isVerifiedPlayable = false;
        for (const ratingKey of ratingKeys) {
          const verification = await getMoviePlayability(ratingKey);
          if (verification.playable) {
            isVerifiedPlayable = true;
            break;
          }
        }

        if (!isVerifiedPlayable) {
          radarrUnverifiedMatches += 1;
          radarrKeptMonitored += 1;
          await ctx.info(
            'radarr: Plex metadata match was not verified playable',
            {
              title,
              tmdbId,
              candidateCount: ratingKeys.length,
            },
          );
          continue;
        }

        radarrAlreadyInPlex += 1;
        if (radarrSample.length < 25) radarrSample.push(title);
        if (ctx.dryRun) {
          radarrUnmonitored += 1;
        } else {
          const success = await this.radarr.setMovieMonitored({
            baseUrl: radarrBaseUrl as string,
            apiKey: radarrApiKey as string,
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
            metadataMatches: radarrMetadataMatches,
            alreadyInPlex: radarrAlreadyInPlex,
            unverifiedMatches: radarrUnverifiedMatches,
            probeFailures: radarrProbeFailures,
            unmonitored: radarrUnmonitored,
            keptMonitored: radarrKeptMonitored,
            skippedPathConflicts: radarrSkippedPathConflicts,
          });
          summary.radarr = buildRadarrSummary({
            configured: true,
            totalMonitored: radarrTotalMonitored,
            checked: radarrChecked,
            missingTmdbId: radarrMissingTmdbId,
            metadataMatches: radarrMetadataMatches,
            alreadyInPlex: radarrAlreadyInPlex,
            unverifiedMatches: radarrUnverifiedMatches,
            probeFailures: radarrProbeFailures,
            keptMonitored: radarrKeptMonitored,
            unmonitored: radarrUnmonitored,
            skippedPathConflicts: radarrSkippedPathConflicts,
            sampleTitles: radarrSample,
          });
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
        metadataMatches: radarrMetadataMatches,
        alreadyInPlex: radarrAlreadyInPlex,
        unverifiedMatches: radarrUnverifiedMatches,
        probeFailures: radarrProbeFailures,
        unmonitored: radarrUnmonitored,
        skippedPathConflicts: radarrSkippedPathConflicts,
        dryRun: ctx.dryRun,
      });
    } else {
      await ctx.info('radarr: skipped (not configured)');
    }
    summary.radarr = buildRadarrSummary({
      configured: radarrConfigured,
      totalMonitored: radarrTotalMonitored,
      checked: radarrChecked,
      missingTmdbId: radarrMissingTmdbId,
      metadataMatches: radarrMetadataMatches,
      alreadyInPlex: radarrAlreadyInPlex,
      unverifiedMatches: radarrUnverifiedMatches,
      probeFailures: radarrProbeFailures,
      keptMonitored: radarrKeptMonitored,
      unmonitored: radarrUnmonitored,
      skippedPathConflicts: radarrSkippedPathConflicts,
      sampleTitles: radarrSample,
    });
    await ctx.patchSummary({ radarr: summary.radarr as unknown as JsonObject });

    const plexTvdbRatingKeys = new Map<number, string[]>();
    if (sonarrConfigured) {
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
        const map = await this.plexServer.getTvdbShowRatingKeysMapForSectionKey(
          {
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sec.key,
            sectionTitle: sec.title,
          },
        );
        for (const [tvdbId, ratingKeys] of map.entries()) {
          const prev = plexTvdbRatingKeys.get(tvdbId) ?? [];
          for (const ratingKey of ratingKeys) {
            if (!prev.includes(ratingKey)) prev.push(ratingKey);
          }
          plexTvdbRatingKeys.set(tvdbId, prev);
        }
        summary.plex = {
          ...(summary.plex as unknown as Record<string, unknown>),
          tvdbShows: plexTvdbRatingKeys.size,
        } as unknown as JsonObject;
        void ctx
          .patchSummary({ plex: summary.plex as unknown as JsonObject })
          .catch(() => undefined);
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
    } else {
      await ctx.info('plex: skipped TVDB show index (Sonarr not configured)');
    }

    const showEpisodeAvailabilityCache = new Map<
      string,
      PlexVerifiedEpisodeAvailability
    >();
    const getShowEpisodeAvailability = async (showRatingKey: string) => {
      const cached = showEpisodeAvailabilityCache.get(showRatingKey);
      if (cached) return cached;

      try {
        const result =
          await this.plexServer.getVerifiedEpisodeAvailabilityForShowRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            showRatingKey,
            partProbeCache,
          });
        sonarrProbeFailures += result.probeFailureCount;
        showEpisodeAvailabilityCache.set(showRatingKey, result);
        return result;
      } catch (error) {
        const fallback = {
          verifiedEpisodes: new Set<string>(),
          metadataEpisodes: new Set<string>(),
          probeFailureCount: 1,
        };
        sonarrProbeFailures += fallback.probeFailureCount;
        showEpisodeAvailabilityCache.set(showRatingKey, fallback);
        await ctx.warn(
          'plex: failed verifying Plex show episode availability',
          {
            showRatingKey,
            error: (error as Error)?.message ?? String(error),
          },
        );
        return fallback;
      }
    };

    // --- Sonarr confirm
    let sonarrSeriesTotal = 0;
    let sonarrEpisodesChecked = 0;
    let sonarrEpisodeMetadataMatches = 0;
    let sonarrEpisodesInPlex = 0;
    let sonarrUnverifiedEpisodes = 0;
    let sonarrProbeFailures = 0;
    let sonarrEpisodesUnmonitored = 0;
    let sonarrSeriesWithMissing = 0;
    let sonarrSeriesUnmonitored = 0;
    let sonarrSeasonsUnmonitored = 0;
    let sonarrSeriesProcessed = 0;
    let sonarrEpisodesMonitoredBefore = 0;
    let sonarrSearchQueued: boolean | null = null;
    const sonarrSeriesStates: SonarrSeriesPassState[] = [];
    if (sonarrConfigured) {
      await ctx.info('sonarr: loading monitored series');
      setProgress({
        step: 'sonarr_scan',
        message: 'Loading Sonarr monitored series…',
      });
      const monitoredSeries = await this.sonarr.listMonitoredSeries({
        baseUrl: sonarrBaseUrl as string,
        apiKey: sonarrApiKey as string,
      });

      sonarrSeriesTotal = monitoredSeries.length;
      summary.sonarr = buildSonarrSummary({
        configured: true,
        totalSeries: sonarrSeriesTotal,
        seriesProcessed: 0,
        episodesMonitoredBefore: 0,
        episodesChecked: 0,
        episodeMetadataMatches: 0,
        episodesInPlex: 0,
        unverifiedEpisodes: 0,
        probeFailures: 0,
        episodesUnmonitored: 0,
        seriesWithMissing: 0,
        seasonsUnmonitored: 0,
        seriesUnmonitored: 0,
        missingEpisodeSearchQueued: false,
      });
      await ctx.patchSummary({
        sonarr: summary.sonarr as unknown as JsonObject,
      });
      setProgress({
        step: 'sonarr_episode_scan',
        message: 'Scanning Sonarr monitored episodes…',
        current: 0,
        total: sonarrSeriesTotal,
        unit: 'series',
      });

      for (const series of monitoredSeries) {
        sonarrSeriesProcessed += 1;
        const tvdbId = toInt(series.tvdbId);
        const title =
          typeof series.title === 'string'
            ? series.title
            : `series#${series.id}`;
        const seriesState: SonarrSeriesPassState = {
          series,
          title,
          showFoundInPlex: false,
          seasonStates: new Map<number, SonarrSeasonPassState>(),
          nextSeasons: Array.isArray(series.seasons)
            ? series.seasons
            : undefined,
        };
        if (!tvdbId) {
          await ctx.warn('sonarr: series missing tvdbId (skipping)', { title });
          sonarrSeriesStates.push(seriesState);
          continue;
        }

        const showRatingKeys = plexTvdbRatingKeys.get(tvdbId) ?? [];
        seriesState.showFoundInPlex = showRatingKeys.length > 0;

        const plexEpisodes = new Set<string>();
        const plexMetadataEpisodes = new Set<string>();
        if (seriesState.showFoundInPlex) {
          for (const ratingKey of showRatingKeys) {
            const availability = await getShowEpisodeAvailability(ratingKey);
            for (const k of availability.verifiedEpisodes) plexEpisodes.add(k);
            for (const k of availability.metadataEpisodes) {
              plexMetadataEpisodes.add(k);
            }
          }
        }

        const episodes = await this.sonarr.getEpisodesBySeries({
          baseUrl: sonarrBaseUrl as string,
          apiKey: sonarrApiKey as string,
          seriesId: series.id,
        });

        let hasMissing = false;
        const seasonEpisodesUnmonitored = new Map<number, number>();

        for (const ep of episodes) {
          const season = toInt(ep.seasonNumber);
          const epNum = toInt(ep.episodeNumber);
          if (!season || !epNum) continue;

          sonarrEpisodesChecked += 1;

          const seasonState = seriesState.seasonStates.get(season) ?? {
            hasPositiveEpisodes: false,
            hasMonitoredEpisodesAfterEpisodePass: false,
          };
          seasonState.hasPositiveEpisodes = true;

          const epKey = episodeKey(season, epNum);
          const hasMetadataMatch =
            seriesState.showFoundInPlex && plexMetadataEpisodes.has(epKey);
          const isVerifiedPlayable =
            seriesState.showFoundInPlex && plexEpisodes.has(epKey);
          const isMonitored = Boolean(ep.monitored);
          let isMonitoredAfter = isMonitored;

          if (isMonitored) sonarrEpisodesMonitoredBefore += 1;
          if (hasMetadataMatch) sonarrEpisodeMetadataMatches += 1;

          if (isVerifiedPlayable) {
            sonarrEpisodesInPlex += 1;
            if (isMonitored) {
              if (ctx.dryRun) {
                sonarrEpisodesUnmonitored += 1;
                seasonEpisodesUnmonitored.set(
                  season,
                  (seasonEpisodesUnmonitored.get(season) ?? 0) + 1,
                );
                isMonitoredAfter = false;
              } else {
                const success = await this.sonarr.setEpisodeMonitored({
                  baseUrl: sonarrBaseUrl as string,
                  apiKey: sonarrApiKey as string,
                  episode: ep,
                  monitored: false,
                });
                if (success) {
                  sonarrEpisodesUnmonitored += 1;
                  seasonEpisodesUnmonitored.set(
                    season,
                    (seasonEpisodesUnmonitored.get(season) ?? 0) + 1,
                  );
                  isMonitoredAfter = false;
                } else {
                  await ctx.warn('sonarr: failed to unmonitor episode', {
                    title,
                    season,
                    episode: epNum,
                  });
                }
              }
            }
          } else {
            if (hasMetadataMatch) {
              sonarrUnverifiedEpisodes += 1;
            }
            if (seriesState.showFoundInPlex) {
              hasMissing = true;
            }
          }

          if (isMonitoredAfter) {
            seasonState.hasMonitoredEpisodesAfterEpisodePass = true;
          }
          seriesState.seasonStates.set(season, seasonState);
        }

        for (const [
          season,
          episodesUnmonitoredCount,
        ] of seasonEpisodesUnmonitored) {
          await ctx.info('sonarr: season episode unmonitor complete', {
            title,
            season,
            episodesUnmonitored: episodesUnmonitoredCount,
            dryRun: ctx.dryRun,
          });
        }

        if (hasMissing) {
          sonarrSeriesWithMissing += 1;
        }
        sonarrSeriesStates.push(seriesState);

        if (
          sonarrSeriesProcessed % 10 === 0 ||
          sonarrSeriesProcessed === sonarrSeriesTotal
        ) {
          await ctx.info('sonarr: progress', {
            seriesProcessed: sonarrSeriesProcessed,
            totalSeries: sonarrSeriesTotal,
            episodesChecked: sonarrEpisodesChecked,
            episodeMetadataMatches: sonarrEpisodeMetadataMatches,
            episodesInPlex: sonarrEpisodesInPlex,
            unverifiedEpisodes: sonarrUnverifiedEpisodes,
            probeFailures: sonarrProbeFailures,
            episodesUnmonitored: sonarrEpisodesUnmonitored,
            seasonsUnmonitored: sonarrSeasonsUnmonitored,
            seriesUnmonitored: sonarrSeriesUnmonitored,
          });
          summary.sonarr = buildSonarrSummary({
            configured: true,
            totalSeries: sonarrSeriesTotal,
            seriesProcessed: sonarrSeriesProcessed,
            episodesMonitoredBefore: sonarrEpisodesMonitoredBefore,
            episodesChecked: sonarrEpisodesChecked,
            episodeMetadataMatches: sonarrEpisodeMetadataMatches,
            episodesInPlex: sonarrEpisodesInPlex,
            unverifiedEpisodes: sonarrUnverifiedEpisodes,
            probeFailures: sonarrProbeFailures,
            episodesUnmonitored: sonarrEpisodesUnmonitored,
            seriesWithMissing: sonarrSeriesWithMissing,
            seasonsUnmonitored: sonarrSeasonsUnmonitored,
            seriesUnmonitored: sonarrSeriesUnmonitored,
            missingEpisodeSearchQueued: false,
          });
          void ctx
            .patchSummary({ sonarr: summary.sonarr as unknown as JsonObject })
            .catch(() => undefined);
          setProgress({
            step: 'sonarr_episode_scan',
            message: 'Scanning Sonarr monitored episodes…',
            current: sonarrSeriesProcessed,
            total: sonarrSeriesTotal,
            unit: 'series',
          });
        }
      }

      let sonarrSeasonPassProcessed = 0;
      setProgress({
        step: 'sonarr_season_cascade',
        message: 'Applying Sonarr season cascade…',
        current: 0,
        total: sonarrSeriesStates.length,
        unit: 'series',
      });
      for (const seriesState of sonarrSeriesStates) {
        sonarrSeasonPassProcessed += 1;
        const { series, title, showFoundInPlex, seasonStates } = seriesState;
        let seasonsUpdatedForSeries = 0;
        let appliedSeasonUpdates = 0;

        if (showFoundInPlex && Array.isArray(series.seasons)) {
          const nextSeasons = series.seasons.map((seasonEntry) => {
            const seasonNumber = toInt(seasonEntry.seasonNumber);
            if (!seasonNumber) return seasonEntry;
            if (seasonEntry.monitored !== true) return seasonEntry;

            const seasonState = seasonStates.get(seasonNumber);
            if (!(seasonState?.hasPositiveEpisodes ?? false)) {
              return seasonEntry;
            }
            if (seasonState?.hasMonitoredEpisodesAfterEpisodePass ?? false) {
              return seasonEntry;
            }

            seasonsUpdatedForSeries += 1;
            return { ...seasonEntry, monitored: false };
          });

          seriesState.nextSeasons = nextSeasons;

          if (seasonsUpdatedForSeries > 0) {
            if (ctx.dryRun) {
              sonarrSeasonsUnmonitored += seasonsUpdatedForSeries;
              appliedSeasonUpdates = seasonsUpdatedForSeries;
            } else {
              try {
                await this.sonarr.updateSeries({
                  baseUrl: sonarrBaseUrl as string,
                  apiKey: sonarrApiKey as string,
                  series: {
                    ...series,
                    seasons: nextSeasons,
                  },
                });
                sonarrSeasonsUnmonitored += seasonsUpdatedForSeries;
                appliedSeasonUpdates = seasonsUpdatedForSeries;
              } catch (error) {
                seriesState.nextSeasons = series.seasons;
                await ctx.warn(
                  'sonarr: failed to apply season unmonitor cascade',
                  {
                    title,
                    seriesId: series.id,
                    seasonsUnmonitored: seasonsUpdatedForSeries,
                    error: (error as Error)?.message ?? String(error),
                  },
                );
              }
            }

            if (appliedSeasonUpdates > 0) {
              await ctx.info('sonarr: season monitoring cascade complete', {
                title,
                showFoundInPlex,
                seasonsUnmonitored: appliedSeasonUpdates,
                dryRun: ctx.dryRun,
              });
            }
          }
        }

        if (
          sonarrSeasonPassProcessed % 10 === 0 ||
          sonarrSeasonPassProcessed === sonarrSeriesStates.length
        ) {
          await ctx.info('sonarr: season cascade progress', {
            seriesProcessed: sonarrSeasonPassProcessed,
            totalSeries: sonarrSeriesStates.length,
            seasonsUnmonitored: sonarrSeasonsUnmonitored,
          });
          summary.sonarr = buildSonarrSummary({
            configured: true,
            totalSeries: sonarrSeriesTotal,
            seriesProcessed: sonarrSeriesProcessed,
            episodesMonitoredBefore: sonarrEpisodesMonitoredBefore,
            episodesChecked: sonarrEpisodesChecked,
            episodeMetadataMatches: sonarrEpisodeMetadataMatches,
            episodesInPlex: sonarrEpisodesInPlex,
            unverifiedEpisodes: sonarrUnverifiedEpisodes,
            probeFailures: sonarrProbeFailures,
            episodesUnmonitored: sonarrEpisodesUnmonitored,
            seriesWithMissing: sonarrSeriesWithMissing,
            seasonsUnmonitored: sonarrSeasonsUnmonitored,
            seriesUnmonitored: sonarrSeriesUnmonitored,
            missingEpisodeSearchQueued: false,
          });
          void ctx
            .patchSummary({ sonarr: summary.sonarr as unknown as JsonObject })
            .catch(() => undefined);
          setProgress({
            step: 'sonarr_season_cascade',
            message: 'Applying Sonarr season cascade…',
            current: sonarrSeasonPassProcessed,
            total: sonarrSeriesStates.length,
            unit: 'series',
          });
        }
      }

      let sonarrSeriesPassProcessed = 0;
      setProgress({
        step: 'sonarr_series_cascade',
        message: 'Applying Sonarr series cascade…',
        current: 0,
        total: sonarrSeriesStates.length,
        unit: 'series',
      });
      for (const seriesState of sonarrSeriesStates) {
        sonarrSeriesPassProcessed += 1;
        const { series, title, showFoundInPlex, seasonStates } = seriesState;
        const nextSeasons = Array.isArray(seriesState.nextSeasons)
          ? seriesState.nextSeasons
          : series.seasons;
        let seriesCascadeApplied = false;

        if (showFoundInPlex && Array.isArray(nextSeasons)) {
          const trackedPositiveSeasonCount = nextSeasons.reduce(
            (count, seasonEntry) => {
              const seasonNumber = toInt(seasonEntry.seasonNumber);
              return seasonNumber ? count + 1 : count;
            },
            0,
          );
          const hasMonitoredPositiveEpisodesAfter = Array.from(
            seasonStates.values(),
          ).some((state) => state.hasMonitoredEpisodesAfterEpisodePass);
          const seriesShouldUnmonitor =
            Boolean(series.monitored) &&
            trackedPositiveSeasonCount > 0 &&
            !hasMonitoredPositiveEpisodesAfter &&
            nextSeasons.every((seasonEntry) => {
              const seasonNumber = toInt(seasonEntry.seasonNumber);
              if (!seasonNumber) return true;
              return seasonEntry.monitored === false;
            });

          if (seriesShouldUnmonitor) {
            if (ctx.dryRun) {
              sonarrSeriesUnmonitored += 1;
              seriesCascadeApplied = true;
            } else {
              try {
                await this.sonarr.updateSeries({
                  baseUrl: sonarrBaseUrl as string,
                  apiKey: sonarrApiKey as string,
                  series: {
                    ...series,
                    monitored: false,
                    seasons: nextSeasons,
                  },
                });
                sonarrSeriesUnmonitored += 1;
                seriesCascadeApplied = true;
              } catch (error) {
                await ctx.warn(
                  'sonarr: failed to apply series unmonitor cascade',
                  {
                    title,
                    seriesId: series.id,
                    error: (error as Error)?.message ?? String(error),
                  },
                );
              }
            }

            if (seriesCascadeApplied) {
              await ctx.info('sonarr: series monitoring cascade complete', {
                title,
                showFoundInPlex,
                seriesUnmonitored: seriesShouldUnmonitor,
                dryRun: ctx.dryRun,
              });
            }
          }
        }

        if (
          sonarrSeriesPassProcessed % 10 === 0 ||
          sonarrSeriesPassProcessed === sonarrSeriesStates.length
        ) {
          await ctx.info('sonarr: series cascade progress', {
            seriesProcessed: sonarrSeriesPassProcessed,
            totalSeries: sonarrSeriesStates.length,
            seriesUnmonitored: sonarrSeriesUnmonitored,
          });
          summary.sonarr = buildSonarrSummary({
            configured: true,
            totalSeries: sonarrSeriesTotal,
            seriesProcessed: sonarrSeriesProcessed,
            episodesMonitoredBefore: sonarrEpisodesMonitoredBefore,
            episodesChecked: sonarrEpisodesChecked,
            episodeMetadataMatches: sonarrEpisodeMetadataMatches,
            episodesInPlex: sonarrEpisodesInPlex,
            unverifiedEpisodes: sonarrUnverifiedEpisodes,
            probeFailures: sonarrProbeFailures,
            episodesUnmonitored: sonarrEpisodesUnmonitored,
            seriesWithMissing: sonarrSeriesWithMissing,
            seasonsUnmonitored: sonarrSeasonsUnmonitored,
            seriesUnmonitored: sonarrSeriesUnmonitored,
            missingEpisodeSearchQueued: false,
          });
          void ctx
            .patchSummary({ sonarr: summary.sonarr as unknown as JsonObject })
            .catch(() => undefined);
          setProgress({
            step: 'sonarr_series_cascade',
            message: 'Applying Sonarr series cascade…',
            current: sonarrSeriesPassProcessed,
            total: sonarrSeriesStates.length,
            unit: 'series',
          });
        }
      }

      // Sonarr search monitored
      if (ctx.dryRun) {
        sonarrSearchQueued = false;
        await ctx.info(
          'sonarr: dry-run; skipping MissingEpisodeSearch trigger',
        );
      } else {
        sonarrSearchQueued = await this.sonarr.searchMonitoredEpisodes({
          baseUrl: sonarrBaseUrl as string,
          apiKey: sonarrApiKey as string,
        });
        await ctx.info('sonarr: MissingEpisodeSearch queued', {
          ok: sonarrSearchQueued,
        });
      }
    } else {
      await ctx.info('sonarr: skipped (not configured)');
    }

    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((s) => s.title),
      tvLibraries: tvSections.map((s) => s.title),
      tmdbIds: plexMovieRatingKeys.size,
      tvdbShows: plexTvdbRatingKeys.size,
    };
    summary.radarr = buildRadarrSummary({
      configured: radarrConfigured,
      totalMonitored: radarrTotalMonitored,
      checked: radarrChecked,
      missingTmdbId: radarrMissingTmdbId,
      metadataMatches: radarrMetadataMatches,
      alreadyInPlex: radarrAlreadyInPlex,
      unverifiedMatches: radarrUnverifiedMatches,
      probeFailures: radarrProbeFailures,
      keptMonitored: radarrKeptMonitored,
      unmonitored: radarrUnmonitored,
      skippedPathConflicts: radarrSkippedPathConflicts,
      sampleTitles: radarrSample,
    });
    summary.sonarr = buildSonarrSummary({
      configured: sonarrConfigured,
      totalSeries: sonarrSeriesTotal,
      seriesProcessed: sonarrSeriesProcessed,
      episodesMonitoredBefore: sonarrEpisodesMonitoredBefore,
      episodesChecked: sonarrEpisodesChecked,
      episodeMetadataMatches: sonarrEpisodeMetadataMatches,
      episodesInPlex: sonarrEpisodesInPlex,
      unverifiedEpisodes: sonarrUnverifiedEpisodes,
      probeFailures: sonarrProbeFailures,
      episodesUnmonitored: sonarrEpisodesUnmonitored,
      seriesWithMissing: sonarrSeriesWithMissing,
      seasonsUnmonitored: sonarrSeasonsUnmonitored,
      seriesUnmonitored: sonarrSeriesUnmonitored,
      missingEpisodeSearchQueued: sonarrSearchQueued,
    });
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

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
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
  const plexTvLibraries = Array.isArray(plex.tvLibraries)
    ? plex.tvLibraries.length
    : null;

  const radarrTotalMonitored = asNum(radarr.totalMonitored) ?? 0;
  const radarrConfigured = asBool(radarr.configured) ?? true;
  const radarrUnmonitored = asNum(radarr.unmonitored) ?? 0;
  const radarrEndMonitored = Math.max(
    0,
    radarrTotalMonitored - radarrUnmonitored,
  );
  const radarrAlreadyInPlex = asNum(radarr.alreadyInPlex) ?? 0;
  const radarrUnverifiedMatches = asNum(radarr.unverifiedMatches) ?? 0;
  const radarrProbeFailures = asNum(radarr.probeFailures) ?? 0;
  const radarrSkippedPathConflicts = asNum(radarr.skippedPathConflicts) ?? 0;
  const radarrMissingTmdbId = asNum(radarr.missingTmdbId) ?? 0;
  const radarrSkipped = radarrMissingTmdbId + radarrSkippedPathConflicts;

  const sonarrTotalSeries = asNum(sonarr.totalSeries) ?? 0;
  const sonarrConfigured = asBool(sonarr.configured) ?? true;
  const sonarrSeriesUnmonitored = asNum(sonarr.seriesUnmonitored) ?? 0;
  const sonarrEndSeriesMonitored = Math.max(
    0,
    sonarrTotalSeries - sonarrSeriesUnmonitored,
  );
  const sonarrEpisodesMonitoredBefore =
    asNum(sonarr.episodesMonitoredBefore) ?? null;
  const sonarrEpisodesUnmonitored = asNum(sonarr.episodesUnmonitored) ?? 0;
  const sonarrUnverifiedEpisodes = asNum(sonarr.unverifiedEpisodes) ?? 0;
  const sonarrProbeFailures = asNum(sonarr.probeFailures) ?? 0;
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
    ...(radarrProbeFailures
      ? [issue('warn', `Radarr: ${radarrProbeFailures} Plex probe failure(s).`)]
      : []),
    ...(sonarrProbeFailures
      ? [issue('warn', `Sonarr: ${sonarrProbeFailures} Plex probe failure(s).`)]
      : []),
    ...(sonarrConfigured && !ctx.dryRun && sonarrSearchQueued === false
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
          metricRow({
            label: 'TV libraries',
            end: plexTvLibraries,
            unit: 'libraries',
          }),
          metricRow({
            label: 'TMDB ids indexed',
            end: asNum(plex.tmdbIds),
            unit: 'ids',
          }),
          metricRow({
            label: 'TVDB shows indexed',
            end: asNum(plex.tvdbShows),
            unit: 'shows',
          }),
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
            label:
              radarrAlreadyInPlex === 1
                ? 'Movie verified playable in Plex'
                : 'Movies verified playable in Plex',
            end: radarrAlreadyInPlex,
            unit: 'movies',
          }),
          metricRow({
            label:
              radarrUnverifiedMatches === 1
                ? 'Metadata match not verified playable'
                : 'Metadata matches not verified playable',
            end: radarrUnverifiedMatches,
            unit: 'movies',
          }),
          metricRow({
            label: 'Plex probe failures',
            end: radarrProbeFailures,
            unit: 'failures',
          }),
          metricRow({ label: 'Skipped', end: radarrSkipped, unit: 'movies' }),
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
            label: 'Episodes verified playable in Plex',
            end: asNum(sonarr.episodesInPlex),
            unit: 'episodes',
          }),
          metricRow({
            label:
              sonarrUnverifiedEpisodes === 1
                ? 'Episode metadata match not verified playable'
                : 'Episode metadata matches not verified playable',
            end: sonarrUnverifiedEpisodes,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Plex probe failures',
            end: sonarrProbeFailures,
            unit: 'failures',
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
          metricRow({
            label: 'TMDB ids indexed',
            end: asNum(plex.tmdbIds),
            unit: 'ids',
          }),
          metricRow({
            label: 'TVDB shows indexed',
            end: asNum(plex.tvdbShows),
            unit: 'shows',
          }),
        ],
      },
      {
        id: 'radarr_monitor_confirm',
        title: 'Radarr: unmonitor movies verified playable in Plex',
        status: radarrConfigured ? 'success' : 'skipped',
        rows: [
          metricRow({
            label: 'Monitored movies',
            start: radarrTotalMonitored,
            changed: -radarrUnmonitored,
            end: radarrEndMonitored,
            unit: 'movies',
          }),
          metricRow({
            label:
              radarrAlreadyInPlex === 1
                ? 'Movie verified playable in Plex'
                : 'Movies verified playable in Plex',
            end: radarrAlreadyInPlex,
            unit: 'movies',
          }),
          metricRow({
            label:
              radarrUnverifiedMatches === 1
                ? 'Metadata match not verified playable'
                : 'Metadata matches not verified playable',
            end: radarrUnverifiedMatches,
            unit: 'movies',
          }),
          metricRow({
            label: 'Plex probe failures',
            end: radarrProbeFailures,
            unit: 'failures',
          }),
          metricRow({ label: 'Skipped', end: radarrSkipped, unit: 'movies' }),
        ],
        facts: [{ label: 'Configured', value: radarrConfigured }],
        issues: [
          ...(radarrMissingTmdbId
            ? [
                issue(
                  'warn',
                  `${radarrMissingTmdbId} missing TMDB id (skipped).`,
                ),
              ]
            : []),
          ...(radarrSkippedPathConflicts
            ? [issue('warn', `${radarrSkippedPathConflicts} path conflicts.`)]
            : []),
          ...(radarrProbeFailures
            ? [issue('warn', `${radarrProbeFailures} Plex probe failure(s).`)]
            : []),
        ],
      },
      {
        id: 'sonarr_monitor_confirm',
        title: 'Sonarr: unmonitor episodes verified playable in Plex',
        status: sonarrConfigured ? 'success' : 'skipped',
        rows: [
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
            label: 'Episodes verified playable in Plex',
            end: asNum(sonarr.episodesInPlex),
            unit: 'episodes',
          }),
          metricRow({
            label:
              sonarrUnverifiedEpisodes === 1
                ? 'Episode metadata match not verified playable'
                : 'Episode metadata matches not verified playable',
            end: sonarrUnverifiedEpisodes,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Plex probe failures',
            end: sonarrProbeFailures,
            unit: 'failures',
          }),
        ],
        facts: [{ label: 'Configured', value: sonarrConfigured }],
        issues: [
          ...(sonarrProbeFailures
            ? [issue('warn', `${sonarrProbeFailures} Plex probe failure(s).`)]
            : []),
        ],
      },
      {
        id: 'sonarr_missing_episode_search',
        title: 'Sonarr: MissingEpisodeSearch',
        status: !sonarrConfigured
          ? 'skipped'
          : ctx.dryRun
            ? 'skipped'
            : sonarrSearchQueued
              ? 'success'
              : 'failed',
        facts: [
          { label: 'configured', value: sonarrConfigured },
          { label: 'queued', value: sonarrSearchQueued },
          { label: 'dryRun', value: ctx.dryRun },
        ],
        issues:
          sonarrConfigured && !ctx.dryRun && sonarrSearchQueued === false
            ? [issue('error', 'Search was not queued.')]
            : [],
      },
    ],
    issues,
    raw,
  };
}
