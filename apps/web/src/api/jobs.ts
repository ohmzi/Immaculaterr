import { fetchJson } from '@/api/http';

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
export type JobRunTrigger = 'manual' | 'schedule';

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
  return fetchJson<{ jobs: JobDefinition[] }>('/api/jobs');
}

export function runJob(jobId: string, dryRun: boolean) {
  return fetchJson<{ ok: true; run: JobRun }>(`/api/jobs/${encodeURIComponent(jobId)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun }),
  });
}

export function updateJobSchedule(params: {
  jobId: string;
  cron: string;
  enabled: boolean;
  timezone?: string | null;
}) {
  const { jobId, cron, enabled, timezone } = params;
  return fetchJson<{ ok: true; schedule: JobSchedule }>(
    `/api/jobs/schedules/${encodeURIComponent(jobId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron, enabled, timezone }),
    },
  );
}

export function listRuns(params?: { jobId?: string; take?: number; skip?: number }) {
  const q = new URLSearchParams();
  if (params?.jobId) q.set('jobId', params.jobId);
  if (params?.take) q.set('take', String(params.take));
  if (params?.skip) q.set('skip', String(params.skip));

  const suffix = q.toString() ? `?${q.toString()}` : '';
  return fetchJson<{ runs: JobRun[] }>(`/api/jobs/runs${suffix}`);
}

export function getRun(runId: string) {
  return fetchJson<{ run: JobRun }>(`/api/jobs/runs/${encodeURIComponent(runId)}`);
}

export function getRunLogs(params: { runId: string; take?: number; skip?: number }) {
  const q = new URLSearchParams();
  if (params.take) q.set('take', String(params.take));
  if (params.skip) q.set('skip', String(params.skip));
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return fetchJson<{ logs: JobLogLine[] }>(
    `/api/jobs/runs/${encodeURIComponent(params.runId)}/logs${suffix}`,
  );
}


