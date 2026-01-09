import { useEffect, useMemo, useState } from 'react';
import { motion, useAnimation } from 'motion/react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Loader2, RotateCcw } from 'lucide-react';

import { getRun, getRunLogs, listJobs, type JobRun } from '@/api/jobs';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
}

function pickNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function statusPill(status: string) {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/25';
    case 'FAILED':
      return 'bg-red-500/15 text-red-200 border border-red-500/25';
    case 'RUNNING':
      return 'bg-amber-500/15 text-amber-200 border border-amber-500/25';
    default:
      return 'bg-white/10 text-white/70 border border-white/10';
  }
}

type RunModeLabel = 'Auto-Run' | 'Manual' | 'Dry-Run';

function modeLabel(run: JobRun): RunModeLabel {
  if (run.dryRun) return 'Dry-Run';
  return run.trigger === 'schedule' || run.trigger === 'auto'
    ? 'Auto-Run'
    : 'Manual';
}

function modePill(mode: RunModeLabel) {
  switch (mode) {
    case 'Dry-Run':
      return 'bg-[#facc15]/15 text-[#fde68a] border border-[#facc15]/25';
    case 'Auto-Run':
      return 'bg-sky-500/15 text-sky-200 border border-sky-500/25';
    case 'Manual':
      return 'bg-purple-500/15 text-purple-200 border border-purple-500/25';
  }
}

function levelClass(level: string) {
  const l = level.toLowerCase();
  if (l === 'error') return 'text-red-200';
  if (l === 'warn' || l === 'warning') return 'text-amber-200';
  if (l === 'debug') return 'text-white/50';
  return 'text-white/80';
}

function taskStatusPill(status: string) {
  const s = status.toLowerCase();
  if (s === 'success') return 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/25';
  if (s === 'failed') return 'bg-red-500/15 text-red-200 border border-red-500/25';
  if (s === 'skipped') return 'bg-white/10 text-white/70 border border-white/10';
  return 'bg-white/10 text-white/70 border border-white/10';
}

type ProgressPlan = {
  total: number;
  getStage: (params: {
    stepId: string;
    progress: Record<string, unknown> | null;
  }) => number | null;
};

function getProgressPlan(jobId: string): ProgressPlan | null {
  const id = (jobId ?? '').trim();
  if (!id) return null;

  // Refresher-style jobs: fewer, high-signal stages (movie → TV)
  if (id === 'immaculateTasteRefresher' || id === 'recentlyWatchedRefresher') {
    return {
      total: 4,
      getStage: ({ stepId, progress }) => {
        if (!stepId) return null;
        if (stepId === 'starting' || stepId === 'dataset') return 1;
        if (stepId === 'plex_libraries') return 2;
        if (stepId.startsWith('plex_collection_')) {
          const mt = progress ? (pickString(progress, 'mediaType') ?? 'movie') : 'movie';
          return mt.toLowerCase() === 'tv' ? 4 : 3;
        }
        if (stepId === 'done') return 4;
        return null;
      },
    };
  }

  // Collection-building jobs: TMDB → Google → AI → Plex
  if (id === 'watchedMovieRecommendations') {
    return {
      total: 5,
      getStage: ({ stepId }) => {
        if (!stepId) return null;
        if (stepId === 'starting' || stepId === 'dataset' || stepId === 'plex_libraries') return 1;
        if (stepId === 'recs_tmdb_pools') return 2;
        if (stepId === 'recs_google') return 3;
        if (stepId === 'recs_openai') return 4;
        if (stepId === 'plex_match') return 5;
        if (stepId.startsWith('plex_collection_')) return 5;
        if (stepId === 'done') return 5;
        return null;
      },
    };
  }

  // Immaculate Taste points job: dataset → recs → Plex
  if (id === 'immaculateTastePoints') {
    return {
      total: 6,
      getStage: ({ stepId }) => {
        if (!stepId) return null;
        if (stepId === 'starting' || stepId === 'dataset') return 1;
        if (stepId === 'plex_libraries') return 2;
        if (stepId === 'recs_tmdb_pools') return 3;
        if (stepId === 'recs_google') return 4;
        if (stepId === 'recs_openai') return 5;
        if (stepId === 'plex_match') return 6;
        if (stepId.startsWith('plex_collection_')) return 6;
        if (stepId === 'done') return 6;
        return null;
      },
    };
  }

  return null;
}

export function JobRunDetailPage() {
  const params = useParams();
  const runId = params.runId ?? '';
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const [expandedContext, setExpandedContext] = useState<Record<number, boolean>>({});
  const [showRawResponse, setShowRawResponse] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const runQuery = useQuery({
    queryKey: ['jobRun', runId],
    queryFn: () => getRun(runId),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const data = q.state.data as { run: { status?: string } } | undefined;
      return data?.run?.status === 'RUNNING' ? 2000 : false;
    },
    refetchOnWindowFocus: false,
  });

  const isRunning = runQuery.data?.run?.status === 'RUNNING';

  const logsQuery = useQuery({
    queryKey: ['jobRunLogs', runId],
    queryFn: () => getRunLogs({ runId, take: 1000 }),
    enabled: Boolean(runId),
    refetchInterval: isRunning ? 2000 : false,
    refetchOnWindowFocus: false,
  });

  const run = runQuery.data?.run;

  // The progress bar is a live "while you watch" indicator. Hide it shortly after completion so
  // old reports don't show a permanent "Completed" bar.
  useEffect(() => {
    const finishedAt = run?.finishedAt ?? null;
    if (!finishedAt) return;
    const finishedAtMs = Date.parse(finishedAt);
    if (!Number.isFinite(finishedAtMs)) return;

    const hideAtMs = finishedAtMs + 2 * 60_000;
    const delay = hideAtMs - Date.now();
    if (delay <= 0) return;

    const t = window.setTimeout(() => setNowMs(Date.now()), delay + 25);
    return () => window.clearTimeout(t);
  }, [run?.finishedAt]);
  const reportV1 = useMemo(() => {
    const s = run?.summary;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const obj = s as Record<string, unknown>;
    if (obj.template !== 'jobReportV1') return null;
    if (Number(obj.version) !== 1) return null;
    return obj;
  }, [run?.summary]);
  const jobName = useMemo(() => {
    const jobId = run?.jobId ?? '';
    if (!jobId) return null;
    const jobs = jobsQuery.data?.jobs ?? [];
    const def = jobs.find((j) => j.id === jobId) ?? null;
    return def?.name ?? null;
  }, [jobsQuery.data?.jobs, run?.jobId]);
  const logs = useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data?.logs]);
  const visibleLogs = logs;
  const logStats = useMemo(() => {
    const counts = { error: 0, warn: 0 };
    for (const l of visibleLogs) {
      const lvl = String(l.level ?? '').toLowerCase();
      if (lvl === 'error') counts.error += 1;
      else if (lvl === 'warn' || lvl === 'warning') counts.warn += 1;
    }
    return counts;
  }, [visibleLogs]);

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-5 sm:p-6 lg:p-8 shadow-2xl';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Background (landing-page style, Rewind violet-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-400/35 via-violet-700/45 to-indigo-900/65" />
        <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
        <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
      </div>

      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16 select-text">
        <div className="container mx-auto px-4 pb-20 max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Page Header (match Rewind hero style) */}
              <div className="mb-10">
                <div className="flex flex-col gap-4 min-w-0">
                  <div className="flex items-center gap-4">
                    <motion.button
                      type="button"
                      onClick={() => {
                        titleIconControls.stop();
                        titleIconGlowControls.stop();
                        void titleIconControls.start({
                          scale: [1, 1.06, 1],
                          transition: { duration: 0.55, ease: 'easeOut' },
                        });
                        void titleIconGlowControls.start({
                          opacity: [0, 0.7, 0, 0.55, 0, 0.4, 0],
                          transition: { duration: 1.4, ease: 'easeInOut' },
                        });
                      }}
                      animate={titleIconControls}
                      className="relative group focus:outline-none touch-manipulation shrink-0"
                      aria-label="Animate Rewind icon"
                      title="Animate"
                    >
                      <motion.div
                        aria-hidden="true"
                        animate={titleIconGlowControls}
                        className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                      />
                      <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                      <div className="relative p-3 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_20px_rgba(250,204,21,0.4)] border-2 border-white/10 group-hover:rotate-0 transition-transform duration-300">
                        <RotateCcw className="w-8 h-8 text-black" strokeWidth={2.5} />
                      </div>
                    </motion.button>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white drop-shadow-xl">
                          {(jobName ?? run?.jobId ?? 'Rewind') + ' Report'}
                        </h1>
                      </div>
                    </div>
                  </div>

                  <p className="text-purple-200/70 text-lg font-medium max-w-2xl leading-relaxed ml-1">
                    Execution report with real-time progress, a full summary, and detailed logs.
                  </p>

                  <div className="ml-1">
                    <Link
                      to="/rewind"
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 transition-all duration-200 active:scale-95 hover:bg-white/15 touch-manipulation"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to Rewind
                    </Link>
                  </div>
                </div>
              </div>
            </motion.div>

            {runQuery.isLoading ? (
              <div className={cardClass}>
                <div className="flex items-center gap-2 text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <div className="text-lg font-semibold">Loading run…</div>
                </div>
              </div>
            ) : runQuery.error ? (
              <div className={`${cardClass} border-red-500/25 bg-[#0b0c0f]/70`}>
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 text-red-300" />
                  <div className="min-w-0">
                    <div className="text-white font-semibold">Failed to load run</div>
                    <div className="text-sm text-white/70">
                      {(runQuery.error as Error).message}
                    </div>
                  </div>
                </div>
              </div>
            ) : run ? (
              <div className="grid gap-6">
                {/* Run Details Card */}
                <div className={cardClass}>
                  <div className="mb-3 text-sm font-medium text-white/85">
                    Summary
                  </div>

                  <div className="text-sm text-white/70 mb-4 space-y-1">
                    <div>
                      <span className="text-white/80 font-semibold">Started:</span>{' '}
                      {new Date(run.startedAt).toLocaleString()}
                    </div>
                    {run.finishedAt ? (
                      <div>
                        <span className="text-white/80 font-semibold">Finished:</span>{' '}
                        {new Date(run.finishedAt).toLocaleString()}
                      </div>
                    ) : null}
                  </div>

                  {run.errorMessage ? (
                    <div className="mb-6 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
                      <div className="font-semibold mb-1">Error:</div>
                      <div className="max-w-full font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
                        {run.errorMessage}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    {/* Summary meta (status) */}
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${statusPill(run.status)}`}
                        >
                          {run.status}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${modePill(
                            modeLabel(run),
                          )}`}
                          title={
                            run.trigger === 'schedule' || run.trigger === 'auto'
                              ? 'Auto run'
                              : 'Manually started'
                          }
                        >
                          {modeLabel(run)}
                        </span>
                      </div>
                    </div>

                    {run.summary && typeof run.summary === 'object' ? (
                      (() => {
                        const s = run.summary as Record<string, unknown>;

                        const jobId = String(run.jobId ?? '');
                        const isReportV1 =
                          s.template === 'jobReportV1' && Number(s.version) === 1;
                        const reportIssuesCount =
                          isReportV1 && Array.isArray(s.issues)
                            ? s.issues.filter(
                                (i): i is Record<string, unknown> =>
                                  Boolean(i) &&
                                  typeof i === 'object' &&
                                  !Array.isArray(i),
                              ).length
                            : 0;
                        const isRefreshJob = jobId.toLowerCase().includes('refresher');
                        const isMediaAddedCleanup = jobId === 'mediaAddedCleanup';

                        const progressRaw = s.progress;
                        const progress = isPlainObject(progressRaw) ? progressRaw : null;
                        const progressMessage = progress ? pickString(progress, 'message') : null;
                        const progressStep = progress ? pickString(progress, 'step') : null;
                        const progressCurrent = progress ? pickNumber(progress, 'current') : null;
                        const progressTotal = progress ? pickNumber(progress, 'total') : null;
                        const progressUnit =
                          progress && typeof (progress as Record<string, unknown>).unit === 'string'
                            ? String((progress as Record<string, unknown>).unit)
                            : null;
                        const progressPct =
                          progressCurrent !== null && progressTotal !== null && progressTotal > 0
                            ? Math.max(0, Math.min(100, (progressCurrent / progressTotal) * 100))
                            : null;

                        const isFinished = run.status === 'SUCCESS' || run.status === 'FAILED';
                        const displayProgressMessage = (() => {
                          if (!isFinished) return progressMessage;
                          if (run.status === 'FAILED')
                            return isRefreshJob ? 'Refresh failed.' : 'Failed.';
                          if (run.status === 'SUCCESS') {
                            if (!isRefreshJob) {
                              if (jobId === 'monitorConfirm') return 'Monitor confirm complete.';
                              return 'Completed.';
                            }
                            return reportIssuesCount
                              ? 'Refresh complete with some hiccups.'
                              : 'Refresh complete.';
                          }
                          return progressMessage;
                        })();
                        // When the run is finished, the status pill already conveys state; don't show step noise.
                        const displayProgressStep = isFinished ? null : progressStep;
                        const displayProgressTotal = progressTotal;
                        const displayProgressCurrent =
                          isFinished && run.status === 'SUCCESS' && progressTotal !== null
                            ? progressTotal
                            : progressCurrent;
                        const progressBarClass =
                          run.status === 'SUCCESS'
                            ? 'bg-emerald-400/90'
                            : run.status === 'FAILED'
                              ? 'bg-red-400/90'
                              : 'bg-[#facc15]/90';

                        const stepId = (progressStep ?? '').toLowerCase();
                        const plan = getProgressPlan(jobId);
                        const stepStage =
                          plan && stepId ? plan.getStage({ stepId, progress }) : null;

                        const subProgress = (() => {
                          if (isFinished) return null;
                          if (!stepId) return null;
                          if (
                            stepId !== 'plex_collection_add' &&
                            stepId !== 'plex_collection_remove' &&
                            stepId !== 'plex_collection_reorder'
                          ) {
                            return null;
                          }
                          if (
                            progressCurrent === null ||
                            progressTotal === null ||
                            progressTotal <= 0
                          ) {
                            return null;
                          }
                          const verb =
                            stepId === 'plex_collection_add'
                              ? 'added'
                              : stepId === 'plex_collection_remove'
                                ? 'removed'
                                : 'ordered';
                          const unit = (progressUnit ?? 'items').trim() || 'items';
                          return {
                            current: Math.max(0, Math.trunc(progressCurrent)),
                            total: Math.max(0, Math.trunc(progressTotal)),
                            verb,
                            unit,
                          };
                        })();

                        const stepCounterText =
                          stepStage !== null && plan ? `${stepStage}/${plan.total}` : null;

                        const barPct = (() => {
                          if (isFinished) return 100;
                          if (stepStage === null || !plan) return progressPct;
                          const stage0 = Math.max(0, Math.min(plan.total - 1, stepStage - 1));
                          const frac =
                            subProgress && subProgress.total > 0
                              ? Math.max(
                                  0,
                                  Math.min(1, subProgress.current / subProgress.total),
                                )
                              : 0;
                          const pct = ((stage0 + frac) / plan.total) * 100;
                          return Math.max(0, Math.min(100, pct));
                        })();

                        const radarrRaw = s.radarr;
                        const sonarrRaw = s.sonarr;

                        const radarr =
                          radarrRaw &&
                          typeof radarrRaw === 'object' &&
                          !Array.isArray(radarrRaw)
                            ? (radarrRaw as Record<string, unknown>)
                            : null;

                        const sonarr =
                          sonarrRaw &&
                          typeof sonarrRaw === 'object' &&
                          !Array.isArray(sonarrRaw)
                            ? (sonarrRaw as Record<string, unknown>)
                            : null;

                        const collectionsRaw = s.collections;
                        const collections = Array.isArray(collectionsRaw)
                          ? collectionsRaw.filter(
                              (c): c is Record<string, unknown> =>
                                Boolean(c) &&
                                typeof c === 'object' &&
                                !Array.isArray(c),
                            )
                          : null;

                        const finishedAtMs =
                          isFinished && typeof run.finishedAt === 'string'
                            ? Date.parse(run.finishedAt)
                            : null;
                        const hideProgressAfterMs =
                          finishedAtMs && Number.isFinite(finishedAtMs)
                            ? finishedAtMs + 2 * 60_000
                            : null;
                        const shouldShowProgressBlock =
                          Boolean(displayProgressMessage) &&
                          (!isFinished ||
                            (hideProgressAfterMs !== null && nowMs < hideProgressAfterMs));

                        const progressBlock = shouldShowProgressBlock ? (
                          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white">
                                  {displayProgressMessage}
                                  {subProgress ? (
                                    <span className="ml-2 text-[11px] text-white/65 font-mono">
                                      ({subProgress.current}/{subProgress.total} {subProgress.unit}{' '}
                                      {subProgress.verb})
                                    </span>
                                  ) : null}
                                </div>
                                {!stepCounterText && displayProgressStep ? (
                                  <div className="mt-1 text-xs text-white/60 font-mono">
                                    step: {displayProgressStep}
                                  </div>
                                ) : null}
                              </div>
                              {stepCounterText ? (
                                <div className="shrink-0 text-xs text-white/70 font-mono">
                                  {stepCounterText} steps
                                </div>
                              ) : displayProgressCurrent !== null &&
                                displayProgressTotal !== null ? (
                                <div className="shrink-0 text-xs text-white/70 font-mono">
                                  {Math.trunc(displayProgressCurrent)}/{Math.trunc(displayProgressTotal)}
                                </div>
                              ) : null}
                            </div>

                            {barPct !== null ? (
                              <div className="mt-4">
                                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                                  <div
                                    className={`h-full ${progressBarClass}`}
                                    style={{ width: `${barPct}%` }}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null;

                        if (isReportV1) {
                          const headline = pickString(s, 'headline');
                          const issuesRaw = s.issues;
                          const issues = Array.isArray(issuesRaw)
                            ? issuesRaw.filter(
                                (i): i is Record<string, unknown> =>
                                  Boolean(i) &&
                                  typeof i === 'object' &&
                                  !Array.isArray(i),
                              )
                            : [];

                          const sectionsRaw = s.sections;
                          const sections = Array.isArray(sectionsRaw)
                            ? sectionsRaw.filter(
                                (sec): sec is Record<string, unknown> =>
                                  Boolean(sec) &&
                                  typeof sec === 'object' &&
                                  !Array.isArray(sec),
                              )
                            : [];

                          const formatMetric = (value: number | null, unit?: string | null) => {
                            if (value === null) return '—';
                            const s = Number.isInteger(value)
                              ? value.toLocaleString()
                              : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
                            const u = (unit ?? '').trim();
                            return u ? `${s} ${u}` : s;
                          };

                          const formatDelta = (value: number | null, unit?: string | null) => {
                            if (value === null) return '—';
                            const abs = Math.abs(value);
                            const s = Number.isInteger(abs)
                              ? abs.toLocaleString()
                              : abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
                            const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
                            const u = (unit ?? '').trim();
                            return u ? `${prefix}${s} ${u}` : `${prefix}${s}`;
                          };

                          const mediaAddedSummaryBlock = (() => {
                            if (!isMediaAddedCleanup) return null;

                            const raw = isPlainObject(s.raw)
                              ? (s.raw as Record<string, unknown>)
                              : null;
                            const mediaTypeRaw = raw ? pickString(raw, 'mediaType') : null;
                            const mediaType = (mediaTypeRaw ?? '').toLowerCase();

                            const title = raw ? pickString(raw, 'title') : null;
                            const year = raw ? pickNumber(raw, 'year') : null;
                            const showTitle = raw ? pickString(raw, 'showTitle') : null;
                            const seasonNumber = raw ? pickNumber(raw, 'seasonNumber') : null;
                            const episodeNumber = raw ? pickNumber(raw, 'episodeNumber') : null;

                            const pad2 = (n: number | null) =>
                              typeof n === 'number' && Number.isFinite(n)
                                ? String(Math.trunc(n)).padStart(2, '0')
                                : '??';

                            const addedTypeLabel = (() => {
                              if (mediaType === 'movie') return 'Movie';
                              if (mediaType === 'episode') return 'TV Episode';
                              if (mediaType === 'season') return 'TV Season';
                              if (mediaType === 'show') return 'TV Show';
                              return mediaTypeRaw ?? 'Unknown';
                            })();

                            const addedName = (() => {
                              if (mediaType === 'movie') {
                                const t = title ?? 'Movie';
                                return year ? `${t} (${year})` : t;
                              }
                              if (mediaType === 'episode') {
                                const show = showTitle ?? 'Show';
                                const ep = `S${pad2(seasonNumber)}E${pad2(episodeNumber)}`;
                                const epTitle = title ?? '';
                                return `${show} ${ep}${epTitle ? ` — ${epTitle}` : ''}`;
                              }
                              if (mediaType === 'season') {
                                const show = showTitle ?? 'Show';
                                return `${show} — Season ${seasonNumber ?? '??'}`;
                              }
                              if (mediaType === 'show') return title ?? 'Show';
                              return title ?? '—';
                            })();

                            const asCount = (v: number) =>
                              Math.max(0, Math.trunc(v)).toLocaleString();

                            const getSectionEnd = (sectionId: string, rowLabel: string): number => {
                              const sec = sections.find(
                                (x) => (pickString(x, 'id') ?? '') === sectionId,
                              );
                              if (!sec) return 0;
                              const rowsRaw = (sec as Record<string, unknown>).rows;
                              const rows = Array.isArray(rowsRaw)
                                ? rowsRaw.filter(
                                    (r): r is Record<string, unknown> =>
                                      Boolean(r) &&
                                      typeof r === 'object' &&
                                      !Array.isArray(r),
                                  )
                                : [];
                              const row = rows.find(
                                (r) => (pickString(r, 'label') ?? '') === rowLabel,
                              );
                              const end = row ? pickNumber(row, 'end') : null;
                              return end === null ? 0 : Math.max(0, Math.trunc(end));
                            };

                            const isDryRun = Boolean(run.dryRun);
                            const radarr =
                              raw && isPlainObject(raw.radarr)
                                ? (raw.radarr as Record<string, unknown>)
                                : null;
                            const sonarr =
                              raw && isPlainObject(raw.sonarr)
                                ? (raw.sonarr as Record<string, unknown>)
                                : null;

                            const pickBool = (
                              obj: Record<string, unknown> | null,
                              key: string,
                            ) => {
                              if (!obj) return null;
                              const v = obj[key];
                              return typeof v === 'boolean' ? v : null;
                            };

                            const pickCount = (
                              obj: Record<string, unknown> | null,
                              key: string,
                            ) => {
                              if (!obj) return null;
                              return pickNumber(obj, key);
                            };

                            const movieUnmonitored = (() => {
                              if (!radarr) return 0;
                              if (isDryRun) {
                                const n = pickCount(radarr, 'moviesWouldUnmonitor');
                                if (n !== null) return Math.max(0, Math.trunc(n));
                                return pickBool(radarr, 'wouldUnmonitor') ? 1 : 0;
                              }
                              const n = pickCount(radarr, 'moviesUnmonitored');
                              if (n !== null) return Math.max(0, Math.trunc(n));
                              return pickBool(radarr, 'unmonitored') ? 1 : 0;
                            })();

                            const tvUnmonitored = (() => {
                              if (!sonarr) return 0;

                              const episodesCount = isDryRun
                                ? pickCount(sonarr, 'episodesWouldUnmonitor')
                                : pickCount(sonarr, 'episodesUnmonitored');
                              if (episodesCount !== null)
                                return Math.max(0, Math.trunc(episodesCount));

                              // Fallbacks for show-level/season-level flows.
                              if (isDryRun) {
                                if (pickBool(sonarr, 'wouldUnmonitor')) return 1;
                                if (pickBool(sonarr, 'seasonWouldUnmonitor')) return 1;
                                return 0;
                              }
                              if (pickBool(sonarr, 'seriesUnmonitored')) return 1;
                              if (pickBool(sonarr, 'seasonUnmonitored')) return 1;
                              if (pickBool(sonarr, 'episodeUnmonitored')) return 1;
                              return 0;
                            })();

                            const movieDuplicatesDeleted = getSectionEnd(
                              'duplicates',
                              'Movie deleted',
                            );
                            const tvDuplicatesDeleted = getSectionEnd(
                              'duplicates',
                              'Episode deleted',
                            );
                            const movieWatchlistRemoved = getSectionEnd(
                              'watchlist',
                              'Movie removed',
                            );
                            const tvWatchlistRemoved = getSectionEnd(
                              'watchlist',
                              'Show removed',
                            );

                            const tvRowLabel = (() => {
                              if (mediaType === 'episode') return 'TV Episode';
                              if (mediaType === 'season') return 'TV Season';
                              if (mediaType === 'show') return 'TV Show';
                              return 'TV';
                            })();

                            const summaryRows = (() => {
                              if (mediaType === 'movie') {
                                return [
                                  {
                                    label: 'Movie',
                                    unmonitored: movieUnmonitored,
                                    duplicates: movieDuplicatesDeleted,
                                    watchlist: movieWatchlistRemoved,
                                  },
                                ] as const;
                              }

                              if (
                                mediaType === 'episode' ||
                                mediaType === 'season' ||
                                mediaType === 'show'
                              ) {
                                return [
                                  {
                                    label: tvRowLabel,
                                    unmonitored: tvUnmonitored,
                                    duplicates: tvDuplicatesDeleted,
                                    watchlist: tvWatchlistRemoved,
                                  },
                                ] as const;
                              }

                              // Fallback: unknown type, show both for visibility.
                              return [
                                {
                                  label: 'Movie',
                                  unmonitored: movieUnmonitored,
                                  duplicates: movieDuplicatesDeleted,
                                  watchlist: movieWatchlistRemoved,
                                },
                                {
                                  label: tvRowLabel,
                                  unmonitored: tvUnmonitored,
                                  duplicates: tvDuplicatesDeleted,
                                  watchlist: tvWatchlistRemoved,
                                },
                              ] as const;
                            })();

                            return (
                              <div className="mb-6 space-y-4">
                                {run.trigger !== 'manual' && mediaType ? (
                                  <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                    <div className="text-xs text-white/60 font-mono">
                                      Added content
                                    </div>
                                    <div className="mt-2 text-white font-semibold break-words">
                                      {addedName}
                                    </div>
                                    <div className="mt-1 text-xs text-white/60 font-mono">
                                      Type: {addedTypeLabel}
                                    </div>
                                  </div>
                                ) : null}

                                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-semibold text-white">
                                      Summary
                                    </div>
                                    {isDryRun ? (
                                      <div className="text-[11px] text-white/60 font-mono">
                                        dry-run (would remove)
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="mt-4 overflow-auto rounded-2xl border border-white/10 bg-[#0b0c0f]/30">
                                    <table className="w-full text-sm">
                                      <thead className="text-left text-xs text-white/60">
                                        <tr>
                                          <th className="px-4 py-3">Type</th>
                                          <th className="px-4 py-3 text-right">
                                            Unmonitored
                                          </th>
                                          <th className="px-4 py-3 text-right">
                                            Duplicates
                                          </th>
                                          <th className="px-4 py-3 text-right">
                                            Watchlist
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {summaryRows.map((r) => (
                                          <tr
                                            key={r.label}
                                            className="border-t border-white/10"
                                          >
                                            <td className="px-4 py-3 text-white/85 font-semibold">
                                              {r.label}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-xs text-white/80">
                                              {asCount(r.unmonitored)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-xs text-white/80">
                                              {asCount(r.duplicates)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-xs text-white/80">
                                              {asCount(r.watchlist)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            );
                          })();

                          return (
                            <div>
                              {progressBlock}
                              {mediaAddedSummaryBlock}

                              {headline &&
                              !isRefreshJob &&
                              !isMediaAddedCleanup &&
                              jobId !== 'monitorConfirm' ? (
                                <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5">
                                  <div className="text-sm font-semibold text-white">
                                    {headline}
                                  </div>
                                </div>
                              ) : null}

                              {issues.length ? (
                                <div className="mb-6 rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-5">
                                  <div className="text-sm font-semibold text-white mb-3">
                                    Issues ({issues.length})
                                  </div>
                                  <ul className="space-y-2 text-sm">
                                    {issues.slice(0, 50).map((it, idx) => {
                                      const level = String(it.level ?? 'warn').toLowerCase();
                                      const msg = String(it.message ?? '').trim();
                                      const cls =
                                        level === 'error'
                                          ? 'text-red-200'
                                          : 'text-amber-200';
                                      return (
                                        <li
                                          key={`${idx}-${level}-${msg.slice(0, 24)}`}
                                          className={`${cls} font-mono text-xs whitespace-pre-wrap break-words`}
                                        >
                                          {level.toUpperCase()}: {msg}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              ) : null}

                              {!isRefreshJob && sections.length && !isMediaAddedCleanup ? (
                                <div className="space-y-4">
                                  {sections.map((sec, idx) => {
                                    const sectionId = pickString(sec, 'id');
                                    const title = pickString(sec, 'title') ?? `Section ${idx + 1}`;
                                    const rowsRaw = sec.rows;
                                    const rows = Array.isArray(rowsRaw)
                                      ? rowsRaw.filter(
                                          (r): r is Record<string, unknown> =>
                                            Boolean(r) &&
                                            typeof r === 'object' &&
                                            !Array.isArray(r),
                                        )
                                      : [];

                                    if (jobId === 'monitorConfirm' && (sectionId ?? '') === 'plex') {
                                      const getEnd = (label: string): number | null => {
                                        const row = rows.find(
                                          (r) => (pickString(r, 'label') ?? '') === label,
                                        );
                                        return row ? pickNumber(row, 'end') : null;
                                      };

                                      const plural = (
                                        n: number | null,
                                        singular: string,
                                        pluralWord: string,
                                      ) => {
                                        if (n === null) return '—';
                                        const nn = Math.max(0, Math.trunc(n));
                                        const word = nn === 1 ? singular : pluralWord;
                                        return `${nn.toLocaleString()} ${word}`;
                                      };

                                      const movieLibraries = getEnd('Movie libraries');
                                      const tvLibraries = getEnd('TV libraries');
                                      const totalMovies = getEnd('TMDB ids indexed');
                                      const totalShows = getEnd('TVDB shows indexed');

                                      const plexRows = [
                                        {
                                          label: 'Movie libraries',
                                          value: plural(movieLibraries, 'library', 'libraries'),
                                        },
                                        {
                                          label: 'TV libraries',
                                          value: plural(tvLibraries, 'library', 'libraries'),
                                        },
                                        {
                                          label: 'Total movies',
                                          value: plural(totalMovies, 'movie', 'movies'),
                                        },
                                        {
                                          label: 'Total shows',
                                          value: plural(totalShows, 'show', 'shows'),
                                        },
                                      ] as const;

                                      return (
                                        <div
                                          key={`${idx}-${title}`}
                                          className="rounded-2xl border border-white/10 bg-white/5 p-6"
                                        >
                                          <div className="text-sm font-semibold text-white mb-4">
                                            {title}
                                          </div>
                                          <div className="overflow-auto rounded-2xl border border-white/10 bg-[#0b0c0f]/30">
                                            <table className="w-full text-sm">
                                              <thead className="text-left text-xs text-white/60">
                                                <tr>
                                                  <th className="px-4 py-3">Metric</th>
                                                  <th className="px-4 py-3">Indexed</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {plexRows.map((r) => (
                                                  <tr
                                                    key={r.label}
                                                    className="border-t border-white/10"
                                                  >
                                                    <td className="px-4 py-3 text-white/85">
                                                      <div className="font-semibold">{r.label}</div>
                                                    </td>
                                                    <td className="px-4 py-3 font-mono text-xs text-white/80 whitespace-nowrap">
                                                      {r.value}
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      );
                                    }

                                    return (
                                      <div
                                        key={`${idx}-${title}`}
                                        className="rounded-2xl border border-white/10 bg-white/5 p-6"
                                      >
                                        <div className="text-sm font-semibold text-white mb-4">
                                          {title}
                                        </div>
                                        {rows.length ? (
                                          <div className="overflow-auto rounded-2xl border border-white/10 bg-[#0b0c0f]/30">
                                            <table className="w-full text-sm">
                                              <thead className="text-left text-xs text-white/60">
                                                <tr>
                                                  <th className="px-4 py-3">Metric</th>
                                                  <th className="px-4 py-3">Start</th>
                                                  <th className="px-4 py-3">Change</th>
                                                  <th className="px-4 py-3">End</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {rows.map((r, rIdx) => {
                                                  const label = pickString(r, 'label') ?? 'Metric';
                                                  const unit = pickString(r, 'unit');
                                                  const note = pickString(r, 'note');

                                                  const start = pickNumber(r, 'start');
                                                  const changed = pickNumber(r, 'changed');
                                                  const end = pickNumber(r, 'end');

                                                  const deltaClass =
                                                    changed === null
                                                      ? 'text-white/60'
                                                      : changed > 0
                                                        ? 'text-emerald-200'
                                                        : changed < 0
                                                          ? 'text-red-200'
                                                          : 'text-white/70';

                                                  return (
                                                    <tr key={`${rIdx}-${label}`} className="border-t border-white/10">
                                                      <td className="px-4 py-3 text-white/85">
                                                        <div className="font-semibold">{label}</div>
                                                        {note ? (
                                                          <div className="mt-1 text-xs text-white/60 font-mono">
                                                            {note}
                                                          </div>
                                                        ) : null}
                                                      </td>
                                                      <td className="px-4 py-3 font-mono text-xs text-white/70 whitespace-nowrap">
                                                        {formatMetric(start, unit)}
                                                      </td>
                                                      <td className={`px-4 py-3 font-mono text-xs whitespace-nowrap ${deltaClass}`}>
                                                        {formatDelta(changed, unit)}
                                                      </td>
                                                      <td className="px-4 py-3 font-mono text-xs text-white/80 whitespace-nowrap">
                                                        {formatMetric(end, unit)}
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                        ) : (
                                          <div className="text-sm text-white/70">
                                            No metrics.
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        }

                        if (jobId === 'monitorConfirm') {
                          const plexRaw = s.plex;
                          const plex =
                            plexRaw && typeof plexRaw === 'object' && !Array.isArray(plexRaw)
                              ? (plexRaw as Record<string, unknown>)
                              : null;

                          const plexMovieLibs = plex && Array.isArray(plex.movieLibraries) ? plex.movieLibraries.length : null;
                          const plexTvLibs = plex && Array.isArray(plex.tvLibraries) ? plex.tvLibraries.length : null;

                          const radarrTotalMonitored =
                            radarr && typeof radarr.totalMonitored === 'number' ? radarr.totalMonitored : 0;
                          const radarrChecked =
                            radarr && typeof radarr.checked === 'number' ? radarr.checked : null;
                          const radarrAlreadyInPlex =
                            radarr && typeof radarr.alreadyInPlex === 'number' ? radarr.alreadyInPlex : 0;
                          const radarrMissingTmdbId =
                            radarr && typeof radarr.missingTmdbId === 'number' ? radarr.missingTmdbId : 0;
                          const radarrKeptMonitored =
                            radarr && typeof radarr.keptMonitored === 'number' ? radarr.keptMonitored : null;
                          const radarrUnmonitored =
                            radarr && typeof radarr.unmonitored === 'number' ? radarr.unmonitored : 0;
                          const radarrSkippedPathConflicts =
                            radarr && typeof radarr.skippedPathConflicts === 'number'
                              ? radarr.skippedPathConflicts
                              : 0;

                          const sonarrTotalSeries =
                            sonarr && typeof sonarr.totalSeries === 'number' ? sonarr.totalSeries : 0;
                          const sonarrSeriesProcessed =
                            sonarr && typeof sonarr.seriesProcessed === 'number' ? sonarr.seriesProcessed : null;
                          const sonarrEpisodesChecked =
                            sonarr && typeof sonarr.episodesChecked === 'number' ? sonarr.episodesChecked : 0;
                          const sonarrEpisodesInPlex =
                            sonarr && typeof sonarr.episodesInPlex === 'number' ? sonarr.episodesInPlex : 0;
                          const sonarrEpisodesUnmonitored =
                            sonarr && typeof sonarr.episodesUnmonitored === 'number' ? sonarr.episodesUnmonitored : 0;
                          const sonarrSeasonsUnmonitored =
                            sonarr && typeof sonarr.seasonsUnmonitored === 'number' ? sonarr.seasonsUnmonitored : 0;
                          const sonarrSeriesUnmonitored =
                            sonarr && typeof sonarr.seriesUnmonitored === 'number' ? sonarr.seriesUnmonitored : 0;
                          const sonarrSeriesWithMissing =
                            sonarr && typeof sonarr.seriesWithMissing === 'number' ? sonarr.seriesWithMissing : 0;
                          const sonarrSearchQueued =
                            sonarr && typeof sonarr.missingEpisodeSearchQueued === 'boolean'
                              ? sonarr.missingEpisodeSearchQueued
                              : null;

                          return (
                            <div>
                              {progressBlock}

                              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-6">
                                <div className="grid gap-6 sm:grid-cols-3">
                                  <div>
                                    <div className="text-sm font-semibold text-white mb-3">Plex</div>
                                    <div className="space-y-1 text-sm text-white/70">
                                      {plexMovieLibs !== null ? (
                                        <div>
                                          <span className="text-white font-semibold">{plexMovieLibs}</span> movie libraries
                                        </div>
                                      ) : null}
                                      {plexTvLibs !== null ? (
                                        <div>
                                          <span className="text-white font-semibold">{plexTvLibs}</span> TV libraries
                                        </div>
                                      ) : null}
                                      {plex && typeof plex.tmdbIds === 'number' ? (
                                        <div>
                                          <span className="text-white font-semibold">{plex.tmdbIds}</span> TMDB ids indexed
                                        </div>
                                      ) : null}
                                      {plex && typeof plex.tvdbShows === 'number' ? (
                                        <div>
                                          <span className="text-white font-semibold">{plex.tvdbShows}</span> TVDB shows indexed
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-sm font-semibold text-white mb-3">Radarr</div>
                                    <div className="space-y-1 text-sm text-white/70">
                                      <div>
                                        <span className="text-white font-semibold">{radarrTotalMonitored}</span>{' '}
                                        monitored movies
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{radarrAlreadyInPlex}</span>{' '}
                                        {radarrAlreadyInPlex === 1
                                          ? 'Movie found in Plex'
                                          : 'Movies found in Plex'}
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">
                                          {radarrMissingTmdbId + radarrSkippedPathConflicts}
                                        </span>{' '}
                                        skipped
                                      </div>
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-sm font-semibold text-white mb-3">Sonarr</div>
                                    <div className="space-y-1 text-sm text-white/70">
                                      <div>
                                        <span className="text-white font-semibold">{sonarrEpisodesUnmonitored}</span> episodes unmonitored
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{sonarrEpisodesChecked}</span> episodes checked
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{sonarrEpisodesInPlex}</span> episodes found in Plex
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{sonarrTotalSeries}</span> series scanned
                                        {sonarrSeriesProcessed !== null ? (
                                          <span className="text-white/60"> (processed {sonarrSeriesProcessed})</span>
                                        ) : null}
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{sonarrSeriesWithMissing}</span> series with missing eps
                                      </div>
                                      {sonarrSeasonsUnmonitored ? (
                                        <div>
                                          <span className="text-white font-semibold">{sonarrSeasonsUnmonitored}</span> seasons unmonitored
                                        </div>
                                      ) : null}
                                      {sonarrSeriesUnmonitored ? (
                                        <div>
                                          <span className="text-white font-semibold">{sonarrSeriesUnmonitored}</span> series unmonitored
                                        </div>
                                      ) : null}
                                      {sonarrSearchQueued !== null ? (
                                        <div>
                                          MissingEpisodeSearch queued:{' '}
                                          <span className="text-white font-semibold">
                                            {sonarrSearchQueued ? 'yes' : 'no'}
                                          </span>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>

                                {/* Optional samples */}
                                {radarr && Array.isArray(radarr.sampleTitles) && radarr.sampleTitles.length ? (
                                  <details className="rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-4">
                                    <summary className="cursor-pointer text-sm text-white/80">
                                      Sample affected Radarr titles ({radarr.sampleTitles.length})
                                    </summary>
                                    <ul className="mt-3 space-y-1 text-xs text-white/70">
                                      {radarr.sampleTitles.slice(0, 25).map((t, idx) => (
                                        <li key={`${idx}-${String(t)}`} className="font-mono">
                                          {String(t)}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ) : null}
                              </div>

                            </div>
                          );
                        }

                        if (jobId === 'mediaAddedCleanup') {
                          const duplicatesRaw = s.duplicates;
                          const duplicates =
                            duplicatesRaw && typeof duplicatesRaw === 'object' && !Array.isArray(duplicatesRaw)
                              ? (duplicatesRaw as Record<string, unknown>)
                              : null;
                          const dupMode = duplicates ? pickString(duplicates, 'mode') : null;

                          const warningsRaw = s.warnings;
                          const warnings = Array.isArray(warningsRaw)
                            ? warningsRaw.map((w) => String(w)).filter(Boolean)
                            : [];

                          const watchlistRaw = s.watchlist;
                          const watchlist =
                            watchlistRaw && typeof watchlistRaw === 'object' && !Array.isArray(watchlistRaw)
                              ? (watchlistRaw as Record<string, unknown>)
                              : null;

                          const skipped = typeof s.skipped === 'boolean' ? s.skipped : false;
                          const mediaType = pickString(s, 'mediaType');
                          const title = pickString(s, 'title');

                          const movieStats =
                            dupMode === 'fullSweep' && duplicates && isPlainObject(duplicates.movie)
                              ? (duplicates.movie as Record<string, unknown>)
                              : null;
                          const episodeStats =
                            dupMode === 'fullSweep' && duplicates && isPlainObject(duplicates.episode)
                              ? (duplicates.episode as Record<string, unknown>)
                              : null;

                          return (
                            <div>
                              {progressBlock}

                              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-6">
                                <div className="grid gap-2 text-sm text-white/70">
                                  <div>
                                    <span className="text-white font-semibold">Mode:</span>{' '}
                                    {dupMode ?? mediaType ?? 'unknown'}
                                  </div>
                                  {title ? (
                                    <div>
                                      <span className="text-white font-semibold">Title:</span> {title}
                                    </div>
                                  ) : null}
                                  {skipped ? (
                                    <div className="text-amber-200">Skipped (see warnings/logs)</div>
                                  ) : null}
                                </div>

                                {dupMode === 'fullSweep' ? (
                                  <div className="grid gap-6 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-5">
                                      <div className="text-sm font-semibold text-white mb-3">Movie duplicates</div>
                                      <div className="grid grid-cols-2 gap-3 text-sm text-white/70">
                                        <div>
                                          <span className="text-white font-semibold">
                                            {movieStats ? (movieStats.scanned as number) : 0}
                                          </span>{' '}
                                          scanned
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {movieStats ? (movieStats.groupsWithDuplicates as number) : 0}
                                          </span>{' '}
                                          dup groups
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {movieStats ? (movieStats.metadataDeleted as number) : 0}
                                          </span>{' '}
                                          metadata deleted
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {movieStats ? (movieStats.partsDeleted as number) : 0}
                                          </span>{' '}
                                          parts deleted
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {movieStats ? (movieStats.radarrUnmonitored as number) : 0}
                                          </span>{' '}
                                          Radarr unmonitored
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {movieStats ? (movieStats.failures as number) : 0}
                                          </span>{' '}
                                          failures
                                        </div>
                                      </div>
                                    </div>

                                    <div className="rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-5">
                                      <div className="text-sm font-semibold text-white mb-3">Episode duplicates</div>
                                      <div className="grid grid-cols-2 gap-3 text-sm text-white/70">
                                        <div>
                                          <span className="text-white font-semibold">
                                            {episodeStats ? (episodeStats.candidates as number) : 0}
                                          </span>{' '}
                                          candidates
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {episodeStats ? (episodeStats.groupsWithDuplicates as number) : 0}
                                          </span>{' '}
                                          dup groups
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {episodeStats ? (episodeStats.metadataDeleted as number) : 0}
                                          </span>{' '}
                                          metadata deleted
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {episodeStats ? (episodeStats.partsDeleted as number) : 0}
                                          </span>{' '}
                                          parts deleted
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {episodeStats ? (episodeStats.sonarrUnmonitored as number) : 0}
                                          </span>{' '}
                                          Sonarr unmonitored
                                        </div>
                                        <div>
                                          <span className="text-white font-semibold">
                                            {episodeStats ? (episodeStats.failures as number) : 0}
                                          </span>{' '}
                                          failures
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : duplicates ? (
                                  <div className="rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-5 text-sm text-white/70">
                                    <div className="text-sm font-semibold text-white mb-2">Duplicates</div>
                                    <div>Mode: <span className="text-white font-semibold">{dupMode ?? 'unknown'}</span></div>
                                    {typeof duplicates.candidates === 'number' ? (
                                      <div>Candidates: <span className="text-white font-semibold">{duplicates.candidates}</span></div>
                                    ) : null}
                                    {duplicates.keptRatingKey ? (
                                      <div>Kept: <span className="text-white font-semibold font-mono">{String(duplicates.keptRatingKey)}</span></div>
                                    ) : null}
                                    {typeof duplicates.deletedMetadata === 'number' ? (
                                      <div>Deleted metadata: <span className="text-white font-semibold">{duplicates.deletedMetadata}</span></div>
                                    ) : null}
                                  </div>
                                ) : null}

                                {watchlist ? (
                                  <details className="rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-4">
                                    <summary className="cursor-pointer text-sm text-white/80">
                                      Watchlist details
                                    </summary>
                                    <pre className="mt-3 overflow-auto rounded bg-white/5 p-3 text-[11px] text-white/60">
{JSON.stringify(watchlist, null, 2)}
                                    </pre>
                                  </details>
                                ) : null}

                                {warnings.length ? (
                                  <details className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                                    <summary className="cursor-pointer text-sm text-amber-200">
                                      Warnings ({warnings.length})
                                    </summary>
                                    <ul className="mt-3 space-y-1 text-xs text-amber-100/90">
                                      {warnings.slice(0, 50).map((w, idx) => (
                                        <li key={`${idx}-${w}`} className="font-mono">
                                          {w}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ) : null}
                              </div>

                            </div>
                          );
                        }

                        if (collections) {
                          return (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
                              {collections.map((c, idx) => {
                                const name = String(c?.collectionName ?? 'Collection');
                                const jsonFile = c?.jsonFile ? String(c.jsonFile) : null;
                                const jsonFound = typeof c?.jsonFound === 'boolean' ? c.jsonFound : null;
                                const removed = Number.isFinite(Number(c?.removed)) ? Number(c.removed) : 0;
                                const added = Number.isFinite(Number(c?.added)) ? Number(c.added) : 0;
                                const moved = Number.isFinite(Number(c?.moved)) ? Number(c.moved) : 0;
                                const skipped = Number.isFinite(Number(c?.skipped)) ? Number(c.skipped) : 0;
                                const resolved = Number.isFinite(Number(c?.resolved)) ? Number(c.resolved) : null;

                                return (
                                  <div
                                    key={`${name}-${idx}`}
                                    className="rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-5"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-white truncate">{name}</div>
                                        {jsonFile ? (
                                          <div className="mt-1 text-xs text-white/60 font-mono truncate">
                                            {jsonFile}
                                          </div>
                                        ) : null}
                                      </div>
                                      {jsonFound === false ? (
                                        <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200">
                                          JSON missing
                                        </span>
                                      ) : null}
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-white/70 sm:grid-cols-4">
                                      <div>
                                        <span className="text-white font-semibold">{removed}</span> removed
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{added}</span> added
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{moved}</span> moved
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{skipped}</span> skipped
                                      </div>
                                    </div>

                                    {resolved !== null ? (
                                      <div className="mt-3 text-xs text-white/60">
                                        Resolved items: <span className="text-white/80 font-semibold">{resolved}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }

                        return (
                          <div>{progressBlock}</div>
                        );
                      })()
                    ) : isRunning ? (
                      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6">
                        <motion.div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent"
                          animate={{ x: ['0%', '200%'] }}
                          transition={{ duration: 1.35, repeat: Infinity, ease: 'linear' }}
                        />

                        <div className="relative">
                          <div className="flex items-center gap-2 text-sm text-white/80">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Still running… building summary</span>
                            <span className="inline-flex items-center gap-1">
                              <motion.span
                                className="h-1.5 w-1.5 rounded-full bg-white/70"
                                animate={{ opacity: [0.2, 1, 0.2] }}
                                transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
                              />
                              <motion.span
                                className="h-1.5 w-1.5 rounded-full bg-white/70"
                                animate={{ opacity: [0.2, 1, 0.2] }}
                                transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }}
                              />
                              <motion.span
                                className="h-1.5 w-1.5 rounded-full bg-white/70"
                                animate={{ opacity: [0.2, 1, 0.2] }}
                                transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
                              />
                            </span>
                          </div>

                          <div className="mt-6 grid gap-5 sm:grid-cols-2 animate-pulse">
                            <div className="space-y-3">
                              <div className="h-4 w-16 rounded bg-white/10" />
                              <div className="h-8 w-40 rounded bg-white/10" />
                            </div>
                            <div className="space-y-3">
                              <div className="h-4 w-16 rounded bg-white/10" />
                              <div className="h-8 w-44 rounded bg-white/10" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
                        No summary available.
                      </div>
                    )}
                  </div>
                </div>

                {/* Steps Card */}
                {reportV1 ? (
                  <div className={cardClass}>
                    <div className="mb-4 text-sm text-white/70">
                      Step-by-step breakdown
                    </div>

                    {Array.isArray(reportV1.tasks) && reportV1.tasks.length ? (
                      <div className="space-y-3">
                        {reportV1.tasks
                          .filter(
                            (t): t is Record<string, unknown> =>
                              Boolean(t) &&
                              typeof t === 'object' &&
                              !Array.isArray(t),
                          )
                          // Older runs may include redundant overview tasks like "Movie refresh" / "TV refresh".
                          // Hide these in the step list for refresher-style jobs to keep the breakdown focused.
                          .filter((t) => {
                            const jobId = String(run?.jobId ?? '').toLowerCase();
                            const isRefresher = jobId.includes('refresher');
                            if (!isRefresher) return true;
                            const title = (pickString(t, 'title') ?? '').toLowerCase();
                            return title !== 'movie refresh' && title !== 'tv refresh';
                          })
                          .map((t, idx) => {
                            const title = pickString(t, 'title') ?? `Step ${idx + 1}`;
                            const status = pickString(t, 'status') ?? 'success';
                            const rowsRaw = t.rows;
                            const rows = Array.isArray(rowsRaw)
                              ? rowsRaw.filter(
                                  (r): r is Record<string, unknown> =>
                                    Boolean(r) &&
                                    typeof r === 'object' &&
                                    !Array.isArray(r),
                                )
                              : [];
                            const factsRaw = t.facts;
                            const facts = Array.isArray(factsRaw)
                              ? factsRaw.filter(
                                  (f): f is Record<string, unknown> =>
                                    Boolean(f) &&
                                    typeof f === 'object' &&
                                    !Array.isArray(f),
                                )
                              : [];
                            const issuesRaw = t.issues;
                            const issues = Array.isArray(issuesRaw)
                              ? issuesRaw.filter(
                                  (i): i is Record<string, unknown> =>
                                    Boolean(i) &&
                                    typeof i === 'object' &&
                                    !Array.isArray(i),
                                )
                              : [];

                            const formatMetric = (value: number | null, unit?: string | null) => {
                              if (value === null) return '—';
                              const s = Number.isInteger(value)
                                ? value.toLocaleString()
                                : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
                              const u = (unit ?? '').trim();
                              return u ? `${s} ${u}` : s;
                            };
                            const formatDelta = (value: number | null, unit?: string | null) => {
                              if (value === null) return '—';
                              const abs = Math.abs(value);
                              const s = Number.isInteger(abs)
                                ? abs.toLocaleString()
                                : abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
                              const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
                              const u = (unit ?? '').trim();
                              return u ? `${prefix}${s} ${u}` : `${prefix}${s}`;
                            };

                            return (
                              <details
                                key={`${idx}-${title}`}
                                className="rounded-2xl border border-white/10 bg-white/5 p-5"
                              >
                                <summary className="cursor-pointer list-none">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-white truncate">
                                        {title}
                                      </div>
                                      {issues.length ? (
                                        <div className="mt-1 text-xs text-amber-200">
                                          {issues.length} issue(s)
                                        </div>
                                      ) : null}
                                    </div>
                                    <span
                                      className={`shrink-0 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${taskStatusPill(
                                        status,
                                      )}`}
                                    >
                                      {status}
                                    </span>
                                  </div>
                                </summary>

                                {issues.length ? (
                                  <div className="mt-4 rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-4">
                                    <div className="text-xs font-semibold text-white/80 mb-2">
                                      Issues
                                    </div>
                                    <ul className="space-y-1 text-xs font-mono">
                                      {issues.slice(0, 50).map((it, ii) => {
                                        const level = String(it.level ?? 'warn').toLowerCase();
                                        const msg = String(it.message ?? '').trim();
                                        const cls =
                                          level === 'error'
                                            ? 'text-red-200'
                                            : 'text-amber-200';
                                        return (
                                          <li
                                            key={`${idx}-${ii}-${level}-${msg.slice(0, 24)}`}
                                            className={`${cls} whitespace-pre-wrap break-words`}
                                          >
                                            {level.toUpperCase()}: {msg}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                ) : null}

                                {rows.length ? (
                                  <div className="mt-4 overflow-auto rounded-2xl border border-white/10 bg-[#0b0c0f]/30">
                                    <table className="w-full text-sm">
                                      <thead className="text-left text-xs text-white/60">
                                        <tr>
                                          <th className="px-4 py-3">Metric</th>
                                          <th className="px-4 py-3">Start</th>
                                          <th className="px-4 py-3">Change</th>
                                          <th className="px-4 py-3">End</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {rows.map((r, rIdx) => {
                                          const label = pickString(r, 'label') ?? 'Metric';
                                          const unit = pickString(r, 'unit');
                                          const start = pickNumber(r, 'start');
                                          const changed = pickNumber(r, 'changed');
                                          const end = pickNumber(r, 'end');
                                          const deltaClass =
                                            changed === null
                                              ? 'text-white/60'
                                              : changed > 0
                                                ? 'text-emerald-200'
                                                : changed < 0
                                                  ? 'text-red-200'
                                                  : 'text-white/70';
                                          return (
                                            <tr
                                              key={`${idx}-${rIdx}-${label}`}
                                              className="border-t border-white/10"
                                            >
                                              <td className="px-4 py-3 text-white/85 font-semibold">
                                                {label}
                                              </td>
                                              <td className="px-4 py-3 font-mono text-xs text-white/70 whitespace-nowrap">
                                                {formatMetric(start, unit)}
                                              </td>
                                              <td className={`px-4 py-3 font-mono text-xs whitespace-nowrap ${deltaClass}`}>
                                                {formatDelta(changed, unit)}
                                              </td>
                                              <td className="px-4 py-3 font-mono text-xs text-white/80 whitespace-nowrap">
                                                {formatMetric(end, unit)}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : null}

                                {facts.length ? (
                                  <div className="mt-4 rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-4">
                                    <div className="text-xs font-semibold text-white/80 mb-2">
                                      Facts
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      {facts.slice(0, 50).map((f, fi) => {
                                        const label = String(f.label ?? '').trim() || 'Fact';
                                        const rawValue = (f as Record<string, unknown>).value;

                                        const expandable = (() => {
                                          if (!isPlainObject(rawValue)) return null;
                                          const count = pickNumber(rawValue, 'count');
                                          const unit = pickString(rawValue, 'unit');
                                          const items = pickStringArray(rawValue, 'items');
                                          if (count === null && items.length === 0) return null;
                                          return { count, unit, items };
                                        })();

                                        const formatCount = (count: number | null, unit?: string | null) => {
                                          if (count === null) return '—';
                                          const s = Number.isInteger(count)
                                            ? count.toLocaleString()
                                            : count.toLocaleString(undefined, { maximumFractionDigits: 2 });
                                          const u = (unit ?? '').trim();
                                          return u ? `${s} ${u}` : s;
                                        };

                                        if (expandable) {
                                          return (
                                            <details
                                              key={`${idx}-${fi}-${label}`}
                                              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                                            >
                                              <summary className="cursor-pointer list-none">
                                                <div className="text-[11px] text-white/60 font-mono">
                                                  {label}
                                                </div>
                                                <div className="mt-1 text-xs text-white/80 font-mono break-words">
                                                  {formatCount(expandable.count, expandable.unit)}
                                                  {expandable.items.length ? (
                                                    <span className="ml-2 text-white/50">
                                                      (tap to view)
                                                    </span>
                                                  ) : null}
                                                </div>
                                              </summary>

                                              {expandable.items.length ? (
                                                <div className="mt-3 rounded-xl border border-white/10 bg-[#0b0c0f]/30 p-3">
                                                  <div className="mb-2 text-[11px] text-white/60 font-mono">
                                                    Items ({expandable.items.length})
                                                  </div>
                                                  <div className="max-h-64 overflow-auto pr-1">
                                                    <ul className="space-y-1 text-xs text-white/80 font-mono">
                                                      {expandable.items.slice(0, 300).map((it, ii) => (
                                                        <li
                                                          key={`${idx}-${fi}-${ii}-${it.slice(0, 24)}`}
                                                          className="whitespace-pre-wrap break-words"
                                                        >
                                                          {it}
                                                        </li>
                                                      ))}
                                                    </ul>
                                                  </div>
                                                </div>
                                              ) : null}
                                            </details>
                                          );
                                        }

                                        return (
                                          <div
                                            key={`${idx}-${fi}-${label}`}
                                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                                          >
                                            <div className="text-[11px] text-white/60 font-mono">
                                              {label}
                                            </div>
                                            <div className="mt-1 text-xs text-white/80 font-mono break-words">
                                              {typeof rawValue === 'string'
                                                ? rawValue
                                                : rawValue === null || rawValue === undefined
                                                  ? '—'
                                                  : JSON.stringify(rawValue)}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}
                              </details>
                            );
                          })}
                      </div>
                    ) : (
                      <div className="text-sm text-white/70">
                        No structured steps available.
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Logs Card */}
                <div className={cardClass}>
                  <div className="text-sm text-white/70 mb-4">
                    {(() => {
                      if (logsQuery.isLoading) return 'Loading…';
                      const parts: string[] = [];
                      if (logStats.error) parts.push(`${logStats.error} errors`);
                      if (logStats.warn) parts.push(`${logStats.warn} warnings`);
                      if (isRunning) parts.push('updating');
                      return parts.length ? parts.join(' • ') : 'Logs';
                    })()}
                  </div>

                  {logsQuery.error ? (
                    <div className="flex items-start gap-2 text-sm text-red-200">
                      <CircleAlert className="mt-0.5 h-4 w-4" />
                      <div>{(logsQuery.error as Error).message}</div>
                    </div>
                  ) : visibleLogs.length ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                      {/* Mobile: stacked log cards */}
                      <div className="md:hidden max-h-[65vh] overflow-auto p-3 space-y-3">
                        {visibleLogs.map((line) => (
                          <div
                            key={line.id}
                            className="rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="font-mono text-[11px] text-white/60 whitespace-nowrap">
                                  {new Date(line.time).toLocaleTimeString()}
                                </div>
                                <span
                                  className={`font-mono text-[11px] font-semibold ${levelClass(line.level)}`}
                                >
                                  {line.level}
                                </span>
                              </div>

                              {line.context ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedContext((prev) => ({
                                      ...prev,
                                      [line.id]: !prev[line.id],
                                    }))
                                  }
                                  className="shrink-0 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/70 transition-all duration-200 active:scale-95 hover:bg-white/10"
                                >
                                  {expandedContext[line.id] ? 'Hide details' : 'Details'}
                                </button>
                              ) : null}
                            </div>

                            <div className="mt-3 font-mono text-xs text-white/85 whitespace-pre-wrap break-words">
                              {line.message}
                            </div>

                            {line.context && expandedContext[line.id] ? (
                              <pre className="mt-3 overflow-auto rounded bg-white/5 p-3 text-[11px] text-white/60">
{JSON.stringify(line.context, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      {/* Desktop: table */}
                      <div
                        className="hidden md:block overflow-auto"
                        style={{ maxHeight: 'calc(100vh - 400px)' }}
                      >
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs text-white/60 sticky top-0 z-20 bg-[#0b0c0f]/95 backdrop-blur-sm">
                            <tr>
                              <th className="border-b border-white/10 px-4 py-3 whitespace-nowrap">
                                Time
                              </th>
                              <th className="border-b border-white/10 px-4 py-3 whitespace-nowrap">
                                Level
                              </th>
                              <th className="border-b border-white/10 px-4 py-3">Message</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleLogs.map((line) => (
                              <tr
                                key={line.id}
                                className="border-t border-white/10 hover:bg-white/5"
                              >
                                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-white/60">
                                  {new Date(line.time).toLocaleTimeString()}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span
                                    className={`font-mono text-xs font-semibold ${levelClass(
                                      line.level,
                                    )}`}
                                  >
                                    {line.level}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-white/85">
                                  {line.message}
                                  {line.context ? (
                                    <div className="mt-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedContext((prev) => ({
                                            ...prev,
                                            [line.id]: !prev[line.id],
                                          }))
                                        }
                                        className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/70 transition-all duration-200 active:scale-95 hover:bg-white/10"
                                      >
                                        {expandedContext[line.id]
                                          ? 'Hide details'
                                          : 'Details'}
                                      </button>
                                      {expandedContext[line.id] ? (
                                        <pre className="mt-2 overflow-auto rounded bg-white/5 p-2 text-[11px] text-white/60">
{JSON.stringify(line.context, null, 2)}
                                        </pre>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-white/70">No logs yet.</div>
                  )}

                  {/* Raw Response (inline) */}
                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => setShowRawResponse((v) => !v)}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 transition-all duration-200 active:scale-95 hover:bg-white/10 touch-manipulation"
                    >
                      {showRawResponse ? 'Hide raw response' : 'See raw response'}
                    </button>

                    {showRawResponse ? (
                      <div className="mt-4 space-y-4">
                        <div>
                          <div className="text-xs text-white/60 mb-2">
                            Run summary (JSON)
                          </div>
                          <pre className="overflow-auto rounded-2xl border border-white/10 bg-white/5 p-4 text-[11px] text-white/60">
{JSON.stringify(run.summary, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-xs text-white/60 mb-2">
                            Logs response (JSON)
                          </div>
                          <pre className="overflow-auto rounded-2xl border border-white/10 bg-white/5 p-4 text-[11px] text-white/60">
{JSON.stringify(logs, null, 2)}
                          </pre>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className={cardClass}>
                <div className="text-white font-semibold">Run not found</div>
              </div>
            )}
        </div>
      </section>
    </div>
  );
}


