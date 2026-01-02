import { Module } from '@nestjs/common';
import { TmdbController } from './tmdb.controller';
import { TmdbService } from './tmdb.service';

@Module({
  controllers: [TmdbController],
  providers: [TmdbService],
  exports: [TmdbService],
})
export class TmdbModule {}
