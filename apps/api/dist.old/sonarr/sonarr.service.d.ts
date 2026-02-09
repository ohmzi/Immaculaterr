type SonarrSystemStatus = Record<string, unknown>;
export type SonarrSeries = Record<string, unknown> & {
    id: number;
    title?: string;
    tvdbId?: number;
    monitored?: boolean;
    seasons?: Array<Record<string, unknown> & {
        seasonNumber?: number;
        monitored?: boolean;
    }>;
};
export type SonarrEpisode = Record<string, unknown> & {
    id: number;
    seasonNumber?: number;
    episodeNumber?: number;
    monitored?: boolean;
};
export type SonarrRootFolder = {
    id: number;
    path: string;
};
export type SonarrQualityProfile = {
    id: number;
    name: string;
};
export type SonarrTag = {
    id: number;
    label: string;
};
export declare class SonarrService {
    private readonly logger;
    testConnection(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<{
        ok: boolean;
        status: SonarrSystemStatus;
    }>;
    listSeries(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<SonarrSeries[]>;
    listMonitoredSeries(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<SonarrSeries[]>;
    getEpisodesBySeries(params: {
        baseUrl: string;
        apiKey: string;
        seriesId: number;
    }): Promise<SonarrEpisode[]>;
    setEpisodeMonitored(params: {
        baseUrl: string;
        apiKey: string;
        episode: SonarrEpisode;
        monitored: boolean;
    }): Promise<boolean>;
    updateSeries(params: {
        baseUrl: string;
        apiKey: string;
        series: SonarrSeries;
    }): Promise<boolean>;
    searchMonitoredEpisodes(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<boolean>;
    listRootFolders(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<SonarrRootFolder[]>;
    listQualityProfiles(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<SonarrQualityProfile[]>;
    listTags(params: {
        baseUrl: string;
        apiKey: string;
    }): Promise<SonarrTag[]>;
    lookupSeries(params: {
        baseUrl: string;
        apiKey: string;
        term: string;
    }): Promise<SonarrSeries[]>;
    addSeries(params: {
        baseUrl: string;
        apiKey: string;
        title: string;
        tvdbId: number;
        qualityProfileId: number;
        rootFolderPath: string;
        tags?: number[];
        monitored?: boolean;
        searchForMissingEpisodes?: boolean;
        searchForCutoffUnmetEpisodes?: boolean;
    }): Promise<{
        status: 'added' | 'exists';
        series: SonarrSeries | null;
    }>;
    private buildApiUrl;
}
export {};
