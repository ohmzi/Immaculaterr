import { SettingsService } from '../settings/settings.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult } from './jobs.types';
export declare class ArrMonitoredSearchJob {
    private readonly settingsService;
    private readonly radarr;
    private readonly sonarr;
    constructor(settingsService: SettingsService, radarr: RadarrService, sonarr: SonarrService);
    run(ctx: JobContext): Promise<JobRunResult>;
}
