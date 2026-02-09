type PlexSection = {
    key: string;
    title: string;
    type?: string;
};
export type PlexMediaPart = {
    id: string | null;
    key: string | null;
    file: string | null;
    size: number | null;
};
export type PlexMediaVersion = {
    id: string | null;
    videoResolution: string | null;
    parts: PlexMediaPart[];
};
export type PlexMetadataDetails = {
    ratingKey: string;
    title: string;
    type: string | null;
    year: number | null;
    addedAt: number | null;
    librarySectionId: string | null;
    librarySectionTitle: string | null;
    grandparentTitle: string | null;
    grandparentRatingKey: string | null;
    parentIndex: number | null;
    index: number | null;
    tmdbIds: number[];
    tvdbIds: number[];
    media: PlexMediaVersion[];
};
export type PlexActivityDetails = {
    uuid: string;
    type: string | null;
    title: string | null;
    subtitle: string | null;
    progress: number | null;
    cancellable: boolean | null;
    userId: number | null;
    librarySectionId: string | null;
};
export type PlexNowPlayingSession = {
    sessionKey: string;
    type: 'movie' | 'episode' | 'track' | 'unknown';
    ratingKey: string | null;
    title: string | null;
    year: number | null;
    grandparentTitle: string | null;
    grandparentRatingKey: string | null;
    parentIndex: number | null;
    index: number | null;
    librarySectionId: number | null;
    librarySectionTitle: string | null;
    viewOffsetMs: number | null;
    durationMs: number | null;
    userTitle: string | null;
    userId: number | null;
};
export type PlexRecentlyAddedItem = {
    type: string | null;
    ratingKey: string;
    title: string | null;
    year: number | null;
    addedAt: number | null;
    updatedAt: number | null;
    librarySectionId: number | null;
    librarySectionTitle: string | null;
    grandparentTitle: string | null;
    grandparentRatingKey: string | null;
    parentTitle: string | null;
    parentRatingKey: string | null;
    parentIndex: number | null;
    index: number | null;
};
export declare class PlexServerService {
    private readonly logger;
    private readonly logHttp;
    getMachineIdentifier(params: {
        baseUrl: string;
        token: string;
    }): Promise<string>;
    listActivities(params: {
        baseUrl: string;
        token: string;
    }): Promise<PlexActivityDetails[]>;
    listNowPlayingSessions(params: {
        baseUrl: string;
        token: string;
    }): Promise<PlexNowPlayingSession[]>;
    listRecentlyAdded(params: {
        baseUrl: string;
        token: string;
        take?: number;
    }): Promise<PlexRecentlyAddedItem[]>;
    listRecentlyAddedForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        take?: number;
    }): Promise<PlexRecentlyAddedItem[]>;
    getMetadataDetails(params: {
        baseUrl: string;
        token: string;
        ratingKey: string;
    }): Promise<PlexMetadataDetails | null>;
    deletePartByKey(params: {
        baseUrl: string;
        token: string;
        partKey: string;
    }): Promise<void>;
    deleteMediaVersion(params: {
        baseUrl: string;
        token: string;
        ratingKey: string;
        mediaId: string;
    }): Promise<void>;
    deleteMetadataByRatingKey(params: {
        baseUrl: string;
        token: string;
        ratingKey: string;
    }): Promise<void>;
    findMovieRatingKeyByTitle(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        title: string;
    }): Promise<{
        ratingKey: string;
        title: string;
    } | null>;
    findShowRatingKeyByTitle(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        title: string;
    }): Promise<{
        ratingKey: string;
        title: string;
    } | null>;
    getSections(params: {
        baseUrl: string;
        token: string;
    }): Promise<PlexSection[]>;
    findSectionKeyByTitle(params: {
        baseUrl: string;
        token: string;
        title: string;
    }): Promise<string>;
    listMoviesWithTmdbIds(params: {
        baseUrl: string;
        token: string;
        movieLibraryName: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
        tmdbId: number | null;
        addedAt: number | null;
        year: number | null;
    }>>;
    listShowsWithTvdbIds(params: {
        baseUrl: string;
        token: string;
        tvLibraryName: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
        tvdbId: number | null;
        addedAt: number | null;
        year: number | null;
    }>>;
    listMoviesWithTmdbIdsForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        sectionTitle?: string;
        duplicateOnly?: boolean;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
        tmdbId: number | null;
        addedAt: number | null;
        year: number | null;
    }>>;
    listShowsWithTvdbIdsForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        sectionTitle?: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
        tvdbId: number | null;
        addedAt: number | null;
        year: number | null;
    }>>;
    getMovieRatingKeySetForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        sectionTitle?: string;
    }): Promise<Set<string>>;
    listDuplicateMovieRatingKeys(params: {
        baseUrl: string;
        token: string;
        movieLibraryName: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
    }>>;
    listDuplicateMovieRatingKeysForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
    }>>;
    listTvShows(params: {
        baseUrl: string;
        token: string;
        tvLibraryName: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
    }>>;
    listTvShowsForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
    }>>;
    listDuplicateEpisodeRatingKeys(params: {
        baseUrl: string;
        token: string;
        tvLibraryName: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
    }>>;
    listDuplicateEpisodeRatingKeysForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
    }>>;
    listEpisodesForShow(params: {
        baseUrl: string;
        token: string;
        showRatingKey: string;
        duplicateOnly?: boolean;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
        seasonNumber: number | null;
        episodeNumber: number | null;
    }>>;
    getAddedAtTimestampsForSection(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
    }): Promise<number[]>;
    getMovieTmdbIdSet(params: {
        baseUrl: string;
        token: string;
        movieLibraryName: string;
    }): Promise<Set<number>>;
    getMovieTmdbIdSetForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        sectionTitle?: string;
    }): Promise<Set<number>>;
    getTvdbShowMap(params: {
        baseUrl: string;
        token: string;
        tvLibraryName: string;
    }): Promise<Map<number, string>>;
    getTvdbShowMapForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        sectionTitle?: string;
    }): Promise<Map<number, string>>;
    getEpisodesSet(params: {
        baseUrl: string;
        token: string;
        showRatingKey: string;
    }): Promise<Set<string>>;
    findCollectionRatingKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        collectionName: string;
    }): Promise<string | null>;
    listCollectionsForSectionKey(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        take?: number;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
    }>>;
    getCollectionItems(params: {
        baseUrl: string;
        token: string;
        collectionRatingKey: string;
    }): Promise<Array<{
        ratingKey: string;
        title: string;
    }>>;
    setCollectionSort(params: {
        baseUrl: string;
        token: string;
        collectionRatingKey: string;
        sort: 'release' | 'alpha' | 'custom';
    }): Promise<void>;
    moveCollectionItem(params: {
        baseUrl: string;
        token: string;
        collectionRatingKey: string;
        itemRatingKey: string;
        after?: string | null;
    }): Promise<void>;
    deleteCollection(params: {
        baseUrl: string;
        token: string;
        collectionRatingKey: string;
    }): Promise<void>;
    createCollection(params: {
        baseUrl: string;
        token: string;
        machineIdentifier: string;
        librarySectionKey: string;
        collectionName: string;
        type: 1 | 2;
        initialItemRatingKey?: string | null;
    }): Promise<string | null>;
    addItemToCollection(params: {
        baseUrl: string;
        token: string;
        machineIdentifier: string;
        collectionRatingKey: string;
        itemRatingKey: string;
    }): Promise<void>;
    removeItemFromCollection(params: {
        baseUrl: string;
        token: string;
        collectionRatingKey: string;
        itemRatingKey: string;
    }): Promise<void>;
    uploadCollectionPoster(params: {
        baseUrl: string;
        token: string;
        collectionRatingKey: string;
        filepath: string;
    }): Promise<void>;
    uploadCollectionArt(params: {
        baseUrl: string;
        token: string;
        collectionRatingKey: string;
        filepath: string;
    }): Promise<void>;
    setCollectionHubVisibility(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        collectionRatingKey: string;
        promotedToRecommended: number;
        promotedToOwnHome: number;
        promotedToSharedHome?: number;
    }): Promise<void>;
    getCollectionHubIdentifier(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        collectionRatingKey: string;
    }): Promise<string | null>;
    moveHubRow(params: {
        baseUrl: string;
        token: string;
        librarySectionKey: string;
        identifier: string;
        after?: string | null;
    }): Promise<void>;
    private buildMetadataUri;
    private fetchNoContent;
    private fetchXml;
    private listSectionItems;
}
export {};
