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
type BackfillLegacyAutoRunSkippedReports = () => Promise<void>;

type EstimateHistoryGroups = Map<
  string,
  Array<{
    estimateKey: string;
    status: JobRunTrigger | 'SUCCESS' | 'FAILED' | 'CANCELLED';
    durationMs: number;
    usesLegacyTiming: boolean;
  }>
>;

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

function callBackfillLegacyAutoRunSkippedReports(service: JobsService) {
  const backfillLegacyAutoRunSkippedReports = (
    service as unknown as {
      backfillLegacyAutoRunSkippedReports: BackfillLegacyAutoRunSkippedReports;
    }
  ).backfillLegacyAutoRunSkippedReports;
  return backfillLegacyAutoRunSkippedReports.call(service);
}

function callBuildEstimateHistoryGroups(
  service: JobsService,
  runs: Array<Record<string, unknown>>,
) {
  const buildEstimateHistoryGroups = (
    service as unknown as {
      buildEstimateHistoryGroups: (
        runs: Array<Record<string, unknown>>,
      ) => EstimateHistoryGroups;
    }
  ).buildEstimateHistoryGroups;
  return buildEstimateHistoryGroups.call(service, runs);
}

function callResolveRunEstimate(
  service: JobsService,
  run: {
    jobId: string;
    dryRun: boolean;
    trigger: JobRunTrigger;
    input: Record<string, unknown> | null;
    summary: Record<string, unknown> | null;
  },
  groups: EstimateHistoryGroups,
) {
  const resolveRunEstimate = (
    service as unknown as {
      resolveRunEstimate: (
        run: typeof run,
        groups: EstimateHistoryGroups,
      ) => { estimatedRuntimeMs: number; estimateSource: string };
    }
  ).resolveRunEstimate;
  return resolveRunEstimate.call(service, run, groups);
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

function makeEpisodeRunInput(overrides?: Partial<Record<string, unknown>>) {
  const input = {
    source: 'plexPolling',
    plexUserId: 'plex-user-2',
    plexUserTitle: 'Alice',
    mediaType: 'episode',
    seedTitle: 'Lost',
    seedRatingKey: 'episode-1',
    showRatingKey: 'show-1',
    seasonNumber: 1,
    episodeNumber: 1,
    seedLibrarySectionId: 4,
    seedLibrarySectionTitle: 'TV Shows',
    ...(overrides ?? {}),
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

function makeFinishedRun(params: {
  runId: string;
  jobId: string;
  trigger: JobRunTrigger;
  status?: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  summary?: Record<string, unknown> | null;
}) {
  const now = new Date('2026-04-11T00:00:00.000Z');
  return {
    id: params.runId,
    jobId: params.jobId,
    userId: 'admin-user',
    trigger: params.trigger,
    dryRun: false,
    status: params.status ?? 'SUCCESS',
    startedAt: now,
    queuedAt: now,
    executionStartedAt: now,
    finishedAt: now,
    summary: params.summary ?? makeSuccessReport(true),
    errorMessage: null,
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

function makeRuntimeHistoryRun(params: {
  jobId: string;
  status?: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  startedAt: string;
  finishedAt: string;
}) {
  return {
    id: `${params.jobId}-${params.startedAt}`,
    jobId: params.jobId,
    userId: 'admin-user',
    trigger: 'schedule' as const,
    dryRun: false,
    status: params.status ?? 'SUCCESS',
    startedAt: new Date(params.startedAt),
    queuedAt: new Date(params.startedAt),
    executionStartedAt: new Date(params.startedAt),
    finishedAt: new Date(params.finishedAt),
    input: null,
    summary: null,
    errorMessage: null,
    queueFingerprint: null,
    claimedAt: null,
    heartbeatAt: null,
    workerId: null,
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

function getCreatedRunArg(tx: ReturnType<typeof makeService>['tx']) {
  const firstCall = tx.jobRun.create.mock.calls[0] as [unknown] | undefined;
  return firstCall?.[0] as
    | {
        data: Record<string, unknown>;
        select: Record<string, unknown>;
      }
    | undefined;
}

function makeService() {
  const tx = {
    jobRun: {
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
      return await callback(tx);
    }),
    jobSchedule: {
      findMany: jest.fn(),
    },
    jobRun: {
      findMany: jest.fn(),
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
  tx.jobRun.update.mockResolvedValue({});
  tx.jobQueueState.update.mockResolvedValue(makeQueueState());
  tx.jobLogLine.create.mockResolvedValue({});
  tx.autoRunMediaHistory.findUnique.mockResolvedValue(null);
  tx.autoRunMediaHistory.findFirst.mockResolvedValue(null);
  tx.autoRunMediaHistory.upsert.mockResolvedValue({ id: 'history-1' });
  prisma.jobSchedule.findMany.mockResolvedValue([]);
  prisma.jobRun.findMany.mockResolvedValue([]);
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

  it('uses one stable fingerprint for later episodes of the same show', () => {
    const firstInput = makeEpisodeRunInput({
      seedRatingKey: 'episode-1',
      episodeNumber: 1,
    });
    const laterEpisodeInput = makeEpisodeRunInput({
      seedRatingKey: 'episode-9',
      episodeNumber: 9,
      seasonNumber: 2,
    });
    const differentShowInput = makeEpisodeRunInput({
      seedTitle: 'Fringe',
      showRatingKey: 'show-2',
      seedRatingKey: 'episode-22',
    });

    expect(firstInput.autoRunMediaFingerprint).toBe(
      laterEpisodeInput.autoRunMediaFingerprint,
    );
    expect(firstInput.autoRunMediaFingerprint).not.toBe(
      differentShowInput.autoRunMediaFingerprint,
    );
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
      select: { id: true, seedTitle: true, firstRunId: true },
    });
    expect(tx.jobRun.create).not.toHaveBeenCalled();
  });

  it('blocks later episodes of the same show from legacy episode-level history rows', async () => {
    const { service, tx } = makeService();
    const input = makeEpisodeRunInput({
      seedRatingKey: 'episode-4',
      episodeNumber: 4,
    });
    tx.autoRunMediaHistory.findUnique.mockResolvedValue(null);
    tx.autoRunMediaHistory.findFirst.mockResolvedValueOnce({ id: 'history-1' });

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

    expect(tx.autoRunMediaHistory.findFirst).toHaveBeenCalledWith({
      where: {
        jobId: 'watchedMovieRecommendations',
        mediaType: 'episode',
        plexUserId: 'plex-user-2',
        librarySectionKey: '4',
        showRatingKey: 'show-1',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, seedTitle: true, firstRunId: true },
    });
    expect(tx.jobRun.create).not.toHaveBeenCalled();
  });

  it('falls back to show title when episode auto-run history lacks show ids', async () => {
    const { service, tx } = makeService();
    const input = makeEpisodeRunInput({
      showRatingKey: '',
      seedRatingKey: 'episode-6',
      episodeNumber: 6,
    });
    tx.autoRunMediaHistory.findUnique.mockResolvedValue(null);
    tx.autoRunMediaHistory.findFirst.mockResolvedValueOnce({ id: 'history-2' });

    await service
      .runJob({
        jobId: 'immaculateTastePoints',
        trigger: 'auto',
        dryRun: false,
        userId: 'admin-user',
        input,
      })
      .catch((error) => {
        expect(readConflictReason(error)).toBe('already_processed');
      });

    expect(tx.autoRunMediaHistory.findFirst).toHaveBeenCalledWith({
      where: {
        jobId: 'immaculateTastePoints',
        mediaType: 'episode',
        plexUserId: 'plex-user-2',
        librarySectionKey: '4',
        seedTitle: 'Lost',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, seedTitle: true, firstRunId: true },
    });
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

  it('records a visible skipped run for auto-run conflicts without durable history writes', async () => {
    const { service, tx } = makeService();
    const input = makeEpisodeRunInput({
      seedTitle: 'Rooster',
      showRatingKey: 'show-rooster',
      seedRatingKey: 'episode-3',
      episodeNumber: 3,
    });
    tx.jobRun.create.mockResolvedValue(
      makeFinishedRun({
        runId: 'skipped-run-1',
        jobId: 'watchedMovieRecommendations',
        trigger: 'auto',
      }),
    );

    const run = await service.recordAutoRunSkippedRun({
      jobId: 'watchedMovieRecommendations',
      trigger: 'auto',
      dryRun: false,
      userId: 'admin-user',
      input,
      reason: 'already_processed',
    });

    expect(run.status).toBe('SUCCESS');
    const createArg = getCreatedRunArg(tx);
    expect(createArg?.data['status']).toBe('SUCCESS');
    expect(createArg?.data['queueFingerprint']).toBeNull();
    expect(createArg?.data['summary']).toMatchObject({
      template: 'jobReportV1',
      version: 1,
      headline: 'Auto-run skipped because this show was already processed.',
      raw: {
        skipped: true,
        reason: 'already_processed',
        repeatScope: 'show',
        seedTitle: 'Rooster',
        previouslyProcessedTitle: null,
        previousAutoRunId: null,
      },
    });
    expect(tx.autoRunMediaHistory.upsert).not.toHaveBeenCalled();
  });

  it('includes the previously processed title in skipped auto-run reports when available', async () => {
    const { service, tx } = makeService();
    const input = makeEpisodeRunInput({
      seedTitle: 'Rooster',
      showRatingKey: 'show-rooster',
      seedRatingKey: 'episode-7',
      episodeNumber: 7,
    });
    tx.autoRunMediaHistory.findUnique.mockResolvedValue({
      id: 'history-rooster',
      seedTitle: 'Rooster',
      firstRunId: 'run-rooster-1',
    });
    tx.jobRun.create.mockResolvedValue(
      makeFinishedRun({
        runId: 'skipped-run-2',
        jobId: 'watchedMovieRecommendations',
        trigger: 'auto',
      }),
    );

    await service.recordAutoRunSkippedRun({
      jobId: 'watchedMovieRecommendations',
      trigger: 'auto',
      dryRun: false,
      userId: 'admin-user',
      input,
      reason: 'already_processed',
    });

    const createArg = getCreatedRunArg(tx);
    expect(createArg?.data['summary']).toMatchObject({
      issues: [
        {
          level: 'warn',
          message:
            'Skipped because this show already completed this Plex-triggered auto-run before. Previously processed show: Rooster.',
        },
      ],
      raw: {
        previouslyProcessedTitle: 'Rooster',
        previousAutoRunId: 'run-rooster-1',
      },
    });
    const summary = createArg?.data['summary'];
    expect(summary).toBeTruthy();
    expect(summary).not.toBeNull();
    expect(typeof summary).toBe('object');
    expect(Array.isArray(summary)).toBe(false);
    const taskList = (summary as Record<string, unknown>)['tasks'];
    const tasks = Array.isArray(taskList) ? taskList : [];
    const autoRunTask = tasks.find((task) => {
      if (!task || typeof task !== 'object' || Array.isArray(task))
        return false;
      return (task as Record<string, unknown>)['id'] === 'auto_run_dedupe';
    }) as Record<string, unknown> | undefined;
    expect(autoRunTask).toBeDefined();
    expect(autoRunTask?.['facts']).toEqual(
      expect.arrayContaining([
        {
          label: 'Previously processed title',
          value: 'Rooster',
        },
        {
          label: 'Previous auto-run id',
          value: 'run-rooster-1',
        },
      ]),
    );
    expect(tx.autoRunMediaHistory.upsert).not.toHaveBeenCalled();
  });

  it('backfills older already-processed skipped reports with the previous title', async () => {
    const { service, tx, prisma } = makeService();
    const input = makeEpisodeRunInput({
      seedTitle: 'Rooster',
      showRatingKey: 'show-rooster',
      seedRatingKey: 'episode-9',
      episodeNumber: 9,
    });
    const legacySummary = {
      template: 'jobReportV1' as const,
      version: 1 as const,
      jobId: 'watchedMovieRecommendations',
      dryRun: false,
      trigger: 'auto' as const,
      headline: 'Auto-run skipped because this show was already processed.',
      sections: [],
      tasks: [],
      issues: [
        {
          level: 'warn' as const,
          message:
            'Skipped because this show already completed this Plex-triggered auto-run before.',
        },
      ],
      raw: {
        skipped: true,
        reason: 'already_processed',
        mediaType: 'episode',
        repeatScope: 'show',
        plexUserId: 'plex-user-2',
        plexUserTitle: 'Alice',
        seedTitle: 'Rooster',
        seedLibrarySectionId: '4',
        seedLibrarySectionTitle: 'TV Shows',
      },
    };
    prisma.jobRun.findMany.mockResolvedValue([
      {
        ...makeFinishedRun({
          runId: 'legacy-skip-run-1',
          jobId: 'watchedMovieRecommendations',
          trigger: 'auto',
          summary: legacySummary,
        }),
        input,
        queueFingerprint: null,
        claimedAt: null,
        heartbeatAt: null,
        workerId: null,
      },
    ]);
    tx.autoRunMediaHistory.findUnique.mockResolvedValue({
      id: 'history-rooster',
      seedTitle: 'Rooster',
      firstRunId: 'run-rooster-1',
    });

    await callBackfillLegacyAutoRunSkippedReports(service);

    const updateCall = tx.jobRun.update.mock.calls[0] as
      | [
          {
            where: { id: string };
            data: { summary: Record<string, unknown> };
          },
        ]
      | undefined;
    expect(updateCall?.[0].where).toEqual({ id: 'legacy-skip-run-1' });
    expect(updateCall?.[0].data.summary).toMatchObject({
      issues: [
        {
          level: 'warn',
          message:
            'Skipped because this show already completed this Plex-triggered auto-run before. Previously processed show: Rooster.',
        },
      ],
      raw: {
        previouslyProcessedTitle: 'Rooster',
        previousAutoRunId: 'run-rooster-1',
      },
    });
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

  it('returns live runtime insights for schedulable jobs from successful history', async () => {
    const { service, prisma } = makeService();
    prisma.jobSchedule.findMany.mockResolvedValue([
      {
        jobId: 'arrMonitoredSearch',
        cron: '0 5 * * 0',
        enabled: true,
        timezone: null,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    prisma.jobRun.findMany.mockImplementation(
      ({ where }: { where?: { jobId?: string } }) => {
        if (where?.jobId === 'arrMonitoredSearch') {
          return [
            makeRuntimeHistoryRun({
              jobId: 'arrMonitoredSearch',
              startedAt: '2026-04-27T05:00:00.000Z',
              finishedAt: '2026-04-27T05:10:00.000Z',
            }),
            makeRuntimeHistoryRun({
              jobId: 'arrMonitoredSearch',
              startedAt: '2026-04-20T05:00:00.000Z',
              finishedAt: '2026-04-20T05:20:00.000Z',
            }),
            makeRuntimeHistoryRun({
              jobId: 'arrMonitoredSearch',
              startedAt: '2026-04-13T05:00:00.000Z',
              finishedAt: '2026-04-13T06:00:00.000Z',
            }),
          ];
        }
        return [];
      },
    );

    const jobs = await service.listJobsWithSchedules();
    const searchJob = jobs.find((job) => job.id === 'arrMonitoredSearch');
    const cleanupJob = jobs.find((job) => job.id === 'mediaAddedCleanup');

    expect(searchJob?.runtimeInsights).toMatchObject({
      estimatedRuntimeMs: 60 * 60_000,
      estimateSource: 'max_success',
      successfulRunCount: 3,
      maxSuccessfulRuntimeMs: 60 * 60_000,
      medianSuccessfulRuntimeMs: 20 * 60_000,
      minimumScheduleSpacingMs: 61 * 60_000,
      preferredScheduleSpacingMs: 121 * 60_000,
    });
    expect(searchJob?.schedule?.cron).toBe('0 5 * * 0');
    expect(cleanupJob?.runtimeInsights).toBeNull();
  });

  it('uses the max successful runtime for scheduled queue ETA sizing', () => {
    const { service } = makeService();
    const history = [
      makeRuntimeHistoryRun({
        jobId: 'arrMonitoredSearch',
        startedAt: '2026-04-27T05:00:00.000Z',
        finishedAt: '2026-04-27T05:10:00.000Z',
      }),
      makeRuntimeHistoryRun({
        jobId: 'arrMonitoredSearch',
        startedAt: '2026-04-20T05:00:00.000Z',
        finishedAt: '2026-04-20T05:20:00.000Z',
      }),
      makeRuntimeHistoryRun({
        jobId: 'arrMonitoredSearch',
        startedAt: '2026-04-13T05:00:00.000Z',
        finishedAt: '2026-04-13T06:00:00.000Z',
      }),
    ];

    const groups = callBuildEstimateHistoryGroups(
      service,
      history as Array<Record<string, unknown>>,
    );
    const estimate = callResolveRunEstimate(
      service,
      {
        jobId: 'arrMonitoredSearch',
        dryRun: false,
        trigger: 'schedule',
        input: null,
        summary: null,
      },
      groups,
    );

    expect(estimate).toMatchObject({
      estimatedRuntimeMs: 60 * 60_000,
      estimateSource: 'max_success',
    });
  });
});
