export declare class LogsController {
    getLogs(afterIdRaw?: string, limitRaw?: string): {
        logs: import("./server-logs.store").ServerLogEntry[];
        latestId: number;
        ok: boolean;
    };
    clear(): {
        ok: boolean;
    };
}
