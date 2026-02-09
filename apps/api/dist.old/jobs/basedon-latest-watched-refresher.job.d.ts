import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import { WatchedCollectionsRefresherService } from '../watched-movie-recommendations/watched-collections-refresher.service';
import type { JobContext, JobRunResult } from './jobs.types';
export declare class BasedonLatestWatchedRefresherJob {
    private readonly prisma;
    private readonly settingsService;
    private readonly plexServer;
    private readonly plexUsers;
    private readonly watchedRefresher;
    constructor(prisma: PrismaService, settingsService: SettingsService, plexServer: PlexServerService, plexUsers: PlexUsersService, watchedRefresher: WatchedCollectionsRefresherService);
    run(ctx: JobContext): Promise<JobRunResult>;
    private runSweep;
    private resolvePlexUserContext;
}
