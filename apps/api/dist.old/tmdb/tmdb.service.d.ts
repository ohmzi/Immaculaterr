type TmdbConfiguration = Record<string, unknown>;
type TmdbMovieSearchResult = {
    id: number;
    title: string;
    release_date?: string;
    genre_ids?: number[];
    vote_count?: number;
    vote_average?: number;
    popularity?: number;
};
type TmdbMovieDetails = {
    id: number;
    title?: string;
    release_date?: string;
    overview?: string;
    poster_path?: string;
    genres?: Array<{
        id?: unknown;
        name?: unknown;
    }>;
    vote_count?: number;
    vote_average?: number;
};
type TmdbTvSearchResult = {
    id: number;
    name: string;
    first_air_date?: string;
    genre_ids?: number[];
    vote_count?: number;
    vote_average?: number;
    popularity?: number;
};
type TmdbTvExternalIds = {
    tvdb_id?: number | null;
};
type TmdbTvDetails = {
    id: number;
    name?: string;
    first_air_date?: string;
    overview?: string;
    poster_path?: string;
    genres?: Array<{
        id?: unknown;
        name?: unknown;
    }>;
    vote_count?: number;
    vote_average?: number;
    external_ids?: TmdbTvExternalIds;
};
export type TmdbMovieCandidate = {
    tmdbId: number;
    title: string;
    releaseDate: string | null;
    voteAverage: number | null;
    voteCount: number | null;
    popularity: number | null;
    sources: string[];
};
export type TmdbTvCandidate = {
    tmdbId: number;
    title: string;
    releaseDate: string | null;
    voteAverage: number | null;
    voteCount: number | null;
    popularity: number | null;
    sources: string[];
};
export declare class TmdbService {
    private readonly logger;
    testConnection(params: {
        apiKey: string;
    }): Promise<{
        ok: boolean;
        summary: {
            secureBaseUrl: string | null;
        };
        configuration: TmdbConfiguration;
    }>;
    searchMovie(params: {
        apiKey: string;
        query: string;
        year?: number | null;
        includeAdult?: boolean;
    }): Promise<TmdbMovieSearchResult[]>;
    searchTv(params: {
        apiKey: string;
        query: string;
        firstAirDateYear?: number | null;
        includeAdult?: boolean;
    }): Promise<TmdbTvSearchResult[]>;
    getMovie(params: {
        apiKey: string;
        tmdbId: number;
    }): Promise<TmdbMovieDetails | null>;
    getTv(params: {
        apiKey: string;
        tmdbId: number;
        appendExternalIds?: boolean;
    }): Promise<TmdbTvDetails | null>;
    getTvExternalIds(params: {
        apiKey: string;
        tmdbId: number;
    }): Promise<{
        tvdb_id: number | null;
    } | null>;
    getMovieVoteStats(params: {
        apiKey: string;
        tmdbId: number;
    }): Promise<{
        vote_average: number | null;
        vote_count: number | null;
    } | null>;
    getTvVoteStats(params: {
        apiKey: string;
        tmdbId: number;
    }): Promise<{
        vote_average: number | null;
        vote_count: number | null;
    } | null>;
    getSeedMetadata(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
    }): Promise<Record<string, unknown>>;
    getTvSeedMetadata(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
    }): Promise<Record<string, unknown>>;
    discoverFallbackMovieCandidates(params: {
        apiKey: string;
        limit: number;
        seedYear?: number | null;
        genreIds?: number[] | null;
        includeAdult?: boolean;
        timezone?: string | null;
    }): Promise<TmdbMovieCandidate[]>;
    discoverFallbackTvCandidates(params: {
        apiKey: string;
        limit: number;
        seedYear?: number | null;
        genreIds?: number[] | null;
        includeAdult?: boolean;
        timezone?: string | null;
    }): Promise<TmdbTvCandidate[]>;
    getAdvancedMovieRecommendations(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
        limit: number;
        includeAdult?: boolean;
    }): Promise<string[]>;
    getContrastMovieRecommendations(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
        limit: number;
    }): Promise<string[]>;
    getContrastTvRecommendations(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
        limit: number;
    }): Promise<string[]>;
    getSplitRecommendationCandidatePools(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
        includeAdult?: boolean;
        timezone?: string | null;
        upcomingWindowMonths?: number;
    }): Promise<{
        seed: {
            tmdbId: number;
            title: string;
            genreIds: number[];
            releaseDate: string | null;
        };
        meta: {
            today: string;
            timezone: string;
            upcomingWindowEnd: string;
        };
        released: TmdbMovieCandidate[];
        upcoming: TmdbMovieCandidate[];
        unknown: TmdbMovieCandidate[];
    }>;
    getSplitContrastRecommendationCandidatePools(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
        includeAdult?: boolean;
        timezone?: string | null;
        upcomingWindowMonths?: number;
    }): Promise<{
        seed: {
            tmdbId: number;
            title: string;
            genreIds: number[];
            releaseDate: string | null;
        };
        meta: {
            today: string;
            timezone: string;
            upcomingWindowEnd: string;
        };
        released: TmdbMovieCandidate[];
        upcoming: TmdbMovieCandidate[];
        unknown: TmdbMovieCandidate[];
    }>;
    getSplitTvRecommendationCandidatePools(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
        includeAdult?: boolean;
        timezone?: string | null;
        upcomingWindowMonths?: number;
    }): Promise<{
        seed: {
            tmdbId: number;
            title: string;
            genreIds: number[];
            releaseDate: string | null;
        };
        meta: {
            today: string;
            timezone: string;
            upcomingWindowEnd: string;
        };
        released: TmdbTvCandidate[];
        upcoming: TmdbTvCandidate[];
        unknown: TmdbTvCandidate[];
    }>;
    getSplitContrastTvRecommendationCandidatePools(params: {
        apiKey: string;
        seedTitle: string;
        seedYear?: number | null;
        includeAdult?: boolean;
        timezone?: string | null;
        upcomingWindowMonths?: number;
    }): Promise<{
        seed: {
            tmdbId: number;
            title: string;
            genreIds: number[];
            releaseDate: string | null;
        };
        meta: {
            today: string;
            timezone: string;
            upcomingWindowEnd: string;
        };
        released: TmdbTvCandidate[];
        upcoming: TmdbTvCandidate[];
        unknown: TmdbTvCandidate[];
    }>;
    private pagedResults;
    private pagedTvResults;
    private fetchTmdbJson;
    private formatTodayInTimezone;
    private formatDateInTimezone;
}
export {};
