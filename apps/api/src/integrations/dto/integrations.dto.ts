import { Allow, IsArray, IsBoolean, IsOptional } from 'class-validator';

export class UpdatePlexLibrariesDto {
  @IsOptional()
  @IsArray()
  selectedSectionKeys?: unknown[];

  @IsOptional()
  @IsBoolean()
  cleanupDeselectedLibraries?: boolean;
}

export class UpdatePlexMonitoringUsersDto {
  @IsOptional()
  @IsArray()
  selectedPlexUserIds?: unknown[];
}

export class TestSavedIntegrationDto {
  @IsOptional()
  @Allow()
  baseUrl?: unknown;

  @IsOptional()
  @Allow()
  token?: unknown;

  @IsOptional()
  @Allow()
  apiKey?: unknown;

  @IsOptional()
  @Allow()
  tokenEnvelope?: unknown;

  @IsOptional()
  @Allow()
  apiKeyEnvelope?: unknown;

  @IsOptional()
  @Allow()
  secretEnvelope?: unknown;

  @IsOptional()
  @Allow()
  secretRef?: unknown;

  @IsOptional()
  @Allow()
  cseId?: unknown;

  @IsOptional()
  @Allow()
  searchEngineId?: unknown;
}
