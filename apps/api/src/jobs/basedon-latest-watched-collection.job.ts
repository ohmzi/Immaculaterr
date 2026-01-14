import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SettingsService } from '../settings/settings.service';
import { SonarrService } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { WatchedCollectionsRefresherService } from '../watched-movie-recommendations/watched-collections-refresher.service';
import type { JobContext, JobRunResult, JsonObject, JsonValue } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { metricRow } from './job-report-v1';
import { withJobRetry, withJobRetryOrNull } from './job-retry';

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
export class BasedonLatestWatchedCollectionJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly recommendations: RecommendationsService,
    private readonly tmdb: TmdbService,
    private readonly watchedRefresher: WatchedCollectionsRefresherService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
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

    await ctx.info('watchedMovieRecommendations: start', {
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
    const approvalRequiredFromObservatory =
      (pickBool(settings, 'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory') ??
        false) === true;

    // --- Plex settings ---
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
    const sections = await withJobRetry(
      () =>
        this.plexServer.getSections({
          baseUrl: plexBaseUrl,
          token: plexToken,
        }),
      { ctx, label: 'plex: get libraries' },
    );
    const movieSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!movieSections.length) throw new Error('No Plex movie libraries found');

    // Prefer the library section Plex tells us the watched movie belongs to.
    let movieSectionKey = seedLibrarySectionIdRaw || '';
    let movieLibraryName = seedLibrarySectionTitle || '';

    if (!movieSectionKey && seedRatingKey) {
      const meta = await withJobRetryOrNull(
        () =>
          this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: seedRatingKey,
          }),
        { ctx, label: 'plex: get seed metadata', meta: { ratingKey: seedRatingKey } },
      );
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
      if (match?.type && match.type.toLowerCase() !== 'movie') {
        await ctx.warn(
          'plex: seed librarySectionID is not a movie library (continuing)',
          {
          movieSectionKey,
          libraryTitle: match.title,
          libraryType: match.type,
          },
        );
      }
    }

    if (!movieLibraryName) {
      movieLibraryName =
        sections.find((s) => s.key === movieSectionKey)?.title ??
        movieSections.find((s) => s.key === movieSectionKey)?.title ??
        'Movies';
    }
    const machineIdentifier = await withJobRetry(
      () =>
        this.plexServer.getMachineIdentifier({
          baseUrl: plexBaseUrl,
          token: plexToken,
        }),
      { ctx, label: 'plex: get machine identifier' },
    );

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

    const recCountRaw = pickNumber(settings, 'recommendations.count') ?? 10;
    const recCount = Math.max(
      5,
      Math.min(
        100,
        Math.trunc(Number.isFinite(recCountRaw) ? recCountRaw : 10) || 10,
      ),
    );
    const upcomingPercentRaw =
      pickNumber(settings, 'recommendations.upcomingPercent') ?? 25;
    const upcomingPercent = Math.max(
      0,
      Math.min(
        75,
        Math.trunc(
          Number.isFinite(upcomingPercentRaw) ? upcomingPercentRaw : 25,
        ) || 25,
      ),
    );
    const webContextFraction =
      pickNumber(settings, 'recommendations.webContextFraction') ??
      pickNumber(settings, 'recommendations.web_context_fraction') ??
      0.3;
    // Collection size is controlled separately; do NOT default it to recCount.
    const collectionLimitRaw =
      pickNumber(settings, 'recommendations.collectionLimit') ?? 15;
    const collectionLimit = Math.max(
      1,
      Math.min(
        200,
        Math.trunc(
          Number.isFinite(collectionLimitRaw) ? collectionLimitRaw : 15,
        ) || 15,
      ),
    );

    await ctx.info('watchedMovieRecommendations: config', {
      movieLibraryName,
      movieSectionKey,
      openAiEnabled,
      googleEnabled,
      recCount,
      upcomingPercent,
      collectionLimit,
      webContextFraction,
      approvalRequiredFromObservatory,
    });

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_libraries',
          message: 'Searching Plex movie libraries…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const similar = await withJobRetry(
      () =>
        this.recommendations.buildSimilarMovieTitles({
          ctx,
          seedTitle,
          seedYear,
          tmdbApiKey,
          count: recCount,
          webContextFraction,
          upcomingPercent,
          openai: openAiEnabled ? { apiKey: openAiApiKey, model: openAiModel } : null,
          google: googleEnabled
            ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
            : null,
        }),
      { ctx, label: 'recommendations: build similar movie titles' },
    );

    const changeOfTaste =
      await withJobRetry(
        () =>
          this.recommendations.buildChangeOfTasteMovieTitles({
            ctx,
            seedTitle,
            seedYear,
            tmdbApiKey,
            count: recCount,
            upcomingPercent,
            openai: openAiEnabled ? { apiKey: openAiApiKey, model: openAiModel } : null,
          }),
        { ctx, label: 'recommendations: build change of taste movie titles' },
      );

    await ctx.info('watchedMovieRecommendations: recommendations ready', {
      similar: {
        strategy: similar.strategy,
        returned: similar.titles.length,
        sample: similar.titles.slice(0, 10),
      },
      changeOfTaste: {
        strategy: changeOfTaste.strategy,
        returned: changeOfTaste.titles.length,
        sample: changeOfTaste.titles.slice(0, 10),
      },
    });

    const changeOfTasteDebug: JsonObject = {
      pipeline: 'change_of_taste',
      googleEnabled,
      openAiEnabled,
      used: {
        tmdb: true,
        google: false,
        openai: changeOfTaste.strategy === 'openai',
      },
      googleSuggestedTitles: [] as string[],
      openAiSuggestedTitles:
        changeOfTaste.strategy === 'openai' ? changeOfTaste.titles : ([] as string[]),
      tmdbSuggestedTitles:
        changeOfTaste.strategy === 'tmdb' ? changeOfTaste.titles : ([] as string[]),
    };

    const collectionsToBuild: Array<{
      name: string;
      titles: string[];
      strategy: string;
      debug: JsonObject;
    }> = [
      {
        name: 'Based on your recently watched movie',
        titles: similar.titles,
        strategy: similar.strategy,
        debug: similar.debug,
      },
      {
        name: 'Change of Taste',
        titles: changeOfTaste.titles,
        strategy: changeOfTaste.strategy,
        debug: changeOfTasteDebug,
      },
    ];

    const radarrBaseUrlRaw = pickString(settings, 'radarr.baseUrl');
    const radarrApiKey = pickString(secrets, 'radarr.apiKey');
    const fetchMissingRadarr =
      pickBool(settings, 'jobs.watchedMovieRecommendations.fetchMissing.radarr') ??
      true;
    // Back-compat: if radarr.enabled isn't set, treat "secret present" as enabled.
    const radarrEnabled =
      fetchMissingRadarr &&
      (pickBool(settings, 'radarr.enabled') ?? Boolean(radarrApiKey)) &&
      Boolean(radarrBaseUrlRaw) &&
      Boolean(radarrApiKey);
    const radarrBaseUrl = radarrEnabled
      ? normalizeHttpUrl(radarrBaseUrlRaw)
      : '';

    const radarrDefaults =
      !ctx.dryRun && radarrEnabled
        ? await withJobRetryOrNull(
            () =>
              this.pickRadarrDefaults({
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
              }),
            { ctx, label: 'radarr: resolve defaults', meta: { baseUrl: radarrBaseUrl } },
          )
        : null;

    const perCollection: JsonObject[] = [];
    for (const col of collectionsToBuild) {
      const summary = await this.processOneCollection({
        ctx,
        tmdbApiKey,
        plexBaseUrl,
        plexToken,
        movieSectionKey,
        collectionName: col.name,
        recommendationTitles: col.titles,
        recommendationStrategy: col.strategy,
        recommendationDebug: col.debug,
        approvalRequiredFromObservatory,
        radarr: radarrEnabled
          ? {
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
              defaults: radarrDefaults,
            }
          : null,
      });
      perCollection.push(summary);
    }

    const refresh = await this.watchedRefresher.refresh({
      ctx,
      plexBaseUrl,
      plexToken,
      machineIdentifier,
      movieSections,
      tvSections: [],
      limit: collectionLimit,
      scope: { librarySectionKey: movieSectionKey, mode: 'movie' },
    });

    const summary: JsonObject = {
      seedTitle,
      seedYear,
      movieSectionKey,
      movieLibraryName,
      collections: perCollection,
      refresh,
    };

    await ctx.info('watchedMovieRecommendations: done', summary);
    const report = buildWatchedLatestCollectionReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }

  private async processOneCollection(params: {
    ctx: JobContext;
    tmdbApiKey: string;
    plexBaseUrl: string;
    plexToken: string;
    movieSectionKey: string;
    collectionName: string;
    recommendationTitles: string[];
    recommendationStrategy: string;
    recommendationDebug: JsonObject;
    approvalRequiredFromObservatory: boolean;
    radarr: {
          baseUrl: string;
          apiKey: string;
          defaults: {
            rootFolderPath: string;
            qualityProfileId: number;
            tagIds: number[];
          } | null;
    } | null;
  }): Promise<JsonObject> {
    const {
      ctx,
      tmdbApiKey,
      plexBaseUrl,
      plexToken,
      movieSectionKey,
      collectionName,
      recommendationTitles,
      recommendationStrategy,
      recommendationDebug,
      approvalRequiredFromObservatory,
      radarr,
    } = params;

    await ctx.info('collection_run: start', {
      collectionName,
      recommendationStrategy,
      generated: recommendationTitles.length,
    });

    await ctx.info('collection_run: recommendations sample', {
      collectionName,
      sample: recommendationTitles.slice(0, 10),
    });

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_match',
          message: `Matching titles in Plex… (${collectionName})`,
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    await ctx.info('collection_run: resolving titles in Plex', {
      collectionName,
      requested: recommendationTitles.length,
    });

    const resolved: Array<{ ratingKey: string; title: string }> = [];
    const missingTitles: string[] = [];
    for (const title of recommendationTitles) {
      const t = title.trim();
      if (!t) continue;
      const found = await withJobRetryOrNull(
        () =>
          this.plexServer.findMovieRatingKeyByTitle({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: movieSectionKey,
            title: t,
          }),
        { ctx, label: 'plex: find movie by title', meta: { title: t } },
      );
      if (found)
        resolved.push({ ratingKey: found.ratingKey, title: found.title });
      else missingTitles.push(t);
    }

    // Deduplicate by ratingKey (preserve order)
    const resolvedUnique = new Map<string, string>();
    for (const it of resolved) {
      if (!resolvedUnique.has(it.ratingKey))
        resolvedUnique.set(it.ratingKey, it.title);
    }
    const resolvedItems = Array.from(resolvedUnique.entries()).map(
      ([ratingKey, title]) => ({
      ratingKey,
      title,
      }),
    );

    await ctx.info('collection_run: plex resolve done', {
      collectionName,
      resolved: resolvedItems.length,
      missing: missingTitles.length,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: resolvedItems.slice(0, 10).map((d) => d.title),
    });

    // --- Resolve TMDB ids + ratings for BOTH in-Plex and missing titles (persist pending suggestions)
    const tmdbDetailsCache = new Map<
      number,
      { vote_average: number | null; vote_count: number | null }
    >();
    const getVoteStats = async (tmdbId: number) => {
      const cached = tmdbDetailsCache.get(tmdbId) ?? null;
      if (cached) return cached;

      const vote = await withJobRetryOrNull(
        () => this.tmdb.getMovieVoteStats({ apiKey: tmdbApiKey, tmdbId }),
        { ctx, label: 'tmdb: get movie vote stats', meta: { tmdbId } },
      );
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
    for (const it of resolvedItems) {
      const rk = it.ratingKey.trim();
      if (!rk) continue;

      const meta = await withJobRetryOrNull(
        () =>
          this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: rk,
          }),
        { ctx, label: 'plex: get metadata details', meta: { ratingKey: rk } },
      );

      let tmdbId = meta?.tmdbIds?.[0] ?? null;
      const title = (meta?.title ?? it.title ?? '').trim() || it.title;

      if (!tmdbId) {
        const match = await withJobRetryOrNull(
          () => this.pickBestTmdbMatch({ tmdbApiKey, title }),
          { ctx, label: 'tmdb: resolve movie title', meta: { title } },
        );
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

    // Missing in Plex: resolve via TMDB search (includes vote_average/vote_count), then confirm via getMovieVoteStats.
    for (const title of missingTitles) {
      const t = title.trim();
      if (!t) continue;
      if (missingTitleToTmdb.has(t)) continue;

      const match = await withJobRetryOrNull(
        () => this.pickBestTmdbMatch({ tmdbApiKey, title: t }),
        { ctx, label: 'tmdb: resolve missing movie title', meta: { title: t } },
      );
      if (!match) continue;

      const cached = await getVoteStats(match.tmdbId);
      const resolvedMatch = {
        ...match,
        vote_average: cached.vote_average ?? match.vote_average,
        vote_count: cached.vote_count ?? match.vote_count,
      };

      missingTitleToTmdb.set(t, resolvedMatch);
      suggestedForPoints.push({
        tmdbId: resolvedMatch.tmdbId,
        title: resolvedMatch.title,
        tmdbVoteAvg: resolvedMatch.vote_average,
        tmdbVoteCount: resolvedMatch.vote_count,
        inPlex: false,
      });
    }

    await ctx.info('collection_run: tmdb resolve done', {
      collectionName,
      suggestedForPoints: suggestedForPoints.length,
      withPlex: suggestedForPoints.filter((s) => s.inPlex).length,
      pending: suggestedForPoints.filter((s) => !s.inPlex).length,
      sampleTmdb: suggestedForPoints.slice(0, 10).map((s) => s.tmdbId),
    });

    // --- Reject-list filtering (global per-user blacklist) ---
    const rejectIds = await this.prisma.rejectedSuggestion
      .findMany({
        where: {
          userId: ctx.userId,
          mediaType: 'movie',
          externalSource: 'tmdb',
        },
        select: { externalId: true },
        take: 50000,
      })
      .then((rows) => new Set(rows.map((r) => String(r.externalId ?? '').trim()).filter(Boolean)))
      .catch(() => new Set<string>());

    const excludedByRejectList: string[] = [];
    const filteredSuggestedForPoints = suggestedForPoints.filter((s) => {
      const key = String(s.tmdbId);
      if (!rejectIds.has(key)) return true;
      excludedByRejectList.push(s.title);
      return false;
    });
    suggestedForPoints.length = 0;
    suggestedForPoints.push(...filteredSuggestedForPoints);

    for (const [k, v] of Array.from(missingTitleToTmdb.entries())) {
      if (rejectIds.has(String(v.tmdbId))) missingTitleToTmdb.delete(k);
    }
    for (let i = missingTitles.length - 1; i >= 0; i -= 1) {
      const t = missingTitles[i] ?? '';
      const match = missingTitleToTmdb.get(t.trim()) ?? null;
      if (match && rejectIds.has(String(match.tmdbId))) missingTitles.splice(i, 1);
    }

    // Overwrite the per-library snapshot (active/pending) — no points/decay.
    const byTmdbId = new Map<
      number,
      {
        tmdbId: number;
        title: string;
        status: 'active' | 'pending';
        tmdbVoteAvg: number | null;
        tmdbVoteCount: number | null;
      }
    >();
    for (const s of suggestedForPoints) {
      const tmdbId = s.tmdbId;
      const status: 'active' | 'pending' = s.inPlex ? 'active' : 'pending';
      const prev = byTmdbId.get(tmdbId) ?? null;
      if (!prev || (prev.status === 'pending' && status === 'active')) {
        byTmdbId.set(tmdbId, {
          tmdbId,
          title: s.title,
          status,
          tmdbVoteAvg: s.tmdbVoteAvg ?? null,
          tmdbVoteCount: s.tmdbVoteCount ?? null,
        });
      }
    }

    const snapshotRows = Array.from(byTmdbId.values());
    const snapshotActive = snapshotRows.filter((r) => r.status === 'active').length;
    const snapshotPending = snapshotRows.filter((r) => r.status === 'pending').length;

    let snapshotSaved = false;
    if (!ctx.dryRun) {
      await this.prisma.watchedMovieRecommendationLibrary.deleteMany({
        where: { collectionName, librarySectionKey: movieSectionKey },
      });
      if (snapshotRows.length) {
        await this.prisma.watchedMovieRecommendationLibrary.createMany({
          data: snapshotRows.map((r) => ({
            collectionName,
            librarySectionKey: movieSectionKey,
            tmdbId: r.tmdbId,
            title: r.title || undefined,
            status: r.status,
            tmdbVoteAvg: r.tmdbVoteAvg ?? undefined,
            tmdbVoteCount: r.tmdbVoteCount ?? undefined,
            downloadApproval:
              approvalRequiredFromObservatory && r.status === 'pending'
                ? 'pending'
                : 'none',
          })),
        });
      }
      snapshotSaved = true;
    }

    // Optional Radarr: add missing titles
    const radarrStats = {
      enabled: Boolean(radarr),
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

    if (!approvalRequiredFromObservatory && !ctx.dryRun && radarr && missingTitles.length) {
      await ctx.info('radarr: start', {
        collectionName,
        missingTitles: missingTitles.length,
        sampleMissing: missingTitles.slice(0, 10),
      });
    }

    if (!approvalRequiredFromObservatory && !ctx.dryRun && radarr && missingTitles.length) {
      const defaults = radarr.defaults;
      if (!defaults) {
        await ctx.warn('radarr: defaults unavailable (skipping adds)', {
          reason: 'defaults_not_resolved',
        });
      } else {
        for (const title of missingTitles) {
          radarrStats.attempted += 1;
          radarrLists.attempted.push(title);

          const tmdbMatch = missingTitleToTmdb.get(title.trim()) ?? null;
          if (!tmdbMatch) {
            radarrStats.skipped += 1;
            radarrLists.skipped.push(title);
            continue;
          }

          try {
            const result = await withJobRetry(
              () =>
                this.radarr.addMovie({
                  baseUrl: radarr.baseUrl,
                  apiKey: radarr.apiKey,
                  title: tmdbMatch.title,
                  tmdbId: tmdbMatch.tmdbId,
                  year: tmdbMatch.year ?? null,
                  qualityProfileId: defaults.qualityProfileId,
                  rootFolderPath: defaults.rootFolderPath,
                  tags: defaults.tagIds,
                  monitored: true,
                  minimumAvailability: 'announced',
                  searchForMovie: true,
                }),
              {
                ctx,
                label: 'radarr: add movie',
                meta: { title: tmdbMatch.title, tmdbId: tmdbMatch.tmdbId },
              },
            );
            if (result.status === 'added') {
              radarrStats.added += 1;
              radarrLists.added.push(tmdbMatch.title);
            } else {
              radarrStats.exists += 1;
              radarrLists.exists.push(tmdbMatch.title);
            }

            // Mark that we requested it in Radarr so Observatory rejections can unmonitor later.
            await this.prisma.watchedMovieRecommendationLibrary
              .update({
                where: {
                  collectionName_librarySectionKey_tmdbId: {
                    collectionName,
                    librarySectionKey: movieSectionKey,
                    tmdbId: tmdbMatch.tmdbId,
                  },
                },
                data: { sentToRadarrAt: new Date(), downloadApproval: 'none' },
              })
              .catch(() => undefined);
          } catch (err) {
            radarrStats.failed += 1;
            radarrLists.failed.push(title);
            await ctx.warn('radarr: add failed (continuing)', {
              title,
              error: (err as Error)?.message ?? String(err),
            });
          }
        }
      }
    }

    if (!approvalRequiredFromObservatory && !ctx.dryRun && radarr && missingTitles.length) {
      await ctx.info('radarr: done', {
        collectionName,
        ...radarrStats,
      });
    }

    const summary: JsonObject = {
      collectionName,
      recommendationStrategy,
      recommendationDebug,
      generated: recommendationTitles.length,
      resolvedInPlex: resolvedItems.length,
      missingInPlex: missingTitles.length,
      generatedTitles: uniqueStrings(recommendationTitles),
      resolvedTitles: uniqueStrings(resolvedItems.map((d) => d.title)),
      missingTitles: uniqueStrings(missingTitles),
      excludedByRejectListTitles: Array.from(new Set(excludedByRejectList.map((s) => String(s ?? '').trim()).filter(Boolean))),
      excludedByRejectListCount: excludedByRejectList.length,
      snapshot: {
        saved: snapshotSaved,
        active: snapshotActive,
        pending: snapshotPending,
      },
      radarr: radarrStats,
      radarrLists,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: resolvedItems.slice(0, 10).map((d) => d.title),
    };

    await ctx.info('collection_run: done', summary);
    return summary;
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
    const approvalRequiredFromObservatory =
      (pickBool(settings, 'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory') ??
        false) === true;

    // --- Plex settings ---
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const sections = await withJobRetry(
      () =>
        this.plexServer.getSections({
          baseUrl: plexBaseUrl,
          token: plexToken,
        }),
      { ctx, label: 'plex: get libraries' },
    );
    const tvSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'show')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!tvSections.length) throw new Error('No Plex TV libraries found');

    // Prefer the library section Plex tells us the watched episode belongs to.
    let tvSectionKey = seedLibrarySectionIdRaw || '';
    let tvLibraryName = seedLibrarySectionTitle || '';

    if (!tvSectionKey && seedRatingKey) {
      const meta = await withJobRetryOrNull(
        () =>
          this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: seedRatingKey,
          }),
        { ctx, label: 'plex: get seed metadata', meta: { ratingKey: seedRatingKey } },
      );
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

    const machineIdentifier = await withJobRetry(
      () =>
        this.plexServer.getMachineIdentifier({
          baseUrl: plexBaseUrl,
          token: plexToken,
        }),
      { ctx, label: 'plex: get machine identifier' },
    );

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

    const recCountRaw = pickNumber(settings, 'recommendations.count') ?? 10;
    const recCount = Math.max(
      5,
      Math.min(
        100,
        Math.trunc(Number.isFinite(recCountRaw) ? recCountRaw : 10) || 10,
      ),
    );
    const upcomingPercentRaw =
      pickNumber(settings, 'recommendations.upcomingPercent') ?? 25;
    const upcomingPercent = Math.max(
      0,
      Math.min(
        75,
        Math.trunc(Number.isFinite(upcomingPercentRaw) ? upcomingPercentRaw : 25) ||
          25,
      ),
    );
    const webContextFraction =
      pickNumber(settings, 'recommendations.webContextFraction') ??
      pickNumber(settings, 'recommendations.web_context_fraction') ??
      0.3;
    const collectionLimitRaw =
      pickNumber(settings, 'recommendations.collectionLimit') ?? 15;
    const collectionLimit = Math.max(
      1,
      Math.min(
        200,
        Math.trunc(Number.isFinite(collectionLimitRaw) ? collectionLimitRaw : 15) ||
          15,
      ),
    );

    await ctx.info('watchedShowRecommendations: config', {
      tvLibraryName,
      tvSectionKey,
      openAiEnabled,
      googleEnabled,
      recCount,
      upcomingPercent,
      collectionLimit,
      webContextFraction,
      approvalRequiredFromObservatory,
    });

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_libraries',
          message: 'Searching Plex TV libraries…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const similar = await withJobRetry(
      () =>
        this.recommendations.buildSimilarTvTitles({
          ctx,
          seedTitle,
          seedYear,
          tmdbApiKey,
          count: recCount,
          webContextFraction,
          upcomingPercent,
          openai: openAiEnabled ? { apiKey: openAiApiKey, model: openAiModel } : null,
          google: googleEnabled
            ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
            : null,
        }),
      { ctx, label: 'recommendations: build similar tv titles' },
    );

    const changeOfTaste = await withJobRetry(
      () =>
        this.recommendations.buildChangeOfTasteTvTitles({
          ctx,
          seedTitle,
          seedYear,
          tmdbApiKey,
          count: recCount,
          upcomingPercent,
          openai: openAiEnabled ? { apiKey: openAiApiKey, model: openAiModel } : null,
        }),
      { ctx, label: 'recommendations: build change of taste tv titles' },
    );

    await ctx.info('watchedShowRecommendations: recommendations ready', {
      similar: {
        strategy: similar.strategy,
        returned: similar.titles.length,
        sample: similar.titles.slice(0, 10),
      },
      changeOfTaste: {
        strategy: changeOfTaste.strategy,
        returned: changeOfTaste.titles.length,
        sample: changeOfTaste.titles.slice(0, 10),
      },
    });

    const changeOfTasteDebug: JsonObject = {
      pipeline: 'change_of_taste',
      googleEnabled,
      openAiEnabled,
      used: {
        tmdb: true,
        google: false,
        openai: changeOfTaste.strategy === 'openai',
      },
      googleSuggestedTitles: [] as string[],
      openAiSuggestedTitles:
        changeOfTaste.strategy === 'openai' ? changeOfTaste.titles : ([] as string[]),
      tmdbSuggestedTitles:
        changeOfTaste.strategy === 'tmdb' ? changeOfTaste.titles : ([] as string[]),
    };

    const collectionsToBuild: Array<{
      name: string;
      titles: string[];
      strategy: string;
      debug: JsonObject;
    }> = [
      {
        name: 'Based on your recently watched show',
        titles: similar.titles,
        strategy: similar.strategy,
        debug: similar.debug,
      },
      {
        name: 'Change of Taste',
        titles: changeOfTaste.titles,
        strategy: changeOfTaste.strategy,
        debug: changeOfTasteDebug,
      },
    ];

    const sonarrBaseUrlRaw = pickString(settings, 'sonarr.baseUrl');
    const sonarrApiKey = pickString(secrets, 'sonarr.apiKey');
    const fetchMissingSonarr =
      pickBool(settings, 'jobs.watchedMovieRecommendations.fetchMissing.sonarr') ??
      true;
    const sonarrEnabled =
      fetchMissingSonarr &&
      (pickBool(settings, 'sonarr.enabled') ?? Boolean(sonarrApiKey)) &&
      Boolean(sonarrBaseUrlRaw) &&
      Boolean(sonarrApiKey);
    const sonarrBaseUrl = sonarrEnabled
      ? normalizeHttpUrl(sonarrBaseUrlRaw)
      : '';

    const sonarrDefaults =
      !ctx.dryRun && sonarrEnabled
        ? await withJobRetryOrNull(
            () =>
              this.pickSonarrDefaults({
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
              }),
            { ctx, label: 'sonarr: resolve defaults', meta: { baseUrl: sonarrBaseUrl } },
          )
        : null;

    const perCollection: JsonObject[] = [];
    for (const col of collectionsToBuild) {
      const summary = await this.processOneTvCollection({
        ctx,
        tmdbApiKey,
        plexBaseUrl,
        plexToken,
        tvSectionKey,
        collectionName: col.name,
        recommendationTitles: col.titles,
        recommendationStrategy: col.strategy,
        recommendationDebug: col.debug,
        approvalRequiredFromObservatory,
        sonarr: sonarrEnabled
          ? {
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              defaults: sonarrDefaults,
            }
          : null,
      });
      perCollection.push(summary);
    }

    const refresh = await this.watchedRefresher.refresh({
      ctx,
      plexBaseUrl,
      plexToken,
      machineIdentifier,
      movieSections: [],
      tvSections,
      limit: collectionLimit,
      scope: { librarySectionKey: tvSectionKey, mode: 'tv' },
    });

    const summary: JsonObject = {
      seedTitle,
      seedYear,
      tvLibraryName,
      tvSectionKey,
      collections: perCollection,
      refresh,
    };

    await ctx.info('watchedShowRecommendations: done', summary);
    const report = buildWatchedLatestCollectionReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }

  private async processOneTvCollection(params: {
    ctx: JobContext;
    tmdbApiKey: string;
    plexBaseUrl: string;
    plexToken: string;
    tvSectionKey: string;
    collectionName: string;
    recommendationTitles: string[];
    recommendationStrategy: string;
    recommendationDebug: JsonObject;
    approvalRequiredFromObservatory: boolean;
    sonarr: {
      baseUrl: string;
      apiKey: string;
      defaults: {
        rootFolderPath: string;
        qualityProfileId: number;
        tagIds: number[];
      } | null;
    } | null;
  }): Promise<JsonObject> {
    const {
      ctx,
      tmdbApiKey,
      plexBaseUrl,
      plexToken,
      tvSectionKey,
      collectionName,
      recommendationTitles,
      recommendationStrategy,
      recommendationDebug,
      approvalRequiredFromObservatory,
      sonarr,
    } = params;

    await ctx.info('collection_run(tv): start', {
      collectionName,
      recommendationStrategy,
      generated: recommendationTitles.length,
    });

    await ctx.info('collection_run(tv): recommendations sample', {
      collectionName,
      sample: recommendationTitles.slice(0, 10),
    });

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_match',
          message: `Matching titles in Plex… (${collectionName})`,
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    await ctx.info('collection_run(tv): resolving titles in Plex', {
      collectionName,
      requested: recommendationTitles.length,
    });

    const resolved: Array<{ ratingKey: string; title: string }> = [];
    const missingTitles: string[] = [];
    for (const title of recommendationTitles) {
      const t = title.trim();
      if (!t) continue;
      const found = await withJobRetryOrNull(
        () =>
          this.plexServer.findShowRatingKeyByTitle({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: tvSectionKey,
            title: t,
          }),
        { ctx, label: 'plex: find show by title', meta: { title: t } },
      );
      if (found) resolved.push({ ratingKey: found.ratingKey, title: found.title });
      else missingTitles.push(t);
    }

    const resolvedUnique = new Map<string, string>();
    for (const it of resolved) {
      if (!resolvedUnique.has(it.ratingKey)) resolvedUnique.set(it.ratingKey, it.title);
    }
    const resolvedItems = Array.from(resolvedUnique.entries()).map(
      ([ratingKey, title]) => ({ ratingKey, title }),
    );

    await ctx.info('collection_run(tv): plex resolve done', {
      collectionName,
      resolved: resolvedItems.length,
      missing: missingTitles.length,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: resolvedItems.slice(0, 10).map((d) => d.title),
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
        ctx,
        tmdbApiKey,
        title,
      });
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
      {
        tmdbId: number;
        tvdbId: number | null;
        title: string;
      }
    >();

    const pushSuggested = (match: {
      tmdbId: number;
      tvdbId: number | null;
      title: string;
      vote_average: number | null;
      vote_count: number | null;
    }, inPlex: boolean) => {
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

    for (const it of resolvedItems) {
      const match = await getMatch(it.title);
      if (!match) continue;
      pushSuggested(match, true);
    }
    for (const title of missingTitles) {
      const match = await getMatch(title);
      if (!match) continue;
      pushSuggested(match, false);
      missingTitleToIds.set(title.trim(), {
        tmdbId: match.tmdbId,
        tvdbId: match.tvdbId,
        title: match.title,
      });
    }

    await ctx.info('collection_run(tv): tmdb resolve done', {
      collectionName,
      suggested: suggestedForPoints.length,
      withPlex: suggestedForPoints.filter((s) => s.inPlex).length,
      pending: suggestedForPoints.filter((s) => !s.inPlex).length,
      sampleTvdb: suggestedForPoints.slice(0, 10).map((s) => s.tvdbId),
    });

    // --- Reject-list filtering (global per-user blacklist) ---
    const rejectIds = await this.prisma.rejectedSuggestion
      .findMany({
        where: {
          userId: ctx.userId,
          mediaType: 'tv',
          externalSource: 'tvdb',
        },
        select: { externalId: true },
        take: 50000,
      })
      .then((rows) => new Set(rows.map((r) => String(r.externalId ?? '').trim()).filter(Boolean)))
      .catch(() => new Set<string>());

    const excludedByRejectList: string[] = [];
    const filteredSuggestedForPoints = suggestedForPoints.filter((s) => {
      const key = String(s.tvdbId);
      if (!rejectIds.has(key)) return true;
      excludedByRejectList.push(s.title);
      return false;
    });
    suggestedForPoints.length = 0;
    suggestedForPoints.push(...filteredSuggestedForPoints);

    for (const [k, v] of Array.from(missingTitleToIds.entries())) {
      if (v?.tvdbId && rejectIds.has(String(v.tvdbId))) missingTitleToIds.delete(k);
    }
    for (let i = missingTitles.length - 1; i >= 0; i -= 1) {
      const t = missingTitles[i] ?? '';
      const ids = missingTitleToIds.get(t.trim()) ?? null;
      if (ids?.tvdbId && rejectIds.has(String(ids.tvdbId))) missingTitles.splice(i, 1);
    }

    // Overwrite the per-library snapshot (active/pending) — no points/decay.
    const byTvdbId = new Map<
      number,
      {
        tvdbId: number;
        tmdbId: number | null;
        title: string;
        status: 'active' | 'pending';
        tmdbVoteAvg: number | null;
        tmdbVoteCount: number | null;
      }
    >();
    for (const s of suggestedForPoints) {
      const tvdbId = s.tvdbId;
      const status: 'active' | 'pending' = s.inPlex ? 'active' : 'pending';
      const prev = byTvdbId.get(tvdbId) ?? null;
      if (!prev || (prev.status === 'pending' && status === 'active')) {
        byTvdbId.set(tvdbId, {
          tvdbId,
          tmdbId: s.tmdbId ?? null,
          title: s.title,
          status,
          tmdbVoteAvg: s.tmdbVoteAvg ?? null,
          tmdbVoteCount: s.tmdbVoteCount ?? null,
        });
      }
    }

    const snapshotRows = Array.from(byTvdbId.values());
    const snapshotActive = snapshotRows.filter((r) => r.status === 'active').length;
    const snapshotPending = snapshotRows.filter((r) => r.status === 'pending').length;

    let snapshotSaved = false;
    if (!ctx.dryRun) {
      await this.prisma.watchedShowRecommendationLibrary.deleteMany({
        where: { collectionName, librarySectionKey: tvSectionKey },
      });
      if (snapshotRows.length) {
        await this.prisma.watchedShowRecommendationLibrary.createMany({
          data: snapshotRows.map((r) => ({
            collectionName,
            librarySectionKey: tvSectionKey,
            tvdbId: r.tvdbId,
            tmdbId: r.tmdbId ?? undefined,
            title: r.title || undefined,
            status: r.status,
            tmdbVoteAvg: r.tmdbVoteAvg ?? undefined,
            tmdbVoteCount: r.tmdbVoteCount ?? undefined,
            downloadApproval:
              approvalRequiredFromObservatory && r.status === 'pending'
                ? 'pending'
                : 'none',
          })),
        });
      }
      snapshotSaved = true;
    }

    // --- Sonarr add missing series (best-effort)
    const sonarrStats = {
      enabled: Boolean(sonarr),
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

    if (!approvalRequiredFromObservatory && !ctx.dryRun && sonarr && missingTitles.length) {
      const defaults = sonarr.defaults;
      if (!defaults) {
        await ctx.warn('sonarr: defaults unavailable (skipping adds)', {
          reason: 'defaults_not_resolved',
        });
      } else {
        for (const title of missingTitles) {
          sonarrStats.attempted += 1;
          sonarrLists.attempted.push(title);
          const ids = missingTitleToIds.get(title.trim()) ?? null;
          if (!ids || !ids.tvdbId) {
            sonarrStats.skipped += 1;
            sonarrLists.skipped.push(title);
            continue;
          }
          const tvdbId = ids.tvdbId;

          try {
            const result = await withJobRetry(
              () =>
                this.sonarr.addSeries({
                  baseUrl: sonarr.baseUrl,
                  apiKey: sonarr.apiKey,
                  title: ids.title,
                  tvdbId,
                  qualityProfileId: defaults.qualityProfileId,
                  rootFolderPath: defaults.rootFolderPath,
                  tags: defaults.tagIds,
                  monitored: true,
                  searchForMissingEpisodes: true,
                  searchForCutoffUnmetEpisodes: true,
                }),
              {
                ctx,
                label: 'sonarr: add series',
                meta: { title: ids.title, tvdbId },
              },
            );
            if (result.status === 'added') {
              sonarrStats.added += 1;
              sonarrLists.added.push(ids.title);
            } else {
              sonarrStats.exists += 1;
              sonarrLists.exists.push(ids.title);
            }

            // Mark that we requested it in Sonarr so Observatory rejections can unmonitor later.
            await this.prisma.watchedShowRecommendationLibrary
              .update({
                where: {
                  collectionName_librarySectionKey_tvdbId: {
                    collectionName,
                    librarySectionKey: tvSectionKey,
                    tvdbId,
                  },
                },
                data: { sentToSonarrAt: new Date(), downloadApproval: 'none' },
              })
              .catch(() => undefined);
          } catch (err) {
            sonarrStats.failed += 1;
            sonarrLists.failed.push(title);
            await ctx.warn('sonarr: add failed (continuing)', {
              title,
              error: (err as Error)?.message ?? String(err),
            });
          }
        }
      }

      await ctx.info('sonarr: done', { collectionName, ...sonarrStats });
    }

    const summary: JsonObject = {
      collectionName,
      recommendationStrategy,
      recommendationDebug,
      generated: recommendationTitles.length,
      resolvedInPlex: resolvedItems.length,
      missingInPlex: missingTitles.length,
      generatedTitles: uniqueStrings(recommendationTitles),
      resolvedTitles: uniqueStrings(resolvedItems.map((d) => d.title)),
      missingTitles: uniqueStrings(missingTitles),
      excludedByRejectListTitles: Array.from(new Set(excludedByRejectList.map((s) => String(s ?? '').trim()).filter(Boolean))),
      excludedByRejectListCount: excludedByRejectList.length,
      snapshot: {
        saved: snapshotSaved,
        active: snapshotActive,
        pending: snapshotPending,
      },
      sonarr: sonarrStats,
      sonarrLists,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: resolvedItems.slice(0, 10).map((d) => d.title),
    };

    await ctx.info('collection_run(tv): done', summary);
    return summary;
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

    if (!rootFolders.length) {
      throw new Error('Radarr has no root folders configured');
    }
    if (!qualityProfiles.length) {
      throw new Error('Radarr has no quality profiles configured');
    }

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
    ctx: JobContext;
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
    const results = await withJobRetryOrNull(
      () =>
        this.tmdb.searchTv({
          apiKey: params.tmdbApiKey,
          query: params.title,
          includeAdult: false,
          firstAirDateYear: null,
        }),
      {
        ctx: params.ctx,
        label: 'tmdb: search tv',
        meta: { title: params.title },
      },
    );
    if (!results?.length) return null;

    const q = params.title.trim().toLowerCase();
    const exact = results.find((r) => r.name.trim().toLowerCase() === q);
    const best = exact ?? results[0];

    const details = await withJobRetryOrNull(
      () =>
        this.tmdb.getTv({
          apiKey: params.tmdbApiKey,
          tmdbId: best.id,
          appendExternalIds: true,
        }),
      {
        ctx: params.ctx,
        label: 'tmdb: get tv details',
        meta: { tmdbId: best.id },
      },
    );

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

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    if (typeof it !== 'string') continue;
    const s = it.trim();
    if (!s) continue;
    out.push(s);
  }
  return out;
}

function uniqueStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of list) {
    const s = String(it ?? '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function buildWatchedLatestCollectionReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;

  const collectionsRaw = raw.collections;
  const collections = Array.isArray(collectionsRaw)
    ? collectionsRaw.filter(
        (c): c is JsonObject =>
          Boolean(c) && typeof c === 'object' && !Array.isArray(c),
      )
    : [];

  const totals = {
    collections: collections.length,
    generated: 0,
    resolvedInPlex: 0,
    missingInPlex: 0,
  };

  for (const c of collections) {
    totals.generated += asNum(c.generated) ?? 0;
    totals.resolvedInPlex += asNum(c.resolvedInPlex) ?? 0;
    totals.missingInPlex += asNum(c.missingInPlex) ?? 0;
  }

  const isTv = Boolean(String((raw as Record<string, unknown>).tvSectionKey ?? '').trim());
  const unit = isTv ? 'shows' : 'movies';
  const seedTitle = String((raw as Record<string, unknown>).seedTitle ?? '').trim();
  const seedYear = asNum((raw as Record<string, unknown>).seedYear);

  const tasks: JobReportV1['tasks'] = [];

  // 1) Generate recommendations
  const recFacts: Array<{ label: string; value: JsonValue }> = [];
  if (seedTitle) recFacts.push({ label: 'Seed', value: seedTitle });
  if (seedYear !== null) recFacts.push({ label: 'Seed year', value: seedYear });

  for (const [idx, c] of collections.entries()) {
    const name = String(c.collectionName ?? `Collection ${idx + 1}`).trim() || `Collection ${idx + 1}`;
    const generatedTitles = uniqueStrings(asStringArray(c.generatedTitles));
    const generatedCount = asNum(c.generated) ?? generatedTitles.length;

    const recommendationDebug = isPlainObject(c.recommendationDebug)
      ? (c.recommendationDebug as Record<string, unknown>)
      : null;
    const recommendationUsed =
      recommendationDebug && isPlainObject(recommendationDebug.used)
        ? (recommendationDebug.used as Record<string, unknown>)
        : null;

    const googleEnabled = Boolean(recommendationDebug?.googleEnabled);
    const openAiEnabled = Boolean(recommendationDebug?.openAiEnabled);
    const googleUsed = Boolean(recommendationUsed?.google);

    const googleSuggestedTitles = uniqueStrings(
      asStringArray(recommendationDebug?.googleSuggestedTitles),
    );
    const openAiSuggestedTitles = uniqueStrings(
      asStringArray(recommendationDebug?.openAiSuggestedTitles),
    );
    const tmdbSuggestedTitles = uniqueStrings(
      asStringArray(recommendationDebug?.tmdbSuggestedTitles),
    );

    recFacts.push({
      label: `${name} — Google`,
      value: !googleEnabled
        ? 'Not enabled'
        : googleUsed
          ? { count: googleSuggestedTitles.length, unit, items: googleSuggestedTitles }
          : 'Skipped',
    });

    const strategy = String(c.recommendationStrategy ?? '').trim().toLowerCase();
    recFacts.push({
      label: `${name} — OpenAI`,
      value: !openAiEnabled
        ? 'Not enabled'
        : strategy === 'openai'
          ? {
              count: (openAiSuggestedTitles.length ? openAiSuggestedTitles : generatedTitles)
                .length,
              unit,
              items: openAiSuggestedTitles.length ? openAiSuggestedTitles : generatedTitles,
            }
          : 'Skipped',
    });
    recFacts.push({
      label: `${name} — TMDB`,
      value:
        strategy === 'tmdb'
          ? {
              count: (tmdbSuggestedTitles.length ? tmdbSuggestedTitles : generatedTitles)
                .length,
              unit,
              items: tmdbSuggestedTitles.length ? tmdbSuggestedTitles : generatedTitles,
            }
          : 'Skipped',
    });

    // Keep the final recommendations card as-is for this collection.
    recFacts.push({
      label: name,
      value: { count: generatedCount, unit, items: generatedTitles },
    });
    if (strategy) recFacts.push({ label: `${name} — Strategy`, value: strategy });
  }

  tasks.push({
    id: 'recommendations',
    title: 'Generate recommendations',
    status: 'success',
    facts: recFacts,
  });

  // 1.5) Excluded due to reject list (global blacklist)
  const rejectFacts: Array<{ label: string; value: JsonValue }> = [];
  let anyRejectExcluded = false;
  for (const [idx, c] of collections.entries()) {
    const name =
      String(c.collectionName ?? `Collection ${idx + 1}`).trim() ||
      `Collection ${idx + 1}`;
    const excludedTitles = uniqueStrings(asStringArray(c.excludedByRejectListTitles));
    const excludedCount =
      asNum(c.excludedByRejectListCount) ?? excludedTitles.length;
    if (excludedCount) anyRejectExcluded = true;
    rejectFacts.push({
      label: `${name} — Excluded`,
      value: { count: excludedCount, unit, items: excludedTitles },
    });
  }
  tasks.push({
    id: 'reject_list',
    title: 'Excluded by reject list',
    status: anyRejectExcluded ? 'success' : 'skipped',
    facts: rejectFacts,
  });

  // 2) Resolve titles in Plex
  const resolveFacts: Array<{ label: string; value: JsonValue }> = [];
  for (const [idx, c] of collections.entries()) {
    const name = String(c.collectionName ?? `Collection ${idx + 1}`).trim() || `Collection ${idx + 1}`;
    const resolvedTitles = uniqueStrings(asStringArray(c.resolvedTitles ?? c.sampleResolved));
    const missingTitles = uniqueStrings(asStringArray(c.missingTitles ?? c.sampleMissing));
    resolveFacts.push({
      label: `${name} — Resolved`,
      value: { count: resolvedTitles.length, unit, items: resolvedTitles },
    });
    resolveFacts.push({
      label: `${name} — Missing`,
      value: { count: missingTitles.length, unit, items: missingTitles },
    });
  }

  tasks.push({
    id: 'plex_resolve',
    title: 'Resolve titles in Plex',
    status: 'success',
    facts: resolveFacts,
  });

  // 3) Radarr/Sonarr add missing
  if (isTv) {
    const sonarrFacts: Array<{ label: string; value: JsonValue }> = [];
    let sonarrEnabled = false;
    let sonarrFailed = 0;

    for (const [idx, c] of collections.entries()) {
      const name = String(c.collectionName ?? `Collection ${idx + 1}`).trim() || `Collection ${idx + 1}`;
      const sonarr = isPlainObject(c.sonarr) ? c.sonarr : null;
      const enabled = sonarr ? Boolean((sonarr as Record<string, unknown>).enabled) : false;
      if (enabled) sonarrEnabled = true;
      if (enabled) sonarrFailed += asNum((sonarr as Record<string, unknown>)?.failed) ?? 0;

      const lists = isPlainObject(c.sonarrLists) ? c.sonarrLists : null;
      const attempted = uniqueStrings(asStringArray(lists?.attempted));
      const added = uniqueStrings(asStringArray(lists?.added));
      const exists = uniqueStrings(asStringArray(lists?.exists));
      const failed = uniqueStrings(asStringArray(lists?.failed));
      const skipped = uniqueStrings(asStringArray(lists?.skipped));

      const attemptedCount = sonarr ? asNum((sonarr as Record<string, unknown>).attempted) : null;
      const addedCount = sonarr ? asNum((sonarr as Record<string, unknown>).added) : null;
      const existsCount = sonarr ? asNum((sonarr as Record<string, unknown>).exists) : null;
      const failedCount = sonarr ? asNum((sonarr as Record<string, unknown>).failed) : null;
      const skippedCount = sonarr ? asNum((sonarr as Record<string, unknown>).skipped) : null;

      sonarrFacts.push(
        { label: `${name} — Attempted`, value: { count: attemptedCount, unit, items: attempted } },
        { label: `${name} — Added`, value: { count: addedCount, unit, items: added } },
        { label: `${name} — Exists`, value: { count: existsCount, unit, items: exists } },
        { label: `${name} — Failed`, value: { count: failedCount, unit, items: failed } },
        { label: `${name} — Skipped`, value: { count: skippedCount, unit, items: skipped } },
      );
    }

    tasks.push({
      id: 'sonarr_add',
      title: 'Sonarr: add missing shows',
      status:
        ctx.dryRun || !sonarrEnabled
          ? 'skipped'
          : sonarrFailed
            ? 'failed'
            : 'success',
      facts: [
        { label: 'Enabled', value: sonarrEnabled },
        { label: 'Dry run', value: ctx.dryRun },
        ...sonarrFacts,
      ],
    });
  } else {
    const radarrFacts: Array<{ label: string; value: JsonValue }> = [];
    let radarrEnabled = false;
    let radarrFailed = 0;

    for (const [idx, c] of collections.entries()) {
      const name = String(c.collectionName ?? `Collection ${idx + 1}`).trim() || `Collection ${idx + 1}`;
      const radarr = isPlainObject(c.radarr) ? c.radarr : null;
      const enabled = radarr ? Boolean((radarr as Record<string, unknown>).enabled) : false;
      if (enabled) radarrEnabled = true;
      if (enabled) radarrFailed += asNum((radarr as Record<string, unknown>)?.failed) ?? 0;

      const lists = isPlainObject(c.radarrLists) ? c.radarrLists : null;
      const attempted = uniqueStrings(asStringArray(lists?.attempted));
      const added = uniqueStrings(asStringArray(lists?.added));
      const exists = uniqueStrings(asStringArray(lists?.exists));
      const failed = uniqueStrings(asStringArray(lists?.failed));
      const skipped = uniqueStrings(asStringArray(lists?.skipped));

      const attemptedCount = radarr ? asNum((radarr as Record<string, unknown>).attempted) : null;
      const addedCount = radarr ? asNum((radarr as Record<string, unknown>).added) : null;
      const existsCount = radarr ? asNum((radarr as Record<string, unknown>).exists) : null;
      const failedCount = radarr ? asNum((radarr as Record<string, unknown>).failed) : null;
      const skippedCount = radarr ? asNum((radarr as Record<string, unknown>).skipped) : null;

      radarrFacts.push(
        { label: `${name} — Attempted`, value: { count: attemptedCount, unit, items: attempted } },
        { label: `${name} — Added`, value: { count: addedCount, unit, items: added } },
        { label: `${name} — Exists`, value: { count: existsCount, unit, items: exists } },
        { label: `${name} — Failed`, value: { count: failedCount, unit, items: failed } },
        { label: `${name} — Skipped`, value: { count: skippedCount, unit, items: skipped } },
      );
    }

    tasks.push({
      id: 'radarr_add',
      title: 'Radarr: add missing movies',
      status:
        ctx.dryRun || !radarrEnabled
          ? 'skipped'
          : radarrFailed
            ? 'failed'
            : 'success',
      facts: [
        { label: 'Enabled', value: radarrEnabled },
        { label: 'Dry run', value: ctx.dryRun },
        ...radarrFacts,
      ],
    });
  }

  // 4) Refresh Plex collection
  const desiredByCollection = new Map<string, string[]>();
  const refreshRaw = (raw as Record<string, unknown>).refresh;
  const refresh = isPlainObject(refreshRaw)
    ? (refreshRaw as Record<string, unknown>)
    : null;
  const sideRaw = refresh ? (isTv ? refresh['tv'] : refresh['movie']) : null;
  const side = isPlainObject(sideRaw) ? (sideRaw as Record<string, unknown>) : null;
  const byLibraryRaw = side?.['byLibrary'];
  const byLibrary = Array.isArray(byLibraryRaw)
    ? byLibraryRaw.filter((b): b is Record<string, unknown> => isPlainObject(b))
    : [];
  for (const lib of byLibrary) {
    const colsRaw = lib['collections'];
    const cols = Array.isArray(colsRaw)
      ? colsRaw.filter((c): c is Record<string, unknown> => isPlainObject(c))
      : [];
    for (const c of cols) {
      const name = String(c['collectionName'] ?? '').trim();
      if (!name) continue;
      const desired = uniqueStrings(asStringArray(c['desiredTitles']));
      if (!desired.length) continue;
      const existing = desiredByCollection.get(name) ?? [];
      desiredByCollection.set(name, uniqueStrings(existing.concat(desired)));
    }
  }

  const plexFacts: Array<{ label: string; value: JsonValue }> = [];
  let anyDesired = false;
  for (const [idx, c] of collections.entries()) {
    const name = String(c.collectionName ?? `Collection ${idx + 1}`).trim() || `Collection ${idx + 1}`;
    const desiredTitles =
      desiredByCollection.get(name) ??
      uniqueStrings(asStringArray(c.sampleResolved));
    if (desiredTitles.length) anyDesired = true;
    plexFacts.push({
      label: name,
      value: { count: desiredTitles.length, unit, items: desiredTitles },
    });
  }

  tasks.push({
    id: 'plex_collection',
    title: 'Refresh Plex collection',
    status: anyDesired ? 'success' : 'skipped',
    facts: plexFacts,
  });

  const headlineSeed = seedTitle ? ` by ${seedTitle}` : '';
  const collectionNames = uniqueStrings(
    collections.map((c) => String(c.collectionName ?? '').trim()).filter(Boolean),
  );
  const hasChangeOfTaste = collectionNames.some((n) => n.toLowerCase().includes('change of taste'));
  const hasRecentlyWatched = collectionNames.some((n) => n.toLowerCase().includes('recently watched'));

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline:
      hasChangeOfTaste && hasRecentlyWatched
        ? `Based on your recently watched and Change of Taste updated${headlineSeed}.`
        : collectionNames.length
          ? `${collectionNames.join(' • ')} updated${headlineSeed}.`
          : `Collections updated${headlineSeed}.`,
    sections: [
      {
        id: 'totals',
        title: 'Totals',
        rows: [
          metricRow({ label: 'Collections', end: totals.collections, unit: 'collections' }),
          metricRow({ label: 'Recommendations generated', end: totals.generated, unit: 'titles' }),
          metricRow({ label: 'Resolved in Plex', end: totals.resolvedInPlex, unit: 'items' }),
          metricRow({ label: 'Missing in Plex', end: totals.missingInPlex, unit: 'titles' }),
        ],
      },
    ],
    tasks,
    issues: [],
    raw,
  };
}
