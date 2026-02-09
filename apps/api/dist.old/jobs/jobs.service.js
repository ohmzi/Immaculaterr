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
var JobsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const cron_1 = require("cron");
const prisma_service_1 = require("../db/prisma.service");
const job_registry_1 = require("./job-registry");
const jobs_handlers_1 = require("./jobs.handlers");
function errToMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
function toIsoString(value) {
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'string')
        return value.trim() ? value.trim() : null;
    if (!value || typeof value !== 'object')
        return null;
    const rec = value;
    const toISO = rec['toISO'];
    if (typeof toISO === 'function') {
        const out = toISO.call(value);
        if (typeof out === 'string')
            return out;
    }
    const toDate = rec['toDate'];
    if (typeof toDate === 'function') {
        const out = toDate.call(value);
        if (out instanceof Date)
            return out.toISOString();
    }
    return null;
}
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isJobReportV1(value) {
    if (!isPlainObject(value))
        return false;
    return value['template'] === 'jobReportV1' && value['version'] === 1;
}
function evaluateJobReportFailure(report) {
    const tasksRaw = report.tasks;
    const tasks = Array.isArray(tasksRaw)
        ? tasksRaw.filter((t) => Boolean(t) && typeof t === 'object' && !Array.isArray(t))
        : [];
    const failedTasks = tasks.filter((t) => t.status === 'failed');
    if (!failedTasks.length)
        return { failed: false, reason: null };
    const parts = failedTasks.slice(0, 3).map((t) => {
        const title = String(t.title ?? t.id ?? 'task').trim() || 'task';
        const issues = Array.isArray(t.issues) ? t.issues : [];
        const firstIssue = issues.find((i) => i && typeof i === 'object');
        const msg = firstIssue && typeof firstIssue.message === 'string'
            ? firstIssue.message.trim()
            : '';
        return msg ? `${title}: ${msg}` : title;
    });
    const more = failedTasks.length > 3 ? ` (+${failedTasks.length - 3} more)` : '';
    const reason = `Job reported failed task(s): ${parts.join(' | ')}${more}`;
    return { failed: true, reason };
}
function getProgressSnapshot(summary) {
    if (!summary)
        return null;
    const raw = summary['progress'];
    return isPlainObject(raw) ? raw : null;
}
function extractInputContext(input) {
    if (!input)
        return null;
    const raw = input;
    const out = {};
    const plexUserId = typeof raw['plexUserId'] === 'string' ? raw['plexUserId'].trim() : '';
    const plexUserTitle = typeof raw['plexUserTitle'] === 'string' ? raw['plexUserTitle'].trim() : '';
    const seedTitle = typeof raw['seedTitle'] === 'string' ? raw['seedTitle'].trim() : '';
    const seedYearRaw = raw['seedYear'];
    const seedYear = typeof seedYearRaw === 'number' && Number.isFinite(seedYearRaw)
        ? Math.trunc(seedYearRaw)
        : typeof seedYearRaw === 'string' && seedYearRaw.trim()
            ? Number.parseInt(seedYearRaw.trim(), 10)
            : null;
    if (plexUserId)
        out.plexUserId = plexUserId;
    if (plexUserTitle)
        out.plexUserTitle = plexUserTitle;
    if (seedTitle)
        out.seedTitle = seedTitle;
    if (seedYear !== null && Number.isFinite(seedYear))
        out.seedYear = seedYear;
    return Object.keys(out).length ? out : null;
}
let JobsService = class JobsService {
    static { JobsService_1 = this; }
    prisma;
    handlers;
    logger = new common_1.Logger(JobsService_1.name);
    runningJobIds = new Set();
    static UNSCHEDULABLE_JOB_IDS = new Set([
        'mediaAddedCleanup',
        'immaculateTastePoints',
        'watchedMovieRecommendations',
    ]);
    constructor(prisma, handlers) {
        this.prisma = prisma;
        this.handlers = handlers;
    }
    listDefinitions() {
        return job_registry_1.JOB_DEFINITIONS.map((j) => ({
            id: j.id,
            name: j.name,
            description: j.description,
            defaultScheduleCron: j.defaultScheduleCron ?? null,
        }));
    }
    async listJobsWithSchedules() {
        const schedules = await this.prisma.jobSchedule.findMany();
        const scheduleMap = new Map(schedules.map((s) => [s.jobId, s]));
        return this.listDefinitions().map((j) => ({
            ...j,
            schedule: (() => {
                if (JobsService_1.UNSCHEDULABLE_JOB_IDS.has(j.id))
                    return null;
                const s = scheduleMap.get(j.id) ?? null;
                if (!s)
                    return null;
                const nextRunAt = s.enabled
                    ? (() => {
                        try {
                            const ct = new cron_1.CronTime(s.cron, s.timezone ?? undefined);
                            const dt = ct.sendAt();
                            return toIsoString(dt);
                        }
                        catch {
                            return null;
                        }
                    })()
                    : null;
                return { ...s, nextRunAt };
            })(),
        }));
    }
    async runJob(params) {
        const { jobId, trigger, dryRun, userId, input } = params;
        const def = (0, job_registry_1.findJobDefinition)(jobId);
        if (!def)
            throw new common_1.NotFoundException(`Unknown job: ${jobId}`);
        if (this.runningJobIds.has(jobId)) {
            throw new common_1.ConflictException(`Job already running: ${jobId}`);
        }
        this.runningJobIds.add(jobId);
        const run = await this.prisma.jobRun.create({
            data: {
                jobId,
                userId,
                trigger,
                dryRun,
                status: 'RUNNING',
            },
        });
        let summaryCache = null;
        let summaryWriteChain = Promise.resolve();
        const enqueueSummaryWrite = (snapshot) => {
            summaryWriteChain = summaryWriteChain
                .catch(() => undefined)
                .then(async () => {
                await this.prisma.jobRun.update({
                    where: { id: run.id },
                    data: { summary: snapshot ?? client_1.Prisma.DbNull },
                });
            })
                .catch((err) => {
                this.logger.warn(`[${jobId}#${run.id}] summary write failed: ${errToMessage(err)}`);
            });
            return summaryWriteChain;
        };
        const awaitSummaryWrites = async () => {
            await summaryWriteChain.catch(() => undefined);
        };
        const log = async (level, message, context) => {
            await this.prisma.jobLogLine.create({
                data: {
                    runId: run.id,
                    level,
                    message,
                    context: context ?? client_1.Prisma.DbNull,
                },
            });
        };
        const ctx = {
            jobId,
            runId: run.id,
            userId,
            dryRun,
            trigger,
            input,
            getSummary: () => summaryCache,
            setSummary: async (summary) => {
                summaryCache = summary;
                await enqueueSummaryWrite(summaryCache);
            },
            patchSummary: async (patch) => {
                summaryCache = { ...(summaryCache ?? {}), ...(patch ?? {}) };
                await enqueueSummaryWrite(summaryCache);
            },
            log,
            debug: (m, c) => log('debug', m, c),
            info: (m, c) => log('info', m, c),
            warn: (m, c) => log('warn', m, c),
            error: (m, c) => log('error', m, c),
        };
        void this.executeJobRun({ ctx, runId: run.id, awaitSummaryWrites }).catch((err) => {
            this.logger.error(`Unhandled job execution error jobId=${jobId} runId=${run.id}: ${errToMessage(err)}`);
        });
        return run;
    }
    async executeJobRun(params) {
        const { ctx, runId, awaitSummaryWrites } = params;
        const jobId = ctx.jobId;
        const startedAt = Date.now();
        try {
            if (!('alternateFormatName' in globalThis)) {
                globalThis.alternateFormatName = '';
            }
            const inputContext = extractInputContext(ctx.input);
            await ctx.setSummary({
                phase: 'starting',
                dryRun: ctx.dryRun,
                trigger: ctx.trigger,
                ...(inputContext ?? {}),
                progress: {
                    step: 'starting',
                    message: 'Starting…',
                    updatedAt: new Date().toISOString(),
                },
            });
            await ctx.info('run: started', {
                trigger: ctx.trigger,
                dryRun: ctx.dryRun,
                input: ctx.input ?? null,
            });
            this.logger.log(`Job started jobId=${jobId} runId=${runId} trigger=${ctx.trigger} dryRun=${ctx.dryRun}`);
            const result = await this.handlers.run(jobId, ctx);
            await ctx.info('run: finished');
            await awaitSummaryWrites();
            const liveSummary = ctx.getSummary();
            const liveProgress = getProgressSnapshot(liveSummary);
            let finalSummary = result.summary ?? liveSummary ?? null;
            const reportFailure = finalSummary && isJobReportV1(finalSummary)
                ? evaluateJobReportFailure(finalSummary)
                : { failed: false, reason: null };
            if (finalSummary && liveProgress) {
                const totalRaw = liveProgress['total'];
                const total = typeof totalRaw === 'number' && Number.isFinite(totalRaw) && totalRaw >= 0
                    ? totalRaw
                    : null;
                const currentRaw = liveProgress['current'];
                const current = typeof currentRaw === 'number' && Number.isFinite(currentRaw) && currentRaw >= 0
                    ? currentRaw
                    : null;
                finalSummary = {
                    ...finalSummary,
                    progress: {
                        ...liveProgress,
                        step: reportFailure.failed ? 'failed' : 'done',
                        message: reportFailure.failed
                            ? 'Failed.'
                            : 'Completed.',
                        ...(total !== null
                            ? {
                                total,
                                current: total,
                            }
                            : current !== null
                                ? { current }
                                : {}),
                        updatedAt: new Date().toISOString(),
                    },
                };
            }
            if (reportFailure.failed) {
                if (reportFailure.reason) {
                    await ctx.error('run: reported failed', { reason: reportFailure.reason });
                }
                else {
                    await ctx.error('run: reported failed');
                }
                await this.prisma.jobRun.update({
                    where: { id: runId },
                    data: {
                        status: 'FAILED',
                        finishedAt: new Date(),
                        summary: finalSummary ?? client_1.Prisma.DbNull,
                        errorMessage: reportFailure.reason ?? 'Job reported failure.',
                    },
                });
                const ms = Date.now() - startedAt;
                this.logger.error(`Job failed jobId=${jobId} runId=${runId} ms=${ms} error=${JSON.stringify(reportFailure.reason ?? 'reported_failure')}`);
                return;
            }
            await this.prisma.jobRun.update({
                where: { id: runId },
                data: {
                    status: 'SUCCESS',
                    finishedAt: new Date(),
                    summary: finalSummary ?? client_1.Prisma.DbNull,
                    errorMessage: null,
                },
            });
            const ms = Date.now() - startedAt;
            this.logger.log(`Job passed jobId=${jobId} runId=${runId} ms=${ms} dryRun=${ctx.dryRun}`);
        }
        catch (err) {
            const msg = errToMessage(err);
            await ctx.error('run: failed', { error: msg });
            await this.prisma.jobRun.update({
                where: { id: runId },
                data: {
                    status: 'FAILED',
                    finishedAt: new Date(),
                    errorMessage: msg,
                    summary: ctx.getSummary() ?? client_1.Prisma.DbNull,
                },
            });
            const ms = Date.now() - startedAt;
            this.logger.error(`Job failed jobId=${jobId} runId=${runId} ms=${ms} error=${JSON.stringify(msg)}`);
        }
        finally {
            this.runningJobIds.delete(jobId);
        }
    }
    async listRuns(params) {
        const { userId, jobId, take, skip } = params;
        return await this.prisma.jobRun.findMany({
            where: {
                userId,
                ...(jobId ? { jobId } : {}),
            },
            orderBy: { startedAt: 'desc' },
            take,
            skip,
        });
    }
    async getRun(params) {
        const { userId, runId } = params;
        const run = await this.prisma.jobRun.findUnique({ where: { id: runId } });
        if (!run)
            throw new common_1.NotFoundException('Run not found');
        if (run.userId !== userId)
            throw new common_1.NotFoundException('Run not found');
        return run;
    }
    async getRunLogs(params) {
        const { userId, runId, take, skip } = params;
        await this.getRun({ userId, runId });
        return await this.prisma.jobLogLine.findMany({
            where: { runId },
            orderBy: { time: 'asc' },
            take,
            skip,
        });
    }
    async clearRuns(params) {
        const { userId, jobId } = params;
        const where = {
            userId,
            ...(jobId ? { jobId } : {}),
        };
        const runs = await this.prisma.jobRun.findMany({
            where,
            select: { id: true },
        });
        const ids = runs.map((r) => r.id);
        if (!ids.length) {
            return { deletedRuns: 0, deletedLogs: 0 };
        }
        const chunkSize = 500;
        let deletedLogs = 0;
        let deletedRuns = 0;
        for (let i = 0; i < ids.length; i += chunkSize) {
            const batch = ids.slice(i, i + chunkSize);
            const [logsRes, runsRes] = await this.prisma.$transaction([
                this.prisma.jobLogLine.deleteMany({ where: { runId: { in: batch } } }),
                this.prisma.jobRun.deleteMany({ where: { id: { in: batch } } }),
            ]);
            deletedLogs += logsRes.count;
            deletedRuns += runsRes.count;
        }
        this.logger.log(`Rewind cleared userId=${userId} scope=${jobId ? `jobId=${jobId}` : 'all'} runs=${deletedRuns} logs=${deletedLogs}`);
        return { deletedRuns, deletedLogs };
    }
};
exports.JobsService = JobsService;
exports.JobsService = JobsService = JobsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jobs_handlers_1.JobsHandlers])
], JobsService);
//# sourceMappingURL=jobs.service.js.map