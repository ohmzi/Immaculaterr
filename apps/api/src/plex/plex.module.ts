import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PlexController } from './plex.controller';
import { PlexAnalyticsService } from './plex-analytics.service';
import { PlexService } from './plex.service';
import { PlexServerService } from './plex-server.service';

@Module({
  imports: [SettingsModule],
  controllers: [PlexController],
  providers: [PlexService, PlexServerService, PlexAnalyticsService],
  exports: [PlexService, PlexServerService, PlexAnalyticsService],
})
export class PlexModule {}
