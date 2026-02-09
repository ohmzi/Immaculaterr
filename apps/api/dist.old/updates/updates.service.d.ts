export declare class UpdatesService {
    private cache;
    private fetchLatestFromGitHubReleases;
    private getCachedLatest;
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
