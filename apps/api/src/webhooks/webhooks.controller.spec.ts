import { ConflictException } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';

function makeAlreadyProcessedConflict() {
  return new ConflictException({
    reason: 'already_processed',
    message: 'Job already processed for this media.',
  });
}

function makeController() {
  const webhooksService = {
    isDuplicatePayload: jest.fn().mockReturnValue(false),
    persistPlexWebhookEvent: jest.fn(),
    logPlexWebhookSummary: jest.fn(),
    logPlexWebhookAutomation: jest.fn(),
    logPlexUserMonitoringSkipped: jest.fn(),
  };
  const webhookSecret = {
    getSecret: jest.fn().mockReturnValue(''),
  };
  const jobsService = {
    runJob: jest.fn(),
  };
  const authService = {
    getFirstAdminUserId: jest.fn(),
  };
  const settingsService = {
    getInternalSettings: jest.fn(),
  };
  const plexUsers = {
    resolvePlexUser: jest.fn(),
  };
  const plexAnalytics = {
    invalidateLibraryGrowth: jest.fn(),
  };

  const controller = new WebhooksController(
    webhooksService as never,
    webhookSecret as never,
    jobsService as never,
    authService as never,
    settingsService as never,
    plexUsers as never,
    plexAnalytics as never,
  );

  webhooksService.persistPlexWebhookEvent.mockResolvedValue({
    path: '/tmp/webhook.json',
  });
  authService.getFirstAdminUserId.mockResolvedValue('admin-user');
  plexUsers.resolvePlexUser.mockResolvedValue({
    id: 'plex-user-2',
    plexAccountTitle: 'Alice',
    plexAccountId: 2,
  });

  return {
    controller,
    webhooksService,
    jobsService,
    authService,
    settingsService,
    plexUsers,
  };
}

function makeMovieWebhookPayload() {
  return {
    payload: JSON.stringify({
      event: 'media.scrobble',
      Account: { id: 2, title: 'Alice' },
      Metadata: {
        type: 'movie',
        title: 'Inception',
        year: 2010,
        ratingKey: 'movie-1',
        librarySectionID: 1,
        librarySectionTitle: 'Movies',
      },
    }),
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

describe('WebhooksController plex webhook auto-runs', () => {
  it('skips scrobble automation when plex user is toggled off by admin', async () => {
    const { controller, webhooksService, jobsService, settingsService } =
      makeController();

    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        plex: {
          userMonitoring: {
            excludedPlexUserIds: ['plex-user-2'],
          },
        },
      },
      secrets: {},
    });

    const result = await controller.plexWebhook(
      { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as never,
      makeMovieWebhookPayload() as never,
      [],
    );

    expect(result.triggered).toBe(false);
    expect(result.skipped).toEqual({
      watchedMovieRecommendations: 'user_toggled_off_by_admin',
      immaculateTastePoints: 'user_toggled_off_by_admin',
    });
    expect(jobsService.runJob).not.toHaveBeenCalled();
    expect(webhooksService.logPlexUserMonitoringSkipped).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'plexWebhook',
        plexUserId: 'plex-user-2',
        plexUserTitle: 'Alice',
      }),
    );
  });

  it('skips immaculateTastePoints as already_processed after a prior successful auto-run', async () => {
    const { controller, jobsService, settingsService } = makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          webhookEnabled: {
            watchedMovieRecommendations: true,
            immaculateTastePoints: true,
          },
        },
      },
      secrets: {},
    });
    jobsService.runJob
      .mockResolvedValueOnce({ id: 'immaculate-run-1' })
      .mockRejectedValueOnce(makeAlreadyProcessedConflict());

    const request = {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
    } as never;

    await controller.plexWebhook(
      request,
      makeMovieWebhookPayload() as never,
      [],
    );
    const result = await controller.plexWebhook(
      request,
      makeMovieWebhookPayload() as never,
      [],
    );

    expect(result.triggered).toBe(false);
    expect(result.skipped).toEqual({
      watchedMovieRecommendations: 'polling_only',
      immaculateTastePoints: 'already_processed',
    });
    expect(jobsService.runJob).toHaveBeenCalledTimes(2);
    const firstFingerprint = getRunJobFingerprint(jobsService, 0);
    const secondFingerprint = getRunJobFingerprint(jobsService, 1);
    expect(firstFingerprint).toBe(secondFingerprint);
  });

  it('keeps the watched webhook path in polling_only mode', async () => {
    const { controller, jobsService, settingsService } = makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          webhookEnabled: {
            watchedMovieRecommendations: true,
            immaculateTastePoints: false,
          },
        },
      },
      secrets: {},
    });

    const result = await controller.plexWebhook(
      { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as never,
      makeMovieWebhookPayload() as never,
      [],
    );

    expect(result.triggered).toBe(false);
    expect(result.skipped).toEqual({
      watchedMovieRecommendations: 'polling_only',
      immaculateTastePoints: 'disabled',
    });
    expect(jobsService.runJob).not.toHaveBeenCalled();
  });
});
