import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../db/prisma.service';
import { GoogleService } from '../google/google.service';
import { OpenAiService } from '../openai/openai.service';
import { OverseerrService } from '../overseerr/overseerr.service';
import {
  type PlexEligibleLibrary,
  buildExcludedSectionKeysFromSelected,
  PLEX_LIBRARY_SELECTION_MIN_SELECTED,
  resolvePlexLibrarySelection,
  sanitizeSectionKeys,
} from '../plex/plex-library-selection.utils';
import {
  buildExcludedPlexUserIdsFromSelected,
  resolvePlexUserMonitoringSelection,
  sanitizePlexUserIds,
} from '../plex/plex-user-selection.utils';
import { resolveCuratedCollectionBaseName } from '../plex/plex-collections.utils';
import { PlexService } from '../plex/plex.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { RadarrService } from '../radarr/radarr.service';
import { SettingsService } from '../settings/settings.service';
import { SonarrService } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  return asString(pick(obj, path));
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol))
      throw new Error('Unsupported protocol');
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

type UpdatePlexLibrariesBody = {
  selectedSectionKeys?: unknown;
};

type UpdatePlexMonitoringUsersBody = {
  selectedPlexUserIds?: unknown;
};

@Controller('integrations')
@ApiTags('integrations')
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plex: PlexService,
    private readonly plexServer: PlexServerService,
    private readonly plexUsers: PlexUsersService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly tmdb: TmdbService,
    private readonly google: GoogleService,
    private readonly openai: OpenAiService,
    private readonly overseerr: OverseerrService,
  ) {}

  private async cleanupDeselectedPlexLibraries(params: {
    baseUrl: string;
    token: string;
    deselectedLibraries: PlexEligibleLibrary[];
  }) {
    const sectionKeys = params.deselectedLibraries
      .map((lib) => String(lib.key ?? '').trim())
      .filter(Boolean);

    const emptyResult = {
      deselectedSectionKeys: sectionKeys,
      db: {
        immaculateMovieDeleted: 0,
        immaculateTvDeleted: 0,
        watchedMovieDeleted: 0,
        watchedTvDeleted: 0,
        totalDeleted: 0,
      },
      plex: {
        librariesChecked: 0,
        collectionsDeleted: 0,
        errors: 0,
      },
    };

    if (!sectionKeys.length) return emptyResult;

    const [immaculateMovieDeletedRes, immaculateTvDeletedRes, watchedMovieDeletedRes, watchedTvDeletedRes] =
      await this.prisma.$transaction([
        this.prisma.immaculateTasteMovieLibrary.deleteMany({
          where: { librarySectionKey: { in: sectionKeys } },
        }),
        this.prisma.immaculateTasteShowLibrary.deleteMany({
          where: { librarySectionKey: { in: sectionKeys } },
        }),
        this.prisma.watchedMovieRecommendationLibrary.deleteMany({
          where: { librarySectionKey: { in: sectionKeys } },
        }),
        this.prisma.watchedShowRecommendationLibrary.deleteMany({
          where: { librarySectionKey: { in: sectionKeys } },
        }),
      ]);

    let librariesChecked = 0;
    let collectionsDeleted = 0;
    let plexErrors = 0;
    for (const lib of params.deselectedLibraries) {
      const mediaType = lib.type === 'movie' ? 'movie' : lib.type === 'show' ? 'tv' : null;
      if (!mediaType) continue;
      librariesChecked += 1;

      try {
        const collections = await this.plexServer.listCollectionsForSectionKey({
          baseUrl: params.baseUrl,
          token: params.token,
          librarySectionKey: lib.key,
          take: 500,
        });
        const seenRatingKeys = new Set<string>();
        for (const collection of collections) {
          const ratingKey = String(collection.ratingKey ?? '').trim();
          if (!ratingKey || seenRatingKeys.has(ratingKey)) continue;
          seenRatingKeys.add(ratingKey);

          const curatedBase = resolveCuratedCollectionBaseName({
            collectionName: String(collection.title ?? ''),
            mediaType,
          });
          if (!curatedBase) continue;

          try {
            await this.plexServer.deleteCollection({
              baseUrl: params.baseUrl,
              token: params.token,
              collectionRatingKey: ratingKey,
            });
            collectionsDeleted += 1;
          } catch {
            plexErrors += 1;
          }
        }
      } catch {
        plexErrors += 1;
      }
    }

    const immaculateMovieDeleted = immaculateMovieDeletedRes.count;
    const immaculateTvDeleted = immaculateTvDeletedRes.count;
    const watchedMovieDeleted = watchedMovieDeletedRes.count;
    const watchedTvDeleted = watchedTvDeletedRes.count;

    return {
      deselectedSectionKeys: sectionKeys,
      db: {
        immaculateMovieDeleted,
        immaculateTvDeleted,
        watchedMovieDeleted,
        watchedTvDeleted,
        totalDeleted:
          immaculateMovieDeleted +
          immaculateTvDeleted +
          watchedMovieDeleted +
          watchedTvDeleted,
      },
      plex: {
        librariesChecked,
        collectionsDeleted,
        errors: plexErrors,
      },
    };
  }

  private async resolvePlexMonitoringUsers(userId: string) {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const baseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!baseUrlRaw || !token) {
      throw new BadRequestException('Plex is not configured');
    }

    const baseUrl = normalizeHttpUrl(baseUrlRaw);
    const admin = await this.plexUsers.ensureAdminPlexUser({ userId });

    let warning: string | null = null;
    const usersById = new Map<
      string,
      {
        id: string;
        plexAccountId: number | null;
        plexAccountTitle: string;
        isAdmin: boolean;
      }
    >();
    usersById.set(admin.id, {
      id: admin.id,
      plexAccountId: admin.plexAccountId,
      plexAccountTitle: admin.plexAccountTitle,
      isAdmin: admin.isAdmin,
    });

    try {
      const machineIdentifier = await this.plexServer.getMachineIdentifier({
        baseUrl,
        token,
      });
      const sharedUsers = await this.plex.listSharedUsersForServer({
        plexToken: token,
        machineIdentifier,
      });
      for (const shared of sharedUsers) {
        const plexUser = await this.plexUsers.getOrCreateByPlexAccount({
          plexAccountId: shared.plexAccountId,
          plexAccountTitle: shared.plexAccountTitle,
        });
        if (!plexUser) continue;
        usersById.set(plexUser.id, {
          id: plexUser.id,
          plexAccountId: plexUser.plexAccountId,
          plexAccountTitle: plexUser.plexAccountTitle,
          isAdmin: plexUser.isAdmin,
        });
      }
    } catch {
      warning = 'Could not load Plex shared users right now. Showing admin only.';
    }

    const users = Array.from(usersById.values()).sort((a, b) => {
      if (a.isAdmin && !b.isAdmin) return -1;
      if (!a.isAdmin && b.isAdmin) return 1;
      return (
        a.plexAccountTitle.localeCompare(b.plexAccountTitle) ||
        a.id.localeCompare(b.id)
      );
    });
    const selection = resolvePlexUserMonitoringSelection({ settings, users });
    return {
      users,
      selection,
      warning,
    };
  }

  @Get('radarr/options')
  async radarrOptions(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const radarrEnabledFlag = pickBool(settings, 'radarr.enabled');
    const baseUrlRaw = pickString(settings, 'radarr.baseUrl');
    const apiKey = pickString(secrets, 'radarr.apiKey');
    // Back-compat: if radarr.enabled is not set, treat "secret present" as enabled.
    const enabledFlag = radarrEnabledFlag ?? Boolean(apiKey);
    const enabled = enabledFlag && Boolean(baseUrlRaw) && Boolean(apiKey);

    if (!enabled) {
      throw new BadRequestException('Radarr is not enabled or not configured');
    }

    const baseUrl = normalizeHttpUrl(baseUrlRaw);

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.radarr.listRootFolders({ baseUrl, apiKey }),
      this.radarr.listQualityProfiles({ baseUrl, apiKey }),
      this.radarr.listTags({ baseUrl, apiKey }),
    ]);

    // Stable order for UI
    rootFolders.sort((a, b) => a.path.localeCompare(b.path));
    qualityProfiles.sort((a, b) => a.name.localeCompare(b.name));
    tags.sort((a, b) => a.label.localeCompare(b.label));

    return { ok: true, rootFolders, qualityProfiles, tags };
  }

  @Get('sonarr/options')
  async sonarrOptions(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const sonarrEnabledFlag = pickBool(settings, 'sonarr.enabled');
    const baseUrlRaw = pickString(settings, 'sonarr.baseUrl');
    const apiKey = pickString(secrets, 'sonarr.apiKey');
    // Back-compat: if sonarr.enabled is not set, treat "secret present" as enabled.
    const enabledFlag = sonarrEnabledFlag ?? Boolean(apiKey);
    const enabled = enabledFlag && Boolean(baseUrlRaw) && Boolean(apiKey);

    if (!enabled) {
      throw new BadRequestException('Sonarr is not enabled or not configured');
    }

    const baseUrl = normalizeHttpUrl(baseUrlRaw);

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.sonarr.listRootFolders({ baseUrl, apiKey }),
      this.sonarr.listQualityProfiles({ baseUrl, apiKey }),
      this.sonarr.listTags({ baseUrl, apiKey }),
    ]);

    // Stable order for UI
    rootFolders.sort((a, b) => a.path.localeCompare(b.path));
    qualityProfiles.sort((a, b) => a.name.localeCompare(b.name));
    tags.sort((a, b) => a.label.localeCompare(b.label));

    return { ok: true, rootFolders, qualityProfiles, tags };
  }

  @Get('plex/libraries')
  async plexLibraries(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const baseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!baseUrlRaw || !token) {
      throw new BadRequestException('Plex is not configured');
    }

    const baseUrl = normalizeHttpUrl(baseUrlRaw);
    const sections = await this.plexServer.getSections({ baseUrl, token });
    const selection = resolvePlexLibrarySelection({ settings, sections });
    const selectedSet = new Set(selection.selectedSectionKeys);
    const libraries = selection.eligibleLibraries.map((lib) => ({
      key: lib.key,
      title: lib.title,
      type: lib.type,
      selected: selectedSet.has(lib.key),
    }));

    return {
      ok: true,
      libraries,
      selectedSectionKeys: selection.selectedSectionKeys,
      excludedSectionKeys: selection.excludedSectionKeys,
      minimumRequired: PLEX_LIBRARY_SELECTION_MIN_SELECTED,
      autoIncludeNewLibraries: true,
    };
  }

  @Put('plex/libraries')
  async savePlexLibraries(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdatePlexLibrariesBody,
  ) {
    const bodyObj = isPlainObject(body) ? body : {};
    if (!Array.isArray(bodyObj['selectedSectionKeys'])) {
      throw new BadRequestException('selectedSectionKeys must be an array');
    }
    const selectedSectionKeys = sanitizeSectionKeys(
      bodyObj['selectedSectionKeys'],
    );

    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const baseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!baseUrlRaw || !token) {
      throw new BadRequestException('Plex is not configured');
    }

    const baseUrl = normalizeHttpUrl(baseUrlRaw);
    const sections = await this.plexServer.getSections({ baseUrl, token });
    const selection = resolvePlexLibrarySelection({ settings, sections });
    if (!selection.eligibleLibraries.length) {
      throw new BadRequestException('No Plex movie/TV libraries found');
    }

    if (selectedSectionKeys.length < PLEX_LIBRARY_SELECTION_MIN_SELECTED) {
      throw new BadRequestException(
        `At least ${PLEX_LIBRARY_SELECTION_MIN_SELECTED} library must be selected`,
      );
    }

    const eligibleKeys = new Set(
      selection.eligibleLibraries.map((lib) => lib.key),
    );
    const unknownKeys = selectedSectionKeys.filter((key) => !eligibleKeys.has(key));
    if (unknownKeys.length) {
      throw new BadRequestException(
        `Unknown library section keys: ${unknownKeys.join(', ')}`,
      );
    }

    const excludedSectionKeys = buildExcludedSectionKeysFromSelected({
      eligibleLibraries: selection.eligibleLibraries,
      selectedSectionKeys,
    });
    const requestedSelectedSet = new Set(selectedSectionKeys);
    const deselectedSectionKeys = selection.selectedSectionKeys.filter(
      (key) => !requestedSelectedSet.has(key),
    );
    const deselectedSet = new Set(deselectedSectionKeys);
    const deselectedLibraries = selection.eligibleLibraries.filter((lib) =>
      deselectedSet.has(lib.key),
    );

    const nextSettings = await this.settingsService.updateSettings(userId, {
      plex: {
        librarySelection: {
          excludedSectionKeys,
        },
      },
    });

    const nextSelection = resolvePlexLibrarySelection({
      settings: nextSettings,
      sections,
    });
    const selectedSet = new Set(nextSelection.selectedSectionKeys);
    const libraries = nextSelection.eligibleLibraries.map((lib) => ({
      key: lib.key,
      title: lib.title,
      type: lib.type,
      selected: selectedSet.has(lib.key),
    }));

    const cleanup =
      deselectedLibraries.length > 0
        ? await this.cleanupDeselectedPlexLibraries({
            baseUrl,
            token,
            deselectedLibraries,
          }).catch(() => ({
            deselectedSectionKeys,
            db: null,
            plex: null,
            error: 'cleanup_failed',
          }))
        : null;

    return {
      ok: true,
      libraries,
      selectedSectionKeys: nextSelection.selectedSectionKeys,
      excludedSectionKeys: nextSelection.excludedSectionKeys,
      minimumRequired: PLEX_LIBRARY_SELECTION_MIN_SELECTED,
      autoIncludeNewLibraries: true,
      ...(cleanup ? { cleanup } : {}),
    };
  }

  @Get('plex/monitoring-users')
  async plexMonitoringUsers(@Req() req: AuthenticatedRequest) {
    const { users, selection, warning } = await this.resolvePlexMonitoringUsers(
      req.user.id,
    );
    const selectedSet = new Set(selection.selectedPlexUserIds);
    return {
      ok: true,
      users: users.map((user) => ({
        id: user.id,
        plexAccountId: user.plexAccountId,
        plexAccountTitle: user.plexAccountTitle,
        isAdmin: user.isAdmin,
        selected: selectedSet.has(user.id),
      })),
      selectedPlexUserIds: selection.selectedPlexUserIds,
      excludedPlexUserIds: selection.excludedPlexUserIds,
      defaultEnabled: true,
      autoIncludeNewUsers: true,
      ...(warning ? { warning } : {}),
    };
  }

  @Put('plex/monitoring-users')
  async savePlexMonitoringUsers(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdatePlexMonitoringUsersBody,
  ) {
    const bodyObj = isPlainObject(body) ? body : {};
    if (!Array.isArray(bodyObj['selectedPlexUserIds'])) {
      throw new BadRequestException('selectedPlexUserIds must be an array');
    }
    const selectedPlexUserIds = sanitizePlexUserIds(
      bodyObj['selectedPlexUserIds'],
    );

    const userId = req.user.id;
    const { users, warning } = await this.resolvePlexMonitoringUsers(userId);
    const knownIds = new Set(users.map((user) => user.id));
    const unknownIds = selectedPlexUserIds.filter((id) => !knownIds.has(id));
    if (unknownIds.length) {
      throw new BadRequestException(`Unknown Plex user ids: ${unknownIds.join(', ')}`);
    }

    const excludedPlexUserIds = buildExcludedPlexUserIdsFromSelected({
      users,
      selectedPlexUserIds,
    });
    const nextSettings = await this.settingsService.updateSettings(userId, {
      plex: {
        userMonitoring: {
          excludedPlexUserIds,
        },
      },
    });
    const nextSelection = resolvePlexUserMonitoringSelection({
      settings: nextSettings,
      users,
    });
    const selectedSet = new Set(nextSelection.selectedPlexUserIds);

    return {
      ok: true,
      users: users.map((user) => ({
        id: user.id,
        plexAccountId: user.plexAccountId,
        plexAccountTitle: user.plexAccountTitle,
        isAdmin: user.isAdmin,
        selected: selectedSet.has(user.id),
      })),
      selectedPlexUserIds: nextSelection.selectedPlexUserIds,
      excludedPlexUserIds: nextSelection.excludedPlexUserIds,
      defaultEnabled: true,
      autoIncludeNewUsers: true,
      ...(warning ? { warning } : {}),
    };
  }

  @Post('test/:integrationId')
  async testSaved(
    @Req() req: AuthenticatedRequest,
    @Param('integrationId') integrationId: string,
    @Body() body: unknown,
  ) {
    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const bodyObj = isPlainObject(body) ? body : {};
    const id = integrationId.toLowerCase();

    if (id === 'plex') {
      const baseUrlRaw =
        pickString(bodyObj, 'baseUrl') || pickString(settings, 'plex.baseUrl');
      const token = pickString(secrets, 'plex.token');
      if (!baseUrlRaw) throw new BadRequestException('Plex baseUrl is not set');
      if (!token) throw new BadRequestException('Plex token is not set');
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      const machineIdentifier = await this.plexServer.getMachineIdentifier({
        baseUrl,
        token,
      });

      return {
        ok: true,
        summary: {
          machineIdentifier,
        },
      };
    }

    if (id === 'radarr') {
      const baseUrlRaw =
        pickString(bodyObj, 'baseUrl') ||
        pickString(settings, 'radarr.baseUrl');
      const apiKey = pickString(secrets, 'radarr.apiKey');
      if (!baseUrlRaw)
        throw new BadRequestException('Radarr baseUrl is not set');
      if (!apiKey) throw new BadRequestException('Radarr apiKey is not set');
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      const result = await this.radarr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    }

    if (id === 'sonarr') {
      const baseUrlRaw =
        pickString(bodyObj, 'baseUrl') ||
        pickString(settings, 'sonarr.baseUrl');
      const apiKey = pickString(secrets, 'sonarr.apiKey');
      if (!baseUrlRaw)
        throw new BadRequestException('Sonarr baseUrl is not set');
      if (!apiKey) throw new BadRequestException('Sonarr apiKey is not set');
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      const result = await this.sonarr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    }

    if (id === 'tmdb') {
      const apiKey = pickString(secrets, 'tmdb.apiKey');
      if (!apiKey) throw new BadRequestException('TMDB apiKey is not set');
      const result = await this.tmdb.testConnection({ apiKey });
      return { ok: true, result };
    }

    if (id === 'overseerr') {
      const baseUrlRaw =
        pickString(bodyObj, 'baseUrl') ||
        pickString(settings, 'overseerr.baseUrl');
      const apiKey = pickString(secrets, 'overseerr.apiKey');
      if (!baseUrlRaw)
        throw new BadRequestException('Overseerr baseUrl is not set');
      if (!apiKey) throw new BadRequestException('Overseerr apiKey is not set');
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      const result = await this.overseerr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    }

    if (id === 'google') {
      const apiKey = pickString(secrets, 'google.apiKey');
      const cseId =
        pickString(bodyObj, 'cseId') ||
        pickString(bodyObj, 'searchEngineId') ||
        pickString(settings, 'google.searchEngineId');
      if (!apiKey) throw new BadRequestException('Google apiKey is not set');
      if (!cseId)
        throw new BadRequestException('Google searchEngineId is not set');
      const result = await this.google.testConnection({
        apiKey,
        cseId,
        query: 'tautulli curated plex',
        numResults: 3,
      });
      return { ok: true, result };
    }

    if (id === 'openai') {
      const apiKey = pickString(secrets, 'openai.apiKey');
      if (!apiKey) throw new BadRequestException('OpenAI apiKey is not set');
      const result = await this.openai.testConnection({ apiKey });
      return { ok: true, result };
    }

    throw new BadRequestException(`Unknown integrationId: ${integrationId}`);
  }
}
