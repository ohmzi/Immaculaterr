import { RadarrService } from './radarr.service';
type TestConnectionBody = {
    baseUrl?: unknown;
    apiKey?: unknown;
};
export declare class RadarrController {
    private readonly radarrService;
    constructor(radarrService: RadarrService);
    test(body: TestConnectionBody): Promise<{
        ok: boolean;
        status: {
            [x: string]: unknown;
        };
    }>;
}
export {};
