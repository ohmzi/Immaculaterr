import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  Clipboard,
  ClipboardCheck,
  RefreshCw,
  Activity,
  Loader2,
  Pause,
  Play,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { SettingsPage } from '@/pages/VaultPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { getPublicSettings } from '@/api/settings';
import { getUpdates } from '@/api/updates';
import { getMeOrNull } from '@/api/auth';
import { listServerLogs, type ServerLogEntry } from '@/api/logs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { isDebuggerAccessAllowed } from '@/lib/debugger';
import { APP_HEADER_STATUS_PILL_BASE_CLASS } from '@/lib/ui-classes';

const buildRuntimeInfo = () => {
  if (typeof window === 'undefined') {
    return {
      location: null,
      userAgent: null,
      language: null,
      platform: null,
      online: null,
      visibilityState: null,
    };
  }

  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const platform = nav && 'platform' in nav ? (nav as Navigator & { platform?: string }).platform ?? null : null;

  return {
    location: window.location.href,
    userAgent: nav?.userAgent ?? null,
    language: nav?.language ?? null,
    platform,
    online: nav?.onLine ?? null,
    visibilityState: document?.visibilityState ?? null,
  };
};

const LOG_LIMIT = 240;
const LOG_POLL_OPTIONS = [
  { label: '1s', value: 1000 },
  { label: '5s', value: 5000 },
  { label: '30s', value: 30_000 },
  { label: '1m', value: 60_000 },
  { label: '5m', value: 300_000 },
] as const;

const isPlexLog = (entry: ServerLogEntry) => {
  const msg = (entry.message ?? '').toLowerCase();
  const ctx = (entry.context ?? '').toLowerCase();
  if (msg.includes('plex: get')) return false;
  const hay = `${ctx} ${msg}`;
  return (
    hay.includes('plex') ||
    msg.includes('media.scrobble') ||
    msg.includes('library.new') ||
    msg.includes('webhook') ||
    msg.includes('now playing') ||
    msg.includes('notificationcontainer')
  );
};

const formatTime = (iso: string) => {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleTimeString();
};

const levelClass = (level: ServerLogEntry['level']) => {
  if (level === 'error') return 'text-red-200';
  if (level === 'warn') return 'text-amber-200';
  if (level === 'debug') return 'text-white/50';
  return 'text-white/80';
};

export function DebuggerPage() {
  const { token } = useParams<{ token: string }>();
  const accessAllowed = isDebuggerAccessAllowed(token);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    enabled: accessAllowed,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const updatesQuery = useQuery({
    queryKey: ['updates'],
    queryFn: getUpdates,
    enabled: accessAllowed,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMeOrNull,
    enabled: accessAllowed,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const [copied, setCopied] = useState(false);
  const [snapshotQuery, setSnapshotQuery] = useState('');
  const [snapshotCollapsed, setSnapshotCollapsed] = useState(true);
  const [plexLogs, setPlexLogs] = useState<ServerLogEntry[]>([]);
  const [plexLogError, setPlexLogError] = useState<string | null>(null);
  const [plexLogLoading, setPlexLogLoading] = useState(false);
  const [plexLogPaused, setPlexLogPaused] = useState(false);
  const [plexLogUpdatedAt, setPlexLogUpdatedAt] = useState<string | null>(null);
  const [plexLogQuery, setPlexLogQuery] = useState('');
  const [plexLogCollapsed, setPlexLogCollapsed] = useState(false);
  const [plexLogPollMs, setPlexLogPollMs] = useState<number>(5000);
  const [plexCopied, setPlexCopied] = useState(false);
  const plexLogLatestIdRef = useRef<number | null>(null);
  const plexLogLastFetchRef = useRef<number | null>(null);

  const refreshPlexLogs = useCallback(
    async (mode: 'initial' | 'poll') => {
      if (!accessAllowed) return;
      if (plexLogPaused && mode === 'poll') return;
      if (mode === 'poll') {
        const last = plexLogLastFetchRef.current;
        const now = Date.now();
        if (last !== null && now - last < plexLogPollMs) return;
      }

      if (mode === 'initial') {
        setPlexLogLoading(true);
        setPlexLogError(null);
      }

      try {
        const afterId =
          mode === 'poll' && typeof plexLogLatestIdRef.current === 'number'
            ? plexLogLatestIdRef.current
            : undefined;
        const res = await listServerLogs({ afterId, limit: 500 });
        plexLogLatestIdRef.current = res.latestId;
        if (res.logs.length) {
          const nextPlex = res.logs.filter(isPlexLog);
          setPlexLogs((prev) => {
            const merged = mode === 'poll' ? [...prev, ...nextPlex] : nextPlex;
            return merged.slice(-LOG_LIMIT);
          });
        } else if (mode === 'initial') {
          setPlexLogs([]);
        }
        setPlexLogUpdatedAt(new Date().toISOString());
      } catch (err) {
        setPlexLogError(err instanceof Error ? err.message : String(err));
      } finally {
        plexLogLastFetchRef.current = Date.now();
        if (mode === 'initial') setPlexLogLoading(false);
      }
    },
    [accessAllowed, plexLogPaused, plexLogPollMs],
  );

  useEffect(() => {
    if (!accessAllowed) return;
    void refreshPlexLogs('initial');
  }, [accessAllowed, refreshPlexLogs]);

  useEffect(() => {
    if (!accessAllowed || plexLogPaused) return;
    let cancelled = false;
    let handle: number | null = null;

    const schedule = () => {
      if (cancelled) return;
      handle = window.setTimeout(async () => {
        await refreshPlexLogs('poll');
        schedule();
      }, plexLogPollMs);
    };

    schedule();

    return () => {
      cancelled = true;
      if (handle !== null) window.clearTimeout(handle);
    };
  }, [accessAllowed, plexLogPaused, refreshPlexLogs, plexLogPollMs]);

  const diagnostics = useMemo(() => {
    return {
      generatedAt: new Date().toISOString(),
      runtime: buildRuntimeInfo(),
      auth: meQuery.data ?? null,
      updates: updatesQuery.data ?? null,
      settings: settingsQuery.data ?? null,
      plexLogs: plexLogs.slice(-50),
    };
  }, [meQuery.data, updatesQuery.data, settingsQuery.data, plexLogs]);

  const diagnosticsText = useMemo(() => JSON.stringify(diagnostics, null, 2), [diagnostics]);

  const snapshotLines = useMemo(() => diagnosticsText.split('\n'), [diagnosticsText]);
  const filteredSnapshotLines = useMemo(() => {
    const q = snapshotQuery.trim().toLowerCase();
    if (!q) return snapshotLines;
    return snapshotLines.filter((line) => line.toLowerCase().includes(q));
  }, [snapshotLines, snapshotQuery]);
  const snapshotDisplay = useMemo(() => {
    if (!snapshotQuery.trim()) return diagnosticsText;
    return filteredSnapshotLines.join('\n');
  }, [diagnosticsText, filteredSnapshotLines, snapshotQuery]);

  const filteredPlexLogs = useMemo(() => {
    const q = plexLogQuery.trim().toLowerCase();
    if (!q) return plexLogs;
    return plexLogs.filter((entry) => {
      const msg = (entry.message ?? '').toLowerCase();
      const ctx = (entry.context ?? '').toLowerCase();
      return msg.includes(q) || ctx.includes(q);
    });
  }, [plexLogs, plexLogQuery]);

  const plexLogsDisplay = useMemo(
    () => [...filteredPlexLogs].reverse(),
    [filteredPlexLogs],
  );
  const plexLogText = useMemo(() => {
    return plexLogsDisplay
      .map((entry) => {
        const time = formatTime(entry.time);
        const level = (entry.level ?? '').toString().toUpperCase();
        const ctx = entry.context ? ` (${entry.context})` : '';
        const msg = entry.message ?? '';
        return `${time} [${level}]${ctx} ${msg}`;
      })
      .join('\n');
  }, [plexLogsDisplay]);

  const handleCopy = async () => {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(diagnosticsText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore copy errors (clipboard permissions)
    }
  };
  const handlePlexCopy = async () => {
    setPlexCopied(false);
    try {
      await navigator.clipboard.writeText(plexLogText || '');
      setPlexCopied(true);
      window.setTimeout(() => setPlexCopied(false), 2000);
    } catch {
      // ignore copy errors (clipboard permissions)
    }
  };
  const handlePlexClear = () => {
    setPlexLogs([]);
    setPlexLogError(null);
    setPlexLogUpdatedAt(null);
  };

  if (!accessAllowed) {
    return <NotFoundPage />;
  }

  return (
    <SettingsPage
      pageTitle="Debugger"
      headerIcon={<Bug className="w-6 h-6" />}
      subtitle="Diagnostics for the current session."
      subtitleDetails="Access is limited to the secret Help menu shortcut."
      extraContent={
        <div className="space-y-6 select-text">
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-white">
                  <Activity className="h-5 w-5 text-emerald-200" />
                  <h2 className="text-2xl font-semibold">Plex activity</h2>
                </div>
                <p className="text-sm text-white/70">
                  Live server logs filtered to Plex webhooks and polling activity.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPlexLogCollapsed((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
                  aria-expanded={!plexLogCollapsed}
                >
                  {plexLogCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  {plexLogCollapsed ? 'Expand' : 'Minimize'}
                </button>
                <Select
                  value={String(plexLogPollMs)}
                  onValueChange={(raw) => {
                    const next = Number.parseInt(raw, 10);
                    if (!Number.isFinite(next)) return;
                    setPlexLogPollMs(next);
                  }}
                  disabled={plexLogPaused}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Update rate" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOG_POLL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        Every {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => setPlexLogPaused((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
                >
                  {plexLogPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {plexLogPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={() => void refreshPlexLogs('initial')}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
                <button
                  onClick={() => void handlePlexCopy()}
                  disabled={!plexLogsDisplay.length}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-60"
                >
                  {plexCopied ? <ClipboardCheck className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                  {plexCopied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handlePlexClear}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </button>
              </div>
            </div>

            {!plexLogCollapsed ? (
              <>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    {plexLogPaused ? 'Paused' : 'Streaming'}
                  </span>
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    Updated: {plexLogUpdatedAt ? formatTime(plexLogUpdatedAt) : '—'}
                  </span>
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    Entries: {filteredPlexLogs.length}/{plexLogs.length}
                  </span>
                </div>

                <div className="mt-5">
                  <Input
                    value={plexLogQuery}
                    onChange={(event) => setPlexLogQuery(event.target.value)}
                    placeholder="Search Plex activity..."
                    className="h-10 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:border-transparent focus:ring-2 focus:ring-white/20"
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 p-4 text-xs text-white/80 max-h-[420px] overflow-auto select-text">
                  {plexLogLoading ? (
                    <div className="flex items-center gap-2 text-white/70">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading Plex logs…
                    </div>
                  ) : plexLogError ? (
                    <div className="text-red-200">Failed to load Plex logs: {plexLogError}</div>
                  ) : plexLogsDisplay.length ? (
                    <div className="space-y-2">
                      {plexLogsDisplay.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex flex-col gap-1 border-b border-white/5 pb-2 last:border-b-0 last:pb-0"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/55">
                            <span>{formatTime(entry.time)}</span>
                            <span className={levelClass(entry.level)}>{entry.level.toUpperCase()}</span>
                            {entry.context ? (
                              <span className="rounded-full border border-white/10 px-2 py-0.5 text-white/60">
                                {entry.context}
                              </span>
                            ) : null}
                          </div>
                          <div className="whitespace-pre-wrap text-white/80">{entry.message}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-white/60">
                      No Plex activity yet. When media is watched or added, it will appear here.
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>

          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-white">Session snapshot</h2>
                <p className="text-sm text-white/70">
                  Current auth + settings state, update info, and client runtime details.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSnapshotCollapsed((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
                  aria-expanded={!snapshotCollapsed}
                >
                  {snapshotCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  {snapshotCollapsed ? 'Expand' : 'Minimize'}
                </button>
                <button
                  onClick={() => void settingsQuery.refetch()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
                <button
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
                >
                  {copied ? <ClipboardCheck className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {!snapshotCollapsed ? (
              <>
                <div className="mt-5 flex flex-wrap gap-2 text-xs">
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    Auth: {meQuery.data ? 'ok' : meQuery.isLoading ? 'loading' : 'unknown'}
                  </span>
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    Settings: {settingsQuery.isSuccess ? 'loaded' : settingsQuery.isLoading ? 'loading' : 'error'}
                  </span>
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    Updates: {updatesQuery.isSuccess ? 'loaded' : updatesQuery.isLoading ? 'loading' : 'error'}
                  </span>
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    Lines: {filteredSnapshotLines.length}/{snapshotLines.length}
                  </span>
                </div>

                <div className="mt-5">
                  <Input
                    value={snapshotQuery}
                    onChange={(event) => setSnapshotQuery(event.target.value)}
                    placeholder="Search snapshot..."
                    className="h-10 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:border-transparent focus:ring-2 focus:ring-white/20"
                  />
                </div>

                <pre className="mt-4 max-h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/50 p-4 text-xs text-white/80 select-text">
                  {snapshotDisplay}
                </pre>
              </>
            ) : null}
          </div>
        </div>
      }
      showCards={false}
    />
  );
}
