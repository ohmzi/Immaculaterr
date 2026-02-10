import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { SettingsModule } from '../settings/settings.module';
import { PlexController } from './plex.controller';
import { PlexAnalyticsService } from './plex-analytics.service';
import { PlexCuratedCollectionsService } from './plex-curated-collections.service';
import { PlexService } from './plex.service';
import { PlexServerService } from './plex-server.service';
import { PlexWatchlistService } from './plex-watchlist.service';
import { PlexDuplicatesService } from './plex-duplicates.service';
import { PlexConnectivityMonitorService } from './plex-connectivity-monitor.service';
import { PlexActivitiesMonitorService } from './plex-activities-monitor.service';
import { PlexUsersService } from './plex-users.service';

@Module({
  imports: [DbModule, SettingsModule],
  controllers: [PlexController],
  providers: [
    PlexService,
    PlexServerService,
    PlexAnalyticsService,
    PlexCuratedCollectionsService,
    PlexUsersService,
    PlexWatchlistService,
    PlexDuplicatesService,
    PlexConnectivityMonitorService,
    PlexActivitiesMonitorService,
  ],
  exports: [
    PlexService,
    PlexServerService,
    PlexAnalyticsService,
    PlexCuratedCollectionsService,
    PlexUsersService,
    PlexWatchlistService,
    PlexDuplicatesService,
  ],
})
export class PlexModule {}
