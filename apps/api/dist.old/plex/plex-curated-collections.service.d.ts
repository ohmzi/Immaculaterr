import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { PlexServerService } from './plex-server.service';
type PinTarget = 'admin' | 'friends';
type PreferredHubTarget = {
    collectionName: string;
    collectionKey: string;
};
export declare class PlexCuratedCollectionsService {
    private readonly plexServer;
    constructor(plexServer: PlexServerService);
    rebuildMovieCollection(params: {
        ctx: JobContext;
        baseUrl: string;
        token: string;
        machineIdentifier: string;
        movieSectionKey: string;
        collectionName: string;
        itemType?: 1 | 2;
        desiredItems: Array<{
            ratingKey: string;
            title: string;
        }>;
        randomizeOrder?: boolean;
        pinCollections?: boolean;
        pinTarget?: PinTarget;
        collectionHubOrder?: string[];
        preferredHubTargets?: PreferredHubTarget[];
    }): Promise<JsonObject>;
    private setCollectionArtwork;
    private pinCuratedCollectionHubs;
    private getArtworkPaths;
}
export {};
