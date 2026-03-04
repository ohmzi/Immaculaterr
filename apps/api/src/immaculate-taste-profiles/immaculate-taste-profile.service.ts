import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ImmaculateTasteProfile,
  ImmaculateTasteProfileUserOverride,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import {
  buildImmaculateCollectionName,
  IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME,
  IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME,
  buildUserCollectionName,
  normalizeCollectionTitle,
  stripUserCollectionSuffix,
} from '../plex/plex-collections.utils';
import { resolvePlexLibrarySelection } from '../plex/plex-library-selection.utils';
import { resolvePlexUserMonitoringSelection } from '../plex/plex-user-selection.utils';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';

type MediaType = 'movie' | 'show' | 'both';
type MatchMode = 'all' | 'any';

type ProfilePatch = {
  name?: string;
  enabled?: boolean;
  sortOrder?: number;
  scopePlexUserId?: string | null;
  resetScopeToDefaultNaming?: boolean;
  mediaType?: MediaType;
  matchMode?: MatchMode;
  genres?: string[];
  audioLanguages?: string[];
  radarrInstanceId?: string | null;
  sonarrInstanceId?: string | null;
  movieCollectionBaseName?: string | null;
  showCollectionBaseName?: string | null;
};

type ProfileCreate = {
  name: string;
  mediaType?: MediaType;
  matchMode?: MatchMode;
  genres?: string[];
  audioLanguages?: string[];
  radarrInstanceId?: string | null;
  sonarrInstanceId?: string | null;
  movieCollectionBaseName?: string | null;
  showCollectionBaseName?: string | null;
  enabled?: boolean;
};

export type ImmaculateTasteProfileView = {
  id: string;
  datasetId: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: number;
  mediaType: MediaType;
  matchMode: MatchMode;
  genres: string[];
  audioLanguages: string[];
  radarrInstanceId: string | null;
  sonarrInstanceId: string | null;
  movieCollectionBaseName: string | null;
  showCollectionBaseName: string | null;
  userOverrides: ImmaculateTasteProfileUserOverrideView[];
  createdAt: string;
  updatedAt: string;
};

export type ImmaculateTasteProfileUserOverrideView = {
  plexUserId: string;
  mediaType: MediaType;
  matchMode: MatchMode;
  genres: string[];
  audioLanguages: string[];
  radarrInstanceId: string | null;
  sonarrInstanceId: string | null;
  movieCollectionBaseName: string | null;
  showCollectionBaseName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedProfileForSeed = {
  id: string;
  datasetId: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: number;
  mediaType: MediaType;
  matchMode: MatchMode;
  genres: string[];
  audioLanguages: string[];
  radarrInstanceId: string | null;
  sonarrInstanceId: string | null;
  movieCollectionBaseName: string | null;
  showCollectionBaseName: string | null;
};

type ProfileSettingsView = {
  mediaType: MediaType;
  matchMode: MatchMode;
  genres: string[];
  audioLanguages: string[];
  radarrInstanceId: string | null;
  sonarrInstanceId: string | null;
  movieCollectionBaseName: string | null;
  showCollectionBaseName: string | null;
};

const IMMACULATE_TASTE_PROFILE_ACTION_JOB_ID = 'immaculateTasteProfileAction';

type JobReportIssue = {
  level: 'warn' | 'error';
  message: string;
};

type ProfileActionTask = {
  id: string;
  title: string;
  status: 'success' | 'skipped' | 'failed';
  facts?: Array<{ label: string; value: Prisma.JsonValue }>;
  issues?: JobReportIssue[];
};

type CollectionRenameResult = {
  attempted: boolean;
  skippedReason: string | null;
  targetUsers: number;
  movieLookups: number;
  movieRenamed: number;
  showLookups: number;
  showRenamed: number;
  failures: string[];
};

type CollectionCleanupResult = {
  attempted: boolean;
  skippedReason: string | null;
  targetUsers: number;
  movieLookups: number;
  movieDeleted: number;
  showLookups: number;
  showDeleted: number;
  failures: string[];
};

type CollectionRecreateResult = {
  attempted: boolean;
  skippedReason: string | null;
  targetUsers: number;
  movieLookups: number;
  movieCreated: number;
  showLookups: number;
  showCreated: number;
  failures: string[];
};

function errToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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
  return normalized;
}

function normalizeMediaType(value: string): MediaType {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'movie' || lowered === 'show' || lowered === 'both') {
    return lowered;
  }
  throw new BadRequestException('mediaType must be "movie", "show", or "both"');
}

function normalizeMatchMode(value: string): MatchMode {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'all' || lowered === 'any') return lowered;
  throw new BadRequestException('matchMode must be "all" or "any"');
}

function includesMovies(mediaType: MediaType): boolean {
  return mediaType === 'movie' || mediaType === 'both';
}

function includesShows(mediaType: MediaType): boolean {
  return mediaType === 'show' || mediaType === 'both';
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

function buildImmaculateCollectionLookupNames(
  baseName: string,
  plexUserTitle?: string | null,
): string[] {
  const preferred = buildImmaculateCollectionName(baseName, plexUserTitle);
  const legacy = buildUserCollectionName(baseName, plexUserTitle);
  return Array.from(
    new Set(
      [preferred, legacy]
        .map((name) => name.trim())
        .filter((name) => Boolean(name)),
    ),
  );
}

function normalizeStringList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function parseJsonStringArray(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeStringList(
      parsed
        .map((value) =>
          typeof value === 'string' ? value : String(value ?? ''),
        )
        .map((value) => value.trim())
        .filter(Boolean),
    );
  } catch {
    return [];
  }
}

function intersectCaseInsensitive(left: string[], right: string[]): boolean {
  if (!left.length || !right.length) return false;
  const rightSet = new Set(
    right.map((v) => v.trim().toLowerCase()).filter(Boolean),
  );
  return left.some((v) => rightSet.has(v.trim().toLowerCase()));
}

@Injectable()
export class ImmaculateTasteProfileService {
  private readonly logger = new Logger(ImmaculateTasteProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexUsers: PlexUsersService,
  ) {}

  async list(userId: string): Promise<ImmaculateTasteProfileView[]> {
    await this.ensureDefaultProfile(userId);
    const rows = await this.prisma.immaculateTasteProfile.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        userOverrides: {
          orderBy: [{ createdAt: 'asc' }],
        },
      },
    });
    return rows.map((row) => this.toView(row, row.userOverrides));
  }

  async create(
    userId: string,
    input: ProfileCreate,
  ): Promise<ImmaculateTasteProfileView> {
    await this.ensureDefaultProfile(userId);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('name is required');
    const existing = await this.prisma.immaculateTasteProfile.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(`Profile "${name}" already exists`);
    }
    const maxSort = await this.prisma.immaculateTasteProfile.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });
    const row = await this.prisma.immaculateTasteProfile.create({
      data: {
        userId,
        name,
        enabled: input.enabled ?? true,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        mediaType: input.mediaType ?? 'both',
        matchMode: input.matchMode ?? 'all',
        genres: JSON.stringify(normalizeStringList(input.genres ?? [])),
        audioLanguages: JSON.stringify(
          normalizeStringList(input.audioLanguages ?? []),
        ),
        radarrInstanceId: (input.radarrInstanceId ?? '').trim() || null,
        sonarrInstanceId: (input.sonarrInstanceId ?? '').trim() || null,
        movieCollectionBaseName:
          (input.movieCollectionBaseName ?? '').trim() || null,
        showCollectionBaseName:
          (input.showCollectionBaseName ?? '').trim() || null,
      },
    });
    const view = this.toView(row);
    await this.writeActionRunSafe({
      userId,
      action: 'profile.create',
      profileId: view.id,
      profileName: view.name,
      headline: `Immaculate Taste profile "${view.name}" created.`,
      tasks: [
        {
          id: 'persist_profile',
          title: 'Persist profile settings',
          status: 'success',
          facts: [
            { label: 'Profile id', value: view.id },
            { label: 'Profile name', value: view.name },
            { label: 'Enabled', value: view.enabled },
            { label: 'Media type', value: view.mediaType },
            { label: 'Match mode', value: view.matchMode },
          ],
        },
      ],
      raw: {
        action: 'create',
      },
    });
    return view;
  }

  async update(
    userId: string,
    id: string,
    patch: ProfilePatch,
  ): Promise<ImmaculateTasteProfileView> {
    await this.ensureDefaultProfile(userId);
    const current = await this.requireOwnedProfile(userId, id);
    const scopePlexUserIdRaw =
      patch.scopePlexUserId === undefined ? undefined : patch.scopePlexUserId;
    const scopePlexUserId =
      scopePlexUserIdRaw === undefined
        ? undefined
        : (scopePlexUserIdRaw ?? '').trim() || null;
    if (scopePlexUserId) {
      return this.updateScoped(userId, current, scopePlexUserId, patch);
    }
    const data: Partial<ImmaculateTasteProfile> = {};

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      const existing = await this.prisma.immaculateTasteProfile.findFirst({
        where: { userId, name, id: { not: current.id } },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(`Profile "${name}" already exists`);
      }
      data.name = name;
    }

    if (patch.enabled !== undefined) {
      const nextEnabled = patch.enabled === true;
      if (current.isDefault && !nextEnabled) {
        const fallbackEnabledProfile =
          await this.prisma.immaculateTasteProfile.findFirst({
            where: {
              userId,
              id: { not: current.id },
              enabled: true,
            },
            select: { id: true },
          });
        if (!fallbackEnabledProfile) {
          throw new BadRequestException(
            'Default profile can only be disabled when another enabled profile exists',
          );
        }
      }
      data.enabled = nextEnabled;
    }
    if (patch.sortOrder !== undefined) {
      data.sortOrder = Math.max(0, Math.trunc(patch.sortOrder));
    }
    if (patch.mediaType !== undefined) data.mediaType = patch.mediaType;
    if (patch.matchMode !== undefined) data.matchMode = patch.matchMode;
    if (patch.genres !== undefined) {
      data.genres = JSON.stringify(normalizeStringList(patch.genres));
    }
    if (patch.audioLanguages !== undefined) {
      data.audioLanguages = JSON.stringify(
        normalizeStringList(patch.audioLanguages),
      );
    }
    if (patch.radarrInstanceId !== undefined) {
      data.radarrInstanceId = (patch.radarrInstanceId ?? '').trim() || null;
    }
    if (patch.sonarrInstanceId !== undefined) {
      data.sonarrInstanceId = (patch.sonarrInstanceId ?? '').trim() || null;
    }
    if (patch.movieCollectionBaseName !== undefined) {
      data.movieCollectionBaseName =
        (patch.movieCollectionBaseName ?? '').trim() || null;
    }
    if (patch.showCollectionBaseName !== undefined) {
      data.showCollectionBaseName =
        (patch.showCollectionBaseName ?? '').trim() || null;
    }

    if (!Object.keys(data).length) {
      const view = await this.buildProfileView(userId, current.id);
      await this.writeActionRunSafe({
        userId,
        action: 'profile.update',
        profileId: current.id,
        profileName: current.name,
        headline: `Immaculate Taste profile "${current.name}" update requested with no changes.`,
        tasks: [
          {
            id: 'apply_profile_patch',
            title: 'Apply profile changes',
            status: 'skipped',
            issues: [
              { level: 'warn', message: 'No mutable fields were changed.' },
            ],
          },
        ],
        raw: {
          action: 'update',
          changedFields: [],
        },
      });
      return view;
    }
    const profileOverrides =
      await this.prisma.immaculateTasteProfileUserOverride.findMany({
        where: { profileId: current.id },
      });
    const updated = await this.prisma.immaculateTasteProfile.update({
      where: { id: current.id },
      data,
    });
    const previousMovieBaseName = resolveMovieCollectionBaseName(
      current.movieCollectionBaseName,
    );
    const previousShowBaseName = resolveShowCollectionBaseName(
      current.showCollectionBaseName,
    );
    const nextMovieBaseName = resolveMovieCollectionBaseName(
      updated.movieCollectionBaseName,
    );
    const nextShowBaseName = resolveShowCollectionBaseName(
      updated.showCollectionBaseName,
    );
    const currentMediaType = normalizeMediaType(current.mediaType);
    const updatedMediaType = normalizeMediaType(updated.mediaType);
    const renameMovies =
      previousMovieBaseName !== nextMovieBaseName &&
      (includesMovies(currentMediaType) || includesMovies(updatedMediaType));
    const renameShows =
      previousShowBaseName !== nextShowBaseName &&
      (includesShows(currentMediaType) || includesShows(updatedMediaType));

    let defaultAutoEnabled = false;
    if (current.enabled && updated.enabled === false && !updated.isDefault) {
      defaultAutoEnabled = await this.ensureAtLeastOneEnabledProfile(userId);
    }
    let cleanupResult: CollectionCleanupResult | null = null;
    if (current.enabled && updated.enabled === false) {
      cleanupResult = await this.cleanupCollectionsForProfile(
        userId,
        updated,
        profileOverrides,
      );
    }
    let renameResult: CollectionRenameResult | null = null;
    if (updated.enabled && (renameMovies || renameShows)) {
      renameResult = await this.renameCollectionsForBaseNameChange(userId, {
        renameMovies,
        renameShows,
        previousMovieBaseName,
        nextMovieBaseName,
        previousShowBaseName,
        nextShowBaseName,
        excludePlexUserIds: profileOverrides.map(
          (override) => override.plexUserId,
        ),
      });
    }
    let recreateResult: CollectionRecreateResult | null = null;
    if (!current.enabled && updated.enabled) {
      recreateResult = await this.recreateCollectionsForProfile(
        userId,
        updated,
        profileOverrides,
      );
    }
    const view = await this.buildProfileView(userId, updated.id);
    const tasks: ProfileActionTask[] = [
      {
        id: 'apply_profile_patch',
        title: 'Apply profile changes',
        status: 'success',
        facts: [
          { label: 'Profile id', value: updated.id },
          { label: 'Profile name', value: updated.name },
          { label: 'Changed fields', value: Object.keys(data) },
          { label: 'Enabled', value: updated.enabled },
        ],
      },
    ];
    if (current.enabled && updated.enabled === false && !updated.isDefault) {
      tasks.push({
        id: 'ensure_enabled_fallback',
        title: 'Ensure at least one enabled profile remains',
        status: defaultAutoEnabled ? 'success' : 'skipped',
        facts: [{ label: 'Default auto-enabled', value: defaultAutoEnabled }],
      });
    }
    if (cleanupResult) {
      tasks.push(
        this.buildCleanupTask({
          taskId: 'cleanup_collections_on_disable',
          taskTitle: 'Delete Plex collections for disabled profile',
          result: cleanupResult,
        }),
      );
    }
    if (renameResult) {
      tasks.push(
        this.buildRenameTask({
          taskId: 'rename_collections',
          taskTitle: 'Rename Plex collections',
          result: renameResult,
        }),
      );
    }
    if (recreateResult) {
      tasks.push(
        this.buildRecreateTask({
          taskId: 'recreate_collections_on_enable',
          taskTitle: 'Recreate Plex collections for enabled profile',
          result: recreateResult,
        }),
      );
    }
    await this.writeActionRunSafe({
      userId,
      action: 'profile.update',
      profileId: updated.id,
      profileName: updated.name,
      headline: this.buildProfileActionHeadline({
        profileName: updated.name,
        tasks,
        fallback: `Immaculate Taste profile "${updated.name}" updated.`,
      }),
      tasks,
      raw: {
        action: 'update',
        changedFields: Object.keys(data),
        defaultAutoEnabled,
        renameMovies,
        renameShows,
      },
    });
    return view;
  }

  private async updateScoped(
    userId: string,
    current: ImmaculateTasteProfile,
    scopePlexUserId: string,
    patch: ProfilePatch,
  ): Promise<ImmaculateTasteProfileView> {
    if (
      patch.name !== undefined ||
      patch.enabled !== undefined ||
      patch.sortOrder !== undefined
    ) {
      throw new BadRequestException(
        'name, enabled, and sortOrder can only be updated for all users',
      );
    }

    const plexUser = await this.prisma.plexUser.findFirst({
      where: { id: scopePlexUserId },
      select: { id: true },
    });
    if (!plexUser) {
      throw new BadRequestException(`Unknown Plex user id: ${scopePlexUserId}`);
    }

    const existingOverride =
      await this.prisma.immaculateTasteProfileUserOverride.findUnique({
        where: {
          profileId_plexUserId: {
            profileId: current.id,
            plexUserId: scopePlexUserId,
          },
        },
      });

    const resetScopeToDefaultNaming = patch.resetScopeToDefaultNaming === true;
    const previousSettings = existingOverride
      ? this.toSettingsFromOverride(existingOverride)
      : this.toSettingsFromProfile(current);
    const baseSettings = this.toSettingsFromProfile(current);
    const nextSettings = resetScopeToDefaultNaming
      ? {
          ...baseSettings,
          genres: baseSettings.genres.slice(),
          audioLanguages: baseSettings.audioLanguages.slice(),
        }
      : this.applySettingsPatch(previousSettings, patch);

    const previousMovieBaseName = resolveMovieCollectionBaseName(
      previousSettings.movieCollectionBaseName,
    );
    const previousShowBaseName = resolveShowCollectionBaseName(
      previousSettings.showCollectionBaseName,
    );
    const nextMovieBaseName = resolveMovieCollectionBaseName(
      nextSettings.movieCollectionBaseName,
    );
    const nextShowBaseName = resolveShowCollectionBaseName(
      nextSettings.showCollectionBaseName,
    );
    const renameMovies =
      previousMovieBaseName !== nextMovieBaseName &&
      (includesMovies(previousSettings.mediaType) ||
        includesMovies(nextSettings.mediaType));
    const renameShows =
      previousShowBaseName !== nextShowBaseName &&
      (includesShows(previousSettings.mediaType) ||
        includesShows(nextSettings.mediaType));

    const unchanged = this.areSettingsEqual(previousSettings, nextSettings);
    const shouldInheritBase = this.areSettingsEqual(baseSettings, nextSettings);
    if (unchanged && !shouldInheritBase) {
      const view = await this.buildProfileView(userId, current.id);
      await this.writeActionRunSafe({
        userId,
        action: 'profile.updateScoped',
        profileId: current.id,
        profileName: current.name,
        headline: `Immaculate Taste profile "${current.name}" scoped update requested with no changes.`,
        tasks: [
          {
            id: 'apply_scoped_patch',
            title: 'Apply user-scoped profile changes',
            status: 'skipped',
            facts: [{ label: 'Scoped Plex user id', value: scopePlexUserId }],
            issues: [
              { level: 'warn', message: 'No scoped fields were changed.' },
            ],
          },
        ],
        raw: {
          action: 'updateScoped',
          scopePlexUserId,
          changedFields: [],
        },
      });
      return view;
    }

    let scopedOverrideTask: ProfileActionTask = {
      id: 'apply_scoped_patch',
      title: 'Apply user-scoped profile changes',
      status: 'success',
      facts: [{ label: 'Scoped Plex user id', value: scopePlexUserId }],
    };
    if (shouldInheritBase) {
      if (existingOverride) {
        await this.prisma.immaculateTasteProfileUserOverride.delete({
          where: { id: existingOverride.id },
        });
        scopedOverrideTask = {
          id: 'apply_scoped_patch',
          title: 'Reset user scope back to inherited defaults',
          status: 'success',
          facts: [
            { label: 'Scoped Plex user id', value: scopePlexUserId },
            { label: 'Removed override id', value: existingOverride.id },
          ],
        };
      } else {
        scopedOverrideTask = {
          id: 'apply_scoped_patch',
          title: 'Reset user scope back to inherited defaults',
          status: 'skipped',
          facts: [{ label: 'Scoped Plex user id', value: scopePlexUserId }],
          issues: [
            { level: 'warn', message: 'No scoped override existed to reset.' },
          ],
        };
      }
    } else if (existingOverride) {
      await this.prisma.immaculateTasteProfileUserOverride.update({
        where: { id: existingOverride.id },
        data: {
          mediaType: nextSettings.mediaType,
          matchMode: nextSettings.matchMode,
          genres: JSON.stringify(nextSettings.genres),
          audioLanguages: JSON.stringify(nextSettings.audioLanguages),
          radarrInstanceId: nextSettings.radarrInstanceId,
          sonarrInstanceId: nextSettings.sonarrInstanceId,
          movieCollectionBaseName: nextSettings.movieCollectionBaseName,
          showCollectionBaseName: nextSettings.showCollectionBaseName,
        },
      });
      scopedOverrideTask = {
        id: 'apply_scoped_patch',
        title: 'Update user-scoped override',
        status: 'success',
        facts: [
          { label: 'Scoped Plex user id', value: scopePlexUserId },
          { label: 'Override id', value: existingOverride.id },
        ],
      };
    } else {
      await this.prisma.immaculateTasteProfileUserOverride.create({
        data: {
          profileId: current.id,
          plexUserId: scopePlexUserId,
          mediaType: nextSettings.mediaType,
          matchMode: nextSettings.matchMode,
          genres: JSON.stringify(nextSettings.genres),
          audioLanguages: JSON.stringify(nextSettings.audioLanguages),
          radarrInstanceId: nextSettings.radarrInstanceId,
          sonarrInstanceId: nextSettings.sonarrInstanceId,
          movieCollectionBaseName: nextSettings.movieCollectionBaseName,
          showCollectionBaseName: nextSettings.showCollectionBaseName,
        },
      });
      scopedOverrideTask = {
        id: 'apply_scoped_patch',
        title: 'Create user-scoped override',
        status: 'success',
        facts: [{ label: 'Scoped Plex user id', value: scopePlexUserId }],
      };
    }

    let renameResult: CollectionRenameResult | null = null;
    if (current.enabled && (renameMovies || renameShows)) {
      renameResult = await this.renameCollectionsForBaseNameChange(userId, {
        renameMovies,
        renameShows,
        previousMovieBaseName,
        nextMovieBaseName,
        previousShowBaseName,
        nextShowBaseName,
        targetPlexUserIds: [scopePlexUserId],
      });
    }

    const view = await this.buildProfileView(userId, current.id);
    const tasks: ProfileActionTask[] = [scopedOverrideTask];
    if (renameResult) {
      tasks.push(
        this.buildRenameTask({
          taskId: 'rename_scoped_collections',
          taskTitle: 'Rename scoped Plex collections to updated base names',
          result: renameResult,
        }),
      );
    }
    await this.writeActionRunSafe({
      userId,
      action: 'profile.updateScoped',
      profileId: current.id,
      profileName: current.name,
      headline: this.buildProfileActionHeadline({
        profileName: current.name,
        tasks,
        fallback: `Immaculate Taste profile "${current.name}" scoped settings updated.`,
      }),
      tasks,
      raw: {
        action: 'updateScoped',
        scopePlexUserId,
        resetScopeToDefaultNaming,
        renameMovies,
        renameShows,
      },
    });
    return view;
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.ensureDefaultProfile(userId);
    const current = await this.requireOwnedProfile(userId, id);
    if (current.isDefault) {
      throw new BadRequestException('Default profile cannot be deleted');
    }
    const profileOverrides =
      await this.prisma.immaculateTasteProfileUserOverride.findMany({
        where: { profileId: current.id },
      });
    const cleanupResult = await this.cleanupCollectionsForProfile(
      userId,
      current,
      profileOverrides,
    );
    let movedMovieRows = 0;
    let movedShowRows = 0;
    let defaultAutoEnabled = false;
    await this.prisma.$transaction(async (tx) => {
      const movieRes = await tx.immaculateTasteMovieLibrary.updateMany({
        where: { plexUserId: userId, profileId: current.id },
        data: { profileId: 'default' },
      });
      const showRes = await tx.immaculateTasteShowLibrary.updateMany({
        where: { plexUserId: userId, profileId: current.id },
        data: { profileId: 'default' },
      });
      movedMovieRows = movieRes.count;
      movedShowRows = showRes.count;
      await tx.immaculateTasteProfile.delete({ where: { id: current.id } });

      // Ensure at least one enabled profile always remains after deletion.
      const enabledProfile = await tx.immaculateTasteProfile.findFirst({
        where: { userId, enabled: true },
        select: { id: true },
      });
      if (!enabledProfile) {
        const enableRes = await tx.immaculateTasteProfile.updateMany({
          where: { userId, isDefault: true },
          data: { enabled: true },
        });
        defaultAutoEnabled = enableRes.count > 0;
      }
    });
    await this.writeActionRunSafe({
      userId,
      action: 'profile.delete',
      profileId: current.id,
      profileName: current.name,
      headline: `Immaculate Taste profile "${current.name}" deleted.`,
      tasks: [
        this.buildCleanupTask({
          taskId: 'cleanup_collections_on_delete',
          taskTitle: 'Delete Plex collections for deleted profile',
          result: cleanupResult,
        }),
        {
          id: 'delete_profile',
          title: 'Delete profile and reassign linked libraries',
          status: 'success',
          facts: [
            { label: 'Profile id', value: current.id },
            { label: 'Movie libraries reassigned', value: movedMovieRows },
            { label: 'TV libraries reassigned', value: movedShowRows },
          ],
        },
        {
          id: 'ensure_enabled_fallback',
          title: 'Ensure at least one enabled profile remains',
          status: defaultAutoEnabled ? 'success' : 'skipped',
          facts: [{ label: 'Default auto-enabled', value: defaultAutoEnabled }],
        },
      ],
      raw: {
        action: 'delete',
        movedMovieRows,
        movedShowRows,
        defaultAutoEnabled,
      },
    });
  }

  async reorder(
    userId: string,
    ids: string[],
  ): Promise<ImmaculateTasteProfileView[]> {
    await this.ensureDefaultProfile(userId);
    const normalizedIds = normalizeStringList(ids);
    if (!normalizedIds.length) {
      throw new BadRequestException('ids must include at least one profile id');
    }
    const rows = await this.prisma.immaculateTasteProfile.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const unknown = normalizedIds.filter((id) => !byId.has(id));
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown profile id(s): ${unknown.join(', ')}`,
      );
    }
    const orderedIds = [
      ...normalizedIds,
      ...rows.map((row) => row.id).filter((id) => !normalizedIds.includes(id)),
    ];
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.immaculateTasteProfile.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    const profiles = await this.list(userId);
    await this.writeActionRunSafe({
      userId,
      action: 'profile.reorder',
      profileId: null,
      profileName: null,
      headline: 'Immaculate Taste profile order updated.',
      tasks: [
        {
          id: 'reorder_profiles',
          title: 'Persist profile order',
          status: 'success',
          facts: [
            { label: 'Updated profiles', value: orderedIds.length },
            { label: 'Ordered ids', value: orderedIds },
          ],
        },
      ],
      raw: {
        action: 'reorder',
        orderedIds,
      },
    });
    return profiles;
  }

  async resolveProfileForSeed(
    userId: string,
    params: {
      plexUserId?: string;
      seedGenres: string[];
      seedAudioLanguages: string[];
      seedMediaType: 'movie' | 'show';
    },
  ): Promise<ResolvedProfileForSeed | null> {
    const all = await this.list(userId);
    const enabled = all.filter((profile) => profile.enabled);
    const seedGenres = normalizeStringList(params.seedGenres ?? []);
    const seedAudioLanguages = normalizeStringList(
      params.seedAudioLanguages ?? [],
    );

    for (const profile of enabled) {
      const scopedProfile = this.toScopedProfile(profile, params.plexUserId);
      if (
        scopedProfile.mediaType !== 'both' &&
        scopedProfile.mediaType !== params.seedMediaType
      ) {
        continue;
      }

      const isDefaultCatchAll =
        scopedProfile.isDefault &&
        scopedProfile.genres.length === 0 &&
        scopedProfile.audioLanguages.length === 0;
      if (isDefaultCatchAll) {
        return this.toResolved(scopedProfile);
      }

      const genreMatch =
        scopedProfile.genres.length === 0 ||
        intersectCaseInsensitive(seedGenres, scopedProfile.genres);
      const langMatch =
        scopedProfile.audioLanguages.length === 0 ||
        intersectCaseInsensitive(
          seedAudioLanguages,
          scopedProfile.audioLanguages,
        );
      const matched =
        scopedProfile.matchMode === 'all'
          ? genreMatch && langMatch
          : genreMatch || langMatch;
      if (!matched) continue;
      return this.toResolved(scopedProfile);
    }
    return null;
  }

  private async ensureDefaultProfile(userId: string): Promise<void> {
    const rows = await this.prisma.immaculateTasteProfile.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (!rows.length) {
      await this.prisma.immaculateTasteProfile.create({
        data: {
          userId,
          name: 'Default',
          isDefault: true,
          enabled: true,
          sortOrder: 0,
          mediaType: 'both',
          matchMode: 'all',
          genres: '[]',
          audioLanguages: '[]',
        },
      });
      return;
    }
    const defaultRow = rows.find((row) => row.isDefault);
    if (defaultRow) return;
    const existingNames = new Set(rows.map((row) => row.name.toLowerCase()));
    let defaultName = 'Default';
    if (existingNames.has(defaultName.toLowerCase())) {
      defaultName = 'Default profile';
    }
    await this.prisma.$transaction([
      this.prisma.immaculateTasteProfile.updateMany({
        where: { userId, sortOrder: { gte: 0 } },
        data: { sortOrder: { increment: 1 } },
      }),
      this.prisma.immaculateTasteProfile.create({
        data: {
          userId,
          name: defaultName,
          isDefault: true,
          enabled: true,
          sortOrder: 0,
          mediaType: 'both',
          matchMode: 'all',
          genres: '[]',
          audioLanguages: '[]',
        },
      }),
    ]);
  }

  private async requireOwnedProfile(userId: string, id: string) {
    const normalized = id.trim();
    if (!normalized) throw new BadRequestException('id is required');
    const row = await this.prisma.immaculateTasteProfile.findFirst({
      where: { userId, id: normalized },
    });
    if (!row) throw new NotFoundException('Profile not found');
    return row;
  }

  private async buildProfileView(
    userId: string,
    profileId: string,
  ): Promise<ImmaculateTasteProfileView> {
    const row = await this.prisma.immaculateTasteProfile.findFirst({
      where: { userId, id: profileId },
      include: {
        userOverrides: {
          orderBy: [{ createdAt: 'asc' }],
        },
      },
    });
    if (!row) throw new NotFoundException('Profile not found');
    return this.toView(row, row.userOverrides);
  }

  private toScopedProfile(
    profile: ImmaculateTasteProfileView,
    plexUserId: string | undefined,
  ): ImmaculateTasteProfileView {
    if (!plexUserId) return profile;
    const override =
      profile.userOverrides.find((item) => item.plexUserId === plexUserId) ??
      null;
    if (!override) return profile;
    return {
      ...profile,
      mediaType: override.mediaType,
      matchMode: override.matchMode,
      genres: override.genres,
      audioLanguages: override.audioLanguages,
      radarrInstanceId: override.radarrInstanceId,
      sonarrInstanceId: override.sonarrInstanceId,
      movieCollectionBaseName: override.movieCollectionBaseName,
      showCollectionBaseName: override.showCollectionBaseName,
    };
  }

  private toResolved(
    profile: ImmaculateTasteProfileView,
  ): ResolvedProfileForSeed {
    return {
      id: profile.id,
      datasetId: profile.datasetId,
      name: profile.name,
      isDefault: profile.isDefault,
      enabled: profile.enabled,
      sortOrder: profile.sortOrder,
      mediaType: profile.mediaType,
      matchMode: profile.matchMode,
      genres: profile.genres,
      audioLanguages: profile.audioLanguages,
      radarrInstanceId: profile.radarrInstanceId,
      sonarrInstanceId: profile.sonarrInstanceId,
      movieCollectionBaseName: profile.movieCollectionBaseName,
      showCollectionBaseName: profile.showCollectionBaseName,
    };
  }

  private async ensureAtLeastOneEnabledProfile(
    userId: string,
  ): Promise<boolean> {
    const enabledProfile = await this.prisma.immaculateTasteProfile.findFirst({
      where: { userId, enabled: true },
      select: { id: true },
    });
    if (enabledProfile) return false;
    const res = await this.prisma.immaculateTasteProfile.updateMany({
      where: { userId, isDefault: true, enabled: false },
      data: { enabled: true },
    });
    return res.count > 0;
  }

  private toSettingsFromProfile(
    profile: ImmaculateTasteProfile,
  ): ProfileSettingsView {
    return {
      mediaType: normalizeMediaType(profile.mediaType),
      matchMode: normalizeMatchMode(profile.matchMode),
      genres: parseJsonStringArray(profile.genres),
      audioLanguages: parseJsonStringArray(profile.audioLanguages),
      radarrInstanceId: profile.radarrInstanceId,
      sonarrInstanceId: profile.sonarrInstanceId,
      movieCollectionBaseName: profile.movieCollectionBaseName,
      showCollectionBaseName: profile.showCollectionBaseName,
    };
  }

  private toSettingsFromOverride(
    override: ImmaculateTasteProfileUserOverride,
  ): ProfileSettingsView {
    return {
      mediaType: normalizeMediaType(override.mediaType),
      matchMode: normalizeMatchMode(override.matchMode),
      genres: parseJsonStringArray(override.genres),
      audioLanguages: parseJsonStringArray(override.audioLanguages),
      radarrInstanceId: override.radarrInstanceId,
      sonarrInstanceId: override.sonarrInstanceId,
      movieCollectionBaseName: override.movieCollectionBaseName,
      showCollectionBaseName: override.showCollectionBaseName,
    };
  }

  private applySettingsPatch(
    base: ProfileSettingsView,
    patch: ProfilePatch,
  ): ProfileSettingsView {
    return {
      mediaType: patch.mediaType ?? base.mediaType,
      matchMode: patch.matchMode ?? base.matchMode,
      genres:
        patch.genres !== undefined
          ? normalizeStringList(patch.genres)
          : base.genres.slice(),
      audioLanguages:
        patch.audioLanguages !== undefined
          ? normalizeStringList(patch.audioLanguages)
          : base.audioLanguages.slice(),
      radarrInstanceId:
        patch.radarrInstanceId !== undefined
          ? (patch.radarrInstanceId ?? '').trim() || null
          : base.radarrInstanceId,
      sonarrInstanceId:
        patch.sonarrInstanceId !== undefined
          ? (patch.sonarrInstanceId ?? '').trim() || null
          : base.sonarrInstanceId,
      movieCollectionBaseName:
        patch.movieCollectionBaseName !== undefined
          ? (patch.movieCollectionBaseName ?? '').trim() || null
          : base.movieCollectionBaseName,
      showCollectionBaseName:
        patch.showCollectionBaseName !== undefined
          ? (patch.showCollectionBaseName ?? '').trim() || null
          : base.showCollectionBaseName,
    };
  }

  private areSettingsEqual(
    left: ProfileSettingsView,
    right: ProfileSettingsView,
  ): boolean {
    return (
      left.mediaType === right.mediaType &&
      left.matchMode === right.matchMode &&
      left.radarrInstanceId === right.radarrInstanceId &&
      left.sonarrInstanceId === right.sonarrInstanceId &&
      (left.movieCollectionBaseName ?? null) ===
        (right.movieCollectionBaseName ?? null) &&
      (left.showCollectionBaseName ?? null) ===
        (right.showCollectionBaseName ?? null) &&
      JSON.stringify(left.genres) === JSON.stringify(right.genres) &&
      JSON.stringify(left.audioLanguages) ===
        JSON.stringify(right.audioLanguages)
    );
  }

  private toOverrideView(
    row: ImmaculateTasteProfileUserOverride,
  ): ImmaculateTasteProfileUserOverrideView {
    return {
      plexUserId: row.plexUserId,
      mediaType: normalizeMediaType(row.mediaType),
      matchMode: normalizeMatchMode(row.matchMode),
      genres: parseJsonStringArray(row.genres),
      audioLanguages: parseJsonStringArray(row.audioLanguages),
      radarrInstanceId: row.radarrInstanceId,
      sonarrInstanceId: row.sonarrInstanceId,
      movieCollectionBaseName: row.movieCollectionBaseName,
      showCollectionBaseName: row.showCollectionBaseName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toView(
    row: ImmaculateTasteProfile,
    overrides: ImmaculateTasteProfileUserOverride[] = [],
  ): ImmaculateTasteProfileView {
    const mediaType = normalizeMediaType(row.mediaType);
    const matchMode = normalizeMatchMode(row.matchMode);
    return {
      id: row.id,
      datasetId: row.isDefault ? 'default' : row.id,
      name: row.name,
      isDefault: row.isDefault,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      mediaType,
      matchMode,
      genres: parseJsonStringArray(row.genres),
      audioLanguages: parseJsonStringArray(row.audioLanguages),
      radarrInstanceId: row.radarrInstanceId,
      sonarrInstanceId: row.sonarrInstanceId,
      movieCollectionBaseName: row.movieCollectionBaseName,
      showCollectionBaseName: row.showCollectionBaseName,
      userOverrides: overrides.map((override) => this.toOverrideView(override)),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async renameCollectionsForBaseNameChange(
    userId: string,
    params: {
      renameMovies: boolean;
      renameShows: boolean;
      previousMovieBaseName: string;
      nextMovieBaseName: string;
      previousShowBaseName: string;
      nextShowBaseName: string;
      targetPlexUserIds?: string[];
      excludePlexUserIds?: string[];
    },
  ): Promise<CollectionRenameResult> {
    const result: CollectionRenameResult = {
      attempted: false,
      skippedReason: null,
      targetUsers: 0,
      movieLookups: 0,
      movieRenamed: 0,
      showLookups: 0,
      showRenamed: 0,
      failures: [],
    };
    if (!params.renameMovies && !params.renameShows) {
      result.skippedReason =
        'No collection base-name changes required a rename.';
      return result;
    }
    result.attempted = true;

    let settings: Record<string, unknown>;
    let secrets: Record<string, unknown>;
    try {
      ({ settings, secrets } =
        await this.settingsService.getInternalSettings(userId));
    } catch (error) {
      result.failures.push(
        `Failed to load internal settings: ${errToMessage(error)}`,
      );
      return result;
    }

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw || !plexToken) {
      result.skippedReason = 'Plex is not configured for this user.';
      return result;
    }

    let baseUrl: string;
    try {
      baseUrl = normalizeHttpUrl(plexBaseUrlRaw);
    } catch (error) {
      result.failures.push(`Invalid Plex base URL: ${errToMessage(error)}`);
      return result;
    }

    let sections: Array<{ key: string; title: string; type?: string }> = [];
    try {
      sections = await this.plexServer.getSections({
        baseUrl,
        token: plexToken,
      });
    } catch (error) {
      result.failures.push(
        `Failed to fetch Plex sections: ${errToMessage(error)}`,
      );
      return result;
    }
    const librarySelection = resolvePlexLibrarySelection({
      settings,
      sections,
    });
    const selectedSectionKeys = new Set(librarySelection.selectedSectionKeys);
    const movieSections = sections.filter(
      (section) =>
        params.renameMovies &&
        (section.type ?? '').toLowerCase() === 'movie' &&
        selectedSectionKeys.has(section.key),
    );
    const showSections = sections.filter(
      (section) =>
        params.renameShows &&
        (section.type ?? '').toLowerCase() === 'show' &&
        selectedSectionKeys.has(section.key),
    );
    if (!movieSections.length && !showSections.length) {
      result.skippedReason =
        'No selected Plex libraries matched the rename scope.';
      return result;
    }

    let normalizedUsers: Array<{
      id: string;
      plexAccountTitle: string;
      isAdmin: boolean;
    }> = [];
    try {
      const admin = await this.plexUsers.ensureAdminPlexUser({ userId });
      const users = await this.prisma.plexUser.findMany({
        orderBy: [{ isAdmin: 'desc' }, { plexAccountTitle: 'asc' }],
        select: {
          id: true,
          plexAccountTitle: true,
          isAdmin: true,
        },
      });
      const hasAdmin = users.some((user) => user.id === admin.id);
      normalizedUsers = hasAdmin
        ? users
        : [
            {
              id: admin.id,
              plexAccountTitle: admin.plexAccountTitle,
              isAdmin: true,
            },
            ...users,
          ];
    } catch (error) {
      result.failures.push(
        `Failed to resolve Plex users: ${errToMessage(error)}`,
      );
      return result;
    }

    const monitoringSelection = resolvePlexUserMonitoringSelection({
      settings,
      users: normalizedUsers,
    });
    const selectedUsers = normalizedUsers.filter((user) =>
      monitoringSelection.selectedPlexUserIds.includes(user.id),
    );
    const targetSet =
      params.targetPlexUserIds && params.targetPlexUserIds.length
        ? new Set(params.targetPlexUserIds)
        : null;
    const excludeSet = new Set(params.excludePlexUserIds ?? []);
    const filteredUsers = selectedUsers.filter((user) => {
      if (excludeSet.has(user.id)) return false;
      if (targetSet && !targetSet.has(user.id)) return false;
      return true;
    });
    result.targetUsers = filteredUsers.length;
    if (!filteredUsers.length) {
      result.skippedReason =
        'No monitored Plex users matched the rename scope.';
      return result;
    }

    for (const user of filteredUsers) {
      if (params.renameMovies) {
        const previousMovieNameCandidates =
          buildImmaculateCollectionLookupNames(
            params.previousMovieBaseName,
            user.plexAccountTitle,
          );
        const nextMovieName = buildImmaculateCollectionName(
          params.nextMovieBaseName,
          user.plexAccountTitle,
        );
        if (
          previousMovieNameCandidates.length &&
          nextMovieName &&
          !previousMovieNameCandidates.includes(nextMovieName)
        ) {
          for (const section of movieSections) {
            await this.cleanupDuplicateEmptyCollections({
              baseUrl,
              token: plexToken,
              librarySectionKey: section.key,
              candidateNames: [...previousMovieNameCandidates, nextMovieName],
              resultFailures: result.failures,
              failurePrefix: `Movie duplicate cleanup failed for user=${user.id}, section=${section.key}`,
            });
            let ratingKey: string | null = null;
            for (const previousMovieName of previousMovieNameCandidates) {
              result.movieLookups += 1;
              try {
                ratingKey = await this.plexServer.findCollectionRatingKey({
                  baseUrl,
                  token: plexToken,
                  librarySectionKey: section.key,
                  collectionName: previousMovieName,
                });
              } catch (error) {
                result.failures.push(
                  `Movie lookup failed for user=${user.id}, section=${section.key}, name="${previousMovieName}": ${errToMessage(error)}`,
                );
              }
              if (ratingKey) break;
            }
            if (!ratingKey) continue;
            try {
              await this.plexServer.renameCollection({
                baseUrl,
                token: plexToken,
                librarySectionKey: section.key,
                collectionRatingKey: ratingKey,
                collectionName: nextMovieName,
              });
              result.movieRenamed += 1;
            } catch (error) {
              result.failures.push(
                `Movie rename failed for user=${user.id}, section=${section.key}, ratingKey=${ratingKey}: ${errToMessage(error)}`,
              );
            }
          }
        }
      }

      if (params.renameShows) {
        const previousShowNameCandidates = buildImmaculateCollectionLookupNames(
          params.previousShowBaseName,
          user.plexAccountTitle,
        );
        const nextShowName = buildImmaculateCollectionName(
          params.nextShowBaseName,
          user.plexAccountTitle,
        );
        if (
          previousShowNameCandidates.length &&
          nextShowName &&
          !previousShowNameCandidates.includes(nextShowName)
        ) {
          for (const section of showSections) {
            await this.cleanupDuplicateEmptyCollections({
              baseUrl,
              token: plexToken,
              librarySectionKey: section.key,
              candidateNames: [...previousShowNameCandidates, nextShowName],
              resultFailures: result.failures,
              failurePrefix: `TV duplicate cleanup failed for user=${user.id}, section=${section.key}`,
            });
            let ratingKey: string | null = null;
            for (const previousShowName of previousShowNameCandidates) {
              result.showLookups += 1;
              try {
                ratingKey = await this.plexServer.findCollectionRatingKey({
                  baseUrl,
                  token: plexToken,
                  librarySectionKey: section.key,
                  collectionName: previousShowName,
                });
              } catch (error) {
                result.failures.push(
                  `TV lookup failed for user=${user.id}, section=${section.key}, name="${previousShowName}": ${errToMessage(error)}`,
                );
              }
              if (ratingKey) break;
            }
            if (!ratingKey) continue;
            try {
              await this.plexServer.renameCollection({
                baseUrl,
                token: plexToken,
                librarySectionKey: section.key,
                collectionRatingKey: ratingKey,
                collectionName: nextShowName,
              });
              result.showRenamed += 1;
            } catch (error) {
              result.failures.push(
                `TV rename failed for user=${user.id}, section=${section.key}, ratingKey=${ratingKey}: ${errToMessage(error)}`,
              );
            }
          }
        }
      }
    }

    return result;
  }

  private async cleanupCollectionsForProfile(
    userId: string,
    profile: ImmaculateTasteProfile,
    profileOverrides: ImmaculateTasteProfileUserOverride[] = [],
  ): Promise<CollectionCleanupResult> {
    const result: CollectionCleanupResult = {
      attempted: false,
      skippedReason: null,
      targetUsers: 0,
      movieLookups: 0,
      movieDeleted: 0,
      showLookups: 0,
      showDeleted: 0,
      failures: [],
    };
    const mediaType = normalizeMediaType(profile.mediaType);
    const includeMovies = mediaType === 'movie' || mediaType === 'both';
    const includeShows = mediaType === 'show' || mediaType === 'both';
    if (!includeMovies && !includeShows) {
      result.skippedReason =
        'Profile media type has no enabled collection scope.';
      return result;
    }
    result.attempted = true;

    let settings: Record<string, unknown>;
    let secrets: Record<string, unknown>;
    try {
      ({ settings, secrets } =
        await this.settingsService.getInternalSettings(userId));
    } catch (error) {
      result.failures.push(
        `Failed to load internal settings: ${errToMessage(error)}`,
      );
      return result;
    }
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw || !plexToken) {
      result.skippedReason = 'Plex is not configured for this user.';
      return result;
    }

    let baseUrl: string;
    try {
      baseUrl = normalizeHttpUrl(plexBaseUrlRaw);
    } catch (error) {
      result.failures.push(`Invalid Plex base URL: ${errToMessage(error)}`);
      return result;
    }

    let sections: Array<{ key: string; title: string; type?: string }> = [];
    try {
      sections = await this.plexServer.getSections({
        baseUrl,
        token: plexToken,
      });
    } catch (error) {
      result.failures.push(
        `Failed to fetch Plex sections: ${errToMessage(error)}`,
      );
      return result;
    }
    const librarySelection = resolvePlexLibrarySelection({
      settings,
      sections,
    });
    const selectedSectionKeys = new Set(librarySelection.selectedSectionKeys);
    const movieSections = sections.filter(
      (section) =>
        includeMovies &&
        (section.type ?? '').toLowerCase() === 'movie' &&
        selectedSectionKeys.has(section.key),
    );
    const showSections = sections.filter(
      (section) =>
        includeShows &&
        (section.type ?? '').toLowerCase() === 'show' &&
        selectedSectionKeys.has(section.key),
    );
    if (!movieSections.length && !showSections.length) {
      result.skippedReason = 'No selected Plex libraries matched this profile.';
      return result;
    }

    let normalizedUsers: Array<{
      id: string;
      plexAccountTitle: string;
      isAdmin: boolean;
    }> = [];
    try {
      const admin = await this.plexUsers.ensureAdminPlexUser({ userId });
      const users = await this.prisma.plexUser.findMany({
        orderBy: [{ isAdmin: 'desc' }, { plexAccountTitle: 'asc' }],
        select: {
          id: true,
          plexAccountTitle: true,
          isAdmin: true,
        },
      });
      const hasAdmin = users.some((user) => user.id === admin.id);
      normalizedUsers = hasAdmin
        ? users
        : [
            {
              id: admin.id,
              plexAccountTitle: admin.plexAccountTitle,
              isAdmin: true,
            },
            ...users,
          ];
    } catch (error) {
      result.failures.push(
        `Failed to resolve Plex users: ${errToMessage(error)}`,
      );
      return result;
    }
    const monitoringSelection = resolvePlexUserMonitoringSelection({
      settings,
      users: normalizedUsers,
    });
    const selectedUsers = normalizedUsers.filter((user) =>
      monitoringSelection.selectedPlexUserIds.includes(user.id),
    );
    result.targetUsers = selectedUsers.length;
    if (!selectedUsers.length) {
      result.skippedReason = 'No monitored Plex users are selected.';
      return result;
    }

    const overrideByPlexUserId = new Map(
      profileOverrides.map((override) => [override.plexUserId, override]),
    );

    for (const user of selectedUsers) {
      const userOverride = overrideByPlexUserId.get(user.id);
      const movieBase = resolveMovieCollectionBaseName(
        userOverride?.movieCollectionBaseName ??
          profile.movieCollectionBaseName,
      );
      const showBase = resolveShowCollectionBaseName(
        userOverride?.showCollectionBaseName ?? profile.showCollectionBaseName,
      );
      const movieNames = buildImmaculateCollectionLookupNames(
        movieBase,
        user.plexAccountTitle,
      );
      const showNames = buildImmaculateCollectionLookupNames(
        showBase,
        user.plexAccountTitle,
      );
      for (const section of movieSections) {
        await this.cleanupDuplicateEmptyCollections({
          baseUrl,
          token: plexToken,
          librarySectionKey: section.key,
          candidateNames: movieNames,
          resultFailures: result.failures,
          failurePrefix: `Movie duplicate cleanup failed for user=${user.id}, section=${section.key}`,
        });
        for (const movieName of movieNames) {
          for (;;) {
            result.movieLookups += 1;
            let ratingKey: string | null = null;
            try {
              ratingKey = await this.plexServer.findCollectionRatingKey({
                baseUrl,
                token: plexToken,
                librarySectionKey: section.key,
                collectionName: movieName,
              });
            } catch (error) {
              result.failures.push(
                `Movie lookup failed for user=${user.id}, section=${section.key}, name="${movieName}": ${errToMessage(error)}`,
              );
            }
            if (!ratingKey) break;
            try {
              await this.plexServer.deleteCollection({
                baseUrl,
                token: plexToken,
                collectionRatingKey: ratingKey,
              });
              result.movieDeleted += 1;
            } catch (error) {
              result.failures.push(
                `Movie delete failed for user=${user.id}, ratingKey=${ratingKey}: ${errToMessage(error)}`,
              );
              break;
            }
          }
        }
      }
      for (const section of showSections) {
        await this.cleanupDuplicateEmptyCollections({
          baseUrl,
          token: plexToken,
          librarySectionKey: section.key,
          candidateNames: showNames,
          resultFailures: result.failures,
          failurePrefix: `TV duplicate cleanup failed for user=${user.id}, section=${section.key}`,
        });
        for (const showName of showNames) {
          for (;;) {
            result.showLookups += 1;
            let ratingKey: string | null = null;
            try {
              ratingKey = await this.plexServer.findCollectionRatingKey({
                baseUrl,
                token: plexToken,
                librarySectionKey: section.key,
                collectionName: showName,
              });
            } catch (error) {
              result.failures.push(
                `TV lookup failed for user=${user.id}, section=${section.key}, name="${showName}": ${errToMessage(error)}`,
              );
            }
            if (!ratingKey) break;
            try {
              await this.plexServer.deleteCollection({
                baseUrl,
                token: plexToken,
                collectionRatingKey: ratingKey,
              });
              result.showDeleted += 1;
            } catch (error) {
              result.failures.push(
                `TV delete failed for user=${user.id}, ratingKey=${ratingKey}: ${errToMessage(error)}`,
              );
              break;
            }
          }
        }
      }
    }

    return result;
  }

  private async recreateCollectionsForProfile(
    userId: string,
    profile: ImmaculateTasteProfile,
    profileOverrides: ImmaculateTasteProfileUserOverride[] = [],
  ): Promise<CollectionRecreateResult> {
    const result: CollectionRecreateResult = {
      attempted: false,
      skippedReason: null,
      targetUsers: 0,
      movieLookups: 0,
      movieCreated: 0,
      showLookups: 0,
      showCreated: 0,
      failures: [],
    };
    const mediaType = normalizeMediaType(profile.mediaType);
    const includeMovies = mediaType === 'movie' || mediaType === 'both';
    const includeShows = mediaType === 'show' || mediaType === 'both';
    if (!includeMovies && !includeShows) {
      result.skippedReason =
        'Profile media type has no enabled collection scope.';
      return result;
    }
    result.attempted = true;

    let settings: Record<string, unknown>;
    let secrets: Record<string, unknown>;
    try {
      ({ settings, secrets } =
        await this.settingsService.getInternalSettings(userId));
    } catch (error) {
      result.failures.push(
        `Failed to load internal settings: ${errToMessage(error)}`,
      );
      return result;
    }
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw || !plexToken) {
      result.skippedReason = 'Plex is not configured for this user.';
      return result;
    }

    let baseUrl: string;
    try {
      baseUrl = normalizeHttpUrl(plexBaseUrlRaw);
    } catch (error) {
      result.failures.push(`Invalid Plex base URL: ${errToMessage(error)}`);
      return result;
    }

    let sections: Array<{ key: string; title: string; type?: string }> = [];
    try {
      sections = await this.plexServer.getSections({
        baseUrl,
        token: plexToken,
      });
    } catch (error) {
      result.failures.push(
        `Failed to fetch Plex sections: ${errToMessage(error)}`,
      );
      return result;
    }
    const librarySelection = resolvePlexLibrarySelection({
      settings,
      sections,
    });
    const selectedSectionKeys = new Set(librarySelection.selectedSectionKeys);
    const movieSections = sections.filter(
      (section) =>
        includeMovies &&
        (section.type ?? '').toLowerCase() === 'movie' &&
        selectedSectionKeys.has(section.key),
    );
    const showSections = sections.filter(
      (section) =>
        includeShows &&
        (section.type ?? '').toLowerCase() === 'show' &&
        selectedSectionKeys.has(section.key),
    );
    if (!movieSections.length && !showSections.length) {
      result.skippedReason = 'No selected Plex libraries matched this profile.';
      return result;
    }

    let machineIdentifier = '';
    try {
      machineIdentifier = await this.plexServer.getMachineIdentifier({
        baseUrl,
        token: plexToken,
      });
    } catch (error) {
      result.failures.push(
        `Failed to resolve Plex machine identifier: ${errToMessage(error)}`,
      );
      return result;
    }

    let normalizedUsers: Array<{
      id: string;
      plexAccountTitle: string;
      isAdmin: boolean;
    }> = [];
    try {
      const admin = await this.plexUsers.ensureAdminPlexUser({ userId });
      const users = await this.prisma.plexUser.findMany({
        orderBy: [{ isAdmin: 'desc' }, { plexAccountTitle: 'asc' }],
        select: {
          id: true,
          plexAccountTitle: true,
          isAdmin: true,
        },
      });
      const hasAdmin = users.some((user) => user.id === admin.id);
      normalizedUsers = hasAdmin
        ? users
        : [
            {
              id: admin.id,
              plexAccountTitle: admin.plexAccountTitle,
              isAdmin: true,
            },
            ...users,
          ];
    } catch (error) {
      result.failures.push(
        `Failed to resolve Plex users: ${errToMessage(error)}`,
      );
      return result;
    }
    const monitoringSelection = resolvePlexUserMonitoringSelection({
      settings,
      users: normalizedUsers,
    });
    const selectedUsers = normalizedUsers.filter((user) =>
      monitoringSelection.selectedPlexUserIds.includes(user.id),
    );
    result.targetUsers = selectedUsers.length;
    if (!selectedUsers.length) {
      result.skippedReason = 'No monitored Plex users are selected.';
      return result;
    }
    const datasetProfileId = profile.isDefault ? 'default' : profile.id;

    const overrideByPlexUserId = new Map(
      profileOverrides.map((override) => [override.plexUserId, override]),
    );

    for (const user of selectedUsers) {
      const userOverride = overrideByPlexUserId.get(user.id);
      const movieBase = resolveMovieCollectionBaseName(
        userOverride?.movieCollectionBaseName ??
          profile.movieCollectionBaseName,
      );
      const showBase = resolveShowCollectionBaseName(
        userOverride?.showCollectionBaseName ?? profile.showCollectionBaseName,
      );
      const preferredMovieName = buildImmaculateCollectionName(
        movieBase,
        user.plexAccountTitle,
      );
      const preferredShowName = buildImmaculateCollectionName(
        showBase,
        user.plexAccountTitle,
      );
      const movieNames = buildImmaculateCollectionLookupNames(
        movieBase,
        user.plexAccountTitle,
      );
      const showNames = buildImmaculateCollectionLookupNames(
        showBase,
        user.plexAccountTitle,
      );

      for (const section of movieSections) {
        await this.cleanupDuplicateEmptyCollections({
          baseUrl,
          token: plexToken,
          librarySectionKey: section.key,
          candidateNames: movieNames,
          resultFailures: result.failures,
          failurePrefix: `Movie duplicate cleanup failed for user=${user.id}, section=${section.key}`,
        });
        let ratingKey: string | null = null;
        for (const movieName of movieNames) {
          result.movieLookups += 1;
          try {
            ratingKey = await this.plexServer.findCollectionRatingKey({
              baseUrl,
              token: plexToken,
              librarySectionKey: section.key,
              collectionName: movieName,
            });
          } catch (error) {
            result.failures.push(
              `Movie lookup failed for user=${user.id}, section=${section.key}, name="${movieName}": ${errToMessage(error)}`,
            );
          }
          if (ratingKey) break;
        }
        const desiredMovieItems = await this.resolveMovieDesiredItems({
          plexUserId: user.id,
          profileId: datasetProfileId,
          baseUrl,
          token: plexToken,
          librarySectionKey: section.key,
          sectionTitle: section.title,
          failures: result.failures,
        });
        const movieSeedRatingKey = desiredMovieItems[0]?.ratingKey ?? null;
        if (!movieSeedRatingKey) {
          if (ratingKey) continue;
          continue;
        }
        if (ratingKey) {
          try {
            await this.plexServer.deleteCollection({
              baseUrl,
              token: plexToken,
              collectionRatingKey: ratingKey,
            });
          } catch (error) {
            result.failures.push(
              `Movie existing-collection delete failed for user=${user.id}, section=${section.key}, ratingKey=${ratingKey}: ${errToMessage(error)}`,
            );
            continue;
          }
        }
        let createdCollectionRatingKey: string | null = null;
        try {
          createdCollectionRatingKey = await this.plexServer.createCollection({
            baseUrl,
            token: plexToken,
            machineIdentifier,
            librarySectionKey: section.key,
            collectionName: preferredMovieName,
            type: 1,
            initialItemRatingKey: movieSeedRatingKey,
          });
          result.movieCreated += 1;
        } catch (error) {
          result.failures.push(
            `Movie create failed for user=${user.id}, section=${section.key}, name="${preferredMovieName}": ${errToMessage(error)}`,
          );
          continue;
        }
        const movieCollectionRatingKey =
          createdCollectionRatingKey ||
          (await this.plexServer.findCollectionRatingKey({
            baseUrl,
            token: plexToken,
            librarySectionKey: section.key,
            collectionName: preferredMovieName,
          }));
        if (!movieCollectionRatingKey) {
          result.failures.push(
            `Movie populate skipped: failed to resolve created collection rating key for user=${user.id}, section=${section.key}, name="${preferredMovieName}"`,
          );
          continue;
        }
        for (const item of desiredMovieItems.slice(1)) {
          try {
            await this.plexServer.addItemToCollection({
              baseUrl,
              token: plexToken,
              machineIdentifier,
              collectionRatingKey: movieCollectionRatingKey,
              itemRatingKey: item.ratingKey,
            });
          } catch (error) {
            result.failures.push(
              `Movie add-item failed for user=${user.id}, section=${section.key}, collection="${preferredMovieName}", item=${item.ratingKey}: ${errToMessage(error)}`,
            );
          }
        }
        await this.applyCollectionArtworkBestEffort({
          baseUrl,
          token: plexToken,
          collectionRatingKey: movieCollectionRatingKey,
          collectionName: preferredMovieName,
          failures: result.failures,
          failurePrefix: `Movie artwork apply failed for user=${user.id}, section=${section.key}, collection="${preferredMovieName}"`,
        });
      }

      for (const section of showSections) {
        await this.cleanupDuplicateEmptyCollections({
          baseUrl,
          token: plexToken,
          librarySectionKey: section.key,
          candidateNames: showNames,
          resultFailures: result.failures,
          failurePrefix: `TV duplicate cleanup failed for user=${user.id}, section=${section.key}`,
        });
        let ratingKey: string | null = null;
        for (const showName of showNames) {
          result.showLookups += 1;
          try {
            ratingKey = await this.plexServer.findCollectionRatingKey({
              baseUrl,
              token: plexToken,
              librarySectionKey: section.key,
              collectionName: showName,
            });
          } catch (error) {
            result.failures.push(
              `TV lookup failed for user=${user.id}, section=${section.key}, name="${showName}": ${errToMessage(error)}`,
            );
          }
          if (ratingKey) break;
        }
        const desiredShowItems = await this.resolveShowDesiredItems({
          plexUserId: user.id,
          profileId: datasetProfileId,
          baseUrl,
          token: plexToken,
          librarySectionKey: section.key,
          sectionTitle: section.title,
          failures: result.failures,
        });
        const showSeedRatingKey = desiredShowItems[0]?.ratingKey ?? null;
        if (!showSeedRatingKey) {
          if (ratingKey) continue;
          continue;
        }
        if (ratingKey) {
          try {
            await this.plexServer.deleteCollection({
              baseUrl,
              token: plexToken,
              collectionRatingKey: ratingKey,
            });
          } catch (error) {
            result.failures.push(
              `TV existing-collection delete failed for user=${user.id}, section=${section.key}, ratingKey=${ratingKey}: ${errToMessage(error)}`,
            );
            continue;
          }
        }
        let createdCollectionRatingKey: string | null = null;
        try {
          createdCollectionRatingKey = await this.plexServer.createCollection({
            baseUrl,
            token: plexToken,
            machineIdentifier,
            librarySectionKey: section.key,
            collectionName: preferredShowName,
            type: 2,
            initialItemRatingKey: showSeedRatingKey,
          });
          result.showCreated += 1;
        } catch (error) {
          result.failures.push(
            `TV create failed for user=${user.id}, section=${section.key}, name="${preferredShowName}": ${errToMessage(error)}`,
          );
          continue;
        }
        const showCollectionRatingKey =
          createdCollectionRatingKey ||
          (await this.plexServer.findCollectionRatingKey({
            baseUrl,
            token: plexToken,
            librarySectionKey: section.key,
            collectionName: preferredShowName,
          }));
        if (!showCollectionRatingKey) {
          result.failures.push(
            `TV populate skipped: failed to resolve created collection rating key for user=${user.id}, section=${section.key}, name="${preferredShowName}"`,
          );
          continue;
        }
        for (const item of desiredShowItems.slice(1)) {
          try {
            await this.plexServer.addItemToCollection({
              baseUrl,
              token: plexToken,
              machineIdentifier,
              collectionRatingKey: showCollectionRatingKey,
              itemRatingKey: item.ratingKey,
            });
          } catch (error) {
            result.failures.push(
              `TV add-item failed for user=${user.id}, section=${section.key}, collection="${preferredShowName}", item=${item.ratingKey}: ${errToMessage(error)}`,
            );
          }
        }
        await this.applyCollectionArtworkBestEffort({
          baseUrl,
          token: plexToken,
          collectionRatingKey: showCollectionRatingKey,
          collectionName: preferredShowName,
          failures: result.failures,
          failurePrefix: `TV artwork apply failed for user=${user.id}, section=${section.key}, collection="${preferredShowName}"`,
        });
      }
    }

    return result;
  }

  private async cleanupDuplicateEmptyCollections(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    candidateNames: string[];
    resultFailures: string[];
    failurePrefix: string;
  }): Promise<void> {
    const normalizedTargets = new Set(
      params.candidateNames
        .map((name) => normalizeCollectionTitle(name))
        .filter((name) => Boolean(name)),
    );
    if (!normalizedTargets.size) return;

    let collections: Array<{ ratingKey: string; title: string }> = [];
    try {
      collections = await this.plexServer.listCollectionsForSectionKey({
        baseUrl: params.baseUrl,
        token: params.token,
        librarySectionKey: params.librarySectionKey,
        take: 400,
      });
    } catch (error) {
      params.resultFailures.push(
        `${params.failurePrefix}: failed to list collections: ${errToMessage(error)}`,
      );
      return;
    }

    const grouped = new Map<
      string,
      Array<{ ratingKey: string; title: string }>
    >();
    for (const collection of collections) {
      const key = normalizeCollectionTitle(collection.title);
      if (!key || !normalizedTargets.has(key)) continue;
      const list = grouped.get(key) ?? [];
      list.push(collection);
      grouped.set(key, list);
    }

    for (const [, group] of grouped) {
      if (group.length < 2) continue;
      const counts = await Promise.all(
        group.map(async (collection) => {
          try {
            const items = await this.plexServer.getCollectionItems({
              baseUrl: params.baseUrl,
              token: params.token,
              collectionRatingKey: collection.ratingKey,
            });
            return {
              ...collection,
              itemCount: items.length,
            };
          } catch (error) {
            params.resultFailures.push(
              `${params.failurePrefix}: failed to inspect collection ${collection.ratingKey}: ${errToMessage(error)}`,
            );
            return { ...collection, itemCount: 1 };
          }
        }),
      );

      const empty = counts.filter((collection) => collection.itemCount === 0);
      if (!empty.length) continue;
      const hasNonEmpty = counts.some((collection) => collection.itemCount > 0);
      const deleteTargets = hasNonEmpty ? empty : empty.slice(1);
      for (const target of deleteTargets) {
        try {
          await this.plexServer.deleteCollection({
            baseUrl: params.baseUrl,
            token: params.token,
            collectionRatingKey: target.ratingKey,
          });
        } catch (error) {
          params.resultFailures.push(
            `${params.failurePrefix}: failed to delete empty duplicate ${target.ratingKey}: ${errToMessage(error)}`,
          );
        }
      }
    }
  }

  private async resolveMovieDesiredItems(params: {
    plexUserId: string;
    profileId: string;
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    sectionTitle: string;
    failures: string[];
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    let libraryItems: Awaited<
      ReturnType<PlexServerService['listMoviesWithTmdbIdsForSectionKey']>
    > = [];
    try {
      libraryItems = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
        baseUrl: params.baseUrl,
        token: params.token,
        librarySectionKey: params.librarySectionKey,
        sectionTitle: params.sectionTitle,
      });
    } catch (error) {
      params.failures.push(
        `Movie seed map failed for user=${params.plexUserId}, section=${params.librarySectionKey}: ${errToMessage(error)}`,
      );
      return [];
    }

    const candidateProfileIds = Array.from(
      new Set(
        [params.profileId, 'default']
          .map((value) => value.trim())
          .filter((value) => Boolean(value)),
      ),
    );
    for (const profileId of candidateProfileIds) {
      let activeRows: Array<{ tmdbId: number }> = [];
      try {
        activeRows = await this.prisma.immaculateTasteMovieLibrary.findMany({
          where: {
            plexUserId: params.plexUserId,
            librarySectionKey: params.librarySectionKey,
            profileId,
            status: 'active',
            points: { gt: 0 },
          },
          select: { tmdbId: true },
          orderBy: [{ points: 'desc' }, { updatedAt: 'desc' }],
          take: 200,
        });
      } catch (error) {
        params.failures.push(
          `Movie seed lookup failed for user=${params.plexUserId}, section=${params.librarySectionKey}, profile=${profileId}: ${errToMessage(error)}`,
        );
        continue;
      }
      if (!activeRows.length) continue;
      const itemsByTmdbId = new Map(
        libraryItems
          .filter((item) => item.tmdbId !== null)
          .map((item) => [item.tmdbId as number, item]),
      );
      const desired: Array<{ ratingKey: string; title: string }> = [];
      const seen = new Set<string>();
      for (const row of activeRows) {
        const mapped = itemsByTmdbId.get(row.tmdbId);
        const ratingKey = mapped?.ratingKey?.trim() ?? '';
        if (!ratingKey || seen.has(ratingKey)) continue;
        seen.add(ratingKey);
        desired.push({
          ratingKey,
          title: mapped?.title ?? ratingKey,
        });
      }
      if (desired.length) return desired;
    }

    return [];
  }

  private async applyCollectionArtworkBestEffort(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    collectionName: string;
    failures: string[];
    failurePrefix: string;
  }): Promise<void> {
    const artworkPaths = this.resolveCollectionArtworkPaths(
      params.collectionName,
    );
    if (!artworkPaths.poster && !artworkPaths.background) return;
    try {
      if (artworkPaths.poster) {
        await this.plexServer.uploadCollectionPoster({
          baseUrl: params.baseUrl,
          token: params.token,
          collectionRatingKey: params.collectionRatingKey,
          filepath: artworkPaths.poster,
        });
      }
      if (artworkPaths.background) {
        await this.plexServer.uploadCollectionArt({
          baseUrl: params.baseUrl,
          token: params.token,
          collectionRatingKey: params.collectionRatingKey,
          filepath: artworkPaths.background,
        });
      }
    } catch (error) {
      params.failures.push(`${params.failurePrefix}: ${errToMessage(error)}`);
    }
  }

  private resolveCollectionArtworkPaths(collectionName: string): {
    poster: string | null;
    background: string | null;
  } {
    const normalizedName = normalizeCollectionTitle(
      stripUserCollectionSuffix(collectionName),
    );
    const collectionArtworkMap: Record<string, string> = {
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
      [normalizeCollectionTitle('Change of Taste')]:
        'change_of_taste_collection',
      [normalizeCollectionTitle('Change of Movie Taste')]:
        'change_of_taste_collection',
      [normalizeCollectionTitle('Change of Show Taste')]:
        'change_of_taste_collection',
    };
    const artworkName = collectionArtworkMap[normalizedName];
    if (!artworkName) {
      return { poster: null, background: null };
    }

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
    let assetsDir: string | null = null;
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        assetsDir = candidate;
        break;
      }
    }
    if (!assetsDir) {
      return { poster: null, background: null };
    }

    const posterPng = join(assetsDir, 'posters', `${artworkName}.png`);
    const posterJpg = join(assetsDir, 'posters', `${artworkName}.jpg`);
    const backgroundPng = join(assetsDir, 'backgrounds', `${artworkName}.png`);
    const backgroundJpg = join(assetsDir, 'backgrounds', `${artworkName}.jpg`);

    return {
      poster: existsSync(posterPng)
        ? posterPng
        : existsSync(posterJpg)
          ? posterJpg
          : null,
      background: existsSync(backgroundPng)
        ? backgroundPng
        : existsSync(backgroundJpg)
          ? backgroundJpg
          : null,
    };
  }

  private async resolveShowDesiredItems(params: {
    plexUserId: string;
    profileId: string;
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    sectionTitle: string;
    failures: string[];
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    let libraryItems: Awaited<
      ReturnType<PlexServerService['listShowsWithTvdbIdsForSectionKey']>
    > = [];
    try {
      libraryItems = await this.plexServer.listShowsWithTvdbIdsForSectionKey({
        baseUrl: params.baseUrl,
        token: params.token,
        librarySectionKey: params.librarySectionKey,
        sectionTitle: params.sectionTitle,
      });
    } catch (error) {
      params.failures.push(
        `TV seed map failed for user=${params.plexUserId}, section=${params.librarySectionKey}: ${errToMessage(error)}`,
      );
      return [];
    }

    const candidateProfileIds = Array.from(
      new Set(
        [params.profileId, 'default']
          .map((value) => value.trim())
          .filter((value) => Boolean(value)),
      ),
    );
    for (const profileId of candidateProfileIds) {
      let activeRows: Array<{ tvdbId: number }> = [];
      try {
        activeRows = await this.prisma.immaculateTasteShowLibrary.findMany({
          where: {
            plexUserId: params.plexUserId,
            librarySectionKey: params.librarySectionKey,
            profileId,
            status: 'active',
            points: { gt: 0 },
          },
          select: { tvdbId: true },
          orderBy: [{ points: 'desc' }, { updatedAt: 'desc' }],
          take: 200,
        });
      } catch (error) {
        params.failures.push(
          `TV seed lookup failed for user=${params.plexUserId}, section=${params.librarySectionKey}, profile=${profileId}: ${errToMessage(error)}`,
        );
        continue;
      }
      if (!activeRows.length) continue;
      const itemsByTvdbId = new Map(
        libraryItems
          .filter((item) => item.tvdbId !== null)
          .map((item) => [item.tvdbId as number, item]),
      );
      const desired: Array<{ ratingKey: string; title: string }> = [];
      const seen = new Set<string>();
      for (const row of activeRows) {
        const mapped = itemsByTvdbId.get(row.tvdbId);
        const ratingKey = mapped?.ratingKey?.trim() ?? '';
        if (!ratingKey || seen.has(ratingKey)) continue;
        seen.add(ratingKey);
        desired.push({
          ratingKey,
          title: mapped?.title ?? ratingKey,
        });
      }
      if (desired.length) return desired;
    }

    return [];
  }

  private buildRenameTask(params: {
    taskId: string;
    taskTitle: string;
    result: CollectionRenameResult;
  }): ProfileActionTask {
    const { result } = params;
    const issues: JobReportIssue[] = [];
    if (result.skippedReason) {
      issues.push({ level: 'warn', message: result.skippedReason });
    }
    for (const failure of result.failures.slice(0, 5)) {
      issues.push({ level: 'error', message: failure });
    }
    return {
      id: params.taskId,
      title: params.taskTitle,
      status: result.skippedReason
        ? 'skipped'
        : result.failures.length > 0
          ? 'failed'
          : 'success',
      facts: [
        { label: 'Attempted', value: result.attempted },
        { label: 'Target users', value: result.targetUsers },
        { label: 'Movie lookups', value: result.movieLookups },
        { label: 'Movie renamed', value: result.movieRenamed },
        { label: 'TV lookups', value: result.showLookups },
        { label: 'TV renamed', value: result.showRenamed },
      ],
      ...(issues.length ? { issues } : {}),
    };
  }

  private buildProfileActionHeadline(params: {
    profileName: string;
    tasks: ProfileActionTask[];
    fallback: string;
  }): string {
    const hasTask = (taskId: string) =>
      params.tasks.some(
        (task) => task.id === taskId && task.status !== 'skipped',
      );

    if (hasTask('recreate_collections_on_enable')) {
      return `Recreate Plex collections for enabled profile "${params.profileName}".`;
    }
    if (hasTask('cleanup_collections_on_disable')) {
      return `Delete Plex collections for disabled profile "${params.profileName}".`;
    }
    if (hasTask('cleanup_collections_on_delete')) {
      return `Delete Plex collections for deleted profile "${params.profileName}".`;
    }
    if (hasTask('rename_collections')) {
      return `Rename Plex collections for profile "${params.profileName}".`;
    }
    if (hasTask('rename_scoped_collections')) {
      return `Rename scoped Plex collections for profile "${params.profileName}".`;
    }
    return params.fallback;
  }

  private buildCleanupTask(params: {
    taskId: string;
    taskTitle: string;
    result: CollectionCleanupResult;
  }): ProfileActionTask {
    const { result } = params;
    const issues: JobReportIssue[] = [];
    if (result.skippedReason) {
      issues.push({ level: 'warn', message: result.skippedReason });
    }
    for (const failure of result.failures.slice(0, 5)) {
      issues.push({ level: 'error', message: failure });
    }
    return {
      id: params.taskId,
      title: params.taskTitle,
      status: result.skippedReason
        ? 'skipped'
        : result.failures.length > 0
          ? 'failed'
          : 'success',
      facts: [
        { label: 'Attempted', value: result.attempted },
        { label: 'Target users', value: result.targetUsers },
        { label: 'Movie lookups', value: result.movieLookups },
        { label: 'Movie deleted', value: result.movieDeleted },
        { label: 'TV lookups', value: result.showLookups },
        { label: 'TV deleted', value: result.showDeleted },
      ],
      ...(issues.length ? { issues } : {}),
    };
  }

  private buildRecreateTask(params: {
    taskId: string;
    taskTitle: string;
    result: CollectionRecreateResult;
  }): ProfileActionTask {
    const { result } = params;
    const issues: JobReportIssue[] = [];
    if (result.skippedReason) {
      issues.push({ level: 'warn', message: result.skippedReason });
    }
    for (const failure of result.failures.slice(0, 5)) {
      issues.push({ level: 'error', message: failure });
    }
    return {
      id: params.taskId,
      title: params.taskTitle,
      status: result.skippedReason
        ? 'skipped'
        : result.failures.length > 0
          ? 'failed'
          : 'success',
      facts: [
        { label: 'Attempted', value: result.attempted },
        { label: 'Target users', value: result.targetUsers },
        { label: 'Movie lookups', value: result.movieLookups },
        { label: 'Movie created', value: result.movieCreated },
        { label: 'TV lookups', value: result.showLookups },
        { label: 'TV created', value: result.showCreated },
      ],
      ...(issues.length ? { issues } : {}),
    };
  }

  private async writeActionRunSafe(params: {
    userId: string;
    action: string;
    profileId: string | null;
    profileName: string | null;
    headline: string;
    tasks: ProfileActionTask[];
    raw: Record<string, Prisma.JsonValue>;
  }): Promise<void> {
    try {
      await this.writeActionRun(params);
    } catch (error) {
      this.logger.warn(
        `Failed to write profile action run for ${params.action}: ${errToMessage(error)}`,
      );
    }
  }

  private async writeActionRun(params: {
    userId: string;
    action: string;
    profileId: string | null;
    profileName: string | null;
    headline: string;
    tasks: ProfileActionTask[];
    raw: Record<string, Prisma.JsonValue>;
  }): Promise<void> {
    const issues = params.tasks.flatMap((task) => task.issues ?? []);
    const hasFailure = params.tasks.some((task) => task.status === 'failed');
    const now = new Date();
    const summary = {
      template: 'jobReportV1' as const,
      version: 1 as const,
      jobId: IMMACULATE_TASTE_PROFILE_ACTION_JOB_ID,
      dryRun: false,
      trigger: 'manual' as const,
      headline: params.headline,
      sections: [],
      tasks: params.tasks,
      issues,
      raw: {
        action: params.action,
        profileId: params.profileId,
        profileName: params.profileName,
        ...params.raw,
      },
    };
    const run = await this.prisma.jobRun.create({
      data: {
        jobId: IMMACULATE_TASTE_PROFILE_ACTION_JOB_ID,
        userId: params.userId,
        trigger: 'manual',
        dryRun: false,
        status: hasFailure ? 'FAILED' : 'SUCCESS',
        startedAt: now,
        finishedAt: now,
        summary: summary as unknown as Prisma.InputJsonValue,
        errorMessage: hasFailure
          ? (issues.find((issue) => issue.level === 'error')?.message ??
            'One or more profile action tasks failed.')
          : null,
      },
    });

    if (!params.tasks.length) return;
    await this.prisma.jobLogLine.createMany({
      data: params.tasks.map((task) => ({
        runId: run.id,
        level:
          task.status === 'failed'
            ? 'error'
            : task.status === 'skipped'
              ? 'warn'
              : 'info',
        message: `${params.action}.${task.id}: ${task.title}`,
        context: {
          taskId: task.id,
          taskStatus: task.status,
          facts: task.facts ?? [],
          issues: task.issues ?? [],
        } as unknown as Prisma.InputJsonValue,
      })),
    });
  }
}
