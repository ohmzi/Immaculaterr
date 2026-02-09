import { PlexAnalyticsService } from './plex-analytics.service';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from './plex-server.service';

type SettingsMock = Pick<SettingsService, 'getInternalSettings'>;
type PlexServerMock = Pick<
  PlexServerService,
  'getSections' | 'getAddedAtTimestampsForSection'
>;

describe('PlexAnalyticsService', () => {
  const userId = 'user-1';

  function createService() {
    const settings: jest.Mocked<SettingsMock> = {
      getInternalSettings: jest.fn(),
    };
    const plexServer: jest.Mocked<PlexServerMock> = {
      getSections: jest.fn(),
      getAddedAtTimestampsForSection: jest.fn(),
    };

    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex.local:32400' } },
      secrets: { plex: { token: 'token-123' }, 'plex.token': 'token-123' },
    });

    const service = new PlexAnalyticsService(
      settings as unknown as SettingsService,
      plexServer as unknown as PlexServerService,
    );

    return { service, plexServer };
  }

  it('aggregates growth across all movie and tv libraries', async () => {
    const { service, plexServer } = createService();
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies A', type: 'movie' },
      { key: '2', title: 'Movies B', type: 'movie' },
      { key: '3', title: 'TV A', type: 'show' },
      { key: '4', title: 'TV B', type: 'show' },
    ]);
    plexServer.getAddedAtTimestampsForSection.mockImplementation(
      ({ librarySectionKey }: { librarySectionKey: string }) => {
        if (librarySectionKey === '1') return Promise.resolve([100, 200]);
        if (librarySectionKey === '2') return Promise.resolve([300]);
        if (librarySectionKey === '3') return Promise.resolve([150]);
        if (librarySectionKey === '4') return Promise.resolve([250, 350]);
        return Promise.resolve([]);
      },
    );

    const data = await service.getLibraryGrowth(userId);

    expect(plexServer.getAddedAtTimestampsForSection).toHaveBeenCalledTimes(4);
    expect(data.summary.movies).toBe(3);
    expect(data.summary.tv).toBe(3);
    expect(data.summary.total).toBe(6);
  });

  it('returns tv growth when movie libraries are missing', async () => {
    const { service, plexServer } = createService();
    plexServer.getSections.mockResolvedValue([
      { key: '3', title: 'TV A', type: 'show' },
    ]);
    plexServer.getAddedAtTimestampsForSection.mockResolvedValue([123]);

    const data = await service.getLibraryGrowth(userId);

    expect(plexServer.getAddedAtTimestampsForSection).toHaveBeenCalledTimes(1);
    expect(data.summary.movies).toBe(0);
    expect(data.summary.tv).toBe(1);
    expect(data.summary.total).toBe(1);
  });

  it('returns empty growth when no movie/show libraries exist', async () => {
    const { service, plexServer } = createService();
    plexServer.getSections.mockResolvedValue([
      { key: '9', title: 'Music', type: 'artist' },
    ]);

    const data = await service.getLibraryGrowth(userId);

    expect(plexServer.getAddedAtTimestampsForSection).not.toHaveBeenCalled();
    expect(data.series).toEqual([]);
    expect(data.summary).toEqual({
      startMonth: null,
      endMonth: null,
      movies: 0,
      tv: 0,
      total: 0,
    });
  });
});
