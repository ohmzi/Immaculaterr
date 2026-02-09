type RadarrSystemStatus = Record<string, unknown>;
export type RadarrMovie = Record<string, unknown> & {
    id: number;
    title?: string;
    tmdbId?: number;
    monitored?: boolean;
};
export type RadarrRootFolder = {
    id: number;
    path: string;
};
export type RadarrQualityProfile = {
    id: number;
    name: string;
};
export type RadarrTag = {
    id: number;
    label: string;
};
export declare class RadarrService {
    private readonly logger;
    testConnection(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<{
        ok: boolean;
        status: RadarrSystemStatus;
    }>;
    listMovies(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<RadarrMovie[]>;
    listMonitoredMovies(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<RadarrMovie[]>;
    getMovieById(params: {
        baseUrl: string;
        apiKey: string;
        movieId: number;
    }): Promise<RadarrMovie | null>;
    setMovieMonitored(params: {
        baseUrl: string;
        apiKey: string;
        movie: RadarrMovie;
        monitored: boolean;
    }): Promise<boolean>;
    listRootFolders(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<RadarrRootFolder[]>;
    listQualityProfiles(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<RadarrQualityProfile[]>;
    listTags(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<RadarrTag[]>;
    addMovie(params: {
        baseUrl: string;
        apiKey: string;
        title: string;
        tmdbId: number;
        year?: number | null;
        qualityProfileId: number;
        rootFolderPath: string;
        tags?: number[];
        monitored?: boolean;
        minimumAvailability?: 'announced' | 'inCinemas' | 'released';
        searchForMovie?: boolean;
    }): Promise<{
        status: 'added' | 'exists';
        movie: RadarrMovie | null;
    }>;
    searchMonitoredMovies(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<boolean>;
    private buildApiUrl;
}
export {};
