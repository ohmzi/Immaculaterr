export declare const DEFAULT_APP_VERSION: "1.0.0.600";
export type AppMeta = {
    name: string;
    version: string;
    buildSha: string | null;
    buildTime: string | null;
};
export declare function readAppMeta(): AppMeta;
