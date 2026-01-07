import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { PlexModule } from '../plex/plex.module';
import { SettingsModule } from '../settings/settings.module';
import { ImmaculateTasteCollectionService } from './immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from './immaculate-taste-show-collection.service';
import { ImmaculateTasteController } from './immaculate-taste.controller';

@Module({
  imports: [DbModule, TmdbModule, SettingsModule, PlexModule],
  controllers: [ImmaculateTasteController],
  providers: [ImmaculateTasteCollectionService, ImmaculateTasteShowCollectionService],
  exports: [ImmaculateTasteCollectionService, ImmaculateTasteShowCollectionService],
})
export class ImmaculateTasteCollectionModule {}
