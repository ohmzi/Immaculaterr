import { PrismaService } from '../db/prisma.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
type PlexLibrarySection = {
    key: string;
    title: string;
    type?: string;
};
export declare class WatchedCollectionsRefresherService {
    private readonly prisma;
    private readonly plexServer;
    private readonly plexCurated;
    constructor(prisma: PrismaService, plexServer: PlexServerService, plexCurated: PlexCuratedCollectionsService);
    refresh(params: {
        ctx: JobContext;
        plexBaseUrl: string;
        plexToken: string;
        machineIdentifier: string;
        plexUserId: string;
        plexUserTitle: string;
        pinCollections?: boolean;
        pinTarget?: 'admin' | 'friends';
        movieSections: PlexLibrarySection[];
        tvSections: PlexLibrarySection[];
        limit: number;
        scope?: {
            librarySectionKey: string;
            mode: 'movie' | 'tv';
        } | null;
    }): Promise<JsonObject>;
    private refreshMovieCollections;
    private refreshTvCollections;
}
export {};
