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
import type { JobReportV1 } from './job-report-v1';
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJobReportV1(value: unknown): value is JobReportV1 {
  if (!isPlainObject(value)) return false;
  return value['template'] === 'jobReportV1' && value['version'] === 1;
}

function evaluateJobReportFailure(report: JobReportV1): {
  failed: boolean;
  reason: string | null;
} {
  const tasksRaw = report.tasks;
  const tasks = Array.isArray(tasksRaw)
    ? tasksRaw.filter(
        (t): t is JobReportV1['tasks'][number] =>
          Boolean(t) && typeof t === 'object' && !Array.isArray(t),
      )
    : [];

  const failedTasks = tasks.filter((t) => t.status === 'failed');
  if (!failedTasks.length) return { failed: false, reason: null };

  const parts = failedTasks.slice(0, 3).map((t) => {
    const title = String(t.title ?? t.id ?? 'task').trim() || 'task';
    const issues = Array.isArray(t.issues) ? t.issues : [];
    const firstIssue = issues.find((i) => i && typeof i === 'object') as
      | { message?: unknown }
      | undefined;
    const msg =
      firstIssue && typeof firstIssue.message === 'string'
        ? firstIssue.message.trim()
        : '';
    return msg ? `${title}: ${msg}` : title;
  });
  const more = failedTasks.length > 3 ? ` (+${failedTasks.length - 3} more)` : '';
  const reason = `Job reported failed task(s): ${parts.join(' | ')}${more}`;
  return { failed: true, reason };
}

function getProgressSnapshot(summary: JsonObject | null): JsonObject | null {
  if (!summary) return null;
  const raw = (summary as Record<string, unknown>)['progress'];
  return isPlainObject(raw) ? (raw as JsonObject) : null;
}

function extractInputContext(input?: JsonObject): JsonObject | null {
  if (!input) return null;
  const raw = input as Record<string, unknown>;
  const out: JsonObject = {};
  const plexUserId =
    typeof raw['plexUserId'] === 'string' ? raw['plexUserId'].trim() : '';
  const plexUserTitle =
    typeof raw['plexUserTitle'] === 'string' ? raw['plexUserTitle'].trim() : '';
  const seedTitle =
    typeof raw['seedTitle'] === 'string' ? raw['seedTitle'].trim() : '';
  const seedYearRaw = raw['seedYear'];
  const seedYear =
    typeof seedYearRaw === 'number' && Number.isFinite(seedYearRaw)
      ? Math.trunc(seedYearRaw)
      : typeof seedYearRaw === 'string' && seedYearRaw.trim()
        ? Number.parseInt(seedYearRaw.trim(), 10)
        : null;

  if (plexUserId) out.plexUserId = plexUserId;
  if (plexUserTitle) out.plexUserTitle = plexUserTitle;
  if (seedTitle) out.seedTitle = seedTitle;
  if (seedYear !== null && Number.isFinite(seedYear)) out.seedYear = seedYear;

  return Object.keys(out).length ? out : null;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly runningJobIds = new Set<string>();
  private static readonly UNSCHEDULABLE_JOB_IDS = new Set<string>([
    // Webhook/manual-input jobs (no schedule support)
    'mediaAddedCleanup',
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

    // Best-effort live summary snapshot support (persisted to JobRun.summary).
    // This powers the "Summary" section of the run detail UI while the job is RUNNING.
    let summaryCache: JsonObject | null = null;
    let summaryWriteChain: Promise<void> = Promise.resolve();
    const enqueueSummaryWrite = (snapshot: JsonObject | null) => {
      summaryWriteChain = summaryWriteChain
        .catch(() => undefined)
        .then(async () => {
          await this.prisma.jobRun.update({
            where: { id: run.id },
            data: { summary: snapshot ?? Prisma.DbNull },
          });
        })
        .catch((err) => {
          // Avoid crashing the job if a summary write fails; logs still persist.
          this.logger.warn(
            `[${jobId}#${run.id}] summary write failed: ${errToMessage(err)}`,
          );
        });
      return summaryWriteChain;
    };
    const awaitSummaryWrites = async () => {
      await summaryWriteChain.catch(() => undefined);
    };

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
    };

    const ctx: JobContext = {
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

    // Run in the background so API calls return quickly; status/logs are persisted.
    void this.executeJobRun({ ctx, runId: run.id, awaitSummaryWrites }).catch(
      (err) => {
      this.logger.error(
        `Unhandled job execution error jobId=${jobId} runId=${run.id}: ${errToMessage(err)}`,
      );
      },
    );

    return run;
  }

  private async executeJobRun(params: {
    ctx: JobContext;
    runId: string;
    awaitSummaryWrites: () => Promise<void>;
  }) {
    const { ctx, runId, awaitSummaryWrites } = params;
    const jobId = ctx.jobId;
    const startedAt = Date.now();

    try {
      // Defensive shim for older builds referencing this legacy var.
      if (!('alternateFormatName' in globalThis)) {
        (globalThis as Record<string, unknown>).alternateFormatName = '';
      }

      // Always set a minimal live summary upfront so the UI has something to show while running.
      // Jobs can overwrite/patch this with richer progress details.
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

      // IMPORTANT: keep /logs clean. Only emit high-signal lifecycle events to server logs.
      this.logger.log(
        `Job started jobId=${jobId} runId=${runId} trigger=${ctx.trigger} dryRun=${ctx.dryRun}`,
      );

      const result = await this.handlers.run(jobId, ctx);
      await ctx.info('run: finished');

      // Ensure any in-flight summary writes complete before we persist final status/summary.
      await awaitSummaryWrites();

      const liveSummary = ctx.getSummary();
      const liveProgress = getProgressSnapshot(liveSummary);

      // Prefer the job's explicit summary, but keep a final "done" progress snapshot
      // if the job emitted progress updates during execution.
      let finalSummary: JsonObject | null =
        result.summary ?? liveSummary ?? null;

      const reportFailure = finalSummary && isJobReportV1(finalSummary)
        ? evaluateJobReportFailure(finalSummary)
        : { failed: false, reason: null as string | null };

      if (finalSummary && liveProgress) {
        const totalRaw = (liveProgress as Record<string, unknown>)['total'];
        const total =
          typeof totalRaw === 'number' && Number.isFinite(totalRaw) && totalRaw >= 0
            ? totalRaw
            : null;
        const currentRaw = (liveProgress as Record<string, unknown>)['current'];
        const current =
          typeof currentRaw === 'number' && Number.isFinite(currentRaw) && currentRaw >= 0
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
        } else {
          await ctx.error('run: reported failed');
        }

        await this.prisma.jobRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            summary: finalSummary ?? Prisma.DbNull,
            errorMessage: reportFailure.reason ?? 'Job reported failure.',
          },
        });

        const ms = Date.now() - startedAt;
        this.logger.error(
          `Job failed jobId=${jobId} runId=${runId} ms=${ms} error=${JSON.stringify(
            reportFailure.reason ?? 'reported_failure',
          )}`,
        );
        return;
      }

      await this.prisma.jobRun.update({
        where: { id: runId },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          summary: finalSummary ?? Prisma.DbNull,
          errorMessage: null,
        },
      });

      const ms = Date.now() - startedAt;
      this.logger.log(
        `Job passed jobId=${jobId} runId=${runId} ms=${ms} dryRun=${ctx.dryRun}`,
      );
    } catch (err) {
      const msg = errToMessage(err);
      await ctx.error('run: failed', { error: msg });
      await this.prisma.jobRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: msg,
          summary: ctx.getSummary() ?? Prisma.DbNull,
        },
      });

      const ms = Date.now() - startedAt;
      this.logger.error(
        `Job failed jobId=${jobId} runId=${runId} ms=${ms} error=${JSON.stringify(msg)}`,
      );
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

  async clearRuns(params: { userId: string; jobId?: string }) {
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

    // Delete in chunks to avoid very large IN() lists.
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

    this.logger.log(
      `Rewind cleared userId=${userId} scope=${jobId ? `jobId=${jobId}` : 'all'} runs=${deletedRuns} logs=${deletedLogs}`,
    );

    return { deletedRuns, deletedLogs };
  }
}
