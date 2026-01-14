import { useMemo, useState } from 'react';
import { motion, useAnimation } from 'motion/react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import { clearRuns, listJobs, listRuns, type JobRun } from '@/api/jobs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
  APP_CARD_ROW_CLASS,
} from '@/lib/ui-classes';
import { decodeHtmlEntities } from '@/lib/utils';

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

function modeLabel(run: JobRun): 'Auto-Run' | 'Manual' | 'Dry-Run' {
  if (run.dryRun) return 'Dry-Run';
  return run.trigger === 'schedule' || run.trigger === 'auto'
    ? 'Auto-Run'
    : 'Manual';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function issueSummary(run: JobRun): string {
  if (run.errorMessage) return decodeHtmlEntities(run.errorMessage);
  const s = run.summary;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return '';
  const obj = s as Record<string, unknown>;
  if (obj.template !== 'jobReportV1' || Number(obj.version) !== 1) return '';
  const issuesRaw = obj.issues;
  if (!Array.isArray(issuesRaw)) return '';
  const msgs = issuesRaw
    .filter(isPlainObject)
    .map((it) => (typeof it.message === 'string' ? it.message.trim() : ''))
    .filter(Boolean);
  return decodeHtmlEntities(msgs[0] ?? '');
}

export function RewindPage() {
  const queryClient = useQueryClient();
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);

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
      const hay = `${r.jobId} ${r.status} ${r.errorMessage ?? ''} ${issueSummary(r)}`.toLowerCase();
      return hay.includes(query);
    });
  }, [historyQuery.data?.runs, jobId, status, q]);

  const jobNameById = useMemo(() => {
    const jobs = jobsQuery.data?.jobs ?? [];
    return new Map(jobs.map((j) => [j.id, j.name] as const));
  }, [jobsQuery.data?.jobs]);

  const clearAllMutation = useMutation({
    mutationFn: async () => clearRuns(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['jobRuns', 'rewind'] });
      setClearAllOpen(false);
    },
  });

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const labelClass = 'block text-sm font-medium text-white/70 mb-2';
  const inputBaseClass =
    'px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-400/70 focus:border-transparent outline-none transition';
  const inputClass = `w-full ${inputBaseClass}`;
  const selectClass = `w-full ${inputBaseClass}`;

  const filtersForm = (
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
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Background (landing-page style, violet-tinted) */}
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

      {/* History Content */}
      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16">
        <div className="container mx-auto px-4 pb-20 max-w-5xl">
            {/* Page Header */}
            <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="flex flex-col gap-4"
              >
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
                    className="relative group focus:outline-none touch-manipulation"
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
                  <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white drop-shadow-xl">
                    Rewind
                  </h1>
                </div>
                <p className="text-purple-200/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                  A look back at what your server has been up to. Logs, errors, and
                  everything in between.
                </p>
              </motion.div>

              <Link
                to="/"
                className="text-sm text-white/70 hover:text-white/90 transition-colors underline-offset-4 hover:underline"
              >
                
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
                {/* Filters (desktop: always expanded) */}
                <div className={`${cardClass} hidden md:block`}>
                  <div className="mb-6">
                    <div className="text-2xl font-semibold text-white">Filters</div>
                    <div className="mt-2 text-sm text-white/70">
                      Filter by job, status, or a quick text search.
                    </div>
                  </div>
                  {filtersForm}
                </div>

                {/* Filters (mobile: collapsed by default) */}
                <div className={`${cardClass} md:hidden`}>
                  <button
                    type="button"
                    onClick={() => setMobileFiltersOpen((v) => !v)}
                    className="w-full text-left focus:outline-none touch-manipulation"
                    aria-expanded={mobileFiltersOpen}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-2xl font-semibold text-white">
                          Filters
                        </div>
                        <div className="mt-2 text-sm text-white/70">
                          Filter by job, status, or a quick text search.
                        </div>
                      </div>
                      <ChevronDown
                        className={[
                          'mt-1 h-5 w-5 text-white/60 transition-transform',
                          mobileFiltersOpen ? 'rotate-180' : '',
                        ].join(' ')}
                      />  
                    </div>
                  </button>

                  {mobileFiltersOpen ? <div className="mt-6">{filtersForm}</div> : null}
                </div>

                <div className={cardClass}>
                  <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-2xl font-semibold text-white">Recent history</div>
                      <div className="mt-2 text-sm text-white/70">
                        {`${filtered.length.toLocaleString()} shown`}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const total = historyQuery.data?.runs?.length ?? 0;
                        if (!total) return;
                        const isCoarsePointer =
                          typeof window !== 'undefined' &&
                          Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
                        if (isCoarsePointer) {
                          const ok = window.confirm(
                            `Clear all execution history?\n\nThis will delete ${total.toLocaleString()} run(s) and their logs.\n\nThis cannot be undone.`,
                          );
                          if (ok) clearAllMutation.mutate();
                          return;
                        }

                        setClearAllOpen(true);
                      }}
                      disabled={
                        clearAllMutation.isPending ||
                        !(historyQuery.data?.runs?.length ?? 0)
                      }
                      className={[
                        'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-95 touch-manipulation',
                        'w-full sm:w-auto',
                        'border',
                        clearAllMutation.isPending
                          ? 'border-red-500/15 bg-red-500/10 text-red-100/70 cursor-not-allowed'
                          : (historyQuery.data?.runs?.length ?? 0) > 0
                            ? 'border-red-500/25 bg-red-500/10 text-red-100 hover:bg-red-500/15'
                            : 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed',
                      ].join(' ')}
                      title="Clear all Rewind history"
                    >
                      {clearAllMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Clearing…
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4" />
                          Clear all
                        </>
                      )}
                    </button>
                  </div>

                  {filtered.length ? (
                    <>
                      {/* Mobile: stacked run cards */}
                      <div className="sm:hidden space-y-3">
                        {filtered.map((run) => {
                          const ms = durationMs(run);
                          const jobName = jobNameById.get(run.jobId) ?? run.jobId;
                          const errorText = issueSummary(run);
                          const errorPreview = errorText
                            ? errorText.length > 140
                              ? `${errorText.slice(0, 140)}…`
                              : errorText
                            : '';
                          return (
                            <Link
                              key={run.id}
                              to={`/rewind/${run.id}`}
                              className={`${APP_CARD_ROW_CLASS} block p-4`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white/90 leading-snug break-words">
                                    {jobName}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/60 font-mono">
                                    <span className="whitespace-nowrap">
                                      {new Date(run.startedAt).toLocaleString()}
                                    </span>
                                    <span className="text-white/30">•</span>
                                    <span className="whitespace-nowrap">
                                      {ms === null ? '—' : formatDuration(ms)}
                                    </span>
                                    <span className="text-white/30">•</span>
                                    <span className="whitespace-nowrap">
                                      {modeLabel(run)}
                                    </span>
                                  </div>
                                </div>
                                <div className="shrink-0 flex flex-col items-end gap-2">
                                  <span
                                    className={[
                                      'rounded-full px-2.5 py-1 text-xs font-medium inline-flex items-center',
                                      statusPill(run.status),
                                    ].join(' ')}
                                  >
                                    {run.status}
                                  </span>
                                  <ChevronRight className="h-4 w-4 text-white/40 transition-transform group-hover:translate-x-0.5 group-active:translate-x-0.5" />
                                </div>
                              </div>
                              {errorPreview ? (
                                <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200/80 font-mono break-words [overflow-wrap:anywhere]">
                                  {errorPreview}
                                </div>
                              ) : null}
                            </Link>
                          );
                        })}
                      </div>

                      {/* Desktop: table */}
                      <div className="hidden sm:block overflow-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
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
                              const jobName = jobNameById.get(run.jobId) ?? run.jobId;
                              return (
                                <tr
                                  key={run.id}
                                  className="border-t border-white/10 hover:bg-white/5"
                                >
                                  <td className="px-3 py-3 whitespace-nowrap">
                                    <Link
                                      className="font-mono text-xs text-white/80 underline-offset-4 hover:underline"
                              to={`/rewind/${run.id}`}
                                    >
                                      {new Date(run.startedAt).toLocaleString()}
                                    </Link>
                                  </td>
                                  <td className="px-3 py-3 text-white/85">{jobName}</td>
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
                                    {modeLabel(run)}
                                  </td>
                                  <td className="px-3 py-3 text-white/60">
                                    {ms === null ? '—' : formatDuration(ms)}
                                  </td>
                                  <td className="px-3 py-3 text-red-200/80">
                                    {(() => {
                                      const msg = issueSummary(run);
                                      if (!msg) return '';
                                      return msg.length > 80 ? `${msg.slice(0, 80)}…` : msg;
                                    })()}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-white/70">No history found.</div>
                  )}
                </div>
              </div>
            )}
        </div>
      </section>

      <ConfirmDialog
        open={clearAllOpen}
        onClose={() => setClearAllOpen(false)}
        onConfirm={() => clearAllMutation.mutate()}
        label="Clear"
        title="Clear all execution history"
        description={
          <>
            This will delete{' '}
            <span className="text-white font-semibold">
              {(historyQuery.data?.runs?.length ?? 0).toLocaleString()}
            </span>{' '}
            run(s) and their logs.
            <div className="mt-2 text-xs text-white/55">This cannot be undone.</div>
          </>
        }
        confirmText="Clear all"
        cancelText="Cancel"
        variant="danger"
        confirming={clearAllMutation.isPending}
      />
    </div>
  );
}


