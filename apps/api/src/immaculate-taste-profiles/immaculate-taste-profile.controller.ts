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
import {
  CreateProfileDto,
  UpdateProfileDto,
  ReorderProfilesDto,
} from './dto/taste-profile.dto';

type MediaType = 'movie' | 'show' | 'both';
type MatchMode = 'all' | 'any';

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
    @Body() body: CreateProfileDto,
  ): Promise<{ ok: true; profile: ImmaculateTasteProfileView }> {
    const bodyObject = body as unknown as Record<string, unknown>;
    const name = asString(bodyObject['name']);
    if (!name) throw new BadRequestException('name is required');
    const profile = await this.profiles.create(req.user.id, {
      name,
      mediaType: asMediaType(bodyObject['mediaType']),
      matchMode: asMatchMode(bodyObject['matchMode']),
      genres: asStringList(bodyObject['genres']),
      audioLanguages: asStringList(bodyObject['audioLanguages']),
      excludedGenres: asStringList(bodyObject['excludedGenres']),
      excludedAudioLanguages: asStringList(
        bodyObject['excludedAudioLanguages'],
      ),
      radarrInstanceId: asNullableString(bodyObject['radarrInstanceId']),
      sonarrInstanceId: asNullableString(bodyObject['sonarrInstanceId']),
      movieCollectionBaseName: asNullableString(
        bodyObject['movieCollectionBaseName'],
      ),
      showCollectionBaseName: asNullableString(
        bodyObject['showCollectionBaseName'],
      ),
      enabled: asOptionalBool(bodyObject['enabled']),
    });
    return { ok: true, profile };
  }

  @Put(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateProfileDto,
  ): Promise<{ ok: true; profile: ImmaculateTasteProfileView }> {
    const bodyObject = body as unknown as Record<string, unknown>;
    const profile = await this.profiles.update(req.user.id, id, {
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'name')
        ? { name: asString(bodyObject['name']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'enabled')
        ? { enabled: asOptionalBool(bodyObject['enabled']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'sortOrder')
        ? { sortOrder: asOptionalSortOrder(bodyObject['sortOrder']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'scopeAllUsers')
        ? { scopeAllUsers: asOptionalBool(bodyObject['scopeAllUsers']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'scopePlexUserId')
        ? { scopePlexUserId: asNullableString(bodyObject['scopePlexUserId']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        bodyObject,
        'resetScopeToDefaultNaming',
      )
        ? {
            resetScopeToDefaultNaming: asOptionalBool(
              bodyObject['resetScopeToDefaultNaming'],
            ),
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'mediaType')
        ? { mediaType: asMediaType(bodyObject['mediaType']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'matchMode')
        ? { matchMode: asMatchMode(bodyObject['matchMode']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'genres')
        ? { genres: asStringList(bodyObject['genres']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'audioLanguages')
        ? { audioLanguages: asStringList(bodyObject['audioLanguages']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'excludedGenres')
        ? { excludedGenres: asStringList(bodyObject['excludedGenres']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        bodyObject,
        'excludedAudioLanguages',
      )
        ? {
            excludedAudioLanguages: asStringList(
              bodyObject['excludedAudioLanguages'],
            ),
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'radarrInstanceId')
        ? { radarrInstanceId: asNullableString(bodyObject['radarrInstanceId']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyObject, 'sonarrInstanceId')
        ? { sonarrInstanceId: asNullableString(bodyObject['sonarrInstanceId']) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        bodyObject,
        'movieCollectionBaseName',
      )
        ? {
            movieCollectionBaseName: asNullableString(
              bodyObject['movieCollectionBaseName'],
            ),
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        bodyObject,
        'showCollectionBaseName',
      )
        ? {
            showCollectionBaseName: asNullableString(
              bodyObject['showCollectionBaseName'],
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
    @Body() body: ReorderProfilesDto,
  ): Promise<{ ok: true; profiles: ImmaculateTasteProfileView[] }> {
    const bodyObject = body as unknown as Record<string, unknown>;
    const ids = asStringList(bodyObject['ids']);
    if (!ids || !ids.length) {
      throw new BadRequestException('ids must be a non-empty array');
    }
    const profiles = await this.profiles.reorder(req.user.id, ids);
    return { ok: true, profiles };
  }
}
