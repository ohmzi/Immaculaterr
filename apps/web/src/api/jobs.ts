import { fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS, toQuerySuffix } from '@/api/constants';

export type JobSchedule = {
  jobId: string;
  cron: string;
  enabled: boolean;
  timezone: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobDefinition = {
  id: string;
  name: string;
  description: string;
  defaultScheduleCron: string | null;
  schedule: JobSchedule | null;
};

export type JobRunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
export type JobRunTrigger = 'manual' | 'schedule' | 'auto';

export type JobRun = {
  id: string;
  jobId: string;
  trigger: JobRunTrigger;
  dryRun: boolean;
  status: JobRunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: unknown;
  errorMessage: string | null;
};

export type JobLogLine = {
  id: number;
  runId: string;
  time: string;
  level: string;
  message: string;
  context: unknown;
};

export function listJobs() {
  return fetchJson<{ jobs: JobDefinition[] }>(apiPath('/jobs'));
}

export function runJob(jobId: string, dryRun: boolean, input?: unknown) {
  return fetchJson<{ ok: true; run: JobRun }>(
    apiPath(`/jobs/${encodeURIComponent(jobId)}/run`),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        dryRun,
        ...(input !== undefined ? { input } : {}),
      }),
    },
  );
}

export function updateJobSchedule(params: {
  jobId: string;
  cron: string;
  enabled: boolean;
}) {
  const { jobId, cron, enabled } = params;
  return fetchJson<{ ok: true; schedule: JobSchedule }>(
    apiPath(`/jobs/schedules/${encodeURIComponent(jobId)}`),
    {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ cron, enabled }),
    },
  );
}

export function listRuns(params?: { jobId?: string; take?: number; skip?: number }) {
  const q = new URLSearchParams();
  if (params?.jobId) q.set('jobId', params.jobId);
  if (params?.take) q.set('take', String(params.take));
  if (params?.skip) q.set('skip', String(params.skip));

  return fetchJson<{ runs: JobRun[] }>(apiPath(`/jobs/runs${toQuerySuffix(q)}`));
}

export function clearRuns(params?: { jobId?: string }) {
  const q = new URLSearchParams();
  if (params?.jobId) q.set('jobId', params.jobId);
  return fetchJson<{ ok: true; deletedRuns: number; deletedLogs: number }>(
    apiPath(`/jobs/runs${toQuerySuffix(q)}`),
    {
      method: 'DELETE',
    },
  );
}

export function getRun(runId: string) {
  return fetchJson<{ run: JobRun }>(apiPath(`/jobs/runs/${encodeURIComponent(runId)}`));
}

export function getRunLogs(params: { runId: string; take?: number; skip?: number }) {
  const q = new URLSearchParams();
  if (params.take) q.set('take', String(params.take));
  if (params.skip) q.set('skip', String(params.skip));
  return fetchJson<{ logs: JobLogLine[] }>(
    apiPath(`/jobs/runs/${encodeURIComponent(params.runId)}/logs${toQuerySuffix(q)}`),
  );
}

