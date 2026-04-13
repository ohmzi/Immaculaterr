import { BadGatewayException } from '@nestjs/common';
import { TmdbService } from './tmdb.service';

type MockResponseInput = {
  status: number;
  text?: string;
  json?: unknown;
};

function mockResponse(input: MockResponseInput): Response {
  const { status } = input;
  const textBody = input.text ?? '';
  const jsonBody = input.json ?? {};

  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(textBody),
    json: jest.fn().mockResolvedValue(jsonBody),
  } as unknown as Response;
}

describe('TmdbService', () => {
  const fetchMock = jest.fn();
  let service: TmdbService;

  beforeEach(() => {
    fetchMock.mockReset();
    (global as { fetch: typeof fetch }).fetch = fetchMock as never;
    service = new TmdbService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns TMDB configuration summary on successful connection test', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: {
          images: {
            secure_base_url: 'https://image.tmdb.org/t/p/',
          },
        },
      }),
    );

    await expect(
      service.testConnection({ apiKey: 'key-123' }),
    ).resolves.toEqual({
      ok: true,
      summary: {
        secureBaseUrl: 'https://image.tmdb.org/t/p/',
      },
      configuration: {
        images: {
          secure_base_url: 'https://image.tmdb.org/t/p/',
        },
      },
    });
  });

  it('uses all release types and ignores availability filters', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: {
          page: 1,
          total_pages: 1,
          results: [
            {
              id: 11,
              title: 'Old Classic',
              release_date: '1999-04-17',
              vote_average: 7.1,
              vote_count: 100,
              popularity: 3.3,
              original_language: 'ja',
            },
            {
              id: 12,
              title: 'Window Match',
              release_date: '2026-04-10',
              vote_average: 8.0,
              vote_count: 50,
              popularity: 10.5,
              original_language: 'ja',
            },
            {
              id: 13,
              title: 'Future Beyond Window',
              release_date: '2026-05-01',
              vote_average: 7.5,
              vote_count: 40,
              popularity: 8.5,
              original_language: 'en',
            },
            {
              id: 14,
              title: 'No Date',
              vote_average: 8.1,
              vote_count: 30,
              popularity: 1.1,
              original_language: 'en',
            },
          ],
        },
      }),
    );

    const discovered = await service.discoverUpcomingMovies({
      apiKey: 'key-123',
      fromDate: '2026-03-15',
      toDate: '2026-04-30',
      genreIds: [16, 35],
      watchProviderIds: [8, 337],
      watchRegion: 'US',
      minScore: 6,
      maxScore: 10,
      maxItems: 20,
      maxPages: 1,
    });

    expect(discovered.map((entry) => entry.title)).toEqual(['Window Match']);
    expect(discovered[0]?.releaseDate).toBe('2026-04-10');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as [URL, RequestInit | undefined];
    const firstUrl = firstCall[0];
    expect(firstUrl).toBeInstanceOf(URL);
    expect(firstUrl.pathname).toBe('/3/discover/movie');
    expect(firstUrl.searchParams.get('release_date.gte')).toBe('2026-03-15');
    expect(firstUrl.searchParams.get('release_date.lte')).toBe('2026-04-30');
    expect(firstUrl.searchParams.get('with_genres')).toBe('16|35');
    expect(firstUrl.searchParams.get('with_release_type')).toBeNull();
    expect(firstUrl.searchParams.get('region')).toBeNull();
    expect(firstUrl.searchParams.get('with_watch_providers')).toBeNull();
    expect(firstUrl.searchParams.get('watch_region')).toBeNull();
    expect(firstUrl.searchParams.get('primary_release_date.gte')).toBeNull();
    expect(firstUrl.searchParams.get('primary_release_date.lte')).toBeNull();
  });

  it('retries TMDB connection test with IPv4 fallback on connectivity failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const ipv4FallbackSpy = jest
      .spyOn(service as any, 'fetchTmdbJsonWithIpv4')
      .mockResolvedValueOnce({
        images: {
          secure_base_url: 'https://image.tmdb.org/t/p/',
        },
      });

    const result = await service.testConnection({ apiKey: 'key-123' });

    expect(ipv4FallbackSpy).toHaveBeenCalledTimes(1);
    expect(result.summary.secureBaseUrl).toBe('https://image.tmdb.org/t/p/');
  });

  it('does not use IPv4 fallback when TMDB responds with HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 401,
        text: 'Invalid API key: You must be granted a valid key.',
      }),
    );
    const ipv4FallbackSpy = jest.spyOn(service as any, 'fetchTmdbJsonWithIpv4');

    await expect(
      service.testConnection({ apiKey: 'bad-key' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(ipv4FallbackSpy).not.toHaveBeenCalled();
  });

  it('includes original language and origin countries in movie seed metadata', async () => {
    jest.spyOn(service, 'searchMovie').mockResolvedValueOnce([
      {
        id: 321,
        title: 'Seed Movie',
        release_date: '2024-05-01',
        vote_average: 7.8,
        vote_count: 400,
        popularity: 30,
      },
    ] as never);
    jest.spyOn(service, 'getMovie').mockResolvedValueOnce({
      id: 321,
      title: 'Seed Movie',
      release_date: '2024-05-01',
      overview: 'A science fiction mystery.',
      original_language: 'ja',
      genres: [
        { id: 878, name: 'Science Fiction' },
        { id: 9648, name: 'Mystery' },
      ],
      production_countries: [
        { iso_3166_1: 'JP', name: 'Japan' },
        { iso_3166_1: 'FR', name: 'France' },
      ],
    } as never);

    await expect(
      service.getSeedMetadata({
        apiKey: 'key-123',
        seedTitle: 'Seed Movie',
        seedYear: 2024,
      }),
    ).resolves.toEqual({
      seed_title: 'Seed Movie',
      tmdb_id: 321,
      title: 'Seed Movie',
      year: '2024',
      genres: ['Science Fiction', 'Mystery'],
      overview: 'A science fiction mystery.',
      original_language: 'ja',
      origin_country_codes: ['JP', 'FR'],
    });
  });

  it('builds language-scoped global movie discovery queries and excludes the seed language', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: {
          page: 1,
          total_pages: 1,
          results: [
            {
              id: 10,
              title: 'Japanese Gem',
              release_date: '2021-01-01',
              vote_average: 8.1,
              vote_count: 250,
              popularity: 15,
            },
          ],
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: {
          page: 1,
          total_pages: 1,
          results: [
            {
              id: 11,
              title: 'Spanish Gem',
              release_date: '2020-05-05',
              vote_average: 7.9,
              vote_count: 190,
              popularity: 12,
            },
          ],
        },
      }),
    );

    const discovered = await service.discoverGlobalLanguageMovieCandidates({
      apiKey: 'key-123',
      limit: 2,
      genreIds: [18, 53],
      matchMode: 'exclude',
      languages: ['en', 'ja', 'es'],
      excludeLanguage: 'en',
      timezone: 'America/Toronto',
    });

    expect(discovered).toEqual([
      expect.objectContaining({
        title: 'Japanese Gem',
        originalLanguage: 'ja',
        sources: ['global_language'],
      }),
      expect.objectContaining({
        title: 'Spanish Gem',
        originalLanguage: 'es',
        sources: ['global_language'],
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const calls = fetchMock.mock.calls as Array<[URL, RequestInit | undefined]>;
    const firstUrl = calls[0]?.[0];
    const secondUrl = calls[1]?.[0];

    expect(firstUrl.searchParams.get('with_original_language')).toBe('ja');
    expect(secondUrl.searchParams.get('with_original_language')).toBe('es');
    expect(firstUrl.searchParams.get('without_genres')).toBe('18,53');
    expect(secondUrl.searchParams.get('without_genres')).toBe('18,53');
  });
});
