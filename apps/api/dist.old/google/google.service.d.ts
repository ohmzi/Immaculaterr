export type GoogleSearchResult = {
    title: string;
    snippet: string;
    link: string;
};
export declare class GoogleService {
    private readonly logger;
    search(params: {
        apiKey: string;
        cseId: string;
        query: string;
        numResults: number;
    }): Promise<{
        results: GoogleSearchResult[];
        meta: {
            requested: number;
            returned: number;
        };
    }>;
    testConnection(params: {
        apiKey: string;
        cseId: string;
        query: string;
        numResults: number;
    }): Promise<{
        ok: boolean;
        results: GoogleSearchResult[];
        meta: {
            requested: number;
            returned: number;
        };
    }>;
    formatForPrompt(results: GoogleSearchResult[]): string;
    private coerceWanted;
    private executeSearch;
    private extractGoogleErrorDetail;
}
