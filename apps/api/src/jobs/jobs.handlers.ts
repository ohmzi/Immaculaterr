import { Injectable } from '@nestjs/common';
import type { JobContext, JobRunResult } from './jobs.types';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { MediaAddedCleanupJob } from './media-added-cleanup.job';
import { NoopJob } from './noop.job';
import { ImmaculateTasteCollectionJob } from './immaculate-taste-collection.job';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';
import { BasedonLatestWatchedRefresherJob } from './basedon-latest-watched-refresher.job';
import { BasedonLatestWatchedCollectionJob } from './basedon-latest-watched-collection.job';

@Injectable()
export class JobsHandlers {
  constructor(
    private readonly noopJob: NoopJob,
    private readonly monitorConfirmJob: MonitorConfirmJob,
    private readonly mediaAddedCleanupJob: MediaAddedCleanupJob,
    private readonly immaculateTasteCollectionJob: ImmaculateTasteCollectionJob,
    private readonly immaculateTasteRefresherJob: ImmaculateTasteRefresherJob,
    private readonly basedonLatestWatchedRefresherJob: BasedonLatestWatchedRefresherJob,
    private readonly basedonLatestWatchedCollectionJob: BasedonLatestWatchedCollectionJob,
  ) {}

  async run(jobId: string, ctx: JobContext): Promise<JobRunResult> {
    switch (jobId) {
      case 'noop':
        return await this.noopJob.run(ctx);
      case 'monitorConfirm':
        return await this.monitorConfirmJob.run(ctx);
      case 'mediaAddedCleanup':
        return await this.mediaAddedCleanupJob.run(ctx);
      case 'immaculateTastePoints':
        return await this.immaculateTasteCollectionJob.run(ctx);
      case 'immaculateTasteRefresher':
        return await this.immaculateTasteRefresherJob.run(ctx);
      case 'watchedMovieRecommendations':
        return await this.basedonLatestWatchedCollectionJob.run(ctx);
      case 'recentlyWatchedRefresher':
        return await this.basedonLatestWatchedRefresherJob.run(ctx);
      default:
        throw new Error(`No handler registered for jobId=${jobId}`);
    }
  }
}
