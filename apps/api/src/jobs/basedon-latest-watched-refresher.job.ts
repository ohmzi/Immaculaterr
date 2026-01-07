import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import { WatchedMovieRecommendationsService } from '../watched-movie-recommendations/watched-movie-recommendations.service';
import { WatchedShowRecommendationsService } from '../watched-movie-recommendations/watched-show-recommendations.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

const DEFAULT_COLLECTIONS = [
  'Based on your recently watched movie',
  'Change of Taste',
] as const;

const DEFAULT_TV_COLLECTIONS = [
  'Based on your recently watched show',
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
    private readonly watchedShowRecs: WatchedShowRecommendationsService,
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

    void ctx
      .patchSummary({
        progress: {
          step: 'dataset',
          message: 'Locating curated recommendation datasets…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

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
          message: 'Scanning Plex movie + TV libraries…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const tmdbApiKey =
      pickString(secrets, 'tmdb.apiKey') ||
      pickString(secrets, 'tmdbApiKey') ||
      pickString(secrets, 'tmdb.api_key') ||
      '';

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
      .sort((a, b) => a.title.localeCompare(b.title));
    const tvSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'show')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!movieSections.length && !tvSections.length) {
      throw new Error('No Plex movie or TV libraries found');
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
      tvLibraries: tvSections.map((s) => s.title),
      collectionsMovie: Array.from(DEFAULT_COLLECTIONS),
      collectionsTv: Array.from(DEFAULT_TV_COLLECTIONS),
      activationPoints: BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
      limit,
      inputLimit,
      configuredLimit,
    });

    const perCollection: JsonObject[] = [];
    const tvCollections: JsonObject[] = [];

    if (movieSections.length) {
      // Build per-library TMDB->ratingKey map once so we can rebuild collections across all libraries.
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

    for (const collectionName of DEFAULT_COLLECTIONS) {
      await ctx.info('recentlyWatchedRefresher: collection start', {
        collectionName,
      });

      // One-time best-effort bootstrap: copy older global dataset into the new per-library tables
      // so existing setups don't look empty right after upgrading.
      if (!ctx.dryRun) {
        const legacyRows = await this.prisma.watchedMovieRecommendation
          .findMany({
            where: { collectionName },
            select: {
              tmdbId: true,
              title: true,
              status: true,
              points: true,
              tmdbVoteAvg: true,
              tmdbVoteCount: true,
            },
          })
          .catch(() => []);

        if (legacyRows.length) {
          let bootstrapped = 0;
          for (const sec of orderedMovieSections) {
            const existing =
              await this.prisma.watchedMovieRecommendationLibrary.count({
                where: { collectionName, librarySectionKey: sec.key },
              });
            if (existing > 0) continue;

            const batches = chunk(legacyRows, 200);
            for (const batch of batches) {
              await this.prisma.watchedMovieRecommendationLibrary.createMany({
                data: batch.map((r) => ({
                  collectionName,
                  librarySectionKey: sec.key,
                  tmdbId: r.tmdbId,
                  title: r.title ?? undefined,
                  status: r.status,
                  points: r.points,
                  tmdbVoteAvg: r.tmdbVoteAvg ?? undefined,
                  tmdbVoteCount: r.tmdbVoteCount ?? undefined,
                })),
              });
            }
            bootstrapped += 1;
          }

          if (bootstrapped) {
            await ctx.info('recentlyWatchedRefresher: bootstrapped per-library movie datasets', {
              collectionName,
              librariesBootstrapped: bootstrapped,
              legacyRows: legacyRows.length,
            });
          }
        }
      }

      // Use library-specific datasets so multi-library setups don't override each other.
      const plexByLibrary: JsonObject[] = [];
      let canonicalSnapshot: Array<{ ratingKey: string; title: string }> = [];
      let activatedNowTotal = 0;

      for (const sec of orderedMovieSections) {
        const tmdbMap =
          sectionTmdbToItem.get(sec.key) ??
          new Map<number, { ratingKey: string; title: string }>();

        // Activate pending suggestions that now exist in THIS library.
        const pendingRows =
          await this.prisma.watchedMovieRecommendationLibrary.findMany({
            where: { collectionName, librarySectionKey: sec.key, status: 'pending' },
            select: { tmdbId: true },
          });
        const toActivate = pendingRows
          .map((p) => p.tmdbId)
          .filter((id) => tmdbMap.has(id));

        const activatedNow = ctx.dryRun
          ? toActivate.length
          : (
              await this.watchedRecs.activatePendingNowInPlex({
                ctx,
                collectionName,
                librarySectionKey: sec.key,
                tmdbIds: toActivate,
                pointsOnActivation:
                  BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
                tmdbApiKey,
              })
            ).activated;
        activatedNowTotal += activatedNow;

        if (ctx.dryRun && activatedNow) {
          await ctx.info(
            'recentlyWatchedRefresher: dry-run would activate pending titles now in Plex',
            {
              collectionName,
              library: sec.title,
              movieSectionKey: sec.key,
              activated: activatedNow,
              pointsOnActivation:
                BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
            },
          );
        }

        const activeRows =
          await this.prisma.watchedMovieRecommendationLibrary.findMany({
            where: {
              collectionName,
              librarySectionKey: sec.key,
              status: 'active',
              points: { gt: 0 },
            },
            select: { tmdbId: true },
          });

        if (!activeRows.length) {
          plexByLibrary.push({
            collectionName,
            library: sec.title,
            movieSectionKey: sec.key,
            totalInLibrary: 0,
            totalApplying: 0,
            skipped: true,
            reason: 'no_active_rows_for_library',
            activatedNow,
          });
          continue;
        }

        const shuffledActiveTmdbIds = shuffleInPlace(
          activeRows.map((m) => m.tmdbId),
        );

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
            activatedNow,
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
              itemType: 2,
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
          activatedNow,
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
          activatedNow: activatedNowTotal,
        });
      }

      perCollection.push({
        collectionName,
        activatedNow: activatedNowTotal,
        dbSaved,
        curatedCollectionId,
        plexByLibrary,
      });
    }
    } else {
      await ctx.info(
        'recentlyWatchedRefresher: no movie libraries (skipping movie collections)',
      );
    }

    if (tvSections.length) {
      // Build per-library TVDB->ratingKey map once so we can rebuild collections across all TV libraries.
      const sectionTvdbToItem = new Map<
        string,
        Map<number, { ratingKey: string; title: string }>
      >();
      for (const sec of tvSections) {
        const map = new Map<number, { ratingKey: string; title: string }>();
        const rows = await this.plexServer.listShowsWithTvdbIdsForSectionKey({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey: sec.key,
          sectionTitle: sec.title,
        });
        for (const r of rows) {
          if (!r.tvdbId) continue;
          if (!map.has(r.tvdbId))
            map.set(r.tvdbId, { ratingKey: r.ratingKey, title: r.title });
        }
        sectionTvdbToItem.set(sec.key, map);
      }

      const canonicalTvSectionKey = (() => {
        const preferred =
          tvSections.find((s) => s.title.toLowerCase() === 'tv shows') ??
          tvSections.find((s) => s.title.toLowerCase() === 'shows') ??
          null;
        if (preferred) return preferred.key;
        const sorted = tvSections.slice().sort((a, b) => {
          const aCount = sectionTvdbToItem.get(a.key)?.size ?? 0;
          const bCount = sectionTvdbToItem.get(b.key)?.size ?? 0;
          if (aCount !== bCount) return bCount - aCount; // largest first
          return a.title.localeCompare(b.title);
        });
        return sorted[0]?.key ?? tvSections[0].key;
      })();

      const canonicalTvLibraryName =
        tvSections.find((s) => s.key === canonicalTvSectionKey)?.title ??
        tvSections[0].title;

      const orderedTvSections = tvSections.slice().sort((a, b) => {
        if (a.key === canonicalTvSectionKey) return -1;
        if (b.key === canonicalTvSectionKey) return 1;
        return a.title.localeCompare(b.title);
      });

      await ctx.info('recentlyWatchedRefresher(tv): canonical library selected', {
        canonicalTvLibraryName,
        canonicalTvSectionKey,
      });

      for (const collectionName of DEFAULT_TV_COLLECTIONS) {
        await ctx.info('recentlyWatchedRefresher(tv): collection start', {
          collectionName,
        });

        if (!ctx.dryRun) {
          const legacyRows = await this.prisma.watchedShowRecommendation
            .findMany({
              where: { collectionName },
              select: {
                tvdbId: true,
                tmdbId: true,
                title: true,
                status: true,
                points: true,
                tmdbVoteAvg: true,
                tmdbVoteCount: true,
              },
            })
            .catch(() => []);

          if (legacyRows.length) {
            let bootstrapped = 0;
            for (const sec of orderedTvSections) {
              const existing =
                await this.prisma.watchedShowRecommendationLibrary.count({
                  where: { collectionName, librarySectionKey: sec.key },
                });
              if (existing > 0) continue;

              const batches = chunk(legacyRows, 200);
              for (const batch of batches) {
                await this.prisma.watchedShowRecommendationLibrary.createMany({
                  data: batch.map((r) => ({
                    collectionName,
                    librarySectionKey: sec.key,
                    tvdbId: r.tvdbId,
                    tmdbId: r.tmdbId ?? undefined,
                    title: r.title ?? undefined,
                    status: r.status,
                    points: r.points,
                    tmdbVoteAvg: r.tmdbVoteAvg ?? undefined,
                    tmdbVoteCount: r.tmdbVoteCount ?? undefined,
                  })),
                });
              }
              bootstrapped += 1;
            }

            if (bootstrapped) {
              await ctx.info('recentlyWatchedRefresher: bootstrapped per-library tv datasets', {
                collectionName,
                librariesBootstrapped: bootstrapped,
                legacyRows: legacyRows.length,
              });
            }
          }
        }

        // Use library-specific datasets so multi-library setups don't override each other.
        const plexByLibrary: JsonObject[] = [];
        let activatedNowTotal = 0;

        for (const sec of orderedTvSections) {
          const tvdbMap =
            sectionTvdbToItem.get(sec.key) ??
            new Map<number, { ratingKey: string; title: string }>();

          const pendingRows =
            await this.prisma.watchedShowRecommendationLibrary.findMany({
              where: { collectionName, librarySectionKey: sec.key, status: 'pending' },
              select: { tvdbId: true },
            });
          const toActivate = pendingRows
            .map((p) => p.tvdbId)
            .filter((id) => tvdbMap.has(id));

          const activatedNow = ctx.dryRun
            ? toActivate.length
            : (
                await this.watchedShowRecs.activatePendingNowInPlex({
                  ctx,
                  collectionName,
                  librarySectionKey: sec.key,
                  tvdbIds: toActivate,
                  pointsOnActivation:
                    BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
                  tmdbApiKey,
                })
              ).activated;
          activatedNowTotal += activatedNow;

          if (ctx.dryRun && activatedNow) {
            await ctx.info(
              'recentlyWatchedRefresher(tv): dry-run would activate pending shows now in Plex',
              {
                collectionName,
                library: sec.title,
                tvSectionKey: sec.key,
                activated: activatedNow,
                pointsOnActivation:
                  BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
              },
            );
          }

          const activeRows =
            await this.prisma.watchedShowRecommendationLibrary.findMany({
              where: {
                collectionName,
                librarySectionKey: sec.key,
                status: 'active',
                points: { gt: 0 },
              },
              select: { tvdbId: true },
            });

          if (!activeRows.length) {
            plexByLibrary.push({
              collectionName,
              library: sec.title,
              tvSectionKey: sec.key,
              totalInLibrary: 0,
              totalApplying: 0,
              skipped: true,
              reason: 'no_active_rows_for_library',
              activatedNow,
            });
            continue;
          }

          const shuffledActiveTvdbIds = shuffleInPlace(
            activeRows.map((s) => s.tvdbId),
          );

          const desiredInLibrary = shuffledActiveTvdbIds
            .map((id) => tvdbMap.get(id))
            .filter(
              (v): v is { ratingKey: string; title: string } => Boolean(v),
            );

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

          if (!desiredLimited.length) {
            await ctx.info(
              'recentlyWatchedRefresher(tv): skipping library (no matches)',
              {
                collectionName,
                library: sec.title,
                tvSectionKey: sec.key,
              },
            );
            plexByLibrary.push({
              collectionName,
              library: sec.title,
              tvSectionKey: sec.key,
              totalInLibrary: desiredInLibraryDeduped.length,
              totalApplying: 0,
              skipped: true,
              reason: 'no_matches',
              activatedNow,
            });
            continue;
          }

          await ctx.info(
            'recentlyWatchedRefresher(tv): rebuilding library collection',
            {
              collectionName,
              library: sec.title,
              tvSectionKey: sec.key,
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
            tvSectionKey: sec.key,
            totalInLibrary: desiredInLibraryDeduped.length,
            totalApplying: desiredLimited.length,
            plex,
            activatedNow,
            top3: desiredLimited.slice(0, 3).map((d) => d.title),
            sampleTop10: desiredLimited.slice(0, 10).map((d) => d.title),
          });
        }

        // NOTE: We do not persist TV snapshots to CuratedCollection (movie-only UI).
        tvCollections.push({
          collectionName,
          activatedNow: activatedNowTotal,
          plexByLibrary,
        });
      }
    } else {
      await ctx.info(
        'recentlyWatchedRefresher: no TV libraries (skipping tv collections)',
      );
    }

    const summary: JsonObject = {
      dryRun: ctx.dryRun,
      activationPoints: BasedonLatestWatchedRefresherJob.ACTIVATION_POINTS,
      limit,
      collections: perCollection,
      tvCollections,
    };

    await ctx.info('recentlyWatchedRefresher: done', summary);
    const report = buildRecentlyWatchedRefresherReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function buildRecentlyWatchedRefresherReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;

  const movieCollections = Array.isArray(raw.collections)
    ? raw.collections.filter(
        (c): c is JsonObject =>
          Boolean(c) && typeof c === 'object' && !Array.isArray(c),
      )
    : [];
  const tvCollections = Array.isArray(raw.tvCollections)
    ? raw.tvCollections.filter(
        (c): c is JsonObject =>
          Boolean(c) && typeof c === 'object' && !Array.isArray(c),
      )
    : [];

  const tasks: JobReportV1['tasks'] = [];
  const issues: JobReportV1['issues'] = [];

  const addCollectionTasks = (params: {
    prefix: string;
    list: Array<JsonObject>;
  }) => {
    for (const col of params.list) {
      const collectionName = String(col.collectionName ?? 'Collection');
      const plexByLibrary = Array.isArray(col.plexByLibrary)
        ? col.plexByLibrary.filter(
            (x): x is JsonObject =>
              Boolean(x) && typeof x === 'object' && !Array.isArray(x),
          )
        : [];

      tasks.push({
        id: `${params.prefix}_${collectionName}`,
        title: `Collection: ${collectionName}`,
        status: 'success',
        rows: [
          metricRow({ label: 'Activated now', end: asNum(col.activatedNow), unit: 'items' }),
          metricRow({ label: 'Libraries', end: plexByLibrary.length, unit: 'libraries' }),
        ],
      });

      for (const lib of plexByLibrary) {
        const library = String(lib.library ?? lib.tvSectionKey ?? lib.movieSectionKey ?? 'Library');
        const plex = isPlainObject(lib.plex) ? lib.plex : null;
        const existingCount = plex ? asNum(plex.existingCount) : null;
        const desiredCount = plex ? asNum(plex.desiredCount) : asNum(lib.totalApplying);
        const skipped = Boolean(lib.skipped) || (plex ? Boolean((plex as Record<string, unknown>).skipped) : false);
        const reason =
          typeof lib.reason === 'string'
            ? lib.reason
            : plex && typeof (plex as Record<string, unknown>).reason === 'string'
              ? String((plex as Record<string, unknown>).reason)
              : null;

        if (skipped) {
          issues.push(
            issue(
              'warn',
              `${collectionName}: ${library} skipped${reason ? ` (${reason})` : ''}.`,
            ),
          );
        }

        tasks.push({
          id: `${params.prefix}_${collectionName}_${library}`,
          title: `- ${library}`,
          status: skipped ? 'skipped' : 'success',
          rows: [
            metricRow({
              label: 'Plex collection items',
              start: existingCount,
              changed:
                existingCount !== null && desiredCount !== null
                  ? desiredCount - existingCount
                  : null,
              end: desiredCount,
              unit: 'items',
            }),
            metricRow({ label: 'Total in library', end: asNum(lib.totalInLibrary), unit: 'items' }),
            metricRow({ label: 'Applying', end: asNum(lib.totalApplying), unit: 'items' }),
            metricRow({ label: 'Activated now', end: asNum(lib.activatedNow), unit: 'items' }),
          ],
        });
      }
    }
  };

  addCollectionTasks({ prefix: 'movie', list: movieCollections });
  addCollectionTasks({ prefix: 'tv', list: tvCollections });

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline: 'Refresher complete.',
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        rows: [
          metricRow({ label: 'Movie collections', end: movieCollections.length, unit: 'collections' }),
          metricRow({ label: 'TV collections', end: tvCollections.length, unit: 'collections' }),
          metricRow({ label: 'Limit', end: asNum(raw.limit), unit: 'items' }),
          metricRow({ label: 'Activation points', end: asNum(raw.activationPoints), unit: 'points' }),
        ],
      },
    ],
    tasks,
    issues,
    raw,
  };
}
