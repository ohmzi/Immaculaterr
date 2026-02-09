import { UpdatesService } from './updates.service';
export declare class UpdatesController {
    private readonly updates;
    constructor(updates: UpdatesService);
    getUpdates(): Promise<{
        currentVersion: string;
        latestVersion: string | null;
        updateAvailable: boolean;
        source: "github-releases";
        repo: string | null;
        latestUrl: string | null;
        checkedAt: string;
        error: string | null;
    }>;
}
