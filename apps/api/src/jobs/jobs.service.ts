import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JobQueueState, Prisma, type JobRunStatus } from '@prisma/client';
import { CronTime } from 'cron';
import {
  JOB_QUEUE_HEARTBEAT_LEASE_MS,
  JOB_QUEUE_HEARTBEAT_MS,
  JOB_QUEUE_PUMP_INTERVAL_MS,
  JOB_RUN_TIMEOUT_MS,
  JOB_SUMMARY_WRITE_INTERVAL_MS,
  MAX_PENDING_RUNS_GLOBAL,
  MAX_PENDING_RUNS_PER_JOB,
  QUEUE_COOLDOWN_MS,
} from '../app.constants';
import { PrismaService } from '../db/prisma.service';
import { errToMessage } from '../log.utils';
import {
  buildJobEstimateKey,
  buildJobQueueFingerprint,
  findJobDefinition,
  IMMACULATE_TASTE_PROFILE_ACTION_JOB_ID,
  JOB_DEFINITIONS,
} from './job-registry';
import {
  buildAutoRunMediaHistoryPayload,
  DURABLE_AUTO_RUN_JOB_ID_SET,
} from './auto-run-media';
import { JobsHandlers } from './jobs.handlers';
import type { JobReportV1 } from './job-report-v1';
import type {
  JobContext,
  JobLogLevel,
  JobRunTrigger,
  JsonObject,
} from './jobs.types';

const GLOBAL_QUEUE_STATE_ID = 'global';
const TERMINAL_JOB_RUN_STATUSES: JobRunStatus[] = [
  'SUCCESS',
  'FAILED',
  'CANCELLED',
];
const ESTIMATE_HISTORY_LIMIT = 500;

const RUN_SAFE_SELECT = {
  id: true,
  jobId: true,
  userId: true,
  trigger: true,
  dryRun: true,
  status: true,
  startedAt: true,
  queuedAt: true,
  executionStartedAt: true,
  finishedAt: true,
  summary: true,
  errorMessage: true,
} satisfies Prisma.JobRunSelect;

const RUN_QUEUE_SELECT = {
  ...RUN_SAFE_SELECT,
  input: true,
  queueFingerprint: true,
  claimedAt: true,
  heartbeatAt: true,
  workerId: true,
} satisfies Prisma.JobRunSelect;

type SafeRunRecord = Prisma.JobRunGetPayload<{
  select: typeof RUN_SAFE_SELECT;
}>;
type QueueRunRecord = Prisma.JobRunGetPayload<{
  select: typeof RUN_QUEUE_SELECT;
}>;

type QueueEstimateSource =
  | 'median_success'
  | 'median_terminal'
  | 'log_backfill'
  | 'job_default';

type QueueEstimateState =
  | 'estimated'
  | 'cooldown'
  | 'delayed'
  | 'finishing_soon';

type EtaConfidence = 'high' | 'medium' | 'fallback';

type QueueBlockedReason =
  | 'waiting_for_active_run'
  | 'cooldown'
  | 'hidden_blocker_ahead'
  | 'queue_paused';

type QueueEstimate = {
  estimatedRuntimeMs: number;
  estimateSource: QueueEstimateSource;
  etaConfidence: EtaConfidence;
};

type SerializedRun = {
  id: string;
  jobId: string;
  userId: string | null;
  trigger: JobRunTrigger;
  dryRun: boolean;
  status: JobRunStatus;
  startedAt: string;
  queuedAt: string;
  executionStartedAt: string | null;
  finishedAt: string | null;
  summary: unknown;
  errorMessage: string | null;
  jobName: string;
  rewindDisplayName: string;
  visibleInTaskManager: boolean;
  visibleInRewind: boolean;
};

type QueueSnapshotRun = SerializedRun & {
  queuePosition: number;
  runsAheadTotal: number;
  runsAheadVisible: number;
  runsAheadHidden: number;
  estimatedRuntimeMs: number;
  estimatedWaitMs: number;
  estimatedStartAt: string;
  estimateSource: QueueEstimateSource;
  estimateState: QueueEstimateState;
  etaConfidence: EtaConfidence;
  blockedReason: QueueBlockedReason | null;
  redacted?: boolean;
};

type EstimateHistoryEntry = {
  estimateKey: string;
  status: JobRunStatus;
  durationMs: number;
  usesLegacyTiming: boolean;
};

type EstimateHistoryGroups = Map<string, EstimateHistoryEntry[]>;

type EnqueueConflictReason = 'already_processed' | 'already_queued_or_running';

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.trim() ? value.trim() : null;
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const toISO = record['toISO'];
  if (typeof toISO === 'function') {
    const output = (toISO as () => unknown).call(value);
    if (typeof output === 'string') return output;
  }

  const toDate = record['toDate'];
  if (typeof toDate === 'function') {
    const output = (toDate as () => unknown).call(value);
    if (output instanceof Date) return output.toISOString();
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return isPlainObject(value) ? (value as JsonObject) : undefined;
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
        (task): task is JobReportV1['tasks'][number] =>
          Boolean(task) && typeof task === 'object' && !Array.isArray(task),
      )
    : [];

  const failedTasks = tasks.filter((task) => task.status === 'failed');
  if (!failedTasks.length) return { failed: false, reason: null };

  const parts = failedTasks.slice(0, 3).map((task) => {
    const title = String(task.title ?? task.id ?? 'task').trim() || 'task';
    const issues = Array.isArray(task.issues) ? task.issues : [];
    const firstIssue = issues.find(
      (issue) => issue && typeof issue === 'object',
    ) as { message?: unknown } | undefined;
    const message =
      firstIssue && typeof firstIssue.message === 'string'
        ? firstIssue.message.trim()
        : '';
    return message ? `${title}: ${message}` : title;
  });
  const more =
    failedTasks.length > 3 ? ` (+${failedTasks.length - 3} more)` : '';
  return {
    failed: true,
    reason: `Job reported failed task(s): ${parts.join(' | ')}${more}`,
  };
}

function buildEnqueueConflictException(
  reason: EnqueueConflictReason,
): ConflictException {
  return new ConflictException({
    reason,
    message:
      reason === 'already_processed'
        ? 'Job already processed for this media.'
        : 'Job already queued or running',
  });
}

function shouldUseDurableAutoRunDedupe(params: {
  jobId: string;
  trigger: JobRunTrigger;
  dryRun: boolean;
}) {
  return (
    params.trigger === 'auto' &&
    !params.dryRun &&
    DURABLE_AUTO_RUN_JOB_ID_SET.has(params.jobId)
  );
}

function isRunSummaryMarkedSkipped(summary: JsonObject | null | undefined) {
  if (!summary) return false;
  if (summary['skipped'] === true) return true;
  const raw = summary['raw'];
  return isPlainObject(raw) && raw['skipped'] === true;
}

function buildDurableAutoRunHistoryRecord(params: {
  runId: string;
  jobId: string;
  trigger: JobRunTrigger;
  dryRun: boolean;
  input?: JsonObject | null;
  summary?: JsonObject | null;
}) {
  if (!shouldUseDurableAutoRunDedupe(params)) return null;
  if (isRunSummaryMarkedSkipped(params.summary)) return null;

  const payload = buildAutoRunMediaHistoryPayload(params.input ?? null);
  if (!payload) return null;

  return {
    ...payload,
    jobId: params.jobId,
    firstRunId: params.runId,
  };
}

function extractInputContext(input?: JsonObject): JsonObject | null {
  if (!input) return null;
  const raw = input as Record<string, unknown>;
  const output: JsonObject = {};

  const plexUserId =
    typeof raw['plexUserId'] === 'string' ? raw['plexUserId'].trim() : '';
  const plexUserTitle =
    typeof raw['plexUserTitle'] === 'string' ? raw['plexUserTitle'].trim() : '';
  const seedTitle =
    typeof raw['seedTitle'] === 'string' ? raw['seedTitle'].trim() : '';
  const mediaType =
    typeof raw['mediaType'] === 'string' ? raw['mediaType'].trim() : '';
  const seedYearRaw = raw['seedYear'];
  const seedYear =
    typeof seedYearRaw === 'number' && Number.isFinite(seedYearRaw)
      ? Math.trunc(seedYearRaw)
      : typeof seedYearRaw === 'string' && seedYearRaw.trim()
        ? Number.parseInt(seedYearRaw.trim(), 10)
        : null;
  const action = typeof raw['action'] === 'string' ? raw['action'].trim() : '';
  const profileId =
    typeof raw['profileId'] === 'string' ? raw['profileId'].trim() : '';

  if (plexUserId) output.plexUserId = plexUserId;
  if (plexUserTitle) output.plexUserTitle = plexUserTitle;
  if (mediaType) output.mediaType = mediaType;
  if (seedTitle) output.seedTitle = seedTitle;
  if (seedYear !== null && Number.isFinite(seedYear))
    output.seedYear = seedYear;
  if (action) output.action = action;
  if (profileId) output.profileId = profileId;

  return Object.keys(output).length ? output : null;
}

function buildQueuedSummary(params: {
  trigger: JobRunTrigger;
  dryRun: boolean;
  input?: JsonObject;
  queuedAt: Date;
}): JsonObject {
  const inputContext = extractInputContext(params.input);
  return {
    phase: 'queued',
    dryRun: params.dryRun,
    trigger: params.trigger,
    ...(inputContext ?? {}),
    progress: {
      step: 'queued',
      message: 'Queued…',
      updatedAt: params.queuedAt.toISOString(),
    },
  };
}

function getProgressSnapshot(summary: JsonObject | null): JsonObject | null {
  if (!summary) return null;
  const raw = (summary as Record<string, unknown>)['progress'];
  return isPlainObject(raw) ? (raw as JsonObject) : null;
}

function getProgressStep(summary: JsonObject | null): string | null {
  const progress = getProgressSnapshot(summary);
  const raw = progress?.['step'];
  if (typeof raw !== 'string') return null;
  const step = raw.trim();
  return step ? step : null;
}

function resolveQueuedAt(run: {
  queuedAt: Date | null;
  startedAt: Date;
}): Date {
  return run.queuedAt ?? run.startedAt;
}

function resolveExecutionStartedAt(run: {
  executionStartedAt: Date | null;
}): Date | null {
  return run.executionStartedAt ?? null;
}

function resolveRuntimeMs(run: {
  executionStartedAt: Date | null;
  queuedAt: Date | null;
  startedAt: Date;
  finishedAt: Date | null;
}): number | null {
  if (!run.finishedAt) return null;
  const start = run.executionStartedAt ?? run.queuedAt ?? run.startedAt;
  return Math.max(0, run.finishedAt.getTime() - start.getTime());
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function sanitizeSummaryForClient(summary: unknown): unknown {
  if (!isPlainObject(summary)) return summary;
  const sanitized = { ...summary };
  delete sanitized['_queuedInput'];
  return sanitized;
}

function estimateConfidence(source: QueueEstimateSource): EtaConfidence {
  if (source === 'median_success') return 'high';
  if (source === 'median_terminal') return 'medium';
  return 'fallback';
}

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  private readonly timedOutRunIds = new Set<string>();
  private readonly workerId = `jobs-worker-${process.pid}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  private pumpChain: Promise<void> = Promise.resolve();
  private static readonly UNSCHEDULABLE_JOB_IDS = new Set<string>([
    'mediaAddedCleanup',
    'unmonitorConfirm',
    'immaculateTastePoints',
    'watchedMovieRecommendations',
    'collectionResyncUpgrade',
    'importNetflixHistory',
    'importPlexHistory',
    IMMACULATE_TASTE_PROFILE_ACTION_JOB_ID,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handlers: JobsHandlers,
  ) {}

  async onModuleInit() {
    await this.ensureQueueState();
    await this.recoverQueueOnStartup();
    void this.scheduleQueuePump('startup');
  }

  @Interval(JOB_QUEUE_PUMP_INTERVAL_MS)
  async pollQueuePump() {
    await this.scheduleQueuePump('interval');
  }

  @Interval(JOB_QUEUE_HEARTBEAT_MS)
  async heartbeatActiveRun() {
    await this.refreshHeartbeat();
  }

  listDefinitions() {
    return JOB_DEFINITIONS.map((job) => ({
      id: job.id,
      name: job.name,
      description: job.description,
      defaultScheduleCron: job.defaultScheduleCron ?? null,
      visibleInTaskManager: job.visibleInTaskManager,
      visibleInRewind: job.visibleInRewind,
      rewindDisplayName: job.rewindDisplayName,
      defaultEstimatedRuntimeMs: job.defaultEstimatedRuntimeMs,
    }));
  }

  async listJobsWithSchedules() {
    const schedules = await this.prisma.jobSchedule.findMany();
    const scheduleMap = new Map(
      schedules.map((schedule) => [schedule.jobId, schedule]),
    );

    return this.listDefinitions().map((job) => ({
      ...job,
      schedule: (() => {
        if (JobsService.UNSCHEDULABLE_JOB_IDS.has(job.id)) return null;
        const schedule = scheduleMap.get(job.id) ?? null;
        if (!schedule) return null;
        const nextRunAt = schedule.enabled
          ? (() => {
              try {
                const cronTime = new CronTime(
                  schedule.cron,
                  schedule.timezone ?? undefined,
                );
                return toIsoString(cronTime.sendAt());
              } catch {
                return null;
              }
            })()
          : null;
        return { ...schedule, nextRunAt };
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
    return this.serializeRun(await this.enqueueRun(params));
  }

  async queueJob(params: {
    jobId: string;
    trigger: JobRunTrigger;
    dryRun: boolean;
    userId: string;
    input?: JsonObject;
  }) {
    return this.serializeRun(await this.enqueueRun(params));
  }

  async startQueuedJob(params: { runId: string }) {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: params.runId },
      select: RUN_QUEUE_SELECT,
    });
    if (!run) throw new NotFoundException('Run not found');

    void this.scheduleQueuePump('legacy_start');

    const refreshed = await this.prisma.jobRun.findUnique({
      where: { id: params.runId },
      select: RUN_QUEUE_SELECT,
    });
    if (!refreshed) throw new NotFoundException('Run not found');
    if (refreshed.status !== 'RUNNING') {
      throw new ConflictException(
        `Queued run is not at the front of the persisted queue: runId=${params.runId}`,
      );
    }
    return this.serializeRun(refreshed);
  }

  async failQueuedJob(params: { runId: string; errorMessage: string }) {
    const runId = params.runId.trim();
    const errorMessage = params.errorMessage.trim();
    if (!runId || !errorMessage) return { updated: false };

    const now = new Date();
    const updated = await this.prisma.jobRun.updateMany({
      where: { id: runId, status: 'PENDING' },
      data: {
        status: 'FAILED',
        finishedAt: now,
        errorMessage,
      },
    });
    if (!updated.count) return { updated: false };

    await this.prisma.jobLogLine
      .create({
        data: {
          runId,
          level: 'error',
          message: 'run: failed before start',
          context: {
            error: errorMessage,
            reason: 'invalid_before_start',
          },
        },
      })
      .catch(() => undefined);

    this.logQueueDecision('invalid_before_start', {
      runId,
      errorMessage,
    });
    void this.scheduleQueuePump('fail_queued');

    return { updated: true };
  }

  async timeoutRunningJob(params: {
    runId: string;
    jobId: string;
    startedAt: Date;
  }) {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: params.runId },
      select: RUN_QUEUE_SELECT,
    });
    if (!run || run.status !== 'RUNNING') return;

    const now = new Date();
    const startedAt = run.executionStartedAt ?? params.startedAt;
    const elapsedMs = now.getTime() - startedAt.getTime();
    const elapsedMin = Math.round(elapsedMs / 60_000);
    const limitMin = Math.round(JOB_RUN_TIMEOUT_MS / 60_000);
    const lastProgress = getProgressSnapshot(asJsonObject(run.summary) ?? null);

    const message = `Job timed out after ${elapsedMin}m (limit: ${limitMin}m); marking as FAILED.`;
    this.timedOutRunIds.add(params.runId);

    const timeoutSummary: JsonObject = {
      ...(asJsonObject(run.summary) ?? {}),
      progress: {
        ...(lastProgress ?? {}),
        step: 'timed_out',
        message: `Timed out after ${elapsedMin}m.`,
        updatedAt: now.toISOString(),
      },
    };

    const finalized = await this.finalizeRunningRun({
      runId: params.runId,
      status: 'FAILED',
      finishedAt: now,
      summary: timeoutSummary,
      errorMessage: message,
      message,
      context: {
        reason: 'timeout_watchdog',
        jobId: params.jobId,
        startedAt: startedAt.toISOString(),
        timedOutAt: now.toISOString(),
        elapsedMs,
        lastProgress: lastProgress ?? null,
      },
    });

    if (finalized) {
      this.logger.warn(
        `Watchdog timeout: jobId=${params.jobId} runId=${params.runId} elapsed=${elapsedMin}m`,
      );
      this.logQueueDecision('timed_out', {
        jobId: params.jobId,
        runId: params.runId,
        elapsedMs,
      });
    }

    this.timedOutRunIds.delete(params.runId);
    void this.scheduleQueuePump('timeout');
  }

  async listRuns(params: {
    userId: string;
    jobId?: string;
    take: number;
    skip: number;
  }) {
    const runs = await this.prisma.jobRun.findMany({
      where: {
        userId: params.userId,
        ...(params.jobId ? { jobId: params.jobId } : {}),
      },
      orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
      take: params.take,
      skip: params.skip,
      select: RUN_SAFE_SELECT,
    });
    return runs.map((run) => this.serializeRun(run));
  }

  async getRun(params: { userId: string; runId: string }) {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: params.runId },
      select: RUN_SAFE_SELECT,
    });
    if (!run || run.userId !== params.userId) {
      throw new NotFoundException('Run not found');
    }
    return this.serializeRun(run);
  }

  async getRunLogs(params: {
    userId: string;
    runId: string;
    take: number;
    skip: number;
  }) {
    await this.getRun({ userId: params.userId, runId: params.runId });
    return await this.prisma.jobLogLine.findMany({
      where: { runId: params.runId },
      orderBy: { time: 'asc' },
      take: params.take,
      skip: params.skip,
    });
  }

  async clearRuns(params: { userId: string; jobId?: string }) {
    const where: Prisma.JobRunWhereInput = {
      userId: params.userId,
      status: { in: TERMINAL_JOB_RUN_STATUSES },
      ...(params.jobId ? { jobId: params.jobId } : {}),
    };

    const runs = await this.prisma.jobRun.findMany({
      where,
      select: { id: true },
    });
    const ids = runs.map((run) => run.id);
    if (!ids.length) {
      return { deletedRuns: 0, deletedLogs: 0 };
    }

    const chunkSize = 500;
    let deletedRuns = 0;
    let deletedLogs = 0;

    for (let index = 0; index < ids.length; index += chunkSize) {
      const batch = ids.slice(index, index + chunkSize);
      const [logsResult, runsResult] = await this.prisma.$transaction([
        this.prisma.jobLogLine.deleteMany({ where: { runId: { in: batch } } }),
        this.prisma.jobRun.deleteMany({ where: { id: { in: batch } } }),
      ]);
      deletedLogs += logsResult.count;
      deletedRuns += runsResult.count;
    }

    this.logger.log(
      `Rewind cleared userId=${params.userId} scope=${
        params.jobId ? `jobId=${params.jobId}` : 'all'
      } runs=${deletedRuns} logs=${deletedLogs}`,
    );

    return { deletedRuns, deletedLogs };
  }

  async cancelPendingRun(params: {
    userId: string;
    runId: string;
    reason?: string;
  }) {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: params.runId },
      select: RUN_QUEUE_SELECT,
    });
    if (!run || run.userId !== params.userId) {
      throw new NotFoundException('Run not found');
    }
    if (run.status !== 'PENDING') {
      throw new ConflictException('Only pending runs can be cancelled');
    }

    const now = new Date();
    const reason = params.reason?.trim() || 'cancelled_by_user';
    const updated = await this.prisma.jobRun.updateMany({
      where: { id: params.runId, status: 'PENDING' },
      data: {
        status: 'CANCELLED',
        finishedAt: now,
        errorMessage: `Cancelled: ${reason}`,
      },
    });
    if (!updated.count) {
      throw new ConflictException('Run is no longer pending');
    }

    await this.prisma.jobLogLine
      .create({
        data: {
          runId: params.runId,
          level: 'warn',
          message: 'run: cancelled',
          context: {
            actorUserId: params.userId,
            reason,
          },
        },
      })
      .catch(() => undefined);

    this.logQueueDecision('cancelled', {
      runId: params.runId,
      actorUserId: params.userId,
      reason,
    });
    void this.scheduleQueuePump('cancel');

    return await this.getRun({ userId: params.userId, runId: params.runId });
  }

  async getQueueSnapshot(params: { userId: string }) {
    const now = new Date();
    const [state, pendingRuns, activeRun, estimateHistory] = await Promise.all([
      this.ensureQueueState(),
      this.prisma.jobRun.findMany({
        where: { status: 'PENDING' },
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
        select: RUN_QUEUE_SELECT,
      }),
      this.getActiveQueueRun(),
      this.prisma.jobRun.findMany({
        where: {
          status: { in: ['SUCCESS', 'FAILED'] },
          finishedAt: { not: null },
        },
        orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
        take: ESTIMATE_HISTORY_LIMIT,
        select: RUN_QUEUE_SELECT,
      }),
    ]);

    const estimateGroups = this.buildEstimateHistoryGroups(estimateHistory);
    const visiblePendingRuns = pendingRuns.filter((run) =>
      this.isRunVisibleToUser(run, params.userId),
    );
    const activeEstimate = activeRun
      ? this.resolveRunEstimate(activeRun, estimateGroups)
      : null;
    const activeRemainingMs = activeRun
      ? this.resolveActiveRemainingMs(activeRun, activeEstimate, now)
      : 0;
    const activeDelayed = activeRun
      ? this.isDelayedActiveRun(activeRun, activeEstimate, now)
      : false;
    const activeHidden =
      Boolean(activeRun) &&
      !this.isRunVisibleToUser(activeRun as QueueRunRecord, params.userId);
    const cooldownRemainingMs =
      state.cooldownUntil && state.cooldownUntil.getTime() > now.getTime()
        ? state.cooldownUntil.getTime() - now.getTime()
        : 0;

    const pendingSnapshots: QueueSnapshotRun[] = visiblePendingRuns.map(
      (run) => {
        const runEstimate = this.resolveRunEstimate(run, estimateGroups);
        const globalIndex = pendingRuns.findIndex(
          (pending) => pending.id === run.id,
        );
        const ahead = globalIndex > 0 ? pendingRuns.slice(0, globalIndex) : [];
        const runsAheadVisible = ahead.filter((candidate) =>
          this.isRunVisibleToUser(candidate, params.userId),
        ).length;
        const runsAheadTotal = ahead.length;
        const runsAheadHidden =
          runsAheadTotal +
          (activeHidden ? 1 : 0) +
          (activeRun && !activeHidden ? 0 : 0) -
          runsAheadVisible;
        const aheadWaitMs =
          ahead.reduce(
            (sum, candidate) =>
              sum +
              this.resolveRunEstimate(candidate, estimateGroups)
                .estimatedRuntimeMs +
              QUEUE_COOLDOWN_MS,
            0,
          ) ?? 0;
        const initialWaitMs = activeRun
          ? activeRemainingMs + QUEUE_COOLDOWN_MS
          : globalIndex === 0 && cooldownRemainingMs > 0
            ? cooldownRemainingMs
            : 0;
        const estimatedWaitMs = initialWaitMs + aheadWaitMs;
        const estimateState = this.resolvePendingEstimateState({
          globalIndex,
          activeRunExists: Boolean(activeRun),
          activeRemainingMs,
          activeDelayed,
          cooldownRemainingMs,
        });
        const blockedReason = this.resolveBlockedReason({
          paused: state.paused,
          activeRunExists: Boolean(activeRun),
          hiddenBlockersAhead: runsAheadHidden > 0,
          globalIndex,
          cooldownRemainingMs,
        });

        return {
          ...this.serializeRun(run),
          queuePosition: globalIndex + 1,
          runsAheadTotal,
          runsAheadVisible,
          runsAheadHidden: Math.max(0, runsAheadHidden),
          estimatedRuntimeMs: runEstimate.estimatedRuntimeMs,
          estimatedWaitMs,
          estimatedStartAt: new Date(
            now.getTime() + estimatedWaitMs,
          ).toISOString(),
          estimateSource: runEstimate.estimateSource,
          estimateState,
          etaConfidence: runEstimate.etaConfidence,
          blockedReason,
        };
      },
    );

    const oldestPendingAgeMs = pendingRuns.length
      ? Math.max(0, now.getTime() - resolveQueuedAt(pendingRuns[0]).getTime())
      : 0;
    const stalledPendingCount = pendingRuns.filter((run) =>
      this.isPendingRunStalled(run, now),
    ).length;
    const health =
      pendingRuns.length > 150 || oldestPendingAgeMs > 2 * 60 * 60_000
        ? 'error'
        : pendingRuns.length > 50 || oldestPendingAgeMs > 30 * 60_000
          ? 'warn'
          : 'ok';

    return {
      activeRun: activeRun
        ? this.serializeQueueActiveRun({
            run: activeRun,
            estimate: activeEstimate,
            now,
            userId: params.userId,
            delayed: activeDelayed,
          })
        : null,
      pendingRuns: pendingSnapshots,
      cooldownUntil: state.cooldownUntil?.toISOString() ?? null,
      pendingCountTotal: pendingRuns.length,
      pendingCountVisible: visiblePendingRuns.length,
      oldestPendingAgeMs,
      delayedRunCount: activeDelayed ? 1 : 0,
      paused: state.paused,
      pauseReason: state.pauseReason,
      stalledPendingCount,
      health,
    };
  }

  async pauseQueue(params: { actorUserId: string; reason?: string }) {
    const reason = params.reason?.trim() || 'Paused by admin';
    const state = await this.prisma.jobQueueState.update({
      where: { id: GLOBAL_QUEUE_STATE_ID },
      data: {
        paused: true,
        pauseReason: reason,
        version: { increment: 1 },
      },
    });
    this.logQueueDecision('queue_paused', {
      actorUserId: params.actorUserId,
      reason,
    });
    return state;
  }

  async resumeQueue(params: { actorUserId: string }) {
    const state = await this.prisma.jobQueueState.update({
      where: { id: GLOBAL_QUEUE_STATE_ID },
      data: {
        paused: false,
        pauseReason: null,
        version: { increment: 1 },
      },
    });
    this.logQueueDecision('queue_resumed', {
      actorUserId: params.actorUserId,
    });
    void this.scheduleQueuePump('resume');
    return state;
  }

  private async enqueueRun(params: {
    jobId: string;
    trigger: JobRunTrigger;
    dryRun: boolean;
    userId: string;
    input?: JsonObject;
  }) {
    const definition = findJobDefinition(params.jobId);
    if (!definition) {
      throw new NotFoundException(`Unknown job: ${params.jobId}`);
    }
    if (definition.internalOnly) {
      throw new NotFoundException(`Unknown job: ${params.jobId}`);
    }

    const queuedAt = new Date();
    const summary = buildQueuedSummary({
      trigger: params.trigger,
      dryRun: params.dryRun,
      input: params.input,
      queuedAt,
    });
    const queueFingerprint = this.buildQueueFingerprint({
      jobId: params.jobId,
      trigger: params.trigger,
      dryRun: params.dryRun,
      userId: params.userId,
      input: params.input,
      summary,
    });

    const run = await this.prisma.$transaction(async (tx) => {
      await this.ensureQueueState(tx);

      const [pendingCountTotal, pendingCountForJob] = await Promise.all([
        tx.jobRun.count({ where: { status: 'PENDING' } }),
        tx.jobRun.count({
          where: { status: 'PENDING', jobId: params.jobId },
        }),
      ]);

      if (pendingCountTotal >= MAX_PENDING_RUNS_GLOBAL) {
        this.logQueueDecision('enqueue_rejected_by_cap', {
          jobId: params.jobId,
          reason: 'global_cap',
          pendingCountTotal,
        });
        throw new HttpException(
          'The global queue is full right now. Please try again soon.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (pendingCountForJob >= MAX_PENDING_RUNS_PER_JOB) {
        this.logQueueDecision('enqueue_rejected_by_cap', {
          jobId: params.jobId,
          reason: 'per_job_cap',
          pendingCountForJob,
        });
        throw new HttpException(
          'Too many pending runs already exist for this job. Please wait for the backlog to drain.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (params.trigger === 'schedule') {
        const existing = await tx.jobRun.findFirst({
          where: {
            jobId: params.jobId,
            status: { in: ['PENDING', 'RUNNING'] },
          },
          select: { id: true },
        });
        if (existing) {
          this.logQueueDecision('enqueue_skipped', {
            jobId: params.jobId,
            trigger: params.trigger,
            reason: 'already_queued_or_running',
          });
          throw buildEnqueueConflictException('already_queued_or_running');
        }
      }

      const durableHistory =
        shouldUseDurableAutoRunDedupe(params) &&
        params.input &&
        buildAutoRunMediaHistoryPayload(params.input);
      if (durableHistory) {
        const existing = await tx.autoRunMediaHistory.findUnique({
          where: {
            jobId_mediaFingerprint: {
              jobId: params.jobId,
              mediaFingerprint: durableHistory.mediaFingerprint,
            },
          },
          select: { id: true },
        });
        if (existing) {
          this.logQueueDecision('enqueue_deduped', {
            jobId: params.jobId,
            trigger: params.trigger,
            reason: 'already_processed',
            mediaFingerprint: durableHistory.mediaFingerprint,
          });
          throw buildEnqueueConflictException('already_processed');
        }
      }

      const shouldDedupeByFingerprint =
        params.trigger === 'auto' ||
        definition.dedupePolicy === 'profile_action_target';
      if (shouldDedupeByFingerprint) {
        const existing = await tx.jobRun.findFirst({
          where: {
            queueFingerprint,
            status: { in: ['PENDING', 'RUNNING'] },
          },
          select: { id: true },
        });
        if (existing) {
          this.logQueueDecision('enqueue_deduped', {
            jobId: params.jobId,
            trigger: params.trigger,
            queueFingerprint,
            reason: 'already_queued_or_running',
          });
          throw buildEnqueueConflictException('already_queued_or_running');
        }
      }

      return await tx.jobRun.create({
        data: {
          jobId: params.jobId,
          userId: params.userId,
          trigger: params.trigger,
          dryRun: params.dryRun,
          status: 'PENDING',
          startedAt: queuedAt,
          queuedAt,
          input: params.input ?? Prisma.DbNull,
          summary: summary ?? Prisma.DbNull,
          queueFingerprint,
          executionStartedAt: null,
          claimedAt: null,
          heartbeatAt: null,
          workerId: null,
        },
        select: RUN_QUEUE_SELECT,
      });
    });

    this.logQueueDecision('enqueue_accepted', {
      jobId: params.jobId,
      runId: run.id,
      trigger: params.trigger,
    });
    void this.scheduleQueuePump('enqueue');
    return run;
  }

  private scheduleQueuePump(reason: string) {
    this.pumpChain = this.pumpChain
      .catch(() => undefined)
      .then(async () => {
        await this.pumpQueueInternal(reason);
      })
      .catch((error) => {
        this.logger.warn(
          `Queue pump failed (${reason}): ${errToMessage(error)}`,
        );
      });
    return this.pumpChain;
  }

  private async pumpQueueInternal(reason: string) {
    await this.recoverStaleHeartbeatLease();

    const now = new Date();
    const claimed = await this.claimNextRun(now);
    if (!claimed) return;

    this.logQueueDecision('claimed', {
      reason,
      runId: claimed.id,
      jobId: claimed.jobId,
    });
    this.launchRunExecution({
      run: claimed,
      input: asJsonObject(claimed.input),
    });
  }

  private async claimNextRun(now: Date): Promise<QueueRunRecord | null> {
    return await this.prisma.$transaction(async (tx) => {
      const state = await this.ensureQueueState(tx);
      if (state.paused) return null;
      if (state.activeRunId) return null;
      if (
        state.cooldownUntil &&
        state.cooldownUntil.getTime() > now.getTime()
      ) {
        return null;
      }

      const nextRun = await tx.jobRun.findFirst({
        where: { status: 'PENDING' },
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
        select: RUN_QUEUE_SELECT,
      });
      if (!nextRun) return null;

      const claimedState = await tx.jobQueueState.updateMany({
        where: {
          id: GLOBAL_QUEUE_STATE_ID,
          version: state.version,
          activeRunId: null,
          paused: false,
          OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
        },
        data: {
          activeRunId: nextRun.id,
          version: { increment: 1 },
        },
      });
      if (!claimedState.count) return null;

      const updatedRun = await tx.jobRun.updateMany({
        where: { id: nextRun.id, status: 'PENDING' },
        data: {
          status: 'RUNNING',
          executionStartedAt: now,
          claimedAt: now,
          heartbeatAt: now,
          workerId: this.workerId,
          errorMessage: null,
        },
      });
      if (!updatedRun.count) {
        await tx.jobQueueState.update({
          where: { id: GLOBAL_QUEUE_STATE_ID },
          data: {
            activeRunId: null,
            version: { increment: 1 },
          },
        });
        return null;
      }

      return await tx.jobRun.findUnique({
        where: { id: nextRun.id },
        select: RUN_QUEUE_SELECT,
      });
    });
  }

  private launchRunExecution(params: {
    run: QueueRunRecord;
    input?: JsonObject;
  }) {
    const { ctx, awaitSummaryWrites } = this.createJobContext(params);

    void this.executeJobRun({
      run: params.run,
      ctx,
      awaitSummaryWrites,
    }).catch((error) => {
      this.logger.error(
        `Unhandled job execution error jobId=${params.run.jobId} runId=${params.run.id}: ${errToMessage(error)}`,
      );
    });
  }

  private createJobContext(params: {
    run: QueueRunRecord;
    input?: JsonObject;
  }) {
    const { run, input } = params;
    let summaryCache: JsonObject | null = asJsonObject(run.summary) ?? null;
    let persistedSummaryCache: JsonObject | null = summaryCache;
    let pendingSummarySnapshot: JsonObject | null = summaryCache;
    let summaryWriteChain: Promise<void> = Promise.resolve();
    let summaryWriteTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSummaryPersistedAt = Date.now();

    const clearSummaryWriteTimer = () => {
      if (!summaryWriteTimer) return;
      clearTimeout(summaryWriteTimer);
      summaryWriteTimer = null;
    };

    const enqueueSummaryWrite = (snapshot: JsonObject | null) => {
      pendingSummarySnapshot = snapshot;
      summaryWriteChain = summaryWriteChain
        .catch(() => undefined)
        .then(async () => {
          await this.prisma.jobRun.update({
            where: { id: run.id },
            data: { summary: snapshot ?? Prisma.DbNull },
          });
          persistedSummaryCache = snapshot;
          lastSummaryPersistedAt = Date.now();
        })
        .catch((error) => {
          this.logger.warn(
            `[${run.jobId}#${run.id}] summary write failed: ${errToMessage(error)}`,
          );
        });
      return summaryWriteChain;
    };

    const scheduleSummaryWrite = () => {
      if (summaryWriteTimer) return;
      summaryWriteTimer = setTimeout(() => {
        const snapshot = pendingSummarySnapshot;
        clearSummaryWriteTimer();
        void enqueueSummaryWrite(snapshot);
      }, JOB_SUMMARY_WRITE_INTERVAL_MS);
      if (
        typeof summaryWriteTimer === 'object' &&
        summaryWriteTimer &&
        'unref' in summaryWriteTimer
      ) {
        summaryWriteTimer.unref();
      }
    };

    const persistSummary = async (
      snapshot: JsonObject | null,
      force = false,
    ) => {
      pendingSummarySnapshot = snapshot;
      const shouldWriteNow =
        force ||
        Date.now() - lastSummaryPersistedAt >= JOB_SUMMARY_WRITE_INTERVAL_MS;
      if (shouldWriteNow) {
        clearSummaryWriteTimer();
        await enqueueSummaryWrite(snapshot);
        return;
      }
      scheduleSummaryWrite();
    };

    const awaitSummaryWrites = async () => {
      clearSummaryWriteTimer();
      if (pendingSummarySnapshot !== persistedSummaryCache) {
        await enqueueSummaryWrite(pendingSummarySnapshot);
      }
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
      jobId: run.jobId,
      runId: run.id,
      userId: run.userId?.trim() || '',
      dryRun: run.dryRun,
      trigger: run.trigger,
      input,
      getSummary: () => summaryCache,
      setSummary: async (summary) => {
        summaryCache = summary;
        await persistSummary(summaryCache, true);
      },
      patchSummary: async (patch) => {
        summaryCache = { ...(summaryCache ?? {}), ...(patch ?? {}) };
        const forceImmediateWrite =
          getProgressStep(summaryCache) !==
          getProgressStep(persistedSummaryCache);
        await persistSummary(summaryCache, forceImmediateWrite);
      },
      log,
      debug: (message, context) => log('debug', message, context),
      info: (message, context) => log('info', message, context),
      warn: (message, context) => log('warn', message, context),
      error: (message, context) => log('error', message, context),
    };

    return { ctx, awaitSummaryWrites };
  }

  private async executeJobRun(params: {
    run: QueueRunRecord;
    ctx: JobContext;
    awaitSummaryWrites: () => Promise<void>;
  }) {
    const { run, ctx, awaitSummaryWrites } = params;
    const executionStartedAt = run.executionStartedAt ?? new Date();
    const jobId = run.jobId;

    try {
      if (!('alternateFormatName' in globalThis)) {
        (globalThis as Record<string, unknown>).alternateFormatName = '';
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

      this.logger.log(
        `Job started jobId=${jobId} runId=${run.id} trigger=${ctx.trigger} dryRun=${ctx.dryRun}`,
      );

      const result = await this.handlers.run(jobId, ctx);
      await ctx.info('run: finished');
      await awaitSummaryWrites();

      if (this.timedOutRunIds.has(run.id)) {
        this.logger.warn(
          `Job completed after watchdog timeout; skipping status update: jobId=${jobId} runId=${run.id}`,
        );
        return;
      }

      const liveSummary = ctx.getSummary();
      const liveProgress = getProgressSnapshot(liveSummary);
      let finalSummary: JsonObject | null =
        result.summary ?? liveSummary ?? null;

      const reportFailure =
        finalSummary && isJobReportV1(finalSummary)
          ? evaluateJobReportFailure(finalSummary)
          : { failed: false, reason: null as string | null };

      if (finalSummary && liveProgress) {
        const totalRaw = (liveProgress as Record<string, unknown>)['total'];
        const total =
          typeof totalRaw === 'number' &&
          Number.isFinite(totalRaw) &&
          totalRaw >= 0
            ? totalRaw
            : null;
        const currentRaw = (liveProgress as Record<string, unknown>)['current'];
        const current =
          typeof currentRaw === 'number' &&
          Number.isFinite(currentRaw) &&
          currentRaw >= 0
            ? currentRaw
            : null;

        finalSummary = {
          ...finalSummary,
          progress: {
            ...liveProgress,
            step: reportFailure.failed ? 'failed' : 'done',
            message: reportFailure.failed ? 'Failed.' : 'Completed.',
            ...(total !== null
              ? { total, current: total }
              : current !== null
                ? { current }
                : {}),
            updatedAt: new Date().toISOString(),
          },
        };
      }

      if (reportFailure.failed) {
        if (reportFailure.reason) {
          await ctx.error('run: reported failed', {
            reason: reportFailure.reason,
          });
        } else {
          await ctx.error('run: reported failed');
        }

        const finishedAt = new Date();
        await this.finalizeRunningRun({
          runId: run.id,
          status: 'FAILED',
          finishedAt,
          summary: finalSummary,
          errorMessage: reportFailure.reason ?? 'Job reported failure.',
          message: reportFailure.reason
            ? 'run: reported failed'
            : 'run: failed',
          context: reportFailure.reason
            ? { reason: reportFailure.reason }
            : undefined,
          runContext: {
            jobId: run.jobId,
            trigger: run.trigger,
            dryRun: run.dryRun,
            input: ctx.input ?? null,
          },
        });

        const ms = finishedAt.getTime() - executionStartedAt.getTime();
        this.logger.error(
          `Job failed jobId=${jobId} runId=${run.id} ms=${ms} error=${JSON.stringify(
            reportFailure.reason ?? 'reported_failure',
          )}`,
        );
        this.logQueueDecision('failed', {
          jobId,
          runId: run.id,
          ms,
        });
        return;
      }

      const finishedAt = new Date();
      await this.finalizeRunningRun({
        runId: run.id,
        status: 'SUCCESS',
        finishedAt,
        summary: finalSummary,
        errorMessage: null,
        runContext: {
          jobId: run.jobId,
          trigger: run.trigger,
          dryRun: run.dryRun,
          input: ctx.input ?? null,
        },
      });

      const ms = finishedAt.getTime() - executionStartedAt.getTime();
      this.logger.log(
        `Job passed jobId=${jobId} runId=${run.id} ms=${ms} dryRun=${ctx.dryRun}`,
      );
      this.logQueueDecision('completed', {
        jobId,
        runId: run.id,
        ms,
      });
    } catch (error) {
      if (this.timedOutRunIds.has(run.id)) {
        this.logger.warn(
          `Job errored after watchdog timeout; skipping status update: jobId=${jobId} runId=${run.id}`,
        );
        return;
      }

      const message = errToMessage(error);
      await ctx.error('run: failed', { error: message });
      const finishedAt = new Date();
      await this.finalizeRunningRun({
        runId: run.id,
        status: 'FAILED',
        finishedAt,
        summary: ctx.getSummary() ?? null,
        errorMessage: message,
        runContext: {
          jobId: run.jobId,
          trigger: run.trigger,
          dryRun: run.dryRun,
          input: ctx.input ?? null,
        },
      });

      const ms = finishedAt.getTime() - executionStartedAt.getTime();
      this.logger.error(
        `Job failed jobId=${jobId} runId=${run.id} ms=${ms} error=${JSON.stringify(message)}`,
      );
      this.logQueueDecision('failed', {
        jobId,
        runId: run.id,
        ms,
        error: message,
      });
    } finally {
      void this.scheduleQueuePump('run_finalized');
    }
  }

  private async finalizeRunningRun(params: {
    runId: string;
    status: Extract<JobRunStatus, 'SUCCESS' | 'FAILED' | 'CANCELLED'>;
    finishedAt: Date;
    summary?: JsonObject | null;
    errorMessage?: string | null;
    message?: string;
    context?: JsonObject;
    runContext?: {
      jobId: string;
      trigger: JobRunTrigger;
      dryRun: boolean;
      input?: JsonObject | null;
    };
  }) {
    const cooldownUntil =
      params.status === 'CANCELLED'
        ? null
        : new Date(params.finishedAt.getTime() + QUEUE_COOLDOWN_MS);

    const durableHistoryRecord =
      params.status === 'SUCCESS' && params.runContext
        ? buildDurableAutoRunHistoryRecord({
            runId: params.runId,
            jobId: params.runContext.jobId,
            trigger: params.runContext.trigger,
            dryRun: params.runContext.dryRun,
            input: params.runContext.input ?? null,
            summary: params.summary ?? null,
          })
        : null;

    const runResult = await this.prisma.$transaction(async (tx) => {
      const updatedRun = await tx.jobRun.updateMany({
        where: { id: params.runId, status: 'RUNNING' },
        data: {
          status: params.status,
          finishedAt: params.finishedAt,
          summary: params.summary ?? Prisma.DbNull,
          errorMessage: params.errorMessage ?? null,
        },
      });

      await tx.jobQueueState.update({
        where: { id: GLOBAL_QUEUE_STATE_ID },
        data: {
          activeRunId: null,
          cooldownUntil,
          version: { increment: 1 },
        },
      });

      if (params.message) {
        await tx.jobLogLine.create({
          data: {
            runId: params.runId,
            level: params.status === 'SUCCESS' ? 'info' : 'error',
            message: params.message,
            context: params.context ?? Prisma.DbNull,
          },
        });
      }

      if (updatedRun.count > 0 && durableHistoryRecord) {
        await tx.autoRunMediaHistory.upsert({
          where: {
            jobId_mediaFingerprint: {
              jobId: durableHistoryRecord.jobId,
              mediaFingerprint: durableHistoryRecord.mediaFingerprint,
            },
          },
          update: {},
          create: durableHistoryRecord,
        });
      }

      return updatedRun;
    });

    return runResult.count > 0;
  }

  private async refreshHeartbeat() {
    const now = new Date();
    const updated = await this.prisma.jobRun.updateMany({
      where: {
        status: 'RUNNING',
        workerId: this.workerId,
      },
      data: {
        heartbeatAt: now,
      },
    });
    if (updated.count > 0) {
      this.logQueueDecision('heartbeat', {
        workerId: this.workerId,
        count: updated.count,
      });
    }
  }

  private async recoverQueueOnStartup() {
    const now = new Date();
    const state = await this.ensureQueueState();
    const runningRuns = await this.prisma.jobRun.findMany({
      where: { status: 'RUNNING' },
      select: RUN_QUEUE_SELECT,
    });

    if (runningRuns.length) {
      const message =
        'Orphaned running job detected after restart; marking as FAILED.';
      await this.prisma.$transaction([
        this.prisma.jobRun.updateMany({
          where: { id: { in: runningRuns.map((run) => run.id) } },
          data: {
            status: 'FAILED',
            finishedAt: now,
            errorMessage: message,
          },
        }),
        this.prisma.jobLogLine.createMany({
          data: runningRuns.map((run) => ({
            runId: run.id,
            level: 'error',
            message,
            context: {
              reason: 'orphaned_running_after_restart',
              jobId: run.jobId,
              workerId: run.workerId,
            },
          })),
        }),
      ]);
      this.logQueueDecision('failed', {
        reason: 'startup_orphan_recovery',
        count: runningRuns.length,
      });
    }

    await this.prisma.jobRun.updateMany({
      where: {
        status: 'PENDING',
        OR: [
          { claimedAt: { not: null } },
          { heartbeatAt: { not: null } },
          { workerId: { not: null } },
        ],
      },
      data: {
        claimedAt: null,
        heartbeatAt: null,
        workerId: null,
      },
    });

    await this.prisma.jobQueueState.update({
      where: { id: GLOBAL_QUEUE_STATE_ID },
      data: {
        activeRunId: null,
        cooldownUntil:
          runningRuns.length > 0
            ? state.cooldownUntil &&
              state.cooldownUntil.getTime() > now.getTime()
              ? state.cooldownUntil
              : new Date(now.getTime() + QUEUE_COOLDOWN_MS)
            : state.cooldownUntil,
        version: { increment: 1 },
      },
    });
  }

  private async recoverStaleHeartbeatLease() {
    const state = await this.ensureQueueState();
    if (!state.activeRunId) return;

    const activeRun = await this.prisma.jobRun.findUnique({
      where: { id: state.activeRunId },
      select: RUN_QUEUE_SELECT,
    });
    if (!activeRun) {
      await this.prisma.jobQueueState.update({
        where: { id: GLOBAL_QUEUE_STATE_ID },
        data: {
          activeRunId: null,
          version: { increment: 1 },
        },
      });
      this.logQueueDecision('heartbeat_stale_recovered', {
        reason: 'missing_active_run',
      });
      return;
    }

    if (activeRun.status !== 'RUNNING') {
      await this.prisma.jobQueueState.update({
        where: { id: GLOBAL_QUEUE_STATE_ID },
        data: {
          activeRunId: null,
          version: { increment: 1 },
        },
      });
      return;
    }

    const leaseCutoff = Date.now() - JOB_QUEUE_HEARTBEAT_LEASE_MS;
    const heartbeatAt =
      activeRun.heartbeatAt?.getTime() ??
      activeRun.claimedAt?.getTime() ??
      activeRun.executionStartedAt?.getTime() ??
      0;
    if (heartbeatAt >= leaseCutoff) return;

    const finishedAt = new Date();
    const message =
      'Job heartbeat lease expired before completion; marking as FAILED.';
    const summary = asJsonObject(activeRun.summary) ?? null;

    await this.finalizeRunningRun({
      runId: activeRun.id,
      status: 'FAILED',
      finishedAt,
      summary,
      errorMessage: message,
      message: 'run: failed',
      context: {
        reason: 'heartbeat_stale',
        workerId: activeRun.workerId,
      },
    });
    this.logQueueDecision('heartbeat_stale_recovered', {
      runId: activeRun.id,
      workerId: activeRun.workerId,
    });
  }

  private async getActiveQueueRun() {
    const state = await this.ensureQueueState();
    if (!state.activeRunId) return null;
    return await this.prisma.jobRun.findUnique({
      where: { id: state.activeRunId },
      select: RUN_QUEUE_SELECT,
    });
  }

  private buildEstimateHistoryGroups(
    runs: QueueRunRecord[],
  ): EstimateHistoryGroups {
    const groups: EstimateHistoryGroups = new Map();
    for (const run of runs) {
      if (run.status === 'CANCELLED') continue;
      const durationMs = resolveRuntimeMs(run);
      if (durationMs === null) continue;
      const estimateKey = buildJobEstimateKey({
        jobId: run.jobId,
        dryRun: run.dryRun,
        input: asJsonObject(run.input) ?? null,
        summary: asJsonObject(run.summary) ?? null,
        trigger: run.trigger,
      });
      const existing = groups.get(estimateKey) ?? [];
      existing.push({
        estimateKey,
        status: run.status,
        durationMs,
        usesLegacyTiming: !run.executionStartedAt,
      });
      groups.set(estimateKey, existing);
    }
    return groups;
  }

  private resolveRunEstimate(
    run: Pick<
      QueueRunRecord,
      'jobId' | 'dryRun' | 'trigger' | 'input' | 'summary'
    >,
    groups: EstimateHistoryGroups,
  ): QueueEstimate {
    const definition = findJobDefinition(run.jobId);
    const estimateKey = buildJobEstimateKey({
      jobId: run.jobId,
      dryRun: run.dryRun,
      trigger: run.trigger,
      input: asJsonObject(run.input) ?? null,
      summary: asJsonObject(run.summary) ?? null,
    });
    const history = groups.get(estimateKey) ?? [];
    const successful = history
      .filter((entry) => entry.status === 'SUCCESS' && !entry.usesLegacyTiming)
      .slice(0, 5)
      .map((entry) => entry.durationMs);
    const terminal = history
      .filter((entry) => !entry.usesLegacyTiming)
      .slice(0, 5)
      .map((entry) => entry.durationMs);
    const legacy = history
      .filter((entry) => entry.usesLegacyTiming)
      .slice(0, 5)
      .map((entry) => entry.durationMs);

    const successMedian = median(successful);
    if (successMedian !== null) {
      return {
        estimatedRuntimeMs: successMedian,
        estimateSource: 'median_success',
        etaConfidence: estimateConfidence('median_success'),
      };
    }

    const terminalMedian = median(terminal);
    if (terminalMedian !== null) {
      return {
        estimatedRuntimeMs: terminalMedian,
        estimateSource: 'median_terminal',
        etaConfidence: estimateConfidence('median_terminal'),
      };
    }

    const legacyMedian = median(legacy);
    if (legacyMedian !== null) {
      return {
        estimatedRuntimeMs: legacyMedian,
        estimateSource: 'log_backfill',
        etaConfidence: estimateConfidence('log_backfill'),
      };
    }

    return {
      estimatedRuntimeMs: definition?.defaultEstimatedRuntimeMs ?? 10 * 60_000,
      estimateSource: 'job_default',
      etaConfidence: estimateConfidence('job_default'),
    };
  }

  private resolveActiveRemainingMs(
    run: QueueRunRecord,
    estimate: QueueEstimate | null,
    now: Date,
  ) {
    if (!estimate) return 0;
    const executionStartedAt = resolveExecutionStartedAt(run);
    if (!executionStartedAt) return estimate.estimatedRuntimeMs;
    const elapsedMs = Math.max(0, now.getTime() - executionStartedAt.getTime());
    return Math.max(0, estimate.estimatedRuntimeMs - elapsedMs);
  }

  private isDelayedActiveRun(
    run: QueueRunRecord,
    estimate: QueueEstimate | null,
    now: Date,
  ) {
    if (!estimate) return false;
    const executionStartedAt = resolveExecutionStartedAt(run);
    if (!executionStartedAt) return false;
    const elapsedMs = Math.max(0, now.getTime() - executionStartedAt.getTime());
    const threshold = Math.max(
      60_000,
      Math.round(estimate.estimatedRuntimeMs * 0.25),
    );
    return elapsedMs - estimate.estimatedRuntimeMs > threshold;
  }

  private resolvePendingEstimateState(params: {
    globalIndex: number;
    activeRunExists: boolean;
    activeRemainingMs: number;
    activeDelayed: boolean;
    cooldownRemainingMs: number;
  }): QueueEstimateState {
    if (
      !params.activeRunExists &&
      params.globalIndex === 0 &&
      params.cooldownRemainingMs > 0
    ) {
      return 'cooldown';
    }
    if (params.activeDelayed) return 'delayed';
    if (
      params.globalIndex === 0 &&
      params.activeRunExists &&
      params.activeRemainingMs <= 60_000
    ) {
      return 'finishing_soon';
    }
    return 'estimated';
  }

  private resolveBlockedReason(params: {
    paused: boolean;
    activeRunExists: boolean;
    hiddenBlockersAhead: boolean;
    globalIndex: number;
    cooldownRemainingMs: number;
  }): QueueBlockedReason | null {
    if (params.paused) return 'queue_paused';
    if (params.hiddenBlockersAhead) return 'hidden_blocker_ahead';
    if (params.activeRunExists) return 'waiting_for_active_run';
    if (params.globalIndex === 0 && params.cooldownRemainingMs > 0) {
      return 'cooldown';
    }
    return null;
  }

  private isPendingRunStalled(run: QueueRunRecord, now: Date) {
    const definition = findJobDefinition(run.jobId);
    const defaultEstimatedRuntimeMs =
      definition?.defaultEstimatedRuntimeMs ?? 10 * 60_000;
    const threshold = Math.max(30 * 60_000, 4 * defaultEstimatedRuntimeMs);
    return now.getTime() - resolveQueuedAt(run).getTime() > threshold;
  }

  private buildQueueFingerprint(params: {
    jobId: string;
    trigger: JobRunTrigger;
    dryRun: boolean;
    userId?: string | null;
    input?: JsonObject;
    summary?: JsonObject | null;
  }) {
    return buildJobQueueFingerprint({
      jobId: params.jobId,
      dryRun: params.dryRun,
      trigger: params.trigger,
      userId: params.userId ?? null,
      input: params.input ?? null,
      summary: params.summary ?? null,
    });
  }

  private serializeRun(run: SafeRunRecord | QueueRunRecord): SerializedRun {
    const definition = findJobDefinition(run.jobId);
    return {
      id: run.id,
      jobId: run.jobId,
      userId: run.userId,
      trigger: run.trigger,
      dryRun: run.dryRun,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      queuedAt: resolveQueuedAt(run).toISOString(),
      executionStartedAt: resolveExecutionStartedAt(run)?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      summary: sanitizeSummaryForClient(run.summary),
      errorMessage: run.errorMessage,
      jobName: definition?.name ?? run.jobId,
      rewindDisplayName:
        definition?.rewindDisplayName ?? definition?.name ?? run.jobId,
      visibleInTaskManager: definition?.visibleInTaskManager ?? true,
      visibleInRewind: definition?.visibleInRewind ?? true,
    };
  }

  private serializeQueueActiveRun(params: {
    run: QueueRunRecord;
    estimate: QueueEstimate | null;
    now: Date;
    userId: string;
    delayed: boolean;
  }): QueueSnapshotRun {
    const visible = this.isRunVisibleToUser(params.run, params.userId);
    const definition = findJobDefinition(params.run.jobId);
    const estimate =
      params.estimate ?? this.resolveRunEstimate(params.run, new Map());
    const serialized = this.serializeRun(params.run);
    const estimateState: QueueEstimateState = params.delayed
      ? 'delayed'
      : this.resolveActiveRemainingMs(params.run, estimate, params.now) <=
          60_000
        ? 'finishing_soon'
        : 'estimated';

    const base: QueueSnapshotRun = {
      ...serialized,
      queuePosition: 0,
      runsAheadTotal: 0,
      runsAheadVisible: 0,
      runsAheadHidden: 0,
      estimatedRuntimeMs: estimate.estimatedRuntimeMs,
      estimatedWaitMs: 0,
      estimatedStartAt:
        resolveExecutionStartedAt(params.run)?.toISOString() ??
        resolveQueuedAt(params.run).toISOString(),
      estimateSource: estimate.estimateSource,
      estimateState,
      etaConfidence: estimate.etaConfidence,
      blockedReason: null,
    };

    if (visible) return base;

    return {
      ...base,
      id: '',
      errorMessage: null,
      summary: null,
      jobName:
        definition?.rewindDisplayName ?? definition?.name ?? 'Internal task',
      rewindDisplayName:
        definition?.rewindDisplayName ?? definition?.name ?? 'Internal task',
      redacted: true,
    };
  }

  private isRunVisibleToUser(
    run: Pick<QueueRunRecord, 'jobId' | 'userId'>,
    userId: string,
  ) {
    if (run.userId !== userId) return false;
    const definition = findJobDefinition(run.jobId);
    return definition?.visibleInRewind ?? true;
  }

  private async ensureQueueState(
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<JobQueueState> {
    const existing = await client.jobQueueState.findUnique({
      where: { id: GLOBAL_QUEUE_STATE_ID },
    });
    if (existing) return existing;
    try {
      return await client.jobQueueState.create({
        data: { id: GLOBAL_QUEUE_STATE_ID },
      });
    } catch {
      const fallback = await client.jobQueueState.findUnique({
        where: { id: GLOBAL_QUEUE_STATE_ID },
      });
      if (!fallback) {
        throw new NotFoundException('Queue state row could not be created');
      }
      return fallback;
    }
  }

  private logQueueDecision(
    event: string,
    payload: Record<string, unknown>,
  ): void {
    const context = Object.entries(payload)
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      )
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    const message = `queue.${event}${context ? ` ${context}` : ''}`;
    if (event === 'heartbeat') {
      this.logger.debug(message);
      return;
    }
    this.logger.log(message);
  }
}
