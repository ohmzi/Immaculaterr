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
var JobsRetentionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsRetentionService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../db/prisma.service");
let JobsRetentionService = class JobsRetentionService {
    static { JobsRetentionService_1 = this; }
    prisma;
    logger = new common_1.Logger(JobsRetentionService_1.name);
    static RETENTION_DAYS = 90;
    static INTERVAL_MS = 24 * 60 * 60_000;
    static BATCH_SIZE = 1000;
    constructor(prisma) {
        this.prisma = prisma;
    }
    onModuleInit() {
        setTimeout(() => void this.cleanupOrphanedRunningRuns(), 5_000);
        setTimeout(() => void this.cleanupOnce(), 20_000);
    }
    async poll() {
        await this.cleanupOnce();
    }
    async cleanupOnce() {
        const cutoff = new Date(Date.now() -
            JobsRetentionService_1.RETENTION_DAYS * 24 * 60 * 60_000);
        let totalRuns = 0;
        let totalLogs = 0;
        let batches = 0;
        try {
            for (;;) {
                const runs = await this.prisma.jobRun.findMany({
                    where: { startedAt: { lt: cutoff } },
                    select: { id: true },
                    take: JobsRetentionService_1.BATCH_SIZE,
                });
                if (!runs.length)
                    break;
                const ids = runs.map((r) => r.id);
                const [logsRes, runsRes] = await this.prisma.$transaction([
                    this.prisma.jobLogLine.deleteMany({ where: { runId: { in: ids } } }),
                    this.prisma.jobRun.deleteMany({ where: { id: { in: ids } } }),
                ]);
                totalLogs += logsRes.count;
                totalRuns += runsRes.count;
                batches += 1;
                if (runsRes.count === 0 || batches > 500)
                    break;
            }
            if (totalRuns > 0 || totalLogs > 0) {
                this.logger.log(`Rewind retention: deleted runs=${totalRuns} logs=${totalLogs} cutoff=${cutoff.toISOString()}`);
            }
        }
        catch (err) {
            this.logger.warn(`Rewind retention failed: ${err?.message ?? String(err)}`);
        }
    }
    async cleanupOrphanedRunningRuns() {
        const bootTime = new Date(Date.now() - process.uptime() * 1000);
        const now = new Date();
        try {
            const runs = await this.prisma.jobRun.findMany({
                where: { status: 'RUNNING', startedAt: { lt: bootTime } },
                select: { id: true, jobId: true, startedAt: true },
            });
            if (!runs.length)
                return;
            const ids = runs.map((r) => r.id);
            const message = `Orphaned RUNNING job detected after restart (bootTime=${bootTime.toISOString()}); marking as FAILED.`;
            const [updateRes, logsRes] = await this.prisma.$transaction([
                this.prisma.jobRun.updateMany({
                    where: { id: { in: ids } },
                    data: { status: 'FAILED', finishedAt: now, errorMessage: message },
                }),
                this.prisma.jobLogLine.createMany({
                    data: runs.map((r) => ({
                        runId: r.id,
                        level: 'error',
                        message,
                        context: {
                            reason: 'orphaned_running',
                            jobId: r.jobId,
                            startedAt: r.startedAt.toISOString(),
                            bootTime: bootTime.toISOString(),
                        },
                    })),
                }),
            ]);
            this.logger.warn(`Orphaned job runs: marked FAILED runs=${updateRes.count} logs=${logsRes.count} bootTime=${bootTime.toISOString()}`);
        }
        catch (err) {
            this.logger.warn(`Orphaned job run cleanup failed: ${err?.message ?? String(err)}`);
        }
    }
};
exports.JobsRetentionService = JobsRetentionService;
__decorate([
    (0, schedule_1.Interval)(JobsRetentionService.INTERVAL_MS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], JobsRetentionService.prototype, "poll", null);
exports.JobsRetentionService = JobsRetentionService = JobsRetentionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], JobsRetentionService);
//# sourceMappingURL=jobs-retention.service.js.map