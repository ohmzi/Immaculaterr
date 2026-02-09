"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const db_module_1 = require("../db/db.module");
const plex_module_1 = require("../plex/plex.module");
const radarr_module_1 = require("../radarr/radarr.module");
const recommendations_module_1 = require("../recommendations/recommendations.module");
const settings_module_1 = require("../settings/settings.module");
const sonarr_module_1 = require("../sonarr/sonarr.module");
const tmdb_module_1 = require("../tmdb/tmdb.module");
const immaculate_taste_collection_module_1 = require("../immaculate-taste-collection/immaculate-taste-collection.module");
const watched_movie_recommendations_module_1 = require("../watched-movie-recommendations/watched-movie-recommendations.module");
const jobs_controller_1 = require("./jobs.controller");
const jobs_scheduler_1 = require("./jobs.scheduler");
const jobs_service_1 = require("./jobs.service");
const jobs_handlers_1 = require("./jobs.handlers");
const jobs_retention_service_1 = require("./jobs-retention.service");
const monitor_confirm_job_1 = require("./monitor-confirm.job");
const arr_monitored_search_job_1 = require("./arr-monitored-search.job");
const cleanup_after_adding_new_content_job_1 = require("./cleanup-after-adding-new-content.job");
const basedon_latest_watched_refresher_job_1 = require("./basedon-latest-watched-refresher.job");
const basedon_latest_watched_collection_job_1 = require("./basedon-latest-watched-collection.job");
const immaculate_taste_collection_job_1 = require("./immaculate-taste-collection.job");
const immaculate_taste_refresher_job_1 = require("./immaculate-taste-refresher.job");
let JobsModule = class JobsModule {
};
exports.JobsModule = JobsModule;
exports.JobsModule = JobsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            db_module_1.DbModule,
            settings_module_1.SettingsModule,
            plex_module_1.PlexModule,
            radarr_module_1.RadarrModule,
            sonarr_module_1.SonarrModule,
            recommendations_module_1.RecommendationsModule,
            tmdb_module_1.TmdbModule,
            immaculate_taste_collection_module_1.ImmaculateTasteCollectionModule,
            watched_movie_recommendations_module_1.WatchedMovieRecommendationsModule,
            schedule_1.ScheduleModule.forRoot(),
        ],
        controllers: [jobs_controller_1.JobsController],
        providers: [
            jobs_service_1.JobsService,
            jobs_scheduler_1.JobsScheduler,
            jobs_handlers_1.JobsHandlers,
            jobs_retention_service_1.JobsRetentionService,
            monitor_confirm_job_1.MonitorConfirmJob,
            arr_monitored_search_job_1.ArrMonitoredSearchJob,
            cleanup_after_adding_new_content_job_1.CleanupAfterAddingNewContentJob,
            basedon_latest_watched_collection_job_1.BasedonLatestWatchedCollectionJob,
            basedon_latest_watched_refresher_job_1.BasedonLatestWatchedRefresherJob,
            immaculate_taste_collection_job_1.ImmaculateTasteCollectionJob,
            immaculate_taste_refresher_job_1.ImmaculateTasteRefresherJob,
        ],
        exports: [jobs_service_1.JobsService],
    })
], JobsModule);
//# sourceMappingURL=jobs.module.js.map