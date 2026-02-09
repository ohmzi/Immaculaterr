import type { PlexUser } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PlexService } from './plex.service';
type PlexAccountIdentity = {
    plexAccountId?: number | null;
    plexAccountTitle?: string | null;
};
type PlexUserRow = PlexUser;
export declare class PlexUsersService {
    private readonly prisma;
    private readonly settingsService;
    private readonly plexService;
    private readonly logger;
    constructor(prisma: PrismaService, settingsService: SettingsService, plexService: PlexService);
    resolvePlexUser(params: {
        plexAccountId?: number | null;
        plexAccountTitle?: string | null;
        userId?: string | null;
    }): Promise<PlexUserRow>;
    getAdminPlexUser(): Promise<PlexUserRow>;
    getPlexUserById(id: string): Promise<PlexUserRow | null>;
    getOrCreateByPlexAccount(params: PlexAccountIdentity): Promise<PlexUserRow | null>;
    ensureAdminPlexUser(params: {
        userId?: string | null;
    }): Promise<any>;
    backfillAdminOnMissing(): Promise<void>;
    private createAdminPlaceholder;
    private getFirstAdminUserId;
    private getAdminIdentity;
    private mergePlexUserData;
}
export {};
