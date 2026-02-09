import { CollectionsService } from './collections.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
type CreateCollectionBody = {
    name?: unknown;
};
type AddItemBody = {
    title?: unknown;
    ratingKey?: unknown;
};
type ImportJsonBody = {
    json?: unknown;
};
export declare class CollectionsController {
    private readonly collections;
    constructor(collections: CollectionsService);
    list(): Promise<{
        collections: any;
    }>;
    create(body: CreateCollectionBody): Promise<{
        ok: boolean;
        collection: {
            id: any;
            name: any;
            itemCount: number;
            createdAt: any;
            updatedAt: any;
        };
    }>;
    seedDefaults(): Promise<{
        ok: boolean;
        collections: any;
    }>;
    delete(collectionId: string): Promise<{
        ok: boolean;
    }>;
    listItems(collectionId: string): Promise<{
        items: any;
    }>;
    addItem(req: AuthenticatedRequest, collectionId: string, body: AddItemBody): Promise<{
        ok: boolean;
        item: {
            id: any;
            ratingKey: any;
            title: any;
        };
    }>;
    deleteItem(collectionId: string, itemIdRaw: string): Promise<{
        ok: boolean;
    }>;
    importJson(req: AuthenticatedRequest, collectionId: string, body: ImportJsonBody): Promise<{
        ok: boolean;
        result: {
            imported: number;
            skipped: number;
        };
    }>;
    exportJson(collectionId: string): Promise<{
        ok: boolean;
        items: any;
    }>;
}
export {};
