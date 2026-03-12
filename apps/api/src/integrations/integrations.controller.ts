import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../db/prisma.service';
import { GoogleService } from '../google/google.service';
import { OpenAiService } from '../openai/openai.service';
import { SeerrService } from '../seerr/seerr.service';
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
import {
  type ServiceSecretId,
  SettingsService,
} from '../settings/settings.service';
import { SonarrService } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { ArrInstanceService } from '../arr-instances/arr-instance.service';

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
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
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
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  if (isDisallowedMetadataHostname(parsed.hostname)) {
    throw new BadRequestException('baseUrl host is not allowed');
  }
  return baseUrl;
}

function trimSingleTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeHttpUrlOrEmpty(raw: string): string {
  if (!raw.trim()) return '';
  try {
    return trimSingleTrailingSlash(normalizeHttpUrl(raw));
  } catch {
    return '';
  }
}

function dedupeHttpUrls(urls: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const normalized = normalizeHttpUrlOrEmpty(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function parsePlexDirectIpv4(hostname: string): string | null {
  const host = hostname.trim().toLowerCase();
  const match = /^(\d{1,3}(?:-\d{1,3}){3})\./.exec(host);
  if (!match) return null;
  const ip = match[1]
    .split('-')
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
  if (ip.length !== 4) return null;
  return `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`;
}

function buildUrl(
  protocol: 'http' | 'https',
  host: string,
  port: string,
): string {
  return normalizeHttpUrlOrEmpty(`${protocol}://${host}:${port}`);
}

function derivePlexBaseUrlVariants(raw: string): string[] {
  const normalized = normalizeHttpUrlOrEmpty(raw);
  if (!normalized) return [];

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return [];
  }

  const port = parsed.port || '32400';
  const variants: string[] = [normalized];
  const decodedPlexDirectIp = parsePlexDirectIpv4(parsed.hostname);
  if (decodedPlexDirectIp) {
    variants.push(buildUrl('http', decodedPlexDirectIp, port));
    variants.push(buildUrl('https', decodedPlexDirectIp, port));
  }
  variants.push(buildUrl('http', parsed.hostname, port));
  variants.push(buildUrl('https', parsed.hostname, port));
  variants.push(buildUrl('http', 'localhost', port));
  variants.push(buildUrl('http', '127.0.0.1', port));
  variants.push(buildUrl('http', 'host.docker.internal', port));
  variants.push(buildUrl('http', '172.17.0.1', port));

  return dedupeHttpUrls(variants);
}

function isLikelyLocalHostname(hostnameRaw: string): boolean {
  const hostname = hostnameRaw.trim().toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === 'host.docker.internal' ||
    hostname === 'gateway.docker.internal'
  );
}

function deriveContainerHostFallbackUrls(raw: string): string[] {
  const normalized = normalizeHttpUrlOrEmpty(raw);
  if (!normalized) return [];

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return [];
  }

  if (!isLikelyLocalHostname(parsed.hostname)) return [normalized];

  const path = parsed.pathname.replace(/\/+$/, '');
  const suffix = `${path}${parsed.search}${parsed.hash}`;
  const port = parsed.port ? `:${parsed.port}` : '';
  const protocol = parsed.protocol;
  const hostCandidates = [
    '172.17.0.1',
    'host.docker.internal',
    'gateway.docker.internal',
    '172.18.0.1',
    '172.19.0.1',
    'localhost',
    '127.0.0.1',
  ];
  const candidates = [
    normalized,
    ...hostCandidates
      .map((host) =>
        normalizeHttpUrlOrEmpty(`${protocol}//${host}${port}${suffix}`),
      )
      .filter(Boolean),
  ];
  return dedupeHttpUrls(candidates);
}

function isConnectivityFailure(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const lower = message.toLowerCase();
  return (
    lower.includes('fetch failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('timeout') ||
    lower.includes('network')
  );
}

type UpdatePlexLibrariesBody = {
  selectedSectionKeys?: unknown;
  cleanupDeselectedLibraries?: unknown;
};

type UpdatePlexMonitoringUsersBody = {
  selectedPlexUserIds?: unknown;
};

const SERVICE_SECRET_ID_BY_INTEGRATION: Record<string, ServiceSecretId> = {
  plex: 'plex',
  radarr: 'radarr',
  sonarr: 'sonarr',
  tmdb: 'tmdb',
  seerr: 'seerr',
  google: 'google',
  openai: 'openai',
};

type SavedIntegrationTestContext = {
  userId: string;
  bodyObj: Record<string, unknown>;
  settings: Record<string, unknown>;
  secrets: Record<string, unknown>;
};

type SavedIntegrationTestResult = {
  ok: true;
  result?: unknown;
  summary?: Record<string, unknown>;
};

@Controller('integrations')
@ApiTags('integrations')
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

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
    private readonly seerr: SeerrService,
    private readonly arrInstances: ArrInstanceService,
  ) {}

  private asServiceSecretId(integrationId: string): ServiceSecretId | null {
    return SERVICE_SECRET_ID_BY_INTEGRATION[integrationId] ?? null;
  }

  private async resolveIntegrationSecret(params: {
    userId: string;
    integrationId: string;
    bodyObj: Record<string, unknown>;
    currentSecrets: Record<string, unknown>;
  }): Promise<string> {
    const service = this.asServiceSecretId(params.integrationId);
    if (!service) {
      throw new BadRequestException(
        `Unknown integrationId: ${params.integrationId}`,
      );
    }
    const secretField = this.secretFieldForService(service);
    const envelopeField = this.envelopeFieldForSecretField(secretField);

    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId: params.userId,
      service,
      secretField,
      expectedPurpose: `integration.${service}.test`,
      envelope:
        params.bodyObj[envelopeField] ?? params.bodyObj['secretEnvelope'],
      secretRef: params.bodyObj['secretRef'],
      plaintext: params.bodyObj[secretField],
      currentSecrets: params.currentSecrets,
    });

    if (resolved.value) return resolved.value;

    const savedSecret = this.settingsService.readServiceSecret(
      service,
      params.currentSecrets,
    );
    if (!savedSecret) {
      throw new BadRequestException(
        this.missingSecretMessage(service, secretField),
      );
    }
    return savedSecret;
  }

  private secretFieldForService(service: ServiceSecretId): 'apiKey' | 'token' {
    return service === 'plex' ? 'token' : 'apiKey';
  }

  private envelopeFieldForSecretField(
    secretField: 'apiKey' | 'token',
  ): 'apiKeyEnvelope' | 'tokenEnvelope' {
    return secretField === 'token' ? 'tokenEnvelope' : 'apiKeyEnvelope';
  }

  private missingSecretMessage(
    service: ServiceSecretId,
    secretField: 'apiKey' | 'token',
  ): string {
    const label = secretField === 'token' ? 'token' : 'apiKey';
    return `${service} ${label} is not set`;
  }

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

    const [
      immaculateMovieDeletedRes,
      immaculateTvDeletedRes,
      watchedMovieDeletedRes,
      watchedTvDeletedRes,
    ] = await this.prisma.$transaction([
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
      const mediaType =
        lib.type === 'movie' ? 'movie' : lib.type === 'show' ? 'tv' : null;
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
    const token =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
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
      warning =
        'Could not load Plex shared users right now. Showing admin only.';
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
  async radarrOptions(
    @Req() req: AuthenticatedRequest,
    @Query('instanceId') instanceIdRaw?: string,
  ) {
    const userId = req.user.id;
    const instanceId = (instanceIdRaw ?? '').trim();
    let baseUrl = '';
    let apiKey = '';
    if (instanceId) {
      const resolved = await this.arrInstances.resolveInstance(
        userId,
        'radarr',
        instanceId,
        {
          requireConfigured: true,
        },
      );
      if (!resolved.enabled) {
        throw new BadRequestException('Selected Radarr instance is disabled');
      }
      baseUrl = resolved.baseUrl;
      apiKey = resolved.apiKey;
    } else {
      const { settings, secrets } =
        await this.settingsService.getInternalSettings(userId);
      const radarrEnabledFlag = pickBool(settings, 'radarr.enabled');
      const baseUrlRaw = pickString(settings, 'radarr.baseUrl');
      apiKey = pickString(secrets, 'radarr.apiKey');
      const enabledFlag = radarrEnabledFlag ?? Boolean(apiKey);
      const enabled = enabledFlag && Boolean(baseUrlRaw) && Boolean(apiKey);
      if (!enabled) {
        throw new BadRequestException(
          'Radarr is not enabled or not configured',
        );
      }
      baseUrl = normalizeHttpUrl(baseUrlRaw);
    }

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
  async sonarrOptions(
    @Req() req: AuthenticatedRequest,
    @Query('instanceId') instanceIdRaw?: string,
  ) {
    const userId = req.user.id;
    const instanceId = (instanceIdRaw ?? '').trim();
    let baseUrl = '';
    let apiKey = '';
    if (instanceId) {
      const resolved = await this.arrInstances.resolveInstance(
        userId,
        'sonarr',
        instanceId,
        {
          requireConfigured: true,
        },
      );
      if (!resolved.enabled) {
        throw new BadRequestException('Selected Sonarr instance is disabled');
      }
      baseUrl = resolved.baseUrl;
      apiKey = resolved.apiKey;
    } else {
      const { settings, secrets } =
        await this.settingsService.getInternalSettings(userId);
      const sonarrEnabledFlag = pickBool(settings, 'sonarr.enabled');
      const baseUrlRaw = pickString(settings, 'sonarr.baseUrl');
      apiKey = pickString(secrets, 'sonarr.apiKey');
      const enabledFlag = sonarrEnabledFlag ?? Boolean(apiKey);
      const enabled = enabledFlag && Boolean(baseUrlRaw) && Boolean(apiKey);
      if (!enabled) {
        throw new BadRequestException(
          'Sonarr is not enabled or not configured',
        );
      }
      baseUrl = normalizeHttpUrl(baseUrlRaw);
    }

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

  @Get('plex/library-filters')
  async plexLibraryFilters(
    @Req() req: AuthenticatedRequest,
    @Query('sectionKey') sectionKeyRaw?: string,
  ) {
    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const baseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!baseUrlRaw || !token) {
      throw new BadRequestException('Plex is not configured');
    }
    const baseUrl = normalizeHttpUrl(baseUrlRaw);
    const sectionKey = (sectionKeyRaw ?? '').trim();
    const genres: string[] = [];
    const audioLanguages: string[] = [];
    const genreSet = new Set<string>();
    const languageSet = new Set<string>();

    const appendUnique = (
      values: string[],
      target: string[],
      seen: Set<string>,
    ) => {
      for (const value of values) {
        const normalized = value.trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        target.push(normalized);
      }
    };

    if (sectionKey) {
      const [sectionGenres, sectionLanguages] = await Promise.all([
        this.plexServer.listLibraryGenres({
          baseUrl,
          token,
          librarySectionKey: sectionKey,
        }),
        this.plexServer.listLibraryAudioLanguages({
          baseUrl,
          token,
          librarySectionKey: sectionKey,
        }),
      ]);
      appendUnique(sectionGenres, genres, genreSet);
      appendUnique(sectionLanguages, audioLanguages, languageSet);
    } else {
      const sections = await this.plexServer.getSections({ baseUrl, token });
      const librarySelection = resolvePlexLibrarySelection({
        settings,
        sections,
      });
      const selectedKeys = new Set(librarySelection.selectedSectionKeys);
      const selectedEligible = librarySelection.eligibleLibraries.filter(
        (library) => selectedKeys.has(library.key),
      );
      for (const library of selectedEligible) {
        const [sectionGenres, sectionLanguages] = await Promise.all([
          this.plexServer
            .listLibraryGenres({
              baseUrl,
              token,
              librarySectionKey: library.key,
            })
            .catch(() => []),
          this.plexServer
            .listLibraryAudioLanguages({
              baseUrl,
              token,
              librarySectionKey: library.key,
            })
            .catch(() => []),
        ]);
        appendUnique(sectionGenres, genres, genreSet);
        appendUnique(sectionLanguages, audioLanguages, languageSet);
      }
    }

    genres.sort((a, b) => a.localeCompare(b));
    audioLanguages.sort((a, b) => a.localeCompare(b));
    return {
      ok: true,
      sectionKey: sectionKey || null,
      genres,
      audioLanguages,
    };
  }

  @Get('plex/libraries')
  async plexLibraries(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const baseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
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
    const cleanupDeselectedLibrariesRaw = bodyObj['cleanupDeselectedLibraries'];
    const cleanupDeselectedLibraries =
      typeof cleanupDeselectedLibrariesRaw === 'boolean'
        ? cleanupDeselectedLibrariesRaw
        : true;

    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const baseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
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
    const unknownKeys = selectedSectionKeys.filter(
      (key) => !eligibleKeys.has(key),
    );
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
      cleanupDeselectedLibraries && deselectedLibraries.length > 0
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
      throw new BadRequestException(
        `Unknown Plex user ids: ${unknownIds.join(', ')}`,
      );
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
    const integrationKey = integrationId.toLowerCase();
    const context: SavedIntegrationTestContext = {
      userId,
      bodyObj: isPlainObject(body) ? body : {},
      settings,
      secrets,
    };
    return await this.runSavedIntegrationTest(integrationKey, context);
  }

  // skipcq: JS-R1005 - explicit switch keeps integration routing type-safe and auditable.
  private async runSavedIntegrationTest(
    integrationKey: string,
    context: SavedIntegrationTestContext,
  ): Promise<SavedIntegrationTestResult> {
    switch (integrationKey) {
      case 'plex':
        return await this.testSavedPlex(context);
      case 'radarr':
        return await this.testSavedRadarr(context);
      case 'sonarr':
        return await this.testSavedSonarr(context);
      case 'tmdb':
        return await this.testSavedTmdb(context);
      case 'seerr':
        return await this.testSavedSeerr(context);
      case 'google':
        return await this.testSavedGoogle(context);
      case 'openai':
        return await this.testSavedOpenAi(context);
      default:
        throw new BadRequestException(
          `Unknown integrationId: ${integrationKey}`,
        );
    }
  }

  private async resolveSavedIntegrationSecret(
    context: SavedIntegrationTestContext,
    integrationId: string,
  ): Promise<string> {
    return await this.resolveIntegrationSecret({
      userId: context.userId,
      integrationId,
      bodyObj: context.bodyObj,
      currentSecrets: context.secrets,
    });
  }

  private requireSavedBaseUrl(
    context: SavedIntegrationTestContext,
    settingPath: string,
    integrationLabel: string,
  ): string {
    const baseUrlRaw =
      pickString(context.bodyObj, 'baseUrl') ||
      pickString(context.settings, settingPath);
    if (!baseUrlRaw) {
      throw new BadRequestException(`${integrationLabel} baseUrl is not set`);
    }
    return normalizeHttpUrl(baseUrlRaw);
  }

  private async testSavedPlex(
    context: SavedIntegrationTestContext,
  ): Promise<SavedIntegrationTestResult> {
    const requestBaseUrl = pickString(context.bodyObj, 'baseUrl');
    const baseUrl = this.requireSavedBaseUrl(context, 'plex.baseUrl', 'Plex');
    const token = await this.resolveSavedIntegrationSecret(context, 'plex');
    try {
      const machineIdentifier = await this.plexServer.getMachineIdentifier({
        baseUrl,
        token,
      });
      return { ok: true, summary: { machineIdentifier } };
    } catch (primaryError) {
      const primaryMessage =
        (primaryError as Error)?.message ?? String(primaryError);
      this.logger.warn(
        `Plex integration test failed for baseUrl=${baseUrl} userId=${context.userId} reason=${JSON.stringify(primaryMessage)}`,
      );
      // If caller explicitly provided a baseUrl in this request, respect that path.
      if (requestBaseUrl) throw primaryError;

      const suggestions = await this.plex
        .suggestPreferredServerBaseUrl({ plexToken: token })
        .catch(() => ({
          suggestedBaseUrl: null,
          suggestedBaseUrls: [] as string[],
        }));
      const baseCandidates = dedupeHttpUrls([
        ...(suggestions.suggestedBaseUrls ?? []),
        String(suggestions.suggestedBaseUrl ?? ''),
      ]);
      const fallbackBaseUrls = dedupeHttpUrls(
        [
          ...baseCandidates.flatMap((candidate) =>
            derivePlexBaseUrlVariants(candidate),
          ),
          ...derivePlexBaseUrlVariants(baseUrl),
        ].filter(Boolean),
      ).filter((url) => url.toLowerCase() !== baseUrl.toLowerCase());

      for (const fallbackBaseUrl of fallbackBaseUrls) {
        try {
          const machineIdentifier = await this.plexServer.getMachineIdentifier({
            baseUrl: fallbackBaseUrl,
            token,
          });
          await this.settingsService.updateSettings(context.userId, {
            plex: { baseUrl: fallbackBaseUrl },
          });
          this.logger.log(
            `Plex integration fallback succeeded userId=${context.userId} baseUrl=${fallbackBaseUrl}`,
          );
          return { ok: true, summary: { machineIdentifier } };
        } catch {
          // Try next candidate URL.
        }
      }

      this.logger.warn(
        `Plex integration fallback exhausted userId=${context.userId} attempted=${fallbackBaseUrls.length}`,
      );

      throw primaryError;
    }
  }

  private async testSavedRadarr(
    context: SavedIntegrationTestContext,
  ): Promise<SavedIntegrationTestResult> {
    const baseUrl = this.requireSavedBaseUrl(
      context,
      'radarr.baseUrl',
      'Radarr',
    );
    const apiKey = await this.resolveSavedIntegrationSecret(context, 'radarr');
    try {
      const result = await this.radarr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    } catch (primaryError) {
      if (!isConnectivityFailure(primaryError)) throw primaryError;

      const fallbackBaseUrls = deriveContainerHostFallbackUrls(baseUrl).filter(
        (candidate) => candidate.toLowerCase() !== baseUrl.toLowerCase(),
      );
      for (const fallbackBaseUrl of fallbackBaseUrls) {
        try {
          const result = await this.radarr.testConnection({
            baseUrl: fallbackBaseUrl,
            apiKey,
          });
          await this.settingsService.updateSettings(context.userId, {
            radarr: { baseUrl: fallbackBaseUrl },
          });
          this.logger.log(
            `Radarr integration fallback succeeded userId=${context.userId} baseUrl=${fallbackBaseUrl}`,
          );
          return { ok: true, result };
        } catch {
          // Try next candidate URL.
        }
      }

      throw primaryError;
    }
  }

  private async testSavedSonarr(
    context: SavedIntegrationTestContext,
  ): Promise<SavedIntegrationTestResult> {
    const baseUrl = this.requireSavedBaseUrl(
      context,
      'sonarr.baseUrl',
      'Sonarr',
    );
    const apiKey = await this.resolveSavedIntegrationSecret(context, 'sonarr');
    try {
      const result = await this.sonarr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    } catch (primaryError) {
      if (!isConnectivityFailure(primaryError)) throw primaryError;

      const fallbackBaseUrls = deriveContainerHostFallbackUrls(baseUrl).filter(
        (candidate) => candidate.toLowerCase() !== baseUrl.toLowerCase(),
      );
      for (const fallbackBaseUrl of fallbackBaseUrls) {
        try {
          const result = await this.sonarr.testConnection({
            baseUrl: fallbackBaseUrl,
            apiKey,
          });
          await this.settingsService.updateSettings(context.userId, {
            sonarr: { baseUrl: fallbackBaseUrl },
          });
          this.logger.log(
            `Sonarr integration fallback succeeded userId=${context.userId} baseUrl=${fallbackBaseUrl}`,
          );
          return { ok: true, result };
        } catch {
          // Try next candidate URL.
        }
      }

      throw primaryError;
    }
  }

  private async testSavedTmdb(
    context: SavedIntegrationTestContext,
  ): Promise<SavedIntegrationTestResult> {
    const apiKey = await this.resolveSavedIntegrationSecret(context, 'tmdb');
    const result = await this.tmdb.testConnection({ apiKey });
    return { ok: true, result };
  }

  private async testSavedSeerr(
    context: SavedIntegrationTestContext,
  ): Promise<SavedIntegrationTestResult> {
    const baseUrl = this.requireSavedBaseUrl(context, 'seerr.baseUrl', 'Seerr');
    const apiKey = await this.resolveSavedIntegrationSecret(context, 'seerr');
    try {
      const result = await this.seerr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    } catch (primaryError) {
      if (!isConnectivityFailure(primaryError)) throw primaryError;

      const fallbackBaseUrls = deriveContainerHostFallbackUrls(baseUrl).filter(
        (candidate) => candidate.toLowerCase() !== baseUrl.toLowerCase(),
      );
      for (const fallbackBaseUrl of fallbackBaseUrls) {
        try {
          const result = await this.seerr.testConnection({
            baseUrl: fallbackBaseUrl,
            apiKey,
          });
          await this.settingsService.updateSettings(context.userId, {
            seerr: { baseUrl: fallbackBaseUrl },
          });
          this.logger.log(
            `Seerr integration fallback succeeded userId=${context.userId} baseUrl=${fallbackBaseUrl}`,
          );
          return { ok: true, result };
        } catch {
          // Try next candidate URL.
        }
      }

      throw primaryError;
    }
  }

  private async testSavedGoogle(
    context: SavedIntegrationTestContext,
  ): Promise<SavedIntegrationTestResult> {
    const cseId =
      pickString(context.bodyObj, 'cseId') ||
      pickString(context.bodyObj, 'searchEngineId') ||
      pickString(context.settings, 'google.searchEngineId');
    if (!cseId) {
      throw new BadRequestException('Google searchEngineId is not set');
    }
    const apiKey = await this.resolveSavedIntegrationSecret(context, 'google');
    const result = await this.google.testConnection({
      apiKey,
      cseId,
      query: 'tautulli curated plex',
      numResults: 3,
    });
    return { ok: true, result };
  }

  private async testSavedOpenAi(
    context: SavedIntegrationTestContext,
  ): Promise<SavedIntegrationTestResult> {
    const apiKey = await this.resolveSavedIntegrationSecret(context, 'openai');
    const result = await this.openai.testConnection({ apiKey });
    return { ok: true, result };
  }
}
