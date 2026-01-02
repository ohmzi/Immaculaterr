import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../db/db.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { SettingsModule } from '../settings/settings.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { JobsController } from './jobs.controller';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';
import { JobsHandlers } from './jobs.handlers';
import { NoopJob } from './noop.job';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { RecentlyWatchedRefresherJob } from './recently-watched-refresher.job';

@Module({
  imports: [
    DbModule,
    SettingsModule,
    PlexModule,
    RadarrModule,
    SonarrModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobsScheduler,
    JobsHandlers,
    NoopJob,
    MonitorConfirmJob,
    RecentlyWatchedRefresherJob,
  ],
  exports: [JobsService],
})
export class JobsModule {}
