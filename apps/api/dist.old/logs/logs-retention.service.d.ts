import { OnModuleInit } from '@nestjs/common';
export declare class LogsRetentionService implements OnModuleInit {
    private readonly logger;
    private static readonly RETENTION_DAYS;
    private static readonly INTERVAL_MS;
    onModuleInit(): void;
    poll(): Promise<void>;
    private cleanupOnce;
}
