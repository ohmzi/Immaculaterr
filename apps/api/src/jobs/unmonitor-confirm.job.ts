import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService, type RadarrMovie } from '../radarr/radarr.service';
import {
  SonarrService,
  type SonarrEpisode,
  type SonarrSeries,
} from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

const MAX_REPORTED_ITEMS = 250;
const RADARR_PROGRESS_LOG_INTERVAL = 250;

type UnmonitorConfirmTarget = 'radarr' | 'sonarr';

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

function pushCappedItem(list: string[], item: string) {
  if (list.length >= MAX_REPORTED_ITEMS) return;
  list.push(item);
}

function describeMovie(movie: RadarrMovie): string {
  const title =
    typeof movie.title === 'string' && movie.title.trim()
      ? movie.title.trim()
      : `movie#${movie.id}`;
  const year = toInt(movie['year']);
  return year ? `${title} (${year})` : title;
}

function describeSeries(series: SonarrSeries): string {
  return typeof series.title === 'string' && series.title.trim()
    ? series.title.trim()
    : `series#${series.id}`;
}

function padEpisodeNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function episodeKey(season: number, episode: number) {
  return `${season}:${episode}`;
}

function getEpisodeIdentity(
  episode: SonarrEpisode,
): { season: number; episode: number; key: string } | null {
  const season = toInt(episode.seasonNumber);
  const episodeNumber = toInt(episode.episodeNumber);
  if (!season || !episodeNumber) return null;
  if (season <= 0 || episodeNumber <= 0) return null;
  return {
    season,
    episode: episodeNumber,
    key: episodeKey(season, episodeNumber),
  };
}

function describeEpisode(series: SonarrSeries, episode: SonarrEpisode): string {
  const label = describeSeries(series);
  const identity = getEpisodeIdentity(episode);
  if (!identity) return label;
  return `${label} - S${padEpisodeNumber(identity.season)}E${padEpisodeNumber(identity.episode)}`;
}

function readTarget(input?: JsonObject): UnmonitorConfirmTarget {
  if (!input) return 'radarr';
  const raw = typeof input['target'] === 'string' ? input['target'].trim() : '';
  if (!raw) return 'radarr';
  if (raw === 'radarr' || raw === 'sonarr') return raw;
  throw new Error(
    'Confirm Unmonitored target must be either "radarr" or "sonarr".',
  );
}

@Injectable()
export class UnmonitorConfirmJob {
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
          phase: 'unmonitorConfirm',
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

    const target = readTarget(ctx.input);
    const summary: JsonObject = {
      phase: 'unmonitorConfirm',
      dryRun: ctx.dryRun,
      target,
      plex: {
        totalLibraries: 0,
        movieLibraries: [],
        tvLibraries: [],
        tmdbIds: 0,
        tvdbShows: 0,
      },
      radarr: {
        configured: false,
        totalMovies: 0,
        totalUnmonitored: 0,
        checked: 0,
        keptUnmonitored: 0,
        missingFromPlex: 0,
        remonitored: 0,
        wouldRemonitor: 0,
        missingTmdbId: 0,
        skippedPathConflicts: 0,
        keptTitles: [],
        remonitoredTitles: [],
        missingTmdbTitles: [],
        pathConflictTitles: [],
      },
      sonarr: {
        configured: false,
        totalSeries: 0,
        seriesProcessed: 0,
        unmonitoredEpisodesChecked: 0,
        keptUnmonitored: 0,
        missingFromPlex: 0,
        remonitored: 0,
        wouldRemonitor: 0,
        missingTvdbId: 0,
        updateFailures: 0,
        keptEpisodeLabels: [],
        missingEpisodeLabels: [],
        remonitoredEpisodeLabels: [],
        missingTvdbSeriesTitles: [],
        updateFailureEpisodeLabels: [],
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

    if (target === 'radarr' && !radarrConfigured) {
      throw new Error(
        'Confirm Unmonitored requires Radarr to be configured (baseUrl + apiKey).',
      );
    }
    if (target === 'sonarr' && !sonarrConfigured) {
      throw new Error(
        'Confirm Unmonitored requires Sonarr to be configured (baseUrl + apiKey).',
      );
    }

    summary.radarr = {
      ...(summary.radarr as unknown as Record<string, unknown>),
      configured: radarrConfigured,
    } as unknown as JsonObject;
    summary.sonarr = {
      ...(summary.sonarr as unknown as Record<string, unknown>),
      configured: sonarrConfigured,
    } as unknown as JsonObject;
    await ctx.patchSummary({
      target,
      radarr: summary.radarr as JsonObject,
      sonarr: summary.sonarr as JsonObject,
    });

    await ctx.info('unmonitorConfirm: start', {
      dryRun: ctx.dryRun,
      target,
      plexBaseUrl,
      ...(target === 'radarr' ? { radarrBaseUrl } : {}),
      ...(target === 'sonarr' ? { sonarrBaseUrl } : {}),
    });

    setProgress({
      step: 'plex_discovery',
      message: 'Discovering Plex libraries…',
    });

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections.filter(
      (section) => (section.type ?? '').toLowerCase() === 'movie',
    );
    const tvSections = sections.filter(
      (section) => (section.type ?? '').toLowerCase() === 'show',
    );

    if (target === 'radarr') {
      if (movieSections.length === 0) {
        throw new Error(
          'Confirm Unmonitored requires at least one Plex movie library to verify Radarr titles safely.',
        );
      }

      await this.runRadarrTarget({
        ctx,
        summary,
        sections,
        movieSections,
        plexBaseUrl,
        plexToken,
        radarrBaseUrl: radarrBaseUrl as string,
        radarrApiKey: radarrApiKey as string,
        setProgress,
      });
    } else {
      if (tvSections.length === 0) {
        throw new Error(
          'Confirm Unmonitored requires at least one Plex TV library to verify Sonarr episodes safely.',
        );
      }

      await this.runSonarrTarget({
        ctx,
        summary,
        sections,
        tvSections,
        plexBaseUrl,
        plexToken,
        sonarrBaseUrl: sonarrBaseUrl as string,
        sonarrApiKey: sonarrApiKey as string,
        setProgress,
      });
    }

    await ctx.patchSummary({
      progress: {
        step: 'done',
        message: 'Completed.',
        updatedAt: new Date().toISOString(),
      },
    });

    await ctx.info('unmonitorConfirm: done', {
      target,
      plex: summary.plex,
      ...(target === 'radarr'
        ? { radarr: summary.radarr }
        : { sonarr: summary.sonarr }),
    });

    return {
      summary: buildUnmonitorConfirmReport({
        ctx,
        raw: summary,
      }) as unknown as JsonObject,
    };
  }

  private async runRadarrTarget(params: {
    ctx: JobContext;
    summary: JsonObject;
    sections: Array<{ key: string; title: string; type?: string }>;
    movieSections: Array<{ key: string; title: string; type?: string }>;
    plexBaseUrl: string;
    plexToken: string;
    radarrBaseUrl: string;
    radarrApiKey: string;
    setProgress: (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
      unit?: string;
      extra?: JsonObject;
    }) => void;
  }) {
    const {
      ctx,
      summary,
      sections,
      movieSections,
      plexBaseUrl,
      plexToken,
      radarrBaseUrl,
      radarrApiKey,
      setProgress,
    } = params;

    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((section) => section.title),
      tvLibraries: [],
      tmdbIds: 0,
      tvdbShows: 0,
    };
    await ctx.patchSummary({ plex: summary.plex as JsonObject });

    await ctx.info('plex: discovered movie libraries', {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((section) => section.title),
    });

    const plexTmdbIds = new Set<number>();
    setProgress({
      step: 'plex_tmdb_index',
      message: 'Scanning Plex movie libraries for TMDB ids…',
      current: 0,
      total: movieSections.length,
      unit: 'libraries',
    });

    let movieLibraryIndex = 0;
    for (const section of movieSections) {
      movieLibraryIndex += 1;
      setProgress({
        step: 'plex_tmdb_index',
        message: `Scanning Plex movie library: ${section.title}`,
        current: movieLibraryIndex,
        total: movieSections.length,
        unit: 'libraries',
      });
      const ids = await this.plexServer.getMovieTmdbIdSetForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: section.key,
        sectionTitle: section.title,
      });
      for (const id of ids) plexTmdbIds.add(id);
      summary.plex = {
        ...(summary.plex as unknown as Record<string, unknown>),
        tmdbIds: plexTmdbIds.size,
      } as unknown as JsonObject;
      void ctx
        .patchSummary({ plex: summary.plex as JsonObject })
        .catch(() => undefined);
    }

    await ctx.info('plex: TMDB id set built', {
      size: plexTmdbIds.size,
      movieLibraries: movieSections.length,
    });

    setProgress({
      step: 'radarr_load',
      message: 'Loading Radarr movies…',
    });

    const allMovies = await this.radarr.listMovies({
      baseUrl: radarrBaseUrl,
      apiKey: radarrApiKey,
    });
    const unmonitoredMovies = allMovies.filter((movie) => !movie?.monitored);

    let checked = 0;
    let keptUnmonitored = 0;
    let missingFromPlex = 0;
    let remonitored = 0;
    let wouldRemonitor = 0;
    let missingTmdbId = 0;
    let skippedPathConflicts = 0;

    const keptTitles: string[] = [];
    const remonitoredTitles: string[] = [];
    const missingTmdbTitles: string[] = [];
    const pathConflictTitles: string[] = [];

    summary.radarr = {
      configured: true,
      totalMovies: allMovies.length,
      totalUnmonitored: unmonitoredMovies.length,
      checked: 0,
      keptUnmonitored: 0,
      missingFromPlex: 0,
      remonitored: 0,
      wouldRemonitor: 0,
      missingTmdbId: 0,
      skippedPathConflicts: 0,
      keptTitles,
      remonitoredTitles,
      missingTmdbTitles,
      pathConflictTitles,
    };
    await ctx.patchSummary({ radarr: summary.radarr as JsonObject });

    await ctx.info('radarr: loaded movies', {
      totalMovies: allMovies.length,
      totalUnmonitored: unmonitoredMovies.length,
    });

    setProgress({
      step: 'radarr_scan',
      message: 'Scanning Radarr unmonitored movies…',
      current: 0,
      total: unmonitoredMovies.length,
      unit: 'movies',
    });

    for (const movie of unmonitoredMovies) {
      checked += 1;
      const label = describeMovie(movie);
      const tmdbId = toInt(movie.tmdbId);

      if (!tmdbId) {
        missingTmdbId += 1;
        pushCappedItem(missingTmdbTitles, label);
        await ctx.warn('radarr: unmonitored movie missing tmdbId (skipping)', {
          title: label,
          id: movie.id,
        });
      } else if (plexTmdbIds.has(tmdbId)) {
        keptUnmonitored += 1;
        pushCappedItem(keptTitles, label);
      } else {
        missingFromPlex += 1;
        if (ctx.dryRun) {
          wouldRemonitor += 1;
          pushCappedItem(remonitoredTitles, label);
        } else {
          const success = await this.radarr.setMovieMonitored({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
            movie,
            monitored: true,
          });
          if (success) {
            remonitored += 1;
            pushCappedItem(remonitoredTitles, label);
          } else {
            skippedPathConflicts += 1;
            pushCappedItem(pathConflictTitles, label);
            await ctx.warn(
              'radarr: skipped re-monitor due to path conflict (duplicate path in Radarr)',
              {
                title: label,
                tmdbId,
              },
            );
          }
        }
      }

      if (
        checked % RADARR_PROGRESS_LOG_INTERVAL === 0 ||
        checked === unmonitoredMovies.length
      ) {
        const currentRadarrSummary = {
          configured: true,
          totalMovies: allMovies.length,
          totalUnmonitored: unmonitoredMovies.length,
          checked,
          keptUnmonitored,
          missingFromPlex,
          remonitored,
          wouldRemonitor,
          missingTmdbId,
          skippedPathConflicts,
          keptTitles,
          remonitoredTitles,
          missingTmdbTitles,
          pathConflictTitles,
        } satisfies JsonObject;

        summary.radarr = currentRadarrSummary;
        await ctx.info('radarr: progress', {
          checked,
          totalUnmonitored: unmonitoredMovies.length,
          keptUnmonitored,
          missingFromPlex,
          remonitored,
          wouldRemonitor,
          missingTmdbId,
          skippedPathConflicts,
        });
        void ctx
          .patchSummary({ radarr: summary.radarr as JsonObject })
          .catch(() => undefined);
        setProgress({
          step: 'radarr_scan',
          message: 'Scanning Radarr unmonitored movies…',
          current: checked,
          total: unmonitoredMovies.length,
          unit: 'movies',
        });
      }
    }

    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((section) => section.title),
      tvLibraries: [],
      tmdbIds: plexTmdbIds.size,
      tvdbShows: 0,
    };
    summary.radarr = {
      configured: true,
      totalMovies: allMovies.length,
      totalUnmonitored: unmonitoredMovies.length,
      checked,
      keptUnmonitored,
      missingFromPlex,
      remonitored,
      wouldRemonitor,
      missingTmdbId,
      skippedPathConflicts,
      keptTitles,
      remonitoredTitles,
      missingTmdbTitles,
      pathConflictTitles,
    };

    await ctx.patchSummary({
      plex: summary.plex as JsonObject,
      radarr: summary.radarr as JsonObject,
    });
  }

  private async runSonarrTarget(params: {
    ctx: JobContext;
    summary: JsonObject;
    sections: Array<{ key: string; title: string; type?: string }>;
    tvSections: Array<{ key: string; title: string; type?: string }>;
    plexBaseUrl: string;
    plexToken: string;
    sonarrBaseUrl: string;
    sonarrApiKey: string;
    setProgress: (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
      unit?: string;
      extra?: JsonObject;
    }) => void;
  }) {
    const {
      ctx,
      summary,
      sections,
      tvSections,
      plexBaseUrl,
      plexToken,
      sonarrBaseUrl,
      sonarrApiKey,
      setProgress,
    } = params;

    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: [],
      tvLibraries: tvSections.map((section) => section.title),
      tmdbIds: 0,
      tvdbShows: 0,
    };
    await ctx.patchSummary({ plex: summary.plex as JsonObject });

    await ctx.info('plex: discovered TV libraries', {
      totalLibraries: sections.length,
      tvLibraries: tvSections.map((section) => section.title),
    });

    const plexTvdbRatingKeys = new Map<number, string[]>();
    setProgress({
      step: 'plex_tvdb_index',
      message: 'Scanning Plex TV libraries for TVDB ids…',
      current: 0,
      total: tvSections.length,
      unit: 'libraries',
    });

    let tvLibraryIndex = 0;
    for (const section of tvSections) {
      tvLibraryIndex += 1;
      setProgress({
        step: 'plex_tvdb_index',
        message: `Scanning Plex TV library: ${section.title}`,
        current: tvLibraryIndex,
        total: tvSections.length,
        unit: 'libraries',
      });
      const map = await this.plexServer.getTvdbShowMapForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: section.key,
        sectionTitle: section.title,
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
      void ctx
        .patchSummary({ plex: summary.plex as JsonObject })
        .catch(() => undefined);
    }

    await ctx.info('plex: TVDB show map built', {
      size: plexTvdbRatingKeys.size,
      tvLibraries: tvSections.length,
    });

    setProgress({
      step: 'sonarr_load',
      message: 'Loading Sonarr monitored series…',
    });

    const monitoredSeries = await this.sonarr.listMonitoredSeries({
      baseUrl: sonarrBaseUrl,
      apiKey: sonarrApiKey,
    });
    const plexEpisodesCache = new Map<string, Set<string>>();
    const getPlexEpisodesSet = async (
      ratingKey: string,
    ): Promise<Set<string>> => {
      const key = ratingKey.trim();
      if (!key) return new Set<string>();
      const cached = plexEpisodesCache.get(key);
      if (cached) return cached;
      const episodes = await this.plexServer.getEpisodesSet({
        baseUrl: plexBaseUrl,
        token: plexToken,
        showRatingKey: key,
      });
      plexEpisodesCache.set(key, episodes);
      return episodes;
    };
    const getUnionEpisodesAcrossShows = async (ratingKeys: string[]) => {
      const union = new Set<string>();
      for (const ratingKey of ratingKeys) {
        const episodes = await getPlexEpisodesSet(ratingKey);
        for (const key of episodes) union.add(key);
      }
      return union;
    };

    let seriesProcessed = 0;
    let unmonitoredEpisodesChecked = 0;
    let keptUnmonitored = 0;
    let missingFromPlex = 0;
    let remonitored = 0;
    let wouldRemonitor = 0;
    let missingTvdbId = 0;
    let updateFailures = 0;

    const keptEpisodeLabels: string[] = [];
    const missingEpisodeLabels: string[] = [];
    const remonitoredEpisodeLabels: string[] = [];
    const missingTvdbSeriesTitles: string[] = [];
    const updateFailureEpisodeLabels: string[] = [];

    summary.sonarr = {
      configured: true,
      totalSeries: monitoredSeries.length,
      seriesProcessed: 0,
      unmonitoredEpisodesChecked: 0,
      keptUnmonitored: 0,
      missingFromPlex: 0,
      remonitored: 0,
      wouldRemonitor: 0,
      missingTvdbId: 0,
      updateFailures: 0,
      keptEpisodeLabels,
      missingEpisodeLabels,
      remonitoredEpisodeLabels,
      missingTvdbSeriesTitles,
      updateFailureEpisodeLabels,
    };
    await ctx.patchSummary({ sonarr: summary.sonarr as JsonObject });

    await ctx.info('sonarr: loaded monitored series', {
      totalSeries: monitoredSeries.length,
    });

    setProgress({
      step: 'sonarr_scan',
      message: 'Scanning Sonarr monitored series…',
      current: 0,
      total: monitoredSeries.length,
      unit: 'series',
    });

    for (const series of monitoredSeries) {
      seriesProcessed += 1;
      const title = describeSeries(series);
      const tvdbId = toInt(series.tvdbId);

      if (!tvdbId) {
        missingTvdbId += 1;
        pushCappedItem(missingTvdbSeriesTitles, title);
        await ctx.warn('sonarr: monitored series missing tvdbId (skipping)', {
          title,
          id: series.id,
        });
      } else {
        const showRatingKeys = plexTvdbRatingKeys.get(tvdbId) ?? [];
        if (showRatingKeys.length === 0) {
          await ctx.info(
            'sonarr: no Plex show match found; treating unmonitored episodes as missing',
            {
              title,
              tvdbId,
            },
          );
        }

        const plexEpisodeKeys =
          showRatingKeys.length > 0
            ? await getUnionEpisodesAcrossShows(showRatingKeys)
            : new Set<string>();
        const episodes = await this.sonarr.getEpisodesBySeries({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
          seriesId: series.id,
        });
        const attemptedRemonitorEpisodes: Array<{
          id: number;
          label: string;
          season: number;
          episode: number;
        }> = [];

        for (const episode of episodes) {
          const identity = getEpisodeIdentity(episode);
          if (!identity) continue;
          if (episode.monitored !== false) continue;

          const label = describeEpisode(series, episode);
          unmonitoredEpisodesChecked += 1;

          if (plexEpisodeKeys.has(identity.key)) {
            keptUnmonitored += 1;
            pushCappedItem(keptEpisodeLabels, label);
            continue;
          }

          missingFromPlex += 1;
          pushCappedItem(missingEpisodeLabels, label);

          if (ctx.dryRun) {
            wouldRemonitor += 1;
            pushCappedItem(remonitoredEpisodeLabels, label);
            continue;
          }

          try {
            await this.sonarr.setEpisodeMonitored({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              episode,
              monitored: true,
            });
            attemptedRemonitorEpisodes.push({
              id: episode.id,
              label,
              season: identity.season,
              episode: identity.episode,
            });
          } catch (err) {
            updateFailures += 1;
            pushCappedItem(updateFailureEpisodeLabels, label);
            const message = (err as Error)?.message ?? String(err);
            await ctx.warn(
              'sonarr: failed to re-monitor episode (continuing)',
              {
                title,
                tvdbId,
                season: identity.season,
                episode: identity.episode,
                error: message,
              },
            );
          }
        }

        if (!ctx.dryRun && attemptedRemonitorEpisodes.length > 0) {
          try {
            const refreshedEpisodes = await this.sonarr.getEpisodesBySeries({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              seriesId: series.id,
            });
            const refreshedEpisodesById = new Map(
              refreshedEpisodes.map((episode) => [episode.id, episode]),
            );

            for (const attempted of attemptedRemonitorEpisodes) {
              const refreshedEpisode = refreshedEpisodesById.get(attempted.id);

              if (refreshedEpisode?.monitored === true) {
                remonitored += 1;
                pushCappedItem(remonitoredEpisodeLabels, attempted.label);
                continue;
              }

              updateFailures += 1;
              pushCappedItem(updateFailureEpisodeLabels, attempted.label);
              await ctx.warn(
                'sonarr: episode did not remain monitored after update (continuing)',
                {
                  title,
                  tvdbId,
                  season: attempted.season,
                  episode: attempted.episode,
                  episodeId: attempted.id,
                  monitoredAfterUpdate: refreshedEpisode?.monitored ?? null,
                },
              );
            }
          } catch (err) {
            const message = (err as Error)?.message ?? String(err);

            updateFailures += attemptedRemonitorEpisodes.length;
            for (const attempted of attemptedRemonitorEpisodes) {
              pushCappedItem(updateFailureEpisodeLabels, attempted.label);
            }

            await ctx.warn(
              'sonarr: failed to verify re-monitored episodes (continuing)',
              {
                title,
                tvdbId,
                attemptedEpisodes: attemptedRemonitorEpisodes.length,
                error: message,
              },
            );
          }
        }
      }

      summary.sonarr = {
        configured: true,
        totalSeries: monitoredSeries.length,
        seriesProcessed,
        unmonitoredEpisodesChecked,
        keptUnmonitored,
        missingFromPlex,
        remonitored,
        wouldRemonitor,
        missingTvdbId,
        updateFailures,
        keptEpisodeLabels,
        missingEpisodeLabels,
        remonitoredEpisodeLabels,
        missingTvdbSeriesTitles,
        updateFailureEpisodeLabels,
      };
      void ctx
        .patchSummary({ sonarr: summary.sonarr as JsonObject })
        .catch(() => undefined);
      setProgress({
        step: 'sonarr_scan',
        message: 'Scanning Sonarr monitored series…',
        current: seriesProcessed,
        total: monitoredSeries.length,
        unit: 'series',
      });
    }

    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: [],
      tvLibraries: tvSections.map((section) => section.title),
      tmdbIds: 0,
      tvdbShows: plexTvdbRatingKeys.size,
    };
    summary.sonarr = {
      configured: true,
      totalSeries: monitoredSeries.length,
      seriesProcessed,
      unmonitoredEpisodesChecked,
      keptUnmonitored,
      missingFromPlex,
      remonitored,
      wouldRemonitor,
      missingTvdbId,
      updateFailures,
      keptEpisodeLabels,
      missingEpisodeLabels,
      remonitoredEpisodeLabels,
      missingTvdbSeriesTitles,
      updateFailureEpisodeLabels,
    };

    await ctx.patchSummary({
      plex: summary.plex as JsonObject,
      sonarr: summary.sonarr as JsonObject,
    });
  }
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (value): value is string =>
      typeof value === 'string' && value.trim().length > 0,
  );
}

function buildFact(
  label: string,
  count: number,
  items: string[],
  unit: string,
): { label: string; value: { count: number; unit: string; items: string[] } } {
  return {
    label,
    value: {
      count,
      unit,
      items,
    },
  };
}

function buildUnmonitorConfirmReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;
  const target = asString(raw.target) === 'sonarr' ? 'sonarr' : 'radarr';

  return target === 'sonarr'
    ? buildSonarrReport({ ctx, raw, target })
    : buildRadarrReport({ ctx, raw, target });
}

function buildRadarrReport(params: {
  ctx: JobContext;
  raw: JsonObject;
  target: UnmonitorConfirmTarget;
}): JobReportV1 {
  const { ctx, raw, target } = params;
  const plex = isPlainObject(raw.plex) ? raw.plex : {};
  const radarr = isPlainObject(raw.radarr) ? radarrSafe(raw.radarr) : {};

  const plexMovieLibraries = Array.isArray(plex.movieLibraries)
    ? plex.movieLibraries.length
    : null;
  const plexTmdbIds = asNum(plex.tmdbIds);

  const radarrConfigured = asBool(radarr.configured) ?? true;
  const totalUnmonitored = asNum(radarr.totalUnmonitored) ?? 0;
  const keptUnmonitored = asNum(radarr.keptUnmonitored) ?? 0;
  const missingFromPlex = asNum(radarr.missingFromPlex) ?? 0;
  const remonitored = asNum(radarr.remonitored) ?? 0;
  const wouldRemonitor = asNum(radarr.wouldRemonitor) ?? 0;
  const missingTmdbId = asNum(radarr.missingTmdbId) ?? 0;
  const skippedPathConflicts = asNum(radarr.skippedPathConflicts) ?? 0;
  const skipped = missingTmdbId + skippedPathConflicts;
  const changedCount = ctx.dryRun ? wouldRemonitor : remonitored;
  const endUnmonitored = Math.max(0, totalUnmonitored - changedCount);

  const keptTitles = asStringArray(radarr.keptTitles);
  const remonitoredTitles = asStringArray(radarr.remonitoredTitles);
  const missingTmdbTitles = asStringArray(radarr.missingTmdbTitles);
  const pathConflictTitles = asStringArray(radarr.pathConflictTitles);

  const issues = [
    ...(missingTmdbId
      ? [
          issue(
            'warn',
            `Radarr: ${missingTmdbId} unmonitored movie(s) missing TMDB id (skipped).`,
          ),
        ]
      : []),
    ...(skippedPathConflicts
      ? [
          issue(
            'warn',
            `Radarr: ${skippedPathConflicts} movie(s) could not be re-monitored due to path conflicts.`,
          ),
        ]
      : []),
  ];

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline: ctx.dryRun
      ? 'Confirm unmonitored Radarr dry-run complete.'
      : 'Confirm unmonitored Radarr run complete.',
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
            label: 'TMDB ids indexed',
            end: plexTmdbIds,
            unit: 'ids',
          }),
        ],
      },
      {
        id: 'radarr',
        title: 'Radarr',
        rows: [
          metricRow({
            label: 'Unmonitored movies',
            start: totalUnmonitored,
            changed: -changedCount,
            end: endUnmonitored,
            unit: 'movies',
            note: ctx.dryRun ? 'Dry-run projection.' : null,
          }),
          metricRow({
            label: 'Confirmed still in Plex',
            end: keptUnmonitored,
            unit: 'movies',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            end: changedCount,
            unit: 'movies',
          }),
          metricRow({
            label: 'Skipped',
            end: skipped,
            unit: 'movies',
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
            label: 'Movie libraries',
            end: plexMovieLibraries,
            unit: 'libraries',
          }),
          metricRow({
            label: 'TMDB ids indexed',
            end: plexTmdbIds,
            unit: 'ids',
          }),
        ],
      },
      {
        id: 'radarr_unmonitored_confirm',
        title: 'Radarr: confirm unmonitored movies against Plex',
        status: radarrConfigured ? 'success' : 'skipped',
        rows: [
          metricRow({
            label: 'Unmonitored movies',
            start: totalUnmonitored,
            changed: -changedCount,
            end: endUnmonitored,
            unit: 'movies',
            note: ctx.dryRun ? 'Dry-run projection.' : null,
          }),
          metricRow({
            label: 'Confirmed still in Plex',
            end: keptUnmonitored,
            unit: 'movies',
          }),
          metricRow({
            label: 'Missing from Plex',
            end: missingFromPlex,
            unit: 'movies',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            end: changedCount,
            unit: 'movies',
          }),
          metricRow({
            label: 'Skipped',
            end: skipped,
            unit: 'movies',
          }),
        ],
        facts: [
          { label: 'Target', value: target },
          { label: 'Configured', value: radarrConfigured },
          buildFact('Kept unmonitored', keptUnmonitored, keptTitles, 'movies'),
          buildFact(
            ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            changedCount,
            remonitoredTitles,
            'movies',
          ),
          buildFact(
            'Skipped missing TMDB id',
            missingTmdbId,
            missingTmdbTitles,
            'movies',
          ),
          buildFact(
            'Skipped path conflicts',
            skippedPathConflicts,
            pathConflictTitles,
            'movies',
          ),
        ],
        issues: issues.length ? issues : undefined,
      },
    ],
    issues,
    raw,
  };
}

function buildSonarrReport(params: {
  ctx: JobContext;
  raw: JsonObject;
  target: UnmonitorConfirmTarget;
}): JobReportV1 {
  const { ctx, raw, target } = params;
  const plex = isPlainObject(raw.plex) ? raw.plex : {};
  const sonarr = isPlainObject(raw.sonarr) ? sonarrSafe(raw.sonarr) : {};

  const plexTvLibraries = Array.isArray(plex.tvLibraries)
    ? plex.tvLibraries.length
    : null;
  const plexTvdbShows = asNum(plex.tvdbShows);

  const sonarrConfigured = asBool(sonarr.configured) ?? true;
  const totalSeries = asNum(sonarr.totalSeries) ?? 0;
  const seriesProcessed = asNum(sonarr.seriesProcessed) ?? 0;
  const unmonitoredEpisodesChecked =
    asNum(sonarr.unmonitoredEpisodesChecked) ?? 0;
  const keptUnmonitored = asNum(sonarr.keptUnmonitored) ?? 0;
  const missingFromPlex = asNum(sonarr.missingFromPlex) ?? 0;
  const remonitored = asNum(sonarr.remonitored) ?? 0;
  const wouldRemonitor = asNum(sonarr.wouldRemonitor) ?? 0;
  const missingTvdbId = asNum(sonarr.missingTvdbId) ?? 0;
  const updateFailures = asNum(sonarr.updateFailures) ?? 0;
  const changedCount = ctx.dryRun ? wouldRemonitor : remonitored;

  const keptEpisodeLabels = asStringArray(sonarr.keptEpisodeLabels);
  const missingEpisodeLabels = asStringArray(sonarr.missingEpisodeLabels);
  const remonitoredEpisodeLabels = asStringArray(
    sonarr.remonitoredEpisodeLabels,
  );
  const missingTvdbSeriesTitles = asStringArray(sonarr.missingTvdbSeriesTitles);
  const updateFailureEpisodeLabels = asStringArray(
    sonarr.updateFailureEpisodeLabels,
  );

  const issues = [
    ...(missingTvdbId
      ? [
          issue(
            'warn',
            `Sonarr: ${missingTvdbId} monitored series missing TVDB id (skipped).`,
          ),
        ]
      : []),
    ...(updateFailures
      ? [
          issue(
            'warn',
            `Sonarr: ${updateFailures} episode(s) failed to re-monitor and were skipped.`,
          ),
        ]
      : []),
  ];

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline: ctx.dryRun
      ? 'Confirm unmonitored Sonarr dry-run complete.'
      : 'Confirm unmonitored Sonarr run complete.',
    sections: [
      {
        id: 'plex',
        title: 'Plex',
        rows: [
          metricRow({
            label: 'TV libraries',
            end: plexTvLibraries,
            unit: 'libraries',
          }),
          metricRow({
            label: 'TVDB shows indexed',
            end: plexTvdbShows,
            unit: 'shows',
          }),
        ],
      },
      {
        id: 'sonarr',
        title: 'Sonarr',
        rows: [
          metricRow({
            label: 'Monitored series processed',
            end: seriesProcessed || totalSeries,
            unit: 'series',
          }),
          metricRow({
            label: 'Unmonitored episodes checked',
            end: unmonitoredEpisodesChecked,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Kept unmonitored',
            end: keptUnmonitored,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Missing from Plex',
            end: missingFromPlex,
            unit: 'episodes',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            end: changedCount,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Skipped missing TVDB id',
            end: missingTvdbId,
            unit: 'series',
          }),
          metricRow({
            label: 'Skipped update failures',
            end: updateFailures,
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
          metricRow({
            label: 'TV libraries',
            end: plexTvLibraries,
            unit: 'libraries',
          }),
          metricRow({
            label: 'TVDB shows indexed',
            end: plexTvdbShows,
            unit: 'shows',
          }),
        ],
      },
      {
        id: 'sonarr_unmonitored_confirm',
        title: 'Sonarr: confirm unmonitored episodes against Plex',
        status: sonarrConfigured ? 'success' : 'skipped',
        rows: [
          metricRow({
            label: 'Monitored series processed',
            end: seriesProcessed || totalSeries,
            unit: 'series',
          }),
          metricRow({
            label: 'Unmonitored episodes checked',
            end: unmonitoredEpisodesChecked,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Kept unmonitored',
            end: keptUnmonitored,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Missing from Plex',
            end: missingFromPlex,
            unit: 'episodes',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            end: changedCount,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Skipped missing TVDB id',
            end: missingTvdbId,
            unit: 'series',
          }),
          metricRow({
            label: 'Skipped update failures',
            end: updateFailures,
            unit: 'episodes',
          }),
        ],
        facts: [
          { label: 'Target', value: target },
          { label: 'Configured', value: sonarrConfigured },
          buildFact(
            'Kept unmonitored',
            keptUnmonitored,
            keptEpisodeLabels,
            'episodes',
          ),
          buildFact(
            'Missing from Plex',
            missingFromPlex,
            missingEpisodeLabels,
            'episodes',
          ),
          buildFact(
            ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            changedCount,
            remonitoredEpisodeLabels,
            'episodes',
          ),
          buildFact(
            'Skipped missing TVDB id',
            missingTvdbId,
            missingTvdbSeriesTitles,
            'series',
          ),
          buildFact(
            'Skipped update failures',
            updateFailures,
            updateFailureEpisodeLabels,
            'episodes',
          ),
        ],
        issues: issues.length ? issues : undefined,
      },
    ],
    issues,
    raw,
  };
}

function radarrSafe(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function sonarrSafe(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}
