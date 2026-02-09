import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../db/prisma.service';
export declare class SettingsService {
    private readonly prisma;
    private readonly crypto;
    private readonly logger;
    constructor(prisma: PrismaService, crypto: CryptoService);
    getPublicSettings(userId: string): Promise<{
        settings: Record<string, unknown>;
        secretsPresent: {
            [k: string]: boolean;
        };
        meta: {
            dataDir: string | null;
        };
    }>;
    getInternalSettings(userId: string): Promise<{
        settings: Record<string, unknown>;
        secrets: Record<string, unknown>;
    }>;
    updateSettings(userId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
    updateSecrets(userId: string, patch: Record<string, unknown>): Promise<{
        [k: string]: boolean;
    }>;
    enforceAutomationConstraints(userId: string): Promise<void>;
    private getSettingsDoc;
    private getSecretsDoc;
}
