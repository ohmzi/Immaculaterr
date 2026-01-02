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
