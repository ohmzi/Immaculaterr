import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import {
  buildUserCollectionHubOrder,
  buildUserCollectionName,
} from '../plex/plex-collections.utils';
import { PlexServerService } from '../plex/plex-server.service';

const MOVIE_COLLECTIONS = [
  'Based on your recently watched movie',
  'Change of Taste',
] as const;

const TV_COLLECTIONS = [
  'Based on your recently watched show',
  'Change of Taste',
] as const;

type PlexLibrarySection = { key: string; title: string; type?: string };

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
  return arr;
}

@Injectable()
export class WatchedCollectionsRefresherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plexServer: PlexServerService,
    private readonly plexCurated: PlexCuratedCollectionsService,
  ) {}

  async refresh(params: {
    ctx: JobContext;
    plexBaseUrl: string;
    plexToken: string;
    machineIdentifier: string;
    plexUserId: string;
    plexUserTitle: string;
    pinCollections?: boolean;
    movieSections: PlexLibrarySection[];
    tvSections: PlexLibrarySection[];
    /**
     * Max items per Plex collection (applies after shuffling).
     */
    limit: number;
    /**
     * Restrict refresh to a single library section key (movie or tv) when called from the collection job.
     * If omitted, all libraries passed in are refreshed (used by the nightly refresher).
     */
    scope?: { librarySectionKey: string; mode: 'movie' | 'tv' } | null;
  }): Promise<JsonObject> {
    const { ctx } = params;
    const limit = Math.max(1, Math.min(200, Math.trunc(params.limit || 15)));
    const scope = params.scope ?? null;
    const pinCollections = params.pinCollections ?? true;

    const movieSections =
      scope?.mode === 'movie'
        ? params.movieSections.filter((s) => s.key === scope.librarySectionKey)
        : scope
          ? []
          : params.movieSections;
    const tvSections =
      scope?.mode === 'tv'
        ? params.tvSections.filter((s) => s.key === scope.librarySectionKey)
        : scope
          ? []
          : params.tvSections;

    const movie = await this.refreshMovieCollections({
      ctx,
      plexBaseUrl: params.plexBaseUrl,
      plexToken: params.plexToken,
      machineIdentifier: params.machineIdentifier,
      plexUserId: params.plexUserId,
      plexUserTitle: params.plexUserTitle,
      pinCollections,
      movieSections,
      limit,
    });
    const tv = await this.refreshTvCollections({
      ctx,
      plexBaseUrl: params.plexBaseUrl,
      plexToken: params.plexToken,
      machineIdentifier: params.machineIdentifier,
      plexUserId: params.plexUserId,
      plexUserTitle: params.plexUserTitle,
      pinCollections,
      tvSections,
      limit,
    });

    return { limit, movie, tv };
  }

  private async refreshMovieCollections(params: {
    ctx: JobContext;
    plexBaseUrl: string;
    plexToken: string;
    machineIdentifier: string;
    plexUserId: string;
    plexUserTitle: string;
    pinCollections: boolean;
    movieSections: PlexLibrarySection[];
    limit: number;
  }): Promise<JsonObject> {
    const {
      ctx,
      plexBaseUrl,
      plexToken,
      machineIdentifier,
      plexUserId,
      plexUserTitle,
      pinCollections,
      movieSections,
      limit,
    } = params;

    const outByLibrary: JsonObject[] = [];
    const collectionHubOrder = buildUserCollectionHubOrder(
      MOVIE_COLLECTIONS,
      plexUserTitle,
    );

    for (const sec of movieSections) {
      // Build tmdbId -> (ratingKey,title) map for this library.
      const rows = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      const tmdbMap = new Map<number, { ratingKey: string; title: string }>();
      for (const r of rows) {
        if (!r.tmdbId) continue;
        if (!tmdbMap.has(r.tmdbId))
          tmdbMap.set(r.tmdbId, { ratingKey: r.ratingKey, title: r.title });
      }

      const perCollection: JsonObject[] = [];
      for (const collectionName of MOVIE_COLLECTIONS) {
        // Activate pending items that are now in Plex.
        const pending = await this.prisma.watchedMovieRecommendationLibrary.findMany(
          {
            where: {
              plexUserId,
              collectionName,
              librarySectionKey: sec.key,
              status: 'pending',
            },
            select: { tmdbId: true },
          },
        );
        const toActivate = pending
          .map((p) => p.tmdbId)
          .filter((id) => tmdbMap.has(id));
        const activatedNow = ctx.dryRun
          ? toActivate.length
          : (
              await this.prisma.watchedMovieRecommendationLibrary.updateMany({
                where: {
                  plexUserId,
                  collectionName,
                  librarySectionKey: sec.key,
                  status: 'pending',
                  tmdbId: { in: toActivate },
                },
                data: { status: 'active' },
              })
            ).count;

        // Read active snapshot and rebuild Plex collection from it.
        const active = await this.prisma.watchedMovieRecommendationLibrary.findMany(
          {
            where: {
              plexUserId,
              collectionName,
              librarySectionKey: sec.key,
              status: 'active',
            },
            select: { tmdbId: true },
          },
        );

        const activeTmdbIds = active
          .map((a) => a.tmdbId)
          .filter((id) => tmdbMap.has(id));
        shuffleInPlace(activeTmdbIds);

        const desiredItems = activeTmdbIds
          .slice(0, limit)
          .map((id) => tmdbMap.get(id))
          .filter((v): v is { ratingKey: string; title: string } => Boolean(v));

        const plex = !ctx.dryRun
          ? await this.plexCurated.rebuildMovieCollection({
              ctx,
              baseUrl: plexBaseUrl,
              token: plexToken,
              machineIdentifier,
              movieSectionKey: sec.key,
              itemType: 1,
              collectionName: buildUserCollectionName(
                collectionName,
                plexUserTitle,
              ),
              desiredItems,
              randomizeOrder: false,
              pinCollections,
              collectionHubOrder,
            })
          : null;

        perCollection.push({
          collectionName,
          activatedNow,
          active: activeTmdbIds.length,
          applying: desiredItems.length,
          desiredTitles: desiredItems.map((d) => d.title),
          plex,
        });
      }

      outByLibrary.push({
        librarySectionKey: sec.key,
        library: sec.title,
        collections: perCollection,
      });
    }

    return { collections: Array.from(MOVIE_COLLECTIONS), byLibrary: outByLibrary };
  }

  private async refreshTvCollections(params: {
    ctx: JobContext;
    plexBaseUrl: string;
    plexToken: string;
    machineIdentifier: string;
    plexUserId: string;
    plexUserTitle: string;
    pinCollections: boolean;
    tvSections: PlexLibrarySection[];
    limit: number;
  }): Promise<JsonObject> {
    const {
      ctx,
      plexBaseUrl,
      plexToken,
      machineIdentifier,
      plexUserId,
      plexUserTitle,
      pinCollections,
      tvSections,
      limit,
    } = params;

    const outByLibrary: JsonObject[] = [];
    const collectionHubOrder = buildUserCollectionHubOrder(
      TV_COLLECTIONS,
      plexUserTitle,
    );

    for (const sec of tvSections) {
      // Build tvdbId -> (ratingKey,title) map for this library.
      const rows = await this.plexServer.listShowsWithTvdbIdsForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      const tvdbMap = new Map<number, { ratingKey: string; title: string }>();
      for (const r of rows) {
        if (!r.tvdbId) continue;
        if (!tvdbMap.has(r.tvdbId))
          tvdbMap.set(r.tvdbId, { ratingKey: r.ratingKey, title: r.title });
      }

      const perCollection: JsonObject[] = [];
      for (const collectionName of TV_COLLECTIONS) {
        const pending = await this.prisma.watchedShowRecommendationLibrary.findMany(
          {
            where: {
              plexUserId,
              collectionName,
              librarySectionKey: sec.key,
              status: 'pending',
            },
            select: { tvdbId: true },
          },
        );
        const toActivate = pending
          .map((p) => p.tvdbId)
          .filter((id) => tvdbMap.has(id));
        const activatedNow = ctx.dryRun
          ? toActivate.length
          : (
              await this.prisma.watchedShowRecommendationLibrary.updateMany({
                where: {
                  plexUserId,
                  collectionName,
                  librarySectionKey: sec.key,
                  status: 'pending',
                  tvdbId: { in: toActivate },
                },
                data: { status: 'active' },
              })
            ).count;

        const active = await this.prisma.watchedShowRecommendationLibrary.findMany(
          {
            where: {
              plexUserId,
              collectionName,
              librarySectionKey: sec.key,
              status: 'active',
            },
            select: { tvdbId: true },
          },
        );

        const activeTvdbIds = active
          .map((a) => a.tvdbId)
          .filter((id) => tvdbMap.has(id));
        shuffleInPlace(activeTvdbIds);

        const desiredItems = activeTvdbIds
          .slice(0, limit)
          .map((id) => tvdbMap.get(id))
          .filter((v): v is { ratingKey: string; title: string } => Boolean(v));

        const plex = !ctx.dryRun
          ? await this.plexCurated.rebuildMovieCollection({
              ctx,
              baseUrl: plexBaseUrl,
              token: plexToken,
              machineIdentifier,
              movieSectionKey: sec.key,
              itemType: 2,
              collectionName: buildUserCollectionName(
                collectionName,
                plexUserTitle,
              ),
              desiredItems,
              randomizeOrder: false,
              pinCollections,
              collectionHubOrder,
            })
          : null;

        perCollection.push({
          collectionName,
          activatedNow,
          active: activeTvdbIds.length,
          applying: desiredItems.length,
          desiredTitles: desiredItems.map((d) => d.title),
          plex,
        });
      }

      outByLibrary.push({
        librarySectionKey: sec.key,
        library: sec.title,
        collections: perCollection,
      });
    }

    return { collections: Array.from(TV_COLLECTIONS), byLibrary: outByLibrary };
  }
}

