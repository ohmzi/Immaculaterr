import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
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
  private static readonly ACTIVATION_POINTS = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexCurated: PlexCuratedCollectionsService,
    private readonly immaculateTaste: ImmaculateTasteCollectionService,
    private readonly tmdb: TmdbService,
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

    let orderedMovieSections = movieSections.slice().sort((a, b) => {
      if (a.key === preferredMovieSectionKey) return -1;
      if (b.key === preferredMovieSectionKey) return 1;
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
      collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
      maxPoints,
      activationPoints: ImmaculateTasteRefresherJob.ACTIVATION_POINTS,
      limit,
    });

    await this.immaculateTaste.ensureLegacyImported({ ctx, maxPoints });

    const tmdbApiKey =
      pickString(secrets, 'tmdb.apiKey') ||
      pickString(secrets, 'tmdbApiKey') ||
      pickString(secrets, 'tmdb.api_key') ||
      '';

    // Build TMDB mapping across all movie libraries so we can refresh the collection in each one.
    const plexTmdbIds = new Set<number>();
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
        if (!r.tmdbId) continue;
        if (!tmdbMap.has(r.tmdbId))
          tmdbMap.set(r.tmdbId, { ratingKey: r.ratingKey, title: r.title });
        plexTmdbIds.add(r.tmdbId);
      }
      sectionTmdbToItem.set(sec.key, tmdbMap);
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

    orderedMovieSections = movieSections.slice().sort((a, b) => {
      if (a.key === preferredMovieSectionKey) return -1;
      if (b.key === preferredMovieSectionKey) return 1;
      if (a.key === canonicalMovieSectionKey) return -1;
      if (b.key === canonicalMovieSectionKey) return 1;
      return a.title.localeCompare(b.title);
    });

    await ctx.info('immaculateTasteRefresher: canonical library selected', {
      canonicalMovieLibraryName,
      canonicalMovieSectionKey,
    });

    // Activate pending suggestions that now exist in Plex.
    const pendingRows = await this.prisma.immaculateTasteMovie.findMany({
      where: { status: 'pending' },
      select: { tmdbId: true },
    });
    const toActivate = pendingRows
      .map((p) => p.tmdbId)
      .filter((id) => plexTmdbIds.has(id));

    const activatedNow = ctx.dryRun
      ? toActivate.length
      : (
          await this.immaculateTaste.activatePendingNowInPlex({
            ctx,
            tmdbIds: toActivate,
            pointsOnActivation: ImmaculateTasteRefresherJob.ACTIVATION_POINTS,
          })
        ).activated;

    if (ctx.dryRun && activatedNow) {
      await ctx.info(
        'immaculateTasteRefresher: dry-run would activate pending titles now in Plex',
        {
          activated: activatedNow,
          pointsOnActivation: ImmaculateTasteRefresherJob.ACTIVATION_POINTS,
        },
      );
    }

    // Load active items (these are the only ones eligible for collections).
    const activeRows = await this.prisma.immaculateTasteMovie.findMany({
      where: { status: 'active', points: { gt: 0 } },
      select: {
        tmdbId: true,
        title: true,
        points: true,
        tmdbVoteAvg: true,
        tmdbVoteCount: true,
      },
    });

    if (!activeRows.length) {
      await ctx.warn(
        'immaculateTasteRefresher: no active rows found (skipping)',
        {
          collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
        },
      );
      return { summary: { skipped: true, reason: 'no_active_rows' } };
    }

    const activeByTmdbId = new Map(
      activeRows.map((m) => [
        m.tmdbId,
        {
          tmdbId: m.tmdbId,
          title: (m.title ?? '').trim() || null,
          points: m.points,
          tmdbVoteAvg: m.tmdbVoteAvg ?? null,
          tmdbVoteCount: m.tmdbVoteCount ?? null,
        },
      ]),
    );

    // Best-effort: backfill TMDB ratings for active items that are missing vote_average.
    const missingRatingIds = activeRows
      .filter((m) => m.tmdbVoteAvg === null)
      .map((m) => m.tmdbId);

    let tmdbBackfilled = 0;
    const backfillLimit = 200;
    const backfillIds = missingRatingIds.slice(0, backfillLimit);

    if (!ctx.dryRun && backfillIds.length && tmdbApiKey) {
      await ctx.info('immaculateTasteRefresher: backfilling tmdb ratings', {
        missingTotal: missingRatingIds.length,
        backfillingNow: backfillIds.length,
      });

      const batches = chunk(backfillIds, 6);
      for (const batch of batches) {
        await Promise.all(
          batch.map(async (tmdbId) => {
            const details = await this.tmdb
              .getMovieVoteStats({ apiKey: tmdbApiKey, tmdbId })
              .catch(() => null);
            const voteAvg = details?.vote_average ?? null;
            const voteCount = details?.vote_count ?? null;

            if (voteAvg === null && voteCount === null) return;

            await this.prisma.immaculateTasteMovie
              .update({
                where: { tmdbId },
                data: {
                  ...(voteAvg !== null ? { tmdbVoteAvg: voteAvg } : {}),
                  ...(voteCount !== null ? { tmdbVoteCount: voteCount } : {}),
                },
              })
              .catch(() => null);

            const prev = activeByTmdbId.get(tmdbId);
            if (prev) {
              activeByTmdbId.set(tmdbId, {
                ...prev,
                tmdbVoteAvg: voteAvg ?? prev.tmdbVoteAvg,
                tmdbVoteCount: voteCount ?? prev.tmdbVoteCount,
              });
            }

            tmdbBackfilled += 1;
          }),
        );
      }

      await ctx.info('immaculateTasteRefresher: tmdb backfill done', {
        backfilled: tmdbBackfilled,
        remainingMissing: Math.max(
          0,
          missingRatingIds.length - backfillIds.length,
        ),
      });
    } else if (missingRatingIds.length && !tmdbApiKey) {
      await ctx.warn(
        'immaculateTasteRefresher: TMDB apiKey missing; cannot backfill ratings',
        {
          missingRatings: missingRatingIds.length,
        },
      );
    }

    // For each movie library, map TMDB → ratingKey and rebuild.
    const plexByLibrary: JsonObject[] = [];
    let canonicalSnapshot: Array<{ ratingKey: string; title: string }> = [];

    for (const sec of orderedMovieSections) {
      const tmdbMap =
        sectionTmdbToItem.get(sec.key) ??
        new Map<number, { ratingKey: string; title: string }>();
      const candidates: Array<{
        tmdbId: number;
        tmdbVoteAvg: number | null;
        tmdbVoteCount: number | null;
      }> = [];

      for (const tmdbId of tmdbMap.keys()) {
        const row = activeByTmdbId.get(tmdbId);
        if (!row) continue;
        candidates.push({
          tmdbId,
          tmdbVoteAvg: row.tmdbVoteAvg,
          tmdbVoteCount: row.tmdbVoteCount,
        });
      }

      const orderedTmdb =
        this.immaculateTaste.buildThreeTierTmdbRatingShuffleOrder({
          movies: candidates,
        });

      const desiredInLibrary = orderedTmdb
        .map((id) => tmdbMap.get(id))
        .filter((v): v is { ratingKey: string; title: string } => Boolean(v));

      const desiredLimited =
        limit && desiredInLibrary.length > limit
          ? desiredInLibrary.slice(0, limit)
          : desiredInLibrary;

      if (sec.key === canonicalMovieSectionKey) {
        canonicalSnapshot = desiredLimited;
      }

      if (!desiredLimited.length) {
        await ctx.info(
          'immaculateTasteRefresher: skipping library (no matches)',
          {
            library: sec.title,
            movieSectionKey: sec.key,
          },
        );
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

      await ctx.info(
        'immaculateTasteRefresher: rebuilding library collection',
        {
          library: sec.title,
          movieSectionKey: sec.key,
          totalInLibrary: desiredInLibrary.length,
          totalApplying: desiredLimited.length,
        },
      );

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
        top3: desiredLimited.slice(0, 3).map((d) => d.title),
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
      await ctx.info('immaculateTasteRefresher: db snapshot saved', {
        curatedCollectionId,
        movieLibraryName: canonicalMovieLibraryName,
        movieSectionKey: canonicalMovieSectionKey,
        savedItems: canonicalLimited.length,
        activatedNow,
        tmdbBackfilled,
      });
    }

    const summary: JsonObject = {
      collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
      totalLibraries: orderedMovieSections.length,
      dbSaved,
      curatedCollectionId,
      activatedNow,
      tmdbBackfilled,
      plexByLibrary,
    };

    await ctx.info('immaculateTasteRefresher: done', summary);
    return { summary };
  }
}
