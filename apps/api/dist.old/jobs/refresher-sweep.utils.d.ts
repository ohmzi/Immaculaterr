import type { JsonObject } from './jobs.types';
export declare const SWEEP_ORDER: "non_admin_then_admin_last";
type SweepSortableUser = {
    id: string;
    plexAccountTitle: string;
    isAdmin: boolean;
    lastSeenAt: Date | string | null;
};
export declare function hasExplicitRefresherScopeInput(input: JsonObject | null | undefined): boolean;
export declare function sortSweepUsers<T extends SweepSortableUser>(users: readonly T[]): T[];
export {};
