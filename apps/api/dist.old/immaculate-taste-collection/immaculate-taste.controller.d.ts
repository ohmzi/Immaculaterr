import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
type ResetBody = {
    mediaType?: unknown;
    librarySectionKey?: unknown;
};
type ResetUserBody = {
    plexUserId?: unknown;
    mediaType?: unknown;
};
export declare class ImmaculateTasteController {
    private readonly prisma;
    private readonly settingsService;
    private readonly plexServer;
    private readonly plexUsers;
    constructor(prisma: PrismaService, settingsService: SettingsService, plexServer: PlexServerService, plexUsers: PlexUsersService);
    listCollections(req: AuthenticatedRequest): Promise<{
        collectionName: string;
        collections: ({
            mediaType: "movie";
            librarySectionKey: string;
            libraryTitle: string;
            dataset: {
                total: any;
                active: any;
                pending: any;
            };
            plex: {
                collectionName: string;
                collectionRatingKey: string | null;
                itemCount: number | null;
            };
        } | {
            mediaType: "tv";
            librarySectionKey: string;
            libraryTitle: string;
            dataset: {
                total: any;
                active: any;
                pending: any;
            };
            plex: {
                collectionName: string;
                collectionRatingKey: string | null;
                itemCount: number | null;
            };
        })[];
    }>;
    listCollectionUsers(req: AuthenticatedRequest): Promise<{
        users: any;
    }>;
    resetCollection(req: AuthenticatedRequest, body: ResetBody): Promise<{
        ok: boolean;
        mediaType: string;
        librarySectionKey: string;
        libraryTitle: string;
        plex: {
            collectionName: string;
            collectionRatingKey: string | null;
            deleted: boolean;
        };
        dataset: {
            deleted: any;
        };
    }>;
    resetUserCollections(req: AuthenticatedRequest, body: ResetUserBody): Promise<{
        ok: boolean;
        mediaType: string;
        plexUserId: any;
        plexUserTitle: any;
        plex: {
            collectionName: string;
            deleted: number;
            libraries: number;
        };
        dataset: {
            deleted: any;
        };
    }>;
}
export {};
