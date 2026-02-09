import type { JobContext, JobRunResult } from './jobs.types';
import { MonitorConfirmJob } from './monitor-confirm.job';
import { ArrMonitoredSearchJob } from './arr-monitored-search.job';
import { CleanupAfterAddingNewContentJob } from './cleanup-after-adding-new-content.job';
import { ImmaculateTasteCollectionJob } from './immaculate-taste-collection.job';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';
import { BasedonLatestWatchedRefresherJob } from './basedon-latest-watched-refresher.job';
import { BasedonLatestWatchedCollectionJob } from './basedon-latest-watched-collection.job';
export declare class JobsHandlers {
    private readonly monitorConfirmJob;
    private readonly arrMonitoredSearchJob;
    private readonly cleanupAfterAddingNewContentJob;
    private readonly immaculateTasteCollectionJob;
    private readonly immaculateTasteRefresherJob;
    private readonly basedonLatestWatchedRefresherJob;
    private readonly basedonLatestWatchedCollectionJob;
    constructor(monitorConfirmJob: MonitorConfirmJob, arrMonitoredSearchJob: ArrMonitoredSearchJob, cleanupAfterAddingNewContentJob: CleanupAfterAddingNewContentJob, immaculateTasteCollectionJob: ImmaculateTasteCollectionJob, immaculateTasteRefresherJob: ImmaculateTasteRefresherJob, basedonLatestWatchedRefresherJob: BasedonLatestWatchedRefresherJob, basedonLatestWatchedCollectionJob: BasedonLatestWatchedCollectionJob);
    run(jobId: string, ctx: JobContext): Promise<JobRunResult>;
}
