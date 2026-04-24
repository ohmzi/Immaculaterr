import { PlexServerService } from './plex-server.service';

describe('PlexServerService playable media verification', () => {
  let service: PlexServerService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = new PlexServerService();
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('treats HTTP 206 as a playable part probe and caches the result by part key', async () => {
    fetchMock.mockResolvedValue(
      new Response('', {
        status: 206,
      }),
    );
    const cache = new Map();

    const first = await service.probePartPlayable({
      baseUrl: 'http://plex.local:32400',
      token: 'plex-token',
      partKey: '/library/parts/123/file.mkv',
      cache,
    });
    const second = await service.probePartPlayable({
      baseUrl: 'http://plex.local:32400',
      token: 'plex-token',
      partKey: '/library/parts/123/file.mkv',
      cache,
    });

    expect(first).toEqual({ playable: true, probeFailureCount: 0 });
    expect(second).toEqual({ playable: true, probeFailureCount: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('verifies a metadata item as playable only when Plex can serve a media part', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <MediaContainer size="1">
            <Video ratingKey="movie-1" title="Playable Movie" type="movie">
              <Media id="m1" videoResolution="1080">
                <Part id="p1" key="/library/parts/10/file.mkv" file="/media/movie.mkv" size="10" />
              </Media>
            </Video>
          </MediaContainer>`,
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const result = await service.verifyPlayableMetadataByRatingKey({
      baseUrl: 'http://plex.local:32400',
      token: 'plex-token',
      ratingKey: 'movie-1',
      partProbeCache: new Map(),
    });

    expect(result).toEqual({ playable: true, probeFailureCount: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns verified and metadata-only episode sets separately and records probe failures', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <MediaContainer size="2">
            <Video ratingKey="ep-1" parentIndex="1" index="1">
              <Media id="m1">
                <Part id="p1" key="/library/parts/11/file.mkv" file="/media/ep1.mkv" size="11" />
              </Media>
            </Video>
            <Video ratingKey="ep-2" parentIndex="1" index="2">
              <Media id="m2">
                <Part id="p2" key="/library/parts/12/file.mkv" file="/media/ep2.mkv" size="12" />
              </Media>
            </Video>
          </MediaContainer>`,
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 206 }))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockRejectedValueOnce(new Error('socket hang up'));

    const result = await service.getVerifiedEpisodeAvailabilityForShowRatingKey(
      {
        baseUrl: 'http://plex.local:32400',
        token: 'plex-token',
        showRatingKey: 'show-1',
        partProbeCache: new Map(),
      },
    );

    expect(Array.from(result.metadataEpisodes)).toEqual(['1:1', '1:2']);
    expect(Array.from(result.verifiedEpisodes)).toEqual(['1:1']);
    expect(result.probeFailureCount).toBe(2);
  });
});
