import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import { WatchedMovieRecommendationsService } from '../watched-movie-recommendations/watched-movie-recommendations.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

const DEFAULT_COLLECTIONS = [
  'Based on your recently watched movie',
  'Change of Taste',
] as const;

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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
export class BasedonLatestWatchedRefresherJob {
  private static readonly ACTIVATION_POINTS = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexCuratedCollections: PlexCuratedCollectionsService,
    private readonly watchedRecs: WatchedMovieRecommendationsService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const limitRaw = typeof input['limit'] === 'number' ? input['limit'] : null;
    const inputLimit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.trunc(limitRaw))
        : null;

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

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
    if (!movieSections.length) {
      throw new Error('No Plex movie libraries found');
    }

    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });

    // Collection size is controlled separately; do NOT default it to recommendations.count.
    const configuredLimitRaw =
      pickNumber(settings, 'recommendations.collectionLimit') ?? 15;
    const configuredLimit = Math.max(
      1,
      Math.min(200, Math.trunc(configuredLimitRaw || 15)),
    );
    const limit = inputLimit ?? configuredLimit;

    await ctx.info('recentlyWatchedRefresher: start', {
      dryRun: ctx.dryRun,
      movieLibraries: movieSections.map((s) => s.title),
      collections: Array.from(DEFAULT_COLLECTIONS),
      activationPoints: BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
      limit,
      inputLimit,
      configuredLimit,
    });

    // Build per-library TMDB->ratingKey map once so we can rebuild collections across all libraries.
    const plexTmdbIds = new Set<number>();
    const sectionTmdbToItem = new Map<
      string,
      Map<number, { ratingKey: string; title: string }>
    >();
    for (const sec of movieSections) {
      const map = new Map<number, { ratingKey: string; title: string }>();
      const rows = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      for (const r of rows) {
        if (!r.tmdbId) continue;
        if (!map.has(r.tmdbId))
          map.set(r.tmdbId, { ratingKey: r.ratingKey, title: r.title });
        plexTmdbIds.add(r.tmdbId);
      }
      sectionTmdbToItem.set(sec.key, map);
    }

    const canonicalMovieSectionKey = (() => {
      const movies = movieSections.find(
        (s) => s.title.toLowerCase() === 'movies',
      );
      if (movies) return movies.key;
      const sorted = movieSections.slice().sort((a, b) => {
        const aCount = sectionTmdbToItem.get(a.key)?.size ?? 0;
        const bCount = sectionTmdbToItem.get(b.key)?.size ?? 0;
        if (aCount !== bCount) return bCount - aCount; // largest first
        return a.title.localeCompare(b.title);
      });
      return sorted[0]?.key ?? movieSections[0].key;
    })();

    const canonicalMovieLibraryName =
      movieSections.find((s) => s.key === canonicalMovieSectionKey)?.title ??
      movieSections[0].title;

    const orderedMovieSections = movieSections.slice().sort((a, b) => {
      if (a.key === canonicalMovieSectionKey) return -1;
      if (b.key === canonicalMovieSectionKey) return 1;
      return a.title.localeCompare(b.title);
    });

    await ctx.info('recentlyWatchedRefresher: canonical library selected', {
      canonicalMovieLibraryName,
      canonicalMovieSectionKey,
    });

    const perCollection: JsonObject[] = [];

    for (const collectionName of DEFAULT_COLLECTIONS) {
      await ctx.info('recentlyWatchedRefresher: collection start', {
        collectionName,
      });

      // Activate pending suggestions that now exist in Plex.
      const pendingRows = await this.prisma.watchedMovieRecommendation.findMany(
        {
          where: { collectionName, status: 'pending' },
          select: { tmdbId: true },
        },
      );
      const toActivate = pendingRows
        .map((p) => p.tmdbId)
        .filter((id) => plexTmdbIds.has(id));

      const activatedNow = ctx.dryRun
        ? toActivate.length
        : (
            await this.watchedRecs.activatePendingNowInPlex({
              ctx,
              collectionName,
              tmdbIds: toActivate,
              pointsOnActivation:
                BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
            })
          ).activated;

      if (ctx.dryRun && activatedNow) {
        await ctx.info(
          'recentlyWatchedRefresher: dry-run would activate pending titles now in Plex',
          {
            collectionName,
            activated: activatedNow,
            pointsOnActivation:
              BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
          },
        );
      }

      const activeRows = await this.prisma.watchedMovieRecommendation.findMany({
        where: { collectionName, status: 'active', points: { gt: 0 } },
        select: { tmdbId: true },
      });

      if (!activeRows.length) {
        await ctx.warn(
          'recentlyWatchedRefresher: no active rows found (skipping)',
          {
            collectionName,
          },
        );
        perCollection.push({
          collectionName,
          skipped: true,
          reason: 'no_active_rows',
          activatedNow,
        });
        continue;
      }

      const shuffledActiveTmdbIds = shuffleInPlace(
        activeRows.map((m) => m.tmdbId),
      );

      const plexByLibrary: JsonObject[] = [];
      let canonicalSnapshot: Array<{ ratingKey: string; title: string }> = [];

      for (const sec of orderedMovieSections) {
        const tmdbMap =
          sectionTmdbToItem.get(sec.key) ??
          new Map<number, { ratingKey: string; title: string }>();
        const desiredInLibrary = shuffledActiveTmdbIds
          .map((id) => tmdbMap.get(id))
          .filter((v): v is { ratingKey: string; title: string } => Boolean(v));

        // Extra safety: dedupe by ratingKey (preserve order)
        const uniq = new Map<string, string>();
        for (const it of desiredInLibrary) {
          if (!uniq.has(it.ratingKey)) uniq.set(it.ratingKey, it.title);
        }
        const desiredInLibraryDeduped = Array.from(uniq.entries()).map(
          ([ratingKey, title]) => ({ ratingKey, title }),
        );

        const desiredLimited =
          limit && desiredInLibraryDeduped.length > limit
            ? desiredInLibraryDeduped.slice(0, limit)
            : desiredInLibraryDeduped;

        if (sec.key === canonicalMovieSectionKey) {
          canonicalSnapshot = desiredLimited;
        }

        if (!desiredLimited.length) {
          await ctx.info(
            'recentlyWatchedRefresher: skipping library (no matches)',
            {
              collectionName,
              library: sec.title,
              movieSectionKey: sec.key,
            },
          );
          plexByLibrary.push({
            collectionName,
            library: sec.title,
            movieSectionKey: sec.key,
            totalInLibrary: desiredInLibraryDeduped.length,
            totalApplying: 0,
            skipped: true,
            reason: 'no_matches',
          });
          continue;
        }

        await ctx.info(
          'recentlyWatchedRefresher: rebuilding library collection',
          {
            collectionName,
            library: sec.title,
            movieSectionKey: sec.key,
            totalInLibrary: desiredInLibraryDeduped.length,
            totalApplying: desiredLimited.length,
          },
        );

        const plex = ctx.dryRun
          ? null
          : await this.plexCuratedCollections.rebuildMovieCollection({
              ctx,
              baseUrl: plexBaseUrl,
              token: plexToken,
              machineIdentifier,
              movieSectionKey: sec.key,
              collectionName,
              desiredItems: desiredLimited,
              randomizeOrder: false,
            });

        plexByLibrary.push({
          collectionName,
          library: sec.title,
          movieSectionKey: sec.key,
          totalInLibrary: desiredInLibraryDeduped.length,
          totalApplying: desiredLimited.length,
          plex,
          top3: desiredLimited.slice(0, 3).map((d) => d.title),
          sampleTop10: desiredLimited.slice(0, 10).map((d) => d.title),
        });
      }

      // Persist snapshot to curated collections (replace items)
      let dbSaved = false;
      let curatedCollectionId: string | null = null;
      if (!ctx.dryRun) {
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

        const canonicalLimited =
          limit && canonicalSnapshot.length > limit
            ? canonicalSnapshot.slice(0, limit)
            : canonicalSnapshot;

        const batches = chunk(canonicalLimited, 200);
        for (const batch of batches) {
          await this.prisma.curatedCollectionItem.createMany({
            data: batch.map((it) => ({
              collectionId: col.id,
              ratingKey: it.ratingKey,
              title: it.title,
            })),
          });
        }

        dbSaved = true;
        await ctx.info('recentlyWatchedRefresher: db snapshot saved', {
          collectionName,
          curatedCollectionId,
          movieLibraryName: canonicalMovieLibraryName,
          movieSectionKey: canonicalMovieSectionKey,
          savedItems: canonicalLimited.length,
          activatedNow,
        });
      }

      perCollection.push({
        collectionName,
        activatedNow,
        dbSaved,
        curatedCollectionId,
        plexByLibrary,
      });
    }

    const summary: JsonObject = {
      dryRun: ctx.dryRun,
      activationPoints: BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
      limit,
      collections: perCollection,
    };

    await ctx.info('recentlyWatchedRefresher: done', summary);
    return { summary };
  }
}
