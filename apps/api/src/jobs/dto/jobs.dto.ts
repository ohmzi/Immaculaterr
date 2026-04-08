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

export class CancelRunDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class QueuePauseDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
