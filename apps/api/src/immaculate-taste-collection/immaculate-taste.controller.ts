import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../db/prisma.service';
import {
  CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
  CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
  IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME,
  IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME,
  RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME,
  RECENTLY_WATCHED_SHOW_COLLECTION_BASE_NAME,
  buildImmaculateCollectionName,
  buildUserCollectionName,
  normalizeCollectionTitle,
} from '../plex/plex-collections.utils';
import { resolvePlexLibrarySelection } from '../plex/plex-library-selection.utils';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import { immaculateTasteResetMarkerKey } from './immaculate-taste-reset';

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

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new BadRequestException('Plex baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

function getImmaculateCollectionBaseName(mediaType: 'movie' | 'tv'): string {
  return mediaType === 'movie'
    ? IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME
    : IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME;
}

type ProfileCollectionResetRow = {
  id: string;
  isDefault: boolean;
  mediaType: string;
  movieCollectionBaseName: string | null;
  showCollectionBaseName: string | null;
  userOverrides: Array<{
    movieCollectionBaseName: string | null;
    showCollectionBaseName: string | null;
  }>;
};

function profileSupportsMediaType(
  profileMediaType: string,
  mediaType: 'movie' | 'tv',
): boolean {
  const normalized = String(profileMediaType ?? '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'both') return true;
  if (normalized !== 'movie' && normalized !== 'show') return true;
  if (mediaType === 'movie') return normalized === 'movie';
  return normalized === 'show';
}

function resolveProfileDatasetIdForCollectionReset(
  profile: ProfileCollectionResetRow,
): string {
  return profile.isDefault ? 'default' : profile.id;
}

function resolveProfileCollectionBaseNameForReset(params: {
  mediaType: 'movie' | 'tv';
  profile: ProfileCollectionResetRow;
}): string {
  const fallback = getImmaculateCollectionBaseName(params.mediaType);
  const override = params.profile.userOverrides[0] ?? null;
  const raw =
    params.mediaType === 'movie'
      ? (override?.movieCollectionBaseName ??
        params.profile.movieCollectionBaseName)
      : (override?.showCollectionBaseName ??
        params.profile.showCollectionBaseName);
  const normalized = String(raw ?? '').trim();
  return normalized || fallback;
}

function buildImmaculateCollectionLookupNamesForReset(params: {
  baseName: string;
  plexUserTitle: string;
}): string[] {
  const preferred = buildImmaculateCollectionName(
    params.baseName,
    params.plexUserTitle,
  ).trim();
  const legacy = buildUserCollectionName(
    params.baseName,
    params.plexUserTitle,
  ).trim();
  return Array.from(
    new Set([preferred, legacy].filter((name) => Boolean(name))),
  );
}

function watchedCollectionBaseNamesForMediaType(
  mediaType: 'movie' | 'tv',
): string[] {
  if (mediaType === 'movie') {
    return [
      RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME,
      CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
      // Legacy naming support.
      'Based on your recently watched',
      'Change of Taste',
    ];
  }
  return [
    RECENTLY_WATCHED_SHOW_COLLECTION_BASE_NAME,
    CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
    // Legacy naming support.
    'Based on your recently watched',
    'Change of Taste',
  ];
}

type ResetBody = {
  mediaType?: unknown;
  librarySectionKey?: unknown;
};

type ResetUserBody = {
  plexUserId?: unknown;
  mediaType?: unknown;
  includeWatchedCollections?: unknown;
};

@Controller('immaculate-taste')
@ApiTags('immaculate-taste')
export class ImmaculateTasteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexUsers: PlexUsersService,
  ) {}

  private async assertAdminSession(userId: string): Promise<void> {
    const adminUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!adminUser || adminUser.id !== userId) {
      throw new ForbiddenException(
        'Only the admin account can manage Immaculate Taste collections',
      );
    }
  }

  @Get('collections')
  async listCollections(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    await this.assertAdminSession(userId);
    const adminPlexUser = await this.plexUsers.ensureAdminPlexUser({ userId });
    const plexUserId = adminPlexUser.id;
    const plexUserTitle = adminPlexUser.plexAccountTitle;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw)
      throw new BadRequestException('Plex baseUrl is not set');
    if (!plexToken) throw new BadRequestException('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const librarySelection = resolvePlexLibrarySelection({
      settings,
      sections,
    });
    const selectedSectionKeySet = new Set(librarySelection.selectedSectionKeys);
    const movieSections = sections.filter(
      (s) =>
        (s.type ?? '').toLowerCase() === 'movie' &&
        selectedSectionKeySet.has(String(s.key ?? '').trim()),
    );
    const tvSections = sections.filter(
      (s) =>
        (s.type ?? '').toLowerCase() === 'show' &&
        selectedSectionKeySet.has(String(s.key ?? '').trim()),
    );

    const movieCollectionName = buildUserCollectionName(
      getImmaculateCollectionBaseName('movie'),
      plexUserTitle,
    );
    const tvCollectionName = buildUserCollectionName(
      getImmaculateCollectionBaseName('tv'),
      plexUserTitle,
    );

    const movieEntries = await Promise.all(
      movieSections.map(async (sec) => {
        const [total, active, pending] = await Promise.all([
          this.prisma.immaculateTasteMovieLibrary.count({
            where: { plexUserId, librarySectionKey: sec.key },
          }),
          this.prisma.immaculateTasteMovieLibrary.count({
            where: {
              plexUserId,
              librarySectionKey: sec.key,
              status: 'active',
              points: { gt: 0 },
            },
          }),
          this.prisma.immaculateTasteMovieLibrary.count({
            where: {
              plexUserId,
              librarySectionKey: sec.key,
              status: 'pending',
            },
          }),
        ]);

        let collectionRatingKey: string | null = null;
        let plexItemCount: number | null = null;
        try {
          collectionRatingKey = await this.plexServer.findCollectionRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sec.key,
            collectionName: movieCollectionName,
          });
          if (collectionRatingKey) {
            const items = await this.plexServer.getCollectionItems({
              baseUrl: plexBaseUrl,
              token: plexToken,
              collectionRatingKey,
            });
            plexItemCount = items.length;
          }
        } catch {
          // Non-fatal: keep nulls if Plex is flaky
        }

        return {
          mediaType: 'movie' as const,
          librarySectionKey: sec.key,
          libraryTitle: sec.title,
          dataset: { total, active, pending },
          plex: {
            collectionName: movieCollectionName,
            collectionRatingKey,
            itemCount: plexItemCount,
          },
        };
      }),
    );

    const tvEntries = await Promise.all(
      tvSections.map(async (sec) => {
        const [total, active, pending] = await Promise.all([
          this.prisma.immaculateTasteShowLibrary.count({
            where: { plexUserId, librarySectionKey: sec.key },
          }),
          this.prisma.immaculateTasteShowLibrary.count({
            where: {
              plexUserId,
              librarySectionKey: sec.key,
              status: 'active',
              points: { gt: 0 },
            },
          }),
          this.prisma.immaculateTasteShowLibrary.count({
            where: {
              plexUserId,
              librarySectionKey: sec.key,
              status: 'pending',
            },
          }),
        ]);

        let collectionRatingKey: string | null = null;
        let plexItemCount: number | null = null;
        try {
          collectionRatingKey = await this.plexServer.findCollectionRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sec.key,
            collectionName: tvCollectionName,
          });
          if (collectionRatingKey) {
            const items = await this.plexServer.getCollectionItems({
              baseUrl: plexBaseUrl,
              token: plexToken,
              collectionRatingKey,
            });
            plexItemCount = items.length;
          }
        } catch {
          // Non-fatal
        }

        return {
          mediaType: 'tv' as const,
          librarySectionKey: sec.key,
          libraryTitle: sec.title,
          dataset: { total, active, pending },
          plex: {
            collectionName: tvCollectionName,
            collectionRatingKey,
            itemCount: plexItemCount,
          },
        };
      }),
    );

    return {
      collectionName: movieCollectionName,
      tvCollectionName,
      collections: [...movieEntries, ...tvEntries],
    };
  }

  @Get('collections/users')
  async listCollectionUsers(@Req() req: AuthenticatedRequest) {
    await this.assertAdminSession(req.user.id);
    await this.plexUsers.ensureAdminPlexUser({ userId: req.user.id });
    const users = await this.prisma.plexUser.findMany({
      orderBy: [{ isAdmin: 'desc' }, { createdAt: 'asc' }],
    });

    const movieCounts = await this.prisma.immaculateTasteMovieLibrary.groupBy({
      by: ['plexUserId'],
      _count: { _all: true },
    });
    const tvCounts = await this.prisma.immaculateTasteShowLibrary.groupBy({
      by: ['plexUserId'],
      _count: { _all: true },
    });

    const movieByUser = new Map<string, number>(
      movieCounts.map((row) => [row.plexUserId, row._count._all]),
    );
    const tvByUser = new Map<string, number>(
      tvCounts.map((row) => [row.plexUserId, row._count._all]),
    );

    return {
      users: users.map((user) => ({
        id: user.id,
        plexAccountTitle: user.plexAccountTitle,
        isAdmin: user.isAdmin,
        movieCount: movieByUser.get(user.id) ?? 0,
        tvCount: tvByUser.get(user.id) ?? 0,
      })),
    };
  }

  @Post('collections/reset')
  async resetCollection(
    @Req() req: AuthenticatedRequest,
    @Body() body: ResetBody,
  ) {
    const userId = req.user.id;
    await this.assertAdminSession(userId);
    const mediaTypeRaw =
      typeof body?.mediaType === 'string' ? body.mediaType.trim() : '';
    const mediaType = mediaTypeRaw.toLowerCase();
    const librarySectionKey =
      typeof body?.librarySectionKey === 'string'
        ? body.librarySectionKey.trim()
        : '';

    if (mediaType !== 'movie' && mediaType !== 'tv') {
      throw new BadRequestException('mediaType must be "movie" or "tv"');
    }
    if (!librarySectionKey) {
      throw new BadRequestException('librarySectionKey is required');
    }
    const resolvedMediaType: 'movie' | 'tv' = mediaType;

    const adminPlexUser = await this.plexUsers.ensureAdminPlexUser({ userId });
    const plexUserId = adminPlexUser.id;
    const plexUserTitle = adminPlexUser.plexAccountTitle;
    const collectionName = buildUserCollectionName(
      getImmaculateCollectionBaseName(resolvedMediaType),
      plexUserTitle,
    );

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw)
      throw new BadRequestException('Plex baseUrl is not set');
    if (!plexToken) throw new BadRequestException('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const sec = sections.find((s) => s.key === librarySectionKey) ?? null;
    if (!sec) {
      throw new BadRequestException('Plex library section not found');
    }

    const secType = (sec.type ?? '').toLowerCase();
    if (resolvedMediaType === 'movie' && secType !== 'movie') {
      throw new BadRequestException('librarySectionKey is not a movie library');
    }
    if (resolvedMediaType === 'tv' && secType !== 'show') {
      throw new BadRequestException('librarySectionKey is not a TV library');
    }

    // Delete Plex collection (if present)
    let plexDeleted = false;
    let collectionRatingKey: string | null = null;
    try {
      collectionRatingKey = await this.plexServer.findCollectionRatingKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey,
        collectionName,
      });
      if (collectionRatingKey) {
        await this.plexServer.deleteCollection({
          baseUrl: plexBaseUrl,
          token: plexToken,
          collectionRatingKey,
        });
        plexDeleted = true;
      }
    } catch {
      // ignore (Plex flakiness)
    }

    // Delete dataset rows
    const datasetDeleted =
      resolvedMediaType === 'movie'
        ? await this.prisma.immaculateTasteMovieLibrary.deleteMany({
            where: { plexUserId, librarySectionKey },
          })
        : await this.prisma.immaculateTasteShowLibrary.deleteMany({
            where: { plexUserId, librarySectionKey },
          });

    // Prevent legacy auto-bootstrap from restoring data immediately after a reset.
    // (Back-compat: the app can import legacy datasets when a library has 0 rows.)
    await this.prisma.setting
      .upsert({
        where: {
          key: immaculateTasteResetMarkerKey({
            mediaType: resolvedMediaType,
            librarySectionKey,
          }),
        },
        update: { value: new Date().toISOString(), encrypted: false },
        create: {
          key: immaculateTasteResetMarkerKey({
            mediaType: resolvedMediaType,
            librarySectionKey,
          }),
          value: new Date().toISOString(),
          encrypted: false,
        },
      })
      .catch(() => undefined);

    return {
      ok: true,
      mediaType: resolvedMediaType,
      librarySectionKey,
      libraryTitle: sec.title,
      plex: {
        collectionName,
        collectionRatingKey,
        deleted: plexDeleted,
      },
      dataset: {
        deleted: datasetDeleted.count,
      },
    };
  }

  @Post('collections/reset-user')
  async resetUserCollections(
    @Req() req: AuthenticatedRequest,
    @Body() body: ResetUserBody,
  ) {
    const userId = req.user.id;
    await this.assertAdminSession(userId);
    await this.plexUsers.ensureAdminPlexUser({ userId });

    const mediaTypeRaw =
      typeof body?.mediaType === 'string' ? body.mediaType.trim() : '';
    const mediaType = mediaTypeRaw.toLowerCase();
    const plexUserId =
      typeof body?.plexUserId === 'string' ? body.plexUserId.trim() : '';
    const includeWatchedCollections = body?.includeWatchedCollections === true;

    if (mediaType !== 'movie' && mediaType !== 'tv') {
      throw new BadRequestException('mediaType must be "movie" or "tv"');
    }
    if (!plexUserId) {
      throw new BadRequestException('plexUserId is required');
    }
    const resolvedMediaType: 'movie' | 'tv' = mediaType;

    const plexUser = await this.plexUsers.getPlexUserById(plexUserId);
    if (!plexUser) {
      throw new BadRequestException('Plex user not found');
    }

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw)
      throw new BadRequestException('Plex baseUrl is not set');
    if (!plexToken) throw new BadRequestException('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const targetType = resolvedMediaType === 'movie' ? 'movie' : 'show';
    const targetSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === targetType,
    );

    const collectionName = buildUserCollectionName(
      getImmaculateCollectionBaseName(resolvedMediaType),
      plexUser.plexAccountTitle,
    );
    const profileRows = await this.prisma.immaculateTasteProfile.findMany({
      where: { userId },
      select: {
        id: true,
        isDefault: true,
        mediaType: true,
        movieCollectionBaseName: true,
        showCollectionBaseName: true,
        userOverrides: {
          where: { plexUserId: plexUser.id },
          select: {
            movieCollectionBaseName: true,
            showCollectionBaseName: true,
          },
          take: 1,
        },
      },
    });
    const baseNameByProfileDatasetId = new Map<string, string>();
    for (const profile of profileRows) {
      if (!profileSupportsMediaType(profile.mediaType, resolvedMediaType)) {
        continue;
      }
      baseNameByProfileDatasetId.set(
        resolveProfileDatasetIdForCollectionReset(profile),
        resolveProfileCollectionBaseNameForReset({
          mediaType: resolvedMediaType,
          profile,
        }),
      );
    }

    const profileGroups =
      resolvedMediaType === 'movie'
        ? await this.prisma.immaculateTasteMovieLibrary.groupBy({
            by: ['profileId'],
            where: { plexUserId: plexUser.id },
          })
        : await this.prisma.immaculateTasteShowLibrary.groupBy({
            by: ['profileId'],
            where: { plexUserId: plexUser.id },
          });
    for (const row of profileGroups) {
      const profileId = String(row.profileId ?? '').trim();
      if (!profileId) continue;
      if (baseNameByProfileDatasetId.has(profileId)) continue;
      baseNameByProfileDatasetId.set(
        profileId,
        getImmaculateCollectionBaseName(resolvedMediaType),
      );
    }
    if (!baseNameByProfileDatasetId.size) {
      baseNameByProfileDatasetId.set(
        'default',
        getImmaculateCollectionBaseName(resolvedMediaType),
      );
    }

    const targetCollectionNameSet = new Set<string>();
    for (const baseName of baseNameByProfileDatasetId.values()) {
      for (const name of buildImmaculateCollectionLookupNamesForReset({
        baseName,
        plexUserTitle: plexUser.plexAccountTitle,
      })) {
        targetCollectionNameSet.add(name);
      }
    }
    if (includeWatchedCollections) {
      for (const baseName of watchedCollectionBaseNamesForMediaType(
        resolvedMediaType,
      )) {
        const watchedCollectionName = buildUserCollectionName(
          baseName,
          plexUser.plexAccountTitle,
        ).trim();
        if (watchedCollectionName) {
          targetCollectionNameSet.add(watchedCollectionName);
        }
      }

      const watchedCollectionRows =
        resolvedMediaType === 'movie'
          ? await this.prisma.watchedMovieRecommendationLibrary.findMany({
              where: { plexUserId: plexUser.id },
              select: { collectionName: true },
              distinct: ['collectionName'],
            })
          : await this.prisma.watchedShowRecommendationLibrary.findMany({
              where: { plexUserId: plexUser.id },
              select: { collectionName: true },
              distinct: ['collectionName'],
            });
      for (const row of watchedCollectionRows) {
        const rawCollectionName = String(row.collectionName ?? '').trim();
        if (!rawCollectionName) continue;
        targetCollectionNameSet.add(rawCollectionName);
        if (!rawCollectionName.includes('(')) {
          const suffixedName = buildUserCollectionName(
            rawCollectionName,
            plexUser.plexAccountTitle,
          ).trim();
          if (suffixedName) {
            targetCollectionNameSet.add(suffixedName);
          }
        }
      }
    }
    const normalizedTargetCollectionNameSet = new Set(
      Array.from(targetCollectionNameSet)
        .map((name) => normalizeCollectionTitle(name))
        .filter((name) => Boolean(name)),
    );

    let plexDeleted = 0;
    for (const sec of targetSections) {
      let sectionCollections: Array<{
        ratingKey: string;
        title: string;
      }> | null = null;
      try {
        sectionCollections = await this.plexServer.listCollectionsForSectionKey(
          {
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sec.key,
            take: 800,
          },
        );
      } catch {
        sectionCollections = null;
      }

      if (sectionCollections) {
        const matchingCollections = sectionCollections.filter((item) =>
          normalizedTargetCollectionNameSet.has(
            normalizeCollectionTitle(item.title),
          ),
        );
        for (const collection of matchingCollections) {
          try {
            await this.plexServer.deleteCollection({
              baseUrl: plexBaseUrl,
              token: plexToken,
              collectionRatingKey: collection.ratingKey,
            });
            plexDeleted += 1;
          } catch {
            // ignore per-collection Plex flakiness
          }
        }
        continue;
      }

      for (const targetCollectionName of targetCollectionNameSet) {
        try {
          const collectionRatingKey =
            await this.plexServer.findCollectionRatingKey({
              baseUrl: plexBaseUrl,
              token: plexToken,
              librarySectionKey: sec.key,
              collectionName: targetCollectionName,
            });
          if (!collectionRatingKey) continue;
          await this.plexServer.deleteCollection({
            baseUrl: plexBaseUrl,
            token: plexToken,
            collectionRatingKey,
          });
          plexDeleted += 1;
        } catch {
          // ignore per-collection Plex flakiness
        }
      }
    }

    const datasetDeleted =
      resolvedMediaType === 'movie'
        ? await this.prisma.immaculateTasteMovieLibrary.deleteMany({
            where: { plexUserId: plexUser.id },
          })
        : await this.prisma.immaculateTasteShowLibrary.deleteMany({
            where: { plexUserId: plexUser.id },
          });
    const watchedDatasetDeleted = includeWatchedCollections
      ? resolvedMediaType === 'movie'
        ? await this.prisma.watchedMovieRecommendationLibrary.deleteMany({
            where: { plexUserId: plexUser.id },
          })
        : await this.prisma.watchedShowRecommendationLibrary.deleteMany({
            where: { plexUserId: plexUser.id },
          })
      : { count: 0 };
    const totalDatasetDeleted =
      datasetDeleted.count + watchedDatasetDeleted.count;

    const resetAt = new Date().toISOString();
    await Promise.all(
      targetSections.map((sec) =>
        this.prisma.setting
          .upsert({
            where: {
              key: immaculateTasteResetMarkerKey({
                mediaType: resolvedMediaType,
                librarySectionKey: sec.key,
              }),
            },
            update: { value: resetAt, encrypted: false },
            create: {
              key: immaculateTasteResetMarkerKey({
                mediaType: resolvedMediaType,
                librarySectionKey: sec.key,
              }),
              value: resetAt,
              encrypted: false,
            },
          })
          .catch(() => undefined),
      ),
    );

    return {
      ok: true,
      mediaType: resolvedMediaType,
      plexUserId: plexUser.id,
      plexUserTitle: plexUser.plexAccountTitle,
      plex: {
        collectionName,
        deleted: plexDeleted,
        libraries: targetSections.length,
      },
      dataset: {
        deleted: totalDatasetDeleted,
        immaculateDeleted: datasetDeleted.count,
        watchedDeleted: watchedDatasetDeleted.count,
      },
    };
  }
}
