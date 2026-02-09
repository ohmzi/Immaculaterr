import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexWatchlistService } from '../plex/plex-watchlist.service';
import { PlexDuplicatesService } from '../plex/plex-duplicates.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult } from './jobs.types';
export declare class CleanupAfterAddingNewContentJob {
    private readonly settingsService;
    private readonly plexServer;
    private readonly plexWatchlist;
    private readonly plexDuplicates;
    private readonly radarr;
    private readonly sonarr;
    constructor(settingsService: SettingsService, plexServer: PlexServerService, plexWatchlist: PlexWatchlistService, plexDuplicates: PlexDuplicatesService, radarr: RadarrService, sonarr: SonarrService);
    run(ctx: JobContext): Promise<JobRunResult>;
}
