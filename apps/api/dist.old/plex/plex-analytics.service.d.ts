import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from './plex-server.service';
export type PlexLibraryGrowthPoint = {
    month: string;
    movies: number;
    tv: number;
};
export type PlexLibraryGrowthResponse = {
    ok: true;
    series: PlexLibraryGrowthPoint[];
    summary: {
        startMonth: string | null;
        endMonth: string | null;
        movies: number;
        tv: number;
        total: number;
    };
};
export type PlexLibraryGrowthVersionResponse = {
    ok: true;
    version: string;
};
export declare class PlexAnalyticsService {
    private readonly settings;
    private readonly plexServer;
    private readonly logger;
    private readonly cache;
    private readonly growthBustCounterByUserId;
    constructor(settings: SettingsService, plexServer: PlexServerService);
    invalidateLibraryGrowth(userId: string): void;
    getLibraryGrowthVersion(userId: string): Promise<PlexLibraryGrowthVersionResponse>;
    getLibraryGrowth(userId: string): Promise<PlexLibraryGrowthResponse>;
}
