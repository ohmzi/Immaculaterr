import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ImmaculateTasteProfile,
  ImmaculateTasteProfileUserOverride,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  buildImmaculateCollectionName,
  buildUserCollectionName,
  IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME,
  IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME,
  normalizeCollectionTitle,
  resolveCuratedCollectionBaseName,
  stripUserCollectionSuffix,
} from './plex-collections.utils';
import { PlexServerService } from './plex-server.service';
import { PlexUsersService } from './plex-users.service';

export type CollectionArtworkMediaType = 'movie' | 'tv';
export type CollectionArtworkTargetKind =
  | 'immaculate_profile'
  | 'watched_collection';

export type CollectionArtworkManagedTarget = {
  mediaType: CollectionArtworkMediaType;
  targetKind: CollectionArtworkTargetKind;
  targetId: string;
  source: 'immaculate' | 'watched';
  collectionBaseName: string;
  collectionName: string;
  datasetRows: number;
  hasCustomPoster: boolean;
  customPosterUpdatedAt: string | null;
};

export type CollectionArtworkOverrideMeta = {
  version: 1;
  plexUserId: string;
  mediaType: CollectionArtworkMediaType;
  targetKind: CollectionArtworkTargetKind;
  targetId: string;
  relativePosterPath: string;
  mimeType: string;
  size: number;
  updatedAt: string;
};

type ArtworkFallback = 'none' | 'immaculate';

type ParsedOverride = CollectionArtworkOverrideMeta & {
  key: string;
  absolutePosterPath: string;
};

const COLLECTION_ARTWORK_SETTING_KEY_PREFIX = 'collectionArtwork.override.v1';
const MAX_POSTER_BYTES = 5 * 1024 * 1024;
const COLLECTION_ARTWORK_CUSTOM_ROOT_SEGMENTS = [
  'collection_artwork',
  'custom',
] as const;
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

const ALLOWED_IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function hasExpectedImageSignature(params: {
  mimeType: string;
  buffer: Buffer;
}): boolean {
  const { mimeType, buffer } = params;
  if (!Buffer.isBuffer(buffer)) return false;

  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (mimeType === 'image/jpeg') {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }

  return false;
}

const DEFAULT_COLLECTION_ARTWORK_MAP: Record<string, string> = {
  [normalizeCollectionTitle('Inspired by your Immaculate Taste')]:
    'immaculate_taste_collection',
  [normalizeCollectionTitle('Inspired by your Immaculate Taste in Movies')]:
    'immaculate_taste_collection',
  [normalizeCollectionTitle('Inspired by your Immaculate Taste in Shows')]:
    'immaculate_taste_collection',
  [normalizeCollectionTitle('Based on your recently watched Movie')]:
    'recently_watched_collection',
  [normalizeCollectionTitle('Based on your recently watched Show')]:
    'recently_watched_collection',
  [normalizeCollectionTitle('Change of Taste')]: 'change_of_taste_collection',
  [normalizeCollectionTitle('Change of Movie Taste')]:
    'change_of_taste_collection',
  [normalizeCollectionTitle('Change of Show Taste')]:
    'change_of_taste_collection',
  [normalizeCollectionTitle('Fresh Out Of The Oven')]:
    'recently_watched_collection',
  [normalizeCollectionTitle('Fresh Out Of The Oven Show')]:
    'recently_watched_collection',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const value = pick(obj, path);
  return typeof value === 'string' ? value.trim() : '';
}

function isDisallowedMetadataHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === '169.254.169.254' ||
    normalized === 'metadata.google.internal' ||
    normalized === 'metadata.azure.internal'
  );
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const normalized = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new BadRequestException('Plex baseUrl must be a valid http(s) URL');
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new BadRequestException('Plex baseUrl must be a valid http(s) URL');
  }
  if (isDisallowedMetadataHostname(parsed.hostname)) {
    throw new BadRequestException('Plex baseUrl host is not allowed');
  }
  return normalized;
}

function normalizeMediaType(value: string): CollectionArtworkMediaType {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'movie' || lowered === 'tv') {
    return lowered;
  }
  throw new BadRequestException('mediaType must be "movie" or "tv"');
}

function normalizeTargetKind(value: string): CollectionArtworkTargetKind {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'immaculate_profile' || lowered === 'watched_collection') {
    return lowered;
  }
  throw new BadRequestException(
    'targetKind must be "immaculate_profile" or "watched_collection"',
  );
}

function normalizeTargetId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException('targetId is required');
  return trimmed;
}

function hashTargetId(targetId: string): string {
  return createHash('sha256')
    .update(targetId.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

function safePathSegment(value: string): string {
  const collapsed = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-');
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === '-') start += 1;
  while (end > start && collapsed[end - 1] === '-') end -= 1;
  const cleaned = collapsed.slice(start, end).slice(0, 80);
  return cleaned || 'target';
}

function normalizeRelativePosterPath(raw: string): string | null {
  const normalizedSlashes = raw.trim().replace(/\\/g, '/');
  if (!normalizedSlashes) return null;
  if (normalizedSlashes.includes('\0')) return null;

  const normalized = normalizedSlashes.replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length !== 7) return null;
  if (
    segments[0] !== COLLECTION_ARTWORK_CUSTOM_ROOT_SEGMENTS[0] ||
    segments[1] !== COLLECTION_ARTWORK_CUSTOM_ROOT_SEGMENTS[1]
  ) {
    return null;
  }

  if (segments[2] === '.' || segments[2] === '..') return null;
  if (segments[3] !== 'movie' && segments[3] !== 'tv') return null;
  if (
    segments[4] !== 'immaculate_profile' &&
    segments[4] !== 'watched_collection'
  ) {
    return null;
  }
  if (segments[5] === '.' || segments[5] === '..') return null;
  if (!/^poster\.(png|jpg|webp)$/.test(segments[6] ?? '')) return null;

  const safeSegmentIndexes = [2, 5] as const;
  for (const index of safeSegmentIndexes) {
    const segment = segments[index] ?? '';
    if (!segment || !SAFE_PATH_SEGMENT_PATTERN.test(segment)) {
      return null;
    }
  }

  return join(...segments);
}

function resolveMovieCollectionBaseName(
  value: string | null | undefined,
): string {
  return (value ?? '').trim() || IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME;
}

function resolveShowCollectionBaseName(
  value: string | null | undefined,
): string {
  return (value ?? '').trim() || IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME;
}

function parseOverrideValue(raw: string): CollectionArtworkOverrideMeta | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return null;

    const versionRaw = parsed['version'];
    const version =
      typeof versionRaw === 'number' ? Math.trunc(versionRaw) : NaN;
    if (version !== 1) return null;

    const plexUserId =
      typeof parsed['plexUserId'] === 'string'
        ? parsed['plexUserId'].trim()
        : '';
    const mediaTypeRaw =
      typeof parsed['mediaType'] === 'string' ? parsed['mediaType'].trim() : '';
    const targetKindRaw =
      typeof parsed['targetKind'] === 'string'
        ? parsed['targetKind'].trim()
        : '';
    const targetId =
      typeof parsed['targetId'] === 'string' ? parsed['targetId'].trim() : '';
    const relativePosterPathRaw =
      typeof parsed['relativePosterPath'] === 'string'
        ? parsed['relativePosterPath'].trim()
        : '';
    const relativePosterPath = normalizeRelativePosterPath(
      relativePosterPathRaw,
    );
    const mimeType =
      typeof parsed['mimeType'] === 'string' ? parsed['mimeType'].trim() : '';
    const updatedAt =
      typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'].trim() : '';

    const sizeRaw = parsed['size'];
    const size =
      typeof sizeRaw === 'number' && Number.isFinite(sizeRaw)
        ? Math.max(0, Math.trunc(sizeRaw))
        : NaN;

    if (
      !plexUserId ||
      !targetId ||
      !relativePosterPath ||
      !mimeType ||
      !updatedAt
    ) {
      return null;
    }

    const mediaType = normalizeMediaType(mediaTypeRaw);
    const targetKind = normalizeTargetKind(targetKindRaw);
    if (!Number.isFinite(size)) return null;

    return {
      version: 1,
      plexUserId,
      mediaType,
      targetKind,
      targetId,
      relativePosterPath,
      mimeType,
      size,
      updatedAt,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class CollectionArtworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexUsers: PlexUsersService,
  ) {}

  async listManagedTargetsForUser(params: {
    requestUserId: string;
    plexUserId: string;
  }): Promise<{
    plexUser: { id: string; plexAccountTitle: string; isAdmin: boolean };
    collections: CollectionArtworkManagedTarget[];
  }> {
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) throw new BadRequestException('plexUserId is required');

    const plexUser = await this.prisma.plexUser.findUnique({
      where: { id: plexUserId },
      select: { id: true, plexAccountTitle: true, isAdmin: true },
    });
    if (!plexUser) throw new BadRequestException('Plex user not found');

    const profiles = await this.prisma.immaculateTasteProfile.findMany({
      where: { userId: params.requestUserId },
      include: {
        userOverrides: {
          where: { plexUserId },
        },
      },
    });

    const profileByDatasetId = new Map<
      string,
      ImmaculateTasteProfile & {
        userOverrides: ImmaculateTasteProfileUserOverride[];
      }
    >();
    for (const profile of profiles) {
      const datasetId = profile.isDefault ? 'default' : profile.id;
      profileByDatasetId.set(datasetId, profile);
    }
    const knownProfileDatasetIds = new Set(profileByDatasetId.keys());

    const immaculateMovieGroups =
      await this.prisma.immaculateTasteMovieLibrary.groupBy({
        by: ['profileId'],
        where: { plexUserId },
        _count: { _all: true },
      });
    const immaculateTvGroups =
      await this.prisma.immaculateTasteShowLibrary.groupBy({
        by: ['profileId'],
        where: { plexUserId },
        _count: { _all: true },
      });

    const watchedMovieGroups =
      await this.prisma.watchedMovieRecommendationLibrary.groupBy({
        by: ['collectionName'],
        where: { plexUserId },
        _count: { _all: true },
      });
    const watchedTvGroups =
      await this.prisma.watchedShowRecommendationLibrary.groupBy({
        by: ['collectionName'],
        where: { plexUserId },
        _count: { _all: true },
      });

    const watchedMovieByBase = new Map<string, number>();
    for (const row of watchedMovieGroups) {
      const base = resolveCuratedCollectionBaseName({
        collectionName: row.collectionName,
        mediaType: 'movie',
      });
      if (!base) continue;
      watchedMovieByBase.set(
        base,
        (watchedMovieByBase.get(base) ?? 0) + row._count._all,
      );
    }

    const watchedTvByBase = new Map<string, number>();
    for (const row of watchedTvGroups) {
      const base = resolveCuratedCollectionBaseName({
        collectionName: row.collectionName,
        mediaType: 'tv',
      });
      if (!base) continue;
      watchedTvByBase.set(
        base,
        (watchedTvByBase.get(base) ?? 0) + row._count._all,
      );
    }

    const collections: CollectionArtworkManagedTarget[] = [];

    for (const row of immaculateMovieGroups) {
      const targetId = row.profileId;
      if (!knownProfileDatasetIds.has(targetId) && targetId !== 'default') {
        continue;
      }
      const collectionBaseName = this.resolveImmaculateCollectionBaseName({
        profileByDatasetId,
        profileDatasetId: targetId,
        plexUserId,
        mediaType: 'movie',
      });
      collections.push({
        mediaType: 'movie',
        targetKind: 'immaculate_profile',
        targetId,
        source: 'immaculate',
        collectionBaseName,
        collectionName: buildImmaculateCollectionName(
          collectionBaseName,
          plexUser.plexAccountTitle,
        ),
        datasetRows: row._count._all,
        hasCustomPoster: false,
        customPosterUpdatedAt: null,
      });
    }

    for (const row of immaculateTvGroups) {
      const targetId = row.profileId;
      if (!knownProfileDatasetIds.has(targetId) && targetId !== 'default') {
        continue;
      }
      const collectionBaseName = this.resolveImmaculateCollectionBaseName({
        profileByDatasetId,
        profileDatasetId: targetId,
        plexUserId,
        mediaType: 'tv',
      });
      collections.push({
        mediaType: 'tv',
        targetKind: 'immaculate_profile',
        targetId,
        source: 'immaculate',
        collectionBaseName,
        collectionName: buildImmaculateCollectionName(
          collectionBaseName,
          plexUser.plexAccountTitle,
        ),
        datasetRows: row._count._all,
        hasCustomPoster: false,
        customPosterUpdatedAt: null,
      });
    }

    for (const [targetId, datasetRows] of watchedMovieByBase.entries()) {
      collections.push({
        mediaType: 'movie',
        targetKind: 'watched_collection',
        targetId,
        source: 'watched',
        collectionBaseName: targetId,
        collectionName: buildUserCollectionName(
          targetId,
          plexUser.plexAccountTitle,
        ),
        datasetRows,
        hasCustomPoster: false,
        customPosterUpdatedAt: null,
      });
    }

    for (const [targetId, datasetRows] of watchedTvByBase.entries()) {
      collections.push({
        mediaType: 'tv',
        targetKind: 'watched_collection',
        targetId,
        source: 'watched',
        collectionBaseName: targetId,
        collectionName: buildUserCollectionName(
          targetId,
          plexUser.plexAccountTitle,
        ),
        datasetRows,
        hasCustomPoster: false,
        customPosterUpdatedAt: null,
      });
    }

    const keys = collections.map((collection) =>
      this.buildSettingKey({
        plexUserId,
        mediaType: collection.mediaType,
        targetKind: collection.targetKind,
        targetId: collection.targetId,
      }),
    );

    const settings = keys.length
      ? await this.prisma.setting.findMany({ where: { key: { in: keys } } })
      : [];
    const settingByKey = new Map(
      settings.map((setting) => [setting.key, setting.value]),
    );

    for (const collection of collections) {
      const key = this.buildSettingKey({
        plexUserId,
        mediaType: collection.mediaType,
        targetKind: collection.targetKind,
        targetId: collection.targetId,
      });
      const parsed = parseOverrideValue(settingByKey.get(key) ?? '');
      if (!parsed) continue;
      const absolute = this.resolveAbsolutePosterPath(
        parsed.relativePosterPath,
      );
      if (!absolute || !existsSync(absolute)) continue;
      collection.hasCustomPoster = true;
      collection.customPosterUpdatedAt = parsed.updatedAt;
    }

    collections.sort((left, right) => {
      if (left.mediaType !== right.mediaType) {
        return left.mediaType === 'movie' ? -1 : 1;
      }
      if (left.source !== right.source) {
        return left.source === 'immaculate' ? -1 : 1;
      }
      if (left.collectionBaseName !== right.collectionBaseName) {
        return left.collectionBaseName.localeCompare(right.collectionBaseName);
      }
      return left.targetId.localeCompare(right.targetId);
    });

    return {
      plexUser,
      collections,
    };
  }

  async saveOverride(params: {
    plexUserId: string;
    mediaType: CollectionArtworkMediaType;
    targetKind: CollectionArtworkTargetKind;
    targetId: string;
    file: Express.Multer.File;
  }): Promise<CollectionArtworkOverrideMeta> {
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) throw new BadRequestException('plexUserId is required');

    const mediaType = normalizeMediaType(params.mediaType);
    const targetKind = normalizeTargetKind(params.targetKind);
    const targetId = normalizeTargetId(params.targetId);

    if (!params.file) {
      throw new BadRequestException('file is required');
    }

    const mimeType = String(params.file.mimetype ?? '')
      .trim()
      .toLowerCase();
    const ext = ALLOWED_IMAGE_MIME_TO_EXT[mimeType];
    if (!ext) {
      throw new BadRequestException('file must be png, jpg/jpeg, or webp');
    }

    const size = Number.isFinite(params.file.size)
      ? Math.max(0, Math.trunc(params.file.size))
      : 0;
    if (size <= 0 || size > MAX_POSTER_BYTES) {
      throw new BadRequestException('file must be between 1 byte and 5 MB');
    }

    if (!params.file.buffer || !Buffer.isBuffer(params.file.buffer)) {
      throw new BadRequestException('uploaded file payload is missing');
    }
    if (
      !hasExpectedImageSignature({
        mimeType,
        buffer: params.file.buffer,
      })
    ) {
      throw new BadRequestException(
        'file content does not match declared image type',
      );
    }

    const settingKey = this.buildSettingKey({
      plexUserId,
      mediaType,
      targetKind,
      targetId,
    });

    const existing = await this.prisma.setting.findUnique({
      where: { key: settingKey },
    });
    const parsedExisting = existing ? parseOverrideValue(existing.value) : null;

    const relativePosterPath = join(
      ...COLLECTION_ARTWORK_CUSTOM_ROOT_SEGMENTS,
      safePathSegment(plexUserId),
      mediaType,
      targetKind,
      `${safePathSegment(targetId)}-${hashTargetId(targetId)}`,
      `poster.${ext}`,
    );
    const absolutePosterPath =
      this.resolveAbsolutePosterPath(relativePosterPath);
    if (!absolutePosterPath) {
      throw new BadRequestException('APP_DATA_DIR is not configured');
    }

    await mkdir(dirname(absolutePosterPath), { recursive: true });
    await writeFile(absolutePosterPath, params.file.buffer);

    const override: CollectionArtworkOverrideMeta = {
      version: 1,
      plexUserId,
      mediaType,
      targetKind,
      targetId,
      relativePosterPath,
      mimeType,
      size,
      updatedAt: new Date().toISOString(),
    };

    await this.prisma.setting.upsert({
      where: { key: settingKey },
      update: {
        value: JSON.stringify(override),
        encrypted: false,
      },
      create: {
        key: settingKey,
        value: JSON.stringify(override),
        encrypted: false,
      },
    });

    if (
      parsedExisting &&
      parsedExisting.relativePosterPath &&
      parsedExisting.relativePosterPath !== override.relativePosterPath
    ) {
      const oldAbsolute = this.resolveAbsolutePosterPath(
        parsedExisting.relativePosterPath,
      );
      if (oldAbsolute && existsSync(oldAbsolute)) {
        await unlink(oldAbsolute).catch(() => undefined);
      }
    }

    return override;
  }

  async deleteOverride(params: {
    plexUserId: string;
    mediaType: CollectionArtworkMediaType;
    targetKind: CollectionArtworkTargetKind;
    targetId: string;
  }): Promise<void> {
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) throw new BadRequestException('plexUserId is required');

    const mediaType = normalizeMediaType(params.mediaType);
    const targetKind = normalizeTargetKind(params.targetKind);
    const targetId = normalizeTargetId(params.targetId);

    const settingKey = this.buildSettingKey({
      plexUserId,
      mediaType,
      targetKind,
      targetId,
    });

    const existing = await this.prisma.setting.findUnique({
      where: { key: settingKey },
    });
    const parsed = existing ? parseOverrideValue(existing.value) : null;

    await this.prisma.setting.deleteMany({ where: { key: settingKey } });

    if (!parsed) return;

    const absolute = this.resolveAbsolutePosterPath(parsed.relativePosterPath);
    if (!absolute || !existsSync(absolute)) return;

    await unlink(absolute).catch(() => undefined);
    const parentDir = dirname(absolute);
    await rm(parentDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  async applyOverrideNow(params: {
    requestUserId: string;
    plexUserId: string;
    mediaType: CollectionArtworkMediaType;
    targetKind: CollectionArtworkTargetKind;
    targetId: string;
  }): Promise<{
    appliedNow: boolean;
    appliedCount: number;
    collectionName: string | null;
    warnings: string[];
  }> {
    const mediaType = normalizeMediaType(params.mediaType);
    const targetKind = normalizeTargetKind(params.targetKind);
    const targetId = normalizeTargetId(params.targetId);
    const plexUserId = params.plexUserId.trim();

    const warnings: string[] = [];

    const override = await this.getOverrideRecord({
      plexUserId,
      mediaType,
      targetKind,
      targetId,
    });
    if (!override || !existsSync(override.absolutePosterPath)) {
      return {
        appliedNow: false,
        appliedCount: 0,
        collectionName: null,
        warnings: ['No custom poster is stored for this target.'],
      };
    }

    const plexUser = await this.plexUsers.getPlexUserById(plexUserId);
    if (!plexUser) {
      throw new BadRequestException('Plex user not found');
    }

    const profiles = await this.prisma.immaculateTasteProfile.findMany({
      where: { userId: params.requestUserId },
      include: {
        userOverrides: {
          where: { plexUserId },
        },
      },
    });

    const profileByDatasetId = new Map<
      string,
      ImmaculateTasteProfile & {
        userOverrides: ImmaculateTasteProfileUserOverride[];
      }
    >();
    for (const profile of profiles) {
      const datasetId = profile.isDefault ? 'default' : profile.id;
      profileByDatasetId.set(datasetId, profile);
    }

    const collectionBaseName =
      targetKind === 'watched_collection'
        ? targetId
        : this.resolveImmaculateCollectionBaseName({
            profileByDatasetId,
            profileDatasetId: targetId,
            plexUserId,
            mediaType,
          });

    const collectionName =
      targetKind === 'watched_collection'
        ? buildUserCollectionName(collectionBaseName, plexUser.plexAccountTitle)
        : buildImmaculateCollectionName(
            collectionBaseName,
            plexUser.plexAccountTitle,
          );

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(params.requestUserId);
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');

    if (!plexBaseUrlRaw || !plexToken) {
      warnings.push(
        'Plex is not configured; override is saved for future runs.',
      );
      return {
        appliedNow: false,
        appliedCount: 0,
        collectionName,
        warnings,
      };
    }

    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    let sections: Array<{ key: string; title: string; type?: string }> = [];
    try {
      sections = await this.plexServer.getSections({
        baseUrl: plexBaseUrl,
        token: plexToken,
      });
    } catch (error) {
      warnings.push(
        `Failed to load Plex libraries: ${String((error as Error)?.message ?? error)}`,
      );
      return {
        appliedNow: false,
        appliedCount: 0,
        collectionName,
        warnings,
      };
    }

    const targetSectionType = mediaType === 'movie' ? 'movie' : 'show';
    const targetSections = sections.filter(
      (section) => (section.type ?? '').toLowerCase() === targetSectionType,
    );

    let appliedCount = 0;

    for (const section of targetSections) {
      let collectionRatingKey: string | null = null;
      try {
        collectionRatingKey = await this.plexServer.findCollectionRatingKey({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey: section.key,
          collectionName,
        });
      } catch (error) {
        warnings.push(
          `Failed collection lookup in ${section.title}: ${String((error as Error)?.message ?? error)}`,
        );
        continue;
      }

      if (!collectionRatingKey) continue;

      try {
        await this.plexServer.uploadCollectionPoster({
          baseUrl: plexBaseUrl,
          token: plexToken,
          collectionRatingKey,
          filepath: override.absolutePosterPath,
        });
        appliedCount += 1;
      } catch (error) {
        warnings.push(
          `Failed to apply poster in ${section.title}: ${String((error as Error)?.message ?? error)}`,
        );
      }
    }

    if (appliedCount === 0) {
      warnings.push(
        'No existing Plex collection was found right now; override is saved for future refresh/recreate tasks.',
      );
    }

    return {
      appliedNow: appliedCount > 0,
      appliedCount,
      collectionName,
      warnings,
    };
  }

  async resolveArtworkPaths(params: {
    plexUserId?: string | null;
    mediaType: CollectionArtworkMediaType;
    collectionName: string;
    targetKind?: CollectionArtworkTargetKind;
    targetId?: string | null;
    artworkFallback?: ArtworkFallback;
  }): Promise<{
    poster: string | null;
    background: string | null;
  }> {
    const mediaType = normalizeMediaType(params.mediaType);
    const targetKind = params.targetKind;
    const targetId = params.targetId ? params.targetId.trim() : '';
    const plexUserId = params.plexUserId ? params.plexUserId.trim() : '';

    if (plexUserId && targetKind && targetId) {
      const override = await this.getOverrideRecord({
        plexUserId,
        mediaType,
        targetKind,
        targetId,
      });
      if (override && existsSync(override.absolutePosterPath)) {
        return {
          poster: override.absolutePosterPath,
          background: null,
        };
      }
    }

    return this.resolveDefaultArtworkPaths({
      collectionName: params.collectionName,
      artworkFallback: params.artworkFallback ?? 'none',
    });
  }

  async getOverridePreview(params: {
    plexUserId: string;
    mediaType: CollectionArtworkMediaType;
    targetKind: CollectionArtworkTargetKind;
    targetId: string;
  }): Promise<{
    absolutePosterPath: string;
    mimeType: string;
    updatedAt: string;
  } | null> {
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) throw new BadRequestException('plexUserId is required');

    const mediaType = normalizeMediaType(params.mediaType);
    const targetKind = normalizeTargetKind(params.targetKind);
    const targetId = normalizeTargetId(params.targetId);

    const override = await this.getOverrideRecord({
      plexUserId,
      mediaType,
      targetKind,
      targetId,
    });
    if (!override || !existsSync(override.absolutePosterPath)) {
      return null;
    }

    return {
      absolutePosterPath: override.absolutePosterPath,
      mimeType: override.mimeType,
      updatedAt: override.updatedAt,
    };
  }

  resolveDefaultArtworkPaths(params: {
    collectionName: string;
    artworkFallback?: ArtworkFallback;
  }): {
    poster: string | null;
    background: string | null;
  } {
    const normalizedCollectionName = normalizeCollectionTitle(
      stripUserCollectionSuffix(params.collectionName),
    );

    const mapped =
      DEFAULT_COLLECTION_ARTWORK_MAP[normalizedCollectionName] ?? null;
    const artworkName =
      mapped ??
      (params.artworkFallback === 'immaculate'
        ? 'immaculate_taste_collection'
        : null);

    if (!artworkName) return { poster: null, background: null };

    const assetsDir = this.resolveAssetsDir();
    if (!assetsDir) return { poster: null, background: null };

    const poster = this.resolveFirstExistingPath([
      join(assetsDir, 'posters', `${artworkName}.png`),
      join(assetsDir, 'posters', `${artworkName}.jpg`),
      join(assetsDir, 'posters', `${artworkName}.webp`),
    ]);

    const background = this.resolveFirstExistingPath([
      join(assetsDir, 'backgrounds', `${artworkName}.png`),
      join(assetsDir, 'backgrounds', `${artworkName}.jpg`),
      join(assetsDir, 'backgrounds', `${artworkName}.webp`),
    ]);

    return { poster, background };
  }

  private resolveImmaculateCollectionBaseName(params: {
    profileByDatasetId: Map<
      string,
      ImmaculateTasteProfile & {
        userOverrides: ImmaculateTasteProfileUserOverride[];
      }
    >;
    profileDatasetId: string;
    plexUserId: string;
    mediaType: CollectionArtworkMediaType;
  }): string {
    const profile =
      params.profileByDatasetId.get(params.profileDatasetId) ?? null;
    const override =
      profile?.userOverrides.find(
        (candidate) => candidate.plexUserId === params.plexUserId,
      ) ?? null;

    if (params.mediaType === 'movie') {
      if (!profile) {
        return IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME;
      }
      return resolveMovieCollectionBaseName(
        override?.movieCollectionBaseName ?? profile.movieCollectionBaseName,
      );
    }

    if (!profile) {
      return IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME;
    }

    return resolveShowCollectionBaseName(
      override?.showCollectionBaseName ?? profile.showCollectionBaseName,
    );
  }

  private resolveAssetsDir(): string | null {
    const cwd = process.cwd();
    const roots = [
      cwd,
      join(cwd, '..'),
      join(cwd, '..', '..'),
      join(cwd, '..', '..', '..'),
    ];
    const rels = [
      join('apps', 'web', 'src', 'assets', 'collection_artwork'),
      join('assets', 'collection_artwork'),
    ];
    const candidates = roots.flatMap((root) =>
      rels.map((rel) => join(root, rel)),
    );

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  private resolveFirstExistingPath(paths: string[]): string | null {
    for (const candidate of paths) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  private buildSettingKey(params: {
    plexUserId: string;
    mediaType: CollectionArtworkMediaType;
    targetKind: CollectionArtworkTargetKind;
    targetId: string;
  }): string {
    const targetHash = hashTargetId(params.targetId);
    return `${COLLECTION_ARTWORK_SETTING_KEY_PREFIX}.${params.plexUserId}.${params.mediaType}.${params.targetKind}.${targetHash}`;
  }

  private resolveAbsolutePosterPath(relativePosterPath: string): string | null {
    const dataDir = process.env.APP_DATA_DIR?.trim();
    if (!dataDir) return null;
    const normalizedRelativePosterPath =
      normalizeRelativePosterPath(relativePosterPath);
    if (!normalizedRelativePosterPath) return null;

    const baseDir = resolve(dataDir);
    const absolutePath = resolve(baseDir, normalizedRelativePosterPath);
    const baseDirWithSep = baseDir.endsWith(sep) ? baseDir : `${baseDir}${sep}`;
    if (absolutePath !== baseDir && !absolutePath.startsWith(baseDirWithSep)) {
      return null;
    }
    return absolutePath;
  }

  private async getOverrideRecord(params: {
    plexUserId: string;
    mediaType: CollectionArtworkMediaType;
    targetKind: CollectionArtworkTargetKind;
    targetId: string;
  }): Promise<ParsedOverride | null> {
    const settingKey = this.buildSettingKey(params);
    const row = await this.prisma.setting.findUnique({
      where: { key: settingKey },
    });
    if (!row) return null;

    const parsed = parseOverrideValue(row.value);
    if (!parsed) return null;

    const absolutePosterPath = this.resolveAbsolutePosterPath(
      parsed.relativePosterPath,
    );
    if (!absolutePosterPath) return null;

    return {
      key: settingKey,
      ...parsed,
      absolutePosterPath,
    };
  }
}
