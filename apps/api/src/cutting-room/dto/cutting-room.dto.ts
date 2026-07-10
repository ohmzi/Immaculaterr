import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateCuttingRoomRulesDto {
  @Allow()
  rules!: Record<string, unknown>;
}

export class StartAnalyzeDto {
  @IsIn(['movie', 'show'])
  mediaType!: 'movie' | 'show';

  @IsArray()
  @IsString({ each: true })
  sectionKeys!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  instanceIds?: string[];

  @IsOptional()
  @Allow()
  rulesOverride?: Record<string, unknown>;
}

export class AutoSelectDto {
  @IsNumber()
  @Min(1)
  targetBytes!: number;

  @IsOptional()
  @IsInt()
  maxTier?: number;

  @IsOptional()
  @IsInt()
  minScore?: number;

  @IsOptional()
  @IsString()
  rootFolder?: string;
}

export class PatchSelectionDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsBoolean()
  selected!: boolean;

  @IsOptional()
  @IsInt()
  maxTier?: number;

  @IsOptional()
  @IsInt()
  minScore?: number;

  @IsOptional()
  @IsString()
  rootFolder?: string;
}

export class StartPruneDto {
  @IsString()
  confirmation!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  waveSize?: number;

  @IsOptional()
  @IsBoolean()
  removeEntry?: boolean;

  @IsOptional()
  @IsBoolean()
  addImportExclusion?: boolean;
}

export class DuplicateCleanupDto {
  @IsArray()
  @IsString({ each: true })
  ratingKeys!: string[];

  @IsIn(['smallest_file', 'largest_file'])
  deletePreference!: 'smallest_file' | 'largest_file';

  @IsString()
  confirmation!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class LargeFileItemDto {
  @IsIn(['movie', 'episode'])
  kind!: 'movie' | 'episode';

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  showTitle?: string | null;

  @IsOptional()
  @IsInt()
  seasonNumber?: number | null;

  @IsOptional()
  @IsInt()
  episodeNumber?: number | null;

  @IsNumber()
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  path?: string | null;

  @IsOptional()
  @IsString()
  arrInstanceId?: string | null;

  @IsOptional()
  @IsInt()
  movieId?: number | null;

  @IsOptional()
  @IsString()
  plexRatingKey?: string | null;
}

export class LargeFilesReplaceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LargeFileItemDto)
  items!: LargeFileItemDto[];

  @IsString()
  confirmation!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class WantedPruneDto {
  @IsIn(['radarr', 'sonarr'])
  type!: 'radarr' | 'sonarr';

  @IsOptional()
  @IsString()
  instanceId?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  arrIds?: number[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsIn(['unmonitor', 'remove'])
  mode!: 'unmonitor' | 'remove';

  @IsString()
  confirmation!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsBoolean()
  addImportExclusion?: boolean;
}
