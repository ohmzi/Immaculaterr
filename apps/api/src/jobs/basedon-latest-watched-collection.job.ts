import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SettingsService } from '../settings/settings.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { WatchedMovieRecommendationsService } from '../watched-movie-recommendations/watched-movie-recommendations.service';
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
    private readonly plexCurated: PlexCuratedCollectionsService,
    private readonly recommendations: RecommendationsService,
    private readonly tmdb: TmdbService,
    private readonly watchedRecs: WatchedMovieRecommendationsService,
    private readonly radarr: RadarrService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
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

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    // --- Plex settings ---
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
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
    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });

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

    const recCountRaw = pickNumber(settings, 'recommendations.count') ?? 50;
    const recCount = Math.max(
      5,
      Math.min(
        100,
        Math.trunc(Number.isFinite(recCountRaw) ? recCountRaw : 50) || 50,
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
    const maxPoints =
      Math.trunc(pickNumber(settings, 'recommendations.maxPoints') ?? 50) || 50;
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
      maxPoints,
      collectionLimit,
      webContextFraction,
    });

    const similar = await this.recommendations.buildSimilarMovieTitles({
      ctx,
      seedTitle,
      seedYear,
      tmdbApiKey,
      count: recCount,
      webContextFraction,
      upcomingPercent,
      openai: openAiEnabled
        ? { apiKey: openAiApiKey, model: openAiModel }
        : null,
      google: googleEnabled
        ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
        : null,
    });

    const changeOfTaste =
      await this.recommendations.buildChangeOfTasteMovieTitles({
        ctx,
        seedTitle,
        seedYear,
        tmdbApiKey,
        count: recCount,
        openai: openAiEnabled
          ? { apiKey: openAiApiKey, model: openAiModel }
          : null,
      });

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

    const collectionsToBuild: Array<{
      name: string;
      titles: string[];
      strategy: string;
    }> = [
      {
        name: 'Based on your recently watched movie',
        titles: similar.titles,
        strategy: similar.strategy,
      },
      {
        name: 'Change of Taste',
        titles: changeOfTaste.titles,
        strategy: changeOfTaste.strategy,
      },
    ];

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

    const radarrDefaults =
      !ctx.dryRun && radarrEnabled
        ? await this.pickRadarrDefaults({
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
          }).catch(async (err) => {
            await ctx.warn('radarr: defaults unavailable (skipping adds)', {
              error: (err as Error)?.message ?? String(err),
            });
            return null;
          })
        : null;

    const perCollection: JsonObject[] = [];
    for (const col of collectionsToBuild) {
      const summary = await this.processOneCollection({
        ctx,
        tmdbApiKey,
        plexBaseUrl,
        plexToken,
        machineIdentifier,
        movieSectionKey,
        collectionName: col.name,
        recommendationTitles: col.titles,
        recommendationStrategy: col.strategy,
        maxPoints,
        collectionLimit,
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

    const summary: JsonObject = {
      seedTitle,
      seedYear,
      collections: perCollection,
    };

    await ctx.info('watchedMovieRecommendations: done', summary);
    return { summary };
  }

  private async processOneCollection(params: {
    ctx: JobContext;
    tmdbApiKey: string;
    plexBaseUrl: string;
    plexToken: string;
    machineIdentifier: string;
    movieSectionKey: string;
    collectionName: string;
    recommendationTitles: string[];
    recommendationStrategy: string;
    maxPoints: number;
    collectionLimit: number;
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
      machineIdentifier,
      movieSectionKey,
      collectionName,
      recommendationTitles,
      recommendationStrategy,
      maxPoints,
      collectionLimit,
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

    await ctx.info('collection_run: resolving titles in Plex', {
      collectionName,
      requested: recommendationTitles.length,
    });

    const effectiveCollectionLimit = Math.max(
      1,
      Math.min(200, Math.trunc(collectionLimit || 15)),
    );

    const resolved: Array<{ ratingKey: string; title: string }> = [];
    const missingTitles: string[] = [];
    for (const title of recommendationTitles) {
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
    for (const it of resolvedItems) {
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

    // Missing in Plex: resolve via TMDB search (includes vote_average/vote_count), then confirm via getMovieVoteStats.
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

    // Optional Radarr: add missing titles
    const radarrStats = {
      enabled: Boolean(radarr),
      attempted: 0,
      added: 0,
      exists: 0,
      failed: 0,
      skipped: 0,
    };

    if (!ctx.dryRun && radarr && missingTitles.length) {
      await ctx.info('radarr: start', {
        collectionName,
        missingTitles: missingTitles.length,
        sampleMissing: missingTitles.slice(0, 10),
      });
    }

    if (!ctx.dryRun && radarr && missingTitles.length) {
      const defaults = radarr.defaults;
      if (!defaults) {
        await ctx.warn('radarr: defaults unavailable (skipping adds)', {
          reason: 'defaults_not_resolved',
        });
      } else {
        for (const title of missingTitles) {
          radarrStats.attempted += 1;

          const tmdbMatch = missingTitleToTmdb.get(title.trim()) ?? null;
          if (!tmdbMatch) {
            radarrStats.skipped += 1;
            continue;
          }

          try {
            const result = await this.radarr.addMovie({
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
            });
            if (result.status === 'added') radarrStats.added += 1;
            else radarrStats.exists += 1;
          } catch (err) {
            radarrStats.failed += 1;
            await ctx.warn('radarr: add failed (continuing)', {
              title,
              error: (err as Error)?.message ?? String(err),
            });
          }
        }
      }
    }

    // Update the points dataset in SQLite (pending + active by tmdbId)
    const pointsSummary = ctx.dryRun
      ? ({ dryRun: true } as JsonObject)
      : await this.watchedRecs.applyPointsUpdate({
          ctx,
          collectionName,
          suggested: suggestedForPoints,
          maxPoints,
        });

    // Build the desired Plex ordering from the active points dataset (limited for UX).
    const activeRows = await this.watchedRecs.getActiveMovies({
      collectionName,
      minPoints: 1,
      take: Math.min(
        250,
        Math.max(effectiveCollectionLimit * 4, effectiveCollectionLimit),
      ),
    });
    const activeByTmdbId = new Map(
      activeRows.map((m) => [
        m.tmdbId,
        {
          tmdbId: m.tmdbId,
          title: (m.title ?? '').trim() || null,
          tmdbVoteAvg: m.tmdbVoteAvg ?? null,
          tmdbVoteCount: m.tmdbVoteCount ?? null,
        },
      ]),
    );
    const orderedTmdb = this.watchedRecs.buildThreeTierTmdbRatingShuffleOrder({
      movies: activeRows.map((m) => ({
        tmdbId: m.tmdbId,
        tmdbVoteAvg: m.tmdbVoteAvg ?? null,
        tmdbVoteCount: m.tmdbVoteCount ?? null,
      })),
    });

    const desiredItems: Array<{ ratingKey: string; title: string }> = [];
    const seenRatingKeys = new Set<string>();
    let skippedNotInPlex = 0;

    for (const tmdbId of orderedTmdb) {
      if (desiredItems.length >= effectiveCollectionLimit) break;
      const row = activeByTmdbId.get(tmdbId);
      const title = (row?.title ?? '').trim();
      if (!title) continue;

      const found = await this.plexServer
        .findMovieRatingKeyByTitle({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey: movieSectionKey,
          title,
        })
        .catch(() => null);

      if (!found) {
        skippedNotInPlex += 1;
        continue;
      }
      if (seenRatingKeys.has(found.ratingKey)) continue;
      seenRatingKeys.add(found.ratingKey);
      desiredItems.push({ ratingKey: found.ratingKey, title: found.title });
    }

    await ctx.info('collection_run: desired list built from points dataset', {
      collectionName,
      activeCandidates: activeRows.length,
      applying: desiredItems.length,
      collectionLimit: effectiveCollectionLimit,
      skippedNotInPlex,
      sampleTop10: desiredItems.slice(0, 10).map((d) => d.title),
    });

    // Persist the latest list in app DB (replace items)
    let dbSaved = false;
    let curatedCollectionId: string | null = null;
    if (!ctx.dryRun) {
      await ctx.info('db: replace curated collection items', {
        collectionName,
        desiredItems: desiredItems.length,
      });

      const col = await this.prisma.curatedCollection.upsert({
        where: { name: collectionName },
        update: {},
        create: { name: collectionName },
        select: { id: true },
      });
      curatedCollectionId = col.id;

      await this.prisma.curatedCollectionItem.deleteMany({
        where: { collectionId: col.id },
      });

      if (desiredItems.length) {
        await this.prisma.curatedCollectionItem.createMany({
          data: desiredItems.map((it) => ({
            collectionId: col.id,
            ratingKey: it.ratingKey,
            title: it.title,
          })),
        });
      }
      dbSaved = true;

      await ctx.info('db: saved', {
        collectionName,
        curatedCollectionId,
        savedItems: desiredItems.length,
      });
    }

    // Rebuild Plex collection (delete → create → order → artwork → pin)
    const plexResult = await (async () => {
      if (!desiredItems.length) {
        await ctx.warn(
          'collection_run: no resolvable Plex items (skipping plex rebuild)',
          {
            collectionName,
            generated: recommendationTitles.length,
            missing: missingTitles.length,
          },
        );
        return null;
      }

      await ctx.info('plex: rebuild start', {
        collectionName,
        desiredItems: desiredItems.length,
      });
      return await this.plexCurated.rebuildMovieCollection({
        ctx,
        baseUrl: plexBaseUrl,
        token: plexToken,
        machineIdentifier,
        movieSectionKey,
        collectionName,
        desiredItems,
        randomizeOrder: false,
      });
    })();

    await ctx.info('plex: rebuild done', {
      collectionName,
      result: plexResult,
    });

    if (!ctx.dryRun && radarr && missingTitles.length) {
      await ctx.info('radarr: done', {
        collectionName,
        ...radarrStats,
      });
    }

    const summary: JsonObject = {
      collectionName,
      recommendationStrategy,
      generated: recommendationTitles.length,
      resolvedInPlex: desiredItems.length,
      missingInPlex: missingTitles.length,
      dbSaved,
      curatedCollectionId,
      radarr: radarrStats,
      points: pointsSummary,
      plex: plexResult,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: desiredItems.slice(0, 10).map((d) => d.title),
    };

    await ctx.info('collection_run: done', summary);
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
}
