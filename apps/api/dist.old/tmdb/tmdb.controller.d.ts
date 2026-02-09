import { TmdbService } from './tmdb.service';
type TestTmdbBody = {
    apiKey?: unknown;
};
export declare class TmdbController {
    private readonly tmdbService;
    constructor(tmdbService: TmdbService);
    test(body: TestTmdbBody): Promise<{
        ok: boolean;
        summary: {
            secureBaseUrl: string | null;
        };
        configuration: {
            [x: string]: unknown;
        };
    }>;
}
export {};
