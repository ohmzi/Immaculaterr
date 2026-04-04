import { IsOptional, IsString } from 'class-validator';

export class DeleteArtworkOverrideDto {
  @IsOptional()
  @IsString()
  plexUserId?: string;

  @IsOptional()
  @IsString()
  mediaType?: string;

  @IsOptional()
  @IsString()
  targetKind?: string;

  @IsOptional()
  @IsString()
  targetId?: string;
}
