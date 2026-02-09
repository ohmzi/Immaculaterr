import { SettingsService } from './settings.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
type UpdateSettingsBody = {
    settings?: unknown;
    secrets?: unknown;
};
export declare class SettingsController {
    private readonly settingsService;
    constructor(settingsService: SettingsService);
    get(req: AuthenticatedRequest): Promise<{
        settings: Record<string, unknown>;
        secretsPresent: {
            [k: string]: boolean;
        };
        meta: {
            dataDir: string | null;
        };
    }>;
    backupInfo(): {
        appDataDir: string | null;
        databaseUrl: string | null;
        masterKey: {
            source: "env" | "file" | "dataDirFile";
            envSet: boolean;
            envFilePath: string | null;
            envFileExists: boolean;
            dataDirKeyFilePath: string | null;
            dataDirKeyFileExists: boolean;
        };
        whatToBackup: string[];
    };
    put(req: AuthenticatedRequest, body: UpdateSettingsBody): Promise<{
        settings: Record<string, unknown>;
        secretsPresent: {
            [k: string]: boolean;
        };
        meta: {
            dataDir: string | null;
        };
    }>;
}
export {};
