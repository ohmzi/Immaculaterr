type PlexSectionLike = {
    key: string;
    title: string;
    type?: string;
};
export type PlexEligibleLibrary = {
    key: string;
    title: string;
    type: 'movie' | 'show';
};
export declare const PLEX_LIBRARY_SELECTION_MIN_SELECTED = 1;
export declare function sanitizeSectionKeys(value: unknown): string[];
export declare function readConfiguredExcludedSectionKeys(settings: Record<string, unknown>): string[];
export declare function toEligiblePlexLibraries(sections: PlexSectionLike[]): PlexEligibleLibrary[];
export declare function resolvePlexLibrarySelection(params: {
    settings: Record<string, unknown>;
    sections: PlexSectionLike[];
}): {
    eligibleLibraries: PlexEligibleLibrary[];
    excludedSectionKeys: string[];
    selectedSectionKeys: string[];
};
export declare function buildExcludedSectionKeysFromSelected(params: {
    eligibleLibraries: Array<{
        key: string;
    }>;
    selectedSectionKeys: unknown;
}): string[];
export declare function isPlexLibrarySectionExcluded(params: {
    settings: Record<string, unknown>;
    sectionKey: unknown;
}): boolean;
export {};
