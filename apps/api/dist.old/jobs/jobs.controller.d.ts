import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
type RunJobBody = {
    dryRun?: unknown;
    input?: unknown;
};
type UpsertScheduleBody = {
    cron?: unknown;
    enabled?: unknown;
    timezone?: unknown;
};
export declare class JobsController {
    private readonly jobsService;
    private readonly jobsScheduler;
    constructor(jobsService: JobsService, jobsScheduler: JobsScheduler);
    listJobs(): Promise<{
        jobs: {
            schedule: {
                nextRunAt: string | null;
            } | null;
            id: string;
            name: string;
            description: string;
            defaultScheduleCron: string | null;
        }[];
    }>;
    runJob(req: AuthenticatedRequest, jobId: string, body: RunJobBody): Promise<{
        ok: boolean;
        run: any;
    }>;
    listRuns(req: AuthenticatedRequest, jobId?: string, takeRaw?: string, skipRaw?: string): Promise<{
        runs: any;
    }>;
    clearRuns(req: AuthenticatedRequest, jobIdRaw?: string): Promise<{
        deletedRuns: number;
        deletedLogs: number;
        ok: boolean;
    }>;
    getRun(req: AuthenticatedRequest, runId: string): Promise<{
        run: any;
    }>;
    getRunLogs(req: AuthenticatedRequest, runId: string, takeRaw?: string, skipRaw?: string): Promise<{
        logs: any;
    }>;
    upsertSchedule(jobId: string, body: UpsertScheduleBody): Promise<{
        ok: boolean;
        schedule: any;
    }>;
}
export {};
