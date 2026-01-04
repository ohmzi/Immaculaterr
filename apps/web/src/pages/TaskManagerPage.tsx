import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  Loader2,
  Play,
  X,
  Terminal as TerminalIcon,
  MonitorPlay,
  RotateCw,
  CheckCircle2,
  Clock,
  CalendarDays,
  ChevronRight,
  ChevronDown,
  Zap,
  Sparkles,
} from 'lucide-react';

import { listJobs, runJob, updateJobSchedule, listRuns } from '@/api/jobs';
import { cn } from '@/components/ui/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AnalogTimePicker } from '@/components/AnalogTimePicker';
import { Badge } from '@/components/ui/badge';

type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

type ScheduleDraft = {
  enabled: boolean;
  frequency: ScheduleFrequency;
  time: string; // HH:MM
  daysOfWeek: string[]; // ['0', '1', ...] (Sun-Sat) for weekly
  daysOfMonth: string[]; // ['1', '2', ...] (1-28) for monthly
  advancedCron?: string | null; // present if stored cron isn't representable by simple UI
};

const DAYS_OF_WEEK: Array<{ value: string; label: string; short: string }> = [
  { value: '0', label: 'Sunday', short: 'Sun' },
  { value: '1', label: 'Monday', short: 'Mon' },
  { value: '2', label: 'Tuesday', short: 'Tue' },
  { value: '3', label: 'Wednesday', short: 'Wed' },
  { value: '4', label: 'Thursday', short: 'Thu' },
  { value: '5', label: 'Friday', short: 'Fri' },
  { value: '6', label: 'Saturday', short: 'Sat' },
];

const JOB_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; description: string }
> = {
  monitorConfirm: {
    icon: <MonitorPlay className="w-8 h-8" />,
    color: 'text-blue-400',
    description:
      'Scans your Plex library and verifies which movies and TV shows should remain monitored.',
  },
  recentlyWatchedRefresher: {
    icon: <RotateCw className="w-8 h-8" />,
    color: 'text-emerald-400',
    description:
      'Shuffles your Plex home screen collections, giving you more chances to discover a new movie or TV show.',
  },
  immaculateTastePoints: {
    icon: <Sparkles className="w-8 h-8" />,
    color: 'text-yellow-300',
    description:
      'Triggered when Plex reports you finished a movie. Updates your Immaculate Taste points dataset and optionally sends missing movies to Radarr.',
  },
  immaculateTasteRefresher: {
    icon: <CalendarDays className="w-8 h-8" />,
    color: 'text-sky-300',
    description:
      'Off-peak refresh of your “Inspired by your Immaculate Taste” collection from the points dataset. This can take a while for large collections.',
  },
  watchedMovieRecommendations: {
    icon: <Sparkles className="w-8 h-8" />,
    color: 'text-violet-400',
    description:
      'Triggered when Plex reports you finished a movie. Generates fresh recommendations and rebuilds your curated collections.',
  },
  noop: {
    icon: <Zap className="w-8 h-8" />,
    color: 'text-[#facc15]',
    description:
      'Runs a quick no-op cycle to validate the job runner, event loop latency, and database connectivity.',
  },
};

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
  | {
      frequency: ScheduleFrequency;
      hour: number;
      minute: number;
      daysOfWeek?: number[];
      daysOfMonth?: number[];
    }
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
    // Weekly - could be multiple days comma-separated
    const dowValues = dowRaw.split(',').map((d) => {
      const dow = Number.parseInt(d, 10);
      const normalized = dow === 7 ? 0 : dow;
      return normalized;
    });
    if (dowValues.some((d) => !Number.isFinite(d) || d < 0 || d > 6)) return null;
    return { frequency: 'weekly', hour, minute, daysOfWeek: dowValues };
  }

  if (!domIsStar && dowIsStar) {
    // Monthly - could be multiple days comma-separated
    const domValues = domRaw.split(',').map((d) => Number.parseInt(d, 10));
    if (domValues.some((d) => !Number.isFinite(d) || d < 1 || d > 31)) return null;
    return { frequency: 'monthly', hour, minute, daysOfMonth: domValues };
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
    const dows = draft.daysOfWeek.map((d) => Number.parseInt(d, 10));
    if (dows.some((d) => !Number.isFinite(d) || d < 0 || d > 6)) return null;
    if (dows.length === 0) return null;
    return `${minute} ${hour} * * ${dows.sort((a, b) => a - b).join(',')}`;
  }

  // monthly
  const doms = draft.daysOfMonth.map((d) => Number.parseInt(d, 10));
  if (doms.some((d) => !Number.isFinite(d) || d < 1 || d > 28)) return null;
  if (doms.length === 0) return null;
  return `${minute} ${hour} ${doms.sort((a, b) => a - b).join(',')} * *`;
}

function defaultDraftFromCron(params: { cron: string; enabled: boolean }): ScheduleDraft {
  const parsed = parseSimpleCron(params.cron);
  if (parsed) {
    return {
      enabled: params.enabled,
      frequency: parsed.frequency,
      time: `${pad2(parsed.hour)}:${pad2(parsed.minute)}`,
      daysOfWeek: parsed.daysOfWeek?.map(String) ?? ['1'],
      daysOfMonth: parsed.daysOfMonth?.map((d) => String(Math.min(28, d))) ?? ['1'],
      advancedCron: null,
    };
  }

  // Fallback: represent as a daily schedule. Saving will convert the advanced cron to simple.
  return {
    enabled: params.enabled,
    frequency: 'daily',
    time: '03:00',
    daysOfWeek: ['1'],
    daysOfMonth: ['1'],
    advancedCron: params.cron.trim() ? params.cron.trim() : null,
  };
}

function formatTimeDisplay(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function calculateNextRuns(draft: ScheduleDraft, count: number = 5): Date[] {
  const t = parseTimeHHMM(draft.time);
  if (!t) return [];

  const runs: Date[] = [];
  const now = new Date();
  let current = new Date(now);

  // Start from tomorrow if current time has passed
  if (current.getHours() > t.hour || (current.getHours() === t.hour && current.getMinutes() >= t.minute)) {
    current.setDate(current.getDate() + 1);
  }
  current.setHours(t.hour, t.minute, 0, 0);

  const maxDays = 365; // Safety limit
  let daysChecked = 0;

  while (runs.length < count && daysChecked < maxDays) {
    let matches = false;

    if (draft.frequency === 'daily') {
      matches = true;
    } else if (draft.frequency === 'weekly') {
      const dow = current.getDay();
      matches = draft.daysOfWeek.includes(String(dow));
    } else if (draft.frequency === 'monthly') {
      const dom = current.getDate();
      matches = draft.daysOfMonth.includes(String(dom));
    }

    if (matches) {
      runs.push(new Date(current));
    }

    current.setDate(current.getDate() + 1);
    daysChecked++;
  }

  return runs;
}

export function TaskManagerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [terminalState, setTerminalState] = useState<
    Record<string, { status: 'idle' | 'running' | 'completed'; runId?: string }>
  >({});
  const [weeklyDaySelector, setWeeklyDaySelector] = useState<Record<string, boolean>>({});
  const [monthlyDaySelector, setMonthlyDaySelector] = useState<Record<string, boolean>>({});
  const [nextRunsPopup, setNextRunsPopup] = useState<Record<string, boolean>>({});
  const [timePickerOpen, setTimePickerOpen] = useState<Record<string, boolean>>({});

  // Manual test harness (movie-seeded jobs)
  const [movieSeedDialogOpen, setMovieSeedDialogOpen] = useState(false);
  const [movieSeedDialogJobId, setMovieSeedDialogJobId] = useState<string | null>(null);
  const [movieSeedTitle, setMovieSeedTitle] = useState('');
  const [movieSeedYear, setMovieSeedYear] = useState('');
  const [movieSeedError, setMovieSeedError] = useState<string | null>(null);
  const movieSeedTitleRef = useRef<HTMLInputElement | null>(null);

  // Close all popups when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setWeeklyDaySelector({});
      setMonthlyDaySelector({});
      setNextRunsPopup({});
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!movieSeedDialogOpen) return;
    // Let the dialog mount before focusing.
    const t = setTimeout(() => movieSeedTitleRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [movieSeedDialogOpen]);

  useEffect(() => {
    if (!movieSeedDialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMovieSeedDialogOpen(false);
        setMovieSeedDialogJobId(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [movieSeedDialogOpen]);

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const runMutation = useMutation({
    mutationFn: async (params: { jobId: string; dryRun: boolean; input?: unknown }) =>
      runJob(params.jobId, params.dryRun, params.input),
    onSuccess: async (data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['jobRuns'] });

      // Keep terminal in running state and store the run ID
      setTerminalState((prev) => ({
        ...prev,
        [vars.jobId]: { status: 'running', runId: data.run.id },
      }));
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

  // Check for recent runs on mount and when jobs change
  useEffect(() => {
    if (!jobsQuery.data?.jobs) return;

    const checkRecentRuns = async () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

      for (const job of jobsQuery.data.jobs) {
        try {
          const { runs } = await listRuns({ jobId: job.id, take: 1 });
          if (runs.length === 0) continue;

          const latestRun = runs[0];
          const runTime = new Date(latestRun.startedAt).getTime();

          // Only consider runs from the last 5 minutes
          if (runTime < fiveMinutesAgo) continue;

          // Set terminal state based on run status
          if (latestRun.status === 'RUNNING' || latestRun.status === 'PENDING') {
            setTerminalState((prev) => ({
              ...prev,
              [job.id]: { status: 'running', runId: latestRun.id },
            }));
          } else if (latestRun.status === 'SUCCESS' || latestRun.status === 'FAILED') {
            setTerminalState((prev) => ({
              ...prev,
              [job.id]: { status: 'completed', runId: latestRun.id },
            }));
          }
        } catch (error) {
          console.error(`Failed to fetch runs for job ${job.id}:`, error);
        }
      }
    };

    void checkRecentRuns();
  }, [jobsQuery.data?.jobs]);

  // Poll for running jobs to update their status
  useEffect(() => {
    const runningJobs = Object.entries(terminalState).filter(
      ([, state]) => state.status === 'running'
    );

    if (runningJobs.length === 0) return;

    const pollInterval = setInterval(async () => {
      for (const [jobId, state] of runningJobs) {
        if (!state.runId) continue;

        try {
          const { runs } = await listRuns({ jobId, take: 1 });
          if (runs.length === 0) continue;

          const latestRun = runs[0];
          if (latestRun.id !== state.runId) continue;

          // Update terminal state if job completed
          if (latestRun.status === 'SUCCESS' || latestRun.status === 'FAILED') {
            setTerminalState((prev) => ({
              ...prev,
              [jobId]: { status: 'completed', runId: latestRun.id },
            }));
          }
        } catch (error) {
          console.error(`Failed to poll job ${jobId}:`, error);
        }
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [terminalState]);

  // Auto-save schedule changes with debounce
  useEffect(() => {
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    Object.entries(drafts).forEach(([jobId, draft]) => {
      const job = jobsQuery.data?.jobs.find((j) => j.id === jobId);
      if (!job) return;

      const baseCron = job.schedule?.cron ?? job.defaultScheduleCron ?? '';
      const baseEnabled = job.schedule?.enabled ?? false;
      const computedCron = buildCronFromDraft(draft);

      const isDirty =
        (computedCron ? computedCron !== baseCron : false) || draft.enabled !== baseEnabled;

      if (isDirty && computedCron) {
        const timeoutId = setTimeout(() => {
          scheduleMutation.mutate({
            jobId,
            cron: computedCron,
            enabled: draft.enabled,
          });
        }, 1000); // 1 second debounce

        timeoutIds.push(timeoutId);
      }
    });

    return () => {
      timeoutIds.forEach((id) => clearTimeout(id));
    };
  }, [drafts, jobsQuery.data?.jobs]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 text-white font-sans selection:bg-[#facc15] selection:text-black">
      {/* Background (landing-page style, teal-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-teal-900/50 via-cyan-900/60 to-slate-900/70" />
        <div className="absolute inset-0 bg-[#0b0c0f]/15" />
      </div>

      {/* Task Manager Content */}
      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16">
        <div className="container mx-auto px-4 pb-20 max-w-5xl">
        <div className="mb-12">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-5">
              <div className="relative group">
                <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                <div className="relative p-3 md:p-4 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_30px_rgba(250,204,21,0.3)] border border-white/20 group-hover:rotate-0 transition-transform duration-300 ease-spring">
                  <TerminalIcon
                    className="w-8 h-8 md:w-10 md:h-10 text-black"
                    strokeWidth={2.5}
                  />
                </div>
              </div>
              <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                Task Manager
              </h1>
            </div>

            <p className="text-purple-200/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
              <span className="text-[#facc15] font-bold">Automate</span> your media empire. <br />
              <span className="text-sm opacity-60 font-normal">
                Schedule workflows, run diagnostics, and keep the lights on.
              </span>
            </p>
          </motion.div>
        </div>

        {jobsQuery.isLoading ? (
          <div className="rounded-[32px] bg-[#1a1625]/60 backdrop-blur-xl border border-white/5 p-8">
            <div className="flex items-center gap-2 text-white">
              <Loader2 className="h-4 w-4 animate-spin" />
              <div className="text-lg font-semibold">Loading jobs…</div>
            </div>
          </div>
        ) : jobsQuery.error ? (
          <div className="rounded-[32px] border border-red-500/25 bg-[#1a1625]/70 p-8">
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
          <div className="space-y-6">
            {(jobsQuery.data?.jobs ?? []).map((job) => {
              const baseCron = job.schedule?.cron ?? job.defaultScheduleCron ?? '';
              const baseEnabled = job.schedule?.enabled ?? false;

              const draft =
                drafts[job.id] ??
                defaultDraftFromCron({
                  cron: baseCron,
                  enabled: baseEnabled,
                });

              const scheduleEnabled = job.schedule?.enabled ?? false;
              const nextRunAt = job.schedule?.nextRunAt ?? null;

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

              const config = JOB_CONFIG[job.id] || {
                icon: <Zap className="w-8 h-8" />,
                color: 'text-gray-400',
                description: job.description,
              };

              const terminalInfo = terminalState[job.id];
              const isTerminalActive =
                terminalInfo?.status === 'running' || terminalInfo?.status === 'completed';
              const isTerminalRunning = terminalInfo?.status === 'running';
              const weeklyOpen = weeklyDaySelector[job.id] ?? false;
              const monthlyOpen = monthlyDaySelector[job.id] ?? false;
              const nextRunsOpen = nextRunsPopup[job.id] ?? false;
              const timePickerIsOpen = timePickerOpen[job.id] ?? false;

              return (
                <motion.div
                  key={job.id}
                  layout
                  style={{
                    position: 'relative',
                    zIndex: weeklyOpen || monthlyOpen || nextRunsOpen || timePickerIsOpen ? 9999 : 'auto',
                  }}
                  className="group relative rounded-[32px] bg-[#1a1625]/60 backdrop-blur-xl border border-white/5 transition-all duration-300 hover:bg-[#1a1625]/80 hover:shadow-2xl hover:shadow-purple-500/10"
                >
                  <div className="absolute top-0 right-0 p-32 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-3xl rounded-full pointer-events-none -z-10" />

                  <div className="p-6 md:p-8 flex flex-wrap gap-4 items-start relative z-10">
                    {/* Icon Box */}
                    <div
                      className={cn(
                        'w-16 h-16 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0',
                        config.color
                      )}
                    >
                      {config.icon}
                    </div>

                    <div className="flex-1 space-y-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-bold text-white tracking-tight truncate">
                          {job.name}
                        </h3>
                        {draft.enabled && (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-0 px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold shrink-0">
                            Active
                          </Badge>
                        )}
                      </div>
                      <p className="text-gray-400 leading-relaxed font-medium text-sm md:text-base max-w-lg">
                        {config.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 self-end md:self-center w-full md:w-auto justify-between md:justify-end shrink-0">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                          Auto-Run
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={draft.enabled}
                          onClick={() => {
                            const newEnabled = !draft.enabled;

                            if (newEnabled) {
                              // If enabling, auto-save with default daily 3am schedule
                              const defaultCron = '0 3 * * *'; // Daily at 3am

                              const defaultDraft = defaultDraftFromCron({
                                cron: defaultCron,
                                enabled: true,
                              });

                              setDrafts((prev) => ({
                                ...prev,
                                [job.id]: defaultDraft,
                              }));

                              scheduleMutation.mutate({
                                jobId: job.id,
                                cron: defaultCron,
                                enabled: true,
                              });
                            } else {
                              // If disabling, save immediately
                              const cron =
                                buildCronFromDraft(draft) ||
                                baseCron ||
                                job.defaultScheduleCron ||
                                '0 3 * * *';

                              setDrafts((prev) => ({
                                ...prev,
                                [job.id]: { ...draft, enabled: false },
                              }));

                              scheduleMutation.mutate({
                                jobId: job.id,
                                cron,
                                enabled: false,
                              });
                            }
                          }}
                          disabled={
                            scheduleMutation.isPending &&
                            scheduleMutation.variables?.jobId === job.id
                          }
                          className={cn(
                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                            draft.enabled ? 'bg-[#facc15]' : 'bg-[#2a2438] border-2 border-white/10'
                          )}
                          aria-label={`Toggle schedule for ${job.name}`}
                        >
                          <span
                            className={cn(
                              'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                              draft.enabled ? 'translate-x-6' : 'translate-x-1'
                            )}
                          />
                        </button>
                      </div>

                      <div className="w-px h-10 bg-white/5 hidden md:block" />

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (isTerminalActive && terminalInfo?.runId) {
                              navigate(`/rewind/${terminalInfo.runId}`);
                            }
                          }}
                          disabled={!isTerminalActive}
                          className={cn(
                            'w-12 h-12 rounded-full transition-all flex items-center justify-center',
                            isTerminalActive
                              ? 'bg-gray-500/30 text-white cursor-pointer hover:bg-gray-500/40'
                              : 'bg-white/5 border border-white/10 text-white/40 cursor-not-allowed'
                          )}
                          title={isTerminalActive ? 'View Report' : 'Terminal'}
                        >
                          {isTerminalActive ? (
                            isTerminalRunning ? (
                              <motion.span
                                className="flex items-center text-xs font-mono"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                              >
                                &gt;
                                <motion.span
                                  animate={{ opacity: [0, 1, 1, 0] }}
                                  transition={{
                                    repeat: Infinity,
                                    duration: 1.5,
                                    times: [0, 0.33, 0.66, 1],
                                  }}
                                >
                                  .
                                </motion.span>
                                <motion.span
                                  animate={{ opacity: [0, 0, 1, 1, 0] }}
                                  transition={{
                                    repeat: Infinity,
                                    duration: 1.5,
                                    times: [0, 0.33, 0.66, 0.88, 1],
                                  }}
                                >
                                  .
                                </motion.span>
                                <motion.span
                                  animate={{ opacity: [0, 0, 0, 1, 0] }}
                                  transition={{
                                    repeat: Infinity,
                                    duration: 1.5,
                                    times: [0, 0.33, 0.55, 0.88, 1],
                                  }}
                                >
                                  .
                                </motion.span>
                              </motion.span>
                            ) : (
                              <TerminalIcon className="w-5 h-5 text-emerald-400" />
                            )
                          ) : (
                            <TerminalIcon className="w-5 h-5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const needsTitle =
                              job.id === 'watchedMovieRecommendations' ||
                              job.id === 'immaculateTastePoints';
                            if (needsTitle) {
                              setMovieSeedError(null);
                              setMovieSeedDialogJobId(job.id);
                              setMovieSeedDialogOpen(true);
                              return;
                            }

                            setTerminalState((prev) => ({
                              ...prev,
                              [job.id]: { status: 'running' },
                            }));
                            runMutation.mutate({ jobId: job.id, dryRun: false });
                          }}
                          disabled={runMutation.isPending}
                          className={cn(
                            'h-12 rounded-full font-bold text-sm shadow-[0_0_20px_rgba(250,204,21,0.2)] transition-all duration-300 overflow-hidden relative',
                            isRunningJob
                              ? 'bg-emerald-500 text-white w-12 px-0'
                              : 'bg-[#facc15] text-black w-32 px-6 hover:bg-[#facc15] hover:scale-105'
                          )}
                        >
                          <AnimatePresence mode="wait" initial={false}>
                            {isRunningJob ? (
                              <motion.div
                                key="loading"
                                initial={{ scale: 0 }}
                                animate={{ scale: 1, rotate: 360 }}
                                exit={{ scale: 0 }}
                                transition={{ type: 'spring', stiffness: 200, damping: 10 }}
                              >
                                <Loader2 className="w-5 h-5 animate-spin" />
                              </motion.div>
                            ) : (
                              <motion.div
                                key="idle"
                                className="flex items-center justify-center"
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -20, opacity: 0 }}
                              >
                                <Play className="w-4 h-4 mr-2 fill-current" />
                                Run Now
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Scheduler Drawer */}
                  <AnimatePresence initial={false}>
                    {draft.enabled && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 200,
                          damping: 25,
                          mass: 0.8
                        }}
                        className="overflow-visible bg-[#0F0B15]/30 border-t border-white/5"
                      >
                        <div className="p-4 md:p-6">
                          <div className="p-4 rounded-2xl bg-[#0F0B15]/50 border border-white/5 flex flex-col gap-4">
                            <div className="flex flex-col md:flex-row gap-4 md:items-start">
                              {/* Frequency Selector */}
                              <div className="flex-1 min-w-[200px] h-[106px] flex flex-col">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2 mb-2">
                                  <CalendarDays className="w-3 h-3" />
                                  Repeat
                                </label>
                                <div className="flex flex-col gap-0.5 h-[90px]">
                                <div className="relative grid grid-cols-3 bg-[#1a1625]/80 backdrop-blur-sm p-1 rounded-xl border border-white/10 shadow-inner h-[42px]">
                                  {/* Animated sliding background pill */}
                                  <motion.div
                                    className="absolute top-1 bottom-1 bg-gradient-to-br from-[#facc15] via-[#fcd34d] to-[#f5b800] rounded-lg shadow-[0_2px_10px_rgba(250,204,21,0.3)] backdrop-blur-md"
                                    initial={false}
                                    animate={{
                                      x:
                                        draft.frequency === 'daily'
                                          ? '0%'
                                          : draft.frequency === 'weekly'
                                            ? '100%'
                                            : '200%',
                                    }}
                                    transition={{
                                      type: 'spring',
                                      stiffness: 400,
                                      damping: 35,
                                      mass: 0.8,
                                    }}
                                    style={{
                                      width: 'calc(33.333% - 4px)',
                                      left: '4px',
                                    }}
                                  />
                                  {(['daily', 'weekly', 'monthly'] as ScheduleFrequency[]).map(
                                    (freq) => (
                                      <button
                                        key={freq}
                                        onClick={() =>
                                          setDrafts((prev) => ({
                                            ...prev,
                                            [job.id]: { ...draft, frequency: freq },
                                          }))
                                        }
                                        className={cn(
                                          'relative z-10 px-3 text-xs font-bold transition-all duration-300 flex items-center justify-center whitespace-nowrap h-full',
                                          draft.frequency === freq
                                            ? 'text-black scale-[1.02]'
                                            : 'text-gray-400 hover:text-white scale-100'
                                        )}
                                      >
                                        <span className="truncate">
                                          {freq === 'daily'
                                            ? 'Daily'
                                            : freq === 'weekly'
                                              ? 'Weekly'
                                              : 'Monthly'}
                                        </span>
                                      </button>
                                    )
                                  )}
                                </div>

                                {/* Selected frequency details - fixed height container */}
                                <div className="h-[14px] -mt-1">
                                {draft.frequency === 'weekly' && draft.daysOfWeek.length > 0 && (
                                  <div className="text-[10px] text-gray-500 pl-1">
                                    {draft.daysOfWeek
                                      .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.short ?? d)
                                      .join(', ')}
                                  </div>
                                )}
                                {draft.frequency === 'monthly' && draft.daysOfMonth.length > 0 && (
                                  <div className="text-[10px] text-gray-500 pl-1">
                                    Day {draft.daysOfMonth.sort((a, b) => Number(a) - Number(b)).join(', ')}
                                  </div>
                                )}
                                </div>

                                </div>

                                {/* Weekly Day Selector */}
                                <div className="h-[16px]">
                                {draft.frequency === 'weekly' && (
                                  <div className="relative z-50 -mt-1">
                                    <motion.button
                                      initial={{ opacity: 0, y: -10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setWeeklyDaySelector((prev) => ({
                                          ...prev,
                                          [job.id]: !prev[job.id],
                                        }));
                                      }}
                                      className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
                                    >
                                      Select days
                                      <ChevronDown
                                        className={cn(
                                          'w-3 h-3 transition-transform',
                                          !weeklyOpen && 'rotate-180'
                                        )}
                                      />
                                    </motion.button>
                                    <AnimatePresence>
                                      {weeklyOpen && (
                                        <motion.div
                                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                          animate={{ opacity: 1, y: 0, scale: 1 }}
                                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                          transition={{ type: 'spring', stiffness: 250, damping: 22 }}
                                          onClick={(e) => e.stopPropagation()}
                                          className="absolute bottom-full mb-2 left-0 bg-[#1a1625] border border-white/10 rounded-xl p-3 shadow-2xl z-[10000] min-w-[200px]"
                                        >
                                          <div className="space-y-2">
                                            {DAYS_OF_WEEK.map((day) => (
                                              <label
                                                key={day.value}
                                                className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-2 rounded-lg transition-colors"
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={draft.daysOfWeek.includes(day.value)}
                                                  onChange={(e) => {
                                                    const checked = e.target.checked;
                                                    setDrafts((prev) => ({
                                                      ...prev,
                                                      [job.id]: {
                                                        ...draft,
                                                        daysOfWeek: checked
                                                          ? [...draft.daysOfWeek, day.value]
                                                          : draft.daysOfWeek.filter(
                                                              (d) => d !== day.value
                                                            ),
                                                      },
                                                    }));
                                                  }}
                                                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-[#facc15] focus:ring-[#facc15] focus:ring-offset-0"
                                                />
                                                <span className="text-sm text-white">
                                                  {day.label}
                                                </span>
                                              </label>
                                            ))}
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                )}

                                {/* Monthly Day Selector */}
                                {draft.frequency === 'monthly' && (
                                  <div className="relative z-50 -mt-1">
                                    <motion.button
                                      initial={{ opacity: 0, y: -10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMonthlyDaySelector((prev) => ({
                                          ...prev,
                                          [job.id]: !prev[job.id],
                                        }));
                                      }}
                                      className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
                                    >
                                      Select dates
                                      <ChevronDown
                                        className={cn(
                                          'w-3 h-3 transition-transform',
                                          !monthlyOpen && 'rotate-180'
                                        )}
                                      />
                                    </motion.button>
                                    <AnimatePresence>
                                      {monthlyOpen && (
                                        <motion.div
                                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                          animate={{ opacity: 1, y: 0, scale: 1 }}
                                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                          transition={{ type: 'spring', stiffness: 250, damping: 22 }}
                                          onClick={(e) => e.stopPropagation()}
                                          className="absolute bottom-full mb-2 left-0 bg-[#1a1625] border border-white/10 rounded-xl p-4 shadow-2xl z-[10000] w-[280px]"
                                        >
                                          <div className="text-xs text-gray-500 mb-3">
                                            Select multiple dates (1–28 to avoid shorter months)
                                          </div>
                                          <div className="grid grid-cols-7 gap-1">
                                            {Array.from({ length: 28 }, (_, i) => String(i + 1)).map(
                                              (day) => {
                                                const isSelected = draft.daysOfMonth.includes(day);
                                                return (
                                                  <button
                                                    key={day}
                                                    onClick={() => {
                                                      setDrafts((prev) => ({
                                                        ...prev,
                                                        [job.id]: {
                                                          ...draft,
                                                          daysOfMonth: isSelected
                                                            ? draft.daysOfMonth.filter((d) => d !== day)
                                                            : [...draft.daysOfMonth, day],
                                                        },
                                                      }));
                                                    }}
                                                    className={cn(
                                                      'w-8 h-8 rounded-lg text-xs font-medium transition-all',
                                                      isSelected
                                                        ? 'bg-[#facc15] text-black'
                                                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                                                    )}
                                                  >
                                                    {day}
                                                  </button>
                                                );
                                              }
                                            )}
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                )}
                                </div>
                              </div>

                              <div className="w-px h-20 bg-white/5 hidden md:block self-center" />

                              {/* Time Picker */}
                              <div className="flex-1 max-w-xs h-[106px] flex flex-col">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2 mb-2">
                                  <Clock className="w-3 h-3" />
                                  Time
                                </label>
                                <Popover
                                  open={timePickerOpen[job.id]}
                                  onOpenChange={(open) =>
                                    setTimePickerOpen((prev) => ({ ...prev, [job.id]: open }))
                                  }
                                >
                                  <PopoverTrigger asChild>
                                    <button className="relative group/input w-full">
                                      <div className="w-full bg-[#1a1625] border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm text-left focus:outline-none focus:ring-1 focus:ring-[#facc15]/50 transition-all hover:bg-[#1a1625]/80 h-[42px] flex items-center">
                                        {draft.time}
                                      </div>
                                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 group-hover/input:text-[#facc15] transition-colors">
                                        <ChevronRight className="w-4 h-4 rotate-90" />
                                      </div>
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="w-auto p-0 bg-[#0F0B15] border-white/10 text-white shadow-2xl z-[200]"
                                    align="center"
                                  >
                                    <AnalogTimePicker
                                      value={draft.time}
                                      onChange={(newTime) => {
                                        setDrafts((prev) => ({
                                          ...prev,
                                          [job.id]: { ...draft, time: newTime },
                                        }));
                                      }}
                                      onClose={() =>
                                        setTimePickerOpen((prev) => ({ ...prev, [job.id]: false }))
                                      }
                                    />
                                  </PopoverContent>
                                </Popover>
                              </div>

                              <div className="w-px h-20 bg-white/5 hidden md:block self-center" />

                              {/* Next Run Info */}
                              <div className="relative z-50 flex-1 max-w-xs h-[106px] flex flex-col">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2 mb-2">
                                  <Clock className="w-3 h-3" />
                                  Next Run
                                </label>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setNextRunsPopup((prev) => ({
                                      ...prev,
                                      [job.id]: !prev[job.id],
                                    }));
                                  }}
                                  disabled={!draft.enabled}
                                  className="w-full flex items-center justify-between bg-[#1a1625] border border-white/10 rounded-xl px-4 py-3 h-[42px] hover:bg-[#1a1625]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <span className="text-sm font-mono text-emerald-400 font-medium">
                                    {scheduleEnabled && nextRunAt
                                      ? `${new Date(nextRunAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${formatTimeDisplay(draft.time)}`
                                      : '—'}
                                  </span>
                                  <ChevronDown
                                    className={cn(
                                      'w-4 h-4 text-gray-500 transition-transform',
                                      nextRunsPopup[job.id] && 'rotate-180'
                                    )}
                                  />
                                </button>

                                <AnimatePresence>
                                  {nextRunsPopup[job.id] && draft.enabled && (
                                    <motion.div
                                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                      transition={{ type: 'spring', stiffness: 250, damping: 22 }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="absolute top-full mt-2 right-0 bg-[#1a1625] border border-white/10 rounded-xl p-4 shadow-2xl z-[10000] min-w-[220px]"
                                    >
                                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                                        Next 5 Runs
                                      </div>
                                      <div className="space-y-2">
                                        {calculateNextRuns(draft, 5).map((run, idx) => (
                                          <div
                                            key={idx}
                                            className="flex items-center gap-3 text-sm p-2 rounded-lg bg-white/5"
                                          >
                                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                            <span className="text-white font-medium">
                                              {run.toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                              })}
                                              {' at '}
                                              {formatTimeDisplay(draft.time)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>

                            {scheduleError && (
                              <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                                {scheduleError}
                              </div>
                            )}

                            {draft.advancedCron && (
                              <div className="text-xs text-white/55">
                                This job was previously set using an advanced cron pattern and will
                                be converted when you save.
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {runError && (
                    <div className="px-6 pb-6">
                      <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                        {runError}
                      </div>
                    </div>
                  )}

                </motion.div>
              );
            })}
          </div>
        )}

        <div className="mt-12 text-center">
          <Link
            to="/rewind"
            className="inline-flex items-center gap-3 px-6 py-3 rounded-full hover:bg-white/5 text-gray-400 hover:text-white transition-all border border-white/10 group"
          >
            <Clock className="w-4 h-4 group-hover:text-[#facc15] transition-colors" />
            <span className="text-sm font-medium">View Execution History</span>
            <ChevronRight className="w-4 h-4 opacity-50 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
        </div>
      </section>

      {/* Watched Movie Recommendations - Manual Test Dialog */}
      <AnimatePresence>
        {movieSeedDialogOpen && (
          <motion.div
            className="fixed inset-0 z-[100000] flex items-end sm:items-center justify-center p-4 sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setMovieSeedDialogOpen(false);
              setMovieSeedDialogJobId(null);
            }}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full sm:max-w-lg rounded-t-[32px] sm:rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-purple-500/10 overflow-hidden"
            >
              <div className="p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                      Manual test
                    </div>
                    <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                      {movieSeedDialogJobId === 'immaculateTastePoints'
                        ? 'Immaculate Taste (Points Update)'
                        : 'Watched Movie Recommendations'}
                    </h2>
                    <p className="mt-2 text-sm text-white/70 leading-relaxed">
                      Enter a movie title to run as if Plex sent a{' '}
                      <span className="text-white font-semibold">media.scrobble</span> event.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMovieSeedDialogOpen(false);
                      setMovieSeedDialogJobId(null);
                    }}
                    className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      Movie title
                    </label>
                    <input
                      ref={movieSeedTitleRef}
                      value={movieSeedTitle}
                      onChange={(e) => {
                        setMovieSeedError(null);
                        setMovieSeedTitle(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const title = movieSeedTitle.trim();
                        if (!title) {
                          setMovieSeedError('Please enter a movie title.');
                          return;
                        }
                        const yearRaw = movieSeedYear.trim();
                        const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;
                        if (yearRaw && (!Number.isFinite(year) || year < 1888 || year > 2100)) {
                          setMovieSeedError('Year must be a valid 4-digit number.');
                          return;
                        }

                        setTerminalState((prev) => ({
                          ...prev,
                          ...(movieSeedDialogJobId ? { [movieSeedDialogJobId]: { status: 'running' } } : {}),
                        }));
                        if (movieSeedDialogJobId) {
                          runMutation.mutate({
                            jobId: movieSeedDialogJobId,
                            dryRun: false,
                            input: {
                              source: 'manualTest',
                              plexEvent: 'media.scrobble',
                              seedTitle: title,
                              seedYear: Number.isFinite(year) ? year : null,
                              seedRatingKey: null,
                            },
                          });
                        }
                        setMovieSeedDialogOpen(false);
                        setMovieSeedDialogJobId(null);
                      }}
                      placeholder="Inception"
                      className="mt-2 w-full bg-[#0F0B15]/60 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-[#facc15]/50 focus:border-transparent transition"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      Year (optional)
                    </label>
                    <input
                      value={movieSeedYear}
                      onChange={(e) => {
                        setMovieSeedError(null);
                        setMovieSeedYear(e.target.value);
                      }}
                      inputMode="numeric"
                      placeholder="2010"
                      className="mt-2 w-full bg-[#0F0B15]/60 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-[#facc15]/50 focus:border-transparent transition"
                    />
                  </div>
                </div>

                {movieSeedError && (
                  <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                    {movieSeedError}
                  </div>
                )}

                <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMovieSeedDialogOpen(false);
                      setMovieSeedDialogJobId(null);
                    }}
                    className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const title = movieSeedTitle.trim();
                      if (!title) {
                        setMovieSeedError('Please enter a movie title.');
                        return;
                      }

                      const yearRaw = movieSeedYear.trim();
                      const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;
                      if (yearRaw && (!Number.isFinite(year) || year < 1888 || year > 2100)) {
                        setMovieSeedError('Year must be a valid 4-digit number.');
                        return;
                      }

                      setTerminalState((prev) => ({
                        ...prev,
                        ...(movieSeedDialogJobId ? { [movieSeedDialogJobId]: { status: 'running' } } : {}),
                      }));
                      if (movieSeedDialogJobId) {
                        runMutation.mutate({
                          jobId: movieSeedDialogJobId,
                          dryRun: false,
                          input: {
                            source: 'manualTest',
                            plexEvent: 'media.scrobble',
                            seedTitle: title,
                            seedYear: Number.isFinite(year) ? year : null,
                            seedRatingKey: null,
                          },
                        });
                      }
                      setMovieSeedDialogOpen(false);
                      setMovieSeedDialogJobId(null);
                    }}
                    className="h-12 rounded-full px-6 bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2"
                    disabled={runMutation.isPending}
                  >
                    {runMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Running…
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        Run test
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="px-6 sm:px-7 pb-6 sm:pb-7 pt-0">
                <div className="rounded-2xl bg-[#0F0B15]/40 border border-white/5 p-4 text-xs text-white/55 leading-relaxed">
                  Tip: after starting the run, click the <span className="text-white/80 font-semibold">terminal</span> button on the job card to open the execution report.
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
