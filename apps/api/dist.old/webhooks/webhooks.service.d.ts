export declare class WebhooksService {
    private readonly logger;
    persistPlexWebhookEvent(event: unknown): Promise<{
        path: string;
    }>;
    logPlexWebhookSummary(params: {
        payload: unknown;
        persistedPath: string;
        receivedAtIso: string;
        files?: Array<{
            fieldname: string;
            originalname: string;
            mimetype: string;
            size: number;
        }>;
        source?: {
            ip?: string | null;
            userAgent?: string | null;
        };
    }): void;
    logPlexWebhookAutomation(params: {
        plexEvent: string;
        mediaType: string;
        seedTitle?: string;
        plexUserId?: string;
        plexUserTitle?: string;
        runs?: Record<string, string>;
        skipped?: Record<string, string>;
        errors?: Record<string, string>;
    }): void;
    private getDataDir;
}
