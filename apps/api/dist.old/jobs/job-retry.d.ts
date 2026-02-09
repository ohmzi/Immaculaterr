import type { JobContext, JsonObject } from './jobs.types';
export type JobRetryOptions = {
    label: string;
    ctx?: JobContext;
    meta?: JsonObject;
    attempts?: number;
    delayMs?: number;
};
export declare function withJobRetry<T>(fn: () => Promise<T>, options: JobRetryOptions): Promise<T>;
export declare function withJobRetryOrNull<T>(fn: () => Promise<T>, options: JobRetryOptions): Promise<T | null>;
