import type { AuthenticatedRequest } from '../auth/auth.types';
import { GoogleService } from '../google/google.service';
import { OpenAiService } from '../openai/openai.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SettingsService } from '../settings/settings.service';
import { SonarrService } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';
type UpdatePlexLibrariesBody = {
    selectedSectionKeys?: unknown;
};
export declare class IntegrationsController {
    private readonly settingsService;
    private readonly plexServer;
    private readonly radarr;
    private readonly sonarr;
    private readonly tmdb;
    private readonly google;
    private readonly openai;
    constructor(settingsService: SettingsService, plexServer: PlexServerService, radarr: RadarrService, sonarr: SonarrService, tmdb: TmdbService, google: GoogleService, openai: OpenAiService);
    radarrOptions(req: AuthenticatedRequest): Promise<{
        ok: boolean;
        rootFolders: import("../radarr/radarr.service").RadarrRootFolder[];
        qualityProfiles: import("../radarr/radarr.service").RadarrQualityProfile[];
        tags: import("../radarr/radarr.service").RadarrTag[];
    }>;
    sonarrOptions(req: AuthenticatedRequest): Promise<{
        ok: boolean;
        rootFolders: import("../sonarr/sonarr.service").SonarrRootFolder[];
        qualityProfiles: import("../sonarr/sonarr.service").SonarrQualityProfile[];
        tags: import("../sonarr/sonarr.service").SonarrTag[];
    }>;
    plexLibraries(req: AuthenticatedRequest): Promise<{
        ok: boolean;
        libraries: {
            key: string;
            title: string;
            type: "movie" | "show";
            selected: boolean;
        }[];
        selectedSectionKeys: string[];
        excludedSectionKeys: string[];
        minimumRequired: number;
        autoIncludeNewLibraries: boolean;
    }>;
    savePlexLibraries(req: AuthenticatedRequest, body: UpdatePlexLibrariesBody): Promise<{
        ok: boolean;
        libraries: {
            key: string;
            title: string;
            type: "movie" | "show";
            selected: boolean;
        }[];
        selectedSectionKeys: string[];
        excludedSectionKeys: string[];
        minimumRequired: number;
        autoIncludeNewLibraries: boolean;
    }>;
    testSaved(req: AuthenticatedRequest, integrationId: string, body: unknown): Promise<{
        ok: boolean;
        summary: {
            machineIdentifier: string;
        };
        result?: undefined;
    } | {
        ok: boolean;
        result: {
            ok: boolean;
            status: {
                [x: string]: unknown;
            };
        };
        summary?: undefined;
    } | {
        ok: boolean;
        result: {
            ok: boolean;
            summary: {
                secureBaseUrl: string | null;
            };
            configuration: {
                [x: string]: unknown;
            };
        };
        summary?: undefined;
    } | {
        ok: boolean;
        result: {
            ok: boolean;
            results: import("../google/google.service").GoogleSearchResult[];
            meta: {
                requested: number;
                returned: number;
            };
        };
        summary?: undefined;
    } | {
        ok: boolean;
        result: {
            ok: boolean;
            meta: {
                count: number;
                sample: string[];
            };
        };
        summary?: undefined;
    }>;
}
export {};
