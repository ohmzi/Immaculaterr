import { IsOptional, IsString } from 'class-validator';

export class CreateCollectionDto {
  @IsOptional()
  @IsString()
  name?: string;
}

export class AddCollectionItemDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  ratingKey?: string;
}

export class ImportCollectionJsonDto {
  @IsOptional()
  @IsString()
  json?: string;
}
