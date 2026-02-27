import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { motion, AnimatePresence, useAnimation } from 'motion/react';
import { Link } from 'react-router-dom';
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
  Search,
} from 'lucide-react';

import { listJobs, runJob, updateJobSchedule, listRuns } from '@/api/jobs';
import { testSavedIntegration } from '@/api/integrations';
import { getPublicSettings, putSettings } from '@/api/settings';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/components/ui/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AnalogTimePicker } from '@/components/AnalogTimePicker';
import { SavingPill } from '@/components/SavingPill';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
  APP_PRESSABLE_CLASS,
} from '@/lib/ui-classes';
import { useSafeNavigate } from '@/lib/navigation';

type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

type ScheduleDraft = {
  enabled: boolean;
  frequency: ScheduleFrequency;
  time: string; // HH:MM
  daysOfWeek: string[]; // ['0', '1', ...] (Sun-Sat) for weekly
  daysOfMonth: string[]; // ['1', '2', ...] (1-28) for monthly
  advancedCron?: string | null; // present if stored cron isn't representable by simple UI
};

type IntegrationSetupTarget = 'radarr' | 'sonarr' | 'overseerr';

const UNSCHEDULABLE_JOB_IDS = new Set<string>([
  'mediaAddedCleanup', // webhook/manual input only
  'immaculateTastePoints', // webhook/manual input only
  'watchedMovieRecommendations', // webhook/manual input only
]);
const TASK_MANAGER_HIDDEN_JOB_IDS = new Set<string>([
  'collectionResyncUpgrade', // one-time startup migration, not user-managed
]);

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
      'Keeps Radarr/Sonarr monitoring in sync with what’s already in Plex.',
  },
  arrMonitoredSearch: {
    icon: <Search className="w-8 h-8" />,
    color: 'text-fuchsia-300',
    description:
      'Runs missing searches for monitored items.',
  },
  mediaAddedCleanup: {
    icon: <CheckCircle2 className="w-8 h-8" />,
    color: 'text-teal-300',
    description:
      'Cleans up new Plex media with configurable actions: dedupe, ARR unmonitoring, and watchlist cleanup.',
  },
  recentlyWatchedRefresher: {
    icon: <RotateCw className="w-8 h-8" />,
    color: 'text-violet-400',
    description:
      'Off-peak refresh for “Recently Watched” and “Change of Taste” collections.',
  },
  immaculateTastePoints: {
    icon: <Sparkles className="w-8 h-8" />,
    color: 'text-yellow-300',
    description:
      'Updates your Immaculate Taste collection after you finish watching, and can send missing titles to Radarr/Sonarr/Overseerr.',
  },
  immaculateTasteRefresher: {
    icon: <RotateCw className="w-8 h-8" />,
    color: 'text-yellow-300',
    description:
      'Off-peak rebuild of “Immaculate Taste” across all Plex movie and TV libraries.',
  },
  watchedMovieRecommendations: {
    icon: <Sparkles className="w-8 h-8" />,
    color: 'text-violet-400',
    description:
      'Generates fresh recommendations after you finish a movie.',
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function readBool(obj: unknown, path: string): boolean | null {
  const v = readPath(obj, path);
  return typeof v === 'boolean' ? v : null;
}

function readString(obj: unknown, path: string): string {
  const v = readPath(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

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
  const current = new Date(now);

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

const TASK_MANAGER_AUTO_EXPAND_SEEN_KEY = 'immaculaterr.taskManager.autoExpandSeen.v1';

export function TaskManagerPage() {
  const navigate = useSafeNavigate();
  const queryClient = useQueryClient();
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const [arrRequiresSetupOpen, setArrRequiresSetupOpen] = useState(false);
  const [arrRequiresSetupJobId, setArrRequiresSetupJobId] = useState<string | null>(null);
  const [integrationSetupOpen, setIntegrationSetupOpen] = useState(false);
  const [integrationSetupTarget, setIntegrationSetupTarget] =
    useState<IntegrationSetupTarget | null>(null);
  const [arrPing, setArrPing] = useState<{
    loading: boolean;
    radarrOk: boolean | null;
    sonarrOk: boolean | null;
    checkedAtMs: number | null;
  }>({ loading: false, radarrOk: null, sonarrOk: null, checkedAtMs: null });
  const lastArrEnforceAtRef = useRef<number>(0);
  const [drafts, setDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [autoExpandSeen, setAutoExpandSeen] = useState<Record<string, boolean>>(() => {
    try {
      if (typeof window === 'undefined') return {};
      const raw = window.localStorage.getItem(TASK_MANAGER_AUTO_EXPAND_SEEN_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainObject(parsed)) return {};

      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'boolean') next[k] = v;
      }
      return next;
    } catch {
      return {};
    }
  });
  const [terminalState, setTerminalState] = useState<
    Record<
      string,
      { status: 'idle' | 'running' | 'completed'; runId?: string; result?: 'SUCCESS' | 'FAILED' }
    >
  >({});
  const [runNowUi, setRunNowUi] = useState<
    Record<
      string,
      | { phase: 'idle' }
      | { phase: 'running'; runId?: string | null }
      | { phase: 'finishing'; runId?: string | null; result?: 'SUCCESS' | 'FAILED' }
      | { phase: 'complete'; runId?: string | null; completedAt: number; result: 'SUCCESS' | 'FAILED' }
    >
  >({});
  const runNowFinishTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const runNowResetTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const [weeklyDaySelector, setWeeklyDaySelector] = useState<Record<string, boolean>>({});
  const [monthlyDaySelector, setMonthlyDaySelector] = useState<Record<string, boolean>>({});
  const [nextRunsPopup, setNextRunsPopup] = useState<Record<string, boolean>>({});
  const [timePickerOpen, setTimePickerOpen] = useState<Record<string, boolean>>({});

  // Manual run harness (media-seeded jobs)
  const [movieSeedDialogOpen, setMovieSeedDialogOpen] = useState(false);
  const [movieSeedDialogJobId, setMovieSeedDialogJobId] = useState<string | null>(null);
  const [movieSeedMediaType, setMovieSeedMediaType] = useState<'movie' | 'tv'>('movie');
  const [movieSeedTitle, setMovieSeedTitle] = useState('');
  const [movieSeedYear, setMovieSeedYear] = useState('');
  const [movieSeedError, setMovieSeedError] = useState<string | null>(null);
  const movieSeedTitleRef = useRef<HTMLInputElement | null>(null);
  const resetMovieSeedDialogOnCloseRef = useRef(false);

  // Immaculate Taste flow config (persisted in Settings)
  const settingsQuery = useQuery({
    queryKey: ['publicSettings'],
    queryFn: getPublicSettings,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const [
    immaculateIncludeRefresherAfterUpdate,
    setImmaculateIncludeRefresherAfterUpdate,
  ] = useState(true);
  const [
    immaculateStartSearchImmediately,
    setImmaculateStartSearchImmediately,
  ] = useState(false);
  const [
    immaculateStartSearchDialogOpen,
    setImmaculateStartSearchDialogOpen,
  ] = useState(false);
  const [immaculateRefresherDetailsOpen, setImmaculateRefresherDetailsOpen] =
    useState(false);
  const [cardIconPulse, setCardIconPulse] = useState<{
    jobId: string;
    nonce: number;
  } | null>(null);
  const [flashJob, setFlashJob] = useState<{ jobId: string; nonce: number } | null>(
    null,
  );
  const [webhookAutoRun, setWebhookAutoRun] = useState<Record<string, boolean>>({});
  const [arrMonitoredIncludeRadarr, setArrMonitoredIncludeRadarr] = useState(true);
  const [arrMonitoredIncludeSonarr, setArrMonitoredIncludeSonarr] = useState(true);
  const [mediaAddedCleanupDeleteDuplicates, setMediaAddedCleanupDeleteDuplicates] =
    useState(true);
  const [mediaAddedCleanupUnmonitorInArr, setMediaAddedCleanupUnmonitorInArr] =
    useState(true);
  const [
    mediaAddedCleanupRemoveFromWatchlist,
    setMediaAddedCleanupRemoveFromWatchlist,
  ] = useState(true);
  const [immaculateFetchMissingRadarr, setImmaculateFetchMissingRadarr] =
    useState(true);
  const [immaculateFetchMissingSonarr, setImmaculateFetchMissingSonarr] =
    useState(true);
  const [immaculateFetchMissingOverseerr, setImmaculateFetchMissingOverseerr] =
    useState(false);
  const [watchedFetchMissingRadarr, setWatchedFetchMissingRadarr] = useState(true);
  const [watchedFetchMissingSonarr, setWatchedFetchMissingSonarr] = useState(true);
  const [watchedFetchMissingOverseerr, setWatchedFetchMissingOverseerr] =
    useState(false);
  const [immaculateApprovalRequired, setImmaculateApprovalRequired] =
    useState(false);
  const [watchedApprovalRequired, setWatchedApprovalRequired] = useState(false);

  const openIntegrationSetupDialog = (target: IntegrationSetupTarget) => {
    setIntegrationSetupTarget(target);
    setIntegrationSetupOpen(true);
  };

  const closeIntegrationSetupDialog = useCallback(() => {
    setIntegrationSetupOpen(false);
    setIntegrationSetupTarget(null);
  }, []);

  const markAutoExpandSeen = (jobId: string) => {
    setAutoExpandSeen((prev) => {
      if (prev[jobId] === true) return prev;
      const next = { ...prev, [jobId]: true };
      try {
        window.localStorage.setItem(TASK_MANAGER_AUTO_EXPAND_SEEN_KEY, JSON.stringify(next));
      } catch {
        // ignore storage failures (private mode, etc)
      }
      return next;
    });
  };

  const publicSettings = settingsQuery.data?.settings;
  const secretsPresent = settingsQuery.data?.secretsPresent ?? {};

  const isRadarrEnabled = (() => {
    const saved = readBool(publicSettings, 'radarr.enabled');
    return (saved ?? Boolean(secretsPresent.radarr)) === true;
  })();
  const isSonarrEnabled = (() => {
    const saved = readBool(publicSettings, 'sonarr.enabled');
    return (saved ?? Boolean(secretsPresent.sonarr)) === true;
  })();
  const isOverseerrEnabled = (() => {
    const saved = readBool(publicSettings, 'overseerr.enabled');
    return (saved ?? Boolean(secretsPresent.overseerr)) === true;
  })();

  const hasRadarrBaseUrl = Boolean(readString(publicSettings, 'radarr.baseUrl'));
  const hasSonarrBaseUrl = Boolean(readString(publicSettings, 'sonarr.baseUrl'));
  const hasOverseerrBaseUrl = Boolean(readString(publicSettings, 'overseerr.baseUrl'));
  const hasRadarrApiKey = Boolean(secretsPresent.radarr);
  const hasSonarrApiKey = Boolean(secretsPresent.sonarr);
  const hasOverseerrApiKey = Boolean(secretsPresent.overseerr);

  const canEnableRadarrTaskToggles =
    isRadarrEnabled && hasRadarrBaseUrl && hasRadarrApiKey;
  const canEnableSonarrTaskToggles =
    isSonarrEnabled && hasSonarrBaseUrl && hasSonarrApiKey;
  const canEnableOverseerrTaskToggles =
    isOverseerrEnabled && hasOverseerrBaseUrl && hasOverseerrApiKey;

  // Background ARR reachability ping when entering Task Manager (fast validation).
  useEffect(() => {
    if (settingsQuery.status !== 'success') return;
    if (!isRadarrEnabled && !isSonarrEnabled) {
      // Nothing enabled -> don't ping.
      setArrPing((p) => ({ ...p, loading: false, radarrOk: null, sonarrOk: null, checkedAtMs: Date.now() }));
      return;
    }

    let cancelled = false;
    setArrPing((p) => ({ ...p, loading: true }));

    const run = async () => {
      const [radarrRes, sonarrRes] = await Promise.allSettled([
        isRadarrEnabled ? testSavedIntegration('radarr').then(() => true) : Promise.resolve(null),
        isSonarrEnabled ? testSavedIntegration('sonarr').then(() => true) : Promise.resolve(null),
      ]);

      const radarrOk =
        radarrRes.status === 'fulfilled' ? radarrRes.value : false;
      const sonarrOk =
        sonarrRes.status === 'fulfilled' ? sonarrRes.value : false;

      if (cancelled) return;
      setArrPing({
        loading: false,
        radarrOk,
        sonarrOk,
        checkedAtMs: Date.now(),
      });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [settingsQuery.status, isRadarrEnabled, isSonarrEnabled]);
  const immaculateIncludeRefresherMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      putSettings({
        settings: { immaculateTaste: { includeRefresherAfterUpdate: enabled } },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });

  const immaculateStartSearchMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      putSettings({
        settings: { jobs: { immaculateTastePoints: { searchImmediately: enabled } } },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });
  useEffect(() => {
    if (immaculateIncludeRefresherMutation.isPending) return;
    const saved = readBool(
      settingsQuery.data?.settings,
      'immaculateTaste.includeRefresherAfterUpdate',
    );
    setImmaculateIncludeRefresherAfterUpdate(saved ?? true);
  }, [settingsQuery.data?.settings, immaculateIncludeRefresherMutation.isPending]);

  useEffect(() => {
    if (immaculateStartSearchMutation.isPending) return;
    const saved = readBool(
      settingsQuery.data?.settings,
      'jobs.immaculateTastePoints.searchImmediately',
    );
    setImmaculateStartSearchImmediately(saved ?? false);
  }, [settingsQuery.data?.settings, immaculateStartSearchMutation.isPending]);

  useEffect(() => {
    if (immaculateIncludeRefresherMutation.isError) {
      setImmaculateRefresherDetailsOpen(true);
    }
  }, [immaculateIncludeRefresherMutation.isError]);

  const webhookAutoRunMutation = useMutation({
    mutationFn: async (params: { jobId: string; enabled: boolean }) =>
      putSettings({
        settings: { jobs: { webhookEnabled: { [params.jobId]: params.enabled } } },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });

  useEffect(() => {
    // Initialize webhook-only auto-run toggles from settings (default: disabled).
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    if (webhookAutoRunMutation.isPending) return;

    setWebhookAutoRun((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const jobId of UNSCHEDULABLE_JOB_IDS) {
        if (next[jobId] !== undefined) continue;
        const saved = readBool(settings, `jobs.webhookEnabled.${jobId}`);
        next[jobId] = saved ?? false;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [settingsQuery.data?.settings, webhookAutoRunMutation.isPending]);

  const arrMonitoredSearchOptionsMutation = useMutation({
    mutationFn: async (patch: { includeRadarr?: boolean; includeSonarr?: boolean }) =>
      putSettings({
        settings: { jobs: { arrMonitoredSearch: patch } },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });

  useEffect(() => {
    if (arrMonitoredSearchOptionsMutation.isPending) return;
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    const includeRadarr = readBool(settings, 'jobs.arrMonitoredSearch.includeRadarr');
    const includeSonarr = readBool(settings, 'jobs.arrMonitoredSearch.includeSonarr');
    setArrMonitoredIncludeRadarr(includeRadarr ?? true);
    setArrMonitoredIncludeSonarr(includeSonarr ?? true);
  }, [settingsQuery.data?.settings, arrMonitoredSearchOptionsMutation.isPending]);

  const mediaAddedCleanupFeaturesMutation = useMutation({
    mutationFn: async (patch: {
      deleteDuplicates?: boolean;
      unmonitorInArr?: boolean;
      removeFromWatchlist?: boolean;
    }) =>
      putSettings({
        settings: {
          jobs: {
            mediaAddedCleanup: {
              features: patch,
            },
          },
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });

  useEffect(() => {
    if (mediaAddedCleanupFeaturesMutation.isPending) return;
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    setMediaAddedCleanupDeleteDuplicates(
      readBool(settings, 'jobs.mediaAddedCleanup.features.deleteDuplicates') ?? true,
    );
    setMediaAddedCleanupUnmonitorInArr(
      readBool(settings, 'jobs.mediaAddedCleanup.features.unmonitorInArr') ?? true,
    );
    setMediaAddedCleanupRemoveFromWatchlist(
      readBool(settings, 'jobs.mediaAddedCleanup.features.removeFromWatchlist') ?? true,
    );
  }, [settingsQuery.data?.settings, mediaAddedCleanupFeaturesMutation.isPending]);

  const fetchMissingMutation = useMutation({
    mutationFn: async (params: {
      jobId: 'immaculateTastePoints' | 'watchedMovieRecommendations';
      patch: { radarr?: boolean; sonarr?: boolean };
    }) =>
      putSettings({
        settings: { jobs: { [params.jobId]: { fetchMissing: params.patch } } },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });

  const overseerrModeMutation = useMutation({
    mutationFn: async (params: {
      jobId: 'immaculateTastePoints' | 'watchedMovieRecommendations';
      enabled: boolean;
    }) => {
      if (!params.enabled) {
        return putSettings({
          settings: {
            jobs: {
              [params.jobId]: {
                fetchMissing: {
                  overseerr: false,
                },
              },
            },
          },
        });
      }

      if (params.jobId === 'immaculateTastePoints') {
        return putSettings({
          settings: {
            jobs: {
              immaculateTastePoints: {
                fetchMissing: {
                  overseerr: true,
                  radarr: false,
                  sonarr: false,
                },
                approvalRequiredFromObservatory: false,
                searchImmediately: false,
              },
            },
          },
        });
      }

      return putSettings({
        settings: {
          jobs: {
            watchedMovieRecommendations: {
              fetchMissing: {
                overseerr: true,
                radarr: false,
                sonarr: false,
              },
              approvalRequiredFromObservatory: false,
            },
          },
        },
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });

  useEffect(() => {
    if (fetchMissingMutation.isPending || overseerrModeMutation.isPending) return;
    const settings = settingsQuery.data?.settings;
    if (!settings) return;

    setImmaculateFetchMissingRadarr(
      readBool(settings, 'jobs.immaculateTastePoints.fetchMissing.radarr') ?? true,
    );
    setImmaculateFetchMissingSonarr(
      readBool(settings, 'jobs.immaculateTastePoints.fetchMissing.sonarr') ?? true,
    );
    setImmaculateFetchMissingOverseerr(
      readBool(settings, 'jobs.immaculateTastePoints.fetchMissing.overseerr') ??
        false,
    );
    setWatchedFetchMissingRadarr(
      readBool(settings, 'jobs.watchedMovieRecommendations.fetchMissing.radarr') ??
        true,
    );
    setWatchedFetchMissingSonarr(
      readBool(settings, 'jobs.watchedMovieRecommendations.fetchMissing.sonarr') ??
        true,
    );
    setWatchedFetchMissingOverseerr(
      readBool(settings, 'jobs.watchedMovieRecommendations.fetchMissing.overseerr') ??
        false,
    );

    setImmaculateApprovalRequired(
      readBool(
        settings,
        'jobs.immaculateTastePoints.approvalRequiredFromObservatory',
      ) ?? false,
    );

    setWatchedApprovalRequired(
      readBool(
        settings,
        'jobs.watchedMovieRecommendations.approvalRequiredFromObservatory',
      ) ?? false,
    );
  }, [
    settingsQuery.data?.settings,
    fetchMissingMutation.isPending,
    overseerrModeMutation.isPending,
  ]);

  const immaculateApprovalRequiredMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      putSettings({
        settings: {
          jobs: {
            immaculateTastePoints: { approvalRequiredFromObservatory: enabled },
          },
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });

  const watchedApprovalRequiredMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      putSettings({
        settings: {
          jobs: {
            watchedMovieRecommendations: { approvalRequiredFromObservatory: enabled },
          },
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['publicSettings'], data);
    },
  });

  const immaculateOverseerrMode = immaculateFetchMissingOverseerr;
  const watchedOverseerrMode = watchedFetchMissingOverseerr;
  const immaculateOverseerrModePending =
    overseerrModeMutation.isPending &&
    overseerrModeMutation.variables?.jobId === 'immaculateTastePoints';
  const watchedOverseerrModePending =
    overseerrModeMutation.isPending &&
    overseerrModeMutation.variables?.jobId === 'watchedMovieRecommendations';

  useEffect(() => {
    if (!flashJob) return;
    // Keep the highlight mounted long enough for the full pulse sequence.
    const t = setTimeout(() => setFlashJob(null), 4200);
    return () => clearTimeout(t);
  }, [flashJob?.nonce]);

  useEffect(() => {
    if (!cardIconPulse) return;
    const t = setTimeout(() => setCardIconPulse(null), 750);
    return () => clearTimeout(t);
  }, [cardIconPulse?.nonce]);

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
  const visibleJobs = useMemo(
    () =>
      (jobsQuery.data?.jobs ?? []).filter(
        (job) => !TASK_MANAGER_HIDDEN_JOB_IDS.has(job.id),
      ),
    [jobsQuery.data?.jobs],
  );

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

      // If the user triggered "Run Now", attach the runId so we can detect completion.
      setRunNowUi((prev) => {
        const cur = prev[vars.jobId];
        if (!cur || cur.phase === 'idle') return prev;
        if (cur.phase === 'complete') {
          return { ...prev, [vars.jobId]: { ...cur, runId: data.run.id } };
        }
        if (cur.phase === 'running') {
          return { ...prev, [vars.jobId]: { phase: cur.phase, runId: data.run.id } };
        }
        if (cur.phase === 'finishing') {
          return {
            ...prev,
            [vars.jobId]: { phase: cur.phase, runId: data.run.id, result: cur.result },
          };
        }
        return prev;
      });
    },
    onError: (_err, vars) => {
      // If the API call to start the run fails, reset the Run Now button state.
      setRunNowUi((prev) => ({ ...prev, [vars.jobId]: { phase: 'idle' } }));
    },
  });

  const clearRunNowTimers = (jobId: string) => {
    const finishTimer = runNowFinishTimersRef.current[jobId];
    if (finishTimer) clearTimeout(finishTimer);
    runNowFinishTimersRef.current[jobId] = null;

    const resetTimer = runNowResetTimersRef.current[jobId];
    if (resetTimer) clearTimeout(resetTimer);
    runNowResetTimersRef.current[jobId] = null;
  };

  const startRunNowUi = (jobId: string) => {
    clearRunNowTimers(jobId);
    setRunNowUi((prev) => ({ ...prev, [jobId]: { phase: 'running' } }));
  };

  // Cleanup timers on unmount (page leave).
  useEffect(() => {
    return () => {
      for (const t of Object.values(runNowFinishTimersRef.current)) {
        if (t) clearTimeout(t);
      }
      for (const t of Object.values(runNowResetTimersRef.current)) {
        if (t) clearTimeout(t);
      }
    };
  }, []);

  // When a user-triggered run completes, animate to 100%, then turn green and hold "Complete".
  useEffect(() => {
    for (const [jobId, ui] of Object.entries(runNowUi)) {
      if (ui.phase !== 'running') continue;
      const t = terminalState[jobId];
      if (!t || t.status !== 'completed') continue;
      if (ui.runId && t.runId && ui.runId !== t.runId) continue;

      const result: 'SUCCESS' | 'FAILED' = t.result ?? 'SUCCESS';

      // 80% -> 100% (amber), then switch to green (SUCCESS) or red (FAILED).
      clearRunNowTimers(jobId);
      setRunNowUi((prev) => ({
        ...prev,
        [jobId]: { phase: 'finishing', runId: t.runId ?? ui.runId ?? null, result },
      }));

      runNowFinishTimersRef.current[jobId] = setTimeout(() => {
        setRunNowUi((prev) => ({
          ...prev,
          [jobId]: {
            phase: 'complete',
            runId: t.runId ?? ui.runId ?? null,
            completedAt: Date.now(),
            result,
          },
        }));

        // Hold "Complete" for 2 minutes, then reset back to "Run Now" (while staying on page).
        runNowResetTimersRef.current[jobId] = setTimeout(() => {
          setRunNowUi((prev) => ({ ...prev, [jobId]: { phase: 'idle' } }));
        }, 120_000);
      }, 650);
    }
  }, [runNowUi, terminalState]);

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

  // If neither Radarr nor Sonarr is reachable, disable ARR-dependent schedules automatically.
  useEffect(() => {
    if (settingsQuery.status !== 'success') return;
    if (jobsQuery.status !== 'success') return;
    if (arrPing.loading || arrPing.checkedAtMs === null) return;

    const radarrOk = isRadarrEnabled && arrPing.radarrOk === true;
    const sonarrOk = isSonarrEnabled && arrPing.sonarrOk === true;
    const anyArrOk = radarrOk || sonarrOk;
    if (anyArrOk) return;

    const now = Date.now();
    // Throttle so we don't spam schedule writes if queries refetch.
    if (now - lastArrEnforceAtRef.current < 30_000) return;
    lastArrEnforceAtRef.current = now;

    const targetJobIds: Array<'monitorConfirm' | 'arrMonitoredSearch'> = [
      'monitorConfirm',
      'arrMonitoredSearch',
    ];

    for (const jobId of targetJobIds) {
      const job = visibleJobs.find((j) => j.id === jobId);
      if (!job) continue;
      const enabled = job.schedule?.enabled ?? false;
      if (!enabled) continue;
      const cron = job.schedule?.cron ?? job.defaultScheduleCron ?? '';
      if (!cron) continue;
      scheduleMutation.mutate({ jobId, cron, enabled: false });
    }
  }, [
    settingsQuery.status,
    jobsQuery.status,
    visibleJobs,
    arrPing.loading,
    arrPing.checkedAtMs,
    arrPing.radarrOk,
    arrPing.sonarrOk,
    isRadarrEnabled,
    isSonarrEnabled,
  ]);

  // Check for recent runs on mount and when jobs change
  useEffect(() => {
    if (visibleJobs.length === 0) return;

    const checkRecentRuns = async () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

      for (const job of visibleJobs) {
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
              [job.id]: {
                status: 'completed',
                runId: latestRun.id,
                result: latestRun.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
              },
            }));
          }
        } catch {
          // Ignore transient polling failures; the next refresh will retry.
        }
      }
    };

    void checkRecentRuns();
  }, [visibleJobs]);

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
              [jobId]: {
                status: 'completed',
                runId: latestRun.id,
                result: latestRun.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
              },
            }));
          }
        } catch {
          // Ignore transient polling failures; the next poll will retry.
        }
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [terminalState]);

  // Auto-save schedule changes with debounce
  useEffect(() => {
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    Object.entries(drafts).forEach(([jobId, draft]) => {
      const job = visibleJobs.find((j) => j.id === jobId);
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
  }, [drafts, visibleJobs]);

  const integrationSetupMeta = (() => {
    if (integrationSetupTarget === 'radarr') {
      return {
        id: 'radarr' as const,
        label: 'Radarr',
        enabled: isRadarrEnabled,
        hasBaseUrl: hasRadarrBaseUrl,
        hasApiKey: hasRadarrApiKey,
      };
    }
    if (integrationSetupTarget === 'sonarr') {
      return {
        id: 'sonarr' as const,
        label: 'Sonarr',
        enabled: isSonarrEnabled,
        hasBaseUrl: hasSonarrBaseUrl,
        hasApiKey: hasSonarrApiKey,
      };
    }
    if (integrationSetupTarget === 'overseerr') {
      return {
        id: 'overseerr' as const,
        label: 'Overseerr',
        enabled: isOverseerrEnabled,
        hasBaseUrl: hasOverseerrBaseUrl,
        hasApiKey: hasOverseerrApiKey,
      };
    }
    return null;
  })();

  const integrationSetupDescription = (() => {
    if (!integrationSetupMeta) return null;
    const vaultPath = `/vault#vault-${integrationSetupMeta.id}`;
    const missingParts = [
      ...(!integrationSetupMeta.hasBaseUrl ? ['base URL'] : []),
      ...(!integrationSetupMeta.hasApiKey ? ['API key'] : []),
    ];
    const missingText =
      missingParts.length > 1
        ? `${missingParts.slice(0, -1).join(', ')} and ${missingParts[missingParts.length - 1]}`
        : (missingParts[0] ?? '');

    return (
      <div className="space-y-2">
        <div className="text-white/85 font-semibold">
          This toggle needs <span className="text-white">{integrationSetupMeta.label}</span>{' '}
          available.
        </div>
        <div className="text-sm text-white/70">
          {!integrationSetupMeta.enabled ? (
            <>
              {integrationSetupMeta.label} is currently disabled. Enable it in{' '}
              <Link
                to={vaultPath}
                className="underline underline-offset-4 decoration-white/30 hover:decoration-white/70 text-white"
              >
                {integrationSetupMeta.label}
              </Link>{' '}
              in the Vault.
            </>
          ) : missingParts.length > 0 ? (
            <>
              {integrationSetupMeta.label} is not fully configured. Add {missingText} in{' '}
              <Link
                to={vaultPath}
                className="underline underline-offset-4 decoration-white/30 hover:decoration-white/70 text-white"
              >
                {integrationSetupMeta.label}
              </Link>{' '}
              in the Vault.
            </>
          ) : (
            <>
              Check{' '}
              <Link
                to={vaultPath}
                className="underline underline-offset-4 decoration-white/30 hover:decoration-white/70 text-white"
              >
                {integrationSetupMeta.label}
              </Link>{' '}
              in the Vault.
            </>
          )}
        </div>
        <div className="text-xs text-white/55">
          Tip: tap the {integrationSetupMeta.label} link above to jump straight to that Vault
          card.
        </div>
      </div>
    );
  })();
  const handleAnimateTitleIcon = useCallback(() => {
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
  const handleStopPropagation = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);
  const handleStopPropagationPointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.stopPropagation();
    },
    [],
  );
  const closeMovieSeedDialog = useCallback(() => {
    setMovieSeedDialogOpen(false);
    setMovieSeedDialogJobId(null);
  }, []);
  const resetMovieSeedDialogState = useCallback(() => {
    setMovieSeedMediaType('movie');
    setMovieSeedTitle('');
    setMovieSeedYear('');
    setMovieSeedError(null);
  }, []);
  const hasValidTitle = (title: string): boolean => {
    if (!title) {
      setMovieSeedError('Please enter a title.');
      return false;
    }
    return true;
  };

  const hasValidYear = (yearRaw: string, year: number): boolean => {
    if (yearRaw && (!Number.isFinite(year) || year < 1888 || year > 2100)) {
      setMovieSeedError('Year must be a valid 4-digit number.');
      return false;
    }
    return true;
  };

  const executeMovieSeedRun = (title: string, year: number): void => {
    if (movieSeedDialogJobId) startRunNowUi(movieSeedDialogJobId);
    setTerminalState((prev) => ({
      ...prev,
      ...(movieSeedDialogJobId ? { [movieSeedDialogJobId]: { status: 'running' } } : {}),
    }));
    if (movieSeedDialogJobId) {
      runMutation.mutate({
        jobId: movieSeedDialogJobId,
        dryRun: false,
        input: {
          source: 'manualRun',
          plexEvent: 'media.scrobble',
          mediaType: movieSeedMediaType,
          seedTitle: title,
          seedYear: Number.isFinite(year) ? year : null,
          seedRatingKey: null,
        },
      });
    }
    resetMovieSeedDialogOnCloseRef.current = true;
    closeMovieSeedDialog();
  };

  const submitMovieSeedRun = useCallback((): boolean => {
    const title = movieSeedTitle.trim();
    if (!hasValidTitle(title)) {
      return false;
    }

    const yearRaw = movieSeedYear.trim();
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;
  const handleMovieSeedRun = useCallback((titleRaw, yearRaw, title, year) => {
    const handleMovieSeedRunNow = useCallback((title, yearRaw, year) => {
          if (!hasValidYear(yearRaw, year)) {
            return false;
          }

          executeMovieSeedRun(title, year);
          return true;
        }, [
          movieSeedTitle,
          movieSeedYear,
          movieSeedDialogJobId,
          movieSeedMediaType,
          runMutation,
          setMovieSeedError,
          startRunNowUi,
          setTerminalState,
          resetMovieSeedDialogOnCloseRef,
          closeMovieSeedDialog,
        ]);
          closeMovieSeedDialog,
          movieSeedDialogJobId,
          movieSeedMediaType,
          movieSeedTitle,
          movieSeedYear,
          runMutation,
          startRunNowUi,
        ]);
        const handleMovieSeedExitComplete = useCallback(() => {
          if (!resetMovieSeedDialogOnCloseRef.current) return;
          resetMovieSeedDialogOnCloseRef.current = false;
          resetMovieSeedDialogState();
        }, [resetMovieSeedDialogState]);
        const handleMovieSeedMediaTypeChange = useCallback(
          (event: ChangeEvent<HTMLSelectElement>) => {
            const value = event.target.value === 'tv' ? 'tv' : 'movie';
            setMovieSeedError(null);
            setMovieSeedMediaType(value);
          },
          [],
        );
        const handleMovieSeedTitleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
          setMovieSeedError(null);
          setMovieSeedTitle(event.target.value);
        }, []);
        const handleMovieSeedYearChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
          setMovieSeedError(null);
          setMovieSeedYear(event.target.value);
        }, []);
        const handleMovieSeedTitleKeyDown = useCallback(
          (event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
      submitMovieSeedRun();
    },
    [submitMovieSeedRun],
  );
  const closeImmaculateStartSearchDialog = useCallback(() => {
    setImmaculateStartSearchDialogOpen(false);
  }, []);
  const handleCloseArrRequiresSetupDialog = useCallback(() => {
    setArrRequiresSetupOpen(false);
    setArrRequiresSetupJobId(null);
  }, []);
  const handleConfirmArrRequiresSetupDialog = useCallback(() => {
    setArrRequiresSetupOpen(false);
    setArrRequiresSetupJobId(null);
    navigate('/vault');
  }, [navigate]);
  const handleConfirmIntegrationSetupDialog = useCallback(() => {
    const target = integrationSetupMeta?.id;
    closeIntegrationSetupDialog();
    navigate(target ? `/vault#vault-${target}` : '/vault');
  }, [closeIntegrationSetupDialog, integrationSetupMeta?.id, navigate]);
  const handleToggleImmaculateRefresherDetails = useCallback(() => {
    setImmaculateRefresherDetailsOpen((value) => !value);
  }, []);
  const handleImmaculateRefresherDetailsKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      setImmaculateRefresherDetailsOpen((value) => !value);
    },
    [],
  );
  const handleScrollToImmaculateRefresher = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      document
        .getElementById('job-immaculateTasteRefresher')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFlashJob({
        jobId: 'immaculateTasteRefresher',
        nonce: Date.now(),
      });
    },
    [],
  );
  const handleJobCardPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const jobId = event.currentTarget.dataset.jobId;
      if (!jobId) return;
      setCardIconPulse({ jobId, nonce: Date.now() });
    },
    [],
  );
  const handleJobCardClick = useCallback(
    const isClickOnIgnoredElement = (target: HTMLElement | null): boolean => {
      return !target || !!target.closest(
        'button, a, input, select, textarea, [role="switch"], [data-no-card-toggle="true"]',
      );
    };

    const handleArrRequiresSetup = (jobId: string) => {
      setArrRequiresSetupJobId(jobId);
      setArrRequiresSetupOpen(true);
    };

    const toggleCardExpansion = (jobId: string, expanded: boolean) => {
      setExpandedCards((prev) => ({ ...prev, [jobId]: !expanded }));
    };

    (event: ReactMouseEvent<HTMLDivElement>) => {
      const { jobId, arrRequiredBlocked, canExpand, expanded } = event.currentTarget.dataset;
      if (!jobId) return;
      if (arrRequiredBlocked === 'true') {
        handleArrRequiresSetup(jobId);
        return;
      }
      if (canExpand !== 'true') return;
      const target = event.target as HTMLElement | null;
      if (isClickOnIgnoredElement(target)) return;
      toggleCardExpansion(jobId, expanded === 'true');
    },
    [],
  );
  const handleOpenArrRequiresSetupForJob = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const jobId = event.currentTarget.dataset.jobId;
      if (!jobId) return;
      setArrRequiresSetupJobId(jobId);
      setArrRequiresSetupOpen(true);
    },
    [],
  );
  const handleScheduleToggle = useCallback(
    const enableJob = (jobId: string, job: Job) => {
      setExpandedCards((prev) => ({ ...prev, [jobId]: true }));
      const defaultCron = job.schedule?.cron ?? job.defaultScheduleCron ?? '0 3 * * *';
      const defaultDraft = defaultDraftFromCron({ cron: defaultCron, enabled: true });
      setDrafts((prev) => ({ ...prev, [jobId]: defaultDraft }));
      scheduleMutation.mutate({ jobId, cron: defaultCron, enabled: true });
    };
    const disableJob = (jobId: string, draft: Draft, job: Job) => {
      const baseCron = job.schedule?.cron ?? job.defaultScheduleCron ?? '';
      const cron = buildCronFromDraft(draft) || baseCron || job.defaultScheduleCron || '0 3 * * *';
      setDrafts((prev) => ({ ...prev, [jobId]: { ...draft, enabled: false } }));
      scheduleMutation.mutate({ jobId, cron, enabled: false });
    };
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const jobId = event.currentTarget.dataset.jobId;
      if (!jobId) return;
      const job = visibleJobs.find((entry) => entry.id === jobId);
      if (!job) return;
      const baseCron = job.schedule?.cron ?? job.defaultScheduleCron ?? '';
      const baseEnabled = job.schedule?.enabled ?? false;
      const draft =
        drafts[jobId] ??
        defaultDraftFromCron({ cron: baseCron, enabled: baseEnabled });
      const newEnabled = !draft.enabled;
      newEnabled ? enableJob(jobId, job) : disableJob(jobId, draft, job);
    },
    [drafts, scheduleMutation, visibleJobs],
  );
  const handleWebhookAutoRunToggle = useCallback(
    const AUTO_EXPAND_JOB_IDS = ['mediaAddedCleanup', 'immaculateTastePoints', 'watchedMovieRecommendations'] as const;

    function shouldAutoExpandOnce(jobId: string, next: boolean): boolean {
      return next && AUTO_EXPAND_JOB_IDS.includes(jobId) && autoExpandSeen[jobId] !== true;
    }

    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const jobId = event.currentTarget.dataset.jobId;
      if (!jobId) return;
      const prev =
        webhookAutoRun[jobId] ??
        (readBool(settingsQuery.data?.settings, `jobs.webhookEnabled.${jobId}`) ?? false);
      const next = !prev;

      setWebhookAutoRun(current => ({ ...current, [jobId]: next }));
      if (shouldAutoExpandOnce(jobId, next)) {
        setExpandedCards(current => ({ ...current, [jobId]: true }));
        markAutoExpandSeen(jobId);
      }
      webhookAutoRunMutation.mutate(
        { jobId, enabled: next },
        {
          onError: () => {
            setWebhookAutoRun(current => ({ ...current, [jobId]: prev }));
          },
        },
      );
    },
    [
      autoExpandSeen,
      markAutoExpandSeen,
      settingsQuery.data?.settings,
      webhookAutoRun,
      webhookAutoRunMutation,
    ],
  );
  const handleTerminalClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const runId = event.currentTarget.dataset.runId;
      if (!runId) return;
      navigate(`/rewind/${runId}`);
    },
    [navigate],
  );
  const handleRunNow = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const jobId = event.currentTarget.dataset.jobId;
      if (!jobId) return;
      const needsSeedInput =
        jobId === 'watchedMovieRecommendations' || jobId === 'immaculateTastePoints';
      if (needsSeedInput) {
        setMovieSeedError(null);
        setMovieSeedDialogJobId(jobId);
        setMovieSeedDialogOpen(true);
        return;
      }

      startRunNowUi(jobId);
      setTerminalState((prev) => ({
        ...prev,
        [jobId]: { status: 'running' },
      }));
      runMutation.mutate({ jobId, dryRun: false });
    },
    [runMutation, startRunNowUi],
  );
  const handleToggleMediaAddedCleanupDeleteDuplicates = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = mediaAddedCleanupDeleteDuplicates;
      const next = !prev;
      setMediaAddedCleanupDeleteDuplicates(next);
      mediaAddedCleanupFeaturesMutation.mutate(
        { deleteDuplicates: next },
        {
          onError: () => setMediaAddedCleanupDeleteDuplicates(prev),
        },
      );
    },
    [mediaAddedCleanupDeleteDuplicates, mediaAddedCleanupFeaturesMutation],
  );
  const handleToggleMediaAddedCleanupUnmonitorInArr = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = mediaAddedCleanupUnmonitorInArr;
      const next = !prev;
      setMediaAddedCleanupUnmonitorInArr(next);
      mediaAddedCleanupFeaturesMutation.mutate(
        { unmonitorInArr: next },
        {
          onError: () => setMediaAddedCleanupUnmonitorInArr(prev),
        },
      );
    },
    [mediaAddedCleanupFeaturesMutation, mediaAddedCleanupUnmonitorInArr],
  );
  const handleToggleMediaAddedCleanupRemoveFromWatchlist = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = mediaAddedCleanupRemoveFromWatchlist;
      const next = !prev;
      setMediaAddedCleanupRemoveFromWatchlist(next);
      mediaAddedCleanupFeaturesMutation.mutate(
        { removeFromWatchlist: next },
        {
          onError: () => setMediaAddedCleanupRemoveFromWatchlist(prev),
        },
      );
    },
    [mediaAddedCleanupFeaturesMutation, mediaAddedCleanupRemoveFromWatchlist],
  );
  const handleToggleImmaculateIncludeRefresher = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const next = !immaculateIncludeRefresherAfterUpdate;
      setImmaculateIncludeRefresherAfterUpdate(next);
      immaculateIncludeRefresherMutation.mutate(next);
    },
    [immaculateIncludeRefresherAfterUpdate, immaculateIncludeRefresherMutation],
  );
  const handleToggleImmaculateFetchMissingRadarr = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = immaculateFetchMissingRadarr;
      const next = !prev;
      if (next && !canEnableRadarrTaskToggles) {
        openIntegrationSetupDialog('radarr');
        return;
      }
      setImmaculateFetchMissingRadarr(next);
      fetchMissingMutation.mutate(
        {
          jobId: 'immaculateTastePoints',
          patch: { radarr: next },
        },
        {
          onError: () => setImmaculateFetchMissingRadarr(prev),
        },
      );
    },
    [
      canEnableRadarrTaskToggles,
      fetchMissingMutation,
      immaculateFetchMissingRadarr,
      openIntegrationSetupDialog,
    ],
  );
  const handleToggleImmaculateFetchMissingSonarr = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = immaculateFetchMissingSonarr;
      const next = !prev;
      if (next && !canEnableSonarrTaskToggles) {
        openIntegrationSetupDialog('sonarr');
        return;
      }
      setImmaculateFetchMissingSonarr(next);
      fetchMissingMutation.mutate(
        {
          jobId: 'immaculateTastePoints',
          patch: { sonarr: next },
        },
        {
          onError: () => setImmaculateFetchMissingSonarr(prev),
        },
      );
    },
    [
      canEnableSonarrTaskToggles,
      fetchMissingMutation,
      immaculateFetchMissingSonarr,
      openIntegrationSetupDialog,
    ],
  );
  const handleToggleImmaculateStartSearchImmediately = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!immaculateStartSearchImmediately) {
        setImmaculateStartSearchDialogOpen(true);
        return;
      }

      const prev = immaculateStartSearchImmediately;
      const next = false;
      setImmaculateStartSearchImmediately(next);
      immaculateStartSearchMutation.mutate(next, {
        onError: () => setImmaculateStartSearchImmediately(prev),
      });
    },
    [immaculateStartSearchImmediately, immaculateStartSearchMutation],
  );
  const handleToggleImmaculateApprovalRequired = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = immaculateApprovalRequired;
      const next = !prev;
      setImmaculateApprovalRequired(next);
      immaculateApprovalRequiredMutation.mutate(next, {
        onError: () => setImmaculateApprovalRequired(prev),
      });
    },
    [immaculateApprovalRequired, immaculateApprovalRequiredMutation],
  );
  const handleToggleImmaculateOverseerrMode = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = {
        overseerr: immaculateFetchMissingOverseerr,
        radarr: immaculateFetchMissingRadarr,
        sonarr: immaculateFetchMissingSonarr,
        approval: immaculateApprovalRequired,
        search: immaculateStartSearchImmediately,
      };
      const next = !prev.overseerr;
      if (next && !canEnableOverseerrTaskToggles) {
        openIntegrationSetupDialog('overseerr');
        return;
      }

      if (next) {
        setImmaculateFetchMissingOverseerr(true);
        setImmaculateFetchMissingRadarr(false);
        setImmaculateFetchMissingSonarr(false);
        setImmaculateApprovalRequired(false);
        setImmaculateStartSearchImmediately(false);
      } else {
        setImmaculateFetchMissingOverseerr(false);
      }

      overseerrModeMutation.mutate(
        {
          jobId: 'immaculateTastePoints',
          enabled: next,
        },
        {
          onError: () => {
            setImmaculateFetchMissingOverseerr(prev.overseerr);
            setImmaculateFetchMissingRadarr(prev.radarr);
            setImmaculateFetchMissingSonarr(prev.sonarr);
            setImmaculateApprovalRequired(prev.approval);
            setImmaculateStartSearchImmediately(prev.search);
          },
        },
      );
    },
    [
      canEnableOverseerrTaskToggles,
      immaculateApprovalRequired,
      immaculateFetchMissingOverseerr,
      immaculateFetchMissingRadarr,
      immaculateFetchMissingSonarr,
      immaculateStartSearchImmediately,
      openIntegrationSetupDialog,
      overseerrModeMutation,
    ],
  );
  const handleToggleWatchedFetchMissingRadarr = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = watchedFetchMissingRadarr;
      const next = !prev;
      if (next && !canEnableRadarrTaskToggles) {
        openIntegrationSetupDialog('radarr');
        return;
      }
      setWatchedFetchMissingRadarr(next);
      fetchMissingMutation.mutate(
        {
          jobId: 'watchedMovieRecommendations',
          patch: { radarr: next },
        },
        {
          onError: () => setWatchedFetchMissingRadarr(prev),
        },
      );
    },
    [
      canEnableRadarrTaskToggles,
      fetchMissingMutation,
      openIntegrationSetupDialog,
      watchedFetchMissingRadarr,
    ],
  );
  const handleToggleWatchedFetchMissingSonarr = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = watchedFetchMissingSonarr;
      const next = !prev;
      if (next && !canEnableSonarrTaskToggles) {
        openIntegrationSetupDialog('sonarr');
        return;
      }
      setWatchedFetchMissingSonarr(next);
      fetchMissingMutation.mutate(
        {
          jobId: 'watchedMovieRecommendations',
          patch: { sonarr: next },
        },
        {
          onError: () => setWatchedFetchMissingSonarr(prev),
        },
      );
    },
    [
      canEnableSonarrTaskToggles,
      fetchMissingMutation,
      openIntegrationSetupDialog,
      watchedFetchMissingSonarr,
    ],
  );
  const handleToggleWatchedApprovalRequired = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = watchedApprovalRequired;
      const next = !prev;
      setWatchedApprovalRequired(next);
      watchedApprovalRequiredMutation.mutate(next, {
        onError: () => setWatchedApprovalRequired(prev),
      });
    },
    [watchedApprovalRequired, watchedApprovalRequiredMutation],
  );
  const handleToggleWatchedOverseerrMode = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = {
        overseerr: watchedFetchMissingOverseerr,
        radarr: watchedFetchMissingRadarr,
        sonarr: watchedFetchMissingSonarr,
        approval: watchedApprovalRequired,
      };
      const next = !prev.overseerr;
      if (next && !canEnableOverseerrTaskToggles) {
        openIntegrationSetupDialog('overseerr');
        return;
      }

      if (next) {
        setWatchedFetchMissingOverseerr(true);
        setWatchedFetchMissingRadarr(false);
        setWatchedFetchMissingSonarr(false);
        setWatchedApprovalRequired(false);
      } else {
        setWatchedFetchMissingOverseerr(false);
      }

      overseerrModeMutation.mutate(
        {
          jobId: 'watchedMovieRecommendations',
          enabled: next,
        },
        {
          onError: () => {
            setWatchedFetchMissingOverseerr(prev.overseerr);
            setWatchedFetchMissingRadarr(prev.radarr);
            setWatchedFetchMissingSonarr(prev.sonarr);
            setWatchedApprovalRequired(prev.approval);
          },
        },
      );
    },
    [
      canEnableOverseerrTaskToggles,
      openIntegrationSetupDialog,
      overseerrModeMutation,
      watchedApprovalRequired,
      watchedFetchMissingOverseerr,
      watchedFetchMissingRadarr,
      watchedFetchMissingSonarr,
    ],
  );
  const handleToggleArrMonitoredIncludeRadarr = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = arrMonitoredIncludeRadarr;
      const next = !arrMonitoredIncludeRadarr;
      if (next && !canEnableRadarrTaskToggles) {
        openIntegrationSetupDialog('radarr');
        return;
      }
      setArrMonitoredIncludeRadarr(next);
      arrMonitoredSearchOptionsMutation.mutate(
        { includeRadarr: next },
        {
          onError: () => {
            setArrMonitoredIncludeRadarr(prev);
          },
        },
      );
    },
    [
      arrMonitoredIncludeRadarr,
      arrMonitoredSearchOptionsMutation,
      canEnableRadarrTaskToggles,
      openIntegrationSetupDialog,
    ],
  );
  const handleToggleArrMonitoredIncludeSonarr = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const prev = arrMonitoredIncludeSonarr;
      const next = !arrMonitoredIncludeSonarr;
      if (next && !canEnableSonarrTaskToggles) {
        openIntegrationSetupDialog('sonarr');
        return;
      }
      setArrMonitoredIncludeSonarr(next);
      arrMonitoredSearchOptionsMutation.mutate(
        { includeSonarr: next },
        {
          onError: () => {
            setArrMonitoredIncludeSonarr(prev);
          },
        },
      );
    },
    [
      arrMonitoredIncludeSonarr,
      arrMonitoredSearchOptionsMutation,
      canEnableSonarrTaskToggles,
      openIntegrationSetupDialog,
    ],
  );
  const resolveDraftForJob = useCallback(
    (jobId: string, sourceDrafts: Record<string, ScheduleDraft>) => {
      const job = visibleJobs.find((entry) => entry.id === jobId);
      if (!job) return null;
      const draft = sourceDrafts[jobId];
      if (draft) return draft;
      const baseCron = job.schedule?.cron ?? job.defaultScheduleCron ?? '';
      const baseEnabled = job.schedule?.enabled ?? false;
      return defaultDraftFromCron({
        cron: baseCron,
        enabled: baseEnabled,
      });
    },
    [visibleJobs],
  );
  const handleFrequencySelect = useCallback(
    const validFrequencies = new Set(['daily', 'weekly', 'monthly']);
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const { jobId, frequency } = event.currentTarget.dataset;
      if (!jobId || !frequency || !validFrequencies.has(frequency)) return;
      setDrafts((prev) => {
        const draft = resolveDraftForJob(jobId, prev);
        if (!draft) return prev;
        return {
          ...prev,
          [jobId]: { ...draft, frequency },
        };
      });
    },
    [resolveDraftForJob],
  );
  const handleWeeklySelectorToggle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const jobId = event.currentTarget.dataset.jobId;
      if (!jobId) return;
      setWeeklyDaySelector((prev) => ({
        ...prev,
        [jobId]: !prev[jobId],
      }));
    },
    [],
  );
  const handleMonthlySelectorToggle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const jobId = event.currentTarget.dataset.jobId;
      if (!jobId) return;
      setMonthlyDaySelector((prev) => ({
        ...prev,
        [jobId]: !prev[jobId],
      }));
    },
    [],
  );
  const handleWeeklyDayChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { jobId, dayValue } = event.currentTarget.dataset;
      if (!jobId || !dayValue) return;
      const checked = event.currentTarget.checked;
      setDrafts((prev) => {
        const draft = resolveDraftForJob(jobId, prev);
        if (!draft) return prev;
        const alreadySelected = draft.daysOfWeek.includes(dayValue);
        const daysOfWeek = checked
          ? alreadySelected
            ? draft.daysOfWeek
            : [...draft.daysOfWeek, dayValue]
          : draft.daysOfWeek.filter((value) => value !== dayValue);
        return {
          ...prev,
          [jobId]: { ...draft, daysOfWeek },
        };
      });
    },
    [resolveDraftForJob],
  );
  const handleMonthlyDayToggle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const { jobId, dayValue } = event.currentTarget.dataset;
      if (!jobId || !dayValue) return;
      setDrafts((prev) => {
        const draft = resolveDraftForJob(jobId, prev);
        if (!draft) return prev;
        const isSelected = draft.daysOfMonth.includes(dayValue);
        const daysOfMonth = isSelected
          ? draft.daysOfMonth.filter((value) => value !== dayValue)
          : [...draft.daysOfMonth, dayValue];
        return {
          ...prev,
          [jobId]: { ...draft, daysOfMonth },
        };
      });
    },
    [resolveDraftForJob],
  );
  const handleTimePickerOpenChange = useCallback((jobId: string, open: boolean) => {
    setTimePickerOpen((prev) => ({ ...prev, [jobId]: open }));
  }, []);
  const handleDraftTimeChange = useCallback(
    (jobId: string, newTime: string) => {
      setDrafts((prev) => {
        const draft = resolveDraftForJob(jobId, prev);
        if (!draft) return prev;
        return {
          ...prev,
          [jobId]: { ...draft, time: newTime },
        };
      });
    },
    [resolveDraftForJob],
  );
  const handleTimePickerClose = useCallback((jobId: string) => {
    setTimePickerOpen((prev) => ({ ...prev, [jobId]: false }));
  }, []);
  const jobTimePickerOpenChangeHandlers = useMemo(() => {
    const handlers: Record<string, (open: boolean) => void> = {};
    for (const job of visibleJobs) {
      handlers[job.id] = (open: boolean) => {
        handleTimePickerOpenChange(job.id, open);
      };
    }
    return handlers;
  }, [handleTimePickerOpenChange, visibleJobs]);
  const jobTimeChangeHandlers = useMemo(() => {
    const handlers: Record<string, (newTime: string) => void> = {};
    for (const job of visibleJobs) {
      handlers[job.id] = (newTime: string) => {
        handleDraftTimeChange(job.id, newTime);
      };
    }
    return handlers;
  }, [handleDraftTimeChange, visibleJobs]);
  const jobTimePickerCloseHandlers = useMemo(() => {
    const handlers: Record<string, () => void> = {};
    for (const job of visibleJobs) {
      handlers[job.id] = () => {
        handleTimePickerClose(job.id);
      };
    }
    return handlers;
  }, [handleTimePickerClose, visibleJobs]);
  const handleNextRunsToggle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const jobId = event.currentTarget.dataset.jobId;
      if (!jobId) return;
      setNextRunsPopup((prev) => ({
        ...prev,
        [jobId]: !prev[jobId],
      }));
    },
    [],
  );
  const handleScheduleArrMonitoredSearchInstead = useCallback(() => {
    setImmaculateStartSearchDialogOpen(false);
    const arrJob = visibleJobs.find((job) => job.id === 'arrMonitoredSearch') ?? null;
    const baseCron = arrJob?.schedule?.cron ?? arrJob?.defaultScheduleCron ?? '0 4 * * 0';
    const defaultCron = baseCron || '0 4 * * 0';

    setExpandedCards((prev) => ({ ...prev, arrMonitoredSearch: true }));
    setDrafts((prev) => ({
      ...prev,
      arrMonitoredSearch: defaultDraftFromCron({
        cron: defaultCron,
        enabled: true,
      }),
    }));
    scheduleMutation.mutate({
      jobId: 'arrMonitoredSearch',
      cron: defaultCron,
      enabled: true,
    });

    setFlashJob({ jobId: 'arrMonitoredSearch', nonce: Date.now() });
    setTimeout(() => {
      const element = document.getElementById('job-arrMonitoredSearch');
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const target = window.scrollY + rect.top - window.innerHeight * 0.25;
      window.scrollTo({
        top: Math.max(0, Math.trunc(target)),
        behavior: 'smooth',
      });
    }, 50);
  }, [scheduleMutation, visibleJobs]);
  const handleConfirmRunImmediately = useCallback(() => {
    setImmaculateStartSearchDialogOpen(false);
    const prev = immaculateStartSearchImmediately;
    const next = true;
    setImmaculateStartSearchImmediately(next);
    immaculateStartSearchMutation.mutate(next, {
      onError: () => setImmaculateStartSearchImmediately(prev),
    });
  }, [immaculateStartSearchImmediately, immaculateStartSearchMutation]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 text-white font-sans selection:bg-[#facc15] selection:text-black select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Background (landing-page style, indigo-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/55 via-blue-900/65 to-slate-900/75" />
        <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
        <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
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
              <motion.button
                type="button"
                onClick={handleAnimateTitleIcon}
                animate={titleIconControls}
                className="relative group focus:outline-none touch-manipulation"
                aria-label="Animate Task Manager icon"
                title="Animate"
              >
                <motion.div
                  aria-hidden="true"
                  animate={titleIconGlowControls}
                  className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                />
                <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                <div className="relative p-3 md:p-4 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_30px_rgba(250,204,21,0.3)] border border-white/20 group-hover:rotate-0 transition-transform duration-300 ease-spring">
                  <TerminalIcon
                    className="w-8 h-8 md:w-10 md:h-10 text-black"
                    strokeWidth={2.5}
                  />
                </div>
              </motion.button>
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
            {/* skipcq: JS-R1005 - This renderer intentionally composes multiple job-specific states to keep behavior stable. */}
            {visibleJobs.map((job) => {
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

              const runUiState = runNowUi[job.id] ?? { phase: 'idle' as const };
              const runUiActive = runUiState.phase !== 'idle';
              const runUiProgressPct =
                ({ running: 80, finishing: 100, complete: 100 } as Record<string, number>)[runUiState.phase] ?? 0;
                    : 0;
              const runUiFillClass =
                runUiState.phase === 'complete'
                  ? runUiState.result === 'FAILED'
                    ? 'bg-red-500/90'
                    : 'bg-emerald-500/90'
                  : 'bg-[#facc15]/90';
              const runUiLabel =
                runUiState.phase === 'running'
                  ? 'Running…'
                  : runUiState.phase === 'finishing'
                    ? 'Finalizing…'
                    : runUiState.phase === 'complete'
                      ? runUiState.result === 'FAILED'
                        ? 'Failed'
                        : 'Complete'
                      : 'Run Now';
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
              const isTerminalFailed =
                terminalInfo?.status === 'completed' && terminalInfo.result === 'FAILED';

              const arrRequiredJobBlocked =
                (job.id === 'arrMonitoredSearch' || job.id === 'monitorConfirm') &&
                settingsQuery.status === 'success' &&
                (() => {
                  // Block if ARR is not available at all:
                  // - neither enabled/configured
                  // - OR both enabled services are unreachable (ping failed)
                  if (!isRadarrEnabled && !isSonarrEnabled) return true;
                  if (arrPing.loading || arrPing.checkedAtMs === null) return false;
                  const radarrOk = isRadarrEnabled && arrPing.radarrOk === true;
                  const sonarrOk = isSonarrEnabled && arrPing.sonarrOk === true;
                  return !radarrOk && !sonarrOk;
                })();
              const weeklyOpen = weeklyDaySelector[job.id] ?? false;
              const monthlyOpen = monthlyDaySelector[job.id] ?? false;
              const nextRunsOpen = nextRunsPopup[job.id] ?? false;
              const timePickerIsOpen = timePickerOpen[job.id] ?? false;
              const supportsSchedule = !UNSCHEDULABLE_JOB_IDS.has(job.id);
              const webhookEnabled =
                webhookAutoRun[job.id] ??
                (readBool(settingsQuery.data?.settings, `jobs.webhookEnabled.${job.id}`) ??
                  false);
              const iconPulseActive = cardIconPulse?.jobId === job.id;
              const isExpanded = expandedCards[job.id] ?? false;
              const mediaAddedCleanupAllDisabled =
                !mediaAddedCleanupDeleteDuplicates &&
                !mediaAddedCleanupUnmonitorInArr &&
                !mediaAddedCleanupRemoveFromWatchlist;
              const canExpand =
                (supportsSchedule && Boolean(job.schedule || job.defaultScheduleCron)) ||
                job.id === 'mediaAddedCleanup' ||
                job.id === 'immaculateTastePoints' ||
                job.id === 'watchedMovieRecommendations';
              const handleJobTimePickerOpenChange =
                jobTimePickerOpenChangeHandlers[job.id];
              const handleJobTimeChange = jobTimeChangeHandlers[job.id];
              const handleJobTimePickerClose = jobTimePickerCloseHandlers[job.id];

              return (
                <div
                  key={job.id}
                  id={`job-${job.id}`}
                  className="relative scroll-mt-24"
                  style={{
                    position: 'relative',
                    zIndex:
                      weeklyOpen || monthlyOpen || nextRunsOpen || timePickerIsOpen
                        ? 9999
                        : 'auto',
                  }}
                >
                  {/* Flash highlight (reference style): outer boxShadow pulses */}
                  <AnimatePresence initial={false}>
                    {flashJob?.jobId === job.id && (
                      <motion.div
                        key={`${flashJob.nonce}-glow`}
                        className="pointer-events-none absolute inset-0 rounded-[32px]"
                        initial={{ boxShadow: '0 0 0px rgba(250, 204, 21, 0)' }}
                        animate={{
                          boxShadow: [
                            '0 0 0px rgba(250, 204, 21, 0)',
                            '0 0 30px rgba(250, 204, 21, 0.5)',
                            '0 0 0px rgba(250, 204, 21, 0)',
                            '0 0 30px rgba(250, 204, 21, 0.5)',
                            '0 0 0px rgba(250, 204, 21, 0)',
                            '0 0 30px rgba(250, 204, 21, 0.5)',
                            '0 0 0px rgba(250, 204, 21, 0)',
                          ],
                        }}
                        exit={{ boxShadow: '0 0 0px rgba(250, 204, 21, 0)' }}
                        transition={{ duration: 3.8, ease: 'easeInOut' }}
                      />
                    )}
                  </AnimatePresence>

                  <motion.div
                    layout
                    aria-disabled={arrRequiredJobBlocked ? true : undefined}
                    data-job-id={job.id}
                    data-arr-required-blocked={arrRequiredJobBlocked ? 'true' : 'false'}
                    data-can-expand={canExpand ? 'true' : 'false'}
                    data-expanded={isExpanded ? 'true' : 'false'}
                    onPointerDownCapture={handleJobCardPointerDownCapture}
                    onClick={handleJobCardClick}
                    className={cn(
                      'group relative overflow-hidden rounded-[32px] bg-[#1a1625]/60 backdrop-blur-xl border border-white/5 transition-all duration-300 hover:bg-[#1a1625]/80 hover:shadow-2xl hover:shadow-purple-500/10 active:bg-[#1a1625]/85 active:shadow-2xl active:shadow-purple-500/15',
                      arrRequiredJobBlocked
                        ? 'opacity-60 grayscale hover:bg-[#1a1625]/60 active:bg-[#1a1625]/60 hover:shadow-none active:shadow-none'
                        : null,
                    )}
                  >
                    <div className="absolute top-0 right-0 p-32 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-500 blur-3xl rounded-full pointer-events-none -z-10" />
                    {arrRequiredJobBlocked ? (
                      <button
                        type="button"
                        data-no-card-toggle="true"
                        data-job-id={job.id}
                        onClick={handleOpenArrRequiresSetupForJob}
                        className="absolute inset-0 z-20 rounded-[32px] bg-transparent cursor-not-allowed"
                        aria-label="Enable Radarr or Sonarr in Vault to use this task"
                        title="Enable Radarr or Sonarr in Vault to use this task"
                      />
                    ) : null}

                    <div className="p-6 md:p-8 flex flex-wrap gap-4 items-start relative z-10">
                    {/* Icon Box */}
                    <div
                      className={cn(
                        'w-16 h-16 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0',
                        config.color
                      )}
                    >
                      <span
                        className={cn(
                          'transition-[filter] duration-300 will-change-[filter]',
                          'group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]',
                          iconPulseActive
                            ? 'drop-shadow-[0_0_18px_currentColor]'
                            : 'drop-shadow-none'
                        )}
                      >
                        {config.icon}
                      </span>
                    </div>

                    <div className="flex-1 space-y-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <h3 className="text-xl font-bold text-white tracking-tight leading-tight break-words sm:truncate min-w-0">
                            {job.name}
                          </h3>
                          <SavingPill
                            active={
                              (scheduleMutation.isPending &&
                                scheduleMutation.variables?.jobId === job.id) ||
                              (webhookAutoRunMutation.isPending &&
                                webhookAutoRunMutation.variables?.jobId === job.id) ||
                              (job.id === 'mediaAddedCleanup' &&
                                mediaAddedCleanupFeaturesMutation.isPending) ||
                              (job.id === 'immaculateTastePoints' &&
                                immaculateIncludeRefresherMutation.isPending)
                            }
                            className="static shrink-0 hidden md:inline-flex"
                          />
                        </div>
                      </div>
                      <p className="hidden sm:block text-gray-400 leading-relaxed font-medium text-sm md:text-base max-w-lg">
                        {config.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 self-end md:self-center w-full md:w-auto justify-between md:justify-end shrink-0 md:items-stretch">
                      {supportsSchedule ? (
                        <div className="flex flex-col items-center gap-2 md:self-center">
                          <div className="flex flex-col items-center gap-0.5 leading-none">
                            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                              Scheduled
                            </span>
                            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                              Auto-Run
                            </span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={draft.enabled}
                            data-job-id={job.id}
                            onClick={handleScheduleToggle}
                            disabled={
                              scheduleMutation.isPending &&
                              scheduleMutation.variables?.jobId === job.id
                            }
                            className={cn(
                              'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                              draft.enabled
                                ? 'bg-[#facc15]'
                                : 'bg-[#2a2438] border-2 border-white/10'
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
                      ) : (
                        <div className="flex flex-col items-center gap-2 md:self-center">
                          <div className="flex flex-col items-center gap-0.5 leading-none">
                            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                              Plex-Triggered
                            </span>
                            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                              Auto-Run
                            </span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={webhookEnabled}
                            data-job-id={job.id}
                            onClick={handleWebhookAutoRunToggle}
                            disabled={
                              settingsQuery.isLoading ||
                              (webhookAutoRunMutation.isPending &&
                                webhookAutoRunMutation.variables?.jobId === job.id)
                            }
                            className={cn(
                              'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                              webhookEnabled
                                ? 'bg-[#facc15]'
                                : 'bg-[#2a2438] border-2 border-white/10'
                            )}
                            aria-label={`Toggle webhook auto-run for ${job.name}`}
                          >
                            <span
                              className={cn(
                                'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                                webhookEnabled ? 'translate-x-6' : 'translate-x-1'
                              )}
                            />
                          </button>
                        </div>
                      )}

                      <div className="w-px h-10 bg-white/5 hidden md:block md:self-center" />

                      <div className="flex flex-col items-end gap-2 md:self-stretch md:justify-between">
                        <div className="flex gap-2">
                        <button
                          type="button"
                          data-run-id={terminalInfo?.runId ?? ''}
                          onClick={handleTerminalClick}
                          disabled={!isTerminalActive}
                          className={cn(
                            'w-12 h-12 rounded-full transition-all duration-200 active:scale-95 flex items-center justify-center',
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
                              <TerminalIcon
                                className={cn(
                                  'w-5 h-5',
                                  isTerminalFailed ? 'text-red-300' : 'text-emerald-400',
                                )}
                              />
                            )
                          ) : (
                            <TerminalIcon className="w-5 h-5" />
                          )}
                        </button>
                        <button
                          type="button"
                          data-job-id={job.id}
                          onClick={handleRunNow}
                          disabled={runMutation.isPending || runUiActive}
                          className={cn(
                            'h-12 w-32 rounded-full font-bold text-sm overflow-hidden relative',
                            'border border-white/10 bg-white/5 text-white shadow-[0_0_20px_rgba(250,204,21,0.18)]',
                            'transition-all duration-200 active:scale-95 hover:bg-white/10 hover:shadow-[0_0_28px_rgba(250,204,21,0.28)]',
                            'disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white/5 disabled:hover:shadow-[0_0_20px_rgba(250,204,21,0.18)]'
                          )}
                        >
                          {/* Progress fill (amber → 80%, hold; then to 100%; then green) */}
                          <AnimatePresence initial={false}>
                            {runUiActive && (
                              <motion.div
                                key="fill"
                                className={cn(
                                  'absolute inset-y-0 left-0 rounded-full',
                                  runUiFillClass,
                                )}
                                initial={{ width: 0 }}
                                animate={{ width: `${runUiProgressPct}%` }}
                                exit={{ opacity: 0 }}
                                transition={{
                                  duration: runUiState.phase === 'finishing' ? 0.55 : 0.9,
                                  ease: 'easeOut',
                                }}
                              />
                            )}
                          </AnimatePresence>

                          {/* Label */}
                          <div className="relative z-10 h-full w-full flex items-center justify-center">
                            <AnimatePresence mode="wait" initial={false}>
                              <motion.div
                                key={runUiLabel}
                                className="flex items-center justify-center"
                                initial={{ y: 10, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -10, opacity: 0 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                              >
                                {runUiState.phase === 'idle' ? (
                                  <Play className="w-4 h-4 mr-2 fill-current text-[#facc15]" />
                                ) : runUiState.phase === 'complete' ? (
                                  runUiState.result === 'FAILED' ? (
                                    <X className="w-4 h-4 mr-2 text-red-200" />
                                  ) : (
                                    <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-200" />
                                  )
                                ) : (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin text-black/70" />
                                )}
                                <span
                                  className={cn(
                                    'font-bold',
                                    runUiState.phase === 'idle'
                                      ? 'text-white'
                                      : runUiState.phase === 'complete'
                                        ? 'text-white'
                                        : 'text-black',
                                  )}
                                >
                                  {runUiLabel}
                                </span>
                              </motion.div>
                            </AnimatePresence>
                          </div>
                        </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Webhook/manual expansion (extra controls for webhook-only jobs) */}
                  {!supportsSchedule && (
                    <AnimatePresence initial={false}>
                      {isExpanded &&
                        (job.id === 'mediaAddedCleanup' ||
                          job.id === 'immaculateTastePoints' ||
                          job.id === 'watchedMovieRecommendations') && (
                          <motion.div
                            data-no-card-toggle="true"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{
                              type: 'spring',
                              stiffness: 200,
                              damping: 25,
                              mass: 0.8,
                            }}
                            className="overflow-hidden bg-[#0F0B15]/30 border-t border-white/5"
                          >
                            <div className="px-6 md:px-8 py-5">
                              <div className="flex flex-col gap-3">
                                {job.id === 'mediaAddedCleanup' ? (
                                  <div className="rounded-2xl bg-[#0F0B15]/35 border border-white/5 p-4">
                                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                      Cleanup actions
                                    </div>

                                    <div className="mt-3 flex flex-col gap-3">
                                      <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-white">
                                            Delete duplicate media
                                          </div>
                                          <div className="mt-1 text-xs text-white/55 leading-relaxed">
                                            Deduplicate recently downloaded movies and episodes.
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={mediaAddedCleanupDeleteDuplicates}
                                          onClick={handleToggleMediaAddedCleanupDeleteDuplicates}
                                          onPointerDown={handleStopPropagationPointer}
                                          disabled={
                                            settingsQuery.isLoading ||
                                            mediaAddedCleanupFeaturesMutation.isPending
                                          }
                                          className={cn(
                                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                            mediaAddedCleanupDeleteDuplicates
                                              ? 'bg-[#facc15]'
                                              : 'bg-[#2a2438] border-2 border-white/10',
                                          )}
                                          aria-label="Toggle duplicate deletion for cleanup after adding new content"
                                        >
                                          <span
                                            className={cn(
                                              'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                              mediaAddedCleanupDeleteDuplicates
                                                ? 'translate-x-6'
                                                : 'translate-x-1',
                                            )}
                                          >
                                            {mediaAddedCleanupFeaturesMutation.isPending && (
                                              <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                            )}
                                          </span>
                                        </button>
                                      </div>

                                      <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-white">
                                            Unmonitor recently downloaded media
                                          </div>
                                          <div className="mt-1 text-xs text-white/55 leading-relaxed">
                                            Enable ARR monitoring mutations for matched movies, episodes, and seasons.
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={mediaAddedCleanupUnmonitorInArr}
                                          onClick={handleToggleMediaAddedCleanupUnmonitorInArr}
                                          onPointerDown={handleStopPropagationPointer}
                                          disabled={
                                            settingsQuery.isLoading ||
                                            mediaAddedCleanupFeaturesMutation.isPending
                                          }
                                          className={cn(
                                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                            mediaAddedCleanupUnmonitorInArr
                                              ? 'bg-[#facc15]'
                                              : 'bg-[#2a2438] border-2 border-white/10',
                                          )}
                                          aria-label="Toggle ARR unmonitoring for cleanup after adding new content"
                                        >
                                          <span
                                            className={cn(
                                              'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                              mediaAddedCleanupUnmonitorInArr
                                                ? 'translate-x-6'
                                                : 'translate-x-1',
                                            )}
                                          >
                                            {mediaAddedCleanupFeaturesMutation.isPending && (
                                              <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                            )}
                                          </span>
                                        </button>
                                      </div>

                                      <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-white">
                                            Remove recently added media from watchlist
                                          </div>
                                          <div className="mt-1 text-xs text-white/55 leading-relaxed">
                                            Remove completed items from Plex watchlist reconciliation logic.
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={mediaAddedCleanupRemoveFromWatchlist}
                                          onClick={handleToggleMediaAddedCleanupRemoveFromWatchlist}
                                          onPointerDown={handleStopPropagationPointer}
                                          disabled={
                                            settingsQuery.isLoading ||
                                            mediaAddedCleanupFeaturesMutation.isPending
                                          }
                                          className={cn(
                                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                            mediaAddedCleanupRemoveFromWatchlist
                                              ? 'bg-[#facc15]'
                                              : 'bg-[#2a2438] border-2 border-white/10',
                                          )}
                                          aria-label="Toggle watchlist cleanup for cleanup after adding new content"
                                        >
                                          <span
                                            className={cn(
                                              'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                              mediaAddedCleanupRemoveFromWatchlist
                                                ? 'translate-x-6'
                                                : 'translate-x-1',
                                            )}
                                          >
                                            {mediaAddedCleanupFeaturesMutation.isPending && (
                                              <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                            )}
                                          </span>
                                        </button>
                                      </div>
                                    </div>

                                    {mediaAddedCleanupAllDisabled && (
                                      <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                                        All cleanup actions are disabled. Runs will complete as a no-op.
                                      </div>
                                    )}

                                    {mediaAddedCleanupFeaturesMutation.isError && (
                                      <div className="mt-3 flex items-center gap-2 text-sm text-red-300">
                                        <CircleAlert className="w-4 h-4" />
                                        {(mediaAddedCleanupFeaturesMutation.error as Error).message}
                                      </div>
                                    )}
                                  </div>
                                ) : job.id === 'immaculateTastePoints' ? (
                                  <>
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      aria-expanded={immaculateRefresherDetailsOpen}
                                      onClick={handleToggleImmaculateRefresherDetails}
                                      onKeyDown={handleImmaculateRefresherDetailsKeyDown}
                                      className="p-4 rounded-2xl bg-[#0F0B15]/35 border border-white/5 cursor-pointer select-none hover:bg-[#0F0B15]/45 transition-colors"
                                    >
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                                            <RotateCw className="w-3 h-3 text-yellow-300" />
                                            Immaculate Taste Refresher
                                          </div>

                                          <AnimatePresence initial={false}>
                                            {immaculateRefresherDetailsOpen && (
                                              <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{
                                                  type: 'spring',
                                                  stiffness: 240,
                                                  damping: 26,
                                                  mass: 0.85,
                                                }}
                                                className="overflow-hidden"
                                                onClick={handleStopPropagation}
                                              >
                                                <p className="mt-2 text-sm text-gray-400 leading-relaxed">
                                                  After updating points, automatically rebuild your{' '}
                                                  <span className="text-white/80 font-semibold">
                                                    Inspired by your Immaculate Taste
                                                  </span>{' '}
                                                  Plex collection.
                                                </p>
                                                <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                                                  If disabled, you can still{' '}
                                                  <a
                                                    href="#job-immaculateTasteRefresher"
                                                    onClick={handleScrollToImmaculateRefresher}
                                                    className="text-sky-200/90 underline underline-offset-4 hover:text-sky-100 transition-colors"
                                                  >
                                                    run/schedule the refresher from its own card
                                                  </a>{' '}
                                                  independently.
                                                </p>

                                                {immaculateIncludeRefresherMutation.isError && (
                                                  <div className="mt-3 flex items-center gap-2 text-sm text-red-300">
                                                    <CircleAlert className="w-4 h-4" />
                                                    {(immaculateIncludeRefresherMutation.error as Error)
                                                      .message}
                                                  </div>
                                                )}
                                              </motion.div>
                                            )}
                                          </AnimatePresence>
                                        </div>

                                        <div
                                          className="flex flex-col items-end gap-2 shrink-0"
                                          onClick={handleStopPropagation}
                                          onPointerDown={handleStopPropagationPointer}
                                        >
                                          <button
                                            type="button"
                                            role="switch"
                                            aria-checked={immaculateIncludeRefresherAfterUpdate}
                                            onClick={handleToggleImmaculateIncludeRefresher}
                                            onPointerDown={handleStopPropagationPointer}
                                            disabled={
                                              settingsQuery.isLoading ||
                                              immaculateIncludeRefresherMutation.isPending
                                            }
                                            className={cn(
                                              'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                              immaculateIncludeRefresherAfterUpdate
                                                ? 'bg-sky-400'
                                                : 'bg-[#2a2438] border-2 border-white/10',
                                            )}
                                            aria-label="Toggle Immaculate Taste Refresher after update"
                                          >
                                            <span
                                              className={cn(
                                                'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                                immaculateIncludeRefresherAfterUpdate
                                                  ? 'translate-x-6'
                                                  : 'translate-x-1',
                                              )}
                                            >
                                              {immaculateIncludeRefresherMutation.isPending && (
                                                <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                              )}
                                            </span>
                                          </button>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="rounded-2xl bg-[#0F0B15]/35 border border-white/5 p-4">
                                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        Fetch Missing items:
                                      </div>

                                      <div className="mt-3 flex flex-col sm:flex-row gap-3">
                                        <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                          <div className="min-w-0">
                                            <div className="text-sm font-semibold text-white">
                                              Radarr
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            role="switch"
                                            aria-checked={immaculateFetchMissingRadarr}
                                            onClick={handleToggleImmaculateFetchMissingRadarr}
                                            disabled={
                                              settingsQuery.isLoading ||
                                              fetchMissingMutation.isPending ||
                                              immaculateOverseerrMode ||
                                              immaculateOverseerrModePending
                                            }
                                            className={cn(
                                              'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                              immaculateFetchMissingRadarr
                                                ? 'bg-[#facc15]'
                                                : 'bg-[#2a2438] border-2 border-white/10',
                                            )}
                                            aria-label="Toggle Radarr fetch for Immaculate Taste Collection"
                                          >
                                            <span
                                              className={cn(
                                                'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                                immaculateFetchMissingRadarr
                                                  ? 'translate-x-6'
                                                  : 'translate-x-1',
                                              )}
                                            >
                                              {fetchMissingMutation.isPending && (
                                                <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                              )}
                                            </span>
                                          </button>
                                        </div>

                                        <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                          <div className="min-w-0">
                                            <div className="text-sm font-semibold text-white">
                                              Sonarr
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            role="switch"
                                            aria-checked={immaculateFetchMissingSonarr}
                                            onClick={handleToggleImmaculateFetchMissingSonarr}
                                            disabled={
                                              settingsQuery.isLoading ||
                                              fetchMissingMutation.isPending ||
                                              immaculateOverseerrMode ||
                                              immaculateOverseerrModePending
                                            }
                                            className={cn(
                                              'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                              immaculateFetchMissingSonarr
                                                ? 'bg-[#facc15]'
                                                : 'bg-[#2a2438] border-2 border-white/10',
                                            )}
                                            aria-label="Toggle Sonarr fetch for Immaculate Taste Collection"
                                          >
                                            <span
                                              className={cn(
                                                'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                                immaculateFetchMissingSonarr
                                                  ? 'translate-x-6'
                                                  : 'translate-x-1',
                                              )}
                                            >
                                              {fetchMissingMutation.isPending && (
                                                <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                              )}
                                            </span>
                                          </button>
                                        </div>
                                      </div>

                                      <div className="mt-3 flex items-start justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-white flex items-center gap-2">
                                            <Search className="w-4 h-4 text-fuchsia-300" />
                                            Start search immediately
                                          </div>
                                          <div className="mt-1 text-xs text-white/55 leading-relaxed">
                                            When enabled, Radarr/Sonarr will start searching as soon as this job adds missing titles.
                                          </div>
                                        </div>

                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={immaculateStartSearchImmediately}
                                          onClick={handleToggleImmaculateStartSearchImmediately}
                                          onPointerDown={handleStopPropagationPointer}
                                          disabled={
                                            settingsQuery.isLoading ||
                                            immaculateStartSearchMutation.isPending ||
                                            immaculateOverseerrMode ||
                                            immaculateOverseerrModePending
                                          }
                                          className={cn(
                                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                            immaculateStartSearchImmediately
                                              ? 'bg-fuchsia-400'
                                              : 'bg-[#2a2438] border-2 border-white/10',
                                          )}
                                          aria-label="Toggle immediate Radarr/Sonarr search for Immaculate Taste Collection"
                                        >
                                          <span
                                            className={cn(
                                              'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                              immaculateStartSearchImmediately
                                                ? 'translate-x-6'
                                                : 'translate-x-1',
                                            )}
                                          >
                                            {immaculateStartSearchMutation.isPending && (
                                              <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                            )}
                                          </span>
                                        </button>
                                      </div>

                                      {immaculateStartSearchMutation.isError && (
                                        <div className="mt-3 flex items-center gap-2 text-sm text-red-300">
                                          <CircleAlert className="w-4 h-4" />
                                          {(immaculateStartSearchMutation.error as Error).message}
                                        </div>
                                      )}
                                    </div>

                                    <div className="mt-3 rounded-2xl bg-[#0F0B15]/35 border border-white/5 p-4">
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-white">
                                            Approval required from Observatory
                                          </div>
                                          <div className="mt-1 text-xs text-white/55 leading-relaxed">
                                            When enabled, missing items won’t be sent to Radarr/Sonarr until you swipe right in Observatory.
                                          </div>
                                        </div>

                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={immaculateApprovalRequired}
                                          onClick={handleToggleImmaculateApprovalRequired}
                                          onPointerDown={handleStopPropagationPointer}
                                          disabled={
                                            settingsQuery.isLoading ||
                                            immaculateApprovalRequiredMutation.isPending ||
                                            immaculateOverseerrMode ||
                                            immaculateOverseerrModePending
                                          }
                                          className={cn(
                                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                            immaculateApprovalRequired
                                              ? 'bg-teal-400'
                                              : 'bg-[#2a2438] border-2 border-white/10',
                                          )}
                                          aria-label="Toggle Observatory approval for Immaculate Taste Collection"
                                        >
                                          <span
                                            className={cn(
                                              'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                              immaculateApprovalRequired
                                                ? 'translate-x-6'
                                                : 'translate-x-1',
                                            )}
                                          >
                                            {immaculateApprovalRequiredMutation.isPending && (
                                              <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                            )}
                                          </span>
                                        </button>
                                      </div>
                                    </div>

                                    <div className="mt-3 rounded-2xl bg-[#0F0B15]/35 border border-white/5 p-4">
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-white">
                                            Route missing items via Overseerr
                                          </div>
                                          <div className="mt-1 text-xs text-white/55 leading-relaxed">
                                            When enabled, new missing items are requested in Overseerr. Radarr/Sonarr direct send, immediate search, and Observatory approval are turned off for this task.
                                          </div>
                                        </div>

                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={immaculateFetchMissingOverseerr}
                                          onClick={handleToggleImmaculateOverseerrMode}
                                          onPointerDown={handleStopPropagationPointer}
                                          disabled={
                                            settingsQuery.isLoading ||
                                            immaculateOverseerrModePending
                                          }
                                          className={cn(
                                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                            immaculateFetchMissingOverseerr
                                              ? 'bg-cyan-400'
                                              : 'bg-[#2a2438] border-2 border-white/10',
                                          )}
                                          aria-label="Toggle Overseerr mode for Immaculate Taste Collection"
                                        >
                                          <span
                                            className={cn(
                                              'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                              immaculateFetchMissingOverseerr
                                                ? 'translate-x-6'
                                                : 'translate-x-1',
                                            )}
                                          >
                                            {immaculateOverseerrModePending && (
                                              <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                            )}
                                          </span>
                                        </button>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                  <div className="rounded-2xl bg-[#0F0B15]/35 border border-white/5 p-4">
                                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                      Fetch Missing items:
                                    </div>

                                    <div className="mt-3 flex flex-col sm:flex-row gap-3">
                                      <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-white">
                                            Radarr
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={watchedFetchMissingRadarr}
                                          onClick={handleToggleWatchedFetchMissingRadarr}
                                          disabled={
                                            settingsQuery.isLoading ||
                                            fetchMissingMutation.isPending ||
                                            watchedOverseerrMode ||
                                            watchedOverseerrModePending
                                          }
                                          className={cn(
                                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                            watchedFetchMissingRadarr
                                              ? 'bg-[#facc15]'
                                              : 'bg-[#2a2438] border-2 border-white/10',
                                          )}
                                          aria-label={`Toggle Radarr fetch for ${job.name}`}
                                        >
                                          <span
                                            className={cn(
                                              'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                              watchedFetchMissingRadarr
                                                ? 'translate-x-6'
                                                : 'translate-x-1',
                                            )}
                                          >
                                            {fetchMissingMutation.isPending && (
                                              <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                            )}
                                          </span>
                                        </button>
                                      </div>

                                      <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-white">
                                            Sonarr
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={watchedFetchMissingSonarr}
                                          onClick={handleToggleWatchedFetchMissingSonarr}
                                          disabled={
                                            settingsQuery.isLoading ||
                                            fetchMissingMutation.isPending ||
                                            watchedOverseerrMode ||
                                            watchedOverseerrModePending
                                          }
                                          className={cn(
                                            'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                            watchedFetchMissingSonarr
                                              ? 'bg-[#facc15]'
                                              : 'bg-[#2a2438] border-2 border-white/10',
                                          )}
                                          aria-label={`Toggle Sonarr fetch for ${job.name}`}
                                        >
                                          <span
                                            className={cn(
                                              'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                              watchedFetchMissingSonarr
                                                ? 'translate-x-6'
                                                : 'translate-x-1',
                                            )}
                                          >
                                            {fetchMissingMutation.isPending && (
                                              <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                            )}
                                          </span>
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="mt-3 rounded-2xl bg-[#0F0B15]/35 border border-white/5 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-white">
                                          Approval required from Observatory
                                        </div>
                                        <div className="mt-1 text-xs text-white/55 leading-relaxed">
                                          When enabled, missing items won’t be sent to Radarr/Sonarr until you swipe right in Observatory.
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        role="switch"
                                        aria-checked={watchedApprovalRequired}
                                        onClick={handleToggleWatchedApprovalRequired}
                                        onPointerDown={handleStopPropagationPointer}
                                        disabled={
                                          settingsQuery.isLoading ||
                                          watchedApprovalRequiredMutation.isPending ||
                                          watchedOverseerrMode ||
                                          watchedOverseerrModePending
                                        }
                                        className={cn(
                                          'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                          watchedApprovalRequired
                                            ? 'bg-teal-400'
                                            : 'bg-[#2a2438] border-2 border-white/10',
                                        )}
                                        aria-label="Toggle Observatory approval for Based on Latest Watched Collection"
                                      >
                                        <span
                                          className={cn(
                                            'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                            watchedApprovalRequired
                                              ? 'translate-x-6'
                                              : 'translate-x-1',
                                          )}
                                        >
                                          {watchedApprovalRequiredMutation.isPending && (
                                            <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                          )}
                                        </span>
                                      </button>
                                    </div>
                                  </div>

                                  <div className="mt-3 rounded-2xl bg-[#0F0B15]/35 border border-white/5 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-white">
                                          Route missing items via Overseerr
                                        </div>
                                        <div className="mt-1 text-xs text-white/55 leading-relaxed">
                                          When enabled, new missing items are requested in Overseerr. Radarr/Sonarr direct send and Observatory approval are turned off for this task.
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        role="switch"
                                        aria-checked={watchedFetchMissingOverseerr}
                                        onClick={handleToggleWatchedOverseerrMode}
                                        onPointerDown={handleStopPropagationPointer}
                                        disabled={
                                          settingsQuery.isLoading ||
                                          watchedOverseerrModePending
                                        }
                                        className={cn(
                                          'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                          watchedFetchMissingOverseerr
                                            ? 'bg-cyan-400'
                                            : 'bg-[#2a2438] border-2 border-white/10',
                                        )}
                                        aria-label="Toggle Overseerr mode for Based on Latest Watched Collection"
                                      >
                                        <span
                                          className={cn(
                                            'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                            watchedFetchMissingOverseerr
                                              ? 'translate-x-6'
                                              : 'translate-x-1',
                                          )}
                                        >
                                          {watchedOverseerrModePending && (
                                            <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                          )}
                                        </span>
                                      </button>
                                    </div>
                                  </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                    </AnimatePresence>
                  )}

                  {/* Scheduler Drawer */}
                  <AnimatePresence initial={false}>
                    {supportsSchedule && isExpanded && draft.enabled && (
                      <motion.div
                        data-no-card-toggle="true"
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
                            {job.id === 'arrMonitoredSearch' && (
                              <div className="rounded-2xl bg-[#0F0B15]/40 border border-white/5 p-4">
                                <div className="flex flex-col gap-3">
                                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                    Includes
                                  </div>

                                  <div className="flex flex-col sm:flex-row gap-3">
                                    <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-white">
                                          Radarr
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        role="switch"
                                        aria-checked={arrMonitoredIncludeRadarr}
                                        onClick={handleToggleArrMonitoredIncludeRadarr}
                                        disabled={
                                          settingsQuery.isLoading ||
                                          arrMonitoredSearchOptionsMutation.isPending
                                        }
                                        className={cn(
                                          'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                          arrMonitoredIncludeRadarr
                                            ? 'bg-[#facc15]'
                                            : 'bg-[#2a2438] border-2 border-white/10',
                                        )}
                                        aria-label="Toggle Radarr for Monitored Search"
                                      >
                                        <span
                                          className={cn(
                                            'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                            arrMonitoredIncludeRadarr
                                              ? 'translate-x-6'
                                              : 'translate-x-1',
                                          )}
                                        >
                                          {arrMonitoredSearchOptionsMutation.isPending && (
                                            <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                          )}
                                        </span>
                                      </button>
                                    </div>

                                    <div className="flex items-center justify-between gap-4 rounded-xl bg-[#1a1625]/60 border border-white/10 px-4 py-3">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-white">
                                          Sonarr
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        role="switch"
                                        aria-checked={arrMonitoredIncludeSonarr}
                                        onClick={handleToggleArrMonitoredIncludeSonarr}
                                        disabled={
                                          settingsQuery.isLoading ||
                                          arrMonitoredSearchOptionsMutation.isPending
                                        }
                                        className={cn(
                                          'relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95',
                                          arrMonitoredIncludeSonarr
                                            ? 'bg-[#facc15]'
                                            : 'bg-[#2a2438] border-2 border-white/10',
                                        )}
                                        aria-label="Toggle Sonarr for Monitored Search"
                                      >
                                        <span
                                          className={cn(
                                            'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition-transform',
                                            arrMonitoredIncludeSonarr
                                              ? 'translate-x-6'
                                              : 'translate-x-1',
                                          )}
                                        >
                                          {arrMonitoredSearchOptionsMutation.isPending && (
                                            <Loader2 className="h-3 w-3 animate-spin text-black/70" />
                                          )}
                                        </span>
                                      </button>
                                    </div>
                                  </div>

                                  <div className="text-xs text-white/50">
                                    If both are enabled, Sonarr starts 1 hour after the scheduled time.
                                  </div>

                                  {arrMonitoredSearchOptionsMutation.isError && (
                                    <div className="flex items-center gap-2 text-sm text-red-300">
                                      <CircleAlert className="w-4 h-4" />
                                      {(arrMonitoredSearchOptionsMutation.error as Error).message}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            <div className="flex flex-col md:flex-row gap-4 md:items-start">
                              {/* Frequency Selector */}
                              <div className="flex-1 min-w-[200px] h-[106px] flex flex-col">
                                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2 mb-2">
                                  <CalendarDays className="w-3 h-3" />
                                  Repeat
                                </div>
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
                                        data-job-id={job.id}
                                        data-frequency={freq}
                                        onClick={handleFrequencySelect}
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
                                      data-job-id={job.id}
                                      onClick={handleWeeklySelectorToggle}
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
                                          onClick={handleStopPropagation}
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
                                                  data-job-id={job.id}
                                                  data-day-value={day.value}
                                                  onChange={handleWeeklyDayChange}
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
                                      data-job-id={job.id}
                                      onClick={handleMonthlySelectorToggle}
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
                                          onClick={handleStopPropagation}
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
                                                    data-job-id={job.id}
                                                    data-day-value={day}
                                                    onClick={handleMonthlyDayToggle}
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
                                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2 mb-2">
                                  <Clock className="w-3 h-3" />
                                  Time
                                </div>
                                <Popover
                                  open={timePickerOpen[job.id]}
                                  onOpenChange={handleJobTimePickerOpenChange}
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
                                      onChange={handleJobTimeChange}
                                      onClose={handleJobTimePickerClose}
                                    />
                                  </PopoverContent>
                                </Popover>
                              </div>

                              <div className="w-px h-20 bg-white/5 hidden md:block self-center" />

                              {/* Next Run Info */}
                              <div className="relative z-50 flex-1 max-w-xs h-[106px] flex flex-col">
                                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2 mb-2">
                                  <Clock className="w-3 h-3" />
                                  Next Run
                                </div>
                                <button
                                  type="button"
                                  data-job-id={job.id}
                                  onClick={handleNextRunsToggle}
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
                                      onClick={handleStopPropagation}
                                      className="absolute top-full mt-2 right-0 bg-[#1a1625] border border-white/10 rounded-xl p-4 shadow-2xl z-[10000] min-w-[220px]"
                                    >
                                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                                        Next 5 Runs
                                      </div>
                                      <div className="space-y-2">
                                        {calculateNextRuns(draft, 5).map((run) => (
                                          <div
                                            key={run.toISOString()}
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
              </div>
              );
            })}
          </div>
        )}

        <div className="mt-12 text-center">
          <Link
            to="/rewind"
            className={`${APP_PRESSABLE_CLASS} inline-flex items-center gap-3 px-6 py-3 rounded-full hover:bg-white/5 active:bg-white/10 text-gray-400 hover:text-white transition-all border border-white/10 group`}
          >
            <Clock className="w-4 h-4 group-hover:text-[#facc15] transition-colors" />
            <span className="text-sm font-medium">View Execution History</span>
            <ChevronRight className="w-4 h-4 opacity-50 group-hover:translate-x-1 group-active:translate-x-1 transition-transform" />
          </Link>
        </div>
        </div>
      </section>

      {/* Immaculate Taste / Based on Latest Watched - Run Now Dialog */}
      <MovieSeedDialog
        isOpen={movieSeedDialogOpen}
        onExitComplete={handleMovieSeedExitComplete}
        onClose={closeMovieSeedDialog}
        jobId={movieSeedDialogJobId}
        onStopPropagation={handleStopPropagation}
      />
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeMovieSeedDialog}
                    className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="sm:col-span-1">
                    <div className="h-8 flex items-end">
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider leading-none whitespace-nowrap">
                        Media type
                      </div>
                    </div>
                    <select
                      value={movieSeedMediaType}
                      onChange={handleMovieSeedMediaTypeChange}
                      className="mt-2 h-12 w-full appearance-none bg-[#0F0B15]/60 border border-white/10 rounded-xl px-4 text-sm text-white leading-none focus:outline-none focus:ring-2 focus:ring-[#facc15]/50 focus:border-transparent transition"
                    >
                      <option value="movie">Movie</option>
                      <option value="tv">TV show</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <div className="h-8 flex items-end">
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider leading-none whitespace-nowrap">
                        Content title
                      </div>
                    </div>
                    <input
                      ref={movieSeedTitleRef}
                      value={movieSeedTitle}
                      onChange={handleMovieSeedTitleChange}
                      onKeyDown={handleMovieSeedTitleKeyDown}
                      placeholder={movieSeedMediaType === 'tv' ? 'Breaking Bad' : 'Inception'}
                      className="mt-2 h-12 w-full bg-[#0F0B15]/60 border border-white/10 rounded-xl px-4 text-sm text-white placeholder:text-white/35 leading-none focus:outline-none focus:ring-2 focus:ring-[#facc15]/50 focus:border-transparent transition"
                    />
                  </div>

                  <div className="sm:col-span-1">
                    <div className="h-8 flex items-end">
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider leading-none whitespace-nowrap">
                        Year (optional)
                      </div>
                    </div>
                    <input
                      value={movieSeedYear}
                      onChange={handleMovieSeedYearChange}
                      inputMode="numeric"
                      placeholder="2010"
                      className="mt-2 h-12 w-full bg-[#0F0B15]/60 border border-white/10 rounded-xl px-4 text-sm text-white placeholder:text-white/35 leading-none focus:outline-none focus:ring-2 focus:ring-[#facc15]/50 focus:border-transparent transition"
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
                    onClick={closeMovieSeedDialog}
                    className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitMovieSeedRun}
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
                        Run now
                      </>
                    )}
                  </button>
                </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Immaculate Taste - Immediate Search Confirmation */}
      <AnimatePresence>
        {immaculateStartSearchDialogOpen && (
          <motion.div
            className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeImmaculateStartSearchDialog}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              onClick={handleStopPropagation}
              className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-fuchsia-500/10 overflow-hidden"
            >
              <div className="p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                      Immaculate Taste Collection
                    </div>
                    <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                      Start search immediately?
                    </h2>
                    <p className="mt-2 text-sm text-white/70 leading-relaxed">
                      This will tell Radarr/Sonarr to start searching as soon as titles are added by
                      the Immaculate Taste job (after each watch event). If you prefer off-peak
                      execution, schedule the monitored search instead.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeImmaculateStartSearchDialog}
                    className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleScheduleArrMonitoredSearchInstead}
                    className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98]"
                  >
                    Schedule instead
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmRunImmediately}
                    className="h-12 rounded-full px-6 bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2"
                    disabled={immaculateStartSearchMutation.isPending}
                  >
                    {immaculateStartSearchMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        Run immediately
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={arrRequiresSetupOpen}
        onClose={handleCloseArrRequiresSetupDialog}
        onConfirm={handleConfirmArrRequiresSetupDialog}
        label="Setup required"
        title="Enable Radarr or Sonarr"
        description={
          <div className="space-y-2">
            <div className="text-white/85 font-semibold">
              The{' '}
              <span className="text-white">
                {arrRequiresSetupJobId === 'monitorConfirm'
                  ? 'Confirm Monitored'
                  : 'Search Monitored'}
              </span>{' '}
              task needs Radarr or Sonarr available to monitor content.
            </div>
            <div className="text-sm text-white/70">
              {(() => {
                const pingReady = !arrPing.loading && arrPing.checkedAtMs !== null;
                const radarrOk = isRadarrEnabled && arrPing.radarrOk === true;
                const sonarrOk = isSonarrEnabled && arrPing.sonarrOk === true;

                const noArrEnabled = !isRadarrEnabled && !isSonarrEnabled;
                const arrUnreachable =
                  pingReady && (isRadarrEnabled || isSonarrEnabled) && !radarrOk && !sonarrOk;

                if (arrUnreachable) {
                  return (
                    <>
                      Immaculaterr couldn’t reach Radarr or Sonarr. Check your URLs/API keys and networking in{' '}
                      <Link
                        to="/vault#vault-radarr"
                        className="underline underline-offset-4 decoration-white/30 hover:decoration-white/70 text-white"
                      >
                        Radarr
                      </Link>{' '}
                      /{' '}
                      <Link
                        to="/vault#vault-sonarr"
                        className="underline underline-offset-4 decoration-white/30 hover:decoration-white/70 text-white"
                      >
                        Sonarr
                      </Link>
                      .
                    </>
                  );
                }

                return (
                  <>
                    {noArrEnabled ? 'Enable and configure ' : 'Check configuration for '}
                    <Link
                      to="/vault#vault-radarr"
                      className="underline underline-offset-4 decoration-white/30 hover:decoration-white/70 text-white"
                    >
                      Radarr
                    </Link>{' '}
                    or{' '}
                    <Link
                      to="/vault#vault-sonarr"
                      className="underline underline-offset-4 decoration-white/30 hover:decoration-white/70 text-white"
                    >
                      Sonarr
                    </Link>{' '}
                    in the Vault.
                  </>
                );
              })()}
            </div>
            <div className="text-xs text-white/55">
              Tip: tap the Radarr/Sonarr links above to jump straight to the right Vault card.
            </div>
          </div>
        }
        confirmText="Open Vault"
        cancelText="Close"
        variant="primary"
      />

      <ConfirmDialog
        open={integrationSetupOpen}
        onClose={closeIntegrationSetupDialog}
        onConfirm={handleConfirmIntegrationSetupDialog}
        label="Setup required"
        title={
          integrationSetupMeta
            ? `Enable ${integrationSetupMeta.label}`
            : 'Enable Integration'
        }
        description={integrationSetupDescription}
        confirmText="Open Vault"
        cancelText="Close"
        variant="primary"
      />
    </div>
  );
}
