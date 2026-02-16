import { Injectable } from '@nestjs/common';
import type { JobContext, JobRunResult } from './jobs.types';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { ArrMonitoredSearchJob } from './arr-monitored-search.job';
import { CleanupAfterAddingNewContentJob } from './cleanup-after-adding-new-content.job';
import { ImmaculateTasteCollectionJob } from './immaculate-taste-collection.job';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';
import { BasedonLatestWatchedRefresherJob } from './basedon-latest-watched-refresher.job';
import { BasedonLatestWatchedCollectionJob } from './basedon-latest-watched-collection.job';
import { CollectionResyncUpgradeJob } from './collection-resync-upgrade.job';

@Injectable()
export class JobsHandlers {
  constructor(
    private readonly monitorConfirmJob: MonitorConfirmJob,
    private readonly arrMonitoredSearchJob: ArrMonitoredSearchJob,
    private readonly cleanupAfterAddingNewContentJob: CleanupAfterAddingNewContentJob,
    private readonly immaculateTasteCollectionJob: ImmaculateTasteCollectionJob,
    private readonly immaculateTasteRefresherJob: ImmaculateTasteRefresherJob,
    private readonly basedonLatestWatchedRefresherJob: BasedonLatestWatchedRefresherJob,
    private readonly basedonLatestWatchedCollectionJob: BasedonLatestWatchedCollectionJob,
    private readonly collectionResyncUpgradeJob: CollectionResyncUpgradeJob,
  ) {}

  async run(jobId: string, ctx: JobContext): Promise<JobRunResult> {
    switch (jobId) {
      case 'monitorConfirm':
        return await this.monitorConfirmJob.run(ctx);
      case 'arrMonitoredSearch':
        return await this.arrMonitoredSearchJob.run(ctx);
      case 'mediaAddedCleanup':
        return await this.cleanupAfterAddingNewContentJob.run(ctx);
      case 'immaculateTastePoints':
        return await this.immaculateTasteCollectionJob.run(ctx);
      case 'immaculateTasteRefresher':
        return await this.immaculateTasteRefresherJob.run(ctx);
      case 'watchedMovieRecommendations':
        return await this.basedonLatestWatchedCollectionJob.run(ctx);
      case 'recentlyWatchedRefresher':
        return await this.basedonLatestWatchedRefresherJob.run(ctx);
      case 'collectionResyncUpgrade':
        return await this.collectionResyncUpgradeJob.run(ctx);
      default:
        throw new Error(`No handler registered for jobId=${jobId}`);
    }
  }
}
