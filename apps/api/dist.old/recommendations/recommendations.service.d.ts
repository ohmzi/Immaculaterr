import { GoogleService } from '../google/google.service';
import { OpenAiService } from '../openai/openai.service';
import { TmdbService } from '../tmdb/tmdb.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
export declare class RecommendationsService {
    private readonly tmdb;
    private readonly google;
    private readonly openai;
    private googleDownUntilMs;
    private openAiDownUntilMs;
    constructor(tmdb: TmdbService, google: GoogleService, openai: OpenAiService);
    buildSimilarMovieTitles(params: {
        ctx: JobContext;
        seedTitle: string;
        seedYear?: number | null;
        tmdbApiKey: string;
        count: number;
        webContextFraction: number;
        upcomingPercent?: number | null;
        openai?: {
            apiKey: string;
            model?: string | null;
        } | null;
        google?: {
            apiKey: string;
            searchEngineId: string;
        } | null;
    }): Promise<{
        titles: string[];
        strategy: 'openai' | 'tmdb';
        debug: JsonObject;
    }>;
    buildSimilarTvTitles(params: {
        ctx: JobContext;
        seedTitle: string;
        seedYear?: number | null;
        tmdbApiKey: string;
        count: number;
        webContextFraction: number;
        upcomingPercent?: number | null;
        openai?: {
            apiKey: string;
            model?: string | null;
        } | null;
        google?: {
            apiKey: string;
            searchEngineId: string;
        } | null;
    }): Promise<{
        titles: string[];
        strategy: 'openai' | 'tmdb';
        debug: JsonObject;
    }>;
    buildChangeOfTasteMovieTitles(params: {
        ctx: JobContext;
        seedTitle: string;
        seedYear?: number | null;
        tmdbApiKey: string;
        count: number;
        upcomingPercent?: number | null;
        openai?: {
            apiKey: string;
            model?: string | null;
        } | null;
    }): Promise<{
        titles: string[];
        strategy: 'openai' | 'tmdb';
    }>;
    buildChangeOfTasteTvTitles(params: {
        ctx: JobContext;
        seedTitle: string;
        seedYear?: number | null;
        tmdbApiKey: string;
        count: number;
        upcomingPercent?: number | null;
        openai?: {
            apiKey: string;
            model?: string | null;
        } | null;
    }): Promise<{
        titles: string[];
        strategy: 'openai' | 'tmdb';
    }>;
    private canUseGoogle;
    private canUseOpenAi;
    private resolveGoogleTitlesToTmdbCandidates;
    private resolveGoogleTitlesToTmdbTvCandidates;
}
