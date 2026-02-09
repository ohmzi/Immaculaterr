import type { JobRunTrigger, JsonObject, JsonValue } from './jobs.types';
export type JobReportIssueLevel = 'warn' | 'error';
export type JobReportTaskStatus = 'success' | 'skipped' | 'failed';
export type JobReportMetricRow = {
    label: string;
    start: number | null;
    changed: number | null;
    end: number | null;
    unit?: string;
    note?: string;
};
export type JobReportSection = {
    id: string;
    title: string;
    rows: JobReportMetricRow[];
};
export type JobReportIssue = {
    level: JobReportIssueLevel;
    message: string;
};
export type JobReportTask = {
    id: string;
    title: string;
    status: JobReportTaskStatus;
    rows?: JobReportMetricRow[];
    facts?: Array<{
        label: string;
        value: JsonValue;
    }>;
    issues?: JobReportIssue[];
};
export type JobReportV1 = {
    template: 'jobReportV1';
    version: 1;
    jobId: string;
    dryRun: boolean;
    trigger: JobRunTrigger;
    headline: string;
    sections: JobReportSection[];
    tasks: JobReportTask[];
    issues: JobReportIssue[];
    raw: JsonObject;
};
export declare function metricRow(params: {
    label: string;
    start?: number | null;
    changed?: number | null;
    end?: number | null;
    unit?: string | null;
    note?: string | null;
}): JobReportMetricRow;
export declare function issue(level: JobReportIssueLevel, message: string): JobReportIssue;
export declare function issuesFromWarnings(warnings: unknown): JobReportIssue[];
export declare function issuesFromErrorMessage(errorMessage: unknown): JobReportIssue[];
