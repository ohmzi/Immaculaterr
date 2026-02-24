import { WebhooksController } from './webhooks.controller';

describe('WebhooksController user monitoring exclusion', () => {
  function makeController() {
    const webhooksService = {
      persistPlexWebhookEvent: jest.fn(),
      logPlexWebhookSummary: jest.fn(),
      logPlexWebhookAutomation: jest.fn(),
      logPlexUserMonitoringSkipped: jest.fn(),
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
      jobsService as never,
      authService as never,
      settingsService as never,
      plexUsers as never,
      plexAnalytics as never,
    );

    return {
      controller,
      webhooksService,
      jobsService,
      authService,
      settingsService,
      plexUsers,
    };
  }

  it('skips scrobble automation when plex user is toggled off by admin', async () => {
    const {
      controller,
      webhooksService,
      jobsService,
      authService,
      settingsService,
      plexUsers,
    } = makeController();

    webhooksService.persistPlexWebhookEvent.mockResolvedValue({
      path: '/tmp/webhook.json',
    });
    authService.getFirstAdminUserId.mockResolvedValue('admin-user');
    plexUsers.resolvePlexUser.mockResolvedValue({
      id: 'plex-user-2',
      plexAccountTitle: 'Alice',
    });
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
      {
        payload: JSON.stringify({
          event: 'media.scrobble',
          Account: { id: 2, title: 'Alice' },
          Metadata: {
            type: 'movie',
            title: 'Inception',
            librarySectionID: 1,
            librarySectionTitle: 'Movies',
          },
        }),
      } as never,
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
});
