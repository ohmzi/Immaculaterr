import { BadGatewayException, Injectable } from '@nestjs/common';
import type { DownloadApprovalStatus } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from '../immaculate-taste-collection/immaculate-taste-show-collection.service';
import type { JobContext } from '../jobs/jobs.types';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { type RadarrMovie, RadarrService } from '../radarr/radarr.service';
import { SettingsService } from '../settings/settings.service';
import { type SonarrSeries, SonarrService } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { WatchedCollectionsRefresherService } from '../watched-movie-recommendations/watched-collections-refresher.service';

type ListMode = 'pendingApproval' | 'review';
type WatchedCollectionKind = 'recentlyWatched' | 'changeOfTaste';

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
    const n = Number.parseInt(v.trim(), 10);
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

function posterUrlFromPath(pathRaw: string | null): string | null {
  const p = (pathRaw ?? '').trim();
  if (!p) return null;
  const normalized = p.startsWith('/') ? p : `/${p}`;
  return `https://image.tmdb.org/t/p/w500${normalized}`;
}

function watchedCollectionName(params: {
  mediaType: 'movie' | 'tv';
  kind: WatchedCollectionKind;
}): string {
  if (params.kind === 'changeOfTaste') return 'Change of Taste';
  return params.mediaType === 'movie'
    ? 'Based on your recently watched movie'
    : 'Based on your recently watched show';
}

@Injectable()
export class ObservatoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexCurated: PlexCuratedCollectionsService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly tmdb: TmdbService,
    private readonly immaculateMovies: ImmaculateTasteCollectionService,
    private readonly immaculateTv: ImmaculateTasteShowCollectionService,
    private readonly watchedRefresher: WatchedCollectionsRefresherService,
  ) {}

  async listMovies(params: {
    userId: string;
    librarySectionKey: string;
    mode: ListMode;
  }) {
    const { settings, secrets } = await this.settings.getInternalSettings(
      params.userId,
    );
    const tmdbApiKey = pickString(secrets, 'tmdb.apiKey');

    const rows = await this.prisma.immaculateTasteMovieLibrary.findMany({
      where:
        params.mode === 'pendingApproval'
          ? {
              librarySectionKey: params.librarySectionKey,
              status: 'pending',
              downloadApproval: 'pending',
            }
          : {
              librarySectionKey: params.librarySectionKey,
              downloadApproval: { not: 'rejected' },
            },
      orderBy:
        params.mode === 'pendingApproval'
          ? [{ updatedAt: 'desc' }]
          : [{ points: 'desc' }, { updatedAt: 'desc' }],
      take: 300,
    });

    // Best-effort: backfill poster paths for a small subset.
    if (tmdbApiKey) {
      const missing = rows.filter((r) => !r.tmdbPosterPath).slice(0, 20);
      await Promise.all(
        missing.map(async (r) => {
          const details = await this.tmdb
            .getMovie({ apiKey: tmdbApiKey, tmdbId: r.tmdbId })
            .catch(() => null);
          const posterPath =
            typeof (details as any)?.poster_path === 'string'
              ? String((details as any).poster_path)
              : null;
          if (!posterPath) return;
          await this.prisma.immaculateTasteMovieLibrary
            .update({
              where: {
                librarySectionKey_tmdbId: {
                  librarySectionKey: params.librarySectionKey,
                  tmdbId: r.tmdbId,
                },
              },
              data: { tmdbPosterPath: posterPath },
            })
            .catch(() => null);
        }),
      );
    }

    // Re-read poster paths for the ones we might have updated.
    const out = await this.prisma.immaculateTasteMovieLibrary.findMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        tmdbId: { in: rows.map((r) => r.tmdbId) },
        ...(params.mode === 'pendingApproval'
          ? { status: 'pending', downloadApproval: 'pending' }
          : { downloadApproval: { not: 'rejected' } }),
      },
      select: {
        tmdbId: true,
        title: true,
        status: true,
        points: true,
        tmdbVoteAvg: true,
        downloadApproval: true,
        sentToRadarrAt: true,
        tmdbPosterPath: true,
      },
      orderBy:
        params.mode === 'pendingApproval'
          ? [{ sentToRadarrAt: 'desc' }, { tmdbId: 'desc' }]
          : [{ points: 'desc' }, { tmdbId: 'desc' }],
    });

    return {
      ok: true,
      mode: params.mode,
      items: out.map((r) => ({
        id: r.tmdbId,
        mediaType: 'movie' as const,
        title: r.title ?? null,
        status: r.status,
        points: r.points,
        tmdbVoteAvg:
          typeof r.tmdbVoteAvg === 'number' && Number.isFinite(r.tmdbVoteAvg)
            ? Number(r.tmdbVoteAvg)
            : null,
        downloadApproval: r.downloadApproval,
        sentToRadarrAt: r.sentToRadarrAt?.toISOString() ?? null,
        posterUrl: posterUrlFromPath(r.tmdbPosterPath ?? null),
      })),
      approvalRequiredFromObservatory:
        (pickBool(settings, 'jobs.immaculateTastePoints.approvalRequiredFromObservatory') ??
          false) === true,
    };
  }

  async listTv(params: { userId: string; librarySectionKey: string; mode: ListMode }) {
    const { settings, secrets } = await this.settings.getInternalSettings(
      params.userId,
    );
    const tmdbApiKey = pickString(secrets, 'tmdb.apiKey');

    const rows = await this.prisma.immaculateTasteShowLibrary.findMany({
      where:
        params.mode === 'pendingApproval'
          ? {
              librarySectionKey: params.librarySectionKey,
              status: 'pending',
              downloadApproval: 'pending',
            }
          : {
              librarySectionKey: params.librarySectionKey,
              downloadApproval: { not: 'rejected' },
            },
      orderBy:
        params.mode === 'pendingApproval'
          ? [{ updatedAt: 'desc' }]
          : [{ points: 'desc' }, { updatedAt: 'desc' }],
      take: 300,
    });

    if (tmdbApiKey) {
      const missing = rows.filter((r) => !r.tmdbPosterPath && r.tmdbId).slice(0, 20);
      await Promise.all(
        missing.map(async (r) => {
          const tmdbId = typeof r.tmdbId === 'number' ? r.tmdbId : null;
          if (!tmdbId) return;
          const details = await this.tmdb
            .getTv({ apiKey: tmdbApiKey, tmdbId })
            .catch(() => null);
          const posterPath =
            typeof (details as any)?.poster_path === 'string'
              ? String((details as any).poster_path)
              : null;
          if (!posterPath) return;
          await this.prisma.immaculateTasteShowLibrary
            .update({
              where: {
                librarySectionKey_tvdbId: {
                  librarySectionKey: params.librarySectionKey,
                  tvdbId: r.tvdbId,
                },
              },
              data: { tmdbPosterPath: posterPath },
            })
            .catch(() => null);
        }),
      );
    }

    const out = await this.prisma.immaculateTasteShowLibrary.findMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        tvdbId: { in: rows.map((r) => r.tvdbId) },
        ...(params.mode === 'pendingApproval'
          ? { status: 'pending', downloadApproval: 'pending' }
          : { downloadApproval: { not: 'rejected' } }),
      },
      select: {
        tvdbId: true,
        tmdbId: true,
        title: true,
        status: true,
        points: true,
        tmdbVoteAvg: true,
        downloadApproval: true,
        sentToSonarrAt: true,
        tmdbPosterPath: true,
      },
      orderBy:
        params.mode === 'pendingApproval'
          ? [{ sentToSonarrAt: 'desc' }, { tvdbId: 'desc' }]
          : [{ points: 'desc' }, { tvdbId: 'desc' }],
    });

    return {
      ok: true,
      mode: params.mode,
      items: out.map((r) => ({
        id: r.tvdbId,
        mediaType: 'tv' as const,
        tmdbId: r.tmdbId ?? null,
        title: r.title ?? null,
        status: r.status,
        points: r.points,
        tmdbVoteAvg:
          typeof r.tmdbVoteAvg === 'number' && Number.isFinite(r.tmdbVoteAvg)
            ? Number(r.tmdbVoteAvg)
            : null,
        downloadApproval: r.downloadApproval,
        sentToSonarrAt: r.sentToSonarrAt?.toISOString() ?? null,
        posterUrl: posterUrlFromPath(r.tmdbPosterPath ?? null),
      })),
      approvalRequiredFromObservatory:
        (pickBool(settings, 'jobs.immaculateTastePoints.approvalRequiredFromObservatory') ??
          false) === true,
    };
  }

  async listWatchedMovies(params: {
    userId: string;
    librarySectionKey: string;
    mode: ListMode;
    collectionKind: WatchedCollectionKind;
  }) {
    const { settings, secrets } = await this.settings.getInternalSettings(
      params.userId,
    );
    const tmdbApiKey = pickString(secrets, 'tmdb.apiKey');
    const collectionName = watchedCollectionName({
      mediaType: 'movie',
      kind: params.collectionKind,
    });

    const rows = await this.prisma.watchedMovieRecommendationLibrary.findMany({
      where:
        params.mode === 'pendingApproval'
          ? {
              librarySectionKey: params.librarySectionKey,
              collectionName,
              status: 'pending',
              downloadApproval: 'pending',
            }
          : {
              librarySectionKey: params.librarySectionKey,
              collectionName,
              downloadApproval: { not: 'rejected' },
            },
      orderBy:
        params.mode === 'pendingApproval'
          ? [{ updatedAt: 'desc' }]
          : [{ tmdbVoteAvg: 'desc' }, { updatedAt: 'desc' }],
      take: 300,
    });

    // Best-effort: backfill poster paths for a small subset.
    if (tmdbApiKey) {
      const missing = rows.filter((r) => !r.tmdbPosterPath).slice(0, 20);
      await Promise.all(
        missing.map(async (r) => {
          const details = await this.tmdb
            .getMovie({ apiKey: tmdbApiKey, tmdbId: r.tmdbId })
            .catch(() => null);
          const posterPath =
            typeof (details as any)?.poster_path === 'string'
              ? String((details as any).poster_path)
              : null;
          if (!posterPath) return;
          await this.prisma.watchedMovieRecommendationLibrary
            .update({
              where: {
                collectionName_librarySectionKey_tmdbId: {
                  collectionName,
                  librarySectionKey: params.librarySectionKey,
                  tmdbId: r.tmdbId,
                },
              },
              data: { tmdbPosterPath: posterPath },
            })
            .catch(() => null);
        }),
      );
    }

    const out = await this.prisma.watchedMovieRecommendationLibrary.findMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        collectionName,
        tmdbId: { in: rows.map((r) => r.tmdbId) },
        ...(params.mode === 'pendingApproval'
          ? { status: 'pending', downloadApproval: 'pending' }
          : { downloadApproval: { not: 'rejected' } }),
      },
      select: {
        tmdbId: true,
        title: true,
        status: true,
        tmdbVoteAvg: true,
        downloadApproval: true,
        sentToRadarrAt: true,
        tmdbPosterPath: true,
      },
      orderBy:
        params.mode === 'pendingApproval'
          ? [{ sentToRadarrAt: 'desc' }, { tmdbId: 'desc' }]
          : [{ tmdbVoteAvg: 'desc' }, { tmdbId: 'desc' }],
    });

    return {
      ok: true,
      mode: params.mode,
      collectionKind: params.collectionKind,
      items: out.map((r) => ({
        id: r.tmdbId,
        mediaType: 'movie' as const,
        title: r.title ?? null,
        status: r.status,
        points: 0,
        tmdbVoteAvg:
          typeof r.tmdbVoteAvg === 'number' && Number.isFinite(r.tmdbVoteAvg)
            ? Number(r.tmdbVoteAvg)
            : null,
        downloadApproval: r.downloadApproval,
        sentToRadarrAt: r.sentToRadarrAt?.toISOString() ?? null,
        posterUrl: posterUrlFromPath(r.tmdbPosterPath ?? null),
      })),
      approvalRequiredFromObservatory:
        (pickBool(
          settings,
          'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory',
        ) ??
          false) === true,
    };
  }

  async listWatchedTv(params: {
    userId: string;
    librarySectionKey: string;
    mode: ListMode;
    collectionKind: WatchedCollectionKind;
  }) {
    const { settings, secrets } = await this.settings.getInternalSettings(
      params.userId,
    );
    const tmdbApiKey = pickString(secrets, 'tmdb.apiKey');
    const collectionName = watchedCollectionName({
      mediaType: 'tv',
      kind: params.collectionKind,
    });

    const rows = await this.prisma.watchedShowRecommendationLibrary.findMany({
      where:
        params.mode === 'pendingApproval'
          ? {
              librarySectionKey: params.librarySectionKey,
              collectionName,
              status: 'pending',
              downloadApproval: 'pending',
            }
          : {
              librarySectionKey: params.librarySectionKey,
              collectionName,
              downloadApproval: { not: 'rejected' },
            },
      orderBy:
        params.mode === 'pendingApproval'
          ? [{ updatedAt: 'desc' }]
          : [{ tmdbVoteAvg: 'desc' }, { updatedAt: 'desc' }],
      take: 300,
    });

    if (tmdbApiKey) {
      const missing = rows
        .filter((r) => !r.tmdbPosterPath && r.tmdbId)
        .slice(0, 20);
      await Promise.all(
        missing.map(async (r) => {
          const tmdbId = typeof r.tmdbId === 'number' ? r.tmdbId : null;
          if (!tmdbId) return;
          const details = await this.tmdb
            .getTv({ apiKey: tmdbApiKey, tmdbId })
            .catch(() => null);
          const posterPath =
            typeof (details as any)?.poster_path === 'string'
              ? String((details as any).poster_path)
              : null;
          if (!posterPath) return;
          await this.prisma.watchedShowRecommendationLibrary
            .update({
              where: {
                collectionName_librarySectionKey_tvdbId: {
                  collectionName,
                  librarySectionKey: params.librarySectionKey,
                  tvdbId: r.tvdbId,
                },
              },
              data: { tmdbPosterPath: posterPath },
            })
            .catch(() => null);
        }),
      );
    }

    const out = await this.prisma.watchedShowRecommendationLibrary.findMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        collectionName,
        tvdbId: { in: rows.map((r) => r.tvdbId) },
        ...(params.mode === 'pendingApproval'
          ? { status: 'pending', downloadApproval: 'pending' }
          : { downloadApproval: { not: 'rejected' } }),
      },
      select: {
        tvdbId: true,
        tmdbId: true,
        title: true,
        status: true,
        tmdbVoteAvg: true,
        downloadApproval: true,
        sentToSonarrAt: true,
        tmdbPosterPath: true,
      },
      orderBy:
        params.mode === 'pendingApproval'
          ? [{ sentToSonarrAt: 'desc' }, { tvdbId: 'desc' }]
          : [{ tmdbVoteAvg: 'desc' }, { tvdbId: 'desc' }],
    });

    return {
      ok: true,
      mode: params.mode,
      collectionKind: params.collectionKind,
      items: out.map((r) => ({
        id: r.tvdbId,
        mediaType: 'tv' as const,
        tmdbId: r.tmdbId ?? null,
        title: r.title ?? null,
        status: r.status,
        points: 0,
        tmdbVoteAvg:
          typeof r.tmdbVoteAvg === 'number' && Number.isFinite(r.tmdbVoteAvg)
            ? Number(r.tmdbVoteAvg)
            : null,
        downloadApproval: r.downloadApproval,
        sentToSonarrAt: r.sentToSonarrAt?.toISOString() ?? null,
        posterUrl: posterUrlFromPath(r.tmdbPosterPath ?? null),
      })),
      approvalRequiredFromObservatory:
        (pickBool(
          settings,
          'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory',
        ) ??
          false) === true,
    };
  }

  async recordDecisions(params: {
    userId: string;
    librarySectionKey: string;
    mediaType: 'movie' | 'tv';
    decisions: unknown[];
  }) {
    // Save-only: no side effects here.
    let applied = 0;
    let ignored = 0;

    const actions = params.decisions
      .map((d) => (isPlainObject(d) ? d : null))
      .filter((d): d is Record<string, unknown> => Boolean(d))
      .map((d) => ({
        id: typeof d.id === 'number' ? Math.trunc(d.id) : Number(d.id),
        action: typeof d.action === 'string' ? d.action.trim() : '',
      }))
      .filter((d) => Number.isFinite(d.id) && d.id > 0 && Boolean(d.action));

    for (const a of actions) {
      const action = a.action;
      const isApprove = action === 'approve';
      const isReject = action === 'reject' || action === 'remove';
      const isKeep = action === 'keep';
      const isUndo = action === 'undo';

      if (!isApprove && !isReject && !isKeep && !isUndo) {
        ignored += 1;
        continue;
      }

      const nextApproval: DownloadApprovalStatus | null = isApprove
        ? 'approved'
        : isReject
          ? 'rejected'
          : null;

      try {
        if (params.mediaType === 'movie') {
          if (isUndo) {
            const row = await this.prisma.immaculateTasteMovieLibrary
              .findUnique({
                where: {
                  librarySectionKey_tmdbId: {
                    librarySectionKey: params.librarySectionKey,
                    tmdbId: a.id,
                  },
                },
                select: { status: true, downloadApproval: true },
              })
              .catch(() => null);
            if (!row) {
              ignored += 1;
              continue;
            }
            const restored: DownloadApprovalStatus =
              row.status === 'pending' ? 'pending' : 'none';
            await this.prisma.immaculateTasteMovieLibrary.update({
              where: {
                librarySectionKey_tmdbId: {
                  librarySectionKey: params.librarySectionKey,
                  tmdbId: a.id,
                },
              },
              data: { downloadApproval: restored },
            });
            if (row.downloadApproval === 'rejected') {
              await this.prisma.rejectedSuggestion
                .delete({
                  where: {
                    userId_mediaType_externalSource_externalId: {
                      userId: params.userId,
                      mediaType: 'movie',
                      externalSource: 'tmdb',
                      externalId: String(a.id),
                    },
                  },
                })
                .catch(() => undefined);
            }
            applied += 1;
            continue;
          }

          if (!nextApproval) {
            applied += 1;
            continue;
          }
          const updated = await this.prisma.immaculateTasteMovieLibrary.update({
            where: {
              librarySectionKey_tmdbId: {
                librarySectionKey: params.librarySectionKey,
                tmdbId: a.id,
              },
            },
            data: { downloadApproval: nextApproval },
            select: { title: true },
          });
          if (isReject) {
            await this.prisma.rejectedSuggestion
              .upsert({
                where: {
                  userId_mediaType_externalSource_externalId: {
                    userId: params.userId,
                    mediaType: 'movie',
                    externalSource: 'tmdb',
                    externalId: String(a.id),
                  },
                },
                create: {
                  userId: params.userId,
                  mediaType: 'movie',
                  externalSource: 'tmdb',
                  externalId: String(a.id),
                  source: 'immaculate',
                  reason: action === 'remove' ? 'remove' : 'reject',
                },
                update: {
                  source: 'immaculate',
                  reason: action === 'remove' ? 'remove' : 'reject',
                },
              })
              .catch(() => undefined);
          } else if (nextApproval === 'approved') {
            // If a title is later approved, it should be allowed to show up again.
            await this.prisma.rejectedSuggestion
              .delete({
                where: {
                  userId_mediaType_externalSource_externalId: {
                    userId: params.userId,
                    mediaType: 'movie',
                    externalSource: 'tmdb',
                    externalId: String(a.id),
                  },
                },
              })
              .catch(() => undefined);
          }
          applied += 1;
        } else {
          if (isUndo) {
            const row = await this.prisma.immaculateTasteShowLibrary
              .findUnique({
                where: {
                  librarySectionKey_tvdbId: {
                    librarySectionKey: params.librarySectionKey,
                    tvdbId: a.id,
                  },
                },
                select: { status: true, downloadApproval: true },
              })
              .catch(() => null);
            if (!row) {
              ignored += 1;
              continue;
            }
            const restored: DownloadApprovalStatus =
              row.status === 'pending' ? 'pending' : 'none';
            await this.prisma.immaculateTasteShowLibrary.update({
              where: {
                librarySectionKey_tvdbId: {
                  librarySectionKey: params.librarySectionKey,
                  tvdbId: a.id,
                },
              },
              data: { downloadApproval: restored },
            });
            if (row.downloadApproval === 'rejected') {
              await this.prisma.rejectedSuggestion
                .delete({
                  where: {
                    userId_mediaType_externalSource_externalId: {
                      userId: params.userId,
                      mediaType: 'tv',
                      externalSource: 'tvdb',
                      externalId: String(a.id),
                    },
                  },
                })
                .catch(() => undefined);
            }
            applied += 1;
            continue;
          }

          if (!nextApproval) {
            applied += 1;
            continue;
          }
          await this.prisma.immaculateTasteShowLibrary.update({
            where: {
              librarySectionKey_tvdbId: {
                librarySectionKey: params.librarySectionKey,
                tvdbId: a.id,
              },
            },
            data: { downloadApproval: nextApproval },
          });
          if (isReject) {
            await this.prisma.rejectedSuggestion
              .upsert({
                where: {
                  userId_mediaType_externalSource_externalId: {
                    userId: params.userId,
                    mediaType: 'tv',
                    externalSource: 'tvdb',
                    externalId: String(a.id),
                  },
                },
                create: {
                  userId: params.userId,
                  mediaType: 'tv',
                  externalSource: 'tvdb',
                  externalId: String(a.id),
                  source: 'immaculate',
                  reason: action === 'remove' ? 'remove' : 'reject',
                },
                update: {
                  source: 'immaculate',
                  reason: action === 'remove' ? 'remove' : 'reject',
                },
              })
              .catch(() => undefined);
          } else if (nextApproval === 'approved') {
            await this.prisma.rejectedSuggestion
              .delete({
                where: {
                  userId_mediaType_externalSource_externalId: {
                    userId: params.userId,
                    mediaType: 'tv',
                    externalSource: 'tvdb',
                    externalId: String(a.id),
                  },
                },
              })
              .catch(() => undefined);
          }
          applied += 1;
        }
      } catch {
        ignored += 1;
      }
    }

    return { ok: true, applied, ignored };
  }

  async recordWatchedDecisions(params: {
    userId: string;
    librarySectionKey: string;
    mediaType: 'movie' | 'tv';
    collectionKind: WatchedCollectionKind;
    decisions: unknown[];
  }) {
    const { librarySectionKey, mediaType } = params;
    const collectionName = watchedCollectionName({
      mediaType,
      kind: params.collectionKind,
    });

    let applied = 0;
    let ignored = 0;

    for (const raw of params.decisions) {
      try {
        const obj = isPlainObject(raw) ? raw : null;
        const idRaw = obj ? obj['id'] : null;
        const actionRaw = obj ? obj['action'] : null;

        const id =
          typeof idRaw === 'number' && Number.isFinite(idRaw)
            ? Math.trunc(idRaw)
            : null;
        const action =
          typeof actionRaw === 'string' ? actionRaw.trim().toLowerCase() : '';

        if (!id || id <= 0) {
          ignored += 1;
          continue;
        }

        const isUndo = action === 'undo';
        const nextApproval: DownloadApprovalStatus | null =
          action === 'approve'
            ? 'approved'
            : action === 'reject' || action === 'remove'
              ? 'rejected'
              : null; // keep/no-op

        if (mediaType === 'movie') {
          if (isUndo) {
            const row = await this.prisma.watchedMovieRecommendationLibrary
              .findUnique({
                where: {
                  collectionName_librarySectionKey_tmdbId: {
                    collectionName,
                    librarySectionKey,
                    tmdbId: id,
                  },
                },
                select: { status: true, downloadApproval: true },
              })
              .catch(() => null);
            if (!row) {
              ignored += 1;
              continue;
            }
            const restored: DownloadApprovalStatus =
              row.status === 'pending' ? 'pending' : 'none';
            await this.prisma.watchedMovieRecommendationLibrary.update({
              where: {
                collectionName_librarySectionKey_tmdbId: {
                  collectionName,
                  librarySectionKey,
                  tmdbId: id,
                },
              },
              data: { downloadApproval: restored },
            });
            if (row.downloadApproval === 'rejected') {
              await this.prisma.rejectedSuggestion
                .delete({
                  where: {
                    userId_mediaType_externalSource_externalId: {
                      userId: params.userId,
                      mediaType: 'movie',
                      externalSource: 'tmdb',
                      externalId: String(id),
                    },
                  },
                })
                .catch(() => undefined);
            }
            applied += 1;
            continue;
          }

          if (!nextApproval) {
            applied += 1;
            continue;
          }

          await this.prisma.watchedMovieRecommendationLibrary.update({
            where: {
              collectionName_librarySectionKey_tmdbId: {
                collectionName,
                librarySectionKey,
                tmdbId: id,
              },
            },
            data: { downloadApproval: nextApproval },
          });
          if (nextApproval === 'rejected') {
            await this.prisma.rejectedSuggestion
              .upsert({
                where: {
                  userId_mediaType_externalSource_externalId: {
                    userId: params.userId,
                    mediaType: 'movie',
                    externalSource: 'tmdb',
                    externalId: String(id),
                  },
                },
                create: {
                  userId: params.userId,
                  mediaType: 'movie',
                  externalSource: 'tmdb',
                  externalId: String(id),
                  source: 'watched',
                  reason: action === 'remove' ? 'remove' : 'reject',
                },
                update: {
                  source: 'watched',
                  reason: action === 'remove' ? 'remove' : 'reject',
                },
              })
              .catch(() => undefined);
          } else if (nextApproval === 'approved') {
            await this.prisma.rejectedSuggestion
              .delete({
                where: {
                  userId_mediaType_externalSource_externalId: {
                    userId: params.userId,
                    mediaType: 'movie',
                    externalSource: 'tmdb',
                    externalId: String(id),
                  },
                },
              })
              .catch(() => undefined);
          }
          applied += 1;
        } else {
          if (isUndo) {
            const row = await this.prisma.watchedShowRecommendationLibrary
              .findUnique({
                where: {
                  collectionName_librarySectionKey_tvdbId: {
                    collectionName,
                    librarySectionKey,
                    tvdbId: id,
                  },
                },
                select: { status: true, downloadApproval: true },
              })
              .catch(() => null);
            if (!row) {
              ignored += 1;
              continue;
            }
            const restored: DownloadApprovalStatus =
              row.status === 'pending' ? 'pending' : 'none';
            await this.prisma.watchedShowRecommendationLibrary.update({
              where: {
                collectionName_librarySectionKey_tvdbId: {
                  collectionName,
                  librarySectionKey,
                  tvdbId: id,
                },
              },
              data: { downloadApproval: restored },
            });
            if (row.downloadApproval === 'rejected') {
              await this.prisma.rejectedSuggestion
                .delete({
                  where: {
                    userId_mediaType_externalSource_externalId: {
                      userId: params.userId,
                      mediaType: 'tv',
                      externalSource: 'tvdb',
                      externalId: String(id),
                    },
                  },
                })
                .catch(() => undefined);
            }
            applied += 1;
            continue;
          }

          if (!nextApproval) {
            applied += 1;
            continue;
          }

          await this.prisma.watchedShowRecommendationLibrary.update({
            where: {
              collectionName_librarySectionKey_tvdbId: {
                collectionName,
                librarySectionKey,
                tvdbId: id,
              },
            },
            data: { downloadApproval: nextApproval },
          });
          if (nextApproval === 'rejected') {
            await this.prisma.rejectedSuggestion
              .upsert({
                where: {
                  userId_mediaType_externalSource_externalId: {
                    userId: params.userId,
                    mediaType: 'tv',
                    externalSource: 'tvdb',
                    externalId: String(id),
                  },
                },
                create: {
                  userId: params.userId,
                  mediaType: 'tv',
                  externalSource: 'tvdb',
                  externalId: String(id),
                  source: 'watched',
                  reason: action === 'remove' ? 'remove' : 'reject',
                },
                update: {
                  source: 'watched',
                  reason: action === 'remove' ? 'remove' : 'reject',
                },
              })
              .catch(() => undefined);
          } else if (nextApproval === 'approved') {
            await this.prisma.rejectedSuggestion
              .delete({
                where: {
                  userId_mediaType_externalSource_externalId: {
                    userId: params.userId,
                    mediaType: 'tv',
                    externalSource: 'tvdb',
                    externalId: String(id),
                  },
                },
              })
              .catch(() => undefined);
          }
          applied += 1;
        }
      } catch {
        ignored += 1;
      }
    }

    return { ok: true, applied, ignored };
  }

  async applyWatched(params: {
    userId: string;
    librarySectionKey: string;
    mediaType: 'movie' | 'tv';
  }) {
    const { settings, secrets } = await this.settings.getInternalSettings(
      params.userId,
    );

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new BadGatewayException('Plex baseUrl is not set');
    if (!plexToken) throw new BadGatewayException('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const approvalRequired =
      (pickBool(
        settings,
        'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory',
      ) ??
        false) === true;

    const ctx: JobContext = {
      jobId: 'observatoryApplyWatched',
      runId: `observatory-watched-${Date.now()}`,
      userId: params.userId,
      dryRun: false,
      trigger: 'manual',
      input: {},
      getSummary: () => null,
      setSummary: async () => undefined,
      patchSummary: async () => undefined,
      log: async () => undefined,
      debug: async () => undefined,
      info: async () => undefined,
      warn: async () => undefined,
      error: async () => undefined,
    };

    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });

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

    const collectionNames =
      params.mediaType === 'movie'
        ? ['Based on your recently watched movie', 'Change of Taste']
        : ['Based on your recently watched show', 'Change of Taste'];

    const collectionLimitRaw =
      pickNumber(settings, 'recommendations.collectionLimit') ?? 15;
    const limit = Math.max(
      1,
      Math.min(
        200,
        Math.trunc(Number.isFinite(collectionLimitRaw) ? collectionLimitRaw : 15) ||
          15,
      ),
    );

    if (params.mediaType === 'movie') {
      const radarrBaseUrlRaw = pickString(settings, 'radarr.baseUrl');
      const radarrApiKey = pickString(secrets, 'radarr.apiKey');
      const fetchMissingRadarr =
        pickBool(settings, 'jobs.watchedMovieRecommendations.fetchMissing.radarr') ??
        true;
      const radarrEnabled =
        fetchMissingRadarr &&
        (pickBool(settings, 'radarr.enabled') ?? Boolean(radarrApiKey)) &&
        Boolean(radarrBaseUrlRaw) &&
        Boolean(radarrApiKey);
      const radarrBaseUrl = radarrEnabled ? normalizeHttpUrl(radarrBaseUrlRaw) : '';

      const rejected = await this.prisma.watchedMovieRecommendationLibrary.findMany({
        where: {
          librarySectionKey: params.librarySectionKey,
          collectionName: { in: collectionNames },
          downloadApproval: 'rejected',
        },
        select: { tmdbId: true, sentToRadarrAt: true },
        take: 2000,
      });

      const approved = approvalRequired
        ? await this.prisma.watchedMovieRecommendationLibrary.findMany({
            where: {
              librarySectionKey: params.librarySectionKey,
              collectionName: { in: collectionNames },
              status: 'pending',
              downloadApproval: 'approved',
            },
            select: { tmdbId: true, title: true, sentToRadarrAt: true },
            take: 2000,
          })
        : [];

      // Unmonitor rejected movies that we previously requested in Radarr.
      let unmonitored = 0;
      if (radarrEnabled && rejected.some((r) => Boolean(r.sentToRadarrAt))) {
        const movies = await this.radarr.listMovies({
          baseUrl: radarrBaseUrl,
          apiKey: radarrApiKey,
        });
        const byTmdb = new Map<number, RadarrMovie>();
        for (const m of movies) {
          const tmdbId =
            typeof (m as any).tmdbId === 'number'
              ? (m as any).tmdbId
              : Number((m as any).tmdbId);
          if (Number.isFinite(tmdbId) && tmdbId > 0)
            byTmdb.set(Math.trunc(tmdbId), m as any);
        }

        for (const r of rejected) {
          if (!r.sentToRadarrAt) continue;
          const movie = byTmdb.get(r.tmdbId) ?? null;
          if (!movie) continue;
          await this.radarr
            .setMovieMonitored({
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
              movie: movie as any,
              monitored: false,
            })
            .catch(() => undefined);
          unmonitored += 1;
        }
      }

      // Add approved movies to Radarr (only when approvalRequired is enabled).
      let sent = 0;
      if (approvalRequired && radarrEnabled && approved.length) {
        const defaults = await this.resolveRadarrDefaults({
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
            const v = pickNumber(settings, 'radarr.defaultTagId') ?? pickNumber(settings, 'radarr.tagId');
            return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
          })(),
        });

        for (const r of approved) {
          if (r.sentToRadarrAt) continue;
          const title = r.title ?? `tmdb:${r.tmdbId}`;
          const result = await this.radarr
            .addMovie({
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
              title,
              tmdbId: r.tmdbId,
              year: null,
              qualityProfileId: defaults.qualityProfileId,
              rootFolderPath: defaults.rootFolderPath,
              tags: defaults.tagIds,
              monitored: true,
              minimumAvailability: 'announced',
              searchForMovie: true,
            })
            .catch(() => null);
          if (!result) continue;
          await this.prisma.watchedMovieRecommendationLibrary
            .updateMany({
              where: {
                librarySectionKey: params.librarySectionKey,
                collectionName: { in: collectionNames },
                tmdbId: r.tmdbId,
              },
              data: { sentToRadarrAt: new Date(), downloadApproval: 'none' },
            })
            .catch(() => undefined);
          sent += 1;
        }
      }

      // Remove rejected items from the dataset.
      await this.prisma.watchedMovieRecommendationLibrary.deleteMany({
        where: {
          librarySectionKey: params.librarySectionKey,
          collectionName: { in: collectionNames },
          downloadApproval: 'rejected',
        },
      });

      const refresh = await this.watchedRefresher.refresh({
        ctx,
        plexBaseUrl,
        plexToken,
        machineIdentifier,
        movieSections,
        tvSections: [],
        limit,
        scope: { librarySectionKey: params.librarySectionKey, mode: 'movie' },
      });

      return { ok: true, approvalRequired, unmonitored, sent, refresh };
    }

    // TV
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
    const sonarrBaseUrl = sonarrEnabled ? normalizeHttpUrl(sonarrBaseUrlRaw) : '';

    const rejected = await this.prisma.watchedShowRecommendationLibrary.findMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        collectionName: { in: collectionNames },
        downloadApproval: 'rejected',
      },
      select: { tvdbId: true, sentToSonarrAt: true },
      take: 2000,
    });

    const approved = approvalRequired
      ? await this.prisma.watchedShowRecommendationLibrary.findMany({
          where: {
            librarySectionKey: params.librarySectionKey,
            collectionName: { in: collectionNames },
            status: 'pending',
            downloadApproval: 'approved',
          },
          select: { tvdbId: true, title: true, sentToSonarrAt: true },
          take: 2000,
        })
      : [];

    let unmonitored = 0;
    if (sonarrEnabled && rejected.some((r) => Boolean(r.sentToSonarrAt))) {
      const series = await this.sonarr.listSeries({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
      });
      const byTvdb = new Map<number, SonarrSeries>();
      for (const s of series) {
        const tvdbId =
          typeof (s as any).tvdbId === 'number'
            ? (s as any).tvdbId
            : Number((s as any).tvdbId);
        if (Number.isFinite(tvdbId) && tvdbId > 0)
          byTvdb.set(Math.trunc(tvdbId), s as any);
      }

      for (const r of rejected) {
        if (!r.sentToSonarrAt) continue;
        const s = byTvdb.get(r.tvdbId) ?? null;
        if (!s) continue;
        await this.sonarr
          .updateSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
            series: { ...(s as any), monitored: false },
          })
          .catch(() => undefined);
        unmonitored += 1;
      }
    }

    let sent = 0;
    if (approvalRequired && sonarrEnabled && approved.length) {
      const defaults = await this.resolveSonarrDefaults({
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
          const v = pickNumber(settings, 'sonarr.defaultTagId') ?? pickNumber(settings, 'sonarr.tagId');
          return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
        })(),
      });

      for (const r of approved) {
        if (r.sentToSonarrAt) continue;
        const title = r.title ?? `tvdb:${r.tvdbId}`;
        const result = await this.sonarr
          .addSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
            title,
            tvdbId: r.tvdbId,
            qualityProfileId: defaults.qualityProfileId,
            rootFolderPath: defaults.rootFolderPath,
            tags: defaults.tagIds,
            monitored: true,
            searchForMissingEpisodes: true,
            searchForCutoffUnmetEpisodes: true,
          })
          .catch(() => null);
        if (!result) continue;
        await this.prisma.watchedShowRecommendationLibrary
          .updateMany({
            where: {
              librarySectionKey: params.librarySectionKey,
              collectionName: { in: collectionNames },
              tvdbId: r.tvdbId,
            },
            data: { sentToSonarrAt: new Date(), downloadApproval: 'none' },
          })
          .catch(() => undefined);
        sent += 1;
      }
    }

    await this.prisma.watchedShowRecommendationLibrary.deleteMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        collectionName: { in: collectionNames },
        downloadApproval: 'rejected',
      },
    });

    const refresh = await this.watchedRefresher.refresh({
      ctx,
      plexBaseUrl,
      plexToken,
      machineIdentifier,
      movieSections: [],
      tvSections,
      limit,
      scope: { librarySectionKey: params.librarySectionKey, mode: 'tv' },
    });

    return { ok: true, approvalRequired, unmonitored, sent, refresh };
  }

  async apply(params: { userId: string; librarySectionKey: string; mediaType: 'movie' | 'tv' }) {
    const { settings, secrets } = await this.settings.getInternalSettings(
      params.userId,
    );

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new BadGatewayException('Plex baseUrl is not set');
    if (!plexToken) throw new BadGatewayException('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const approvalRequired =
      (pickBool(settings, 'jobs.immaculateTastePoints.approvalRequiredFromObservatory') ??
        false) === true;

    // Treat this as an apply-style operation (no real JobRun persistence).
    const ctx: JobContext = {
      jobId: 'observatoryApply',
      runId: `observatory-${Date.now()}`,
      userId: params.userId,
      dryRun: false,
      trigger: 'manual',
      input: {},
      getSummary: () => null,
      setSummary: async () => undefined,
      patchSummary: async () => undefined,
      log: async () => undefined,
      debug: async () => undefined,
      info: async () => undefined,
      warn: async () => undefined,
      error: async () => undefined,
    };

    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });

    if (params.mediaType === 'movie') {
      return await this.applyMovies({
        ctx,
        settings,
        secrets,
        plexBaseUrl,
        plexToken,
        machineIdentifier,
        librarySectionKey: params.librarySectionKey,
        approvalRequired,
      });
    }

    return await this.applyTv({
      ctx,
      settings,
      secrets,
      plexBaseUrl,
      plexToken,
      machineIdentifier,
      librarySectionKey: params.librarySectionKey,
      approvalRequired,
    });
  }

  private async applyMovies(params: {
    ctx: JobContext;
    settings: Record<string, unknown>;
    secrets: Record<string, unknown>;
    plexBaseUrl: string;
    plexToken: string;
    machineIdentifier: string;
    librarySectionKey: string;
    approvalRequired: boolean;
  }) {
    const radarrBaseUrlRaw = pickString(params.settings, 'radarr.baseUrl');
    const radarrApiKey = pickString(params.secrets, 'radarr.apiKey');
    const fetchMissingRadarr =
      pickBool(params.settings, 'jobs.immaculateTastePoints.fetchMissing.radarr') ??
      true;
    const radarrEnabled =
      fetchMissingRadarr &&
      (pickBool(params.settings, 'radarr.enabled') ?? Boolean(radarrApiKey)) &&
      Boolean(radarrBaseUrlRaw) &&
      Boolean(radarrApiKey);
    const radarrBaseUrl = radarrEnabled ? normalizeHttpUrl(radarrBaseUrlRaw) : '';

    const startSearchImmediately =
      (pickBool(params.settings, 'jobs.immaculateTastePoints.searchImmediately') ??
        false) === true;

    const rejected = await this.prisma.immaculateTasteMovieLibrary.findMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        downloadApproval: 'rejected',
      },
      select: { tmdbId: true, sentToRadarrAt: true },
      take: 1000,
    });

    const approved = params.approvalRequired
      ? await this.prisma.immaculateTasteMovieLibrary.findMany({
          where: {
            librarySectionKey: params.librarySectionKey,
            status: 'pending',
            downloadApproval: 'approved',
          },
          select: { tmdbId: true, title: true, sentToRadarrAt: true },
          take: 1000,
        })
      : [];

    // --- ARR unmonitor for rejected items that we previously requested ---
    let unmonitored = 0;
    if (radarrEnabled && rejected.some((r) => Boolean(r.sentToRadarrAt))) {
      const movies = await this.radarr.listMovies({
        baseUrl: radarrBaseUrl,
        apiKey: radarrApiKey,
      });
      const byTmdb = new Map<number, RadarrMovie>();
      for (const m of movies) {
        const tmdbId =
          typeof (m as any).tmdbId === 'number'
            ? (m as any).tmdbId
            : Number((m as any).tmdbId);
        if (Number.isFinite(tmdbId) && tmdbId > 0) byTmdb.set(Math.trunc(tmdbId), m as any);
      }

      for (const r of rejected) {
        if (!r.sentToRadarrAt) continue;
        const movie = byTmdb.get(r.tmdbId) ?? null;
        if (!movie) continue;
        await this.radarr
          .setMovieMonitored({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
            movie: movie as any,
            monitored: false,
          })
          .catch(() => undefined);
        unmonitored += 1;
      }
    }

    // --- ARR add for approved items (only when approvalRequired is enabled) ---
    let sent = 0;
    if (params.approvalRequired && radarrEnabled && approved.length) {
      const defaults = await this.resolveRadarrDefaults({
        baseUrl: radarrBaseUrl,
        apiKey: radarrApiKey,
        preferredRootFolderPath:
          pickString(params.settings, 'radarr.defaultRootFolderPath') ||
          pickString(params.settings, 'radarr.rootFolderPath'),
        preferredQualityProfileId:
          Math.max(
            1,
            Math.trunc(
              pickNumber(params.settings, 'radarr.defaultQualityProfileId') ??
                pickNumber(params.settings, 'radarr.qualityProfileId') ??
                1,
            ),
          ) || 1,
        preferredTagId: (() => {
          const v =
            pickNumber(params.settings, 'radarr.defaultTagId') ??
            pickNumber(params.settings, 'radarr.tagId');
          return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
        })(),
      });

      for (const r of approved) {
        if (r.sentToRadarrAt) continue;
        const title = r.title ?? `tmdb:${r.tmdbId}`;
        const result = await this.radarr
          .addMovie({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
            title,
            tmdbId: r.tmdbId,
            year: null,
            qualityProfileId: defaults.qualityProfileId,
            rootFolderPath: defaults.rootFolderPath,
            tags: defaults.tagIds,
            monitored: true,
            minimumAvailability: 'announced',
            searchForMovie: startSearchImmediately,
          })
          .catch(() => null);

        if (!result) continue;
        sent += 1;
        await this.prisma.immaculateTasteMovieLibrary
          .update({
            where: {
              librarySectionKey_tmdbId: {
                librarySectionKey: params.librarySectionKey,
                tmdbId: r.tmdbId,
              },
            },
            data: { sentToRadarrAt: new Date() },
          })
          .catch(() => undefined);
      }
    }

    // --- Remove rejected rows from dataset ---
    const rejectedIds = rejected.map((r) => r.tmdbId);
    let removedRows = 0;
    if (rejectedIds.length) {
      const res = await this.prisma.immaculateTasteMovieLibrary.deleteMany({
        where: { librarySectionKey: params.librarySectionKey, tmdbId: { in: rejectedIds } },
      });
      removedRows = res.count;
    }

    // --- Rebuild Plex collection for this library (movies) ---
    const plexItems = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
      baseUrl: params.plexBaseUrl,
      token: params.plexToken,
      librarySectionKey: params.librarySectionKey,
    });
    const tmdbToItem = new Map<number, { ratingKey: string; title: string }>();
    for (const it of plexItems) {
      if (!it.tmdbId) continue;
      tmdbToItem.set(it.tmdbId, { ratingKey: it.ratingKey, title: it.title });
    }

    const activeRows = await this.immaculateMovies.getActiveMovies({
      librarySectionKey: params.librarySectionKey,
      minPoints: 1,
    });
    const orderedIds = this.immaculateMovies.buildThreeTierTmdbRatingShuffleOrder({
      movies: activeRows.map((m) => ({
        tmdbId: m.tmdbId,
        tmdbVoteAvg: m.tmdbVoteAvg ?? null,
        tmdbVoteCount: m.tmdbVoteCount ?? null,
      })),
    });
    const desiredItems = orderedIds
      .map((id) => tmdbToItem.get(id))
      .filter((v): v is { ratingKey: string; title: string } => Boolean(v));

    const plex = await this.plexCurated.rebuildMovieCollection({
      ctx: params.ctx,
      baseUrl: params.plexBaseUrl,
      token: params.plexToken,
      machineIdentifier: params.machineIdentifier,
      movieSectionKey: params.librarySectionKey,
      collectionName: 'Inspired by your Immaculate Taste',
      itemType: 1,
      desiredItems,
      randomizeOrder: false,
    });

    return {
      ok: true,
      mediaType: 'movie',
      librarySectionKey: params.librarySectionKey,
      approvalRequiredFromObservatory: params.approvalRequired,
      radarr: {
        enabled: radarrEnabled,
        sent,
        unmonitored,
      },
      dataset: { removed: removedRows },
      plex,
    };
  }

  private async applyTv(params: {
    ctx: JobContext;
    settings: Record<string, unknown>;
    secrets: Record<string, unknown>;
    plexBaseUrl: string;
    plexToken: string;
    machineIdentifier: string;
    librarySectionKey: string;
    approvalRequired: boolean;
  }) {
    const sonarrBaseUrlRaw = pickString(params.settings, 'sonarr.baseUrl');
    const sonarrApiKey = pickString(params.secrets, 'sonarr.apiKey');
    const fetchMissingSonarr =
      pickBool(params.settings, 'jobs.immaculateTastePoints.fetchMissing.sonarr') ??
      true;
    const sonarrEnabled =
      fetchMissingSonarr &&
      (pickBool(params.settings, 'sonarr.enabled') ?? Boolean(sonarrApiKey)) &&
      Boolean(sonarrBaseUrlRaw) &&
      Boolean(sonarrApiKey);
    const sonarrBaseUrl = sonarrEnabled ? normalizeHttpUrl(sonarrBaseUrlRaw) : '';

    const startSearchImmediately =
      (pickBool(params.settings, 'jobs.immaculateTastePoints.searchImmediately') ??
        false) === true;

    const rejected = await this.prisma.immaculateTasteShowLibrary.findMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        downloadApproval: 'rejected',
      },
      select: { tvdbId: true, sentToSonarrAt: true },
      take: 1000,
    });

    const approved = await this.prisma.immaculateTasteShowLibrary.findMany({
      where: {
        librarySectionKey: params.librarySectionKey,
        status: 'pending',
        downloadApproval: 'approved',
        ...(params.approvalRequired ? {} : { tvdbId: { equals: -1 } }),
      },
      select: { tvdbId: true, title: true, sentToSonarrAt: true },
      take: 1000,
    });

    let unmonitored = 0;
    if (sonarrEnabled && rejected.some((r) => Boolean(r.sentToSonarrAt))) {
      const series = await this.sonarr.listSeries({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
      });
      const byTvdb = new Map<number, SonarrSeries>();
      for (const s of series) {
        const tvdbId =
          typeof (s as any).tvdbId === 'number'
            ? (s as any).tvdbId
            : Number((s as any).tvdbId);
        if (Number.isFinite(tvdbId) && tvdbId > 0) byTvdb.set(Math.trunc(tvdbId), s as any);
      }

      for (const r of rejected) {
        if (!r.sentToSonarrAt) continue;
        const s = byTvdb.get(r.tvdbId) ?? null;
        if (!s) continue;
        if ((s as any).monitored === false) continue;
        await this.sonarr
          .updateSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
            series: { ...(s as any), monitored: false } as any,
          })
          .catch(() => undefined);
        unmonitored += 1;
      }
    }

    let sent = 0;
    if (params.approvalRequired && sonarrEnabled && approved.length) {
      const defaults = await this.resolveSonarrDefaults({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
        preferredRootFolderPath:
          pickString(params.settings, 'sonarr.defaultRootFolderPath') ||
          pickString(params.settings, 'sonarr.rootFolderPath'),
        preferredQualityProfileId:
          Math.max(
            1,
            Math.trunc(
              pickNumber(params.settings, 'sonarr.defaultQualityProfileId') ??
                pickNumber(params.settings, 'sonarr.qualityProfileId') ??
                1,
            ),
          ) || 1,
        preferredTagId: (() => {
          const v =
            pickNumber(params.settings, 'sonarr.defaultTagId') ??
            pickNumber(params.settings, 'sonarr.tagId');
          return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
        })(),
      });

      for (const r of approved) {
        if (r.sentToSonarrAt) continue;
        const title = r.title ?? `tvdb:${r.tvdbId}`;
        const result = await this.sonarr
          .addSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
            title,
            tvdbId: r.tvdbId,
            qualityProfileId: defaults.qualityProfileId,
            rootFolderPath: defaults.rootFolderPath,
            tags: defaults.tagIds,
            monitored: true,
            searchForMissingEpisodes: startSearchImmediately,
          })
          .catch(() => null);

        if (!result) continue;
        sent += 1;
        await this.prisma.immaculateTasteShowLibrary
          .update({
            where: {
              librarySectionKey_tvdbId: {
                librarySectionKey: params.librarySectionKey,
                tvdbId: r.tvdbId,
              },
            },
            data: { sentToSonarrAt: new Date() },
          })
          .catch(() => undefined);
      }
    }

    const rejectedIds = rejected.map((r) => r.tvdbId);
    let removedRows = 0;
    if (rejectedIds.length) {
      const res = await this.prisma.immaculateTasteShowLibrary.deleteMany({
        where: { librarySectionKey: params.librarySectionKey, tvdbId: { in: rejectedIds } },
      });
      removedRows = res.count;
    }

    // Rebuild Plex collection for this library (TV)
    const plexItems = await this.plexServer.listShowsWithTvdbIdsForSectionKey({
      baseUrl: params.plexBaseUrl,
      token: params.plexToken,
      librarySectionKey: params.librarySectionKey,
    });
    const tvdbToItem = new Map<number, { ratingKey: string; title: string }>();
    for (const it of plexItems) {
      if (!it.tvdbId) continue;
      tvdbToItem.set(it.tvdbId, { ratingKey: it.ratingKey, title: it.title });
    }

    const activeRows = await this.immaculateTv.getActiveShows({
      librarySectionKey: params.librarySectionKey,
      minPoints: 1,
    });
    const orderedIds = this.immaculateTv.buildThreeTierTmdbRatingShuffleOrder({
      shows: activeRows.map((s) => ({
        tvdbId: s.tvdbId,
        tmdbVoteAvg: s.tmdbVoteAvg ?? null,
        tmdbVoteCount: s.tmdbVoteCount ?? null,
      })),
    });
    const desiredItems = orderedIds
      .map((id) => tvdbToItem.get(id))
      .filter((v): v is { ratingKey: string; title: string } => Boolean(v));

    const plex = await this.plexCurated.rebuildMovieCollection({
      ctx: params.ctx,
      baseUrl: params.plexBaseUrl,
      token: params.plexToken,
      machineIdentifier: params.machineIdentifier,
      movieSectionKey: params.librarySectionKey,
      collectionName: 'Inspired by your Immaculate Taste',
      itemType: 2,
      desiredItems,
      randomizeOrder: false,
    });

    return {
      ok: true,
      mediaType: 'tv',
      librarySectionKey: params.librarySectionKey,
      approvalRequiredFromObservatory: params.approvalRequired,
      sonarr: {
        enabled: sonarrEnabled,
        sent,
        unmonitored,
      },
      dataset: { removed: removedRows },
      plex,
    };
  }

  private async resolveRadarrDefaults(params: {
    baseUrl: string;
    apiKey: string;
    preferredRootFolderPath: string;
    preferredQualityProfileId: number;
    preferredTagId: number | null;
  }) {
    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.radarr.listRootFolders({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
      this.radarr.listQualityProfiles({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
      this.radarr.listTags({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
    ]);
    if (!rootFolders.length) throw new BadGatewayException('Radarr has no root folders');
    if (!qualityProfiles.length) throw new BadGatewayException('Radarr has no quality profiles');

    const rootFolderPath =
      rootFolders.find((r) => r.path === params.preferredRootFolderPath)?.path ??
      rootFolders[0]!.path;
    const qualityProfileId =
      qualityProfiles.find((q) => q.id === params.preferredQualityProfileId)?.id ??
      qualityProfiles[0]!.id;

    const tagIds: number[] = [];
    if (params.preferredTagId) {
      const exists = tags.find((t) => t.id === params.preferredTagId);
      if (exists) tagIds.push(exists.id);
    }
    return { rootFolderPath, qualityProfileId, tagIds };
  }

  private async resolveSonarrDefaults(params: {
    baseUrl: string;
    apiKey: string;
    preferredRootFolderPath: string;
    preferredQualityProfileId: number;
    preferredTagId: number | null;
  }) {
    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.sonarr.listRootFolders({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
      this.sonarr.listQualityProfiles({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
      this.sonarr.listTags({ baseUrl: params.baseUrl, apiKey: params.apiKey }),
    ]);
    if (!rootFolders.length) throw new BadGatewayException('Sonarr has no root folders');
    if (!qualityProfiles.length) throw new BadGatewayException('Sonarr has no quality profiles');

    const rootFolderPath =
      rootFolders.find((r) => r.path === params.preferredRootFolderPath)?.path ??
      rootFolders[0]!.path;
    const qualityProfileId =
      qualityProfiles.find((q) => q.id === params.preferredQualityProfileId)?.id ??
      qualityProfiles[0]!.id;

    const tagIds: number[] = [];
    if (params.preferredTagId) {
      const exists = tags.find((t) => t.id === params.preferredTagId);
      if (exists) tagIds.push(exists.id);
    }
    return { rootFolderPath, qualityProfileId, tagIds };
  }
}

