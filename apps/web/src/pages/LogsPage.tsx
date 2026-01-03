import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Loader2 } from 'lucide-react';

import { getRun, getRunLogs, listJobs, listRuns } from '@/api/jobs';

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

function levelStyles(level: string) {
  const l = level.toLowerCase();
  if (l === 'error') {
    return {
      row: 'bg-red-500/8',
      pill: 'text-red-200',
    };
  }
  if (l === 'warn' || l === 'warning') {
    return {
      row: 'bg-amber-500/10',
      pill: 'text-amber-200',
    };
  }
  if (l === 'debug') {
    return {
      row: '',
      pill: 'text-white/50',
    };
  }
  return { row: '', pill: 'text-white/80' };
}

export function LogsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const paramRunId = params.runId ?? '';

  const [jobId, setJobId] = useState('');
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [q, setQ] = useState('');

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: ['jobRuns', 'logsPage'],
    queryFn: () => listRuns({ take: 200 }),
    staleTime: 2_000,
    refetchInterval: 3_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const runs = historyQuery.data?.runs ?? [];
  const runsForJob = useMemo(() => {
    if (!jobId) return runs;
    return runs.filter((r) => r.jobId === jobId);
  }, [runs, jobId]);

  // Keep local selection in sync with URL param.
  useEffect(() => {
    if (paramRunId) setSelectedHistoryId(paramRunId);
  }, [paramRunId]);

  // Ensure selection stays valid for the current job filter.
  useEffect(() => {
    if (paramRunId) return;
    if (!runsForJob.length) return;
    if (!selectedHistoryId || !runsForJob.some((r) => r.id === selectedHistoryId)) {
      setSelectedHistoryId(runsForJob[0]!.id);
    }
  }, [paramRunId, runsForJob, selectedHistoryId]);

  const historyId = paramRunId || selectedHistoryId || '';

  const runQuery = useQuery({
    queryKey: ['jobRun', historyId],
    queryFn: () => getRun(historyId),
    enabled: Boolean(historyId),
    refetchInterval: (q) => {
      const data = q.state.data as { run: { status?: string } } | undefined;
      return data?.run?.status === 'RUNNING' ? 2000 : false;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });

  // If deep-linked via /logs/:runId, set the job filter to match the selected entry.
  useEffect(() => {
    if (!paramRunId) return;
    const jid = runQuery.data?.run?.jobId;
    if (jid && jid !== jobId) setJobId(jid);
  }, [paramRunId, runQuery.data?.run?.jobId, jobId]);

  const isRunning = runQuery.data?.run?.status === 'RUNNING';

  const logsQuery = useQuery({
    queryKey: ['jobRunLogs', historyId],
    queryFn: () => getRunLogs({ runId: historyId, take: 1000 }),
    enabled: Boolean(historyId),
    refetchInterval: isRunning ? 2000 : false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const logs = useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data?.logs]);
  const filteredLogs = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter((l) => `${l.level ?? ''} ${l.message ?? ''}`.toLowerCase().includes(query));
  }, [logs, q]);

  const logStats = useMemo(() => {
    const counts = { error: 0, warn: 0 };
    for (const l of filteredLogs) {
      const lvl = String(l.level ?? '').toLowerCase();
      if (lvl === 'error') counts.error += 1;
      else if (lvl === 'warn' || lvl === 'warning') counts.warn += 1;
    }
    return counts;
  }, [filteredLogs]);

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const labelClass = 'block text-sm font-medium text-white/70 mb-2';
  const inputBaseClass =
    'px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-400/70 focus:border-transparent outline-none transition';
  const inputClass = `w-full ${inputBaseClass}`;
  const selectClass = `w-full ${inputBaseClass}`;
  const secondaryButtonClass =
    'px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-full active:scale-95 transition-all duration-300 inline-flex items-center gap-2 min-h-[44px] font-medium border border-white/15';

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
            <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">Logs</h1>
                <p className="text-lg text-white/70">Inspect logs for job history entries.</p>
              </div>
              <Link to="/history" className={secondaryButtonClass}>
                Back to History
              </Link>
            </div>

            {historyQuery.isLoading ? (
              <div className={cardClass}>
                <div className="flex items-center gap-2 text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <div className="text-lg font-semibold">Loading logs…</div>
                </div>
              </div>
            ) : historyQuery.error ? (
              <div className={`${cardClass} border-red-500/25 bg-[#0b0c0f]/70`}>
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 text-red-300" />
                  <div className="min-w-0">
                    <div className="text-white font-semibold">Failed to load logs</div>
                    <div className="text-sm text-white/70">
                      {(historyQuery.error as Error).message}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.05 }}
                  className={cardClass}
                >
                  <div className="mb-6">
                    <div className="text-2xl font-semibold text-white">Filters</div>
                    <div className="mt-2 text-sm text-white/70">
                      Choose a job and history entry, then filter log lines.
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className={labelClass}>Job</label>
                      <select
                        value={jobId}
                        onChange={(e) => {
                          const nextJob = e.target.value;
                          setJobId(nextJob);
                          // If we were deep-linked, return to /logs (selection will auto-pick).
                          if (paramRunId) navigate('/logs');
                        }}
                        className={selectClass}
                      >
                        <option value="">All jobs</option>
                        {(jobsQuery.data?.jobs ?? []).map((j) => (
                          <option key={j.id} value={j.id}>
                            {j.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelClass}>History entry</label>
                      <select
                        value={historyId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setSelectedHistoryId(nextId);
                          navigate(nextId ? `/logs/${nextId}` : '/logs');
                        }}
                        className={selectClass}
                        disabled={!runsForJob.length}
                      >
                        {runsForJob.length ? null : <option value="">No history yet</option>}
                        {runsForJob.map((r) => (
                          <option key={r.id} value={r.id}>
                            {new Date(r.startedAt).toLocaleString()} · {r.jobId} · {r.status}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelClass}>Search</label>
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="level, message…"
                        className={inputClass}
                        disabled={!historyId}
                      />
                    </div>
                  </div>

                  {runQuery.data?.run ? (
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <span
                        className={[
                          'rounded-full px-2.5 py-1 text-xs font-medium inline-flex items-center',
                          statusPill(runQuery.data.run.status),
                        ].join(' ')}
                      >
                        {runQuery.data.run.status}
                        {runQuery.data.run.dryRun ? ' (dry-run)' : ''}
                      </span>
                      <span className="text-xs text-white/60">
                        Started: {new Date(runQuery.data.run.startedAt).toLocaleString()}
                        {runQuery.data.run.finishedAt
                          ? ` · Finished: ${new Date(runQuery.data.run.finishedAt).toLocaleString()}`
                          : ''}
                      </span>
                    </div>
                  ) : null}
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.1 }}
                  className={cardClass}
                >
                  <div className="mb-6">
                    <div className="text-2xl font-semibold text-white">Log lines</div>
                    <div className="mt-2 text-sm text-white/70">
                      {logsQuery.isLoading
                        ? 'Loading…'
                        : `${filteredLogs.length.toLocaleString()} lines`}
                      {logStats.error ? ` · ${logStats.error} errors` : ''}
                      {logStats.warn ? ` · ${logStats.warn} warnings` : ''}
                      {isRunning ? ' · live' : ''}
                    </div>
                  </div>

                  {!historyId ? (
                    <div className="text-sm text-white/70">Pick a history entry to view logs.</div>
                  ) : logsQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading…
                    </div>
                  ) : logsQuery.error ? (
                    <div className="flex items-start gap-2 text-sm text-red-200">
                      <CircleAlert className="mt-0.5 h-4 w-4" />
                      <div>{(logsQuery.error as Error).message}</div>
                    </div>
                  ) : filteredLogs.length ? (
                    <div className="max-h-[560px] overflow-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                      <div className="divide-y divide-white/10">
                        {filteredLogs.map((line) => (
                          <div
                            key={line.id}
                            className={[
                              'px-4 py-3 text-xs',
                              levelStyles(line.level).row,
                            ].join(' ')}
                          >
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-white/50">
                                {new Date(line.time).toLocaleTimeString()}
                              </span>
                              <span className={['font-mono font-semibold', levelStyles(line.level).pill].join(' ')}>
                                {line.level}
                              </span>
                              <span className="font-mono text-white/85">{line.message}</span>
                            </div>
                            {line.context ? (
                              <pre className="mt-2 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3 text-[11px] text-white/70">
{JSON.stringify(line.context, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-white/70">No logs yet.</div>
                  )}
                </motion.div>
              </div>
            )}
          </motion.div>
        </div>
      </section>
    </div>
  );
}


