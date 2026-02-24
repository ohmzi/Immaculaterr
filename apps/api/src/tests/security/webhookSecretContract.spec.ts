import { UnauthorizedException } from '@nestjs/common';
import { WebhooksController } from '../../webhooks/webhooks.controller';

describe('security/webhook secret contract', () => {
  const originalSecret = process.env.PLEX_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.PLEX_WEBHOOK_SECRET = originalSecret;
  });

  function makeController() {
    const webhooksService = {
      persistPlexWebhookEvent: jest
        .fn()
        .mockResolvedValue({ path: '/tmp/webhook.json' }),
      logPlexWebhookSummary: jest.fn(),
      logPlexWebhookAutomation: jest.fn(),
      logPlexUserMonitoringSkipped: jest.fn(),
    };
    const jobsService = { runJob: jest.fn() };
    const authService = {
      getFirstAdminUserId: jest.fn().mockResolvedValue(null),
    };
    const settingsService = { getInternalSettings: jest.fn() };
    const plexUsers = { resolvePlexUser: jest.fn() };
    const plexAnalytics = { invalidateLibraryGrowth: jest.fn() };

    return new WebhooksController(
      webhooksService as never,
      jobsService as never,
      authService as never,
      settingsService as never,
      plexUsers as never,
      plexAnalytics as never,
    );
  }

  const payload = {
    payload: JSON.stringify({
      event: 'library.new',
      Metadata: { type: 'movie', title: 'Test' },
    }),
  };

  it('rejects requests when configured webhook secret is missing', async () => {
    process.env.PLEX_WEBHOOK_SECRET = 'secret-token';
    const controller = makeController();

    await expect(
      controller.plexWebhook(
        {
          query: {},
          headers: {},
          ip: '127.0.0.1',
        } as never,
        payload as never,
        [],
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts requests with a matching token query param', async () => {
    process.env.PLEX_WEBHOOK_SECRET = 'secret-token';
    const controller = makeController();

    const result = await controller.plexWebhook(
      {
        query: { token: 'secret-token' },
        headers: {},
        ip: '127.0.0.1',
      } as never,
      payload as never,
      [],
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: true, triggered: false }),
    );
  });
});
