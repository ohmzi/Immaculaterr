import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CronTime } from 'cron';
import { PrismaService } from '../db/prisma.service';
import { findJobDefinition, JOB_DEFINITIONS } from './job-registry';
import { JobsHandlers } from './jobs.handlers';
import type {
  JobContext,
  JobLogLevel,
  JobRunTrigger,
  JsonObject,
} from './jobs.types';

function errToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.trim() ? value.trim() : null;
  if (!value || typeof value !== 'object') return null;

  const rec = value as Record<string, unknown>;
  const toISO = rec['toISO'];
  if (typeof toISO === 'function') {
    const out = (toISO as () => unknown).call(value);
    if (typeof out === 'string') return out;
  }

  const toDate = rec['toDate'];
  if (typeof toDate === 'function') {
    const out = (toDate as () => unknown).call(value);
    if (out instanceof Date) return out.toISOString();
  }

  return null;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly runningJobIds = new Set<string>();
  private static readonly UNSCHEDULABLE_JOB_IDS = new Set<string>([
    // Webhook/manual-input jobs (no schedule support)
    'immaculateTastePoints',
    'watchedMovieRecommendations',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handlers: JobsHandlers,
  ) {}

  listDefinitions() {
    return JOB_DEFINITIONS.map((j) => ({
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
        if (JobsService.UNSCHEDULABLE_JOB_IDS.has(j.id)) return null;
        const s = scheduleMap.get(j.id) ?? null;
        if (!s) return null;
        const nextRunAt = s.enabled
          ? (() => {
              try {
                const ct = new CronTime(s.cron, s.timezone ?? undefined);
                const dt: unknown = ct.sendAt();
                return toIsoString(dt);
              } catch {
                return null;
              }
            })()
          : null;
        return { ...s, nextRunAt };
      })(),
    }));
  }

  async runJob(params: {
    jobId: string;
    trigger: JobRunTrigger;
    dryRun: boolean;
    userId: string;
    input?: JsonObject;
  }) {
    const { jobId, trigger, dryRun, userId, input } = params;
    const def = findJobDefinition(jobId);
    if (!def) throw new NotFoundException(`Unknown job: ${jobId}`);

    if (this.runningJobIds.has(jobId)) {
      throw new ConflictException(`Job already running: ${jobId}`);
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

    const log = async (
      level: JobLogLevel,
      message: string,
      context?: JsonObject,
    ) => {
      await this.prisma.jobLogLine.create({
        data: {
          runId: run.id,
          level,
          message,
          context: context ?? Prisma.DbNull,
        },
      });
      this.logger.log(`[${jobId}#${run.id}] ${level}: ${message}`);
    };

    const ctx: JobContext = {
      jobId,
      runId: run.id,
      userId,
      dryRun,
      trigger,
      input,
      log,
      debug: (m, c) => log('debug', m, c),
      info: (m, c) => log('info', m, c),
      warn: (m, c) => log('warn', m, c),
      error: (m, c) => log('error', m, c),
    };

    // Run in the background so API calls return quickly; status/logs are persisted.
    void this.executeJobRun({ ctx, runId: run.id }).catch((err) => {
      this.logger.error(
        `Unhandled job execution error jobId=${jobId} runId=${run.id}: ${errToMessage(err)}`,
      );
    });

    return run;
  }

  private async executeJobRun(params: { ctx: JobContext; runId: string }) {
    const { ctx, runId } = params;
    const jobId = ctx.jobId;

    try {
      await ctx.info('run: started', {
        trigger: ctx.trigger,
        dryRun: ctx.dryRun,
        input: ctx.input ?? null,
      });
      const result = await this.handlers.run(jobId, ctx);
      await ctx.info('run: finished');

      await this.prisma.jobRun.update({
        where: { id: runId },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          summary: result.summary ?? Prisma.DbNull,
          errorMessage: null,
        },
      });
    } catch (err) {
      const msg = errToMessage(err);
      await ctx.error('run: failed', { error: msg });
      await this.prisma.jobRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: msg,
        },
      });
    } finally {
      this.runningJobIds.delete(jobId);
    }
  }

  async listRuns(params: {
    userId: string;
    jobId?: string;
    take: number;
    skip: number;
  }) {
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

  async getRun(params: { userId: string; runId: string }) {
    const { userId, runId } = params;
    const run = await this.prisma.jobRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found');
    if (run.userId !== userId) throw new NotFoundException('Run not found');
    return run;
  }

  async getRunLogs(params: {
    userId: string;
    runId: string;
    take: number;
    skip: number;
  }) {
    const { userId, runId, take, skip } = params;
    await this.getRun({ userId, runId });
    return await this.prisma.jobLogLine.findMany({
      where: { runId },
      orderBy: { time: 'asc' },
      take,
      skip,
    });
  }
}
