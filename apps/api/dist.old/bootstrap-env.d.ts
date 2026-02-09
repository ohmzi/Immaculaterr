export type BootstrapEnv = {
    repoRoot: string;
    dataDir: string;
    databaseUrl: string;
};
export declare function ensureBootstrapEnv(): Promise<BootstrapEnv>;
