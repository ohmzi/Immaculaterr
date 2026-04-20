import { ConflictException } from '@nestjs/common';
import type { JobRunTrigger } from '@prisma/client';
import { buildAutoRunMediaFingerprint } from './auto-run-media';
import { JobsService } from './jobs.service';

type RunInput = ReturnType<typeof makeRunInput>;

type JobsServiceForSpies = {
  ensureQueueState: () => Promise<unknown>;
  scheduleQueuePump: (reason: string) => Promise<void>;
};

type FinalizeRunningRun = (params: {
  runId: string;
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  finishedAt: Date;
  summary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  runContext?: {
    jobId: string;
    trigger: JobRunTrigger;
    dryRun: boolean;
    input?: RunInput | null;
  };
}) => Promise<boolean>;

type FinalizeRunningRunParams = Parameters<FinalizeRunningRun>[0];

function callFinalizeRunningRun(
  service: JobsService,
  params: FinalizeRunningRunParams,
) {
  const finalizeRunningRun = (
    service as unknown as { finalizeRunningRun: FinalizeRunningRun }
  ).finalizeRunningRun;
  return finalizeRunningRun.call(service, params);
}

function callCreateJobContext(
  service: JobsService,
  params: {
    run: ReturnType<typeof makeCreatedRun>;
    input?: RunInput;
  },
) {
  const createJobContext = (
    service as unknown as {
      createJobContext: (params: {
        run: ReturnType<typeof makeCreatedRun>;
        input?: RunInput;
      }) => {
        ctx: {
          patchSummary: (patch: Record<string, unknown>) => Promise<void>;
          setSummary: (
            summary: Record<string, unknown> | null,
          ) => Promise<void>;
        };
        awaitSummaryWrites: () => Promise<void>;
      };
    }
  ).createJobContext;
  return createJobContext.call(service, params);
}

function getPersistedSummary(
  prisma: ReturnType<typeof makeService>['prisma'],
  callIndex = 0,
) {
  const call = prisma.jobRun.update.mock.calls[callIndex] as
    | [
        {
          data: {
            summary: Record<string, unknown> | null;
          };
        },
      ]
    | undefined;
  return call?.[0].data.summary ?? null;
}

type JobsServicePrivate = JobsServiceForSpies & {
  finalizeRunningRun: (params: {
    runId: string;
    status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
    finishedAt: Date;
    summary?: Record<string, unknown> | null;
    errorMessage?: string | null;
    runContext?: {
      jobId: string;
      trigger: JobRunTrigger;
      dryRun: boolean;
      input?: RunInput | null;
    };
  }) => Promise<boolean>;
};

function makeQueueState() {
  return {
    id: 'global',
    activeRunId: null,
    cooldownUntil: null,
    paused: false,
    pauseReason: null,
    version: 0,
    updatedAt: new Date('2026-04-11T00:00:00.000Z'),
  };
}

function makeRunInput() {
  const input = {
    source: 'plexPolling',
    plexUserId: 'plex-user-2',
    plexUserTitle: 'Alice',
    mediaType: 'movie',
    seedTitle: 'Inception',
    seedYear: 2010,
    seedRatingKey: 'movie-1',
    seedLibrarySectionId: 1,
    seedLibrarySectionTitle: 'Movies',
  };
  const autoRunMediaFingerprint = buildAutoRunMediaFingerprint(input);
  if (!autoRunMediaFingerprint) {
    throw new Error('Expected a stable auto-run media fingerprint');
  }

  return {
    ...input,
    autoRunMediaFingerprint,
  };
}

function makeCreatedRun(params: {
  jobId: string;
  trigger: JobRunTrigger;
  input: RunInput;
}) {
  const now = new Date('2026-04-11T00:00:00.000Z');
  return {
    id: 'run-1',
    jobId: params.jobId,
    userId: 'admin-user',
    trigger: params.trigger,
    dryRun: false,
    status: 'PENDING',
    startedAt: now,
    queuedAt: now,
    executionStartedAt: null,
    finishedAt: null,
    summary: { phase: 'queued' },
    errorMessage: null,
    input: params.input,
    queueFingerprint: `${params.jobId}|media:${params.input.autoRunMediaFingerprint}|dryRun:0`,
    claimedAt: null,
    heartbeatAt: null,
    workerId: null,
  };
}

function makeSuccessReport(skipped = false) {
  return {
    template: 'jobReportV1' as const,
    version: 1 as const,
    jobId: 'watchedMovieRecommendations',
    dryRun: false,
    trigger: 'auto' as const,
    headline: skipped ? 'Skipped.' : 'Completed.',
    sections: [],
    tasks: [],
    issues: [],
    raw: skipped ? { skipped: true, reason: 'library_excluded' } : { ok: true },
  };
}

function readConflictReason(error: unknown): string | null {
  if (!(error instanceof ConflictException)) return null;
  const response = error.getResponse();
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return null;
  }
  const reason = (response as Record<string, unknown>)['reason'];
  return typeof reason === 'string' ? reason : null;
}

function getAutoRunHistoryUpsertArg(tx: ReturnType<typeof makeService>['tx']) {
  const firstCall = tx.autoRunMediaHistory.upsert.mock.calls[0] as
    | [unknown]
    | undefined;
  return firstCall?.[0] as
    | {
        where: {
          jobId_mediaFingerprint: {
            jobId: string;
            mediaFingerprint: string;
          };
        };
        update: Record<string, never>;
        create: Record<string, unknown>;
      }
    | undefined;
}

function makeService() {
  const tx = {
    jobRun: {
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    jobQueueState: {
      update: jest.fn(),
    },
    jobLogLine: {
      create: jest.fn(),
    },
    autoRunMediaHistory: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
      return await callback(tx);
    }),
    jobRun: {
      update: jest.fn(),
    },
    jobLogLine: {
      create: jest.fn(),
    },
  };

  const handlers = {
    run: jest.fn(),
  };

  const service = new JobsService(prisma as never, handlers as never);
  const privateService = service as unknown as JobsServicePrivate;
  tx.jobRun.count.mockResolvedValue(0);
  tx.jobRun.findFirst.mockResolvedValue(null);
  tx.jobQueueState.update.mockResolvedValue(makeQueueState());
  tx.jobLogLine.create.mockResolvedValue({});
  tx.autoRunMediaHistory.findUnique.mockResolvedValue(null);
  tx.autoRunMediaHistory.upsert.mockResolvedValue({ id: 'history-1' });
  prisma.jobRun.update.mockResolvedValue({});
  prisma.jobLogLine.create.mockResolvedValue({});
  jest
    .spyOn(privateService, 'ensureQueueState')
    .mockResolvedValue(makeQueueState());
  jest.spyOn(privateService, 'scheduleQueuePump').mockResolvedValue(undefined);

  return {
    service,
    tx,
    prisma,
  };
}

describe('JobsService durable auto-run media dedupe', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('blocks auto enqueue when a durable media history record already exists', async () => {
    const { service, tx } = makeService();
    const input = makeRunInput();
    tx.autoRunMediaHistory.findUnique.mockResolvedValue({ id: 'history-1' });

    await service
      .runJob({
        jobId: 'watchedMovieRecommendations',
        trigger: 'auto',
        dryRun: false,
        userId: 'admin-user',
        input,
      })
      .catch((error) => {
        expect(error).toBeInstanceOf(ConflictException);
        expect(readConflictReason(error)).toBe('already_processed');
      });

    expect(tx.autoRunMediaHistory.findUnique).toHaveBeenCalledWith({
      where: {
        jobId_mediaFingerprint: {
          jobId: 'watchedMovieRecommendations',
          mediaFingerprint: input.autoRunMediaFingerprint,
        },
      },
      select: { id: true },
    });
    expect(tx.jobRun.create).not.toHaveBeenCalled();
  });

  it('writes a durable history record only after a successful non-skipped auto run', async () => {
    const { service, tx } = makeService();
    const input = makeRunInput();
    tx.jobRun.updateMany.mockResolvedValue({ count: 1 });

    const finalized = await callFinalizeRunningRun(service, {
      runId: 'run-1',
      status: 'SUCCESS',
      finishedAt: new Date('2026-04-11T00:05:00.000Z'),
      summary: makeSuccessReport(false),
      errorMessage: null,
      runContext: {
        jobId: 'watchedMovieRecommendations',
        trigger: 'auto',
        dryRun: false,
        input,
      },
    });

    expect(finalized).toBe(true);
    const upsertArg = getAutoRunHistoryUpsertArg(tx);
    expect(upsertArg).toMatchObject({
      where: {
        jobId_mediaFingerprint: {
          jobId: 'watchedMovieRecommendations',
          mediaFingerprint: input.autoRunMediaFingerprint,
        },
      },
      update: {},
    });
    expect(upsertArg?.create['jobId']).toBe('watchedMovieRecommendations');
    expect(upsertArg?.create['mediaFingerprint']).toBe(
      input.autoRunMediaFingerprint,
    );
    expect(upsertArg?.create['plexUserId']).toBe('plex-user-2');
    expect(upsertArg?.create['mediaType']).toBe('movie');
    expect(upsertArg?.create['librarySectionKey']).toBe('1');
    expect(upsertArg?.create['seedRatingKey']).toBe('movie-1');
    expect(upsertArg?.create['seedTitle']).toBe('Inception');
    expect(upsertArg?.create['seedYear']).toBe(2010);
    expect(upsertArg?.create['source']).toBe('plexPolling');
    expect(upsertArg?.create['firstRunId']).toBe('run-1');
  });

  it('does not write a durable history record for failed or skipped auto runs', async () => {
    const { service, tx } = makeService();
    const input = makeRunInput();
    tx.jobRun.updateMany.mockResolvedValue({ count: 1 });

    await callFinalizeRunningRun(service, {
      runId: 'run-failed',
      status: 'FAILED',
      finishedAt: new Date('2026-04-11T00:05:00.000Z'),
      summary: makeSuccessReport(false),
      errorMessage: 'boom',
      runContext: {
        jobId: 'watchedMovieRecommendations',
        trigger: 'auto',
        dryRun: false,
        input,
      },
    });
    await callFinalizeRunningRun(service, {
      runId: 'run-skipped',
      status: 'SUCCESS',
      finishedAt: new Date('2026-04-11T00:06:00.000Z'),
      summary: makeSuccessReport(true),
      errorMessage: null,
      runContext: {
        jobId: 'watchedMovieRecommendations',
        trigger: 'auto',
        dryRun: false,
        input,
      },
    });

    expect(tx.autoRunMediaHistory.upsert).not.toHaveBeenCalled();
  });

  it('still returns already_queued_or_running for pending or running duplicates', async () => {
    const { service, tx } = makeService();
    const input = makeRunInput();
    tx.jobRun.findFirst.mockResolvedValue({ id: 'existing-run' });

    await service
      .runJob({
        jobId: 'watchedMovieRecommendations',
        trigger: 'auto',
        dryRun: false,
        userId: 'admin-user',
        input,
      })
      .catch((error) => {
        expect(readConflictReason(error)).toBe('already_queued_or_running');
      });
  });

  it('ignores the durable history record for manual runs', async () => {
    const { service, tx } = makeService();
    const input = makeRunInput();
    tx.jobRun.create.mockResolvedValue(
      makeCreatedRun({
        jobId: 'watchedMovieRecommendations',
        trigger: 'manual',
        input,
      }),
    );

    const run = await service.runJob({
      jobId: 'watchedMovieRecommendations',
      trigger: 'manual',
      dryRun: false,
      userId: 'admin-user',
      input,
    });

    expect(run.status).toBe('PENDING');
    expect(tx.autoRunMediaHistory.findUnique).not.toHaveBeenCalled();
    expect(tx.jobRun.create).toHaveBeenCalled();
  });

  it('coalesces rapid same-step summary patches into a single deferred write', async () => {
    jest.useFakeTimers();
    const { service, prisma } = makeService();
    const input = makeRunInput();
    const run = makeCreatedRun({
      jobId: 'importNetflixHistory',
      trigger: 'manual',
      input,
    });
    const { ctx } = callCreateJobContext(service, {
      run,
      input,
    });

    await ctx.patchSummary({
      progress: {
        step: 'phase1_classification',
        current: 1,
        total: 10,
        updatedAt: '2026-04-20T12:00:00.000Z',
      },
    });
    expect(prisma.jobRun.update).toHaveBeenCalledTimes(1);

    prisma.jobRun.update.mockClear();

    await ctx.patchSummary({
      progress: {
        step: 'phase1_classification',
        current: 2,
        total: 10,
        updatedAt: '2026-04-20T12:00:01.000Z',
      },
    });
    await ctx.patchSummary({
      progress: {
        step: 'phase1_classification',
        current: 3,
        total: 10,
        updatedAt: '2026-04-20T12:00:02.000Z',
      },
    });

    expect(prisma.jobRun.update).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(prisma.jobRun.update).toHaveBeenCalledTimes(1);
    expect(prisma.jobRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: run.id },
      }),
    );
    const summary = getPersistedSummary(prisma);
    const progress = (summary?.['progress'] as Record<string, unknown>) ?? null;
    expect(progress).toMatchObject({
      step: 'phase1_classification',
      current: 3,
      total: 10,
    });
  });

  it('flushes the latest debounced summary before finishing a run', async () => {
    jest.useFakeTimers();
    const { service, prisma } = makeService();
    const input = makeRunInput();
    const run = makeCreatedRun({
      jobId: 'importNetflixHistory',
      trigger: 'manual',
      input,
    });
    const { ctx, awaitSummaryWrites } = callCreateJobContext(service, {
      run,
      input,
    });

    await ctx.patchSummary({
      progress: {
        step: 'phase1_classification',
        current: 1,
        total: 10,
        updatedAt: '2026-04-20T12:00:00.000Z',
      },
    });
    prisma.jobRun.update.mockClear();

    await ctx.patchSummary({
      progress: {
        step: 'phase1_classification',
        current: 4,
        total: 10,
        updatedAt: '2026-04-20T12:00:03.000Z',
      },
    });
    expect(prisma.jobRun.update).not.toHaveBeenCalled();

    await awaitSummaryWrites();

    expect(prisma.jobRun.update).toHaveBeenCalledTimes(1);
    expect(prisma.jobRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: run.id },
      }),
    );
    const summary = getPersistedSummary(prisma);
    const progress = (summary?.['progress'] as Record<string, unknown>) ?? null;
    expect(progress).toMatchObject({
      step: 'phase1_classification',
      current: 4,
      total: 10,
    });
  });
});
