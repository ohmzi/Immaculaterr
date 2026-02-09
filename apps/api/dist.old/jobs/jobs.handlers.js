"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsHandlers = void 0;
const common_1 = require("@nestjs/common");
const monitor_confirm_job_1 = require("./monitor-confirm.job");
const arr_monitored_search_job_1 = require("./arr-monitored-search.job");
const cleanup_after_adding_new_content_job_1 = require("./cleanup-after-adding-new-content.job");
const immaculate_taste_collection_job_1 = require("./immaculate-taste-collection.job");
const immaculate_taste_refresher_job_1 = require("./immaculate-taste-refresher.job");
const basedon_latest_watched_refresher_job_1 = require("./basedon-latest-watched-refresher.job");
const basedon_latest_watched_collection_job_1 = require("./basedon-latest-watched-collection.job");
let JobsHandlers = class JobsHandlers {
    monitorConfirmJob;
    arrMonitoredSearchJob;
    cleanupAfterAddingNewContentJob;
    immaculateTasteCollectionJob;
    immaculateTasteRefresherJob;
    basedonLatestWatchedRefresherJob;
    basedonLatestWatchedCollectionJob;
    constructor(monitorConfirmJob, arrMonitoredSearchJob, cleanupAfterAddingNewContentJob, immaculateTasteCollectionJob, immaculateTasteRefresherJob, basedonLatestWatchedRefresherJob, basedonLatestWatchedCollectionJob) {
        this.monitorConfirmJob = monitorConfirmJob;
        this.arrMonitoredSearchJob = arrMonitoredSearchJob;
        this.cleanupAfterAddingNewContentJob = cleanupAfterAddingNewContentJob;
        this.immaculateTasteCollectionJob = immaculateTasteCollectionJob;
        this.immaculateTasteRefresherJob = immaculateTasteRefresherJob;
        this.basedonLatestWatchedRefresherJob = basedonLatestWatchedRefresherJob;
        this.basedonLatestWatchedCollectionJob = basedonLatestWatchedCollectionJob;
    }
    async run(jobId, ctx) {
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
            default:
                throw new Error(`No handler registered for jobId=${jobId}`);
        }
    }
};
exports.JobsHandlers = JobsHandlers;
exports.JobsHandlers = JobsHandlers = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [monitor_confirm_job_1.MonitorConfirmJob,
        arr_monitored_search_job_1.ArrMonitoredSearchJob,
        cleanup_after_adding_new_content_job_1.CleanupAfterAddingNewContentJob,
        immaculate_taste_collection_job_1.ImmaculateTasteCollectionJob,
        immaculate_taste_refresher_job_1.ImmaculateTasteRefresherJob,
        basedon_latest_watched_refresher_job_1.BasedonLatestWatchedRefresherJob,
        basedon_latest_watched_collection_job_1.BasedonLatestWatchedCollectionJob])
], JobsHandlers);
//# sourceMappingURL=jobs.handlers.js.map