import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult } from './jobs.types';
export declare class MonitorConfirmJob {
    private readonly settingsService;
    private readonly plexServer;
    private readonly radarr;
    private readonly sonarr;
    constructor(settingsService: SettingsService, plexServer: PlexServerService, radarr: RadarrService, sonarr: SonarrService);
    run(ctx: JobContext): Promise<JobRunResult>;
}
