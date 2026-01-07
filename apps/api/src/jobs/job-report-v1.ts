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
  facts?: Array<{ label: string; value: JsonValue }>;
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
  /**
   * Job-specific, unstructured output preserved for debugging/back-compat.
   * This should never be treated as a stable contract by the UI.
   */
  raw: JsonObject;
};

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function metricRow(params: {
  label: string;
  start?: number | null;
  changed?: number | null;
  end?: number | null;
  unit?: string | null;
  note?: string | null;
}): JobReportMetricRow {
  const row: JobReportMetricRow = {
    label: params.label,
    start: asFiniteNumber(params.start),
    changed: asFiniteNumber(params.changed),
    end: asFiniteNumber(params.end),
  };
  const unit = (params.unit ?? '').trim();
  if (unit) row.unit = unit;
  const note = (params.note ?? '').trim();
  if (note) row.note = note;
  return row;
}

export function issue(level: JobReportIssueLevel, message: string): JobReportIssue {
  return { level, message: String(message ?? '').trim() };
}

export function issuesFromWarnings(warnings: unknown): JobReportIssue[] {
  if (!Array.isArray(warnings)) return [];
  const out: JobReportIssue[] = [];
  for (const w of warnings) {
    const msg = String(w ?? '').trim();
    if (!msg) continue;
    out.push(issue('warn', msg));
  }
  return out;
}

export function issuesFromErrorMessage(errorMessage: unknown): JobReportIssue[] {
  const msg = String(errorMessage ?? '').trim();
  if (!msg) return [];
  return [issue('error', msg)];
}



