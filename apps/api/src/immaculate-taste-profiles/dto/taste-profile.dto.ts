import {
  Allow,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  mediaType?: string;

  @IsOptional()
  @IsString()
  matchMode?: string;

  @IsOptional()
  @IsArray()
  genres?: string[];

  @IsOptional()
  @IsArray()
  audioLanguages?: string[];

  @IsOptional()
  @IsArray()
  excludedGenres?: string[];

  @IsOptional()
  @IsArray()
  excludedAudioLanguages?: string[];

  @IsOptional()
  @Allow()
  radarrInstanceId?: unknown;

  @IsOptional()
  @Allow()
  sonarrInstanceId?: unknown;

  @IsOptional()
  @Allow()
  movieCollectionBaseName?: unknown;

  @IsOptional()
  @Allow()
  showCollectionBaseName?: unknown;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateProfileDto extends CreateProfileDto {
  @IsOptional()
  @Allow()
  sortOrder?: unknown;

  @IsOptional()
  @IsBoolean()
  scopeAllUsers?: boolean;

  @IsOptional()
  @Allow()
  scopePlexUserId?: unknown;

  @IsOptional()
  @IsBoolean()
  resetScopeToDefaultNaming?: boolean;
}

export class ReorderProfilesDto {
  @IsOptional()
  @IsArray()
  ids?: string[];
}
