type OpenAiChatMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string;
};
type MovieCandidateForSelection = {
    tmdbId: number;
    title: string;
    releaseDate: string | null;
    voteAverage?: number | null;
    voteCount?: number | null;
    popularity?: number | null;
    sources?: string[] | null;
};
export declare class OpenAiService {
    private readonly logger;
    testConnection(params: {
        apiKey: string;
    }): Promise<{
        ok: boolean;
        meta: {
            count: number;
            sample: string[];
        };
    }>;
    private extractOpenAiError;
    chatCompletions(params: {
        apiKey: string;
        model: string;
        messages: OpenAiChatMessage[];
        timeoutMs?: number;
    }): Promise<string>;
    getRelatedMovieTitles(params: {
        apiKey: string;
        model?: string | null;
        seedTitle: string;
        limit: number;
        tmdbSeedMetadata?: Record<string, unknown> | null;
        googleSearchContext?: string | null;
        upcomingCapFraction?: number;
    }): Promise<string[]>;
    getRelatedTvTitles(params: {
        apiKey: string;
        model?: string | null;
        seedTitle: string;
        limit: number;
        tmdbSeedMetadata?: Record<string, unknown> | null;
        googleSearchContext?: string | null;
    }): Promise<string[]>;
    getContrastMovieTitles(params: {
        apiKey: string;
        model?: string | null;
        seedTitle: string;
        limit: number;
    }): Promise<string[]>;
    getContrastTvTitles(params: {
        apiKey: string;
        model?: string | null;
        seedTitle: string;
        limit: number;
    }): Promise<string[]>;
    selectFromCandidates(params: {
        apiKey: string;
        model?: string | null;
        seedTitle: string;
        mediaType?: 'movie' | 'tv';
        tmdbSeedMetadata?: Record<string, unknown> | null;
        releasedTarget: number;
        upcomingTarget: number;
        releasedCandidates: MovieCandidateForSelection[];
        upcomingCandidates: MovieCandidateForSelection[];
    }): Promise<{
        released: number[];
        upcoming: number[];
    }>;
    selectFromCandidatesNoSplit(params: {
        apiKey: string;
        model?: string | null;
        seedTitle: string;
        mediaType?: 'movie' | 'tv';
        tmdbSeedMetadata?: Record<string, unknown> | null;
        count: number;
        candidates: MovieCandidateForSelection[];
    }): Promise<number[]>;
}
export {};
