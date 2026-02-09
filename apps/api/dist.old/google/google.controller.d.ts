import { GoogleService } from './google.service';
type TestGoogleBody = {
    apiKey?: unknown;
    cseId?: unknown;
    numResults?: unknown;
    query?: unknown;
};
export declare class GoogleController {
    private readonly googleService;
    constructor(googleService: GoogleService);
    test(body: TestGoogleBody): Promise<{
        ok: boolean;
        results: import("./google.service").GoogleSearchResult[];
        meta: {
            requested: number;
            returned: number;
        };
    }>;
}
export {};
