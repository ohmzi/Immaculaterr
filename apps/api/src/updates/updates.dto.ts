import { ApiProperty } from '@nestjs/swagger';

export class UpdatesResponseDto {
  @ApiProperty({ example: '1.0.0.501' })
  currentVersion!: string;

  @ApiProperty({ example: '1.0.0.501', nullable: true })
  latestVersion!: string | null;

  @ApiProperty({ example: true })
  updateAvailable!: boolean;

  @ApiProperty({ example: 'github-releases' })
  source!: 'github-releases';

  @ApiProperty({ example: 'ohmz/Immaculaterr', nullable: true })
  repo!: string | null;

  @ApiProperty({
    example: 'https://github.com/ohmz/Immaculaterr/releases/tag/v1.0.0.501',
    nullable: true,
  })
  latestUrl!: string | null;

  @ApiProperty({ example: '2026-01-09T16:05:00.000Z' })
  checkedAt!: string;

  @ApiProperty({ example: null, nullable: true })
  error!: string | null;
}

