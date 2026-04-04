import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ResetCollectionDto {
  @IsOptional()
  @IsString()
  mediaType?: string;

  @IsOptional()
  @IsString()
  librarySectionKey?: string;
}

export class ResetUserCollectionDto {
  @IsOptional()
  @IsString()
  plexUserId?: string;

  @IsOptional()
  @IsString()
  mediaType?: string;

  @IsOptional()
  @IsBoolean()
  includeWatchedCollections?: boolean;
}
