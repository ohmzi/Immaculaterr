import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
export declare class JobsRetentionService implements OnModuleInit {
    private readonly prisma;
    private readonly logger;
    private static readonly RETENTION_DAYS;
    private static readonly INTERVAL_MS;
    private static readonly BATCH_SIZE;
    constructor(prisma: PrismaService);
    onModuleInit(): void;
    poll(): Promise<void>;
    private cleanupOnce;
    private cleanupOrphanedRunningRuns;
}
