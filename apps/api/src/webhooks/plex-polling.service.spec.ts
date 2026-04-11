import { ConflictException } from '@nestjs/common';
import { PlexPollingService } from './plex-polling.service';

type InternalPlexPollingService = {
  maybeTriggerWatchedAutomation(args: {
    userId: string;
    snap: Record<string, unknown>;
    settings: Record<string, unknown>;
    reason: string;
  }): Promise<Record<string, unknown>>;
};

function makeAlreadyProcessedConflict() {
  return new ConflictException({
    reason: 'already_processed',
    message: 'Job already processed for this media.',
  });
}

function makeService() {
  const authService = {
    getFirstAdminUserId: jest.fn(),
  };
  const settingsService = {
    getInternalSettings: jest.fn(),
  };
  const jobsService = {
    runJob: jest.fn(),
  };
  const plexServer = {
    listNowPlayingSessions: jest.fn(),
    listRecentlyAdded: jest.fn(),
    listRecentlyAddedForSectionKey: jest.fn(),
  };
  const plexUsers = {
    resolvePlexUser: jest.fn(),
  };
  const webhooksService = {
    persistPlexWebhookEvent: jest.fn(),
    logPlexWebhookSummary: jest.fn(),
    logPlexWebhookAutomation: jest.fn(),
    logPlexUserMonitoringSkipped: jest.fn(),
  };
  const plexAnalytics = {
    invalidateLibraryGrowth: jest.fn(),
  };

  const service = new PlexPollingService(
    authService as never,
    settingsService as never,
    jobsService as never,
    plexServer as never,
    plexUsers as never,
    webhooksService as never,
    plexAnalytics as never,
  );

  webhooksService.persistPlexWebhookEvent.mockResolvedValue({
    path: '/tmp/polling-webhook.json',
  });

  return {
    service,
    jobsService,
    plexUsers,
    webhooksService,
  };
}

function makeSettings(overrides?: Record<string, unknown>) {
  return {
    jobs: {
      webhookEnabled: {
        watchedMovieRecommendations: true,
        immaculateTastePoints: true,
      },
    },
    ...(overrides ?? {}),
  };
}

function makeMovieSnap(
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  const now = Date.now();
  return {
    sessionKey: 'session-1',
    type: 'movie',
    ratingKey: 'movie-1',
    title: 'Inception',
    year: 2010,
    grandparentTitle: null,
    grandparentRatingKey: null,
    parentIndex: null,
    index: null,
    librarySectionId: 1,
    librarySectionTitle: 'Movies',
    viewOffsetMs: 95_000,
    durationMs: 100_000,
    userTitle: 'Alice',
    userId: 2,
    firstSeenAtMs: now,
    lastSeenAtMs: now,
    firstViewOffsetMs: 95_000,
    lastViewOffsetMs: 95_000,
    watchedTriggered: false,
    watchedTriggeredAtMs: null,
    immaculateTriggered: false,
    immaculateTriggeredAtMs: null,
    ...(overrides ?? {}),
  };
}

function makeEpisodeSnap(
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  const now = Date.now();
  return {
    sessionKey: 'session-episode-1',
    type: 'episode',
    ratingKey: 'episode-1',
    title: 'Pilot',
    year: null,
    grandparentTitle: 'Lost',
    grandparentRatingKey: 'show-1',
    parentIndex: 1,
    index: 1,
    librarySectionId: 4,
    librarySectionTitle: 'TV Shows',
    viewOffsetMs: 95_000,
    durationMs: 100_000,
    userTitle: 'Alice',
    userId: 2,
    firstSeenAtMs: now,
    lastSeenAtMs: now,
    firstViewOffsetMs: 95_000,
    lastViewOffsetMs: 95_000,
    watchedTriggered: false,
    watchedTriggeredAtMs: null,
    immaculateTriggered: false,
    immaculateTriggeredAtMs: null,
    ...(overrides ?? {}),
  };
}

function getRunJobFingerprint(
  jobsService: { runJob: jest.Mock },
  callIndex: number,
): string {
  const call = jobsService.runJob.mock.calls[callIndex] as [
    { input: { autoRunMediaFingerprint: string } },
  ];
  return call[0].input.autoRunMediaFingerprint;
}

describe('PlexPollingService user monitoring exclusion', () => {
  it('logs skip only once per session when user is excluded', async () => {
    const { service, jobsService, plexUsers, webhooksService } = makeService();
    const internalService = service as unknown as InternalPlexPollingService;
    plexUsers.resolvePlexUser.mockResolvedValue({
      id: 'plex-user-2',
      plexAccountTitle: 'Alice',
    });

    const settings = makeSettings({
      plex: {
        userMonitoring: {
          excludedPlexUserIds: ['plex-user-2'],
        },
      },
    });

    const snap = makeMovieSnap();

    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap,
      settings,
      reason: 'progress',
    });
    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap,
      settings,
      reason: 'progress',
    });

    expect(jobsService.runJob).not.toHaveBeenCalled();
    expect(webhooksService.logPlexUserMonitoringSkipped).toHaveBeenCalledTimes(
      1,
    );
    expect(webhooksService.logPlexWebhookAutomation).toHaveBeenCalledTimes(1);
  });
});

describe('PlexPollingService durable auto-run dedupe', () => {
  it('skips both target jobs as already_processed for the same movie on a later session', async () => {
    const { service, jobsService, plexUsers, webhooksService } = makeService();
    const internalService = service as unknown as InternalPlexPollingService;
    plexUsers.resolvePlexUser.mockResolvedValue({
      id: 'plex-user-2',
      plexAccountTitle: 'Alice',
    });
    jobsService.runJob
      .mockResolvedValueOnce({ id: 'watched-run-1' })
      .mockResolvedValueOnce({ id: 'immaculate-run-1' })
      .mockRejectedValueOnce(makeAlreadyProcessedConflict())
      .mockRejectedValueOnce(makeAlreadyProcessedConflict());

    const settings = makeSettings();

    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap: makeMovieSnap({ sessionKey: 'session-1' }),
      settings,
      reason: 'progress',
    });
    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap: makeMovieSnap({ sessionKey: 'session-2' }),
      settings,
      reason: 'progress',
    });

    expect(jobsService.runJob).toHaveBeenCalledTimes(4);
    const firstFingerprint = getRunJobFingerprint(jobsService, 0);
    const secondFingerprint = getRunJobFingerprint(jobsService, 2);
    expect(firstFingerprint).toBe(secondFingerprint);
    expect(webhooksService.logPlexWebhookAutomation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skipped: {
          watchedMovieRecommendations: 'already_processed',
          immaculateTastePoints: 'already_processed',
        },
      }),
    );
  });

  it('skips a repeated episode but still runs a different episode of the same show', async () => {
    const { service, jobsService, plexUsers } = makeService();
    const internalService = service as unknown as InternalPlexPollingService;
    plexUsers.resolvePlexUser.mockResolvedValue({
      id: 'plex-user-2',
      plexAccountTitle: 'Alice',
    });
    jobsService.runJob
      .mockResolvedValueOnce({ id: 'watched-run-1' })
      .mockResolvedValueOnce({ id: 'immaculate-run-1' })
      .mockRejectedValueOnce(makeAlreadyProcessedConflict())
      .mockRejectedValueOnce(makeAlreadyProcessedConflict())
      .mockResolvedValueOnce({ id: 'watched-run-2' })
      .mockResolvedValueOnce({ id: 'immaculate-run-2' });

    const settings = makeSettings();

    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap: makeEpisodeSnap({
        sessionKey: 'episode-session-1',
        ratingKey: 'episode-1',
        parentIndex: 1,
        index: 1,
      }),
      settings,
      reason: 'progress',
    });
    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap: makeEpisodeSnap({
        sessionKey: 'episode-session-2',
        ratingKey: 'episode-1',
        parentIndex: 1,
        index: 1,
      }),
      settings,
      reason: 'progress',
    });
    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap: makeEpisodeSnap({
        sessionKey: 'episode-session-3',
        ratingKey: 'episode-2',
        title: 'Tabula Rasa',
        parentIndex: 1,
        index: 2,
      }),
      settings,
      reason: 'progress',
    });

    expect(jobsService.runJob).toHaveBeenCalledTimes(6);
    const firstFingerprint = getRunJobFingerprint(jobsService, 0);
    const repeatedFingerprint = getRunJobFingerprint(jobsService, 2);
    const differentEpisodeFingerprint = getRunJobFingerprint(jobsService, 4);
    expect(firstFingerprint).toBe(repeatedFingerprint);
    expect(firstFingerprint).not.toBe(differentEpisodeFingerprint);
  });

  it('still runs the same title for a different Plex user or a different library', async () => {
    const { service, jobsService, plexUsers } = makeService();
    const internalService = service as unknown as InternalPlexPollingService;
    plexUsers.resolvePlexUser
      .mockResolvedValueOnce({
        id: 'plex-user-2',
        plexAccountTitle: 'Alice',
      })
      .mockResolvedValueOnce({
        id: 'plex-user-3',
        plexAccountTitle: 'Bob',
      })
      .mockResolvedValueOnce({
        id: 'plex-user-2',
        plexAccountTitle: 'Alice',
      });
    jobsService.runJob.mockResolvedValue({ id: 'run-ok' });

    const settings = makeSettings();

    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap: makeMovieSnap({ sessionKey: 'user-a-library-1', userId: 2 }),
      settings,
      reason: 'progress',
    });
    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap: makeMovieSnap({
        sessionKey: 'user-b-library-1',
        userId: 3,
        userTitle: 'Bob',
      }),
      settings,
      reason: 'progress',
    });
    await internalService.maybeTriggerWatchedAutomation({
      userId: 'admin',
      snap: makeMovieSnap({
        sessionKey: 'user-a-library-2',
        librarySectionId: 2,
        librarySectionTitle: 'Movies 2',
      }),
      settings,
      reason: 'progress',
    });

    expect(jobsService.runJob).toHaveBeenCalledTimes(6);
    const baseFingerprint = getRunJobFingerprint(jobsService, 0);
    const differentUserFingerprint = getRunJobFingerprint(jobsService, 2);
    const differentLibraryFingerprint = getRunJobFingerprint(jobsService, 4);
    expect(baseFingerprint).not.toBe(differentUserFingerprint);
    expect(baseFingerprint).not.toBe(differentLibraryFingerprint);
  });
});
