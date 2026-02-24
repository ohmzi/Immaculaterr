import { PlexPollingService } from './plex-polling.service';

type InternalPlexPollingService = {
  maybeTriggerWatchedAutomation(args: {
    userId: string;
    snap: Record<string, unknown>;
    settings: Record<string, unknown>;
    reason: string;
  }): Promise<void>;
  flushPendingCollectionRuns(args: {
    plexUserId: string;
    settings: Record<string, unknown>;
  }): Promise<void>;
  pendingCollectionRunsByPlexUser: Map<string, Array<Record<string, unknown>>>;
};

describe('PlexPollingService user monitoring exclusion', () => {
  function makeService() {
    const authService = {
      getFirstAdminUserId: jest.fn(),
    };
    const settingsService = {
      getInternalSettings: jest.fn(),
    };
    const jobsService = {
      runJob: jest.fn(),
      queueJob: jest.fn(),
      startQueuedJob: jest.fn(),
      failQueuedJob: jest.fn(),
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

    return {
      service,
      jobsService,
      plexUsers,
      webhooksService,
    };
  }

  it('logs skip only once per session when user is excluded', async () => {
    const { service, jobsService, plexUsers, webhooksService } = makeService();
    const internalService = service as unknown as InternalPlexPollingService;
    plexUsers.resolvePlexUser.mockResolvedValue({
      id: 'plex-user-2',
      plexAccountTitle: 'Alice',
    });

    const now = Date.now();
    const snap = {
      sessionKey: 's1',
      type: 'movie',
      ratingKey: 'rk-1',
      title: 'Inception',
      year: 2010,
      grandparentTitle: null,
      grandparentRatingKey: null,
      parentIndex: null,
      index: null,
      librarySectionId: 1,
      librarySectionTitle: 'Movies',
      viewOffsetMs: 70_000,
      durationMs: 100_000,
      userTitle: 'Alice',
      userId: 2,
      firstSeenAtMs: now,
      lastSeenAtMs: now,
      firstViewOffsetMs: 70_000,
      lastViewOffsetMs: 70_000,
      watchedTriggered: false,
      watchedTriggeredAtMs: null,
      immaculateTriggered: false,
      immaculateTriggeredAtMs: null,
    };

    const settings = {
      jobs: {
        webhookEnabled: {
          watchedMovieRecommendations: true,
          immaculateTastePoints: true,
        },
      },
      plex: {
        userMonitoring: {
          excludedPlexUserIds: ['plex-user-2'],
        },
      },
    };

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

  it('drops queued cooldown run when user is toggled off by admin', async () => {
    const { service, jobsService, webhooksService } = makeService();
    const internalService = service as unknown as InternalPlexPollingService;
    jobsService.failQueuedJob.mockResolvedValue(undefined);

    const now = Date.now();
    internalService.pendingCollectionRunsByPlexUser.set('plex-user-2', [
      {
        runId: 'run-1',
        jobId: 'immaculateTastePoints',
        adminUserId: 'admin',
        plexUserId: 'plex-user-2',
        plexUserTitle: 'Alice',
        input: {},
        mediaType: 'movie',
        seedTitle: 'Inception',
        sessionAutomationId: 'sess-1',
        enqueuedAtMs: now,
        attempt: 1,
      },
    ]);

    await internalService.flushPendingCollectionRuns({
      plexUserId: 'plex-user-2',
      settings: {
        jobs: {
          webhookEnabled: {
            watchedMovieRecommendations: true,
            immaculateTastePoints: true,
          },
        },
        plex: {
          userMonitoring: {
            excludedPlexUserIds: ['plex-user-2'],
          },
        },
      },
    });

    expect(jobsService.failQueuedJob).toHaveBeenCalledWith({
      runId: 'run-1',
      errorMessage:
        'Queued run dropped because Plex user monitoring is toggled off by admin.',
    });
    expect(webhooksService.logPlexUserMonitoringSkipped).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'plexPolling',
        plexUserId: 'plex-user-2',
      }),
    );
    expect(jobsService.startQueuedJob).not.toHaveBeenCalled();
  });
});
