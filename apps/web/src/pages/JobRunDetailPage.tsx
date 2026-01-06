import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Copy, Loader2, RotateCcw } from 'lucide-react';

import { getRun, getRunLogs, listJobs } from '@/api/jobs';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function levelClass(level: string) {
  const l = level.toLowerCase();
  if (l === 'error') return 'text-red-200';
  if (l === 'warn' || l === 'warning') return 'text-amber-200';
  if (l === 'debug') return 'text-white/50';
  return 'text-white/80';
}

export function JobRunDetailPage() {
  const params = useParams();
  const runId = params.runId ?? '';
  const [showDebug, setShowDebug] = useState(false);
  const [expandedContext, setExpandedContext] = useState<Record<number, boolean>>({});
  const [runIdCopied, setRunIdCopied] = useState(false);

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
  const jobName = useMemo(() => {
    const jobId = run?.jobId ?? '';
    if (!jobId) return null;
    const jobs = jobsQuery.data?.jobs ?? [];
    const def = jobs.find((j) => j.id === jobId) ?? null;
    return def?.name ?? null;
  }, [jobsQuery.data?.jobs, run?.jobId]);
  const logs = useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data?.logs]);
  const visibleLogs = useMemo(() => {
    if (showDebug) return logs;
    return logs.filter((l) => String(l.level ?? '').toLowerCase() !== 'debug');
  }, [logs, showDebug]);
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
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Background (landing-page style, Rewind violet-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-400/35 via-violet-700/45 to-indigo-900/65" />
        <div className="absolute inset-0 bg-[#0b0c0f]/15" />
      </div>

      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-10">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Page Header (match Rewind hero style) */}
              <div className="mb-10">
                <div className="flex flex-col gap-4 min-w-0">
                  <div className="flex items-center gap-4">
                    <div className="relative shrink-0">
                      <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20" />
                      <div className="relative p-3 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_20px_rgba(250,204,21,0.4)] border-2 border-white/10">
                        <RotateCcw className="w-8 h-8 text-black" strokeWidth={2.5} />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-5xl sm:text-6xl font-black tracking-tighter text-white drop-shadow-xl">
                          {(jobName ?? run?.jobId ?? 'Rewind') + ' Report'}
                        </h1>
                      </div>
                    </div>
                  </div>

                  <p className="text-purple-200/70 text-lg font-medium max-w-2xl leading-relaxed ml-1">
                    Execution report with live progress, a full summary, and detailed logs.
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
                  <div className="text-sm text-white/70 mb-4">
                    Started: {new Date(run.startedAt).toLocaleString()}
                    {run.finishedAt ? ` • Finished: ${new Date(run.finishedAt).toLocaleString()}` : ''}
                  </div>

                  {run.errorMessage ? (
                    <div className="mb-6 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
                      <div className="font-semibold mb-1">Error:</div>
                      {run.errorMessage}
                    </div>
                  ) : null}

                  <div>
                    <div className="mb-3 text-sm font-medium text-white/85">Summary</div>

                    {/* Summary meta (status + run id) */}
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${statusPill(run.status)}`}
                        >
                          {run.status}
                          {run.dryRun ? ' (dry-run)' : ''}
                        </span>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                        <div className="text-xs text-white/60">Run ID</div>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/85 break-all">
                            {runId}
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(runId);
                                setRunIdCopied(true);
                                window.setTimeout(() => setRunIdCopied(false), 1400);
                              } catch {
                                // ignore
                              }
                            }}
                            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition-all duration-200 active:scale-95 hover:bg-white/10 touch-manipulation"
                            aria-label="Copy run ID"
                            title="Copy run ID"
                          >
                            <Copy className="h-4 w-4" />
                            <span className="hidden sm:inline">
                              {runIdCopied ? 'Copied' : 'Copy'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {run.summary && typeof run.summary === 'object' ? (
                      (() => {
                        const s = run.summary as Record<string, unknown>;

                        const jobId = String(run.jobId ?? '');

                        const progressRaw = s.progress;
                        const progress = isPlainObject(progressRaw) ? progressRaw : null;
                        const progressMessage = progress ? pickString(progress, 'message') : null;
                        const progressStep = progress ? pickString(progress, 'step') : null;
                        const progressCurrent = progress ? pickNumber(progress, 'current') : null;
                        const progressTotal = progress ? pickNumber(progress, 'total') : null;
                        const progressPct =
                          progressCurrent !== null && progressTotal !== null && progressTotal > 0
                            ? Math.max(0, Math.min(100, (progressCurrent / progressTotal) * 100))
                            : null;

                        const isFinished = run.status === 'SUCCESS' || run.status === 'FAILED';
                        const displayProgressMessage =
                          isFinished && run.status === 'SUCCESS'
                            ? 'Completed.'
                            : isFinished && run.status === 'FAILED'
                              ? 'Failed.'
                              : progressMessage;
                        // When the run is finished, the status pill already conveys state; don't show step noise.
                        const displayProgressStep = isFinished ? null : progressStep;
                        const displayProgressTotal = progressTotal;
                        const displayProgressCurrent =
                          isFinished && run.status === 'SUCCESS' && progressTotal !== null
                            ? progressTotal
                            : progressCurrent;
                        const displayProgressPct =
                          isFinished && run.status === 'SUCCESS' && progressTotal !== null
                            ? 100
                            : progressPct;
                        const progressBarClass =
                          run.status === 'SUCCESS'
                            ? 'bg-emerald-400/90'
                            : run.status === 'FAILED'
                              ? 'bg-red-400/90'
                              : 'bg-[#facc15]/90';

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

                        const progressBlock = displayProgressMessage ? (
                          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white">
                                  {displayProgressMessage}
                                </div>
                                {displayProgressStep ? (
                                  <div className="mt-1 text-xs text-white/60 font-mono">
                                    step: {displayProgressStep}
                                  </div>
                                ) : null}
                              </div>
                              {displayProgressCurrent !== null && displayProgressTotal !== null ? (
                                <div className="shrink-0 text-xs text-white/70 font-mono">
                                  {Math.trunc(displayProgressCurrent)}/{Math.trunc(displayProgressTotal)}
                                </div>
                              ) : null}
                            </div>

                            {displayProgressPct !== null ? (
                              <div className="mt-4">
                                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                                  <div
                                    className={`h-full ${progressBarClass}`}
                                    style={{ width: `${displayProgressPct}%` }}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null;

                        const rawSummary = (
                          <details className="mt-4 rounded-2xl border border-white/10 bg-[#0b0c0f]/30 p-4">
                            <summary className="cursor-pointer text-sm text-white/80">
                              Raw summary (JSON)
                            </summary>
                            <pre className="mt-3 overflow-auto rounded bg-white/5 p-3 text-[11px] text-white/60">
{JSON.stringify(run.summary, null, 2)}
                            </pre>
                          </details>
                        );

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
                                        <span className="text-white font-semibold">{radarrUnmonitored}</span> unmonitored
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{radarrAlreadyInPlex}</span> were already in Plex
                                      </div>
                                      <div>
                                        <span className="text-white font-semibold">{radarrTotalMonitored}</span> monitored scanned
                                        {radarrChecked !== null ? (
                                          <span className="text-white/60"> (checked {radarrChecked})</span>
                                        ) : null}
                                      </div>
                                      {radarrKeptMonitored !== null ? (
                                        <div>
                                          <span className="text-white font-semibold">{radarrKeptMonitored}</span> kept monitored
                                        </div>
                                      ) : null}
                                      {radarrSkippedPathConflicts ? (
                                        <div>
                                          <span className="text-white font-semibold">{radarrSkippedPathConflicts}</span> skipped (path conflicts)
                                        </div>
                                      ) : null}
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

                              {rawSummary}
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

                              {rawSummary}
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
                          <div>
                            {progressBlock}
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
                              No specialized summary view for this job yet.
                            </div>
                            {rawSummary}
                          </div>
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

                {/* Logs Card */}
                <div className={cardClass}>
                  <div className="text-sm text-white/70 mb-4">
                    {logsQuery.isLoading ? 'Loading…' : `${visibleLogs.length} lines`}
                    {!showDebug && logs.length !== visibleLogs.length
                      ? ` • ${logs.length - visibleLogs.length} debug hidden`
                      : ''}
                    {logStats.error ? ` • ${logStats.error} errors` : ''}
                    {logStats.warn ? ` • ${logStats.warn} warnings` : ''}
                    {isRunning ? ' • live' : ''}
                  </div>

                  <div className="mb-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDebug((v) => !v)}
                      className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 transition-all duration-200 active:scale-95 hover:bg-white/10"
                    >
                      {showDebug ? 'Hide debug' : 'Show debug'}
                    </button>
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
                </div>
              </div>
            ) : (
              <div className={cardClass}>
                <div className="text-white font-semibold">Run not found</div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}


