import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../db/db.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { SettingsModule } from '../settings/settings.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { SeerrModule } from '../seerr/seerr.module';
import { ImmaculateTasteCollectionModule } from '../immaculate-taste-collection/immaculate-taste-collection.module';
import { WatchedMovieRecommendationsModule } from '../watched-movie-recommendations/watched-movie-recommendations.module';
import { JobsController } from './jobs.controller';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';
import { JobsHandlers } from './jobs.handlers';
import { JobsRetentionService } from './jobs-retention.service';
import { JobsWatchdogService } from './jobs-watchdog.service';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { UnmonitorConfirmJob } from './unmonitor-confirm.job';
import { ArrMonitoredSearchJob } from './arr-monitored-search.job';
import { CleanupAfterAddingNewContentJob } from './cleanup-after-adding-new-content.job';
import { BasedonLatestWatchedRefresherJob } from './basedon-latest-watched-refresher.job';
import { BasedonLatestWatchedCollectionJob } from './basedon-latest-watched-collection.job';
import { ImmaculateTasteCollectionJob } from './immaculate-taste-collection.job';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';
import { CollectionResyncUpgradeJob } from './collection-resync-upgrade.job';
import { CollectionResyncUpgradeService } from './collection-resync-upgrade.service';
import { ArrInstanceModule } from '../arr-instances/arr-instance.module';
import { ImmaculateTasteProfileModule } from '../immaculate-taste-profiles/immaculate-taste-profile.module';
import { FreshOutOfTheOvenJob } from './fresh-out-of-the-oven.job';
import { TmdbUpcomingMoviesJob } from './tmdb-upcoming-movies.job';
import { ImportNetflixHistoryJob } from './import-netflix-history.job';
import { ImportPlexHistoryJob } from './import-plex-history.job';
import { ImportModule } from '../import/import.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    DbModule,
    SettingsModule,
    PlexModule,
    RadarrModule,
    SonarrModule,
    SeerrModule,
    RecommendationsModule,
    TmdbModule,
    ArrInstanceModule,
    ImmaculateTasteProfileModule,
    ImmaculateTasteCollectionModule,
    WatchedMovieRecommendationsModule,
    forwardRef(() => ImportModule),
    AuthModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobsScheduler,
    JobsHandlers,
    JobsRetentionService,
    JobsWatchdogService,
    MonitorConfirmJob,
    UnmonitorConfirmJob,
    ArrMonitoredSearchJob,
    CleanupAfterAddingNewContentJob,
    BasedonLatestWatchedCollectionJob,
    BasedonLatestWatchedRefresherJob,
    ImmaculateTasteCollectionJob,
    ImmaculateTasteRefresherJob,
    FreshOutOfTheOvenJob,
    CollectionResyncUpgradeJob,
    TmdbUpcomingMoviesJob,
    ImportNetflixHistoryJob,
    ImportPlexHistoryJob,
    CollectionResyncUpgradeService,
  ],
  exports: [JobsService],
})
export class JobsModule {}
