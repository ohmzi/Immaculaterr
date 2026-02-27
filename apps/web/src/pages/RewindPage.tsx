import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const statusPill = (status: string) => {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/25';
    case 'FAILED':
      return 'bg-red-500/15 text-red-200 border border-red-500/25';
    case 'RUNNING':
      return 'bg-amber-500/15 text-amber-200 border border-amber-500/25';
    case 'PENDING':
      return 'bg-sky-500/15 text-sky-200 border border-sky-500/25';
    default:
      return 'bg-white/10 text-white/70 border border-white/10';
  }
};

const durationMs = (run: JobRun): number | null => {
  if (!run.finishedAt) return null;
  const a = Date.parse(run.startedAt);
  const b = Date.parse(run.finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
};

const PENDING_QUEUE_SLOT_MS = 10 * 60_000;

const estimatePendingRemainingMs = (run: JobRun, allRuns: JobRun[]): number | null => {
  if (run.status !== 'PENDING') return null;
  const queuedAt = Date.parse(run.startedAt);
  if (!Number.isFinite(queuedAt)) return null;

  const pendingForJob = allRuns
    .filter((r) => r.jobId === run.jobId && r.status === 'PENDING')
    .sort((a, b) => {
      const at = Date.parse(a.startedAt);
      const bt = Date.parse(b.startedAt);
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      return a.id.localeCompare(b.id);
    });
  const position = pendingForJob.findIndex((r) => r.id === run.id);
  if (position < 0) return null;

  const estimatedStartAt = queuedAt + (position + 1) * PENDING_QUEUE_SLOT_MS;
  return Math.max(0, estimatedStartAt - Date.now());
};

const formatDuration = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
};

const formatRemaining = (ms: number): string => {
  if (ms < 30_000) return 'starting soon';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `~${minutes}m remaining`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `~${hours}h ${rem}m remaining` : `~${hours}h remaining`;
};

const formatRunDuration = (run: JobRun, allRuns: JobRun[]): string => {
  if (run.status === 'PENDING') {
    const remainingMs = estimatePendingRemainingMs(run, allRuns);
    return remainingMs === null ? '—' : formatRemaining(remainingMs);
  }
  const ms = durationMs(run);
  return ms === null ? '—' : formatDuration(ms);
};

const modeLabel = (run: JobRun): 'Auto-Run' | 'Manual' | 'Dry-Run' => {
  if (run.dryRun) return 'Dry-Run';
  return run.trigger === 'schedule' || run.trigger === 'auto'
    ? 'Auto-Run'
    : 'Manual';
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const issueSummary = (run: JobRun): string => {
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
};

const getPlexUserContext = (run: JobRun): { plexUserId: string; plexUserTitle: string } => {
  const s = run.summary;
  if (!s || typeof s !== 'object' || Array.isArray(s))
    return { plexUserId: '', plexUserTitle: '' };
  const obj = s as Record<string, unknown>;
  const raw =
    obj.template === 'jobReportV1' && isPlainObject(obj.raw)
      ? (obj.raw as Record<string, unknown>)
      : obj;
  const plexUserId =
    typeof raw.plexUserId === 'string' ? raw.plexUserId.trim() : '';
  const plexUserTitle =
    typeof raw.plexUserTitle === 'string' ? raw.plexUserTitle.trim() : '';
  return { plexUserId, plexUserTitle };
};

const pickSummaryValue = (obj: Record<string, unknown>, path: string): unknown => {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
};

function pickSummaryString(obj: Record<string, unknown>, path: string): string {
  const v = pickSummaryValue(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

const normalizeMediaType = (raw: string): 'movie' | 'tv' | null => {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const map: Record<string, 'movie' | 'tv'> = {
    movie: 'movie',
    movies: 'movie',
    film: 'movie',
    tv: 'tv',
    show: 'tv',
    shows: 'tv',
    tvshow: 'tv',
    'tv show': 'tv',
    series: 'tv',
    episode: 'tv',
    season: 'tv',
  };
  return map[v] ?? null;
};

function getMediaTypeContext(run: JobRun): { key: 'movie' | 'tv' | ''; label: string } {
  const summary = run.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { key: '', label: '—' };
  }

  const obj = summary as Record<string, unknown>;
  const raw =
    obj.template === 'jobReportV1' && isPlainObject(obj.raw)
      ? (obj.raw as Record<string, unknown>)
      : obj;

  const candidatePaths = [
    'mediaType',
    'media_type',
    'mode',
    'type',
    'Metadata.type',
    'metadata.type',
    'input.mediaType',
    'input.media_type',
    'input.Metadata.type',
    'input.metadata.type',
  ];

  const resolve = (source: Record<string, unknown>) => {
    for (const path of candidatePaths) {
      const normalized = normalizeMediaType(pickSummaryString(source, path));
      if (normalized) return normalized;
    }
    return null;
  };

  let key: 'movie' | 'tv' | '' =
    resolve(raw) ?? (raw !== obj ? resolve(obj) : null) ?? '';
  if (!key) {
    const tvSectionKey = pickSummaryString(raw, 'tvSectionKey');
    const movieSectionKey = pickSummaryString(raw, 'movieSectionKey');
    if (tvSectionKey) key = 'tv';
    else if (movieSectionKey) key = 'movie';
  }
  if (!key) {
    const rawRec = raw as Record<string, unknown>;
    const hasSonarr = isPlainObject(rawRec['sonarr']);
    const hasRadarr = isPlainObject(rawRec['radarr']);
    if (hasSonarr && !hasRadarr) key = 'tv';
    else if (hasRadarr && !hasSonarr) key = 'movie';
  }
  const label = key === 'movie' ? 'Movie' : key === 'tv' ? 'TV show' : '—';
  return { key, label };
}

export function RewindPage() {
  const queryClient = useQueryClient();
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState('');
  const [plexUserFilter, setPlexUserFilter] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('');
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
      const { plexUserId, plexUserTitle } = getPlexUserContext(r);
      const userKey = plexUserId || plexUserTitle;
      if (plexUserFilter && userKey !== plexUserFilter) return false;
      const media = getMediaTypeContext(r);
      if (mediaTypeFilter && media.key !== mediaTypeFilter) return false;
      if (!query) return true;
      const hay = `${r.jobId} ${r.status} ${r.errorMessage ?? ''} ${issueSummary(r)} ${userKey} ${plexUserTitle} ${media.label}`.toLowerCase();
      return hay.includes(query);
    });
  }, [historyQuery.data?.runs, jobId, status, plexUserFilter, mediaTypeFilter, q]);

  const jobNameById = useMemo(() => {
    const jobs = jobsQuery.data?.jobs ?? [];
    return new Map(jobs.map((j) => [j.id, j.name] as const));
  }, [jobsQuery.data?.jobs]);

  const plexUserOptions = useMemo(() => {
    const runs = historyQuery.data?.runs ?? [];
    const byKey = new Map<string, { id: string; title: string }>();
    for (const run of runs) {
      const { plexUserId, plexUserTitle } = getPlexUserContext(run);
      if (!plexUserId && !plexUserTitle) continue;
      const key = plexUserId || plexUserTitle;
      if (!byKey.has(key)) {
        byKey.set(key, {
          id: key,
          title: plexUserTitle || plexUserId,
        });
      }
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [historyQuery.data?.runs]);

  const clearAllMutation = useMutation({
    mutationFn: () => clearRuns(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['jobRuns', 'rewind'] });
      setClearAllOpen(false);
    },
  });
  const closeClearAllDialog = useCallback(() => {
    setClearAllOpen(false);
  }, []);
  const confirmClearAllDialog = useCallback(() => {
    clearAllMutation.mutate();
  }, [clearAllMutation]);
  const animateTitleIcon = useCallback(() => {
    titleIconControls.stop();
    titleIconGlowControls.stop();
    titleIconControls.start({
      scale: [1, 1.06, 1],
      transition: { duration: 0.55, ease: 'easeOut' },
    });
    titleIconGlowControls.start({
      opacity: [0, 0.7, 0, 0.55, 0, 0.4, 0],
      transition: { duration: 1.4, ease: 'easeInOut' },
    });
  }, [titleIconControls, titleIconGlowControls]);
  const handleJobFilterChange = useCallback((value: string) => {
    setJobId(value === 'all' ? '' : value);
  }, []);
  const handleStatusFilterChange = useCallback((value: string) => {
    setStatus(value === 'any' ? '' : value);
  }, []);
  const handlePlexUserFilterChange = useCallback((value: string) => {
    setPlexUserFilter(value === 'all' ? '' : value);
  }, []);
  const handleMediaTypeFilterChange = useCallback((value: string) => {
    setMediaTypeFilter(value === 'all' ? '' : value);
  }, []);
  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setQ(event.target.value);
    },
    [],
  );
  const toggleMobileFilters = useCallback(() => {
    setMobileFiltersOpen((prev) => !prev);
  }, []);
  const handleCoarseClear = (total: number) => {
    const message = `Clear all execution history?\n\nThis will delete ${total.toLocaleString()} run(s) and their logs.\n\nThis cannot be undone.`;
    if (customConfirm(message)) {
      clearAllMutation.mutate();
    }
  };

  const handleFineClear = (_total: number) => {
    setClearAllOpen(true);
  };

  const handleClearAllRequest = useCallback(() => {
    const total = historyQuery.data?.runs?.length ?? 0;
    if (!total) return;
    const isCoarsePointer =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    const handler = isCoarsePointer ? handleCoarseClear : handleFineClear;
    handler(total);
  }, [clearAllMutation, historyQuery.data?.runs, setClearAllOpen]);

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const labelClass = 'block text-sm font-medium text-white/70 mb-2';
  const inputBaseClass =
    'px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-400/70 focus:border-transparent outline-none transition';
  const inputClass = `w-full ${inputBaseClass}`;
  const selectTriggerClass = `w-full ${inputBaseClass}`;

  const filtersForm = (
    <div className="grid gap-4 md:grid-cols-5">
      <div>
        <div className={labelClass}>Job</div>
        <Select
          value={jobId || 'all'}
          onValueChange={handleJobFilterChange}
        >
          <SelectTrigger className={selectTriggerClass}>
            <SelectValue placeholder="All jobs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jobs</SelectItem>
            {(jobsQuery.data?.jobs ?? []).map((j) => (
              <SelectItem key={j.id} value={j.id}>
                {j.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className={labelClass}>Status</div>
        <Select
          value={status || 'any'}
          onValueChange={handleStatusFilterChange}
        >
          <SelectTrigger className={selectTriggerClass}>
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="RUNNING">RUNNING</SelectItem>
            <SelectItem value="SUCCESS">SUCCESS</SelectItem>
            <SelectItem value="FAILED">FAILED</SelectItem>
            <SelectItem value="PENDING">PENDING</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className={labelClass}>User</div>
        <Select
          value={plexUserFilter || 'all'}
          onValueChange={handlePlexUserFilterChange}
        >
          <SelectTrigger className={selectTriggerClass}>
            <SelectValue placeholder="All users" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {plexUserOptions.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className={labelClass}>Media type</div>
        <Select
          value={mediaTypeFilter || 'all'}
          onValueChange={handleMediaTypeFilterChange}
        >
          <SelectTrigger className={selectTriggerClass}>
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="movie">Movie</SelectItem>
            <SelectItem value="tv">TV show</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className={labelClass}>Search</div>
        <input
          value={q}
          onChange={handleSearchChange}
          placeholder="jobId, user, media type, status, error text…"
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
                    onClick={animateTitleIcon}
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
                      Filter by job, user, media type, status, or a quick text search.
                    </div>
                  </div>
                  {filtersForm}
                </div>

                {/* Filters (mobile: collapsed by default) */}
                <div className={`${cardClass} md:hidden`}>
                  <button
                    type="button"
                    onClick={toggleMobileFilters}
                    className="w-full text-left focus:outline-none touch-manipulation"
                    aria-expanded={mobileFiltersOpen}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-2xl font-semibold text-white">
                          Filters
                        </div>
                        <div className="mt-2 text-sm text-white/70">
                          Filter by job, user, media type, status, or a quick text search.
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
                      onClick={handleClearAllRequest}
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
                          const jobName = jobNameById.get(run.jobId) ?? run.jobId;
                          const { plexUserId, plexUserTitle } = getPlexUserContext(run);
                          const userLabel = plexUserTitle || plexUserId;
                          const media = getMediaTypeContext(run);
                          const durationLabel = formatRunDuration(
                            run,
                            historyQuery.data?.runs ?? [],
                          );
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
                                      {durationLabel}
                                    </span>
                                    <span className="text-white/30">•</span>
                                    <span className="whitespace-nowrap">
                                      {modeLabel(run)}
                                    </span>
                                    <span className="text-white/30">•</span>
                                    <span className="whitespace-nowrap">
                                      Media: {media.label}
                                    </span>
                                    {userLabel ? (
                                      <>
                                        <span className="text-white/30">•</span>
                                        <span className="whitespace-nowrap">
                                          {userLabel}
                                        </span>
                                      </>
                                    ) : null}
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
                              <th className="px-3 py-3">User</th>
                              <th className="px-3 py-3">Media</th>
                              <th className="px-3 py-3">Status</th>
                              <th className="px-3 py-3">Mode</th>
                              <th className="px-3 py-3">Duration</th>
                              <th className="px-3 py-3">Error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((run) => {
                              const jobName = jobNameById.get(run.jobId) ?? run.jobId;
                              const { plexUserId, plexUserTitle } = getPlexUserContext(run);
                              const userLabel = plexUserTitle || plexUserId || '—';
                              const media = getMediaTypeContext(run);
                              const durationLabel = formatRunDuration(
                                run,
                                historyQuery.data?.runs ?? [],
                              );
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
                                  <td className="px-3 py-3 text-white/70">{userLabel}</td>
                                  <td className="px-3 py-3 text-white/70">{media.label}</td>
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
                                    {durationLabel}
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
        onClose={closeClearAllDialog}
        onConfirm={confirmClearAllDialog}
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
