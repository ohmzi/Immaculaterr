import { PrismaService } from '../db/prisma.service';
import { JobsHandlers } from './jobs.handlers';
import type { JobRunTrigger, JsonObject } from './jobs.types';
export declare class JobsService {
    private readonly prisma;
    private readonly handlers;
    private readonly logger;
    private readonly runningJobIds;
    private static readonly UNSCHEDULABLE_JOB_IDS;
    constructor(prisma: PrismaService, handlers: JobsHandlers);
    listDefinitions(): {
        id: string;
        name: string;
        description: string;
        defaultScheduleCron: string | null;
    }[];
    listJobsWithSchedules(): Promise<{
        schedule: {
            nextRunAt: string | null;
        } | null;
        id: string;
        name: string;
        description: string;
        defaultScheduleCron: string | null;
    }[]>;
    runJob(params: {
        jobId: string;
        trigger: JobRunTrigger;
        dryRun: boolean;
        userId: string;
        input?: JsonObject;
    }): Promise<any>;
    private executeJobRun;
    listRuns(params: {
        userId: string;
        jobId?: string;
        take: number;
        skip: number;
    }): Promise<any>;
    getRun(params: {
        userId: string;
        runId: string;
    }): Promise<any>;
    getRunLogs(params: {
        userId: string;
        runId: string;
        take: number;
        skip: number;
    }): Promise<any>;
    clearRuns(params: {
        userId: string;
        jobId?: string;
    }): Promise<{
        deletedRuns: number;
        deletedLogs: number;
    }>;
}
