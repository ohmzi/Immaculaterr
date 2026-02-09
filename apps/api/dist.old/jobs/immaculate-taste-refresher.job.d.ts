import { PrismaService } from '../db/prisma.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from '../immaculate-taste-collection/immaculate-taste-show-collection.service';
import { TmdbService } from '../tmdb/tmdb.service';
import type { JobContext, JobRunResult } from './jobs.types';
export declare class ImmaculateTasteRefresherJob {
    private readonly prisma;
    private readonly settingsService;
    private readonly plexServer;
    private readonly plexCurated;
    private readonly plexUsers;
    private readonly immaculateTaste;
    private readonly immaculateTasteTv;
    private readonly tmdb;
    private static readonly COLLECTION_NAME;
    private static readonly ACTIVATION_POINTS;
    constructor(prisma: PrismaService, settingsService: SettingsService, plexServer: PlexServerService, plexCurated: PlexCuratedCollectionsService, plexUsers: PlexUsersService, immaculateTaste: ImmaculateTasteCollectionService, immaculateTasteTv: ImmaculateTasteShowCollectionService, tmdb: TmdbService);
    run(ctx: JobContext): Promise<JobRunResult>;
    private runSweep;
    private resolvePlexUserContext;
}
