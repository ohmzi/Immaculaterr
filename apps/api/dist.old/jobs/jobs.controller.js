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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const jobs_scheduler_1 = require("./jobs.scheduler");
const jobs_service_1 = require("./jobs.service");
let JobsController = class JobsController {
    jobsService;
    jobsScheduler;
    constructor(jobsService, jobsScheduler) {
        this.jobsService = jobsService;
        this.jobsScheduler = jobsScheduler;
    }
    listJobs() {
        return this.jobsService.listJobsWithSchedules().then((jobs) => ({ jobs }));
    }
    async runJob(req, jobId, body) {
        const userId = req.user.id;
        const dryRun = Boolean(body?.dryRun);
        const inputRaw = body?.input;
        const input = inputRaw === undefined
            ? undefined
            : inputRaw && typeof inputRaw === 'object' && !Array.isArray(inputRaw)
                ? inputRaw
                : undefined;
        if (inputRaw !== undefined && !input) {
            throw new common_1.BadRequestException('input must be a JSON object');
        }
        const run = await this.jobsService.runJob({
            jobId,
            trigger: 'manual',
            dryRun,
            userId,
            input,
        });
        return { ok: true, run };
    }
    async listRuns(req, jobId, takeRaw, skipRaw) {
        const userId = req.user.id;
        const take = Math.max(1, Math.min(200, Number.parseInt(takeRaw ?? '50', 10) || 50));
        const skip = Math.max(0, Number.parseInt(skipRaw ?? '0', 10) || 0);
        const runs = await this.jobsService.listRuns({ userId, jobId, take, skip });
        return { runs };
    }
    async clearRuns(req, jobIdRaw) {
        const userId = req.user.id;
        const jobId = typeof jobIdRaw === 'string' && jobIdRaw.trim() ? jobIdRaw.trim() : undefined;
        const result = await this.jobsService.clearRuns({ userId, jobId });
        return { ok: true, ...result };
    }
    async getRun(req, runId) {
        const userId = req.user.id;
        const run = await this.jobsService.getRun({ userId, runId });
        return { run };
    }
    async getRunLogs(req, runId, takeRaw, skipRaw) {
        const userId = req.user.id;
        const take = Math.max(1, Math.min(1000, Number.parseInt(takeRaw ?? '500', 10) || 500));
        const skip = Math.max(0, Number.parseInt(skipRaw ?? '0', 10) || 0);
        const logs = await this.jobsService.getRunLogs({
            userId,
            runId,
            take,
            skip,
        });
        return { logs };
    }
    async upsertSchedule(jobId, body) {
        const cron = typeof body?.cron === 'string' ? body.cron.trim() : '';
        const enabled = body?.enabled === undefined ? true : Boolean(body.enabled);
        const timezone = typeof body?.timezone === 'string' && body.timezone.trim()
            ? body.timezone.trim()
            : null;
        if (!cron)
            throw new common_1.BadRequestException('cron is required');
        const schedule = await this.jobsScheduler.upsertSchedule({
            jobId,
            cron,
            enabled,
            timezone,
        });
        return { ok: true, schedule };
    }
};
exports.JobsController = JobsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], JobsController.prototype, "listJobs", null);
__decorate([
    (0, common_1.Post)(':jobId/run'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('jobId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "runJob", null);
__decorate([
    (0, common_1.Get)('runs'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('jobId')),
    __param(2, (0, common_1.Query)('take')),
    __param(3, (0, common_1.Query)('skip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "listRuns", null);
__decorate([
    (0, common_1.Delete)('runs'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('jobId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "clearRuns", null);
__decorate([
    (0, common_1.Get)('runs/:runId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('runId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "getRun", null);
__decorate([
    (0, common_1.Get)('runs/:runId/logs'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('runId')),
    __param(2, (0, common_1.Query)('take')),
    __param(3, (0, common_1.Query)('skip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "getRunLogs", null);
__decorate([
    (0, common_1.Put)('schedules/:jobId'),
    __param(0, (0, common_1.Param)('jobId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "upsertSchedule", null);
exports.JobsController = JobsController = __decorate([
    (0, common_1.Controller)('jobs'),
    (0, swagger_1.ApiTags)('jobs'),
    __metadata("design:paramtypes", [jobs_service_1.JobsService,
        jobs_scheduler_1.JobsScheduler])
], JobsController);
//# sourceMappingURL=jobs.controller.js.map