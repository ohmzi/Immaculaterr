import { Allow, IsOptional, IsString } from 'class-validator';

export class TestConnectionDto {
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @Allow()
  apiKeyEnvelope?: unknown;

  @IsOptional()
  @IsString()
  secretRef?: string;
}

export class TestPlexServerDto {
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @Allow()
  tokenEnvelope?: unknown;

  @IsOptional()
  @IsString()
  secretRef?: string;
}

export class TestGoogleDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @Allow()
  apiKeyEnvelope?: unknown;

  @IsOptional()
  @IsString()
  secretRef?: string;

  @IsOptional()
  @IsString()
  cseId?: string;

  @IsOptional()
  @Allow()
  numResults?: unknown;

  @IsOptional()
  @IsString()
  query?: string;
}

export class TestApiKeyDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @Allow()
  apiKeyEnvelope?: unknown;

  @IsOptional()
  @IsString()
  secretRef?: string;
}
