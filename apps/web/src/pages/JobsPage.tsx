import { useState } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Loader2, Play, Save } from 'lucide-react';

import { listJobs, runJob, updateJobSchedule } from '@/api/jobs';
// (status pill lives on History/Detail pages now)

type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

type ScheduleDraft = {
  enabled: boolean;
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
}): ScheduleDraft {
  const parsed = parseSimpleCron(params.cron);
  if (parsed) {
    return {
      enabled: params.enabled,
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
      void navigate(`/history/${data.run.id}`);
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
        }),
      }));
    },
  });

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const cardHeaderClass = 'flex items-start justify-between gap-4 mb-6 min-h-[44px]';
  const cardTitleClass = 'text-2xl font-semibold text-white';
  const labelClass = 'block text-sm font-medium text-white/70 mb-2';
  const inputBaseClass =
    'px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-400/70 focus:border-transparent outline-none transition';
  const inputClass = `w-full ${inputBaseClass}`;
  const selectClass = `w-full ${inputBaseClass}`;

  const primaryButtonClass =
    'px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-full active:scale-95 transition-all duration-300 flex items-center gap-2 min-h-[44px] font-medium disabled:opacity-50 disabled:cursor-not-allowed';
  const secondaryButtonClass =
    'px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-full active:scale-95 transition-all duration-300 flex items-center gap-2 min-h-[44px] font-medium border border-white/15 disabled:opacity-50 disabled:cursor-not-allowed';
  const ghostButtonClass =
    'px-4 py-2 bg-transparent hover:bg-white/10 text-white/80 rounded-full active:scale-95 transition-all duration-300 flex items-center gap-2 min-h-[44px] font-medium disabled:opacity-50 disabled:cursor-not-allowed';

  const toggleTrackClass = (enabled: boolean) =>
    `relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95 ${
      enabled ? 'bg-yellow-400' : 'bg-white/15'
    }`;
  const toggleThumbClass = (enabled: boolean) =>
    `inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
      enabled ? 'translate-x-6' : 'translate-x-1'
    }`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Background (landing-page style, green-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/45 via-teal-600/45 to-indigo-900/60" />
        <div className="absolute inset-0 bg-[#0b0c0f]/15" />
      </div>

      {/* Jobs Content */}
      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-10">
        <div className="container mx-auto px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-5xl mx-auto"
          >
            {/* Page Header */}
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-white mb-2">Jobs</h1>
              <p className="text-lg text-white/70">
                Run workflows on-demand and schedule them.
              </p>
            </div>

            {jobsQuery.isLoading ? (
              <div className={cardClass}>
                <div className="flex items-center gap-2 text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <div className="text-lg font-semibold">Loading jobs…</div>
                </div>
              </div>
            ) : jobsQuery.error ? (
              <div className={`${cardClass} border-red-500/25 bg-[#0b0c0f]/70`}>
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 text-red-300" />
                  <div className="min-w-0">
                    <div className="text-white font-semibold">Failed to load jobs</div>
                    <div className="text-sm text-white/70">
                      {(jobsQuery.error as Error).message}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-6">
                {(jobsQuery.data?.jobs ?? []).map((job, idx) => {
                  const baseCron = job.schedule?.cron ?? job.defaultScheduleCron ?? '';
                  const baseEnabled = job.schedule?.enabled ?? false;

                  const draft =
                    drafts[job.id] ??
                    defaultDraftFromCron({
                      cron: baseCron,
                      enabled: baseEnabled,
                    });

                  const computedCron = buildCronFromDraft(draft);
                  const isDirty =
                    (computedCron ? computedCron !== baseCron : false) ||
                    draft.enabled !== baseEnabled;

                  const scheduleEnabled = job.schedule?.enabled ?? false;
                  const nextRunAt = job.schedule?.nextRunAt ?? null;

                  const isSavingSchedule =
                    scheduleMutation.isPending &&
                    scheduleMutation.variables?.jobId === job.id;
                  const scheduleError =
                    scheduleMutation.isError && scheduleMutation.variables?.jobId === job.id
                      ? (scheduleMutation.error as Error).message
                      : null;

                  const isRunningJob =
                    runMutation.isPending && runMutation.variables?.jobId === job.id;
                  const runError =
                    runMutation.isError && runMutation.variables?.jobId === job.id
                      ? (runMutation.error as Error).message
                      : null;

                  return (
                    <motion.div
                      key={job.id}
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.55, delay: Math.min(0.25, idx * 0.05) }}
                      className={cardClass}
                    >
                      <div className={cardHeaderClass}>
                        <div className="min-w-0">
                          <h2 className={cardTitleClass}>{job.name}</h2>
                          <p className="mt-2 text-sm text-white/70">
                            {job.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={draft.enabled}
                            onClick={() => {
                              const newEnabled = !draft.enabled;
                              
                              if (newEnabled) {
                                // If enabling, auto-save with default daily 3am schedule
                                // This enables the job immediately with default timing
                                const defaultCron = '0 3 * * *'; // Daily at 3am
                                
                                // Create default draft with daily 3am schedule
                                const defaultDraft = defaultDraftFromCron({
                                  cron: defaultCron,
                                  enabled: true,
                                });
                                
                                // Update local state with default schedule
                                setDrafts((prev) => ({
                                  ...prev,
                                  [job.id]: defaultDraft,
                                }));
                                
                                // Auto-save with default schedule so job is enabled
                                // If user modifies and doesn't save, default continues to work
                                scheduleMutation.mutate({
                                  jobId: job.id,
                                  cron: defaultCron,
                                  enabled: true,
                                });
                              } else {
                                // If disabling, save immediately
                                const cron = buildCronFromDraft(draft) || baseCron || job.defaultScheduleCron || '0 3 * * *';
                                
                                // Update local state
                                setDrafts((prev) => ({
                                  ...prev,
                                  [job.id]: { ...draft, enabled: false },
                                }));
                                
                                // Automatically save when disabling
                                scheduleMutation.mutate({
                                  jobId: job.id,
                                  cron,
                                  enabled: false,
                                });
                              }
                            }}
                            disabled={scheduleMutation.isPending && scheduleMutation.variables?.jobId === job.id}
                            className={toggleTrackClass(draft.enabled)}
                            aria-label={`Toggle schedule for ${job.name}`}
                          >
                            <span className={toggleThumbClass(draft.enabled)} />
                          </button>
                        </div>
                      </div>

                      {/* Schedule */}
                      {draft.enabled && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white/85">Schedule</div>
                            <div className="text-xs text-white/55">
                              Enabled
                            </div>
                          </div>

                          <div className="mt-4 space-y-4">
                            <div>
                              <div className={labelClass}>Repeat</div>
                              <div className="inline-flex w-fit rounded-full border border-white/15 bg-white/10 p-1 backdrop-blur">
                                {(['daily', 'weekly', 'monthly'] as ScheduleFrequency[]).map(
                                  (freq) => (
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
                                          ? 'rounded-full bg-yellow-400 px-3 py-1.5 text-xs font-semibold text-gray-900'
                                          : 'rounded-full px-3 py-1.5 text-xs font-semibold text-white/60 hover:bg-white/10 hover:text-white'
                                      }
                                    >
                                      {freq === 'daily'
                                        ? 'Daily'
                                        : freq === 'weekly'
                                          ? 'Weekly'
                                          : 'Monthly'}
                                    </button>
                                  ),
                                )}
                              </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              {draft.frequency === 'weekly' ? (
                                <div>
                                  <label className={labelClass}>Day of week</label>
                                  <select
                                    value={draft.dayOfWeek}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [job.id]: { ...draft, dayOfWeek: e.target.value },
                                      }))
                                    }
                                    className={selectClass}
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
                                <div>
                                  <label className={labelClass}>Day of month</label>
                                  <select
                                    value={draft.dayOfMonth}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [job.id]: { ...draft, dayOfMonth: e.target.value },
                                      }))
                                    }
                                    className={selectClass}
                                  >
                                    {Array.from({ length: 28 }, (_, i) => String(i + 1)).map(
                                      (n) => (
                                        <option key={n} value={n}>
                                          {n}
                                        </option>
                                      ),
                                    )}
                                  </select>
                                  <div className="mt-2 text-xs text-white/55">
                                    Limited to 1–28 to avoid missing dates in shorter months.
                                  </div>
                                </div>
                              ) : null}

                              <div>
                                <label className={labelClass}>Time</label>
                                <input
                                  type="time"
                                  value={draft.time}
                                  onChange={(e) =>
                                    setDrafts((prev) => ({
                                      ...prev,
                                      [job.id]: { ...draft, time: e.target.value },
                                    }))
                                  }
                                  className={inputClass}
                                />
                              </div>
                            </div>

                            <div>
                              <div className="mt-2 text-xs text-white/55">
                                Next run:{' '}
                                {scheduleEnabled && nextRunAt
                                  ? new Date(nextRunAt).toLocaleString()
                                  : '—'}
                                {isDirty ? ' (save to update)' : ''}
                              </div>
                              {draft.advancedCron ? (
                                <div className="mt-2 text-xs text-white/55">
                                  This job was previously set using an advanced cron pattern and
                                  will be converted when you save.
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {isDirty && (
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const cron = buildCronFromDraft(draft);
                                  if (!cron) return;
                                  scheduleMutation.mutate({
                                    jobId: job.id,
                                    cron,
                                    enabled: draft.enabled,
                                  });
                                }}
                                disabled={!computedCron || isSavingSchedule}
                                className={secondaryButtonClass}
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
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [job.id]: defaultDraftFromCron({
                                      cron: baseCron,
                                      enabled: baseEnabled,
                                    }),
                                  }))
                                }
                                disabled={isSavingSchedule}
                                className={ghostButtonClass}
                              >
                                Reset
                              </button>
                            </div>
                          )}

                          {scheduleError ? (
                            <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                              {scheduleError}
                            </div>
                          ) : null}
                        </div>
                      )}

                      {/* Run controls */}
                      <div className="mt-5 pt-5 border-t border-white/10 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            runMutation.mutate({ jobId: job.id, dryRun: true })
                          }
                          disabled={runMutation.isPending}
                          className={secondaryButtonClass}
                        >
                          <Play className="h-4 w-4" />
                          Dry-run
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runMutation.mutate({ jobId: job.id, dryRun: false })
                          }
                          disabled={runMutation.isPending}
                          className={primaryButtonClass}
                        >
                          <Play className="h-4 w-4" />
                          Run
                        </button>

                        {isRunningJob ? (
                          <div className="text-sm text-white/60 flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Starting…
                          </div>
                        ) : null}
                      </div>

                      {runError ? (
                        <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                          {runError}
                        </div>
                      ) : null}
                    </motion.div>
                  );
                })}
              </div>
            )}

            <div className="mt-8 text-sm text-white/70">
              Need history? Go to{' '}
              <Link className="text-white underline-offset-4 hover:underline" to="/history">
                History
              </Link>
              .
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}


