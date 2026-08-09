import { type ChangeEvent, type MouseEvent as ReactMouseEvent, useCallback, useMemo, useRef, useState } from 'react';
import { motion, useAnimation } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronDown,
  CircleAlert,
  Loader2,
  ScrollText,
  Trash2,
  Pause,
  Play,
  RefreshCw,
  Download,
  Copy as CopyIcon,
} from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { usePersistentState } from '@/lib/usePersistentState';

import { clearServerLogs, listServerLogs, type ServerLogEntry } from '@/api/logs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PullToRefresh } from '@/components/PullToRefresh';
import {
  APP_FILTERS_CARD_MIN_H_CLASS,
  APP_PRESSABLE_CLASS,
} from '@/lib/ui-classes';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ServiceFilter =
  | 'immaculaterr'
  | 'task'
  | 'plex'
  | 'tmdb'
  | 'radarr'
  | 'sonarr'
  | 'google'
  | 'openai'
  | 'errors';

const SERVICE_FILTERS: Array<{
  id: Exclude<ServiceFilter, 'errors'>;
  label: string;
  activeClass: string;
}> = [
  {
    id: 'immaculaterr',
    label: 'Immaculaterr',
    activeClass: 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25',
  },
  {
    id: 'task',
    label: 'Task',
    activeClass: 'bg-teal-500/15 text-teal-100 border-teal-500/25',
  },
  {
    id: 'plex',
    label: 'Plex',
    activeClass: 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25',
  },
  {
    id: 'tmdb',
    label: 'TMDB',
    activeClass: 'bg-sky-500/15 text-sky-100 border-sky-500/25',
  },
  {
    id: 'radarr',
    label: 'Radarr',
    activeClass: 'bg-orange-500/15 text-orange-100 border-orange-500/25',
  },
  {
    id: 'sonarr',
    label: 'Sonarr',
    activeClass: 'bg-violet-500/15 text-violet-100 border-violet-500/25',
  },
  {
    id: 'google',
    label: 'Google',
    activeClass: 'bg-blue-500/15 text-blue-100 border-blue-500/25',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    activeClass: 'bg-purple-500/15 text-purple-100 border-purple-500/25',
  },
] as const;

function isToday(value: string | number): boolean {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

const TYPE_TAG_ORDER: Exclude<ServiceFilter, 'errors'>[] = [
  'task',
  'plex',
  'tmdb',
  'radarr',
  'sonarr',
  'google',
  'openai',
  'immaculaterr',
];

const TYPE_TAG_CLASS: Record<Exclude<ServiceFilter, 'errors'>, string> = {
  immaculaterr: 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25',
  task: 'bg-teal-500/15 text-teal-100 border-teal-500/25',
  plex: 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25',
  tmdb: 'bg-sky-500/15 text-sky-100 border-sky-500/25',
  radarr: 'bg-orange-500/15 text-orange-100 border-orange-500/25',
  sonarr: 'bg-violet-500/15 text-violet-100 border-violet-500/25',
  google: 'bg-blue-500/15 text-blue-100 border-blue-500/25',
  openai: 'bg-purple-500/15 text-purple-100 border-purple-500/25',
};

const TYPE_TAG_LABEL: Record<Exclude<ServiceFilter, 'errors'>, string> = {
  immaculaterr: 'Immaculaterr',
  task: 'Task',
  plex: 'Plex',
  tmdb: 'TMDB',
  radarr: 'Radarr',
  sonarr: 'Sonarr',
  google: 'Google',
  openai: 'OpenAI',
};

const logMatchesTask = (line: {
  message?: string;
  context?: string | null;
}) => {
  const msg = String(line.message ?? '').toLowerCase();
  const ctx = String(line.context ?? '').toLowerCase();
  const hay = `${ctx} ${msg}`;

  const jobContext =
    ctx.includes('jobsservice') ||
    ctx.includes('jobsscheduler') ||
    ctx.includes('jobsretentionservice');
  if (jobContext) return true;

  const webhookAutomation =
    ctx.includes('webhooksservice') &&
    (msg.includes('plex automation:') ||
      msg.includes('runs={') ||
      msg.includes('skipped={') ||
      msg.includes('errors={'));
  if (webhookAutomation) return true;

  return (
    hay.includes('job started jobid=') ||
    hay.includes('job passed jobid=') ||
    hay.includes('job failed jobid=') ||
    hay.includes('scheduled job failed') ||
    hay.includes('skipping scheduled run') ||
    hay.includes('trigger=schedule') ||
    hay.includes('trigger=auto') ||
    hay.includes('run: started') ||
    hay.includes('run: finished') ||
    hay.includes('run: failed')
  );
};

const logMatchesAnyService = (line: {
  message?: string;
  context?: string | null;
}) => {
  const msg = String(line.message ?? '').toLowerCase();
  const ctx = String(line.context ?? '').toLowerCase();
  const hay = `${ctx} ${msg}`;
  return (
    logMatchesTask(line) ||
    hay.includes('plex') ||
    hay.includes('tmdb') ||
    hay.includes('themoviedb') ||
    hay.includes('radarr') ||
    hay.includes('sonarr') ||
    hay.includes('openai') ||
    hay.includes('open ai') ||
    hay.includes('google') ||
    hay.includes('programmable search') ||
    hay.includes('custom search') ||
    hay.includes('cse')
  );
};

const serviceTagsForLine = (line: {
  message?: string;
  context?: string | null;
  level?: string;
}): Set<ServiceFilter> => {
  const out = new Set<ServiceFilter>();
  const msg = String(line.message ?? '').toLowerCase();
  const ctx = String(line.context ?? '').toLowerCase();
  const hay = `${ctx} ${msg}`;

  if (String(line.level ?? '').toLowerCase() === 'error') out.add('errors');
  if (logMatchesTask(line)) out.add('task');

  if (
    hay.includes('plex') ||
    msg.includes('media.scrobble') ||
    msg.includes('library.new') ||
    msg.includes('webhook') ||
    msg.includes('notificationcontainer')
  ) {
    out.add('plex');
  }
  if (hay.includes('tmdb') || hay.includes('themoviedb')) out.add('tmdb');
  if (hay.includes('radarr')) out.add('radarr');
  if (hay.includes('sonarr')) out.add('sonarr');
  if (
    hay.includes('google') ||
    hay.includes('programmable search') ||
    hay.includes('custom search') ||
    hay.includes('cse')
  ) {
    out.add('google');
  }
  if (hay.includes('openai') || hay.includes('open ai')) out.add('openai');

  // App-core bucket (Immaculaterr): anything not clearly attributable to an external service.
  if (!logMatchesAnyService(line)) out.add('immaculaterr');

  return out;
};

export const LogsPage = () => {
  const queryClient = useQueryClient();
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const [selected, setSelected] = usePersistentState<ServiceFilter[]>(
    'tcp_logs_service_filters',
    [],
  );
  const [query, setQuery] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pollMs, setPollMs] = usePersistentState('tcp_logs_poll_ms', 5_000);
  // Incremental polling: after the first full load, only lines newer than
  // the last seen id are fetched and appended (the server supports afterId).
  const [logBuffer, setLogBuffer] = useState<ServerLogEntry[]>([]);
  const lastLogIdRef = useRef(0);
  const logsQuery = useQuery({
    queryKey: ['serverLogs'],
    queryFn: async () => {
      const afterId = lastLogIdRef.current;
      const res = await listServerLogs(
        afterId > 0 ? { afterId, limit: 5000 } : { limit: 5000 },
      );
      const latestId = res.latestId ?? 0;
      if (afterId > 0 && latestId > 0 && latestId < afterId) {
        // Server restarted and ids reset — do a full reload next poll.
        lastLogIdRef.current = 0;
        return res;
      }
      lastLogIdRef.current = Math.max(afterId, latestId);
      setLogBuffer((prev) => {
        if (afterId <= 0) return res.logs;
        if (!res.logs.length) return prev;
        const merged = [...prev, ...res.logs];
        return merged.length > 5000
          ? merged.slice(merged.length - 5000)
          : merged;
      });
      return res;
    },
    refetchInterval: paused ? false : pollMs,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const logs = logBuffer;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byText = q
      ? logs.filter((l) => {
          const msg = (l.message || '').toLowerCase();
          const ctx = (l.context || '').toLowerCase();
          return msg.includes(q) || ctx.includes(q);
        })
      : logs;

    const active = selected;
    const scoped = !active.length
      ? byText
      : byText.filter((l) => {
          const tags = serviceTagsForLine(l);
          return active.some((f) => tags.has(f));
        });

    // Newest first.
    return [...scoped].sort((a, b) => b.id - a.id);
  }, [logs, query, selected]);
  const handleDownload = useCallback(() => {
    const lines = filtered.map((line) => {
      const time = new Date(line.time).toISOString();
      const ctx = line.context ? ` [${line.context}]` : '';
      return `${time}${ctx} ${line.message ?? ''}`;
    });
    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `immaculaterr-logs-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filtered]);

  const clearMutation = useMutation({
    mutationFn: clearServerLogs,
    onSuccess: async () => {
      lastLogIdRef.current = 0;
      setLogBuffer([]);
      await queryClient.invalidateQueries({ queryKey: ['serverLogs'] });
      setClearAllOpen(false);
    },
  });
  const closeClearAllDialog = useCallback(() => {
    setClearAllOpen(false);
  }, []);
  const confirmClearAllDialog = useCallback(() => {
    clearMutation.mutate();
  }, [clearMutation]);
  const animateTitleIcon = useCallback(() => {
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
  }, [titleIconControls, titleIconGlowControls]);

  // Same card/field vocabulary as Rewind so the two pages read as one surface.
  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const labelClass = 'block text-sm font-medium text-white/70 mb-2';
  const inputBaseClass =
    'px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-400/70 focus:border-transparent outline-none transition';
  const inputClass = `w-full ${inputBaseClass}`;
  const selectTriggerClass = `w-full ${inputBaseClass}`;
  const actionButtonClass =
    'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-95 touch-manipulation w-full sm:w-auto border';

  const toggle = useCallback((id: ServiceFilter) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, [setSelected]);

  const clearFilters = useCallback(() => {
    setSelected([]);
    setQuery('');
  }, [setSelected]);
  const clearSelectedFilters = useCallback(() => {
    setSelected([]);
  }, [setSelected]);
  const handleServiceFilterClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const filterId = event.currentTarget.dataset.filterId as ServiceFilter | undefined;
      if (!filterId) return;
      toggle(filterId);
    },
    [toggle],
  );
  const toggleErrorsFilter = useCallback(() => {
    toggle('errors');
  }, [toggle]);
  const handleQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);
  const handlePollChange = useCallback(
    (value: string) => {
      setPollMs(Number(value));
    },
    [setPollMs],
  );
  const togglePaused = useCallback(() => {
    setPaused((v) => !v);
  }, []);
  const handleRefresh = useCallback(() => {
    void logsQuery.refetch();
  }, [logsQuery]);
  const toggleMobileFilters = useCallback(() => {
    setMobileFiltersOpen((prev) => !prev);
  }, []);
  const handleClearAllRequest = useCallback(() => {
    const total = logs.length;
    if (!total) return;
    const isCoarsePointer =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    if (isCoarsePointer) {
      // skipcq: JS-0052 - Native confirm is intentional on coarse pointers for a fast mobile-safe destructive action.
      const ok = window.confirm(
        `Clear all logs?\n\nThis will remove ${total.toLocaleString()} log line(s).\n\nThis cannot be undone.`,
      );
      if (ok) clearMutation.mutate();
      return;
    }

    setClearAllOpen(true);
  }, [clearMutation, logs.length]);

  // Same single-row shape as Rewind's filters (grid of five), so both cards
  // resolve to the same height instead of Logs stacking an extra block.
  const filtersForm = (
    <div className="grid gap-4 md:grid-cols-5">
      <div className="md:col-span-3">
        <div className={labelClass}>Source</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={clearSelectedFilters}
            className={[
              APP_PRESSABLE_CLASS,
              'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
              selected.length === 0
                ? 'bg-white/15 text-white border-white/20'
                : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
            ].join(' ')}
          >
            All
          </button>
          {SERVICE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              data-filter-id={f.id}
              onClick={handleServiceFilterClick}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                selected.includes(f.id)
                  ? f.activeClass
                  : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleErrorsFilter}
            className={[
              APP_PRESSABLE_CLASS,
              'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
              selected.includes('errors')
                ? 'bg-red-500/15 text-red-100 border-red-500/25'
                : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
            ].join(' ')}
          >
            Errors
          </button>
        </div>
      </div>

      <div>
        <div className={labelClass}>Search</div>
        <input
          value={query}
          onChange={handleQueryChange}
          placeholder="scrobble, library.new, OFFLINE…"
          className={inputClass}
        />
      </div>

      <div>
        <div className={labelClass}>Refresh rate</div>
        <Select
          value={String(pollMs)}
          onValueChange={handlePollChange}
          disabled={paused}
        >
          <SelectTrigger className={selectTriggerClass} aria-label="Refresh rate">
            <SelectValue placeholder="5s" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2000">Every 2s</SelectItem>
            <SelectItem value="5000">Every 5s</SelectItem>
            <SelectItem value="15000">Every 15s</SelectItem>
            <SelectItem value="60000">Every 60s</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen overflow-hidden select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">

      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16">
        <PullToRefresh onRefresh={() => logsQuery.refetch()}>
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
                  aria-label="Animate Logs icon"
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                  <div className="relative p-3 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_20px_rgba(250,204,21,0.4)] border-2 border-white/10 group-hover:rotate-0 transition-transform duration-300">
                    <ScrollText className="w-8 h-8 text-black" strokeWidth={2.5} />
                  </div>
                </motion.button>
                <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white drop-shadow-xl">
                  Logs
                </h1>
              </div>
              <p className="text-purple-200/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                Real-time server monitoring. Watch your system breathe, one log
                line at a time.
              </p>
            </motion.div>
          </div>

          {logsQuery.isLoading ? (
            <div className={cardClass}>
              <div className="flex items-center gap-2 text-white">
                <Loader2 className="h-4 w-4 animate-spin" />
                <div className="text-lg font-semibold">Loading logs…</div>
              </div>
            </div>
          ) : logsQuery.error ? (
            <div className={`${cardClass} border-red-500/25 bg-[#0b0c0f]/70`}>
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-5 w-5 text-red-300" />
                <div className="min-w-0">
                  <div className="text-white font-semibold">Failed to load logs</div>
                  <div className="text-sm text-white/70">
                    {(logsQuery.error as Error).message}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Filters (desktop: always expanded) */}
              <div className={`${cardClass} ${APP_FILTERS_CARD_MIN_H_CLASS} hidden md:block`}>
                <div className="mb-6">
                  <div className="text-2xl font-semibold text-white">Filters</div>
                  <div className="mt-2 text-sm text-white/70">
                    Filter by source, errors, refresh rate, or a quick text search.
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
                      <div className="text-2xl font-semibold text-white">Filters</div>
                      <div className="mt-2 text-sm text-white/70">
                        Filter by source, errors, refresh rate, or a quick text search.
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

              {paused ? (
                <div className={`${cardClass} border-sky-400/20 bg-sky-500/10`}>
                  <div className="flex items-start gap-3">
                    <CircleAlert className="mt-0.5 h-5 w-5 text-sky-200" />
                    <div className="flex flex-wrap items-center gap-2 text-sm text-sky-100/90">
                      <span>Live updates are paused. New lines are not being fetched.</span>
                      <button
                        type="button"
                        onClick={togglePaused}
                        className="rounded-full border border-sky-300/30 bg-sky-400/15 px-3 py-1 text-xs font-bold text-sky-50 transition hover:bg-sky-400/25"
                      >
                        Resume
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className={cardClass}>
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-2xl font-semibold text-white">Live stream</div>
                    <div className="mt-2 text-sm text-white/70">
                      {`${filtered.length.toLocaleString()} shown`}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    <button
                      type="button"
                      onClick={togglePaused}
                      className={[
                        actionButtonClass,
                        paused
                          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                          : 'border-white/15 bg-white/5 text-white/75 hover:bg-white/10',
                      ].join(' ')}
                      title={paused ? 'Resume live updates' : 'Pause live updates'}
                    >
                      {paused ? (
                        <>
                          <Play className="h-4 w-4" />
                          Resume
                        </>
                      ) : (
                        <>
                          <Pause className="h-4 w-4" />
                          Pause
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={logsQuery.isFetching}
                      className={`${actionButtonClass} border-white/15 bg-white/5 text-white/75 hover:bg-white/10 disabled:opacity-50`}
                      title="Refresh now"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${logsQuery.isFetching ? 'animate-spin' : ''}`}
                      />
                      Refresh
                    </button>

                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={filtered.length === 0}
                      className={`${actionButtonClass} border-white/15 bg-white/5 text-white/75 hover:bg-white/10 disabled:opacity-50`}
                      title="Download the filtered log lines as a text file"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </button>

                    <button
                      type="button"
                      onClick={handleClearAllRequest}
                      disabled={clearMutation.isPending || logs.length === 0}
                      className={[
                        actionButtonClass,
                        clearMutation.isPending
                          ? 'border-red-500/15 bg-red-500/10 text-red-100/70 cursor-not-allowed'
                          : logs.length > 0
                            ? 'border-red-500/25 bg-red-500/10 text-red-100 hover:bg-red-500/15'
                            : 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed',
                      ].join(' ')}
                      title="Clear all logs"
                    >
                      {clearMutation.isPending ? (
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
                </div>

                {filtered.length ? (
                  <div
                    className="overflow-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur select-text [-webkit-touch-callout:default]"
                    style={{ maxHeight: 'calc(100vh - 280px)' }}
                  >
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-20 bg-[#0b0c0f]/95 text-left text-xs text-white/60 backdrop-blur-sm">
                        <tr>
                          <th className="border-b border-white/10 px-3 py-3 whitespace-nowrap">
                            Timestamp
                          </th>
                          <th className="border-b border-white/10 px-3 py-3 whitespace-nowrap">
                            Type
                          </th>
                          <th className="border-b border-white/10 px-3 py-3">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((line) => (
                          <tr
                            key={line.id}
                            className="group/logrow border-t border-white/10 hover:bg-white/5"
                          >
                            <td
                              className="px-3 py-3 whitespace-nowrap font-mono text-xs text-white/60"
                              title={new Date(line.time).toLocaleString()}
                            >
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void copyToClipboard(
                                      `${new Date(line.time).toISOString()} ${line.message ?? ''}`,
                                    )
                                      .then(() => toast.success('Log line copied'))
                                      .catch(() => toast.error('Copy failed'));
                                  }}
                                  className="rounded p-0.5 text-white/30 opacity-0 transition group-hover/logrow:opacity-100 hover:text-white/80 focus:opacity-100"
                                  aria-label="Copy log line"
                                  title="Copy log line"
                                >
                                  <CopyIcon className="h-3 w-3" />
                                </button>
                                <span>
                                  {isToday(line.time)
                                    ? new Date(line.time).toLocaleTimeString()
                                    : new Date(line.time).toLocaleString(undefined, {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                      })}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              {(() => {
                                const tags = serviceTagsForLine(line);
                                const orderedTypes = TYPE_TAG_ORDER.filter((tag) =>
                                  tags.has(tag),
                                );
                                return (
                                  <div className="flex flex-wrap gap-1.5">
                                    {orderedTypes.map((tag) => (
                                      <span
                                        key={`${line.id}-${tag}`}
                                        className={[
                                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                          TYPE_TAG_CLASS[tag],
                                        ].join(' ')}
                                      >
                                        {TYPE_TAG_LABEL[tag]}
                                      </span>
                                    ))}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-3 font-mono text-xs text-white/85">
                              {line.message}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div>
                    <div className="text-sm text-white/70">
                      {logs.length === 0
                        ? 'No logs yet.'
                        : selected.length === 1 &&
                            selected[0] === 'errors' &&
                            query.trim().length === 0
                          ? 'No error logs yet.'
                          : 'No logs match your current filters.'}
                    </div>
                    {selected.length > 0 || query.trim().length > 0 ? (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={clearFilters}
                          className={[
                            APP_PRESSABLE_CLASS,
                            'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                            'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                          ].join(' ')}
                        >
                          Clear filters
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </PullToRefresh>
      </section>

      <ConfirmDialog
        open={clearAllOpen}
        onClose={closeClearAllDialog}
        onConfirm={confirmClearAllDialog}
        label="Clear"
        title="Clear all logs"
        description={
          <>
            This will remove{' '}
            <span className="text-white font-semibold">
              {logs.length.toLocaleString()}
            </span>{' '}
            log line(s).
            <div className="mt-2 text-xs text-white/55">This cannot be undone.</div>
          </>
        }
        confirmText="Clear all"
        cancelText="Cancel"
        variant="danger"
        confirming={clearMutation.isPending}
      />
    </div>
  );
};
