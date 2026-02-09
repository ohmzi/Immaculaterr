import { PlexServerService } from './plex-server.service';
export type PlexDeletePreference = 'smallest_file' | 'largest_file' | 'newest' | 'oldest';
export type PlexDuplicateCopy = {
    mediaId: string | null;
    videoResolution: string | null;
    partId: string | null;
    partKey: string | null;
    file: string | null;
    size: number | null;
    preserved: boolean;
};
export type PlexDuplicateCleanupResult = {
    dryRun: boolean;
    ratingKey: string;
    title: string;
    type: string | null;
    copies: number;
    kept: PlexDuplicateCopy | null;
    deleted: number;
    wouldDelete: number;
    failures: number;
    warnings: string[];
    deletions: Array<PlexDuplicateCopy & {
        deleted: boolean;
        error?: string;
    }>;
    metadata: {
        tmdbIds: number[];
        tvdbIds: number[];
        year: number | null;
        parentIndex: number | null;
        index: number | null;
    };
};
export declare class PlexDuplicatesService {
    private readonly plex;
    constructor(plex: PlexServerService);
    private pickRepresentativeCopyForMedia;
    cleanupMovieDuplicates(params: {
        baseUrl: string;
        token: string;
        ratingKey: string;
        dryRun: boolean;
        deletePreference: PlexDeletePreference;
        preserveQualityTerms: string[];
    }): Promise<PlexDuplicateCleanupResult>;
    cleanupEpisodeDuplicates(params: {
        baseUrl: string;
        token: string;
        ratingKey: string;
        dryRun: boolean;
    }): Promise<PlexDuplicateCleanupResult>;
}
