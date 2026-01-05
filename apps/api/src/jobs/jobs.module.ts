import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../db/db.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { SettingsModule } from '../settings/settings.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { ImmaculateTasteCollectionModule } from '../immaculate-taste-collection/immaculate-taste-collection.module';
import { JobsController } from './jobs.controller';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';
import { JobsHandlers } from './jobs.handlers';
import { NoopJob } from './noop.job';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { MediaAddedCleanupJob } from './media-added-cleanup.job';
import { BasedonLatestWatchedRefresherJob } from './basedon-latest-watched-refresher.job';
import { BasedonLatestWatchedCollectionJob } from './basedon-latest-watched-collection.job';
import { ImmaculateTasteCollectionJob } from './immaculate-taste-collection.job';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';

@Module({
  imports: [
    DbModule,
    SettingsModule,
    PlexModule,
    RadarrModule,
    SonarrModule,
    RecommendationsModule,
    TmdbModule,
    ImmaculateTasteCollectionModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobsScheduler,
    JobsHandlers,
    NoopJob,
    MonitorConfirmJob,
    MediaAddedCleanupJob,
    BasedonLatestWatchedCollectionJob,
    BasedonLatestWatchedRefresherJob,
    ImmaculateTasteCollectionJob,
    ImmaculateTasteRefresherJob,
  ],
  exports: [JobsService],
})
export class JobsModule {}
