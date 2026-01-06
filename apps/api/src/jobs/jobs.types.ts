export type JobRunTrigger = 'manual' | 'schedule';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type JobRunResult = {
  summary?: JsonObject;
};

export type JobLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type JobContext = {
  jobId: string;
  runId: string;
  userId: string;
  dryRun: boolean;
  trigger: JobRunTrigger;
  input?: JsonObject;
  /**
   * Current persisted run summary snapshot (best-effort).
   * Jobs can use this to keep the UI "Summary" section live while a job runs.
   */
  getSummary: () => JsonObject | null;
  /**
   * Replace the entire run summary snapshot (persists to DB).
   * Prefer `patchSummary` for incremental updates.
   */
  setSummary: (summary: JsonObject | null) => Promise<void>;
  /**
   * Shallow-merge into the current summary snapshot (persists to DB).
   * Note: This is a shallow merge; callers should provide complete nested objects
   * when updating `radarr`, `sonarr`, etc.
   */
  patchSummary: (patch: JsonObject) => Promise<void>;
  log: (
    level: JobLogLevel,
    message: string,
    context?: JsonObject,
  ) => Promise<void>;
  debug: (message: string, context?: JsonObject) => Promise<void>;
  info: (message: string, context?: JsonObject) => Promise<void>;
  warn: (message: string, context?: JsonObject) => Promise<void>;
  error: (message: string, context?: JsonObject) => Promise<void>;
};

export type JobDefinition = {
  id: string;
  name: string;
  description: string;
  defaultScheduleCron?: string;
  run: (ctx: JobContext) => Promise<JobRunResult>;
};
