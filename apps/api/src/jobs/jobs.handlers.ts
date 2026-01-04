import { Injectable } from '@nestjs/common';
import type { JobContext, JobRunResult } from './jobs.types';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { NoopJob } from './noop.job';
import { ImmaculateTastePointsJob } from './immaculate-taste-points.job';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';
import { RecentlyWatchedRefresherJob } from './recently-watched-refresher.job';
import { WatchedMovieRecommendationsJob } from './watched-movie-recommendations.job';

@Injectable()
export class JobsHandlers {
  constructor(
    private readonly noopJob: NoopJob,
    private readonly monitorConfirmJob: MonitorConfirmJob,
    private readonly immaculateTastePointsJob: ImmaculateTastePointsJob,
    private readonly immaculateTasteRefresherJob: ImmaculateTasteRefresherJob,
    private readonly recentlyWatchedRefresherJob: RecentlyWatchedRefresherJob,
    private readonly watchedMovieRecommendationsJob: WatchedMovieRecommendationsJob,
  ) {}

  async run(jobId: string, ctx: JobContext): Promise<JobRunResult> {
    switch (jobId) {
      case 'noop':
        return await this.noopJob.run(ctx);
      case 'monitorConfirm':
        return await this.monitorConfirmJob.run(ctx);
      case 'immaculateTastePoints':
        return await this.immaculateTastePointsJob.run(ctx);
      case 'immaculateTasteRefresher':
        return await this.immaculateTasteRefresherJob.run(ctx);
      case 'watchedMovieRecommendations':
        return await this.watchedMovieRecommendationsJob.run(ctx);
      case 'recentlyWatchedRefresher':
        return await this.recentlyWatchedRefresherJob.run(ctx);
      default:
        throw new Error(`No handler registered for jobId=${jobId}`);
    }
  }
}
