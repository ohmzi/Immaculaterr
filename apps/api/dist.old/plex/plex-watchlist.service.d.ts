export type PlexWatchlistKind = 'movie' | 'show';
export type PlexWatchlistEntry = {
    ratingKey: string;
    title: string;
    year: number | null;
    type: string | null;
};
export declare class PlexWatchlistService {
    private readonly logger;
    private readonly clientIdentifier;
    constructor();
    listWatchlist(params: {
        token: string;
        kind: PlexWatchlistKind;
    }): Promise<{
        ok: true;
        baseUrl: string;
        items: PlexWatchlistEntry[];
    }>;
    removeMovieFromWatchlistByTitle(params: {
        token: string;
        title: string;
        year?: number | null;
        dryRun?: boolean;
    }): Promise<{
        ok: true;
        removed: number;
        attempted: number;
        matchedBy: 'normalized' | 'fuzzy' | 'none';
        sample: PlexWatchlistEntry[];
        baseUrlTried: string | null;
    }>;
    removeShowFromWatchlistByTitle(params: {
        token: string;
        title: string;
        dryRun?: boolean;
    }): Promise<{
        ok: true;
        removed: number;
        attempted: number;
        matchedBy: 'normalized' | 'fuzzy' | 'none';
        sample: PlexWatchlistEntry[];
        baseUrlTried: string | null;
    }>;
    removeFromWatchlistByRatingKey(params: {
        token: string;
        ratingKey: string;
    }): Promise<boolean>;
    private getPlexHeaders;
    private fetchNoContent;
    private fetchXml;
}
