import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SettingsService } from '../settings/settings.service';
import { TmdbService } from '../tmdb/tmdb.service';
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
    private readonly radarr: RadarrService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const seedTitle =
      typeof input['seedTitle'] === 'string' ? input['seedTitle'].trim() : '';
    const seedYear =
      typeof input['seedYear'] === 'number' && Number.isFinite(input['seedYear'])
        ? Math.trunc(input['seedYear'])
        : null;

    await ctx.info('watchedMovieRecommendations: start', {
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      seedTitle: seedTitle || null,
      seedYear,
      source: typeof input['source'] === 'string' ? input['source'] : null,
      plexEvent: typeof input['plexEvent'] === 'string' ? input['plexEvent'] : null,
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

    const movieLibraryName =
      pickString(settings, 'plex.movieLibraryName') ||
      pickString(settings, 'plex.movie_library_name') ||
      'Movies';

    const movieSectionKey = await this.plexServer.findSectionKeyByTitle({
      baseUrl: plexBaseUrl,
      token: plexToken,
      title: movieLibraryName,
    });
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
      openAiEnabled && googleEnabledFlag && Boolean(googleApiKey) && Boolean(googleSearchEngineId);

    const recCount =
      Math.trunc(pickNumber(settings, 'recommendations.count') ?? 15) || 15;
    const webContextFraction = pickNumber(settings, 'recommendations.webContextFraction') ??
      pickNumber(settings, 'recommendations.web_context_fraction') ??
      0.3;

    await ctx.info('watchedMovieRecommendations: config', {
      movieLibraryName,
      openAiEnabled,
      googleEnabled,
      recCount,
      webContextFraction,
    });

    const similar = await this.recommendations.buildSimilarMovieTitles({
      ctx,
      seedTitle,
      seedYear,
      tmdbApiKey,
      count: recCount,
      webContextFraction,
      openai: openAiEnabled ? { apiKey: openAiApiKey, model: openAiModel } : null,
      google: googleEnabled
        ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
        : null,
    });

    const changeOfTaste = await this.recommendations.buildChangeOfTasteMovieTitles({
      ctx,
      seedTitle,
      seedYear,
      tmdbApiKey,
      count: recCount,
      openai: openAiEnabled ? { apiKey: openAiApiKey, model: openAiModel } : null,
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
    const radarrBaseUrl = radarrEnabled ? normalizeHttpUrl(radarrBaseUrlRaw) : '';

    const radarrDefaults = !ctx.dryRun && radarrEnabled
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
        radarr: radarrEnabled
          ? { baseUrl: radarrBaseUrl, apiKey: radarrApiKey, defaults: radarrDefaults }
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
    radarr:
      | {
          baseUrl: string;
          apiKey: string;
          defaults: {
            rootFolderPath: string;
            qualityProfileId: number;
            tagIds: number[];
          } | null;
        }
      | null;
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
      if (found) {
        resolved.push({ ratingKey: found.ratingKey, title: found.title });
      } else {
        missingTitles.push(t);
      }
    }

    await ctx.info('collection_run: plex resolve done', {
      collectionName,
      resolved: resolved.length,
      missing: missingTitles.length,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: resolved.slice(0, 10).map((d) => d.title),
    });

    // Deduplicate by ratingKey, preserving order
    const unique = new Map<string, string>();
    for (const item of resolved) {
      if (!unique.has(item.ratingKey)) unique.set(item.ratingKey, item.title);
    }
    const desiredItems = Array.from(unique.entries()).map(([ratingKey, title]) => ({
      ratingKey,
      title,
    }));

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

          const tmdbMatch = await this.pickBestTmdbMatch({
            tmdbApiKey,
            title,
          }).catch(() => null);
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
        await ctx.warn('collection_run: no resolvable Plex items (skipping plex rebuild)', {
          collectionName,
          generated: recommendationTitles.length,
          missing: missingTitles.length,
        });
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
      ? rootFolders.find((r) => r.path === preferredRoot) ?? rootFolders[0]
      : rootFolders[0];

    const desiredQualityId = Math.max(1, Math.trunc(params.preferredQualityProfileId ?? 1));
    const qualityProfile =
      qualityProfiles.find((p) => p.id === desiredQualityId) ??
      (desiredQualityId !== 1 ? qualityProfiles.find((p) => p.id === 1) : null) ??
      qualityProfiles[0];

    const preferredTagId =
      typeof params.preferredTagId === 'number' && Number.isFinite(params.preferredTagId)
        ? Math.trunc(params.preferredTagId)
        : null;
    const tag = preferredTagId ? tags.find((t) => t.id === preferredTagId) : null;

    const rootFolderPath = rootFolder.path;
    const qualityProfileId = qualityProfile.id;
    const tagIds = tag ? [tag.id] : [];

    await ctx.info('radarr: defaults selected', {
      rootFolderPath,
      qualityProfileId,
      qualityProfileName: qualityProfile.name,
      tagIds,
      tagLabel: tag?.label ?? null,
      usedPreferredRootFolder: Boolean(preferredRoot && rootFolder.path === preferredRoot),
      usedPreferredQualityProfile: Boolean(qualityProfile.id === desiredQualityId),
      usedPreferredTag: Boolean(tag),
    });

    return { rootFolderPath, qualityProfileId, tagIds };
  }

  private async pickBestTmdbMatch(params: {
    tmdbApiKey: string;
    title: string;
  }): Promise<{ tmdbId: number; title: string; year: number | null } | null> {
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
    };
  }
}


