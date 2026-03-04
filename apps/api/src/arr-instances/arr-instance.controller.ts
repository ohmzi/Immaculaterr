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
import { ArrInstanceService, type ArrInstanceType } from './arr-instance.service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNullableString(value: unknown): string | null {
  if (value === null) return null;
  return asString(value) || null;
}

function asNullablePositiveInt(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return null;
}

function asOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function asArrType(value: string): ArrInstanceType {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'radarr' || lowered === 'sonarr') return lowered;
  throw new BadRequestException('type must be "radarr" or "sonarr"');
}

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
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    if (!isPlainObject(body)) throw new BadRequestException('body must be an object');
    const type = asArrType(asString(body['type']));
    const baseUrl = asString(body['baseUrl']);
    if (!baseUrl) throw new BadRequestException('baseUrl is required');
    const { secrets } = await this.settingsService.getInternalSettings(req.user.id);
    const resolvedApiKey = await this.settingsService.resolveServiceSecretInput({
      userId: req.user.id,
      service: type,
      secretField: 'apiKey',
      expectedPurpose: `arrInstances.${type}.create`,
      envelope: body['apiKeyEnvelope'] ?? body['secretEnvelope'],
      secretRef: body['secretRef'],
      plaintext: body['apiKey'],
      currentSecrets: secrets,
    });
    if (!resolvedApiKey.value) {
      throw new BadRequestException('apiKey is required');
    }
    const instance = await this.arrInstances.create(req.user.id, {
      type,
      name: asString(body['name']) || undefined,
      baseUrl,
      apiKey: resolvedApiKey.value,
      enabled: asOptionalBool(body['enabled']),
      rootFolderPath: asNullableString(body['rootFolderPath']),
      qualityProfileId: asNullablePositiveInt(body['qualityProfileId']),
      tagId: asNullablePositiveInt(body['tagId']),
    });
    return { ok: true, instance };
  }

  @Put(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    if (!isPlainObject(body)) throw new BadRequestException('body must be an object');
    const userId = req.user.id;
    const current = await this.arrInstances.getOwnedDbInstance(userId, id);
    const type = asArrType(current.type);
    const patch: {
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      enabled?: boolean;
      rootFolderPath?: string | null;
      qualityProfileId?: number | null;
      tagId?: number | null;
      sortOrder?: number;
    } = {};

    if ('name' in body) patch.name = asString(body['name']);
    if ('baseUrl' in body) patch.baseUrl = asString(body['baseUrl']);
    if ('enabled' in body) {
      const enabled = asOptionalBool(body['enabled']);
      if (enabled === undefined) {
        throw new BadRequestException('enabled must be a boolean');
      }
      patch.enabled = enabled;
    }
    if ('rootFolderPath' in body) {
      patch.rootFolderPath = asNullableString(body['rootFolderPath']);
    }
    if ('qualityProfileId' in body) {
      patch.qualityProfileId = asNullablePositiveInt(body['qualityProfileId']);
    }
    if ('tagId' in body) {
      patch.tagId = asNullablePositiveInt(body['tagId']);
    }
    if ('sortOrder' in body) {
      const sortOrder = asNullablePositiveInt(body['sortOrder']);
      patch.sortOrder = sortOrder === null ? 0 : sortOrder;
    }

    if (
      'apiKey' in body ||
      'apiKeyEnvelope' in body ||
      'secretEnvelope' in body ||
      'secretRef' in body
    ) {
      const { secrets } = await this.settingsService.getInternalSettings(userId);
      const resolvedApiKey = await this.settingsService.resolveServiceSecretInput({
        userId,
        service: type,
        secretField: 'apiKey',
        expectedPurpose: `arrInstances.${type}.update`,
        envelope: body['apiKeyEnvelope'] ?? body['secretEnvelope'],
        secretRef: body['secretRef'],
        plaintext: body['apiKey'],
        currentSecrets: secrets,
      });
      if (!resolvedApiKey.value) {
        throw new BadRequestException('apiKey cannot be empty');
      }
      patch.apiKey = resolvedApiKey.value;
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
      throw new BadRequestException('Could not infer instance type; provide ?type=');
    }
    const resolved = await this.arrInstances.resolveInstance(userId, type, id, {
      requireConfigured: true,
    });
    const result =
      type === 'radarr'
        ? await this.radarr.testConnection({
            baseUrl: resolved.baseUrl,
            apiKey: resolved.apiKey,
          })
        : await this.sonarr.testConnection({
            baseUrl: resolved.baseUrl,
            apiKey: resolved.apiKey,
          });
    return { ok: true, instance: resolved, result };
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
      throw new BadRequestException('Could not infer instance type; provide ?type=');
    }
    const resolved = await this.arrInstances.resolveInstance(userId, type, id, {
      requireConfigured: true,
    });
    const [rootFolders, qualityProfiles, tags] =
      type === 'radarr'
        ? await Promise.all([
            this.radarr.listRootFolders({
              baseUrl: resolved.baseUrl,
              apiKey: resolved.apiKey,
            }),
            this.radarr.listQualityProfiles({
              baseUrl: resolved.baseUrl,
              apiKey: resolved.apiKey,
            }),
            this.radarr.listTags({
              baseUrl: resolved.baseUrl,
              apiKey: resolved.apiKey,
            }),
          ])
        : await Promise.all([
            this.sonarr.listRootFolders({
              baseUrl: resolved.baseUrl,
              apiKey: resolved.apiKey,
            }),
            this.sonarr.listQualityProfiles({
              baseUrl: resolved.baseUrl,
              apiKey: resolved.apiKey,
            }),
            this.sonarr.listTags({
              baseUrl: resolved.baseUrl,
              apiKey: resolved.apiKey,
            }),
          ]);
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
}
