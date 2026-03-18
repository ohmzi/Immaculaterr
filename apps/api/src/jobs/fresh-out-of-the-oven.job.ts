import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { SWEEP_ORDER, sortSweepUsers } from './refresher-sweep.utils';
import { resolvePlexLibrarySelection } from '../plex/plex-library-selection.utils';
import {
  buildFreshOutMovieCollectionHubOrder,
  FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
} from '../plex/plex-collections.utils';
import { resolvePlexUserMonitoringSelection } from '../plex/plex-user-selection.utils';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexService } from '../plex/plex.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { WatchedCollectionsRefresherService } from '../watched-movie-recommendations/watched-collections-refresher.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

const BASELINE_STALE_MS = 24 * 60 * 60_000;
const RECENT_RELEASE_MONTHS = 3;

type PlexLibrarySection = { key: string; title: string; type?: string };
type PlexSweepUser = {
  id: string;
  plexAccountId: number | null;
  plexAccountTitle: string;
  isAdmin: boolean;
  lastSeenAt: Date | string | null;
};
type FreshReleaseBaselineRow = {
  tmdbId: number;
  title: string | null;
  releaseDate: string | null;
  tmdbPosterPath: string | null;
  tmdbVoteAvg: number | null;
  tmdbVoteCount: number | null;
  lastCheckedAt: Date;
};

function isPositiveTmdbId(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

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
  const value = pick(obj, path);
  return typeof value === 'string' ? value.trim() : '';
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

function parseDateOnly(value: string | null | undefined): Date | null {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateOnly(value: Date | null): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return null;
  return value.toISOString().slice(0, 10);
}

function subtractMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() - months);
  return next;
}

function isDateWithinWindow(params: {
  date: Date | null;
  minDate: Date;
  maxDate: Date;
}): boolean {
  if (!(params.date instanceof Date) || !Number.isFinite(params.date.getTime()))
    return false;
  return (
    params.date.getTime() >= params.minDate.getTime() &&
    params.date.getTime() <= params.maxDate.getTime()
  );
}

function buildBaselineSortKey(row: FreshReleaseBaselineRow): string {
  return `${row.releaseDate ?? '0000-00-00'}|${row.title ?? ''}|${row.tmdbId}`;
}

@Injectable()
export class FreshOutOfTheOvenJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexService: PlexService,
    private readonly plexUsers: PlexUsersService,
    private readonly tmdb: TmdbService,
    private readonly watchedRefresher: WatchedCollectionsRefresherService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    const tmdbApiKey =
      pickString(secrets, 'tmdb.apiKey') || pickString(secrets, 'tmdbApiKey');

    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    if (!tmdbApiKey) throw new Error('TMDB apiKey is not set');

    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_libraries',
          message: 'Scanning selected Plex movie libraries…',
          mediaType: 'movie',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const librarySelection = resolvePlexLibrarySelection({
      settings,
      sections,
    });
    const selectedSectionKeySet = new Set(librarySelection.selectedSectionKeys);
    const movieSections = sections
      .filter(
        (section) =>
          (section.type ?? '').toLowerCase() === 'movie' &&
          selectedSectionKeySet.has(section.key),
      )
      .sort((a, b) => a.title.localeCompare(b.title));

    if (!movieSections.length) {
      return {
        summary: {
          skipped: true,
          reason: 'no_selected_movie_libraries',
          sweepOrder: SWEEP_ORDER,
          collectionName: FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
        },
      };
    }

    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const { adminUser, accessTokenByUserId, orderedUsers } =
      await this.resolveMonitoredUsers({
        ctx,
        settings,
        plexToken,
        machineIdentifier,
      });

    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    const recentReleaseMinDate = subtractMonths(
      new Date(today.getTime()),
      RECENT_RELEASE_MONTHS,
    );
    recentReleaseMinDate.setUTCHours(0, 0, 0, 0);

    void ctx
      .patchSummary({
        progress: {
          step: 'dataset',
          message: 'Refreshing recent-release movie baseline…',
          mediaType: 'movie',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const baselineBySection = new Map<string, FreshReleaseBaselineRow[]>();
    const baselineSummary: JsonObject[] = [];
    for (const section of movieSections) {
      const baseline = await this.syncBaselineForSection({
        ctx,
        plexBaseUrl,
        plexToken,
        tmdbApiKey,
        section,
        recentReleaseMinDate,
        recentReleaseMaxDate: today,
      });
      baselineBySection.set(section.key, baseline.rows);
      baselineSummary.push({
        librarySectionKey: section.key,
        library: section.title,
        plexMatches: baseline.plexMatches,
        refreshed: baseline.refreshed,
        cacheHitsKept: baseline.cacheHitsKept,
        recentReleases: baseline.rows.length,
        removed: baseline.removed,
      });
    }

    const userSummaries: JsonObject[] = [];
    let usersSucceeded = 0;
    let usersSkipped = 0;
    let usersFailed = 0;

    for (const user of orderedUsers) {
      const userIsAdmin =
        user.id === adminUser.id ||
        (user.plexAccountId !== null &&
          adminUser.plexAccountId !== null &&
          user.plexAccountId === adminUser.plexAccountId) ||
        user.isAdmin;
      const pinTarget: 'admin' | 'friends' = userIsAdmin ? 'admin' : 'friends';
      const pinVisibilityProfile = userIsAdmin
        ? 'home_only'
        : 'shared_home_only';
      const accessToken = accessTokenByUserId.get(user.id) ?? null;

      if (!accessToken) {
        usersSkipped += 1;
        await ctx.warn(
          'freshOutOfTheOven: skipping user (missing access token)',
          {
            plexUserId: user.id,
            plexUserTitle: user.plexAccountTitle,
          },
        );
        userSummaries.push({
          plexUserId: user.id,
          plexUserTitle: user.plexAccountTitle,
          pinTarget,
          skipped: true,
          reason: 'missing_user_token',
        });
        continue;
      }

      let accessibleMovieSections = movieSections;
      if (!userIsAdmin) {
        try {
          const userSections = await this.plexServer.getSections({
            baseUrl: plexBaseUrl,
            token: accessToken,
          });
          const accessibleSectionKeySet = new Set(
            userSections.map((section) => section.key),
          );
          accessibleMovieSections = movieSections.filter((section) =>
            accessibleSectionKeySet.has(section.key),
          );
        } catch (err) {
          usersSkipped += 1;
          const message = (err as Error)?.message ?? String(err);
          await ctx.warn(
            'freshOutOfTheOven: skipping user (failed to resolve accessible libraries)',
            {
              plexUserId: user.id,
              plexUserTitle: user.plexAccountTitle,
              error: message,
            },
          );
          userSummaries.push({
            plexUserId: user.id,
            plexUserTitle: user.plexAccountTitle,
            pinTarget,
            skipped: true,
            reason: 'accessible_library_lookup_failed',
            error: message,
          });
          continue;
        }
      }

      void ctx
        .patchSummary({
          progress: {
            step: 'user_watch_state',
            message: `Checking watched state for ${user.plexAccountTitle}…`,
            mediaType: 'movie',
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);

      const watchedTmdbIdsBySection = new Map<string, Set<number>>();
      try {
        for (const section of accessibleMovieSections) {
          const baselineRows = baselineBySection.get(section.key) ?? [];
          if (!baselineRows.length) {
            watchedTmdbIdsBySection.set(section.key, new Set<number>());
            continue;
          }
          const watchedTmdbIds =
            await this.plexServer.listWatchedMovieTmdbIdsForSectionKey({
              baseUrl: plexBaseUrl,
              token: accessToken,
              librarySectionKey: section.key,
            });
          watchedTmdbIdsBySection.set(section.key, new Set(watchedTmdbIds));
        }
      } catch (err) {
        usersSkipped += 1;
        const message = (err as Error)?.message ?? String(err);
        await ctx.warn(
          'freshOutOfTheOven: skipping user after lookup failure',
          {
            plexUserId: user.id,
            plexUserTitle: user.plexAccountTitle,
            error: message,
          },
        );
        userSummaries.push({
          plexUserId: user.id,
          plexUserTitle: user.plexAccountTitle,
          pinTarget,
          skipped: true,
          reason: 'watch_state_lookup_failed',
          error: message,
        });
        continue;
      }

      try {
        if (!ctx.dryRun) {
          const operations = [];
          const accessibleSectionKeySet = new Set(
            accessibleMovieSections.map((section) => section.key),
          );
          for (const section of movieSections) {
            const baselineRows = baselineBySection.get(section.key) ?? [];
            const watchedTmdbIds =
              watchedTmdbIdsBySection.get(section.key) ?? new Set<number>();
            const unseenRows = accessibleSectionKeySet.has(section.key)
              ? baselineRows.filter((row) => !watchedTmdbIds.has(row.tmdbId))
              : [];

            operations.push(
              this.prisma.watchedMovieRecommendationLibrary.deleteMany({
                where: {
                  plexUserId: user.id,
                  collectionName:
                    FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
                  librarySectionKey: section.key,
                },
              }),
            );
            if (unseenRows.length) {
              operations.push(
                this.prisma.watchedMovieRecommendationLibrary.createMany({
                  data: unseenRows.map((row) => ({
                    plexUserId: user.id,
                    collectionName:
                      FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
                    librarySectionKey: section.key,
                    tmdbId: row.tmdbId,
                    title: row.title ?? undefined,
                    status: 'active',
                    tmdbVoteAvg: row.tmdbVoteAvg ?? undefined,
                    tmdbVoteCount: row.tmdbVoteCount ?? undefined,
                    tmdbPosterPath: row.tmdbPosterPath ?? undefined,
                    downloadApproval: 'none',
                  })),
                }),
              );
            }
          }
          if (operations.length) {
            await this.prisma.$transaction(operations);
          }
        }

        const refresh = await this.watchedRefresher.refresh({
          ctx,
          plexBaseUrl,
          plexToken,
          machineIdentifier,
          plexUserId: user.id,
          plexUserTitle: user.plexAccountTitle,
          pinCollections: true,
          pinTarget,
          pinVisibilityProfile,
          movieSections,
          tvSections: [],
          limit: null,
          movieCollectionBaseNames: [
            FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
          ],
          tvCollectionBaseNames: [],
          movieCollectionHubOrder: buildFreshOutMovieCollectionHubOrder(
            user.plexAccountTitle,
          ),
          scope: null,
        });

        usersSucceeded += 1;
        userSummaries.push({
          plexUserId: user.id,
          plexUserTitle: user.plexAccountTitle,
          pinTarget,
          accessibleMovieLibraryCount: accessibleMovieSections.length,
          accessibleMovieLibraries: accessibleMovieSections.map(
            (section) => section.title,
          ),
          refresh,
        });
      } catch (err) {
        usersFailed += 1;
        const message = (err as Error)?.message ?? String(err);
        await ctx.warn('freshOutOfTheOven: failed user refresh', {
          plexUserId: user.id,
          plexUserTitle: user.plexAccountTitle,
          error: message,
        });
        userSummaries.push({
          plexUserId: user.id,
          plexUserTitle: user.plexAccountTitle,
          pinTarget,
          failed: true,
          reason: 'user_refresh_failed',
          error: message,
        });
      }
    }

    const summary: JsonObject = {
      collectionName: FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
      sweepOrder: SWEEP_ORDER,
      dryRun: ctx.dryRun,
      movieLibraries: movieSections.map((section) => section.title),
      baseline: baselineSummary,
      usersProcessed: orderedUsers.length,
      usersSucceeded,
      usersSkipped,
      usersFailed,
      users: userSummaries,
    };

    await ctx.info('freshOutOfTheOven: done', summary);
    return { summary };
  }

  private async resolveMonitoredUsers(params: {
    ctx: JobContext;
    settings: Record<string, unknown>;
    plexToken: string;
    machineIdentifier: string;
  }): Promise<{
    adminUser: PlexSweepUser;
    orderedUsers: PlexSweepUser[];
    accessTokenByUserId: Map<string, string>;
  }> {
    const adminUser = await this.plexUsers.ensureAdminPlexUser({
      userId: params.ctx.userId,
    });

    const sharedUsers = await this.plexService
      .listSharedUsersWithAccessTokensForServer({
        plexToken: params.plexToken,
        machineIdentifier: params.machineIdentifier,
      })
      .catch(async (err) => {
        await params.ctx.warn(
          'freshOutOfTheOven: shared-user discovery failed (admin will still run)',
          {
            error: (err as Error)?.message ?? String(err),
          },
        );
        return [];
      });

    const users: PlexSweepUser[] = [
      {
        id: adminUser.id,
        plexAccountId: adminUser.plexAccountId,
        plexAccountTitle: adminUser.plexAccountTitle,
        isAdmin: true,
        lastSeenAt: adminUser.lastSeenAt,
      },
    ];
    const accessTokenByUserId = new Map<string, string>();
    accessTokenByUserId.set(adminUser.id, params.plexToken);

    for (const sharedUser of sharedUsers) {
      const resolvedUser = await this.plexUsers.getOrCreateByPlexAccount({
        plexAccountId: sharedUser.plexAccountId,
        plexAccountTitle: sharedUser.plexAccountTitle,
      });
      if (!resolvedUser) continue;

      const existingIndex = users.findIndex(
        (user) => user.id === resolvedUser.id,
      );
      const nextRow: PlexSweepUser = {
        id: resolvedUser.id,
        plexAccountId: resolvedUser.plexAccountId,
        plexAccountTitle: resolvedUser.plexAccountTitle,
        isAdmin: resolvedUser.isAdmin,
        lastSeenAt: resolvedUser.lastSeenAt,
      };
      if (existingIndex >= 0) {
        users[existingIndex] = nextRow;
      } else {
        users.push(nextRow);
      }

      if (
        sharedUser.accessToken &&
        resolvedUser.id !== adminUser.id &&
        !accessTokenByUserId.has(resolvedUser.id)
      ) {
        accessTokenByUserId.set(resolvedUser.id, sharedUser.accessToken);
      }
    }

    const monitoringSelection = resolvePlexUserMonitoringSelection({
      settings: params.settings,
      users,
    });
    const monitoredUserIdSet = new Set(monitoringSelection.selectedPlexUserIds);
    const orderedUsers = sortSweepUsers(
      users.filter((user) => monitoredUserIdSet.has(user.id)),
    );

    return {
      adminUser,
      orderedUsers,
      accessTokenByUserId,
    };
  }

  private async syncBaselineForSection(params: {
    ctx: JobContext;
    plexBaseUrl: string;
    plexToken: string;
    tmdbApiKey: string;
    section: PlexLibrarySection;
    recentReleaseMinDate: Date;
    recentReleaseMaxDate: Date;
  }): Promise<{
    rows: FreshReleaseBaselineRow[];
    plexMatches: number;
    refreshed: number;
    cacheHitsKept: number;
    removed: number;
  }> {
    const { ctx, plexBaseUrl, plexToken, tmdbApiKey, section } = params;

    const plexRows = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
      baseUrl: plexBaseUrl,
      token: plexToken,
      librarySectionKey: section.key,
      sectionTitle: section.title,
    });
    const plexTitleByTmdbId = new Map<number, string>();
    for (const row of plexRows) {
      if (!row.tmdbId) continue;
      if (!plexTitleByTmdbId.has(row.tmdbId)) {
        plexTitleByTmdbId.set(row.tmdbId, row.title);
      }
    }
    const minReleaseYear = params.recentReleaseMinDate.getUTCFullYear();
    const maxReleaseYear = params.recentReleaseMaxDate.getUTCFullYear();
    const currentTmdbIds = Array.from(
      new Set(
        plexRows
          .filter((row) => {
            if (row.year === null) return true;
            return row.year >= minReleaseYear && row.year <= maxReleaseYear;
          })
          .map((row) => row.tmdbId)
          .filter(isPositiveTmdbId),
      ),
    );

    const existingRows = await this.prisma.freshReleaseMovieLibrary.findMany({
      where: { librarySectionKey: section.key },
      orderBy: [{ releaseDate: 'desc' }, { title: 'asc' }],
    });
    const existingByTmdbId = new Map(
      existingRows.map((row) => [row.tmdbId, row]),
    );
    const staleBefore = Date.now() - BASELINE_STALE_MS;
    const recentRowsByTmdbId = new Map<number, FreshReleaseBaselineRow>();
    let refreshed = 0;
    let cacheHitsKept = 0;

    for (const tmdbId of currentTmdbIds) {
      const existing = existingByTmdbId.get(tmdbId) ?? null;
      const existingReleaseDate = formatDateOnly(existing?.releaseDate ?? null);
      const existingReleaseDateValue = parseDateOnly(existingReleaseDate);
      const existingRowIsRecent = isDateWithinWindow({
        date: existingReleaseDateValue,
        minDate: params.recentReleaseMinDate,
        maxDate: params.recentReleaseMaxDate,
      });
      const isStale =
        !existing ||
        !existing.lastCheckedAt ||
        existing.lastCheckedAt.getTime() < staleBefore;

      const existingCacheRow: FreshReleaseBaselineRow | null = existing
        ? {
            tmdbId,
            title: existing.title ?? null,
            releaseDate: existingReleaseDate,
            tmdbPosterPath: existing.tmdbPosterPath ?? null,
            tmdbVoteAvg: existing.tmdbVoteAvg ?? null,
            tmdbVoteCount: existing.tmdbVoteCount ?? null,
            lastCheckedAt: existing.lastCheckedAt,
          }
        : null;

      if (!isStale) {
        if (existingRowIsRecent) {
          cacheHitsKept += 1;
          if (existingCacheRow) {
            recentRowsByTmdbId.set(tmdbId, existingCacheRow);
          }
        }
        continue;
      }

      try {
        const details = await this.tmdb.getMovie({
          apiKey: tmdbApiKey,
          tmdbId,
        });
        refreshed += 1;

        const releaseDateValue = parseDateOnly(details?.release_date ?? null);
        const refreshedRow: FreshReleaseBaselineRow = {
          tmdbId,
          title:
            (details?.title ?? '').trim() ||
            plexTitleByTmdbId.get(tmdbId) ||
            existing?.title ||
            null,
          releaseDate: formatDateOnly(releaseDateValue),
          tmdbPosterPath:
            details?.poster_path ?? existing?.tmdbPosterPath ?? null,
          tmdbVoteAvg:
            typeof details?.vote_average === 'number'
              ? details.vote_average
              : (existing?.tmdbVoteAvg ?? null),
          tmdbVoteCount:
            typeof details?.vote_count === 'number'
              ? Math.max(0, Math.trunc(details.vote_count))
              : (existing?.tmdbVoteCount ?? null),
          lastCheckedAt: new Date(),
        };
        if (
          isDateWithinWindow({
            date: releaseDateValue,
            minDate: params.recentReleaseMinDate,
            maxDate: params.recentReleaseMaxDate,
          })
        ) {
          recentRowsByTmdbId.set(tmdbId, refreshedRow);
        }
      } catch (err) {
        await ctx.warn(
          'freshOutOfTheOven: TMDB refresh failed for cached movie (keeping prior row when possible)',
          {
            librarySectionKey: section.key,
            library: section.title,
            tmdbId,
            error: (err as Error)?.message ?? String(err),
          },
        );
        if (existingCacheRow && existingRowIsRecent) {
          recentRowsByTmdbId.set(tmdbId, existingCacheRow);
        }
      }
    }

    const rows = Array.from(recentRowsByTmdbId.values()).sort((a, b) =>
      buildBaselineSortKey(b).localeCompare(buildBaselineSortKey(a)),
    );
    const finalTmdbIds = rows.map((row) => row.tmdbId);
    const removed = existingRows.filter(
      (row) => !recentRowsByTmdbId.has(row.tmdbId),
    ).length;

    if (!ctx.dryRun) {
      await this.prisma.freshReleaseMovieLibrary.deleteMany({
        where: {
          librarySectionKey: section.key,
          ...(finalTmdbIds.length ? { tmdbId: { notIn: finalTmdbIds } } : {}),
        },
      });

      for (const row of rows) {
        await this.prisma.freshReleaseMovieLibrary.upsert({
          where: {
            librarySectionKey_tmdbId: {
              librarySectionKey: section.key,
              tmdbId: row.tmdbId,
            },
          },
          update: {
            title: row.title ?? undefined,
            releaseDate: row.releaseDate
              ? new Date(`${row.releaseDate}T00:00:00.000Z`)
              : null,
            tmdbPosterPath: row.tmdbPosterPath ?? undefined,
            tmdbVoteAvg: row.tmdbVoteAvg ?? undefined,
            tmdbVoteCount: row.tmdbVoteCount ?? undefined,
            lastCheckedAt: row.lastCheckedAt,
          },
          create: {
            librarySectionKey: section.key,
            tmdbId: row.tmdbId,
            title: row.title ?? undefined,
            releaseDate: row.releaseDate
              ? new Date(`${row.releaseDate}T00:00:00.000Z`)
              : null,
            tmdbPosterPath: row.tmdbPosterPath ?? undefined,
            tmdbVoteAvg: row.tmdbVoteAvg ?? undefined,
            tmdbVoteCount: row.tmdbVoteCount ?? undefined,
            lastCheckedAt: row.lastCheckedAt,
          },
        });
      }
    }

    return {
      rows,
      plexMatches: currentTmdbIds.length,
      refreshed,
      cacheHitsKept,
      removed,
    };
  }
}
