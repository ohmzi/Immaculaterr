import { SonarrService } from './sonarr.service';
type TestConnectionBody = {
    baseUrl?: unknown;
    apiKey?: unknown;
};
export declare class SonarrController {
    private readonly sonarrService;
    constructor(sonarrService: SonarrService);
    test(body: TestConnectionBody): Promise<{
        ok: boolean;
        status: {
            [x: string]: unknown;
        };
    }>;
}
export {};
