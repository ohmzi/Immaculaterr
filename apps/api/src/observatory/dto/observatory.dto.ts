import { Allow, IsArray, IsOptional, IsString } from 'class-validator';

export class ObservatoryDecisionsDto {
  @IsOptional()
  @IsString()
  librarySectionKey?: string;

  @IsOptional()
  @IsString()
  mediaType?: string;

  @IsOptional()
  @IsArray()
  @Allow()
  decisions?: unknown[];
}

export class ObservatoryWatchedDecisionsDto {
  @IsOptional()
  @IsString()
  librarySectionKey?: string;

  @IsOptional()
  @IsString()
  mediaType?: string;

  @IsOptional()
  @IsString()
  collectionKind?: string;

  @IsOptional()
  @IsArray()
  @Allow()
  decisions?: unknown[];
}

export class ObservatoryApplyDto {
  @IsOptional()
  @IsString()
  librarySectionKey?: string;

  @IsOptional()
  @IsString()
  mediaType?: string;
}
