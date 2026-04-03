import { Allow, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @Allow()
  settings?: unknown;

  @IsOptional()
  @Allow()
  secrets?: unknown;

  @IsOptional()
  @Allow()
  secretsEnvelope?: unknown;
}
