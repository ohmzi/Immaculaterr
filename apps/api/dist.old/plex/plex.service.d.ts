export declare class PlexService {
    private readonly logger;
    private readonly clientIdentifier;
    constructor();
    createPin(): Promise<{
        id: number;
        expiresAt: string | null;
        authUrl: string;
        clientIdentifier: string;
    }>;
    checkPin(pinId: number): Promise<{
        id: number;
        authToken: string | null;
        expiresAt: string | null;
    }>;
    whoami(plexToken: string): Promise<{
        id: {} | null;
        uuid: {} | null;
        username: {} | null;
        title: {} | null;
    }>;
    private getPlexHeaders;
}
