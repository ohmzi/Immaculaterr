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
var JobsScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsScheduler = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const cron_1 = require("cron");
const prisma_service_1 = require("../db/prisma.service");
const job_registry_1 = require("./job-registry");
const jobs_service_1 = require("./jobs.service");
const REGISTRY_PREFIX = 'job:';
const UNSCHEDULABLE_JOB_IDS = new Set([
    'mediaAddedCleanup',
    'immaculateTastePoints',
    'watchedMovieRecommendations',
]);
let JobsScheduler = JobsScheduler_1 = class JobsScheduler {
    prisma;
    schedulerRegistry;
    jobsService;
    logger = new common_1.Logger(JobsScheduler_1.name);
    constructor(prisma, schedulerRegistry, jobsService) {
        this.prisma = prisma;
        this.schedulerRegistry = schedulerRegistry;
        this.jobsService = jobsService;
    }
    async onModuleInit() {
        if (process.env.SCHEDULER_ENABLED === 'false') {
            this.logger.warn('Scheduler disabled via SCHEDULER_ENABLED=false');
            return;
        }
        await this.ensureDefaultSchedules();
        await this.refreshSchedules();
    }
    async upsertSchedule(params) {
        const { jobId, cron, enabled, timezone } = params;
        if (!(0, job_registry_1.findJobDefinition)(jobId)) {
            throw new common_1.BadRequestException(`Unknown job: ${jobId}`);
        }
        if (UNSCHEDULABLE_JOB_IDS.has(jobId)) {
            throw new common_1.BadRequestException(`Job ${jobId} is webhook-only and cannot be scheduled`);
        }
        try {
            new cron_1.CronJob(cron, () => undefined, null, false, timezone ?? undefined);
        }
        catch (err) {
            throw new common_1.BadRequestException(`Invalid cron expression: ${err?.message ?? String(err)}`);
        }
        const schedule = await this.prisma.jobSchedule.upsert({
            where: { jobId },
            update: { cron, enabled, timezone: timezone ?? null },
            create: { jobId, cron, enabled, timezone: timezone ?? null },
        });
        await this.refreshSchedules();
        return schedule;
    }
    async refreshSchedules() {
        this.clearManagedCronJobs();
        const enabledSchedules = await this.prisma.jobSchedule.findMany({
            where: {
                enabled: true,
                jobId: { notIn: Array.from(UNSCHEDULABLE_JOB_IDS) },
            },
        });
        for (const schedule of enabledSchedules) {
            const { jobId, cron, timezone } = schedule;
            const name = `${REGISTRY_PREFIX}${jobId}`;
            try {
                const job = new cron_1.CronJob(cron, async () => {
                    try {
                        const stillEnabled = await this.prisma.jobSchedule.findUnique({
                            where: { jobId },
                            select: { enabled: true },
                        });
                        if (!stillEnabled?.enabled) {
                            this.logger.debug(`Skipping scheduled run; schedule disabled jobId=${jobId}`);
                            try {
                                job.stop();
                            }
                            catch {
                            }
                            try {
                                this.schedulerRegistry.deleteCronJob(name);
                            }
                            catch {
                            }
                            return;
                        }
                        const user = await this.prisma.user.findFirst({
                            orderBy: { createdAt: 'asc' },
                            select: { id: true },
                        });
                        const userId = user?.id;
                        if (!userId) {
                            this.logger.warn(`Skipping scheduled run; no admin user exists jobId=${jobId}`);
                            return;
                        }
                        await this.jobsService.runJob({
                            jobId,
                            trigger: 'schedule',
                            dryRun: false,
                            userId,
                        });
                    }
                    catch (err) {
                        this.logger.error(`Scheduled job failed jobId=${jobId}: ${err?.message ?? String(err)}`);
                    }
                }, null, false, timezone ?? undefined);
                this.schedulerRegistry.addCronJob(name, job);
                job.start();
                this.logger.log(`Scheduled ${jobId} cron=${cron} tz=${timezone ?? 'local'}`);
            }
            catch (err) {
                this.logger.error(`Failed to schedule jobId=${jobId} cron=${cron}: ${err?.message ?? String(err)}`);
            }
        }
    }
    clearManagedCronJobs() {
        for (const [name] of this.schedulerRegistry.getCronJobs()) {
            if (!name.startsWith(REGISTRY_PREFIX))
                continue;
            try {
                this.schedulerRegistry.deleteCronJob(name);
            }
            catch {
            }
        }
    }
    async ensureDefaultSchedules() {
        const existing = await this.prisma.jobSchedule.findMany();
        const existingIds = new Set(existing.map((s) => s.jobId));
        const defaultCronMigrations = [
            { jobId: 'monitorConfirm', from: '0 3 * * *', to: '0 1 * * *' },
            { jobId: 'recentlyWatchedRefresher', from: '0 1 * * *', to: '0 2 * * *' },
        ];
        const migrationUpdates = await Promise.all(defaultCronMigrations.map((m) => this.prisma.jobSchedule.updateMany({
            where: {
                jobId: m.jobId,
                cron: m.from,
            },
            data: { cron: m.to },
        })));
        const migratedCount = migrationUpdates.reduce((sum, r) => sum + r.count, 0);
        const toCreate = job_registry_1.JOB_DEFINITIONS.filter((j) => j.defaultScheduleCron && !existingIds.has(j.id)).map((j) => ({
            jobId: j.id,
            cron: j.defaultScheduleCron,
            enabled: false,
            timezone: null,
        }));
        if (!toCreate.length && migratedCount === 0)
            return;
        if (toCreate.length) {
            await this.prisma.jobSchedule.createMany({ data: toCreate });
        }
        this.logger.log(`Default schedules ensured: seeded=${toCreate.length} migrated=${migratedCount}`);
    }
};
exports.JobsScheduler = JobsScheduler;
exports.JobsScheduler = JobsScheduler = JobsScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        schedule_1.SchedulerRegistry,
        jobs_service_1.JobsService])
], JobsScheduler);
//# sourceMappingURL=jobs.scheduler.js.map