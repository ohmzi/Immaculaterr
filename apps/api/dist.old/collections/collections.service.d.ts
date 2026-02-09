import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
export declare class CollectionsService {
    private readonly prisma;
    private readonly settings;
    private readonly plexServer;
    constructor(prisma: PrismaService, settings: SettingsService, plexServer: PlexServerService);
    listCollections(): Promise<any>;
    createCollection(name: string): Promise<{
        id: any;
        name: any;
        itemCount: number;
        createdAt: any;
        updatedAt: any;
    }>;
    seedDefaults(): Promise<any>;
    deleteCollection(collectionId: string): Promise<void>;
    listItems(collectionId: string): Promise<any>;
    addItem(params: {
        userId: string;
        collectionId: string;
        ratingKey?: string;
        title?: string;
    }): Promise<{
        id: any;
        ratingKey: any;
        title: any;
    }>;
    deleteItem(params: {
        collectionId: string;
        itemId: number;
    }): Promise<void>;
    importFromJson(params: {
        userId: string;
        collectionId: string;
        json: string;
    }): Promise<{
        imported: number;
        skipped: number;
    }>;
    exportToJson(collectionId: string): Promise<any>;
    private resolveMovieTitle;
}
