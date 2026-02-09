import type { AuthenticatedRequest } from '../auth/auth.types';
import { ObservatoryService } from './observatory.service';
export declare class WatchedObservatoryController {
    private readonly observatory;
    constructor(observatory: ObservatoryService);
    listMovies(req: AuthenticatedRequest, librarySectionKeyRaw: string, modeRaw: string, collectionKindRaw: string): Promise<{
        ok: boolean;
        mode: "pendingApproval" | "review";
        collectionKind: "changeOfTaste" | "recentlyWatched";
        items: any;
        approvalRequiredFromObservatory: boolean;
    }>;
    listTv(req: AuthenticatedRequest, librarySectionKeyRaw: string, modeRaw: string, collectionKindRaw: string): Promise<{
        ok: boolean;
        mode: "pendingApproval" | "review";
        collectionKind: "changeOfTaste" | "recentlyWatched";
        items: any;
        approvalRequiredFromObservatory: boolean;
    }>;
    recordDecisions(req: AuthenticatedRequest, body: {
        librarySectionKey?: unknown;
        mediaType?: unknown;
        collectionKind?: unknown;
        decisions?: unknown;
    }): Promise<{
        ok: boolean;
        applied: number;
        ignored: number;
    }>;
    apply(req: AuthenticatedRequest, body: {
        librarySectionKey?: unknown;
        mediaType?: unknown;
    }): Promise<{
        ok: boolean;
        approvalRequired: boolean;
        unmonitored: number;
        sent: number;
        refresh: import("../jobs/jobs.types").JsonObject;
    }>;
}
