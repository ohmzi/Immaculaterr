import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RadarrService } from '../radarr/radarr.service';
import { SettingsService } from '../settings/settings.service';
import { SonarrService } from '../sonarr/sonarr.service';
import {
  ArrInstanceService,
  type ArrInstanceType,
} from './arr-instance.service';
import {
  CreateArrInstanceDto,
  UpdateArrInstanceDto,
} from './dto/arr-instance.dto';

type ArrInstanceUpdatePatch = {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  tagId?: number | null;
  sortOrder?: number;
};

const asString = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const asNullableString = (value: unknown): string | null => {
  if (value === null) return null;
  return asString(value) || null;
};

const asPositiveInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
};

const asNullablePositiveInt = (value: unknown): number | null => {
  if (value === null) return null;
  const parsed = asPositiveInt(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const asOptionalBool = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  return undefined;
};

const asArrType = (value: string): ArrInstanceType => {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'radarr' || lowered === 'sonarr') return lowered;
  throw new BadRequestException('type must be "radarr" or "sonarr"');
};

const normalizeHttpUrlOrEmpty = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const normalized = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    const out = parsed.toString();
    return out.endsWith('/') ? out.slice(0, -1) : out;
  } catch {
    return '';
  }
};

const dedupeHttpUrls = (urls: string[]): string[] => {
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
};

const isLikelyLocalHostname = (hostnameRaw: string): boolean => {
  const hostname = hostnameRaw.trim().toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === 'host.docker.internal' ||
    hostname === 'gateway.docker.internal'
  );
};

const deriveContainerHostFallbackUrls = (raw: string): string[] => {
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
};

const isConnectivityFailure = (error: unknown): boolean => {
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
};

@Controller('arr-instances')
export class ArrInstanceController {
  constructor(
    private readonly arrInstances: ArrInstanceService,
    private readonly settingsService: SettingsService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('type') typeRaw?: string,
  ) {
    const type = typeRaw ? asArrType(typeRaw) : undefined;
    const instances = await this.arrInstances.list(req.user.id, type);
    return { ok: true, instances };
  }

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateArrInstanceDto,
  ) {
    const bodyObject = body as unknown as Record<string, unknown>;
    const type = asArrType(asString(bodyObject['type']));
    const baseUrl = asString(bodyObject['baseUrl']);
    if (!baseUrl) throw new BadRequestException('baseUrl is required');
    const apiKey = await this.resolveApiKeyInput({
      userId: req.user.id,
      type,
      body: bodyObject,
      expectedPurpose: `arrInstances.${type}.create`,
      emptyMessage: 'apiKey is required',
    });
    const instance = await this.arrInstances.create(req.user.id, {
      type,
      name: asString(bodyObject['name']) || undefined,
      baseUrl,
      apiKey,
      enabled: asOptionalBool(bodyObject['enabled']),
      rootFolderPath: asNullableString(bodyObject['rootFolderPath']),
      qualityProfileId: asNullablePositiveInt(bodyObject['qualityProfileId']),
      tagId: asNullablePositiveInt(bodyObject['tagId']),
    });
    return { ok: true, instance };
  }

  @Put(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateArrInstanceDto,
  ) {
    const bodyObject = body as unknown as Record<string, unknown>;
    const userId = req.user.id;
    const current = await this.arrInstances.getOwnedDbInstance(userId, id);
    const type = asArrType(current.type);
    const patch = this.buildUpdatePatch(bodyObject);

    if (this.hasApiKeyPatch(bodyObject)) {
      patch.apiKey = await this.resolveApiKeyInput({
        userId,
        type,
        body: bodyObject,
        expectedPurpose: `arrInstances.${type}.update`,
        emptyMessage: 'apiKey cannot be empty',
      });
    }

    const instance = await this.arrInstances.update(userId, id, patch);
    return { ok: true, instance };
  }

  @Delete(':id')
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.arrInstances.delete(req.user.id, id);
    return { ok: true };
  }

  @Post(':id/test')
  async test(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('type') typeRaw?: string,
  ) {
    const userId = req.user.id;
    const type = typeRaw
      ? asArrType(typeRaw)
      : await this.arrInstances.inferTypeForInstanceId(userId, id);
    if (!type) {
      throw new BadRequestException(
        'Could not infer instance type; provide ?type=',
      );
    }
    const resolved = await this.arrInstances.resolveInstance(userId, type, id, {
      requireConfigured: true,
    });
    const result = await this.testArrConnectionWithFallback({
      userId,
      type,
      id: resolved.id,
      isPrimary: resolved.isPrimary,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
    });
    return {
      ok: true,
      instance: { ...resolved, baseUrl: result.baseUrl },
      result,
    };
  }

  @Get(':id/options')
  async options(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('type') typeRaw?: string,
  ) {
    const userId = req.user.id;
    const type = typeRaw
      ? asArrType(typeRaw)
      : await this.arrInstances.inferTypeForInstanceId(userId, id);
    if (!type) {
      throw new BadRequestException(
        'Could not infer instance type; provide ?type=',
      );
    }
    const resolved = await this.arrInstances.resolveInstance(userId, type, id, {
      requireConfigured: true,
    });
    const { rootFolders, qualityProfiles, tags } =
      await this.loadArrOptionsWithFallback({
        userId,
        type,
        id: resolved.id,
        isPrimary: resolved.isPrimary,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
      });
    rootFolders.sort((a, b) => a.path.localeCompare(b.path));
    qualityProfiles.sort((a, b) => a.name.localeCompare(b.name));
    tags.sort((a, b) => a.label.localeCompare(b.label));
    return {
      ok: true,
      instance: {
        id: resolved.id,
        name: resolved.name,
        type,
        isPrimary: resolved.isPrimary,
      },
      rootFolders,
      qualityProfiles,
      tags,
    };
  }

  private buildUpdatePatch(
    body: Record<string, unknown>,
  ): ArrInstanceUpdatePatch {
    const patch: ArrInstanceUpdatePatch = {};
    this.applyNamePatch(patch, body);
    this.applyBaseUrlPatch(patch, body);
    this.applyEnabledPatch(patch, body);
    this.applyRootFolderPatch(patch, body);
    this.applyQualityProfilePatch(patch, body);
    this.applyTagPatch(patch, body);
    this.applySortOrderPatch(patch, body);
    return patch;
  }

  private applyNamePatch(
    patch: ArrInstanceUpdatePatch,
    body: Record<string, unknown>,
  ): void {
    if ('name' in body) patch.name = asString(body['name']);
  }

  private applyBaseUrlPatch(
    patch: ArrInstanceUpdatePatch,
    body: Record<string, unknown>,
  ): void {
    if ('baseUrl' in body) patch.baseUrl = asString(body['baseUrl']);
  }

  private applyEnabledPatch(
    patch: ArrInstanceUpdatePatch,
    body: Record<string, unknown>,
  ): void {
    if (!('enabled' in body)) return;
    const enabled = asOptionalBool(body['enabled']);
    if (enabled === undefined) {
      throw new BadRequestException('enabled must be a boolean');
    }
    patch.enabled = enabled;
  }

  private applyRootFolderPatch(
    patch: ArrInstanceUpdatePatch,
    body: Record<string, unknown>,
  ): void {
    if ('rootFolderPath' in body) {
      patch.rootFolderPath = asNullableString(body['rootFolderPath']);
    }
  }

  private applyQualityProfilePatch(
    patch: ArrInstanceUpdatePatch,
    body: Record<string, unknown>,
  ): void {
    if ('qualityProfileId' in body) {
      patch.qualityProfileId = asNullablePositiveInt(body['qualityProfileId']);
    }
  }

  private applyTagPatch(
    patch: ArrInstanceUpdatePatch,
    body: Record<string, unknown>,
  ): void {
    if ('tagId' in body) {
      patch.tagId = asNullablePositiveInt(body['tagId']);
    }
  }

  private applySortOrderPatch(
    patch: ArrInstanceUpdatePatch,
    body: Record<string, unknown>,
  ): void {
    if (!('sortOrder' in body)) return;
    const sortOrder = asNullablePositiveInt(body['sortOrder']);
    patch.sortOrder = sortOrder === null ? 0 : sortOrder;
  }

  private hasApiKeyPatch(body: Record<string, unknown>): boolean {
    return (
      'apiKey' in body ||
      'apiKeyEnvelope' in body ||
      'secretEnvelope' in body ||
      'secretRef' in body
    );
  }

  private async resolveApiKeyInput(params: {
    userId: string;
    type: ArrInstanceType;
    body: Record<string, unknown>;
    expectedPurpose: string;
    emptyMessage: string;
  }): Promise<string> {
    const { secrets } = await this.settingsService.getInternalSettings(
      params.userId,
    );
    const resolvedApiKey = await this.settingsService.resolveServiceSecretInput(
      {
        userId: params.userId,
        service: params.type,
        secretField: 'apiKey',
        expectedPurpose: params.expectedPurpose,
        envelope:
          params.body['apiKeyEnvelope'] ?? params.body['secretEnvelope'],
        secretRef: params.body['secretRef'],
        plaintext: params.body['apiKey'],
        currentSecrets: secrets,
      },
    );
    if (!resolvedApiKey.value) {
      throw new BadRequestException(params.emptyMessage);
    }
    return resolvedApiKey.value;
  }

  private async testArrConnectionWithFallback(params: {
    userId: string;
    type: ArrInstanceType;
    id: string;
    isPrimary: boolean;
    baseUrl: string;
    apiKey: string;
  }): Promise<{ baseUrl: string; result: unknown }> {
    const run = async (baseUrl: string) => {
      return params.type === 'radarr'
        ? await this.radarr.testConnection({
            baseUrl,
            apiKey: params.apiKey,
          })
        : await this.sonarr.testConnection({
            baseUrl,
            apiKey: params.apiKey,
          });
    };

    try {
      const result = await run(params.baseUrl);
      return { baseUrl: params.baseUrl, result };
    } catch (primaryError) {
      if (!isConnectivityFailure(primaryError)) throw primaryError;
      const fallbackBaseUrls = deriveContainerHostFallbackUrls(
        params.baseUrl,
      ).filter(
        (candidate) => candidate.toLowerCase() !== params.baseUrl.toLowerCase(),
      );
      for (const fallbackBaseUrl of fallbackBaseUrls) {
        try {
          const result = await run(fallbackBaseUrl);
          await this.persistFallbackBaseUrl({
            userId: params.userId,
            type: params.type,
            id: params.id,
            isPrimary: params.isPrimary,
            baseUrl: fallbackBaseUrl,
          });
          return { baseUrl: fallbackBaseUrl, result };
        } catch {
          // Try next candidate URL.
        }
      }
      throw primaryError;
    }
  }

  private async loadArrOptionsWithFallback(params: {
    userId: string;
    type: ArrInstanceType;
    id: string;
    isPrimary: boolean;
    baseUrl: string;
    apiKey: string;
  }): Promise<{
    baseUrl: string;
    rootFolders: { path: string }[];
    qualityProfiles: { name: string }[];
    tags: { label: string }[];
  }> {
    const run = async (baseUrl: string) => {
      const [rootFolders, qualityProfiles, tags] =
        params.type === 'radarr'
          ? await Promise.all([
              this.radarr.listRootFolders({
                baseUrl,
                apiKey: params.apiKey,
              }),
              this.radarr.listQualityProfiles({
                baseUrl,
                apiKey: params.apiKey,
              }),
              this.radarr.listTags({
                baseUrl,
                apiKey: params.apiKey,
              }),
            ])
          : await Promise.all([
              this.sonarr.listRootFolders({
                baseUrl,
                apiKey: params.apiKey,
              }),
              this.sonarr.listQualityProfiles({
                baseUrl,
                apiKey: params.apiKey,
              }),
              this.sonarr.listTags({
                baseUrl,
                apiKey: params.apiKey,
              }),
            ]);
      return { rootFolders, qualityProfiles, tags };
    };

    try {
      const result = await run(params.baseUrl);
      return { baseUrl: params.baseUrl, ...result };
    } catch (primaryError) {
      if (!isConnectivityFailure(primaryError)) throw primaryError;
      const fallbackBaseUrls = deriveContainerHostFallbackUrls(
        params.baseUrl,
      ).filter(
        (candidate) => candidate.toLowerCase() !== params.baseUrl.toLowerCase(),
      );
      for (const fallbackBaseUrl of fallbackBaseUrls) {
        try {
          const result = await run(fallbackBaseUrl);
          await this.persistFallbackBaseUrl({
            userId: params.userId,
            type: params.type,
            id: params.id,
            isPrimary: params.isPrimary,
            baseUrl: fallbackBaseUrl,
          });
          return { baseUrl: fallbackBaseUrl, ...result };
        } catch {
          // Try next candidate URL.
        }
      }
      throw primaryError;
    }
  }

  private async persistFallbackBaseUrl(params: {
    userId: string;
    type: ArrInstanceType;
    id: string;
    isPrimary: boolean;
    baseUrl: string;
  }): Promise<void> {
    if (params.isPrimary) {
      if (params.type === 'radarr') {
        await this.settingsService.updateSettings(params.userId, {
          radarr: { baseUrl: params.baseUrl },
        });
      } else {
        await this.settingsService.updateSettings(params.userId, {
          sonarr: { baseUrl: params.baseUrl },
        });
      }
      return;
    }
    await this.arrInstances.update(params.userId, params.id, {
      baseUrl: params.baseUrl,
    });
  }
}
