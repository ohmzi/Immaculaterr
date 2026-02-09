import { OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';
import { JobsService } from './jobs.service';
export declare class JobsScheduler implements OnModuleInit {
    private readonly prisma;
    private readonly schedulerRegistry;
    private readonly jobsService;
    private readonly logger;
    constructor(prisma: PrismaService, schedulerRegistry: SchedulerRegistry, jobsService: JobsService);
    onModuleInit(): Promise<void>;
    upsertSchedule(params: {
        jobId: string;
        cron: string;
        enabled: boolean;
        timezone?: string | null;
    }): Promise<any>;
    refreshSchedules(): Promise<void>;
    private clearManagedCronJobs;
    private ensureDefaultSchedules;
}
