import type { AuthenticatedRequest } from '../auth/auth.types';
import { ObservatoryService } from './observatory.service';
export declare class ObservatoryController {
    private readonly observatory;
    constructor(observatory: ObservatoryService);
    listMovies(req: AuthenticatedRequest, librarySectionKeyRaw: string, modeRaw: string): Promise<{
        ok: boolean;
        mode: "pendingApproval" | "review";
        items: any;
        approvalRequiredFromObservatory: boolean;
    }>;
    listTv(req: AuthenticatedRequest, librarySectionKeyRaw: string, modeRaw: string): Promise<{
        ok: boolean;
        mode: "pendingApproval" | "review";
        items: any;
        approvalRequiredFromObservatory: boolean;
    }>;
    recordDecisions(req: AuthenticatedRequest, body: {
        librarySectionKey?: unknown;
        mediaType?: unknown;
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
        mediaType: string;
        librarySectionKey: string;
        approvalRequiredFromObservatory: boolean;
        radarr: {
            enabled: boolean;
            sent: number;
            unmonitored: number;
        };
        dataset: {
            removed: number;
        };
        plex: import("../jobs/jobs.types").JsonObject;
    } | {
        ok: boolean;
        mediaType: string;
        librarySectionKey: string;
        approvalRequiredFromObservatory: boolean;
        sonarr: {
            enabled: boolean;
            sent: number;
            unmonitored: number;
        };
        dataset: {
            removed: number;
        };
        plex: import("../jobs/jobs.types").JsonObject;
    }>;
    resetRejected(req: AuthenticatedRequest): Promise<{
        ok: boolean;
        deleted: any;
    }>;
    listRejected(req: AuthenticatedRequest): Promise<{
        ok: boolean;
        items: any;
        total: any;
    }>;
    deleteRejected(req: AuthenticatedRequest, idRaw: string): Promise<{
        ok: boolean;
        error: string;
        deleted?: undefined;
    } | {
        ok: boolean;
        deleted: number;
        error?: undefined;
    }>;
}
