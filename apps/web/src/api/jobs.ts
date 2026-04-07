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
  visibleInTaskManager: boolean;
  visibleInRewind: boolean;
  rewindDisplayName: string;
  defaultEstimatedRuntimeMs: number;
  schedule: JobSchedule | null;
};

export type JobRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED';
export type JobRunTrigger = 'manual' | 'schedule' | 'auto';

export type JobRun = {
  id: string;
  jobId: string;
  trigger: JobRunTrigger;
  dryRun: boolean;
  status: JobRunStatus;
  startedAt: string;
  queuedAt: string;
  executionStartedAt: string | null;
  finishedAt: string | null;
  summary: unknown;
  errorMessage: string | null;
  jobName: string;
  rewindDisplayName: string;
  visibleInTaskManager: boolean;
  visibleInRewind: boolean;
};

export type QueueEstimateSource =
  | 'median_success'
  | 'median_terminal'
  | 'log_backfill'
  | 'job_default';

export type QueueEstimateState =
  | 'estimated'
  | 'cooldown'
  | 'delayed'
  | 'finishing_soon';

export type QueueEtaConfidence = 'high' | 'medium' | 'fallback';

export type QueueBlockedReason =
  | 'waiting_for_active_run'
  | 'cooldown'
  | 'hidden_blocker_ahead'
  | 'queue_paused';

export type JobQueueRun = JobRun & {
  queuePosition: number;
  runsAheadTotal: number;
  runsAheadVisible: number;
  runsAheadHidden: number;
  estimatedRuntimeMs: number;
  estimatedWaitMs: number;
  estimatedStartAt: string;
  estimateSource: QueueEstimateSource;
  estimateState: QueueEstimateState;
  etaConfidence: QueueEtaConfidence;
  blockedReason: QueueBlockedReason | null;
  redacted?: boolean;
};

export type JobQueueSnapshot = {
  activeRun: JobQueueRun | null;
  pendingRuns: JobQueueRun[];
  cooldownUntil: string | null;
  pendingCountTotal: number;
  pendingCountVisible: number;
  oldestPendingAgeMs: number;
  delayedRunCount: number;
  paused: boolean;
  pauseReason: string | null;
  stalledPendingCount: number;
  health: 'ok' | 'warn' | 'error';
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

export function cancelRun(runId: string, reason?: string) {
  return fetchJson<{ ok: true; run: JobRun }>(
    apiPath(`/jobs/runs/${encodeURIComponent(runId)}/cancel`),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
}

export function getRunLogs(params: { runId: string; take?: number; skip?: number }) {
  const q = new URLSearchParams();
  if (params.take) q.set('take', String(params.take));
  if (params.skip) q.set('skip', String(params.skip));
  return fetchJson<{ logs: JobLogLine[] }>(
    apiPath(`/jobs/runs/${encodeURIComponent(params.runId)}/logs${toQuerySuffix(q)}`),
  );
}

export function getQueueSnapshot() {
  return fetchJson<JobQueueSnapshot>(apiPath('/jobs/queue'));
}

export function pauseQueue(reason?: string) {
  return fetchJson<{ ok: true }>(apiPath('/jobs/queue/pause'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export function resumeQueue() {
  return fetchJson<{ ok: true }>(apiPath('/jobs/queue/resume'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({}),
  });
}
