import { PrismaService } from '../db/prisma.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { TmdbService } from '../tmdb/tmdb.service';
export declare class ImmaculateTasteCollectionService {
    private readonly prisma;
    private readonly tmdb;
    static readonly DEFAULT_MAX_POINTS = 50;
    static readonly LEGACY_POINTS_FILE = "recommendation_points.json";
    constructor(prisma: PrismaService, tmdb: TmdbService);
    ensureLegacyImported(params: {
        ctx: JobContext;
        plexUserId: string;
        librarySectionKey: string;
        maxPoints?: number;
    }): Promise<{
        imported: boolean;
        sourcePath: string | null;
        importedCount: number;
    }>;
    applyPointsUpdate(params: {
        ctx: JobContext;
        plexUserId: string;
        librarySectionKey: string;
        suggested: Array<{
            tmdbId: number;
            title?: string | null;
            tmdbVoteAvg?: number | null;
            tmdbVoteCount?: number | null;
            inPlex?: boolean | null;
        }>;
        maxPoints?: number;
    }): Promise<JsonObject>;
    activatePendingNowInPlex(params: {
        ctx: JobContext;
        plexUserId: string;
        librarySectionKey: string;
        tmdbIds: number[];
        pointsOnActivation?: number;
        tmdbApiKey?: string | null;
    }): Promise<{
        activated: number;
        tmdbRatingsUpdated: number;
    }>;
    getActiveMovies(params: {
        plexUserId: string;
        librarySectionKey: string;
        minPoints?: number;
        take?: number;
    }): Promise<any>;
    buildThreeTierTmdbRatingShuffleOrder(params: {
        movies: Array<{
            tmdbId: number;
            tmdbVoteAvg: number | null;
            tmdbVoteCount: number | null;
        }>;
    }): number[];
}
