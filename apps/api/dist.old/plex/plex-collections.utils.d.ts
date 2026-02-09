export declare function normalizeCollectionTitle(value: string): string;
export declare const CURATED_MOVIE_COLLECTION_HUB_ORDER: readonly ["Based on your recently watched movie", "Change of Taste", "Inspired by your Immaculate Taste"];
export declare const CURATED_TV_COLLECTION_HUB_ORDER: readonly ["Based on your recently watched show", "Change of Taste", "Inspired by your Immaculate Taste"];
type CuratedMediaType = 'movie' | 'tv';
export declare function buildUserCollectionName(baseName: string, plexUserTitle?: string | null): string;
export declare function stripUserCollectionSuffix(collectionName: string): string;
export declare const stripUserCollectionPrefix: typeof stripUserCollectionSuffix;
export declare function resolveCuratedCollectionBaseName(params: {
    collectionName: string;
    mediaType: CuratedMediaType;
}): string | null;
export declare function curatedCollectionOrderIndex(params: {
    collectionName: string;
    mediaType: CuratedMediaType;
}): number;
export declare function hasSameCuratedCollectionBase(params: {
    left: string;
    right: string;
    mediaType: CuratedMediaType;
}): boolean;
export declare function sortCollectionNamesByCuratedBaseOrder(params: {
    collectionNames: string[];
    mediaType: CuratedMediaType;
}): string[];
export declare function buildUserCollectionHubOrder(baseNames: readonly string[], plexUserTitle?: string | null): string[];
export {};
