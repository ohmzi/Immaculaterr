export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ServerLogEntry = {
    id: number;
    time: string;
    level: ServerLogLevel;
    message: string;
    context: string | null;
};
export declare function clearServerLogs(): void;
export declare function pruneServerLogsOlderThan(cutoff: Date): {
    removed: number;
    kept: number;
};
export declare function addServerLog(params: {
    level: ServerLogLevel;
    message: unknown;
    stack?: unknown;
    context?: unknown;
}): void;
export declare function listServerLogs(params?: {
    afterId?: number;
    limit?: number;
}): {
    logs: ServerLogEntry[];
    latestId: number;
};
