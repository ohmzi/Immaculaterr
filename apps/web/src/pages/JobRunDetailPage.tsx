import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Loader2 } from 'lucide-react';

import { getRun, getRunLogs } from '@/api/jobs';

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
  const logs = useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data?.logs]);
  const logStats = useMemo(() => {
    const counts = { error: 0, warn: 0 };
    for (const l of logs) {
      const lvl = String(l.level ?? '').toLowerCase();
      if (lvl === 'error') counts.error += 1;
      else if (lvl === 'warn' || lvl === 'warning') counts.warn += 1;
    }
    return counts;
  }, [logs]);

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Background (landing-page style, cyan-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/30 via-sky-700/40 to-indigo-900/65" />
        <div className="absolute inset-0 bg-[#0b0c0f]/15" />
      </div>

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
              <div className="flex items-center gap-3 mb-2">
                <Link
                  to="/history"
                  className="text-white/70 hover:text-white transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <h1 className="text-4xl font-bold text-white">
                  {run?.jobId ?? 'Job Run'}
                </h1>
                {run && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${statusPill(run.status)}`}>
                    {run.status}
                    {run.dryRun ? ' (dry-run)' : ''}
                  </span>
                )}
              </div>
              <p className="text-lg text-white/70 ml-8">
                Run ID: <span className="font-mono text-white/90">{runId}</span>
              </p>
            </div>

            {runQuery.isLoading ? (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.05 }}
                className={cardClass}
              >
                <div className="flex items-center gap-2 text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <div className="text-lg font-semibold">Loading run…</div>
                </div>
              </motion.div>
            ) : runQuery.error ? (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.05 }}
                className={`${cardClass} border-red-500/25 bg-[#0b0c0f]/70`}
              >
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 text-red-300" />
                  <div className="min-w-0">
                    <div className="text-white font-semibold">Failed to load run</div>
                    <div className="text-sm text-white/70">
                      {(runQuery.error as Error).message}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : run ? (
              <div className="grid gap-6">
                {/* Run Details Card */}
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.1 }}
                  className={cardClass}
                >
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

                    {run.summary && typeof run.summary === 'object' ? (
                      (() => {
                        const s = run.summary as Record<string, unknown>;

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

                        const hasMonitorConfirm = Boolean(radarr || sonarr);

                        const radarrUnmonitored =
                          radarr && typeof radarr.unmonitored === 'number'
                            ? radarr.unmonitored
                            : 0;

                        const sonarrEpisodesUnmonitored =
                          sonarr && typeof sonarr.episodesUnmonitored === 'number'
                            ? sonarr.episodesUnmonitored
                            : 0;

                        const collectionsRaw = s.collections;
                        const collections = Array.isArray(collectionsRaw)
                          ? collectionsRaw.filter(
                              (c): c is Record<string, unknown> =>
                                Boolean(c) &&
                                typeof c === 'object' &&
                                !Array.isArray(c),
                            )
                          : null;

                        if (hasMonitorConfirm) {
                          return (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-6">
                              {radarr && (
                                <div>
                                  <div className="text-sm font-semibold text-white mb-3">Radarr</div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl font-bold text-white">
                                      {radarrUnmonitored}
                                    </span>
                                    <span className="text-white/70">
                                      unmonitored {radarrUnmonitored === 1 ? 'movie' : 'movies'}
                                    </span>
                                  </div>
                                </div>
                              )}
                              {sonarr && (
                                <div>
                                  <div className="text-sm font-semibold text-white mb-3">Sonarr</div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl font-bold text-white">
                                      {sonarrEpisodesUnmonitored}
                                    </span>
                                    <span className="text-white/70">
                                      unmonitored {sonarrEpisodesUnmonitored === 1 ? 'episode' : 'episodes'}
                                    </span>
                                  </div>
                                </div>
                              )}
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
                          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
                            Summary is available for this job, but no renderer is configured for it.
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
                </motion.div>

                {/* Logs Card */}
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.15 }}
                  className={cardClass}
                >
                  <div className="text-sm text-white/70 mb-4">
                    {logsQuery.isLoading ? 'Loading…' : `${logs.length} lines`}
                    {logStats.error ? ` • ${logStats.error} errors` : ''}
                    {logStats.warn ? ` • ${logStats.warn} warnings` : ''}
                    {isRunning ? ' • live' : ''}
                  </div>

                  {logsQuery.error ? (
                    <div className="flex items-start gap-2 text-sm text-red-200">
                      <CircleAlert className="mt-0.5 h-4 w-4" />
                      <div>{(logsQuery.error as Error).message}</div>
                    </div>
                  ) : logs.length ? (
                    <div className="overflow-auto rounded-2xl border border-white/10 bg-white/5" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs text-white/60 sticky top-0 z-20 bg-[#0b0c0f]/95 backdrop-blur-sm">
                          <tr>
                            <th className="border-b border-white/10 px-4 py-3 whitespace-nowrap">Time</th>
                            <th className="border-b border-white/10 px-4 py-3 whitespace-nowrap">Level</th>
                            <th className="border-b border-white/10 px-4 py-3">Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((line) => (
                            <tr
                              key={line.id}
                              className="border-t border-white/10 hover:bg-white/5"
                            >
                              <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-white/60">
                                {new Date(line.time).toLocaleTimeString()}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`font-mono text-xs font-semibold ${levelClass(line.level)}`}>
                                  {line.level}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-white/85">
                                {line.message}
                                {line.context ? (
                                  <pre className="mt-2 overflow-auto rounded bg-white/5 p-2 text-[11px] text-white/60">
{JSON.stringify(line.context, null, 2)}
                                  </pre>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-sm text-white/70">No logs yet.</div>
                  )}
                </motion.div>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.05 }}
                className={cardClass}
              >
                <div className="text-white font-semibold">Run not found</div>
              </motion.div>
            )}
          </motion.div>
        </div>
      </section>
    </div>
  );
}


