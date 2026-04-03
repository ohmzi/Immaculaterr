import { Allow, IsBoolean, IsOptional, IsString } from 'class-validator';

export class RunJobDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @Allow()
  input?: unknown;
}

export class UpsertScheduleDto {
  @IsOptional()
  @IsString()
  cron?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  timezone?: string;
}
