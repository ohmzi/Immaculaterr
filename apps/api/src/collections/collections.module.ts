import { Module } from '@nestjs/common';
import { PlexModule } from '../plex/plex.module';
import { SettingsModule } from '../settings/settings.module';
import { DbModule } from '../db/db.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

@Module({
  imports: [DbModule, SettingsModule, PlexModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
})
export class CollectionsModule {}


