import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
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

@Injectable()
export class ImmaculateTasteRefresherJob {
  private static readonly COLLECTION_NAME = 'Inspired by your Immaculate Taste';

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexCurated: PlexCuratedCollectionsService,
    private readonly immaculateTaste: ImmaculateTasteCollectionService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const limitRaw = typeof input['limit'] === 'number' ? input['limit'] : null;
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.trunc(limitRaw))
        : null;
    const inputMovieSectionKey =
      typeof input['movieSectionKey'] === 'string'
        ? input['movieSectionKey'].trim()
        : '';
    const seedRatingKey =
      typeof input['seedRatingKey'] === 'string' ? input['seedRatingKey'].trim() : '';
    const seedLibrarySectionId =
      typeof input['seedLibrarySectionId'] === 'number' &&
      Number.isFinite(input['seedLibrarySectionId'])
        ? String(Math.trunc(input['seedLibrarySectionId']))
        : typeof input['seedLibrarySectionId'] === 'string'
          ? input['seedLibrarySectionId'].trim()
          : '';

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const configuredMovieLibraryName =
      pickString(settings, 'plex.movieLibraryName') ||
      pickString(settings, 'plex.movie_library_name') ||
      'Movies';
    const configuredMovieLibraryKey =
      pickString(settings, 'plex.movieLibraryKey') ||
      pickString(settings, 'plex.movie_library_key') ||
      '';

    const preferredMovieSectionKey =
      inputMovieSectionKey || seedLibrarySectionId || '';

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'movie',
    );
    if (!movieSections.length) {
      throw new Error('No Plex movie libraries found');
    }

    const canonicalMovieSectionKey = (() => {
      const key = configuredMovieLibraryKey.trim();
      if (key && movieSections.some((s) => s.key === key)) return key;
      const byTitle = movieSections.find(
        (s) => s.title.toLowerCase() === configuredMovieLibraryName.toLowerCase(),
      );
      if (byTitle) return byTitle.key;
      return movieSections[0].key;
    })();

    const canonicalMovieLibraryName =
      movieSections.find((s) => s.key === canonicalMovieSectionKey)?.title ??
      configuredMovieLibraryName;

    const orderedMovieSections = movieSections.slice().sort((a, b) => {
      if (a.key === preferredMovieSectionKey) return -1;
      if (b.key === preferredMovieSectionKey) return 1;
      if (a.key === canonicalMovieSectionKey) return -1;
      if (b.key === canonicalMovieSectionKey) return 1;
      return a.title.localeCompare(b.title);
    });

    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });

    const maxPoints =
      Math.trunc(pickNumber(settings, 'immaculateTaste.maxPoints') ?? 50) || 50;

    await ctx.info('immaculateTasteRefresher: start', {
      dryRun: ctx.dryRun,
      movieLibraries: orderedMovieSections.map((s) => s.title),
      canonicalMovieLibraryName,
      canonicalMovieSectionKey,
      collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
      maxPoints,
      limit,
    });

    await this.immaculateTaste.ensureLegacyImported({ ctx, maxPoints });

    const movies = await this.prisma.immaculateTasteMovie.findMany({
      where: { points: { gt: 0 } },
      select: { ratingKey: true, title: true, points: true },
    });

    if (!movies.length) {
      await ctx.warn('immaculateTasteRefresher: no points rows found (skipping)', {
        collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
      });
      return { summary: { skipped: true, reason: 'no_points_rows' } };
    }

    const order = this.immaculateTaste.buildTieredRandomOrder({
      movies,
      maxPoints,
    });

    const titleByKey = new Map(
      movies.map((m) => [
        m.ratingKey,
        (m.title ?? '').trim() || m.ratingKey,
      ]),
    );

    const desiredItems = order.map((ratingKey) => ({
      ratingKey,
      title: titleByKey.get(ratingKey) ?? ratingKey,
    }));

    // Build TMDB mapping across all movie libraries so we can refresh the collection in each one.
    const ratingKeyToTmdbId = new Map<string, number>();
    const sectionTmdbToItem = new Map<
      string,
      Map<number, { ratingKey: string; title: string }>
    >();

    for (const sec of orderedMovieSections) {
      const tmdbMap = new Map<number, { ratingKey: string; title: string }>();
      const rows = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      for (const r of rows) {
        if (r.tmdbId) {
          if (!tmdbMap.has(r.tmdbId)) tmdbMap.set(r.tmdbId, { ratingKey: r.ratingKey, title: r.title });
          ratingKeyToTmdbId.set(r.ratingKey, r.tmdbId);
        }
      }
      sectionTmdbToItem.set(sec.key, tmdbMap);
    }

    const desiredTmdbIds: number[] = [];
    const seenTmdb = new Set<number>();
    let missingTmdb = 0;
    for (const it of desiredItems) {
      const tmdbId = ratingKeyToTmdbId.get(it.ratingKey) ?? null;
      if (!tmdbId) {
        missingTmdb += 1;
        continue;
      }
      if (seenTmdb.has(tmdbId)) continue;
      seenTmdb.add(tmdbId);
      desiredTmdbIds.push(tmdbId);
    }

    await ctx.info('immaculateTasteRefresher: built tmdb order', {
      totalPointsRows: desiredItems.length,
      totalTmdb: desiredTmdbIds.length,
      missingTmdb,
      sampleTmdb: desiredTmdbIds.slice(0, 10),
    });

    // For each movie library, map TMDB → ratingKey and rebuild.
    const plexByLibrary: JsonObject[] = [];
    for (const sec of orderedMovieSections) {
      const tmdbMap = sectionTmdbToItem.get(sec.key) ?? new Map();
      const desiredInLibrary = desiredTmdbIds
        .map((id) => tmdbMap.get(id))
        .filter((v): v is { ratingKey: string; title: string } => Boolean(v));
      const desiredLimited =
        limit && desiredInLibrary.length > limit
          ? desiredInLibrary.slice(0, limit)
          : desiredInLibrary;

      if (!desiredLimited.length) {
        await ctx.info('immaculateTasteRefresher: skipping library (no matches)', {
          library: sec.title,
          movieSectionKey: sec.key,
        });
        plexByLibrary.push({
          library: sec.title,
          movieSectionKey: sec.key,
          totalInLibrary: desiredInLibrary.length,
          totalApplying: 0,
          skipped: true,
          reason: 'no_matches',
        });
        continue;
      }

      await ctx.info('immaculateTasteRefresher: rebuilding library collection', {
        library: sec.title,
        movieSectionKey: sec.key,
        totalInLibrary: desiredInLibrary.length,
        totalApplying: desiredLimited.length,
      });

      const plex = ctx.dryRun
        ? null
        : await this.plexCurated.rebuildMovieCollection({
            ctx,
            baseUrl: plexBaseUrl,
            token: plexToken,
            machineIdentifier,
            movieSectionKey: sec.key,
            collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
            desiredItems: desiredLimited,
            randomizeOrder: false,
          });

      plexByLibrary.push({
        library: sec.title,
        movieSectionKey: sec.key,
        totalInLibrary: desiredInLibrary.length,
        totalApplying: desiredLimited.length,
        plex,
        sampleTop10: desiredLimited.slice(0, 10).map((d) => d.title),
      });
    }

    // Persist snapshot to curated collections (replace items)
    let dbSaved = false;
    let curatedCollectionId: string | null = null;
    if (!ctx.dryRun) {
      const col = await this.prisma.curatedCollection.upsert({
        where: { name: ImmaculateTasteRefresherJob.COLLECTION_NAME },
        update: {},
        create: { name: ImmaculateTasteRefresherJob.COLLECTION_NAME },
        select: { id: true },
      });
      curatedCollectionId = col.id;

      await this.prisma.curatedCollectionItem.deleteMany({
        where: { collectionId: col.id },
      });

      // Keep a stable snapshot based on the canonical movie library (primary Movies).
      const canonicalMap = sectionTmdbToItem.get(canonicalMovieSectionKey) ?? new Map();
      const canonicalItems = desiredTmdbIds
        .map((id) => canonicalMap.get(id))
        .filter((v): v is { ratingKey: string; title: string } => Boolean(v));
      const canonicalLimited =
        limit && canonicalItems.length > limit ? canonicalItems.slice(0, limit) : canonicalItems;

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
      await ctx.info('immaculateTasteRefresher: db snapshot saved', {
        curatedCollectionId,
        movieLibraryName: canonicalMovieLibraryName,
        movieSectionKey: canonicalMovieSectionKey,
        savedItems: canonicalLimited.length,
      });
    }

    const summary: JsonObject = {
      collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
      totalLibraries: orderedMovieSections.length,
      dbSaved,
      curatedCollectionId,
      plexByLibrary,
    };

    await ctx.info('immaculateTasteRefresher: done', summary);
    return { summary };
  }
}


