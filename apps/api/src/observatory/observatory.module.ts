import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { SettingsModule } from '../settings/settings.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { ImmaculateTasteCollectionModule } from '../immaculate-taste-collection/immaculate-taste-collection.module';
import { ObservatoryController } from './observatory.controller';
import { ObservatoryService } from './observatory.service';

@Module({
  imports: [
    DbModule,
    SettingsModule,
    PlexModule,
    TmdbModule,
    RadarrModule,
    SonarrModule,
    ImmaculateTasteCollectionModule,
  ],
  controllers: [ObservatoryController],
  providers: [ObservatoryService],
})
export class ObservatoryModule {}

