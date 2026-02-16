import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../db/db.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { SettingsModule } from '../settings/settings.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { OverseerrModule } from '../overseerr/overseerr.module';
import { ImmaculateTasteCollectionModule } from '../immaculate-taste-collection/immaculate-taste-collection.module';
import { WatchedMovieRecommendationsModule } from '../watched-movie-recommendations/watched-movie-recommendations.module';
import { JobsController } from './jobs.controller';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';
import { JobsHandlers } from './jobs.handlers';
import { JobsRetentionService } from './jobs-retention.service';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { ArrMonitoredSearchJob } from './arr-monitored-search.job';
import { CleanupAfterAddingNewContentJob } from './cleanup-after-adding-new-content.job';
import { BasedonLatestWatchedRefresherJob } from './basedon-latest-watched-refresher.job';
import { BasedonLatestWatchedCollectionJob } from './basedon-latest-watched-collection.job';
import { ImmaculateTasteCollectionJob } from './immaculate-taste-collection.job';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';
import { CollectionResyncUpgradeJob } from './collection-resync-upgrade.job';
import { CollectionResyncUpgradeService } from './collection-resync-upgrade.service';

@Module({
  imports: [
    DbModule,
    SettingsModule,
    PlexModule,
    RadarrModule,
    SonarrModule,
    OverseerrModule,
    RecommendationsModule,
    TmdbModule,
    ImmaculateTasteCollectionModule,
    WatchedMovieRecommendationsModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobsScheduler,
    JobsHandlers,
    JobsRetentionService,
    MonitorConfirmJob,
    ArrMonitoredSearchJob,
    CleanupAfterAddingNewContentJob,
    BasedonLatestWatchedCollectionJob,
    BasedonLatestWatchedRefresherJob,
    ImmaculateTasteCollectionJob,
    ImmaculateTasteRefresherJob,
    CollectionResyncUpgradeJob,
    CollectionResyncUpgradeService,
  ],
  exports: [JobsService],
})
export class JobsModule {}
