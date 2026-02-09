import { PrismaService } from '../db/prisma.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { TmdbService } from '../tmdb/tmdb.service';
export declare class ImmaculateTasteShowCollectionService {
    private readonly prisma;
    private readonly tmdb;
    static readonly DEFAULT_MAX_POINTS = 50;
    constructor(prisma: PrismaService, tmdb: TmdbService);
    ensureLegacyImported(_params: {
        ctx: JobContext;
        plexUserId: string;
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
            tvdbId: number;
            tmdbId?: number | null;
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
        tvdbIds: number[];
        pointsOnActivation?: number;
        tmdbApiKey?: string | null;
    }): Promise<{
        activated: number;
        tmdbRatingsUpdated: number;
    }>;
    getActiveShows(params: {
        plexUserId: string;
        librarySectionKey: string;
        minPoints?: number;
        take?: number;
    }): Promise<any>;
    buildThreeTierTmdbRatingShuffleOrder(params: {
        shows: Array<{
            tvdbId: number;
            tmdbVoteAvg: number | null;
            tmdbVoteCount: number | null;
        }>;
    }): number[];
}
