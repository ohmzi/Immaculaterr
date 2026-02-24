import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TmdbController } from './tmdb.controller';
import { TmdbService } from './tmdb.service';

@Module({
  imports: [SettingsModule],
  controllers: [TmdbController],
  providers: [TmdbService],
  exports: [TmdbService],
})
export class TmdbModule {}
