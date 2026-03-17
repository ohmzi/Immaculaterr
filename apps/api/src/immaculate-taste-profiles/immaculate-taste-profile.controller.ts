import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  ImmaculateTasteProfileService,
  type ImmaculateTasteProfileView,
} from './immaculate-taste-profile.service';

type MediaType = 'movie' | 'show' | 'both';
type MatchMode = 'all' | 'any';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function asOptionalSortOrder(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new BadRequestException('Expected an array of strings');
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = asString(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function asNullableString(value: unknown): string | null {
  if (value === null) return null;
  const text = asString(value);
  return text || null;
}

function asMediaType(value: unknown): MediaType | undefined {
  if (value === undefined) return undefined;
  const lowered = asString(value).toLowerCase();
  if (lowered === 'movie' || lowered === 'show' || lowered === 'both') {
    return lowered;
  }
  throw new BadRequestException('mediaType must be "movie", "show", or "both"');
}

function asMatchMode(value: unknown): MatchMode | undefined {
  if (value === undefined) return undefined;
  const lowered = asString(value).toLowerCase();
  if (lowered === 'all' || lowered === 'any') return lowered;
  throw new BadRequestException('matchMode must be "all" or "any"');
}

@Controller('immaculate-taste-profiles')
export class ImmaculateTasteProfileController {
  constructor(private readonly profiles: ImmaculateTasteProfileService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest): Promise<{
    ok: true;
    profiles: ImmaculateTasteProfileView[];
  }> {
    const profiles = await this.profiles.list(req.user.id);
    return { ok: true, profiles };
  }

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ ok: true; profile: ImmaculateTasteProfileView }> {
    if (!isPlainObject(body))
      throw new BadRequestException('body must be an object');
    const name = asString(body['name']);
    if (!name) throw new BadRequestException('name is required');
    const profile = await this.profiles.create(req.user.id, {
      name,
      mediaType: asMediaType(body['mediaType']),
      matchMode: asMatchMode(body['matchMode']),
      genres: asStringList(body['genres']),
      audioLanguages: asStringList(body['audioLanguages']),
      excludedGenres: asStringList(body['excludedGenres']),
      excludedAudioLanguages: asStringList(body['excludedAudioLanguages']),
      radarrInstanceId: asNullableString(body['radarrInstanceId']),
      sonarrInstanceId: asNullableString(body['sonarrInstanceId']),
      movieCollectionBaseName: asNullableString(
        body['movieCollectionBaseName'],
      ),
      showCollectionBaseName: asNullableString(body['showCollectionBaseName']),
      enabled: asOptionalBool(body['enabled']),
    });
    return { ok: true, profile };
  }

  @Put(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; profile: ImmaculateTasteProfileView }> {
    if (!isPlainObject(body))
      throw new BadRequestException('body must be an object');
    const profile = await this.profiles.update(req.user.id, id, {
      ...(Object.prototype.hasOwnProperty.call(body, 'name')
        ? { name: asString(body['name']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'enabled')
        ? { enabled: asOptionalBool(body['enabled']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'sortOrder')
        ? { sortOrder: asOptionalSortOrder(body['sortOrder']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'scopeAllUsers')
        ? { scopeAllUsers: asOptionalBool(body['scopeAllUsers']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'scopePlexUserId')
        ? { scopePlexUserId: asNullableString(body['scopePlexUserId']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        body,
        'resetScopeToDefaultNaming',
      )
        ? {
            resetScopeToDefaultNaming: asOptionalBool(
              body['resetScopeToDefaultNaming'],
            ),
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'mediaType')
        ? { mediaType: asMediaType(body['mediaType']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'matchMode')
        ? { matchMode: asMatchMode(body['matchMode']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'genres')
        ? { genres: asStringList(body['genres']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'audioLanguages')
        ? { audioLanguages: asStringList(body['audioLanguages']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'excludedGenres')
        ? { excludedGenres: asStringList(body['excludedGenres']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'excludedAudioLanguages')
        ? {
            excludedAudioLanguages: asStringList(
              body['excludedAudioLanguages'],
            ),
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'radarrInstanceId')
        ? { radarrInstanceId: asNullableString(body['radarrInstanceId']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'sonarrInstanceId')
        ? { sonarrInstanceId: asNullableString(body['sonarrInstanceId']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'movieCollectionBaseName')
        ? {
            movieCollectionBaseName: asNullableString(
              body['movieCollectionBaseName'],
            ),
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'showCollectionBaseName')
        ? {
            showCollectionBaseName: asNullableString(
              body['showCollectionBaseName'],
            ),
          }
        : {}),
    });
    return { ok: true, profile };
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.profiles.delete(req.user.id, id);
    return { ok: true };
  }

  @Put('reorder')
  async reorder(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ ok: true; profiles: ImmaculateTasteProfileView[] }> {
    if (!isPlainObject(body))
      throw new BadRequestException('body must be an object');
    const ids = asStringList(body['ids']);
    if (!ids || !ids.length) {
      throw new BadRequestException('ids must be a non-empty array');
    }
    const profiles = await this.profiles.reorder(req.user.id, ids);
    return { ok: true, profiles };
  }
}
