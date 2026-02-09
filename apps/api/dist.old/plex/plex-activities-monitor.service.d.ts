import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from './plex-server.service';
export declare class PlexActivitiesMonitorService implements OnModuleInit {
    private readonly prisma;
    private readonly settingsService;
    private readonly plexServer;
    private readonly logger;
    private status;
    private lastError;
    private lastNoisyErrorLogAtMs;
    private readonly lastByUuid;
    private static readonly INTERVAL_MS;
    private static readonly ERROR_REMINDER_MS;
    onModuleInit(): void;
    constructor(prisma: PrismaService, settingsService: SettingsService, plexServer: PlexServerService);
    poll(): Promise<void>;
    private checkOnce;
    private setStatus;
    private diffAndLog;
    private logProgressIfUseful;
}
