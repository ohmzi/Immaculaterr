import { RecommendationsService } from './recommendations.service';
import type { JobContext } from '../jobs/jobs.types';

type CandidateInput = {
  tmdbId: number;
  title: string;
  releaseDate?: string | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  popularity?: number | null;
  originalLanguage?: string | null;
  sources?: string[];
};

type MetadataInput = {
  overview?: string;
  genreNames?: string[];
  originalLanguage?: string | null;
  originCountryCodes?: string[];
};

function buildCandidate(input: CandidateInput) {
  return {
    tmdbId: input.tmdbId,
    title: input.title,
    releaseDate: input.releaseDate ?? '2025-01-01',
    voteAverage: input.voteAverage ?? 7.5,
    voteCount: input.voteCount ?? 500,
    popularity: input.popularity ?? 50,
    originalLanguage: input.originalLanguage ?? 'en',
    sources: input.sources ?? ['recommendations'],
  };
}

function buildMetadata(input: MetadataInput = {}) {
  return {
    overview: input.overview ?? 'moody science fiction mystery',
    genreNames: input.genreNames ?? ['Science Fiction', 'Drama'],
    originalLanguage: input.originalLanguage ?? 'en',
    originCountryCodes: input.originCountryCodes ?? ['US'],
  };
}

function createContext(): JobContext {
  return {
    patchSummary: jest.fn().mockResolvedValue(undefined),
    info: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
  } as unknown as JobContext;
}

function createMovieRecommendationService(options?: {
  movieMetadata?: Record<number, ReturnType<typeof buildMetadata> | null>;
  tvMetadata?: Record<number, ReturnType<typeof buildMetadata> | null>;
}) {
  const tmdb = {
    getSeedMetadata: jest.fn().mockResolvedValue({
      seed_title: 'Seed Movie',
      title: 'Seed Movie',
      overview: 'dark science fiction mystery',
      genres: ['Science Fiction', 'Drama'],
      original_language: 'en',
      origin_country_codes: ['US'],
    }),
    getTvSeedMetadata: jest.fn().mockResolvedValue({
      seed_title: 'Seed Show',
      title: 'Seed Show',
      overview: 'dark prestige thriller',
      genres: ['Drama', 'Mystery'],
      original_language: 'en',
      origin_country_codes: ['US'],
      media_type: 'tv',
    }),
    getSplitRecommendationCandidatePools: jest.fn(),
    getSplitTvRecommendationCandidatePools: jest.fn(),
    getSplitContrastRecommendationCandidatePools: jest.fn(),
    getSplitContrastTvRecommendationCandidatePools: jest.fn(),
    discoverFallbackMovieCandidates: jest.fn().mockResolvedValue([]),
    discoverFallbackTvCandidates: jest.fn().mockResolvedValue([]),
    discoverGlobalLanguageMovieCandidates: jest.fn().mockResolvedValue([]),
    discoverGlobalLanguageTvCandidates: jest.fn().mockResolvedValue([]),
    discoverHiddenGemMovieCandidates: jest.fn().mockResolvedValue([]),
    discoverHiddenGemTvCandidates: jest.fn().mockResolvedValue([]),
    getMovieRecommendationMetadata: jest
      .fn()
      .mockImplementation(({ tmdbId }: { tmdbId: number }) =>
        Promise.resolve(options?.movieMetadata?.[tmdbId] ?? buildMetadata()),
      ),
    getTvRecommendationMetadata: jest
      .fn()
      .mockImplementation(({ tmdbId }: { tmdbId: number }) =>
        Promise.resolve(options?.tvMetadata?.[tmdbId] ?? buildMetadata()),
      ),
  };

  const google = {
    search: jest.fn(),
    formatForPrompt: jest.fn(),
  };

  const openai = {
    selectFromCandidates: jest.fn(),
    selectFromCandidatesNoSplit: jest.fn(),
    getRelatedMovieTitles: jest.fn(),
    getRelatedTvTitles: jest.fn(),
  };

  return {
    service: new RecommendationsService(
      tmdb as never,
      google as never,
      openai as never,
    ),
    tmdb,
    google,
    openai,
  };
}

describe('RecommendationsService', () => {
  it('keeps latest-watched movie mostly standard and injects a single wildcard pick', async () => {
    const { service, tmdb } = createMovieRecommendationService({
      movieMetadata: {
        900: buildMetadata({
          overview: 'japanese family drama classic',
          genreNames: ['Drama'],
          originalLanguage: 'ja',
          originCountryCodes: ['JP'],
        }),
      },
    });
    const ctx = createContext();
    const released = Array.from({ length: 10 }, (_, index) =>
      buildCandidate({
        tmdbId: index + 1,
        title: `Standard Movie ${index + 1}`,
        voteAverage: 9 - index * 0.1,
        voteCount: 1000 - index * 50,
        popularity: 120 - index * 5,
      }),
    );

    tmdb.getSplitRecommendationCandidatePools.mockResolvedValue({
      seed: { genreIds: [878, 18] },
      meta: { today: '2026-04-12' },
      released,
      upcoming: [],
      unknown: [],
    });
    tmdb.discoverGlobalLanguageMovieCandidates.mockResolvedValue([
      buildCandidate({
        tmdbId: 900,
        title: 'Tokyo Story',
        voteAverage: 8.4,
        voteCount: 900,
        popularity: 18,
        originalLanguage: 'ja',
        sources: ['global_language'],
      }),
    ]);

    const result = await service.buildSimilarMovieTitles({
      ctx,
      seedTitle: 'Seed Movie',
      seedYear: 2024,
      tmdbApiKey: 'tmdb-key',
      count: 10,
      webContextFraction: 0,
      openai: null,
      google: null,
    });

    expect(result.strategy).toBe('tmdb');
    expect(result.titles).toHaveLength(10);
    expect(result.titles[4]).toBe('Tokyo Story');
    expect(
      result.titles.filter((title) => title === 'Tokyo Story'),
    ).toHaveLength(1);
    expect(result.debug['wildcardQuota']).toBe(1);
  });

  it('keeps latest-watched tv mostly standard and injects at most one wildcard pick', async () => {
    const { service, tmdb } = createMovieRecommendationService({
      tvMetadata: {
        901: buildMetadata({
          overview: 'korean character driven thriller',
          genreNames: ['Drama', 'Thriller'],
          originalLanguage: 'ko',
          originCountryCodes: ['KR'],
        }),
      },
    });
    const ctx = createContext();
    const released = Array.from({ length: 10 }, (_, index) =>
      buildCandidate({
        tmdbId: index + 101,
        title: `Standard Show ${index + 1}`,
        voteAverage: 8.7 - index * 0.1,
        voteCount: 950 - index * 40,
        popularity: 90 - index * 4,
      }),
    );

    tmdb.getSplitTvRecommendationCandidatePools.mockResolvedValue({
      seed: { genreIds: [18, 9648] },
      meta: { today: '2026-04-12' },
      released,
      upcoming: [],
      unknown: [],
    });
    tmdb.discoverGlobalLanguageTvCandidates.mockResolvedValue([
      buildCandidate({
        tmdbId: 901,
        title: 'Signal',
        voteAverage: 8.5,
        voteCount: 450,
        popularity: 12,
        originalLanguage: 'ko',
        sources: ['global_language'],
      }),
    ]);

    const result = await service.buildSimilarTvTitles({
      ctx,
      seedTitle: 'Seed Show',
      seedYear: 2024,
      tmdbApiKey: 'tmdb-key',
      count: 10,
      webContextFraction: 0,
      openai: null,
      google: null,
    });

    expect(result.strategy).toBe('tmdb');
    expect(result.titles).toHaveLength(10);
    expect(result.titles[4]).toBe('Signal');
    expect(result.debug['wildcardQuota']).toBe(1);
  });

  it('backfills change-of-taste movie rows from the standard lane when wildcard picks underfill', async () => {
    const { service, tmdb } = createMovieRecommendationService({
      movieMetadata: {
        950: buildMetadata({
          overview: 'spanish coming of age drama',
          genreNames: ['Drama'],
          originalLanguage: 'es',
          originCountryCodes: ['ES'],
        }),
      },
    });
    const ctx = createContext();
    const released = Array.from({ length: 8 }, (_, index) =>
      buildCandidate({
        tmdbId: index + 201,
        title: `Contrast Movie ${index + 1}`,
        voteAverage: 8.8 - index * 0.12,
        voteCount: 700 - index * 25,
        popularity: 60 - index * 3,
        sources: ['discover_released'],
      }),
    );

    tmdb.getSplitContrastRecommendationCandidatePools.mockResolvedValue({
      seed: { genreIds: [878, 18] },
      meta: { today: '2026-04-12' },
      released,
      upcoming: [],
      unknown: [],
    });
    tmdb.discoverGlobalLanguageMovieCandidates.mockResolvedValue([
      buildCandidate({
        tmdbId: 950,
        title: 'The Spirit of the Beehive',
        voteAverage: 8,
        voteCount: 190,
        popularity: 8,
        originalLanguage: 'es',
        sources: ['global_language'],
      }),
    ]);

    const result = await service.buildChangeOfTasteMovieTitles({
      ctx,
      seedTitle: 'Seed Movie',
      seedYear: 2024,
      tmdbApiKey: 'tmdb-key',
      count: 8,
      openai: null,
    });

    expect(result.strategy).toBe('tmdb');
    expect(result.titles).toHaveLength(8);
    expect(result.titles[3]).toBe('The Spirit of the Beehive');
    expect(
      result.titles.filter((title) => title.startsWith('Contrast Movie')),
    ).toHaveLength(7);
  });

  it('backfills change-of-taste tv rows from the standard lane when wildcard picks underfill', async () => {
    const { service, tmdb } = createMovieRecommendationService({
      tvMetadata: {
        960: buildMetadata({
          overview: 'french arthouse mystery series',
          genreNames: ['Mystery', 'Drama'],
          originalLanguage: 'fr',
          originCountryCodes: ['FR'],
        }),
      },
    });
    const ctx = createContext();
    const released = Array.from({ length: 8 }, (_, index) =>
      buildCandidate({
        tmdbId: index + 301,
        title: `Contrast Show ${index + 1}`,
        voteAverage: 8.5 - index * 0.12,
        voteCount: 650 - index * 20,
        popularity: 55 - index * 2,
        sources: ['discover_released'],
      }),
    );

    tmdb.getSplitContrastTvRecommendationCandidatePools.mockResolvedValue({
      seed: { genreIds: [18, 9648] },
      meta: { today: '2026-04-12' },
      released,
      upcoming: [],
      unknown: [],
    });
    tmdb.discoverGlobalLanguageTvCandidates.mockResolvedValue([
      buildCandidate({
        tmdbId: 960,
        title: 'Les Revenants',
        voteAverage: 8.1,
        voteCount: 220,
        popularity: 10,
        originalLanguage: 'fr',
        sources: ['global_language'],
      }),
    ]);

    const result = await service.buildChangeOfTasteTvTitles({
      ctx,
      seedTitle: 'Seed Show',
      seedYear: 2024,
      tmdbApiKey: 'tmdb-key',
      count: 8,
      openai: null,
    });

    expect(result.strategy).toBe('tmdb');
    expect(result.titles).toHaveLength(8);
    expect(result.titles[3]).toBe('Les Revenants');
    expect(
      result.titles.filter((title) => title.startsWith('Contrast Show')),
    ).toHaveLength(7);
  });

  it('fails closed on low-quality wildcard movie candidates', async () => {
    const { service, tmdb } = createMovieRecommendationService();
    const ctx = createContext();
    const released = Array.from({ length: 10 }, (_, index) =>
      buildCandidate({
        tmdbId: index + 401,
        title: `Standard Movie ${index + 1}`,
        voteAverage: 8.6 - index * 0.08,
        voteCount: 900 - index * 30,
        popularity: 85 - index * 3,
      }),
    );

    tmdb.getSplitRecommendationCandidatePools.mockResolvedValue({
      seed: { genreIds: [878, 18] },
      meta: { today: '2026-04-12' },
      released,
      upcoming: [],
      unknown: [],
    });
    tmdb.discoverGlobalLanguageMovieCandidates.mockResolvedValue([
      buildCandidate({
        tmdbId: 999,
        title: 'Too Small To Keep',
        voteAverage: 6.1,
        voteCount: 20,
        popularity: 5,
        originalLanguage: 'ja',
        sources: ['global_language'],
      }),
    ]);
    tmdb.discoverHiddenGemMovieCandidates.mockResolvedValue([
      buildCandidate({
        tmdbId: 1000,
        title: 'Still Too Small',
        voteAverage: 6.5,
        voteCount: 40,
        popularity: 3,
        originalLanguage: 'es',
        sources: ['hidden_gem'],
      }),
    ]);

    const result = await service.buildSimilarMovieTitles({
      ctx,
      seedTitle: 'Seed Movie',
      seedYear: 2024,
      tmdbApiKey: 'tmdb-key',
      count: 10,
      webContextFraction: 0,
      openai: null,
      google: null,
    });

    expect(result.titles).toHaveLength(10);
    expect(result.titles).not.toContain('Too Small To Keep');
    expect(result.titles).not.toContain('Still Too Small');
    expect(result.debug['wildcardInjected']).toBe(0);
  });

  it('falls back to heuristic ranking when movie metadata hydration is missing', async () => {
    const { service, tmdb } = createMovieRecommendationService({
      movieMetadata: {
        1: null,
        2: null,
        3: null,
        4: null,
        5: null,
        6: null,
      },
    });
    const ctx = createContext();
    const released = Array.from({ length: 6 }, (_, index) =>
      buildCandidate({
        tmdbId: index + 1,
        title: `Fallback Movie ${index + 1}`,
        voteAverage: 8.9 - index * 0.1,
        voteCount: 1100 - index * 100,
        popularity: 100 - index * 5,
      }),
    );

    tmdb.getSplitRecommendationCandidatePools.mockResolvedValue({
      seed: { genreIds: [878, 18] },
      meta: { today: '2026-04-12' },
      released,
      upcoming: [],
      unknown: [],
    });

    const result = await service.buildSimilarMovieTitles({
      ctx,
      seedTitle: 'Seed Movie',
      seedYear: 2024,
      tmdbApiKey: 'tmdb-key',
      count: 6,
      webContextFraction: 0,
      openai: null,
      google: null,
    });

    expect(result.strategy).toBe('tmdb');
    expect(result.titles).toEqual([
      'Fallback Movie 1',
      'Fallback Movie 2',
      'Fallback Movie 3',
      'Fallback Movie 4',
      'Fallback Movie 5',
      'Fallback Movie 6',
    ]);
  });
});
