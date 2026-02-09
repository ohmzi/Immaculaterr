import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from './plex-server.service';
export declare class PlexConnectivityMonitorService implements OnModuleInit {
    private readonly prisma;
    private readonly settingsService;
    private readonly plexServer;
    private readonly logger;
    private status;
    private lastError;
    private lastStatusChangeAtMs;
    private lastNoisyOfflineLogAtMs;
    private static readonly INTERVAL_MS;
    private static readonly OFFLINE_REMINDER_MS;
    constructor(prisma: PrismaService, settingsService: SettingsService, plexServer: PlexServerService);
    onModuleInit(): void;
    poll(): Promise<void>;
    private checkOnce;
    private setStatus;
}
