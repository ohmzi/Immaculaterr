import { ApiProperty } from '@nestjs/swagger';
import { APP_VERSION } from './version';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: '2026-01-02T00:00:00.000Z' })
  time!: string;
}

export class AppMetaResponseDto {
  @ApiProperty({ example: 'immaculaterr' })
  name!: string;

  @ApiProperty({ example: APP_VERSION })
  version!: string;

  @ApiProperty({ example: '41fb2cb', nullable: true })
  buildSha!: string | null;

  @ApiProperty({ example: '2026-01-09T15:54:13.000Z', nullable: true })
  buildTime!: string | null;
}
