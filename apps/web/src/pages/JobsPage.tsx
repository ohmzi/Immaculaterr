import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Loader2, Play, Save, Shield } from 'lucide-react';

import { listJobs, runJob, updateJobSchedule } from '@/api/jobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// (status pill lives on Runs/Run Detail pages now)

type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

type ScheduleDraft = {
  enabled: boolean;
  timezone: string;
  frequency: ScheduleFrequency;
  time: string; // HH:MM
  dayOfWeek: string; // 0-6 (Sun-Sat)
  dayOfMonth: string; // 1-28
  advancedCron?: string | null; // present if stored cron isn't representable by simple UI
};

const DAYS_OF_WEEK: Array<{ value: string; label: string }> = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function parseTimeHHMM(time: string): { hour: number; minute: number } | null {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseSimpleCron(cron: string):
  | { frequency: ScheduleFrequency; hour: number; minute: number; dow?: number; dom?: number }
  | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minRaw, hourRaw, domRaw, monRaw, dowRaw] = parts;
  if (monRaw !== '*') return null;

  const minute = Number.parseInt(minRaw, 10);
  const hour = Number.parseInt(hourRaw, 10);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  if (minute < 0 || minute > 59) return null;
  if (hour < 0 || hour > 23) return null;

  const domIsStar = domRaw === '*';
  const dowIsStar = dowRaw === '*';

  if (domIsStar && dowIsStar) {
    return { frequency: 'daily', hour, minute };
  }

  if (domIsStar && !dowIsStar) {
    const dow = Number.parseInt(dowRaw, 10);
    if (!Number.isFinite(dow)) return null;
    const normalized = dow === 7 ? 0 : dow;
    if (normalized < 0 || normalized > 6) return null;
    return { frequency: 'weekly', hour, minute, dow: normalized };
  }

  if (!domIsStar && dowIsStar) {
    const dom = Number.parseInt(domRaw, 10);
    if (!Number.isFinite(dom)) return null;
    if (dom < 1 || dom > 31) return null;
    return { frequency: 'monthly', hour, minute, dom };
  }

  return null;
}

function buildCronFromDraft(draft: ScheduleDraft): string | null {
  const t = parseTimeHHMM(draft.time);
  if (!t) return null;

  const minute = t.minute;
  const hour = t.hour;

  if (draft.frequency === 'daily') {
    return `${minute} ${hour} * * *`;
  }

  if (draft.frequency === 'weekly') {
    const dow = Number.parseInt(draft.dayOfWeek, 10);
    if (!Number.isFinite(dow) || dow < 0 || dow > 6) return null;
    return `${minute} ${hour} * * ${dow}`;
  }

  // monthly
  const dom = Number.parseInt(draft.dayOfMonth, 10);
  if (!Number.isFinite(dom) || dom < 1 || dom > 28) return null;
  return `${minute} ${hour} ${dom} * *`;
}

function defaultDraftFromCron(params: {
  cron: string;
  enabled: boolean;
  timezone: string | null;
}): ScheduleDraft {
  const parsed = parseSimpleCron(params.cron);
  if (parsed) {
    return {
      enabled: params.enabled,
      timezone: params.timezone ?? '',
      frequency: parsed.frequency,
      time: `${pad2(parsed.hour)}:${pad2(parsed.minute)}`,
      dayOfWeek: String(parsed.dow ?? 1),
      dayOfMonth: String(Math.min(28, Math.max(1, parsed.dom ?? 1))),
      advancedCron: null,
    };
  }

  // Fallback: represent as a daily schedule. Saving will convert the advanced cron to simple.
  return {
    enabled: params.enabled,
    timezone: params.timezone ?? '',
    frequency: 'daily',
    time: '03:00',
    dayOfWeek: '1',
    dayOfMonth: '1',
    advancedCron: params.cron.trim() ? params.cron.trim() : null,
  };
}

export function JobsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, ScheduleDraft>>({});

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const runMutation = useMutation({
    mutationFn: async (params: { jobId: string; dryRun: boolean }) => runJob(params.jobId, params.dryRun),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['jobRuns'] });
      void navigate(`/jobs/runs/${data.run.id}`);
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: updateJobSchedule,
    onSuccess: async (data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setDrafts((prev) => ({
        ...prev,
        [vars.jobId]: defaultDraftFromCron({
          cron: data.schedule.cron,
          enabled: data.schedule.enabled,
          timezone: data.schedule.timezone ?? null,
        }),
      }));
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Run workflows on-demand and schedule them (MVP: Monitor Confirm + Recently Watched refresher).
        </p>
      </div>

      {jobsQuery.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading jobs…
            </CardTitle>
          </CardHeader>
        </Card>
      ) : jobsQuery.error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <CircleAlert className="h-5 w-5" />
              Failed to load jobs
            </CardTitle>
            <CardDescription className="text-destructive/80">
              {(jobsQuery.error as Error).message}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(jobsQuery.data?.jobs ?? []).map((job) => (
            <Card key={job.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span>{job.name}</span>
                  {job.id === 'monitorConfirm' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                      <Shield className="h-3.5 w-3.5" />
                      MVP
                    </span>
                  ) : null}
                </CardTitle>
                <CardDescription>{job.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const draft =
                    drafts[job.id] ??
                    defaultDraftFromCron({
                      cron: job.schedule?.cron ?? job.defaultScheduleCron ?? '',
                      enabled: job.schedule?.enabled ?? false,
                      timezone: job.schedule?.timezone ?? null,
                    });

                  const baseCron = job.schedule?.cron ?? job.defaultScheduleCron ?? '';
                  const baseEnabled = job.schedule?.enabled ?? false;
                  const baseTz = job.schedule?.timezone ?? '';
                  const computedCron = buildCronFromDraft(draft);
                  const isDirty =
                    (computedCron ? computedCron !== baseCron : false) ||
                    draft.enabled !== baseEnabled ||
                    draft.timezone !== baseTz;

                  const scheduleEnabled = job.schedule?.enabled ?? false;
                  const nextRunAt = job.schedule?.nextRunAt ?? null;

                  const isSavingSchedule =
                    scheduleMutation.isPending && scheduleMutation.variables?.jobId === job.id;
                  const scheduleError =
                    scheduleMutation.isError && scheduleMutation.variables?.jobId === job.id
                      ? (scheduleMutation.error as Error).message
                      : null;

                  return (
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">Schedule</div>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              className="h-4 w-4 accent-primary"
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [job.id]: { ...draft, enabled: e.target.checked },
                                }))
                              }
                            />
                            <span className={draft.enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}>
                              {draft.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </label>
                        </div>

                        <div className="grid gap-2">
                          <Label>Repeat</Label>
                          <div className="inline-flex w-fit rounded-full border bg-background/50 p-1 backdrop-blur">
                            {(['daily', 'weekly', 'monthly'] as ScheduleFrequency[]).map((freq) => (
                              <button
                                key={freq}
                                type="button"
                                onClick={() =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [job.id]: { ...draft, frequency: freq },
                                  }))
                                }
                                className={
                                  draft.frequency === freq
                                    ? 'rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground'
                                    : 'rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                }
                              >
                                {freq === 'daily' ? 'Daily' : freq === 'weekly' ? 'Weekly' : 'Monthly'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          {draft.frequency === 'weekly' ? (
                            <div className="grid gap-2">
                              <Label>Day of week</Label>
                              <select
                                value={draft.dayOfWeek}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [job.id]: { ...draft, dayOfWeek: e.target.value },
                                  }))
                                }
                                className="h-10 w-full rounded-xl border border-input/70 bg-background/60 px-3 text-sm backdrop-blur"
                              >
                                {DAYS_OF_WEEK.map((d) => (
                                  <option key={d.value} value={d.value}>
                                    {d.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}

                          {draft.frequency === 'monthly' ? (
                            <div className="grid gap-2">
                              <Label>Day of month</Label>
                              <select
                                value={draft.dayOfMonth}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [job.id]: { ...draft, dayOfMonth: e.target.value },
                                  }))
                                }
                                className="h-10 w-full rounded-xl border border-input/70 bg-background/60 px-3 text-sm backdrop-blur"
                              >
                                {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                              <div className="text-xs text-muted-foreground">
                                Limited to 1–28 to avoid missing dates in shorter months.
                              </div>
                            </div>
                          ) : null}

                          <div className="grid gap-2">
                            <Label>Time</Label>
                            <Input
                              type="time"
                              value={draft.time}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [job.id]: { ...draft, time: e.target.value },
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className="grid gap-2">
                          <Label>Timezone (optional)</Label>
                          <Input
                            value={draft.timezone}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [job.id]: { ...draft, timezone: e.target.value },
                              }))
                            }
                            placeholder="e.g. America/New_York"
                          />
                          <div className="text-xs text-muted-foreground">
                            Next run:{' '}
                            {scheduleEnabled && nextRunAt ? new Date(nextRunAt).toLocaleString() : '—'}
                            {isDirty ? ' (save to update)' : ''}
                          </div>
                          {draft.advancedCron ? (
                            <div className="text-xs text-muted-foreground">
                              This job was previously set using an advanced cron pattern and will be converted when you save.
                            </div>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            onClick={() =>
                              (() => {
                                const cron = buildCronFromDraft(draft);
                                if (!cron) return;
                                scheduleMutation.mutate({
                                  jobId: job.id,
                                  cron,
                                  enabled: draft.enabled,
                                  timezone: draft.timezone.trim() ? draft.timezone.trim() : null,
                                });
                              })()
                            }
                            disabled={!buildCronFromDraft(draft) || isSavingSchedule}
                          >
                            {isSavingSchedule ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Saving…
                              </>
                            ) : (
                              <>
                                <Save className="h-4 w-4" />
                                Save schedule
                              </>
                            )}
                          </Button>

                          {isDirty ? (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [job.id]: defaultDraftFromCron({
                                    cron: baseCron,
                                    enabled: baseEnabled,
                                    timezone: baseTz || null,
                                  }),
                                }))
                              }
                              disabled={isSavingSchedule}
                            >
                              Reset
                            </Button>
                          ) : null}
                        </div>

                        {scheduleError ? (
                          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                            {scheduleError}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => runMutation.mutate({ jobId: job.id, dryRun: true })}
                    disabled={runMutation.isPending}
                  >
                    <Play className="h-4 w-4" />
                    Dry-run
                  </Button>
                  <Button
                    onClick={() => runMutation.mutate({ jobId: job.id, dryRun: false })}
                    disabled={runMutation.isPending}
                  >
                    <Play className="h-4 w-4" />
                    Run
                  </Button>
                </div>

                {runMutation.isError && runMutation.variables?.jobId === job.id ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    {(runMutation.error as Error).message}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="text-sm text-muted-foreground">
        Need history? Go to <Link className="underline-offset-4 hover:underline" to="/runs">Runs</Link>.
      </div>
    </div>
  );
}


