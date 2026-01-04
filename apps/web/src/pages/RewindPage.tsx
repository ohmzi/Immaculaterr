import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Loader2, RotateCcw } from 'lucide-react';

import { listJobs, listRuns, type JobRun } from '@/api/jobs';

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

function durationMs(run: JobRun): number | null {
  if (!run.finishedAt) return null;
  const a = Date.parse(run.startedAt);
  const b = Date.parse(run.finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

export function RewindPage() {
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: ['jobRuns', 'rewind'],
    queryFn: () => listRuns({ take: 200 }),
    staleTime: 2_000,
    refetchInterval: 3_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const filtered = useMemo(() => {
    const runs = historyQuery.data?.runs ?? [];
    const query = q.trim().toLowerCase();
    return runs.filter((r) => {
      if (jobId && r.jobId !== jobId) return false;
      if (status && r.status !== status) return false;
      if (!query) return true;
      const hay = `${r.jobId} ${r.status} ${r.errorMessage ?? ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [historyQuery.data?.runs, jobId, status, q]);

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
      {/* Background (landing-page style, violet-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-400/35 via-violet-700/45 to-indigo-900/65" />
        <div className="absolute inset-0 bg-[#0b0c0f]/15" />
      </div>

      {/* History Content */}
      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-10">
        <div className="container mx-auto px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-5xl mx-auto"
          >
            {/* Page Header */}
            <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_20px_rgba(250,204,21,0.4)] border-2 border-white/10 hover:rotate-0 transition-transform duration-300">
                    <RotateCcw className="w-8 h-8 text-black" strokeWidth={2.5} />
                  </div>
                  <h1 className="text-5xl sm:text-6xl font-black tracking-tighter text-white drop-shadow-xl">
                    Rewind
                  </h1>
                </div>
                <p className="text-purple-200/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                  A look back at what your server has been up to. Logs, errors, and
                  everything in between.
                </p>
              </div>

              <Link
                to="/"
                className="text-sm text-white/70 hover:text-white/90 transition-colors underline-offset-4 hover:underline"
              >
                Return to Dashboard
              </Link>
            </div>

            {historyQuery.isLoading ? (
              <div className={cardClass}>
                <div className="flex items-center gap-2 text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <div className="text-lg font-semibold">Loading history…</div>
                </div>
              </div>
            ) : historyQuery.error ? (
              <div className={`${cardClass} border-red-500/25 bg-[#0b0c0f]/70`}>
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 text-red-300" />
                  <div className="min-w-0">
                    <div className="text-white font-semibold">Failed to load history</div>
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
                      Filter by job, status, or a quick text search.
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className={labelClass}>Job</label>
                      <select
                        value={jobId}
                        onChange={(e) => setJobId(e.target.value)}
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
                      <label className={labelClass}>Status</label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className={selectClass}
                      >
                        <option value="">Any</option>
                        <option value="RUNNING">RUNNING</option>
                        <option value="SUCCESS">SUCCESS</option>
                        <option value="FAILED">FAILED</option>
                        <option value="PENDING">PENDING</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClass}>Search</label>
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="jobId, status, error text…"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.1 }}
                  className={cardClass}
                >
                  <div className="mb-6 flex items-end justify-between gap-4">
                    <div>
                      <div className="text-2xl font-semibold text-white">Recent history</div>
                      <div className="mt-2 text-sm text-white/70">
                        {`${filtered.length.toLocaleString()} shown`}
                      </div>
                    </div>
                  </div>

                  {filtered.length ? (
                    <div className="overflow-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                      <table className="w-full text-sm">
                        <thead className="bg-white/5 text-left text-xs text-white/60">
                          <tr>
                            <th className="px-3 py-3">Time</th>
                            <th className="px-3 py-3">Job</th>
                            <th className="px-3 py-3">Status</th>
                            <th className="px-3 py-3">Mode</th>
                            <th className="px-3 py-3">Duration</th>
                            <th className="px-3 py-3">Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((run) => {
                            const ms = durationMs(run);
                            return (
                              <tr key={run.id} className="border-t border-white/10 hover:bg-white/5">
                                <td className="px-3 py-3 whitespace-nowrap">
                                  <Link
                                    className="font-mono text-xs text-white/80 underline-offset-4 hover:underline"
                                    to={`/history/${run.id}`}
                                  >
                                    {new Date(run.startedAt).toLocaleString()}
                                  </Link>
                                </td>
                                <td className="px-3 py-3 text-white/85">{run.jobId}</td>
                                <td className="px-3 py-3">
                                  <span
                                    className={[
                                      'rounded-full px-2.5 py-1 text-xs font-medium inline-flex items-center',
                                      statusPill(run.status),
                                    ].join(' ')}
                                  >
                                    {run.status}
                                  </span>
                                </td>
                                <td className="px-3 py-3 text-white/60">
                                  {run.dryRun ? 'dry-run' : 'live'}
                                </td>
                                <td className="px-3 py-3 text-white/60">
                                  {ms === null ? '—' : formatDuration(ms)}
                                </td>
                                <td className="px-3 py-3 text-red-200/80">
                                  {run.errorMessage
                                    ? run.errorMessage.length > 80
                                      ? `${run.errorMessage.slice(0, 80)}…`
                                      : run.errorMessage
                                    : ''}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-sm text-white/70">No history found.</div>
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


