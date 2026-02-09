import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
export declare class IntegrationsConnectivityMonitorService implements OnModuleInit {
    private readonly prisma;
    private readonly settingsService;
    private readonly logger;
    private static readonly INTERVAL_MS;
    private static readonly OFFLINE_REMINDER_MS;
    private static readonly FAILS_TO_MARK_OFFLINE;
    private readonly state;
    onModuleInit(): void;
    poll(): Promise<void>;
    private getState;
    private setStatus;
    private checkOnce;
    constructor(prisma: PrismaService, settingsService: SettingsService);
    private checkTmdb;
    private checkRadarr;
    private checkSonarr;
    private checkOpenAi;
    private checkGoogle;
    private probeHttp;
}
