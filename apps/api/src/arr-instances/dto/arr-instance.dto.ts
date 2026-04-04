import {
  Allow,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateArrInstanceDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @Allow()
  apiKeyEnvelope?: unknown;

  @IsOptional()
  @Allow()
  secretEnvelope?: unknown;

  @IsOptional()
  @IsString()
  secretRef?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Allow()
  rootFolderPath?: unknown;

  @IsOptional()
  @Allow()
  qualityProfileId?: unknown;

  @IsOptional()
  @Allow()
  tagId?: unknown;
}

export class UpdateArrInstanceDto extends CreateArrInstanceDto {
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
