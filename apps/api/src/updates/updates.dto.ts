import { ApiProperty } from '@nestjs/swagger';
import { APP_VERSION, APP_VERSION_TAG } from '../version';

export class UpdatesResponseDto {
  @ApiProperty({ example: APP_VERSION })
  currentVersion!: string;

  @ApiProperty({ example: APP_VERSION, nullable: true })
  latestVersion!: string | null;

  @ApiProperty({ example: true })
  updateAvailable!: boolean;

  @ApiProperty({ example: 'github-releases' })
  source!: 'github-releases';

  @ApiProperty({ example: 'ohmz/Immaculaterr', nullable: true })
  repo!: string | null;

  @ApiProperty({
    example: `https://github.com/ohmz/Immaculaterr/releases/tag/${APP_VERSION_TAG}`,
    nullable: true,
  })
  latestUrl!: string | null;

  @ApiProperty({ example: '2026-01-09T16:05:00.000Z' })
  checkedAt!: string;

  @ApiProperty({ example: null, nullable: true })
  error!: string | null;
}

