import { PrismaService } from '../db/prisma.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from '../immaculate-taste-collection/immaculate-taste-show-collection.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { RadarrService } from '../radarr/radarr.service';
import { SettingsService } from '../settings/settings.service';
import { SonarrService } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { WatchedCollectionsRefresherService } from '../watched-movie-recommendations/watched-collections-refresher.service';
type ListMode = 'pendingApproval' | 'review';
type WatchedCollectionKind = 'recentlyWatched' | 'changeOfTaste';
export declare class ObservatoryService {
    private readonly prisma;
    private readonly settings;
    private readonly plexServer;
    private readonly plexCurated;
    private readonly plexUsers;
    private readonly radarr;
    private readonly sonarr;
    private readonly tmdb;
    private readonly immaculateMovies;
    private readonly immaculateTv;
    private readonly watchedRefresher;
    constructor(prisma: PrismaService, settings: SettingsService, plexServer: PlexServerService, plexCurated: PlexCuratedCollectionsService, plexUsers: PlexUsersService, radarr: RadarrService, sonarr: SonarrService, tmdb: TmdbService, immaculateMovies: ImmaculateTasteCollectionService, immaculateTv: ImmaculateTasteShowCollectionService, watchedRefresher: WatchedCollectionsRefresherService);
    private resolvePlexUserContext;
    resetRejectedSuggestions(params: {
        userId: string;
    }): Promise<{
        ok: boolean;
        deleted: any;
    }>;
    listRejectedSuggestions(params: {
        userId: string;
    }): Promise<{
        ok: boolean;
        items: any;
        total: any;
    }>;
    deleteRejectedSuggestion(params: {
        userId: string;
        id: string;
    }): Promise<{
        ok: boolean;
        error: string;
        deleted?: undefined;
    } | {
        ok: boolean;
        deleted: number;
        error?: undefined;
    }>;
    listMovies(params: {
        userId: string;
        librarySectionKey: string;
        mode: ListMode;
    }): Promise<{
        ok: boolean;
        mode: ListMode;
        items: any;
        approvalRequiredFromObservatory: boolean;
    }>;
    listTv(params: {
        userId: string;
        librarySectionKey: string;
        mode: ListMode;
    }): Promise<{
        ok: boolean;
        mode: ListMode;
        items: any;
        approvalRequiredFromObservatory: boolean;
    }>;
    listWatchedMovies(params: {
        userId: string;
        librarySectionKey: string;
        mode: ListMode;
        collectionKind: WatchedCollectionKind;
    }): Promise<{
        ok: boolean;
        mode: ListMode;
        collectionKind: WatchedCollectionKind;
        items: any;
        approvalRequiredFromObservatory: boolean;
    }>;
    listWatchedTv(params: {
        userId: string;
        librarySectionKey: string;
        mode: ListMode;
        collectionKind: WatchedCollectionKind;
    }): Promise<{
        ok: boolean;
        mode: ListMode;
        collectionKind: WatchedCollectionKind;
        items: any;
        approvalRequiredFromObservatory: boolean;
    }>;
    recordDecisions(params: {
        userId: string;
        librarySectionKey: string;
        mediaType: 'movie' | 'tv';
        decisions: unknown[];
    }): Promise<{
        ok: boolean;
        applied: number;
        ignored: number;
    }>;
    recordWatchedDecisions(params: {
        userId: string;
        librarySectionKey: string;
        mediaType: 'movie' | 'tv';
        collectionKind: WatchedCollectionKind;
        decisions: unknown[];
    }): Promise<{
        ok: boolean;
        applied: number;
        ignored: number;
    }>;
    applyWatched(params: {
        userId: string;
        librarySectionKey: string;
        mediaType: 'movie' | 'tv';
    }): Promise<{
        ok: boolean;
        approvalRequired: boolean;
        unmonitored: number;
        sent: number;
        refresh: import("../jobs/jobs.types").JsonObject;
    }>;
    apply(params: {
        userId: string;
        librarySectionKey: string;
        mediaType: 'movie' | 'tv';
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
    private applyMovies;
    private applyTv;
    private resolveRadarrDefaults;
    private resolveSonarrDefaults;
}
export {};
