import { Injectable } from '@nestjs/common';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService, type RadarrMovie } from '../radarr/radarr.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SettingsService } from '../settings/settings.service';
import { SonarrService, type SonarrSeries } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from '../immaculate-taste-collection/immaculate-taste-show-collection.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';
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

function pickString(obj: Record<string, unknown>, path: string): string {
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
}

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const v = pick(obj, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(baseUrl);
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

@Injectable()
export class ImmaculateTasteCollectionJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly recommendations: RecommendationsService,
    private readonly tmdb: TmdbService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly immaculateTaste: ImmaculateTasteCollectionService,
    private readonly immaculateTasteTv: ImmaculateTasteShowCollectionService,
    private readonly immaculateTasteRefresher: ImmaculateTasteRefresherJob,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const mediaTypeRaw =
      typeof input['mediaType'] === 'string' ? input['mediaType'].trim() : '';
    const mediaType = mediaTypeRaw.toLowerCase();
    const isTv =
      mediaType === 'episode' || mediaType === 'show' || mediaType === 'tv';

    const seedTitle =
      typeof input['seedTitle'] === 'string' ? input['seedTitle'].trim() : '';
    const seedRatingKey =
      typeof input['seedRatingKey'] === 'string'
        ? input['seedRatingKey'].trim()
        : '';
    const seedLibrarySectionIdRaw =
      typeof input['seedLibrarySectionId'] === 'number' &&
      Number.isFinite(input['seedLibrarySectionId'])
        ? String(Math.trunc(input['seedLibrarySectionId']))
        : typeof input['seedLibrarySectionId'] === 'string'
          ? input['seedLibrarySectionId'].trim()
          : '';
    const seedLibrarySectionTitle =
      typeof input['seedLibrarySectionTitle'] === 'string'
        ? input['seedLibrarySectionTitle'].trim()
        : '';
    const seedYear =
      typeof input['seedYear'] === 'number' &&
      Number.isFinite(input['seedYear'])
        ? Math.trunc(input['seedYear'])
        : null;

    await ctx.info('immaculateTastePoints: start', {
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      mediaType: mediaType || null,
      mode: isTv ? 'tv' : 'movie',
      seedTitle: seedTitle || null,
      seedYear,
      seedRatingKey: seedRatingKey || null,
      seedLibrarySectionId: seedLibrarySectionIdRaw || null,
      seedLibrarySectionTitle: seedLibrarySectionTitle || null,
      source: typeof input['source'] === 'string' ? input['source'] : null,
      plexEvent:
        typeof input['plexEvent'] === 'string' ? input['plexEvent'] : null,
    });

    if (!seedTitle) {
      throw new Error('Missing required job input: seedTitle');
    }

    if (isTv) {
      return await this.runTv({
        ctx,
        seedTitle,
        seedYear,
        seedRatingKey,
        seedLibrarySectionIdRaw,
        seedLibrarySectionTitle,
      });
    }

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    void ctx
      .patchSummary({
        progress: {
          step: 'dataset',
          message: 'Locating Immaculate Taste dataset…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    // --- Plex settings ---
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_libraries',
          message: 'Searching Plex movie libraries…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!movieSections.length) throw new Error('No Plex movie libraries found');

    // Prefer the library section Plex tells us the watched movie belongs to.
    let movieSectionKey = seedLibrarySectionIdRaw || '';
    let movieLibraryName = seedLibrarySectionTitle || '';

    if (!movieSectionKey && seedRatingKey) {
      const meta = await this.plexServer
        .getMetadataDetails({
          baseUrl: plexBaseUrl,
          token: plexToken,
          ratingKey: seedRatingKey,
        })
        .catch(() => null);
      if (meta?.librarySectionId) movieSectionKey = meta.librarySectionId;
      if (meta?.librarySectionTitle)
        movieLibraryName = meta.librarySectionTitle;
    }

    if (!movieSectionKey) {
      const preferred =
        movieSections.find((s) => s.title.toLowerCase() === 'movies') ??
        movieSections[0];
      movieSectionKey = preferred.key;
      movieLibraryName = preferred.title;
    } else {
      const match = sections.find((s) => s.key === movieSectionKey);
      if (match?.title) movieLibraryName = match.title;
    }

    if (!movieLibraryName) {
      movieLibraryName =
        sections.find((s) => s.key === movieSectionKey)?.title ??
        movieSections.find((s) => s.key === movieSectionKey)?.title ??
        'Movies';
    }

    // --- Recommendation + integration config ---
    const tmdbApiKey =
      pickString(secrets, 'tmdb.apiKey') ||
      pickString(secrets, 'tmdbApiKey') ||
      pickString(secrets, 'tmdb.api_key');
    if (!tmdbApiKey) throw new Error('TMDB apiKey is not set');

    const openAiEnabledFlag = pickBool(settings, 'openai.enabled') ?? false;
    const openAiApiKey = pickString(secrets, 'openai.apiKey');
    const openAiModel = pickString(settings, 'openai.model') || null;
    const openAiEnabled = openAiEnabledFlag && Boolean(openAiApiKey);

    const googleEnabledFlag = pickBool(settings, 'google.enabled') ?? false;
    const googleApiKey = pickString(secrets, 'google.apiKey');
    const googleSearchEngineId = pickString(settings, 'google.searchEngineId');
    const googleEnabled =
      googleEnabledFlag &&
      Boolean(googleApiKey) &&
      Boolean(googleSearchEngineId);

    const suggestionsPerRunRaw =
      pickNumber(settings, 'recommendations.count') ??
      pickNumber(settings, 'immaculateTaste.suggestionsPerRun') ??
      10;
    const suggestionsPerRun = Math.max(
      5,
      Math.min(100, Math.trunc(suggestionsPerRunRaw || 10)),
    );
    const upcomingPercentRaw =
      pickNumber(settings, 'recommendations.upcomingPercent') ?? 25;
    const upcomingPercent = Math.max(
      0,
      Math.min(75, Math.trunc(upcomingPercentRaw || 25)),
    );
    const maxPoints =
      Math.trunc(pickNumber(settings, 'immaculateTaste.maxPoints') ?? 50) || 50;
    const includeRefresherAfterUpdate =
      pickBool(settings, 'immaculateTaste.includeRefresherAfterUpdate') ?? true;
    const startSearchImmediately =
      pickBool(settings, 'jobs.immaculateTastePoints.searchImmediately') ?? false;
    const webContextFraction =
      pickNumber(settings, 'recommendations.webContextFraction') ??
      pickNumber(settings, 'recommendations.web_context_fraction') ??
      0.3;

    await ctx.info('immaculateTastePoints: config', {
      movieLibraryName,
      movieSectionKey,
      openAiEnabled,
      googleEnabled,
      suggestionsPerRun,
      upcomingPercent,
      maxPoints,
      includeRefresherAfterUpdate,
      startSearchImmediately,
      webContextFraction,
    });

    await this.immaculateTaste.ensureLegacyImported({
      ctx,
      librarySectionKey: movieSectionKey,
      maxPoints,
    });

    // --- Recommend (tiered pipeline: Google -> OpenAI -> TMDb) ---
    const recs = await this.recommendations.buildSimilarMovieTitles({
      ctx,
      seedTitle,
      seedYear,
      tmdbApiKey,
      count: suggestionsPerRun,
      webContextFraction,
      upcomingPercent,
      openai: openAiEnabled
        ? { apiKey: openAiApiKey, model: openAiModel }
        : null,
      google: googleEnabled
        ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
        : null,
    });

    await ctx.info('immaculateTastePoints: recommendations ready', {
      strategy: recs.strategy,
      returned: recs.titles.length,
      sample: recs.titles.slice(0, 12),
    });
    const generatedTitles = recs.titles
      .map((t) => String(t ?? '').trim())
      .filter(Boolean);

    // --- Resolve in Plex ---
    void ctx
      .patchSummary({
        progress: {
          step: 'plex_match',
          message: 'Matching recommended titles in Plex…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    await ctx.info('immaculateTastePoints: resolving titles in Plex', {
      requested: recs.titles.length,
    });

    const resolved: Array<{ ratingKey: string; title: string }> = [];
    const missingTitles: string[] = [];
    for (const title of recs.titles) {
      const t = title.trim();
      if (!t) continue;
      const found = await this.plexServer
        .findMovieRatingKeyByTitle({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey: movieSectionKey,
          title: t,
        })
        .catch(() => null);
      if (found)
        resolved.push({ ratingKey: found.ratingKey, title: found.title });
      else missingTitles.push(t);
    }

    // Deduplicate by ratingKey (preserving order)
    const unique = new Map<string, string>();
    for (const it of resolved) {
      if (!unique.has(it.ratingKey)) unique.set(it.ratingKey, it.title);
    }
    const suggestedItems = Array.from(unique.entries()).map(
      ([ratingKey, title]) => ({
      ratingKey,
      title,
      }),
    );
    const resolvedTitles = suggestedItems.map((d) => d.title);

    await ctx.info('immaculateTastePoints: plex resolve done', {
      resolved: suggestedItems.length,
      missing: missingTitles.length,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: suggestedItems.slice(0, 10).map((d) => d.title),
    });

    // --- Resolve TMDB ids + ratings for BOTH in-Plex and missing titles (so we can persist pending suggestions)
    const tmdbDetailsCache = new Map<
      number,
      { vote_average: number | null; vote_count: number | null }
    >();
    const getVoteStats = async (tmdbId: number) => {
      const cached = tmdbDetailsCache.get(tmdbId) ?? null;
      if (cached) return cached;

      const vote = await this.tmdb
        .getMovieVoteStats({ apiKey: tmdbApiKey, tmdbId })
        .catch(() => null);
      const normalized = {
        vote_average: vote?.vote_average ?? null,
        vote_count: vote?.vote_count ?? null,
      };
      tmdbDetailsCache.set(tmdbId, normalized);
      return normalized;
    };
    const suggestedForPoints: Array<{
      tmdbId: number;
      title: string;
      tmdbVoteAvg: number | null;
      tmdbVoteCount: number | null;
      inPlex: boolean;
    }> = [];

    const missingTitleToTmdb = new Map<
      string,
      {
        tmdbId: number;
        title: string;
        year: number | null;
        vote_average: number | null;
        vote_count: number | null;
      }
    >();

    // In Plex: prefer Plex GUIDs for tmdbId, then fetch rating from TMDB.
    for (const it of suggestedItems) {
      const rk = it.ratingKey.trim();
      if (!rk) continue;

      const meta = await this.plexServer
        .getMetadataDetails({
          baseUrl: plexBaseUrl,
          token: plexToken,
          ratingKey: rk,
        })
        .catch(() => null);

      let tmdbId = meta?.tmdbIds?.[0] ?? null;
      const title = (meta?.title ?? it.title ?? '').trim() || it.title;

      if (!tmdbId) {
        const match = await this.pickBestTmdbMatch({
          tmdbApiKey,
          title,
        }).catch(() => null);
        tmdbId = match?.tmdbId ?? null;
      }

      if (!tmdbId) continue;

      const cached = await getVoteStats(tmdbId);

      suggestedForPoints.push({
        tmdbId,
        title,
        tmdbVoteAvg: cached.vote_average,
        tmdbVoteCount: cached.vote_count,
        inPlex: true,
      });
    }

    // Missing in Plex: resolve via TMDB search (includes vote_average/vote_count).
    for (const title of missingTitles) {
      const t = title.trim();
      if (!t) continue;
      if (missingTitleToTmdb.has(t)) continue;

      const match = await this.pickBestTmdbMatch({
        tmdbApiKey,
        title: t,
      }).catch(() => null);
      if (!match) continue;

      const cached = await getVoteStats(match.tmdbId);
      const resolved = {
        ...match,
        vote_average: cached.vote_average ?? match.vote_average,
        vote_count: cached.vote_count ?? match.vote_count,
      };

      missingTitleToTmdb.set(t, resolved);
      suggestedForPoints.push({
        tmdbId: resolved.tmdbId,
        title: resolved.title,
        tmdbVoteAvg: resolved.vote_average,
        tmdbVoteCount: resolved.vote_count,
        inPlex: false,
      });
    }

    await ctx.info('immaculateTastePoints: tmdb resolve done', {
      suggestedForPoints: suggestedForPoints.length,
      withPlex: suggestedForPoints.filter((s) => s.inPlex).length,
      pending: suggestedForPoints.filter((s) => !s.inPlex).length,
      sampleTmdb: suggestedForPoints.slice(0, 10).map((s) => s.tmdbId),
    });

    // --- Optional Radarr: add missing titles (best-effort) ---
    const radarrBaseUrlRaw = pickString(settings, 'radarr.baseUrl');
    const radarrApiKey = pickString(secrets, 'radarr.apiKey');
    // Back-compat: if radarr.enabled isn't set, treat "secret present" as enabled.
    const radarrEnabled =
      (pickBool(settings, 'radarr.enabled') ?? Boolean(radarrApiKey)) &&
      Boolean(radarrBaseUrlRaw) &&
      Boolean(radarrApiKey);
    const radarrBaseUrl = radarrEnabled
      ? normalizeHttpUrl(radarrBaseUrlRaw)
      : '';

    const radarrStats = {
      enabled: radarrEnabled,
      attempted: 0,
      added: 0,
      exists: 0,
      failed: 0,
      skipped: 0,
    };
    const radarrLists = {
      attempted: [] as string[],
      added: [] as string[],
      exists: [] as string[],
      failed: [] as string[],
      skipped: [] as string[],
    };

    if (!ctx.dryRun && radarrEnabled && missingTitles.length) {
      await ctx.info('radarr: start', {
        missingTitles: missingTitles.length,
        sampleMissing: missingTitles.slice(0, 10),
      });

      const defaults = await this.pickRadarrDefaults({
        ctx,
        baseUrl: radarrBaseUrl,
        apiKey: radarrApiKey,
        preferredRootFolderPath:
          pickString(settings, 'radarr.defaultRootFolderPath') ||
          pickString(settings, 'radarr.rootFolderPath'),
        preferredQualityProfileId:
          Math.max(
            1,
            Math.trunc(
              pickNumber(settings, 'radarr.defaultQualityProfileId') ??
                pickNumber(settings, 'radarr.qualityProfileId') ??
                1,
            ),
          ) || 1,
        preferredTagId: (() => {
          const v =
            pickNumber(settings, 'radarr.defaultTagId') ??
            pickNumber(settings, 'radarr.tagId');
          return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
        })(),
      }).catch((err) => ({ error: (err as Error)?.message ?? String(err) }));

      if ('error' in defaults) {
        await ctx.warn(
          'radarr: defaults unavailable (skipping adds)',
          defaults,
        );
      } else {
        let radarrIndexByTmdb: Map<number, RadarrMovie> | null = null;
        const ensureRadarrIndex = async () => {
          if (radarrIndexByTmdb) return radarrIndexByTmdb;
          const movies = await this.radarr.listMovies({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
          });
          const map = new Map<number, RadarrMovie>();
          for (const m of movies) {
            const tmdbId = typeof m.tmdbId === 'number' ? m.tmdbId : Number(m.tmdbId);
            if (Number.isFinite(tmdbId) && tmdbId > 0) {
              map.set(Math.trunc(tmdbId), m);
            }
          }
          radarrIndexByTmdb = map;
          return map;
        };

        for (const title of missingTitles) {
          const tmdbMatch = missingTitleToTmdb.get(title.trim()) ?? null;
          if (!tmdbMatch) {
            radarrStats.skipped += 1;
            radarrLists.skipped.push(title.trim());
            continue;
          }
          radarrStats.attempted += 1;
          radarrLists.attempted.push(tmdbMatch.title);

          try {
            const result = await this.radarr.addMovie({
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
              title: tmdbMatch.title,
              tmdbId: tmdbMatch.tmdbId,
              year: tmdbMatch.year ?? null,
              qualityProfileId: defaults.qualityProfileId,
              rootFolderPath: defaults.rootFolderPath,
              tags: defaults.tagIds,
              monitored: true,
              minimumAvailability: 'announced',
              searchForMovie: startSearchImmediately,
            });
            if (result.status === 'added') {
              radarrStats.added += 1;
              radarrLists.added.push(tmdbMatch.title);
            } else {
              radarrStats.exists += 1;
              radarrLists.exists.push(tmdbMatch.title);

              // Best-effort: ensure existing Radarr movies are monitored (matches the UI expectation).
              const idx = await ensureRadarrIndex().catch(() => null);
              const existing = idx ? idx.get(tmdbMatch.tmdbId) ?? null : null;
              if (existing) {
                await this.radarr
                  .setMovieMonitored({
                    baseUrl: radarrBaseUrl,
                    apiKey: radarrApiKey,
                    movie: existing,
                    monitored: true,
                  })
                  .catch(() => undefined);
              }
            }
          } catch (err) {
            radarrStats.failed += 1;
            radarrLists.failed.push(tmdbMatch.title);
            await ctx.warn('radarr: add failed (continuing)', {
              title,
              error: (err as Error)?.message ?? String(err),
            });
          }
        }
      }

      await ctx.info('radarr: done', radarrStats);
    }

    // --- Update points dataset (DB) ---
    const pointsSummary = ctx.dryRun
      ? ({ dryRun: true } as JsonObject)
      : await this.immaculateTaste.applyPointsUpdate({
          ctx,
          librarySectionKey: movieSectionKey,
          suggested: suggestedForPoints,
          maxPoints,
        });

    // --- Optional chained refresher (rebuild Plex collection from points DB) ---
    let refresherSummary: JsonObject | null = null;
    if (!includeRefresherAfterUpdate) {
      refresherSummary = { skipped: true, reason: 'disabled' };
      await ctx.info('immaculateTastePoints: refresher skipped (disabled)', {
        includeRefresherAfterUpdate,
      });
    } else if (ctx.dryRun) {
      refresherSummary = { skipped: true, reason: 'dry_run' };
      await ctx.info('immaculateTastePoints: refresher skipped (dryRun)', {
        includeRefresherAfterUpdate,
      });
    } else {
      await ctx.info('immaculateTastePoints: running refresher (chained)', {
        jobId: 'immaculateTasteRefresher',
      });
      void ctx
        .patchSummary({
          progress: {
            step: 'plex_collection_sync',
            message: 'Refreshing Plex collection…',
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
      const refresherResult = await this.immaculateTasteRefresher.run({
        ...ctx,
        input: {
          ...(ctx.input ?? {}),
          includeMovies: true,
          includeTv: false,
          movieSectionKey,
          movieLibraryName,
        },
      });
      refresherSummary = refresherResult.summary ?? null;
      await ctx.info('immaculateTastePoints: refresher done (chained)', {
        refresher: refresherSummary,
      });
    }

    const summary: JsonObject = {
      seedTitle,
      seedYear,
      recommendationStrategy: recs.strategy,
      generated: recs.titles.length,
      generatedTitles,
      resolvedInPlex: suggestedItems.length,
      resolvedTitles,
      missingInPlex: missingTitles.length,
      missingTitles,
      radarr: radarrStats,
      radarrLists,
      startSearchImmediately,
      points: pointsSummary,
      refresher: refresherSummary,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: suggestedItems.slice(0, 10).map((d) => d.title),
    };

    await ctx.info('immaculateTastePoints: done', summary);
    const report = buildImmaculateTastePointsReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }

  private async runTv(params: {
    ctx: JobContext;
    seedTitle: string;
    seedYear: number | null;
    seedRatingKey: string;
    seedLibrarySectionIdRaw: string;
    seedLibrarySectionTitle: string;
  }): Promise<JobRunResult> {
    const {
      ctx,
      seedTitle,
      seedYear,
      seedRatingKey,
      seedLibrarySectionIdRaw,
      seedLibrarySectionTitle,
    } = params;

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    void ctx
      .patchSummary({
        progress: {
          step: 'dataset',
          message: 'Locating Immaculate Taste dataset…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    // --- Plex settings ---
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_libraries',
          message: 'Searching Plex TV libraries…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const tvSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'show')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!tvSections.length) throw new Error('No Plex TV libraries found');

    let tvSectionKey = seedLibrarySectionIdRaw || '';
    let tvLibraryName = seedLibrarySectionTitle || '';

    if (!tvSectionKey && seedRatingKey) {
      const meta = await this.plexServer
        .getMetadataDetails({
          baseUrl: plexBaseUrl,
          token: plexToken,
          ratingKey: seedRatingKey,
        })
        .catch(() => null);
      if (meta?.librarySectionId) tvSectionKey = meta.librarySectionId;
      if (meta?.librarySectionTitle) tvLibraryName = meta.librarySectionTitle;
    }

    if (!tvSectionKey) {
      const preferred =
        tvSections.find((s) => s.title.toLowerCase() === 'tv shows') ??
        tvSections.find((s) => s.title.toLowerCase() === 'shows') ??
        tvSections[0];
      tvSectionKey = preferred.key;
      tvLibraryName = preferred.title;
    } else {
      const match = sections.find((s) => s.key === tvSectionKey);
      if (match?.title) tvLibraryName = match.title;
      if (match?.type && match.type.toLowerCase() !== 'show') {
        await ctx.warn(
          'plex: seed librarySectionID is not a TV library (continuing)',
          {
            tvSectionKey,
            libraryTitle: match.title,
            libraryType: match.type,
          },
        );
      }
    }

    if (!tvLibraryName) {
      tvLibraryName =
        sections.find((s) => s.key === tvSectionKey)?.title ??
        tvSections.find((s) => s.key === tvSectionKey)?.title ??
        'TV Shows';
    }

    // --- Recommendation + integration config ---
    const tmdbApiKey =
      pickString(secrets, 'tmdb.apiKey') ||
      pickString(secrets, 'tmdbApiKey') ||
      pickString(secrets, 'tmdb.api_key');
    if (!tmdbApiKey) throw new Error('TMDB apiKey is not set');

    const openAiEnabledFlag = pickBool(settings, 'openai.enabled') ?? false;
    const openAiApiKey = pickString(secrets, 'openai.apiKey');
    const openAiModel = pickString(settings, 'openai.model') || null;
    const openAiEnabled = openAiEnabledFlag && Boolean(openAiApiKey);

    const googleEnabledFlag = pickBool(settings, 'google.enabled') ?? false;
    const googleApiKey = pickString(secrets, 'google.apiKey');
    const googleSearchEngineId = pickString(settings, 'google.searchEngineId');
    const googleEnabled =
      googleEnabledFlag &&
      Boolean(googleApiKey) &&
      Boolean(googleSearchEngineId);

    const suggestionsPerRunRaw =
      pickNumber(settings, 'recommendations.count') ??
      pickNumber(settings, 'immaculateTaste.suggestionsPerRun') ??
      10;
    const suggestionsPerRun = Math.max(
      5,
      Math.min(100, Math.trunc(suggestionsPerRunRaw || 10)),
    );
    const upcomingPercentRaw =
      pickNumber(settings, 'recommendations.upcomingPercent') ?? 25;
    const upcomingPercent = Math.max(
      0,
      Math.min(75, Math.trunc(upcomingPercentRaw || 25)),
    );
    const maxPoints =
      Math.trunc(pickNumber(settings, 'immaculateTaste.maxPoints') ?? 50) || 50;
    const includeRefresherAfterUpdate =
      pickBool(settings, 'immaculateTaste.includeRefresherAfterUpdate') ?? true;
    const startSearchImmediately =
      pickBool(settings, 'jobs.immaculateTastePoints.searchImmediately') ?? false;
    const webContextFraction =
      pickNumber(settings, 'recommendations.webContextFraction') ??
      pickNumber(settings, 'recommendations.web_context_fraction') ??
      0.3;

    await ctx.info('immaculateTastePoints(tv): config', {
      tvLibraryName,
      tvSectionKey,
      openAiEnabled,
      googleEnabled,
      suggestionsPerRun,
      upcomingPercent,
      maxPoints,
      includeRefresherAfterUpdate,
      startSearchImmediately,
      webContextFraction,
    });

    await this.immaculateTasteTv.ensureLegacyImported({ ctx, maxPoints });

    const recs = await this.recommendations.buildSimilarTvTitles({
      ctx,
      seedTitle,
      seedYear,
      tmdbApiKey,
      count: suggestionsPerRun,
      webContextFraction,
      upcomingPercent,
      openai: openAiEnabled ? { apiKey: openAiApiKey, model: openAiModel } : null,
      google: googleEnabled
        ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
        : null,
    });

    await ctx.info('immaculateTastePoints(tv): recommendations ready', {
      strategy: recs.strategy,
      returned: recs.titles.length,
      sample: recs.titles.slice(0, 12),
    });
    const generatedTitles = recs.titles
      .map((t) => String(t ?? '').trim())
      .filter(Boolean);

    // --- Resolve in Plex ---
    void ctx
      .patchSummary({
        progress: {
          step: 'plex_match',
          message: 'Matching recommended titles in Plex…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    await ctx.info('immaculateTastePoints(tv): resolving titles in Plex', {
      requested: recs.titles.length,
    });

    const resolved: Array<{ ratingKey: string; title: string }> = [];
    const missingTitles: string[] = [];
    for (const title of recs.titles) {
      const t = title.trim();
      if (!t) continue;
      const found = await this.plexServer
        .findShowRatingKeyByTitle({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey: tvSectionKey,
          title: t,
        })
        .catch(() => null);
      if (found) resolved.push({ ratingKey: found.ratingKey, title: found.title });
      else missingTitles.push(t);
    }

    const unique = new Map<string, string>();
    for (const it of resolved) {
      if (!unique.has(it.ratingKey)) unique.set(it.ratingKey, it.title);
    }
    const suggestedItems = Array.from(unique.entries()).map(
      ([ratingKey, title]) => ({ ratingKey, title }),
    );
    const resolvedTitles = suggestedItems.map((d) => d.title);

    await ctx.info('immaculateTastePoints(tv): plex resolve done', {
      resolved: suggestedItems.length,
      missing: missingTitles.length,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: suggestedItems.slice(0, 10).map((d) => d.title),
    });

    // --- Resolve TMDB ids + tvdb ids + ratings for BOTH in-Plex and missing titles
    const matchCache = new Map<
      string,
      | {
          tmdbId: number;
          tvdbId: number | null;
          title: string;
          year: number | null;
          vote_average: number | null;
          vote_count: number | null;
        }
      | null
    >();
    const getMatch = async (title: string) => {
      const key = title.trim().toLowerCase();
      if (!key) return null;
      if (matchCache.has(key)) return matchCache.get(key) ?? null;
      const match = await this.pickBestTmdbTvMatch({
        tmdbApiKey,
        title,
      }).catch(() => null);
      matchCache.set(key, match);
      return match;
    };

    const suggestedForPoints: Array<{
      tvdbId: number;
      tmdbId: number | null;
      title: string;
      tmdbVoteAvg: number | null;
      tmdbVoteCount: number | null;
      inPlex: boolean;
    }> = [];

    const missingTitleToIds = new Map<
      string,
      { tvdbId: number | null; title: string }
    >();

    const pushSuggested = (
      match: {
        tmdbId: number;
        tvdbId: number | null;
        title: string;
        vote_average: number | null;
        vote_count: number | null;
      },
      inPlex: boolean,
    ) => {
      if (!match.tvdbId) return;
      suggestedForPoints.push({
        tvdbId: match.tvdbId,
        tmdbId: match.tmdbId,
        title: match.title,
        tmdbVoteAvg: match.vote_average,
        tmdbVoteCount: match.vote_count,
        inPlex,
      });
    };

    for (const it of suggestedItems) {
      const match = await getMatch(it.title);
      if (!match) continue;
      pushSuggested(match, true);
    }
    for (const title of missingTitles) {
      const match = await getMatch(title);
      if (!match) continue;
      pushSuggested(match, false);
      missingTitleToIds.set(title.trim(), {
        tvdbId: match.tvdbId,
        title: match.title,
      });
    }

    // --- Sonarr add missing series (best-effort)
    const sonarrBaseUrlRaw = pickString(settings, 'sonarr.baseUrl');
    const sonarrApiKey = pickString(secrets, 'sonarr.apiKey');
    const sonarrEnabled =
      (pickBool(settings, 'sonarr.enabled') ?? Boolean(sonarrApiKey)) &&
      Boolean(sonarrBaseUrlRaw) &&
      Boolean(sonarrApiKey);
    const sonarrBaseUrl = sonarrEnabled
      ? normalizeHttpUrl(sonarrBaseUrlRaw)
      : '';

    const sonarrStats = {
      enabled: sonarrEnabled,
      attempted: 0,
      added: 0,
      exists: 0,
      skipped: 0,
      failed: 0,
    };
    const sonarrLists = {
      attempted: [] as string[],
      added: [] as string[],
      exists: [] as string[],
      failed: [] as string[],
      skipped: [] as string[],
    };

    if (!ctx.dryRun && sonarrEnabled && missingTitles.length) {
      const defaults = await this.pickSonarrDefaults({
        ctx,
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
        preferredRootFolderPath:
          pickString(settings, 'sonarr.defaultRootFolderPath') ||
          pickString(settings, 'sonarr.rootFolderPath'),
        preferredQualityProfileId:
          Math.max(
            1,
            Math.trunc(
              pickNumber(settings, 'sonarr.defaultQualityProfileId') ??
                pickNumber(settings, 'sonarr.qualityProfileId') ??
                1,
            ),
          ) || 1,
        preferredTagId: (() => {
          const v =
            pickNumber(settings, 'sonarr.defaultTagId') ??
            pickNumber(settings, 'sonarr.tagId');
          return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
        })(),
      }).catch((err) => ({ error: (err as Error)?.message ?? String(err) }));

      if ('error' in defaults) {
        await ctx.warn('sonarr: defaults unavailable (skipping adds)', defaults);
      } else {
        // Best-effort: keep existing series monitored when they already exist in Sonarr.
        let sonarrIndexByTvdb: Map<number, SonarrSeries> | null = null;
        const ensureSonarrIndex = async () => {
          if (sonarrIndexByTvdb) return sonarrIndexByTvdb;
          const all = await this.sonarr.listSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
          });
          const map = new Map<number, SonarrSeries>();
          for (const s of all) {
            const tvdbId = typeof s.tvdbId === 'number' ? s.tvdbId : Number(s.tvdbId);
            if (Number.isFinite(tvdbId) && tvdbId > 0) {
              map.set(Math.trunc(tvdbId), s);
            }
          }
          sonarrIndexByTvdb = map;
          return map;
        };

        for (const title of missingTitles) {
          const ids = missingTitleToIds.get(title.trim()) ?? null;
          if (!ids || !ids.tvdbId) {
            sonarrStats.skipped += 1;
            sonarrLists.skipped.push(title.trim());
            continue;
          }
          sonarrStats.attempted += 1;
          sonarrLists.attempted.push(ids.title);

          try {
            const result = await this.sonarr.addSeries({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              title: ids.title,
              tvdbId: ids.tvdbId,
              qualityProfileId: defaults.qualityProfileId,
              rootFolderPath: defaults.rootFolderPath,
              tags: defaults.tagIds,
              monitored: true,
              searchForMissingEpisodes: startSearchImmediately,
              searchForCutoffUnmetEpisodes: startSearchImmediately,
            });
            if (result.status === 'added') {
              sonarrStats.added += 1;
              sonarrLists.added.push(ids.title);
            } else {
              sonarrStats.exists += 1;
              sonarrLists.exists.push(ids.title);

              const idx = await ensureSonarrIndex().catch(() => null);
              const existing = idx ? idx.get(ids.tvdbId) ?? null : null;
              if (existing && existing.monitored === false) {
                await this.sonarr
                  .updateSeries({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    series: { ...existing, monitored: true },
                  })
                  .catch(() => undefined);
              }
            }
          } catch (err) {
            sonarrStats.failed += 1;
            sonarrLists.failed.push(ids.title);
            await ctx.warn('sonarr: add failed (continuing)', {
              title,
              error: (err as Error)?.message ?? String(err),
            });
          }
        }
      }

      await ctx.info('sonarr: done', sonarrStats);
    }

    // --- Update points dataset (DB) ---
    const pointsSummary = ctx.dryRun
      ? ({ dryRun: true } as JsonObject)
      : await this.immaculateTasteTv.applyPointsUpdate({
          ctx,
          librarySectionKey: tvSectionKey,
          suggested: suggestedForPoints,
          maxPoints,
        });

    // --- Optional chained refresher ---
    let refresherSummary: JsonObject | null = null;
    if (!includeRefresherAfterUpdate) {
      refresherSummary = { skipped: true, reason: 'disabled' };
      await ctx.info('immaculateTastePoints(tv): refresher skipped (disabled)', {
        includeRefresherAfterUpdate,
      });
    } else if (ctx.dryRun) {
      refresherSummary = { skipped: true, reason: 'dry_run' };
      await ctx.info('immaculateTastePoints(tv): refresher skipped (dryRun)', {
        includeRefresherAfterUpdate,
      });
    } else {
      await ctx.info('immaculateTastePoints(tv): running refresher (chained)', {
        jobId: 'immaculateTasteRefresher',
      });
      void ctx
        .patchSummary({
          progress: {
            step: 'plex_collection_sync',
            message: 'Refreshing Plex collection…',
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
      const refresherResult = await this.immaculateTasteRefresher.run({
        ...ctx,
        input: {
          ...(ctx.input ?? {}),
          includeMovies: false,
          includeTv: true,
          tvSectionKey,
          tvLibraryName,
        },
      });
      refresherSummary = refresherResult.summary ?? null;
      await ctx.info('immaculateTastePoints(tv): refresher done (chained)', {
        refresher: refresherSummary,
      });
    }

    const summary: JsonObject = {
      seedTitle,
      seedYear,
      recommendationStrategy: recs.strategy,
      generated: recs.titles.length,
      generatedTitles,
      resolvedInPlex: suggestedItems.length,
      resolvedTitles,
      missingInPlex: missingTitles.length,
      missingTitles,
      sonarr: sonarrStats,
      sonarrLists,
      startSearchImmediately,
      points: pointsSummary,
      refresher: refresherSummary,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: suggestedItems.slice(0, 10).map((d) => d.title),
    };

    await ctx.info('immaculateTastePoints(tv): done', summary);
    const report = buildImmaculateTastePointsReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }

  private async pickRadarrDefaults(params: {
    ctx: JobContext;
    baseUrl: string;
    apiKey: string;
    preferredRootFolderPath?: string;
    preferredQualityProfileId?: number;
    preferredTagId?: number | null;
  }): Promise<{
    rootFolderPath: string;
    qualityProfileId: number;
    tagIds: number[];
  }> {
    const { ctx, baseUrl, apiKey } = params;

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.radarr.listRootFolders({ baseUrl, apiKey }),
      this.radarr.listQualityProfiles({ baseUrl, apiKey }),
      this.radarr.listTags({ baseUrl, apiKey }),
    ]);

    if (!rootFolders.length)
      throw new Error('Radarr has no root folders configured');
    if (!qualityProfiles.length)
      throw new Error('Radarr has no quality profiles configured');

    const preferredRoot = (params.preferredRootFolderPath ?? '').trim();
    const rootFolder = preferredRoot
      ? (rootFolders.find((r) => r.path === preferredRoot) ?? rootFolders[0])
      : rootFolders[0];

    const desiredQualityId = Math.max(
      1,
      Math.trunc(params.preferredQualityProfileId ?? 1),
    );
    const qualityProfile =
      qualityProfiles.find((p) => p.id === desiredQualityId) ??
      (desiredQualityId !== 1
        ? qualityProfiles.find((p) => p.id === 1)
        : null) ??
      qualityProfiles[0];

    const preferredTagId =
      typeof params.preferredTagId === 'number' &&
      Number.isFinite(params.preferredTagId)
        ? Math.trunc(params.preferredTagId)
        : null;
    const tag = preferredTagId
      ? tags.find((t) => t.id === preferredTagId)
      : null;

    const rootFolderPath = rootFolder.path;
    const qualityProfileId = qualityProfile.id;
    const tagIds = tag ? [tag.id] : [];

    await ctx.info('radarr: defaults selected', {
      rootFolderPath,
      qualityProfileId,
      qualityProfileName: qualityProfile.name,
      tagIds,
      tagLabel: tag?.label ?? null,
      usedPreferredRootFolder: Boolean(
        preferredRoot && rootFolder.path === preferredRoot,
      ),
      usedPreferredQualityProfile: Boolean(
        qualityProfile.id === desiredQualityId,
      ),
      usedPreferredTag: Boolean(tag),
    });

    return { rootFolderPath, qualityProfileId, tagIds };
  }

  private async pickSonarrDefaults(params: {
    ctx: JobContext;
    baseUrl: string;
    apiKey: string;
    preferredRootFolderPath?: string;
    preferredQualityProfileId?: number;
    preferredTagId?: number | null;
  }): Promise<{
    rootFolderPath: string;
    qualityProfileId: number;
    tagIds: number[];
  }> {
    const { ctx, baseUrl, apiKey } = params;

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.sonarr.listRootFolders({ baseUrl, apiKey }),
      this.sonarr.listQualityProfiles({ baseUrl, apiKey }),
      this.sonarr.listTags({ baseUrl, apiKey }),
    ]);

    if (!rootFolders.length)
      throw new Error('Sonarr has no root folders configured');
    if (!qualityProfiles.length)
      throw new Error('Sonarr has no quality profiles configured');

    const preferredRoot = (params.preferredRootFolderPath ?? '').trim();
    const rootFolder = preferredRoot
      ? (rootFolders.find((r) => r.path === preferredRoot) ?? rootFolders[0])
      : rootFolders[0];

    const desiredQualityId = Math.max(
      1,
      Math.trunc(params.preferredQualityProfileId ?? 1),
    );
    const qualityProfile =
      qualityProfiles.find((p) => p.id === desiredQualityId) ??
      (desiredQualityId !== 1
        ? qualityProfiles.find((p) => p.id === 1)
        : null) ??
      qualityProfiles[0];

    const preferredTagId =
      typeof params.preferredTagId === 'number' &&
      Number.isFinite(params.preferredTagId)
        ? Math.trunc(params.preferredTagId)
        : null;
    const tag = preferredTagId ? tags.find((t) => t.id === preferredTagId) : null;

    const rootFolderPath = rootFolder.path;
    const qualityProfileId = qualityProfile.id;
    const tagIds = tag ? [tag.id] : [];

    await ctx.info('sonarr: defaults selected', {
      rootFolderPath,
      qualityProfileId,
      qualityProfileName: qualityProfile.name,
      tagIds,
      tagLabel: tag?.label ?? null,
      usedPreferredRootFolder: Boolean(
        preferredRoot && rootFolder.path === preferredRoot,
      ),
      usedPreferredQualityProfile: Boolean(qualityProfile.id === desiredQualityId),
      usedPreferredTag: Boolean(tag),
    });

    return { rootFolderPath, qualityProfileId, tagIds };
  }

  private async pickBestTmdbMatch(params: {
    tmdbApiKey: string;
    title: string;
  }): Promise<{
    tmdbId: number;
    title: string;
    year: number | null;
    vote_average: number | null;
    vote_count: number | null;
  } | null> {
    const results = await this.tmdb.searchMovie({
      apiKey: params.tmdbApiKey,
      query: params.title,
      includeAdult: false,
      year: null,
    });
    if (!results.length) return null;

    const q = params.title.trim().toLowerCase();
    const exact = results.find((r) => r.title.trim().toLowerCase() === q);
    const best = exact ?? results[0];
    const yearRaw = (best.release_date ?? '').slice(0, 4);
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;

    return {
      tmdbId: best.id,
      title: best.title,
      year: Number.isFinite(year) ? year : null,
      vote_average:
        typeof best.vote_average === 'number' &&
        Number.isFinite(best.vote_average)
          ? Number(best.vote_average)
          : null,
      vote_count:
        typeof best.vote_count === 'number' && Number.isFinite(best.vote_count)
          ? Math.max(0, Math.trunc(best.vote_count))
          : null,
    };
  }

  private async pickBestTmdbTvMatch(params: {
    tmdbApiKey: string;
    title: string;
  }): Promise<{
    tmdbId: number;
    tvdbId: number | null;
    title: string;
    year: number | null;
    vote_average: number | null;
    vote_count: number | null;
  } | null> {
    const results = await this.tmdb.searchTv({
      apiKey: params.tmdbApiKey,
      query: params.title,
      includeAdult: false,
      firstAirDateYear: null,
    });
    if (!results.length) return null;

    const q = params.title.trim().toLowerCase();
    const exact = results.find((r) => r.name.trim().toLowerCase() === q);
    const best = exact ?? results[0];

    const details = await this.tmdb
      .getTv({
        apiKey: params.tmdbApiKey,
        tmdbId: best.id,
        appendExternalIds: true,
      })
      .catch(() => null);

    const tvdbIdRaw = details?.external_ids?.tvdb_id ?? null;
    const tvdbId =
      typeof tvdbIdRaw === 'number' && Number.isFinite(tvdbIdRaw)
        ? Math.trunc(tvdbIdRaw)
        : null;

    const yearRaw = (details?.first_air_date ?? best.first_air_date ?? '').slice(
      0,
      4,
    );
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;

    const voteAverageRaw = details?.vote_average ?? best.vote_average ?? null;
    const voteCountRaw = details?.vote_count ?? best.vote_count ?? null;

    const vote_average =
      typeof voteAverageRaw === 'number' && Number.isFinite(voteAverageRaw)
        ? Number(voteAverageRaw)
        : null;
    const vote_count =
      typeof voteCountRaw === 'number' && Number.isFinite(voteCountRaw)
        ? Math.max(0, Math.trunc(voteCountRaw))
        : null;

    return {
      tmdbId: best.id,
      tvdbId,
      title: details?.name ?? best.name,
      year: Number.isFinite(year) ? year : null,
      vote_average,
      vote_count,
    };
  }
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function buildImmaculateTastePointsReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;

  const asStringArray = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
  };
  const uniqueStrings = (arr: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of arr) {
      const v = String(s ?? '').trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  };

  const radarr = isPlainObject(raw.radarr) ? raw.radarr : null;
  const sonarr = isPlainObject(raw.sonarr) ? raw.sonarr : null;
  const points = isPlainObject(raw.points) ? raw.points : null;

  const generated = asNum(raw.generated) ?? 0;
  const resolvedInPlex = asNum(raw.resolvedInPlex) ?? 0;
  const missingInPlex = asNum(raw.missingInPlex) ?? 0;

  const totalBefore = points ? asNum(points.totalBefore) : null;
  const totalAfter = points ? asNum(points.totalAfter) : null;
  const activeBefore = points ? asNum(points.totalActiveBefore) : null;
  const activeAfter = points ? asNum(points.totalActiveAfter) : null;
  const pendingBefore = points ? asNum(points.totalPendingBefore) : null;
  const pendingAfter = points ? asNum(points.totalPendingAfter) : null;

  const radarrFailed = radarr ? (asNum(radarr.failed) ?? 0) : 0;
  const sonarrFailed = sonarr ? (asNum(sonarr.failed) ?? 0) : 0;

  const refresher = raw.refresher;
  const refresherObj =
    refresher && typeof refresher === 'object' && !Array.isArray(refresher)
      ? (refresher as Record<string, unknown>)
      : null;
  const refresherSkipped =
    refresherObj && typeof refresherObj.skipped === 'boolean' ? refresherObj.skipped : null;
  const refresherReason =
    refresherObj && typeof refresherObj.reason === 'string' ? refresherObj.reason : null;

  const issues = [
    ...(radarrFailed ? [issue('warn', `Radarr: ${radarrFailed} add(s) failed.`)] : []),
    ...(sonarrFailed ? [issue('warn', `Sonarr: ${sonarrFailed} add(s) failed.`)] : []),
  ];

  const mode = sonarr ? 'tv' : 'movie';
  const generatedTitles = uniqueStrings(asStringArray(raw.generatedTitles));
  const resolvedTitles = uniqueStrings(asStringArray(raw.resolvedTitles));
  const missingTitles = uniqueStrings(asStringArray(raw.missingTitles));
  const seedTitle = String(raw.seedTitle ?? '').trim();

  const radarrLists = isPlainObject(raw.radarrLists) ? raw.radarrLists : null;
  const sonarrLists = isPlainObject(raw.sonarrLists) ? raw.sonarrLists : null;

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline:
      mode === 'tv'
        ? seedTitle
          ? `Immaculate Taste (TV) updated by ${seedTitle}.`
          : 'Immaculate Taste (TV) updated.'
        : seedTitle
          ? `Immaculate Taste updated by ${seedTitle}.`
          : 'Immaculate Taste updated.',
    sections: [
      {
        id: 'totals',
        title: 'Totals',
        rows: [
          metricRow({ label: 'Recommendations generated', end: generated, unit: 'titles' }),
          metricRow({ label: 'Resolved in Plex', end: resolvedInPlex, unit: 'items' }),
          metricRow({ label: 'Missing in Plex', end: missingInPlex, unit: 'titles' }),
        ],
      },
      {
        id: 'points',
        title: 'Points dataset',
        rows: [
          metricRow({
            label: 'Rows (total)',
            start: totalBefore,
            changed:
              totalBefore !== null && totalAfter !== null ? totalAfter - totalBefore : null,
            end: totalAfter,
            unit: 'rows',
          }),
          metricRow({
            label: 'Rows (active)',
            start: activeBefore,
            changed:
              activeBefore !== null && activeAfter !== null ? activeAfter - activeBefore : null,
            end: activeAfter,
            unit: 'rows',
          }),
          metricRow({
            label: 'Rows (pending)',
            start: pendingBefore,
            changed:
              pendingBefore !== null && pendingAfter !== null ? pendingAfter - pendingBefore : null,
            end: pendingAfter,
            unit: 'rows',
          }),
          metricRow({ label: 'Created active', end: points ? asNum(points.createdActive) : null, unit: 'rows' }),
          metricRow({ label: 'Created pending', end: points ? asNum(points.createdPending) : null, unit: 'rows' }),
          metricRow({ label: 'Activated from pending', end: points ? asNum(points.activatedFromPending) : null, unit: 'rows' }),
          metricRow({ label: 'Decayed', end: points ? asNum(points.decayed) : null, unit: 'rows' }),
          metricRow({ label: 'Removed', end: points ? asNum(points.removed) : null, unit: 'rows' }),
        ],
      },
    ],
    tasks: [
      {
        id: 'recommendations',
        title: 'Generate recommendations',
        status: 'success',
        facts: [
          {
            label: 'Generated',
            value: {
              count: generated,
              unit: mode === 'tv' ? 'shows' : 'movies',
              items: generatedTitles,
            },
          },
          { label: 'Strategy', value: String(raw.recommendationStrategy ?? '') },
          { label: 'Seed', value: String(raw.seedTitle ?? '') },
          { label: 'Seed year', value: asNum(raw.seedYear) },
        ],
      },
      {
        id: 'plex_resolve',
        title: 'Resolve titles in Plex',
        status: 'success',
        facts: [
          {
            label: 'Resolved',
            value: {
              count: resolvedInPlex,
              unit: mode === 'tv' ? 'shows' : 'movies',
              items: resolvedTitles,
            },
          },
          {
            label: 'Missing',
            value: {
              count: missingInPlex,
              unit: mode === 'tv' ? 'shows' : 'movies',
              items: missingTitles,
            },
          },
        ],
      },
      ...(radarr
        ? [
            {
              id: 'radarr_add',
              title: 'Radarr: add missing movies',
              status:
                ctx.dryRun || !Boolean(radarr.enabled)
                  ? ('skipped' as const)
                  : radarrFailed
                    ? ('failed' as const)
                    : ('success' as const),
              facts: [
                {
                  label: 'Attempted',
                  value: {
                    count: asNum(radarr.attempted),
                    unit: 'movies',
                    items: uniqueStrings(
                      radarrLists ? asStringArray(radarrLists.attempted) : [],
                    ),
                  },
                },
                {
                  label: 'Added',
                  value: {
                    count: asNum(radarr.added),
                    unit: 'movies',
                    items: uniqueStrings(
                      radarrLists ? asStringArray(radarrLists.added) : [],
                    ),
                  },
                },
                {
                  label: 'Exists',
                  value: {
                    count: asNum(radarr.exists),
                    unit: 'movies',
                    items: uniqueStrings(
                      radarrLists ? asStringArray(radarrLists.exists) : [],
                    ),
                  },
                },
                {
                  label: 'Failed',
                  value: {
                    count: asNum(radarr.failed),
                    unit: 'movies',
                    items: uniqueStrings(
                      radarrLists ? asStringArray(radarrLists.failed) : [],
                    ),
                  },
                },
              ],
            },
          ]
        : []),
      ...(sonarr
        ? [
            {
              id: 'sonarr_add',
              title: 'Sonarr: add missing series',
              status:
                ctx.dryRun || !Boolean(sonarr.enabled)
                  ? ('skipped' as const)
                  : sonarrFailed
                    ? ('failed' as const)
                    : ('success' as const),
              facts: [
                {
                  label: 'Attempted',
                  value: {
                    count: asNum(sonarr.attempted),
                    unit: 'shows',
                    items: uniqueStrings(
                      sonarrLists ? asStringArray(sonarrLists.attempted) : [],
                    ),
                  },
                },
                {
                  label: 'Added',
                  value: {
                    count: asNum(sonarr.added),
                    unit: 'shows',
                    items: uniqueStrings(
                      sonarrLists ? asStringArray(sonarrLists.added) : [],
                    ),
                  },
                },
                {
                  label: 'Exists',
                  value: {
                    count: asNum(sonarr.exists),
                    unit: 'shows',
                    items: uniqueStrings(
                      sonarrLists ? asStringArray(sonarrLists.exists) : [],
                    ),
                  },
                },
                {
                  label: 'Failed',
                  value: {
                    count: asNum(sonarr.failed),
                    unit: 'shows',
                    items: uniqueStrings(
                      sonarrLists ? asStringArray(sonarrLists.failed) : [],
                    ),
                  },
                },
              ],
            },
          ]
        : []),
      {
        id: 'points_update',
        title: 'Update points dataset',
        status: ctx.dryRun ? 'skipped' : 'success',
        rows: [
          metricRow({
            label: 'Rows (total)',
            start: totalBefore,
            changed:
              totalBefore !== null && totalAfter !== null ? totalAfter - totalBefore : null,
            end: totalAfter,
            unit: 'rows',
          }),
        ],
      },
      {
        id: 'refresher',
        title: 'Refresh Plex collection (chained)',
        status: refresherSkipped === true ? 'skipped' : 'success',
        facts: [
          { label: 'skipped', value: refresherSkipped },
          { label: 'reason', value: refresherReason },
        ],
      },
    ],
    issues,
    raw,
  };
}
