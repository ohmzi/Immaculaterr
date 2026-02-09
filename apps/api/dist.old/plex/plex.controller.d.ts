import { PlexService } from './plex.service';
import { PlexServerService } from './plex-server.service';
import { PlexAnalyticsService } from './plex-analytics.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
type TestPlexServerBody = {
    baseUrl?: unknown;
    token?: unknown;
};
export declare class PlexController {
    private readonly plexService;
    private readonly plexServerService;
    private readonly plexAnalytics;
    constructor(plexService: PlexService, plexServerService: PlexServerService, plexAnalytics: PlexAnalyticsService);
    createPin(): Promise<{
        id: number;
        expiresAt: string | null;
        authUrl: string;
        clientIdentifier: string;
    }>;
    checkPin(id: string): Promise<{
        id: number;
        authToken: string | null;
        expiresAt: string | null;
    }>;
    whoami(plexToken?: string): Promise<{
        id: {} | null;
        uuid: {} | null;
        username: {} | null;
        title: {} | null;
    }>;
    test(body: TestPlexServerBody): Promise<{
        ok: boolean;
        machineIdentifier: string | null;
    }>;
    libraryGrowth(req: AuthenticatedRequest): Promise<import("./plex-analytics.service").PlexLibraryGrowthResponse>;
    libraryGrowthVersion(req: AuthenticatedRequest): Promise<import("./plex-analytics.service").PlexLibraryGrowthVersionResponse>;
}
export {};
