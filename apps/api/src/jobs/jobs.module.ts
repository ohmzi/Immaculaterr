import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../db/db.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { SettingsModule } from '../settings/settings.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { ImmaculateTasteModule } from '../immaculate-taste/immaculate-taste.module';
import { JobsController } from './jobs.controller';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';
import { JobsHandlers } from './jobs.handlers';
import { NoopJob } from './noop.job';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { RecentlyWatchedRefresherJob } from './recently-watched-refresher.job';
import { WatchedMovieRecommendationsJob } from './watched-movie-recommendations.job';
import { ImmaculateTastePointsJob } from './immaculate-taste-points.job';
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
    ImmaculateTasteModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobsScheduler,
    JobsHandlers,
    NoopJob,
    MonitorConfirmJob,
    WatchedMovieRecommendationsJob,
    RecentlyWatchedRefresherJob,
    ImmaculateTastePointsJob,
    ImmaculateTasteRefresherJob,
  ],
  exports: [JobsService],
})
export class JobsModule {}
