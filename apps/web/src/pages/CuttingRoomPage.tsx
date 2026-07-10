import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore,
  CircleAlert,
  Copy,
  Info,
  CircleCheck,
  Clapperboard,
  Database,
  HardDrive,
  History,
  Loader2,
  Recycle,
  Scissors,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  StopCircle,
  Tv,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  autoSelectCandidates,
  getCuttingRoomDiskspace,
  getCuttingRoomRules,
  getCuttingRoomSnapshot,
  listCuttingRoomCandidates,
  listCuttingRoomLibraries,
  listDuplicates,
  listLargeFiles,
  listPruneHistory,
  listWanted,
  patchCandidateSelection,
  putCuttingRoomRules,
  restorePrune,
  startCuttingRoomAnalyze,
  startCuttingRoomPrune,
  startDuplicateCleanup,
  startLargeFilesReplace,
  startWantedPrune,
  stopCuttingRoomPrune,
  type CuttingRoomCandidate,
  type CuttingRoomRules,
  type CuttingRoomSnapshot,
  type LargeFileItem,
} from '@/api/cutting-room';
import { listArrInstances } from '@/api/arr-instances';
import { getRun } from '@/api/jobs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FunCountSlider } from '@/components/FunCountSlider';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
  APP_PRESSABLE_CLASS,
} from '@/lib/ui-classes';
import { useSafeNavigate } from '@/lib/navigation';

// ---------------------------------------------------------------------------
// helpers

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB';
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '—';
}

const CARD_CLASS =
  'relative rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl overflow-hidden';

/**
 * Chip-style multi-tag input: type a tag and press Enter (or comma) to commit
 * it as a pill with a tiny ✕; Backspace on an empty input removes the last
 * pill. Values are trimmed, lowercased, and deduped.
 */
function TagPillInput(props: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const { value, onChange, placeholder, ariaLabel } = props;
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const additions = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && !value.includes(t));
    if (additions.length > 0) onChange([...value, ...additions]);
    setDraft('');
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 w-full rounded-xl bg-black/30 border border-white/15 px-2 py-1.5 focus-within:border-[#facc15]/50"
      onClick={(e) => {
        const input = (e.currentTarget as HTMLElement).querySelector('input');
        input?.focus();
      }}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-xs font-semibold text-white/85"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((t) => t !== tag));
            }}
            className="rounded-full p-0.5 text-white/50 hover:text-white hover:bg-white/15 transition"
            aria-label={`Remove tag ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const next = e.target.value;
          if (next.includes(',')) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        aria-label={ariaLabel}
        className="flex-1 min-w-[8rem] bg-transparent px-1 py-1 text-sm text-white placeholder:text-white/30 focus:outline-none"
      />
    </div>
  );
}

function FaqPill(props: { section: string; label: string }) {
  const navigate = useSafeNavigate();
  return (
    <button
      type="button"
      onClick={() => void navigate(`/faq#${props.section}`)}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold leading-none text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs"
      aria-label={`Open FAQ for ${props.label}`}
      title={`Open FAQ for ${props.label}`}
    >
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span className="max-[420px]:hidden">FAQ</span>
    </button>
  );
}

const TIER_LABELS: Record<number, { label: string; hint: string; chip: string }> = {
  1: {
    label: 'Tier 1',
    hint: 'never watched · long in library · strong signals',
    chip: 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25',
  },
  2: {
    label: 'Tier 2',
    hint: 'never watched · 6+ months',
    chip: 'bg-sky-500/15 text-sky-100 border-sky-500/25',
  },
  3: {
    label: 'Tier 3',
    hint: 'abandoned or recently added',
    chip: 'bg-amber-500/15 text-amber-100 border-amber-500/25',
  },
  4: {
    label: 'Tier 4',
    hint: 'watched long ago (rewatch risk)',
    chip: 'bg-rose-500/15 text-rose-100 border-rose-500/25',
  },
};

const BAR_LABELS: Record<number, string> = {
  1: 'Strictest — only Tier 1: never watched by anyone, 18+ months in your library, low rated or unmonitored.',
  2: 'Balanced — Tiers 1–2: everything never watched that has been around 6+ months.',
  3: 'Loose — Tiers 1–3: adds abandoned shows/movies and younger never-watched items.',
  4: 'Everything — Tiers 1–4: also items watched once, long ago. Highest regret risk.',
};

type WizardStep = 'factors' | 'scope' | 'scan' | 'tune' | 'review' | 'confirm';
const STEP_ORDER: WizardStep[] = [
  'factors',
  'scope',
  'scan',
  'tune',
  'review',
  'confirm',
];
const STEP_TITLES: Record<WizardStep, string> = {
  factors: 'Factors & protections',
  scope: 'What to inspect',
  scan: 'Scanning',
  tune: 'Set the bar & target',
  review: 'Review candidates',
  confirm: 'Confirm & prune',
};
const LF_STEP_TITLES: Record<WizardStep, string> = {
  factors: 'Factors & protections',
  scope: 'What to inspect',
  scan: 'Scanning file sizes',
  tune: 'Set the size bar & target',
  review: 'Review oversized files',
  confirm: 'Confirm & replace',
};
const LF_FLOOR_GB = 5;

function lfItemKey(item: LargeFileItem): string {
  return `${item.kind}|${item.path ?? item.plexRatingKey ?? `${item.title}:${item.sizeBytes}`}`;
}

function LargeFilesTable(props: {
  items: LargeFileItem[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { items, selectedKeys, onToggle } = props;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-white/60 text-xs uppercase">
          <tr>
            <th className="p-3 text-left w-10" />
            <th className="p-3 text-left">Title</th>
            <th className="p-3 text-left">Type</th>
            <th className="p-3 text-right">Size</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const key = lfItemKey(item);
            return (
              <tr key={key} className="border-t border-white/5">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(key)}
                    onChange={() => onToggle(key)}
                    className="h-4 w-4 accent-[#facc15]"
                    aria-label={`Select ${item.title}`}
                  />
                </td>
                <td
                  className="p-3 font-semibold text-white"
                  title={item.path ?? undefined}
                >
                  {item.kind === 'episode' && item.showTitle ? (
                    <>
                      {item.showTitle}
                      <span className="text-white/40">
                        {' '}
                        {item.seasonNumber !== null && item.episodeNumber !== null
                          ? `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')} · `
                          : '· '}
                      </span>
                      <span className="text-white/70">{item.title}</span>
                    </>
                  ) : (
                    item.title
                  )}
                </td>
                <td className="p-3 text-white/60">{item.kind}</td>
                <td className="p-3 text-right font-mono text-white/80">
                  {fmtBytes(item.sizeBytes)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type TabKey = 'wizard' | 'history' | 'wanted' | 'duplicates' | 'large-files';

// ---------------------------------------------------------------------------

export function CuttingRoomPage() {
  const location = useLocation();
  const initialTab: TabKey = location.pathname.endsWith('/history')
    ? 'history'
    : location.pathname.endsWith('/wanted')
      ? 'wanted'
      : location.pathname.endsWith('/duplicates')
        ? 'duplicates'
        : location.pathname.endsWith('/large-files')
          ? 'large-files'
          : 'wizard';
  const [tab, setTab] = useState<TabKey>(initialTab);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Background (landing-page style, amber-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-amber-400/25 via-purple-900/45 to-zinc-950/70" />
        <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
        <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
      </div>

      <div className="relative z-10 container mx-auto max-w-6xl px-4 py-10 md:py-14">
        <div className="mb-8 flex items-center gap-5">
          <div className="relative p-3 md:p-4 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_30px_rgba(250,204,21,0.3)] border border-white/20">
            <Scissors className="w-8 h-8 md:w-10 md:h-10 text-black" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter drop-shadow-2xl flex items-center gap-3">
              Cutting Room
              <span className="px-2 py-1 rounded-lg text-[11px] font-bold tracking-widest bg-[#facc15]/15 text-[#fde68a] border border-[#facc15]/25">
                BETA
              </span>
            </h1>
            <p className="text-purple-200/70 font-medium">
              Find and prune the media{' '}
              <span className="text-[#facc15] font-bold">nobody will ever watch</span>.
            </p>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {(
            [
              { key: 'wizard', label: 'Prune Wizard', icon: Sparkles },
              { key: 'history', label: 'Pruned History', icon: History },
              { key: 'wanted', label: 'Wanted List', icon: Database },
              { key: 'duplicates', label: 'Duplicates', icon: Copy },
              { key: 'large-files', label: 'Large Files', icon: HardDrive },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                APP_PRESSABLE_CLASS,
                'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition',
                tab === t.key
                  ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                  : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
              ].join(' ')}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
          <span className="self-center">
            <FaqPill section="cutting-room-overview" label="Cutting Room" />
          </span>
        </div>

        {tab === 'wizard' ? <PruneWizard /> : null}
        {tab === 'history' ? <PrunedHistoryTab /> : null}
        {tab === 'wanted' ? <WantedTab /> : null}
        {tab === 'duplicates' ? <DuplicatesTab /> : null}
        {tab === 'large-files' ? <LargeFilesTab /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard

function PruneWizard() {
  const queryClient = useQueryClient();
  const navigate = useSafeNavigate();

  const [step, setStep] = useState<WizardStep>('factors');
  const [mediaType, setMediaType] = useState<'movie' | 'show'>('movie');
  const [selectedSections, setSelectedSections] = useState<string[] | null>(null);
  const [selectedInstances, setSelectedInstances] = useState<string[] | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(() =>
    localStorage.getItem('cutting_room_snapshot_id'),
  );
  const [analyzeRunId, setAnalyzeRunId] = useState<string | null>(null);
  const [maxTier, setMaxTier] = useState(2);
  const [targetGb, setTargetGb] = useState(0);
  const [tautulliGateOpen, setTautulliGateOpen] = useState(false);

  // Large-file replacement mode (exclusive wizard factor)
  const [lfMode, setLfMode] = useState(false);
  const [lfScanParams, setLfScanParams] = useState<{
    mediaType: 'movie' | 'show';
    sectionKeys: string[];
    instanceIds: string[];
    nonce: number;
  } | null>(null);
  const [lfThresholdGb, setLfThresholdGb] = useState<number | null>(null);
  const [lfTargetGb, setLfTargetGb] = useState(0);
  const [lfSelectedKeys, setLfSelectedKeys] = useState<Set<string>>(new Set());

  const rulesQuery = useQuery({
    queryKey: ['cuttingRoom', 'rules'],
    queryFn: getCuttingRoomRules,
  });
  const rules = rulesQuery.data?.rules ?? null;
  const prereqs = rulesQuery.data?.prereqs ?? null;

  const stepIndex = STEP_ORDER.indexOf(step);
  const progressPct = ((stepIndex + 1) / STEP_ORDER.length) * 100;

  const persistSnapshot = useCallback((id: string | null) => {
    setSnapshotId(id);
    if (id) localStorage.setItem('cutting_room_snapshot_id', id);
    else localStorage.removeItem('cutting_room_snapshot_id');
  }, []);

  // ---- data for steps ----
  const librariesQuery = useQuery({
    queryKey: ['cuttingRoom', 'libraries', mediaType],
    queryFn: () => listCuttingRoomLibraries(mediaType),
    enabled: step === 'scope',
  });
  const instancesQuery = useQuery({
    queryKey: ['arr-instances', mediaType],
    queryFn: () =>
      listArrInstances(mediaType === 'movie' ? 'radarr' : 'sonarr'),
    enabled: step === 'scope',
  });

  const libraries = librariesQuery.data?.libraries ?? [];
  const instances = (instancesQuery.data?.instances ?? []).filter(
    (i) => i.enabled,
  );
  const effectiveSections = selectedSections ?? libraries.map((l) => l.key);
  const effectiveInstances = selectedInstances ?? instances.map((i) => i.id);

  const snapshotQuery = useQuery({
    queryKey: ['cuttingRoom', 'snapshot', snapshotId],
    queryFn: () => getCuttingRoomSnapshot(snapshotId as string),
    enabled: Boolean(snapshotId),
    refetchInterval: (query) => {
      const status = query.state.data?.snapshot.status;
      return status === 'RUNNING' || status === 'PENDING' || status === 'PRUNING'
        ? 2000
        : false;
    },
  });
  const snapshot = snapshotQuery.data?.snapshot ?? null;

  const analyzeRunQuery = useQuery({
    queryKey: ['cuttingRoom', 'analyzeRun', analyzeRunId],
    queryFn: () => getRun(analyzeRunId as string),
    enabled: Boolean(analyzeRunId) && step === 'scan',
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const analyzeRun = analyzeRunQuery.data?.run ?? null;

  const lfScanQuery = useQuery({
    queryKey: ['cuttingRoom', 'lfScan', lfScanParams],
    queryFn: () =>
      listLargeFiles(LF_FLOOR_GB, {
        mediaType: lfScanParams?.mediaType,
        sectionKeys: lfScanParams?.sectionKeys,
        instanceIds: lfScanParams?.instanceIds,
      }),
    enabled: lfMode && Boolean(lfScanParams),
    staleTime: Infinity,
  });
  const lfItems = useMemo(
    () => lfScanQuery.data?.items ?? [],
    [lfScanQuery.data?.items],
  );
  const effectiveLfThreshold =
    lfThresholdGb ?? rules?.largeFilesThresholdGb ?? 10;

  useEffect(() => {
    if (!lfMode || step !== 'scan') return;
    if (!lfScanQuery.data && !lfScanQuery.error) return;
    // Defer the step transition out of the effect's commit phase
    // (react-hooks/set-state-in-effect); cleanup keeps it StrictMode-safe.
    const timer = setTimeout(() => {
      if (lfScanQuery.data) {
        setStep('tune');
      } else if (lfScanQuery.error) {
        toast.error((lfScanQuery.error as Error).message);
        setStep('scope');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [lfMode, step, lfScanQuery.data, lfScanQuery.error]);

  useEffect(() => {
    if (lfMode || step !== 'scan') return;
    const status = snapshot?.status;
    if (status !== 'READY' && status !== 'FAILED') return;
    // Defer the step transition out of the effect's commit phase
    // (react-hooks/set-state-in-effect); cleanup keeps it StrictMode-safe.
    const timer = setTimeout(() => {
      if (status === 'READY') {
        setStep('tune');
        void queryClient.invalidateQueries({ queryKey: ['cuttingRoom'] });
      } else {
        toast.error(snapshot?.errorMessage ?? 'Scan failed');
        setStep('scope');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [lfMode, snapshot?.status, snapshot?.errorMessage, step, queryClient]);

  // ---- mutations ----
  const saveRules = useMutation({
    mutationFn: (patch: Partial<CuttingRoomRules>) => putCuttingRoomRules(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'rules'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const startScan = useMutation({
    mutationFn: () =>
      startCuttingRoomAnalyze({
        mediaType,
        sectionKeys: effectiveSections,
        instanceIds: effectiveInstances,
      }),
    onSuccess: (data) => {
      persistSnapshot(data.snapshotId);
      setAnalyzeRunId(data.run.id);
      setStep('scan');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const handleScanClick = () => {
    if (effectiveSections.length === 0) {
      toast.error('Select at least one Plex library');
      return;
    }
    if (lfMode) {
      // File sizes come straight from Radarr/Plex — no watch history needed,
      // so the Tautulli gate does not apply here.
      setLfSelectedKeys(new Set());
      setLfTargetGb(0);
      setLfScanParams((prev) => ({
        mediaType,
        sectionKeys: effectiveSections,
        instanceIds: effectiveInstances,
        // Monotonic counter so re-scanning with identical params still
        // produces a fresh query key.
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      setStep('scan');
      return;
    }
    if (prereqs && !prereqs.tautulli.configured) {
      setTautulliGateOpen(true);
      return;
    }
    startScan.mutate();
  };

  // ---- render ----
  if (rulesQuery.isLoading) {
    return (
      <div className={`${CARD_CLASS} p-6 flex items-center gap-2 text-white/70`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (rulesQuery.error) {
    return (
      <div className={`${CARD_CLASS} p-6 flex items-start gap-2 text-red-200`}>
        <CircleAlert className="mt-0.5 h-4 w-4" />
        <div>{(rulesQuery.error as Error).message}</div>
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      {/* step header */}
      <div className="p-4 md:p-5 border-b border-white/10">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-bold text-white/80">
            Step {stepIndex + 1} of {STEP_ORDER.length} ·{' '}
            <span className="text-[#facc15]">
              {(lfMode ? LF_STEP_TITLES : STEP_TITLES)[step]}
            </span>
          </div>
          {!lfMode && snapshot && step !== 'factors' && step !== 'scope' ? (
            <div className="text-xs text-white/50">
              scan from {new Date(snapshot.createdAt).toLocaleString()} ·{' '}
              {snapshot.mediaType === 'movie' ? 'movies' : 'shows'}
            </div>
          ) : null}
          {lfMode && lfScanQuery.data && step !== 'factors' && step !== 'scope' ? (
            <div className="text-xs text-white/50">
              {lfScanQuery.data.total} files ≥ {LF_FLOOR_GB} GB found ·{' '}
              {lfScanParams?.mediaType === 'movie' ? 'movies' : 'episodes'}
            </div>
          ) : null}
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[#facc15] transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="p-4 md:p-6">
        {step === 'factors' && rules ? (
          <FactorsStep
            rules={rules}
            saving={saveRules.isPending}
            onSave={(patch) => saveRules.mutate(patch)}
            onNext={(largeFiles) => {
              setLfMode(largeFiles);
              setStep('scope');
            }}
          />
        ) : null}

        {step === 'scope' ? (
          <ScopeStep
            mediaType={mediaType}
            setMediaType={(m) => {
              setMediaType(m);
              setSelectedSections(null);
              setSelectedInstances(null);
            }}
            libraries={libraries}
            librariesLoading={librariesQuery.isLoading}
            selectedSections={effectiveSections}
            toggleSection={(key) =>
              setSelectedSections(
                effectiveSections.includes(key)
                  ? effectiveSections.filter((k) => k !== key)
                  : [...effectiveSections, key],
              )
            }
            instances={instances.map((i) => ({ id: i.id, name: i.name }))}
            selectedInstances={effectiveInstances}
            toggleInstance={(id) =>
              setSelectedInstances(
                effectiveInstances.includes(id)
                  ? effectiveInstances.filter((k) => k !== id)
                  : [...effectiveInstances, id],
              )
            }
            scanning={startScan.isPending}
            onBack={() => setStep('factors')}
            onScan={handleScanClick}
          />
        ) : null}

        {step === 'scan' && !lfMode ? (
          <ScanStep
            run={analyzeRun}
            snapshotStatus={snapshot?.status ?? 'PENDING'}
            onCancelBack={() => setStep('scope')}
          />
        ) : null}

        {step === 'scan' && lfMode ? (
          <div className="py-10 flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-[#facc15]" />
            <div className="text-lg font-bold text-white">
              Measuring file sizes…
            </div>
            <div className="text-sm text-white/60 max-w-md">
              Reading every{' '}
              {lfScanParams?.mediaType === 'movie'
                ? 'movie file from Radarr'
                : 'episode file from Plex'}{' '}
              and keeping anything over {LF_FLOOR_GB} GB — you set the exact
              bar next.
            </div>
            <button
              type="button"
              onClick={() => setStep('scope')}
              className={`${APP_PRESSABLE_CLASS} mt-4 px-4 py-2 rounded-xl bg-white/10 text-white/70 text-sm font-semibold border border-white/10`}
            >
              Back
            </button>
          </div>
        ) : null}

        {step === 'tune' && !lfMode && snapshot ? (
          <TuneStep
            snapshot={snapshot}
            mediaType={mediaType}
            maxTier={maxTier}
            setMaxTier={setMaxTier}
            targetGb={targetGb}
            setTargetGb={setTargetGb}
            onBack={() => setStep('scope')}
            onNext={() => setStep('review')}
          />
        ) : null}

        {step === 'review' && !lfMode && snapshot ? (
          <ReviewStep
            snapshot={snapshot}
            maxTier={maxTier}
            onBack={() => setStep('tune')}
            onNext={() => setStep('confirm')}
          />
        ) : null}

        {step === 'confirm' && !lfMode && snapshot ? (
          <ConfirmStep
            snapshot={snapshot}
            mediaType={mediaType}
            onBack={() => setStep('review')}
            onDone={() => {
              persistSnapshot(null);
              setStep('factors');
              void queryClient.invalidateQueries({ queryKey: ['cuttingRoom'] });
            }}
          />
        ) : null}

        {step === 'tune' && lfMode ? (
          <LargeFilesTuneStep
            items={lfItems}
            loadedFloorGb={LF_FLOOR_GB}
            thresholdGb={effectiveLfThreshold}
            setThresholdGb={setLfThresholdGb}
            targetGb={lfTargetGb}
            setTargetGb={setLfTargetGb}
            selectedKeys={lfSelectedKeys}
            setSelectedKeys={setLfSelectedKeys}
            onBack={() => setStep('scope')}
            onNext={() => {
              saveRules.mutate({ largeFilesThresholdGb: effectiveLfThreshold });
              setStep('review');
            }}
          />
        ) : null}

        {step === 'review' && lfMode ? (
          <LargeFilesReviewStep
            items={lfItems.filter(
              (item) => item.sizeBytes >= effectiveLfThreshold * 1e9,
            )}
            selectedKeys={lfSelectedKeys}
            setSelectedKeys={setLfSelectedKeys}
            onBack={() => setStep('tune')}
            onNext={() => setStep('confirm')}
          />
        ) : null}

        {step === 'confirm' && lfMode ? (
          <LargeFilesConfirmStep
            items={lfItems.filter(
              (item) =>
                item.sizeBytes >= effectiveLfThreshold * 1e9 &&
                lfSelectedKeys.has(lfItemKey(item)),
            )}
            onBack={() => setStep('review')}
            onDone={() => {
              setLfScanParams(null);
              setLfSelectedKeys(new Set());
              setLfTargetGb(0);
              setStep('factors');
              void queryClient.invalidateQueries({ queryKey: ['cuttingRoom'] });
            }}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={tautulliGateOpen}
        onClose={() => setTautulliGateOpen(false)}
        onConfirm={() => {
          setTautulliGateOpen(false);
          navigate('/vault');
        }}
        onCancel={
          prereqs?.tautulli.required
            ? undefined
            : () => {
                setTautulliGateOpen(false);
                startScan.mutate();
              }
        }
        title="Connect Tautulli for full accuracy"
        label="Tautulli"
        variant="primary"
        description={
          <span>
            Tautulli records every play by every user, which makes
            &ldquo;never watched&rdquo; decisions much more reliable. Add your
            Tautulli URL and API key in the Vault, then come back and scan.
            {!prereqs?.tautulli.required ? (
              <>
                {' '}
                You can also continue with Plex data only — watch history will
                be limited to what Plex itself recorded.
              </>
            ) : null}
          </span>
        }
        confirmText="Open Vault"
        cancelText={
          prereqs?.tautulli.required ? 'Cancel' : 'Continue with Plex data only'
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function FactorsStep(props: {
  rules: CuttingRoomRules;
  saving: boolean;
  onSave: (patch: Partial<CuttingRoomRules>) => void;
  onNext: (largeFilesMode: boolean) => void;
}) {
  const { rules, saving, onSave, onNext } = props;
  const [factors, setFactors] = useState(rules.factors);
  const [recency, setRecency] = useState(rules.recencyWindowDays);
  const [grace, setGrace] = useState(rules.graceDays);
  const [protectedTags, setProtectedTags] = useState<string[]>(
    rules.protectedTagLabels,
  );
  const [showProtections, setShowProtections] = useState(false);

  const FACTOR_CARDS: Array<{
    key: keyof CuttingRoomRules['factors'];
    title: string;
    hint: string;
  }> = [
    {
      key: 'lowRating',
      title: 'Low ratings',
      hint: 'Genuinely bad ratings only — popular and highly-regarded titles are exempt',
    },
    {
      key: 'provenanceTags',
      title: 'Who wanted it',
      hint: 'Guest requests and bulk list-imports nobody played',
    },
    {
      key: 'unmonitored',
      title: 'Unmonitored',
      hint: 'You already stopped monitoring it in Radarr/Sonarr',
    },
    {
      key: 'endedShow',
      title: 'Ended shows',
      hint: 'Show finished airing and nobody ever started it',
    },
    {
      key: 'abandoned',
      title: 'Abandoned',
      hint: 'Started, watched under 25%, untouched for a year',
    },
    {
      key: 'watchedLongAgo',
      title: 'Watched long ago',
      hint: 'Fully watched 18+ months ago — rewatch risk, off by default',
    },
    {
      key: 'largeFiles',
      title: 'Oversized files',
      hint: 'Replace files over a size limit with smaller copies — nothing leaves your library. Runs on its own.',
    },
  ];

  const toggleFactor = (key: keyof CuttingRoomRules['factors']) => {
    setFactors((f) => {
      // Oversized files is a replacement flow, not a prune signal — it always
      // runs alone, so selecting it clears the others and vice versa.
      if (key === 'largeFiles') {
        const next = { ...f };
        for (const k of Object.keys(next) as Array<keyof typeof next>) {
          next[k] = false;
        }
        next.largeFiles = !f.largeFiles;
        return next;
      }
      return { ...f, [key]: !f[key], largeFiles: false };
    });
  };

  const handleNext = () => {
    onSave({
      factors,
      recencyWindowDays: recency,
      graceDays: grace,
      protectedTagLabels: protectedTags,
    });
    onNext(factors.largeFiles);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-white/70">
          Pick which signals count toward &ldquo;nobody will ever watch
          this&rdquo;. Never-watched time in your library is always the core
          signal.
        </p>
        <FaqPill section="cutting-room-factor-core" label="scoring factors" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FACTOR_CARDS.map((card) => {
          const active = factors[card.key];
          const dimmed = factors.largeFiles && card.key !== 'largeFiles';
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => toggleFactor(card.key)}
              className={[
                APP_PRESSABLE_CLASS,
                'text-left p-4 rounded-2xl border transition',
                active
                  ? 'bg-[#facc15]/10 border-[#facc15]/30'
                  : 'bg-white/5 border-white/10 hover:bg-white/10',
                dimmed ? 'opacity-40' : '',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <div className="font-bold text-white">{card.title}</div>
                {active ? (
                  <CircleCheck className="h-5 w-5 text-[#facc15]" />
                ) : (
                  <div className="h-5 w-5 rounded-full border border-white/25" />
                )}
              </div>
              <div className="text-xs text-white/60 mt-1">{card.hint}</div>
            </button>
          );
        })}
      </div>

      {factors.largeFiles ? (
        <div className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4 flex items-start gap-3">
          <HardDrive className="h-5 w-5 mt-0.5 text-sky-300" />
          <div className="text-sm text-white/75">
            <span className="font-bold text-white">Replacement mode.</span>{' '}
            Oversized files are deleted, re-monitored, tagged{' '}
            <code className="text-[#fde68a]">size-reduction</code>, switched to
            a size-capped quality profile (movies ~10 GB max, episodes 3 GB max
            preferring 1–2 GB), and re-searched so smaller copies download
            automatically. Nothing leaves your library, so prune factors and
            protection rules don&apos;t apply.
          </div>
        </div>
      ) : (
      <div className="rounded-2xl border border-white/10 bg-white/5">
        <button
          type="button"
          onClick={() => setShowProtections((v) => !v)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-2 font-bold text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            Protection rules
          </div>
          <span className="text-xs text-white/50">
            {showProtections ? 'hide' : 'show'}
          </span>
        </button>
        {showProtections ? (
          <div className="p-4 pt-0 space-y-5">
            <p className="text-xs text-white/60">
              Always protected: anything watched recently, anything on a
              watchlist or in continue-watching, recent requests, items in
              Immaculaterr&rsquo;s own collections, and libraries you deselect
              in the next step.
            </p>
            <div>
              <div className="flex items-center justify-between text-sm text-white/80 mb-2">
                <span>Watched within the last</span>
                <span className="font-bold text-[#facc15]">{recency} days</span>
              </div>
              <FunCountSlider
                value={recency}
                min={30}
                max={1095}
                onValueChange={setRecency}
                onValueCommit={setRecency}
                aria-label="Watched recency window"
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-sm text-white/80 mb-2">
                <span>Ignore items added in the last</span>
                <span className="font-bold text-[#facc15]">{grace} days</span>
              </div>
              <FunCountSlider
                value={grace}
                min={7}
                max={365}
                onValueChange={setGrace}
                onValueCommit={setGrace}
                aria-label="New item grace period"
              />
            </div>
            <div>
              <label className="text-sm text-white/80 block mb-2">
                Protected Radarr/Sonarr tags — type a tag and press Enter to
                add it. Items carrying any of these tags are never pruned.
              </label>
              <TagPillInput
                value={protectedTags}
                onChange={setProtectedTags}
                placeholder="type a tag and press Enter…"
                ariaLabel="Protected tags"
              />
            </div>
          </div>
        ) : null}
      </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={handleNext}
          className={`${APP_PRESSABLE_CLASS} px-5 py-2.5 rounded-xl bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)]`}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ScopeStep(props: {
  mediaType: 'movie' | 'show';
  setMediaType: (m: 'movie' | 'show') => void;
  libraries: Array<{ key: string; title: string }>;
  librariesLoading: boolean;
  selectedSections: string[];
  toggleSection: (key: string) => void;
  instances: Array<{ id: string; name: string }>;
  selectedInstances: string[];
  toggleInstance: (id: string) => void;
  scanning: boolean;
  onBack: () => void;
  onScan: () => void;
}) {
  const {
    mediaType,
    setMediaType,
    libraries,
    librariesLoading,
    selectedSections,
    toggleSection,
    instances,
    selectedInstances,
    toggleInstance,
    scanning,
    onBack,
    onScan,
  } = props;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { key: 'movie', label: 'Movies', icon: Clapperboard },
            { key: 'show', label: 'TV Shows', icon: Tv },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMediaType(m.key)}
            className={[
              APP_PRESSABLE_CLASS,
              'p-5 rounded-2xl border flex items-center gap-3 transition',
              mediaType === m.key
                ? 'bg-[#facc15]/10 border-[#facc15]/30'
                : 'bg-white/5 border-white/10 hover:bg-white/10',
            ].join(' ')}
          >
            <m.icon
              className={`h-7 w-7 ${mediaType === m.key ? 'text-[#facc15]' : 'text-white/60'}`}
            />
            <span className="font-bold text-white">{m.label}</span>
          </button>
        ))}
      </div>

      <div>
        <div className="text-sm font-bold text-white/80 mb-2">
          Plex libraries to inspect{' '}
          <span className="text-white/40 font-normal">
            (all selected by default — untick any to leave alone)
          </span>
        </div>
        {librariesLoading ? (
          <div className="flex items-center gap-2 text-sm text-white/60 p-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading libraries…
          </div>
        ) : libraries.length === 0 ? (
          <div className="text-sm text-white/50 p-2">
            No {mediaType} libraries found in Plex.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {libraries.map((lib) => {
              const checked = selectedSections.includes(lib.key);
              return (
                <label
                  key={lib.key}
                  className={[
                    'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition',
                    checked
                      ? 'bg-white/10 border-white/20'
                      : 'bg-white/5 border-white/10 opacity-60',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSection(lib.key)}
                    className="h-4 w-4 accent-[#facc15]"
                  />
                  <span className="text-sm text-white font-medium">
                    {lib.title}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {instances.length > 1 ? (
        <div>
          <div className="text-sm font-bold text-white/80 mb-2">
            {mediaType === 'movie' ? 'Radarr' : 'Sonarr'} instances
          </div>
          <div className="flex flex-wrap gap-2">
            {instances.map((inst) => {
              const checked = selectedInstances.includes(inst.id);
              return (
                <button
                  key={inst.id}
                  type="button"
                  onClick={() => toggleInstance(inst.id)}
                  className={[
                    APP_PRESSABLE_CLASS,
                    'px-3 py-1.5 rounded-full text-xs font-semibold border',
                    checked
                      ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                      : 'bg-white/5 text-white/50 border-white/10',
                  ].join(' ')}
                >
                  {inst.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 font-semibold border border-white/10`}
        >
          Back
        </button>
        <button
          type="button"
          disabled={scanning || selectedSections.length === 0}
          onClick={onScan}
          className={`${APP_PRESSABLE_CLASS} px-5 py-2.5 rounded-xl bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] disabled:opacity-50`}
        >
          {scanning ? 'Starting…' : 'Scan libraries'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ScanStep(props: {
  run: { status: string; summary: unknown } | null;
  snapshotStatus: string;
  onCancelBack: () => void;
}) {
  const { run, snapshotStatus, onCancelBack } = props;
  const progress = useMemo(() => {
    const summary = run?.summary as
      | { progress?: { message?: string; current?: number; total?: number } }
      | null
      | undefined;
    return summary?.progress ?? null;
  }, [run?.summary]);

  const pct =
    progress?.current && progress?.total
      ? Math.min(100, (progress.current / progress.total) * 100)
      : null;

  return (
    <div className="py-10 flex flex-col items-center gap-4 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-[#facc15]" />
      <div className="text-lg font-bold text-white">
        Scanning your libraries…
      </div>
      <div className="text-sm text-white/60 max-w-md">
        {progress?.message ??
          (snapshotStatus === 'PENDING'
            ? 'Waiting in the job queue…'
            : 'Collecting Plex, Radarr/Sonarr, and watch history…')}
      </div>
      {pct !== null ? (
        <div className="w-full max-w-md h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[#facc15] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={onCancelBack}
        className={`${APP_PRESSABLE_CLASS} mt-4 px-4 py-2 rounded-xl bg-white/10 text-white/70 text-sm font-semibold border border-white/10`}
      >
        Back
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TuneStep(props: {
  snapshot: CuttingRoomSnapshot;
  mediaType: 'movie' | 'show';
  maxTier: number;
  setMaxTier: (n: number) => void;
  targetGb: number;
  setTargetGb: (n: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const {
    snapshot,
    mediaType,
    maxTier,
    setMaxTier,
    targetGb,
    setTargetGb,
    onBack,
    onNext,
  } = props;
  const queryClient = useQueryClient();

  const matching = useMemo(() => {
    let count = 0;
    let bytes = 0;
    for (const [tier, agg] of Object.entries(snapshot.tiers)) {
      if (Number(tier) <= maxTier) {
        count += agg.count;
        bytes += agg.bytes;
      }
    }
    return { count, bytes };
  }, [snapshot.tiers, maxTier]);

  const diskQuery = useQuery({
    queryKey: ['cuttingRoom', 'diskspace', mediaType],
    queryFn: () =>
      getCuttingRoomDiskspace(mediaType === 'movie' ? 'radarr' : 'sonarr'),
  });
  const disks = diskQuery.data?.disks ?? [];

  const autoSelect = useMutation({
    mutationFn: () =>
      autoSelectCandidates(snapshot.id, {
        targetBytes: targetGb * 1e9,
        maxTier,
      }),
    onSuccess: (data) => {
      toast.success(
        `Selected ${data.selectedCount} items · ${fmtBytes(data.selectedBytes)}`,
      );
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'snapshot', snapshot.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'candidates'],
      });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const maxGb = Math.max(1, Math.ceil(matching.bytes / 1e9));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between text-sm text-white/80 mb-2">
          <span className="font-bold flex items-center gap-2">
            How low should the bar be?
            <FaqPill section="cutting-room-tiers" label="tiers" />
          </span>
          <span className="font-bold text-[#facc15]">
            {TIER_LABELS[maxTier]?.label}
          </span>
        </div>
        <FunCountSlider
          value={maxTier}
          min={1}
          max={4}
          onValueChange={setMaxTier}
          onValueCommit={setMaxTier}
          aria-label="Candidate strictness"
        />
        <p className="text-xs text-white/60 mt-2">{BAR_LABELS[maxTier]}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(snapshot.tiers)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([tier, agg]) => (
              <span
                key={tier}
                className={[
                  'px-3 py-1 rounded-full text-xs font-semibold border',
                  Number(tier) <= maxTier
                    ? TIER_LABELS[Number(tier)]?.chip
                    : 'bg-white/5 text-white/30 border-white/10 line-through',
                ].join(' ')}
              >
                Tier {tier}: {agg.count} · {fmtBytes(agg.bytes)}
              </span>
            ))}
        </div>
        <div className="mt-3 text-sm text-white/80">
          Matching your bar:{' '}
          <span className="font-bold text-[#facc15]">
            {matching.count} items · {fmtBytes(matching.bytes)}
          </span>
        </div>
      </div>

      {disks.length > 0 ? (
        <div>
          <div className="text-sm font-bold text-white/80 mb-2 flex items-center gap-2">
            <HardDrive className="h-4 w-4" /> Drives
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {disks.map((disk) => {
              const usedPct =
                disk.totalSpace > 0
                  ? ((disk.totalSpace - disk.freeSpace) / disk.totalSpace) * 100
                  : 0;
              return (
                <div
                  key={disk.path}
                  className="p-3 rounded-xl border border-white/10 bg-white/5"
                >
                  <div className="flex justify-between text-xs text-white/70 mb-1">
                    <span className="font-semibold truncate">{disk.path}</span>
                    <span>{fmtBytes(disk.freeSpace)} free</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full ${usedPct > 92 ? 'bg-rose-400' : usedPct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${usedPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <div className="flex items-center justify-between text-sm text-white/80 mb-2">
          <span className="font-bold">How much space do you want back?</span>
          <span className="font-bold text-[#facc15]">
            {targetGb > 0 ? fmtBytes(targetGb * 1e9) : 'pick manually'}
          </span>
        </div>
        <FunCountSlider
          value={targetGb}
          min={0}
          max={maxGb}
          onValueChange={setTargetGb}
          onValueCommit={setTargetGb}
          aria-label="Space target in GB"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={targetGb <= 0 || autoSelect.isPending}
            onClick={() => autoSelect.mutate()}
            className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-[#facc15]/15 text-[#fde68a] border border-[#facc15]/25 text-sm font-bold disabled:opacity-40`}
          >
            {autoSelect.isPending ? 'Selecting…' : 'Auto-select best value'}
          </button>
          {snapshot.selectedCount > 0 ? (
            <span className="self-center text-sm text-white/70">
              currently selected:{' '}
              <span className="font-bold text-white">
                {snapshot.selectedCount} · {fmtBytes(snapshot.selectedBytes)}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 font-semibold border border-white/10`}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className={`${APP_PRESSABLE_CLASS} px-5 py-2.5 rounded-xl bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)]`}
        >
          Review candidates
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReviewStep(props: {
  snapshot: CuttingRoomSnapshot;
  maxTier: number;
  onBack: () => void;
  onNext: () => void;
}) {
  const { snapshot, maxTier, onBack, onNext } = props;
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<'score' | 'size' | 'scorePerGb' | 'addedAt'>(
    'score',
  );
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const take = 50;

  const candidatesQuery = useQuery({
    queryKey: [
      'cuttingRoom',
      'candidates',
      snapshot.id,
      page,
      sort,
      dir,
      search,
      maxTier,
      selectedOnly,
    ],
    queryFn: () =>
      listCuttingRoomCandidates({
        snapshotId: snapshot.id,
        take,
        skip: page * take,
        sort,
        dir,
        maxTier,
        search: search || undefined,
        selectedOnly: selectedOnly || undefined,
      }),
  });
  const total = candidatesQuery.data?.total ?? 0;
  const items = candidatesQuery.data?.items ?? [];

  const patchSelection = useMutation({
    mutationFn: (body: {
      ids?: string[];
      all?: boolean;
      selected: boolean;
    }) =>
      patchCandidateSelection(snapshot.id, {
        ...body,
        ...(body.all ? { maxTier } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'candidates'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'snapshot', snapshot.id],
      });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['score', 'Score'],
              ['size', 'Size'],
              ['scorePerGb', 'Value/GB'],
              ['addedAt', 'Added'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                // Tapping the active sort again flips the direction.
                if (sort === key) {
                  setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
                } else {
                  setSort(key);
                  setDir('desc');
                }
                setPage(0);
              }}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                sort === key
                  ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
              title={
                sort === key
                  ? `Sorted ${dir === 'desc' ? 'descending' : 'ascending'} — tap to flip`
                  : `Sort by ${label}`
              }
            >
              {label}
              {sort === key ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setSelectedOnly((v) => !v);
              setPage(0);
            }}
            className={[
              APP_PRESSABLE_CLASS,
              'px-3 py-1.5 rounded-full text-xs font-semibold border',
              selectedOnly
                ? 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25'
                : 'bg-white/5 text-white/60 border-white/10',
            ].join(' ')}
          >
            Selected only
          </button>
        </div>
        <input
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Filter by title…"
          className="rounded-xl bg-black/30 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 md:w-64"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => patchSelection.mutate({ all: true, selected: true })}
          className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-white/5 text-white/70 border-white/10`}
        >
          <SquareCheckBig className="inline h-3.5 w-3.5 mr-1" />
          Select all matching
        </button>
        <button
          type="button"
          onClick={() => patchSelection.mutate({ all: true, selected: false })}
          className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-white/5 text-white/70 border-white/10`}
        >
          Clear selection
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 overflow-x-auto">
        {candidatesQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-white/60 p-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr>
                <th className="p-3 text-left w-10" />
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left">Tier</th>
                <th className="p-3 text-right">Score</th>
                <th className="p-3 text-right">Size</th>
                <th className="p-3 text-left hidden md:table-cell">Added</th>
                <th className="p-3 text-left hidden lg:table-cell">Why</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <CandidateRow
                  key={c.id}
                  candidate={c}
                  onToggle={(selected) =>
                    patchSelection.mutate({ ids: [c.id], selected })
                  }
                />
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-white/50">
                    No candidates match the current bar/filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-white/60">
        <span>
          {total} matching · page {page + 1} of {Math.max(1, Math.ceil(total / take))}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30`}
          >
            Prev
          </button>
          <button
            type="button"
            disabled={(page + 1) * take >= total}
            onClick={() => setPage((p) => p + 1)}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30`}
          >
            Next
          </button>
        </div>
      </div>

      {/* sticky selection footer */}
      <div className="sticky bottom-3 rounded-2xl border border-[#facc15]/25 bg-black/70 backdrop-blur-xl p-4 flex items-center justify-between">
        <div className="text-sm text-white">
          Selected:{' '}
          <span className="font-bold text-[#facc15]">
            {snapshot.selectedCount} items · {fmtBytes(snapshot.selectedBytes)}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 font-semibold border border-white/10`}
          >
            Back
          </button>
          <button
            type="button"
            disabled={snapshot.selectedCount === 0}
            onClick={onNext}
            className={`${APP_PRESSABLE_CLASS} px-5 py-2.5 rounded-xl bg-[#facc15] text-black font-bold disabled:opacity-40`}
          >
            Continue to confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateRow(props: {
  candidate: CuttingRoomCandidate;
  onToggle: (selected: boolean) => void;
}) {
  const { candidate: c, onToggle } = props;
  const tier = TIER_LABELS[c.tier];
  return (
    <tr className="border-t border-white/5 hover:bg-white/5">
      <td className="p-3">
        <input
          type="checkbox"
          checked={c.selected}
          onChange={() => onToggle(!c.selected)}
          className="h-4 w-4 accent-[#facc15]"
          aria-label={`Select ${c.title}`}
        />
      </td>
      <td className="p-3">
        <div className="font-semibold text-white">
          {c.title}
          {c.year ? <span className="text-white/40"> ({c.year})</span> : null}
        </div>
        {c.confidence === 'plex_only' && !c.arrId ? (
          <span className="text-[10px] text-amber-200/80">
            not tracked by {c.mediaType === 'movie' ? 'Radarr' : 'Sonarr'}
          </span>
        ) : null}
      </td>
      <td className="p-3">
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${tier?.chip ?? ''}`}
        >
          T{c.tier}
        </span>
      </td>
      <td className="p-3 text-right font-mono text-white/80">{c.score}</td>
      <td className="p-3 text-right font-mono text-white/80">
        {fmtBytes(c.sizeBytes)}
      </td>
      <td className="p-3 hidden md:table-cell text-white/60">
        {fmtDate(c.addedAt)}
      </td>
      <td className="p-3 hidden lg:table-cell">
        <div className="flex flex-wrap gap-1">
          {c.reasons.slice(0, 4).map((r) => (
            <span
              key={r.code}
              className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-white/70 border border-white/10"
              title={`+${r.points} points`}
            >
              {r.label}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------

function ConfirmStep(props: {
  snapshot: CuttingRoomSnapshot;
  mediaType: 'movie' | 'show';
  onBack: () => void;
  onDone: () => void;
}) {
  const { snapshot, mediaType, onBack, onDone } = props;
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pruneRunId, setPruneRunId] = useState<string | null>(null);

  const diskQuery = useQuery({
    queryKey: ['cuttingRoom', 'diskspace', mediaType],
    queryFn: () =>
      getCuttingRoomDiskspace(mediaType === 'movie' ? 'radarr' : 'sonarr'),
  });
  const recycleBin = diskQuery.data?.recycleBin ?? { configured: null };

  const runQuery = useQuery({
    queryKey: ['cuttingRoom', 'pruneRun', pruneRunId],
    queryFn: () => getRun(pruneRunId as string),
    enabled: Boolean(pruneRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const run = runQuery.data?.run ?? null;
  const runProgress = useMemo(() => {
    const summary = run?.summary as
      | {
          progress?: { message?: string; current?: number; total?: number };
          headline?: string;
        }
      | null
      | undefined;
    return summary ?? null;
  }, [run?.summary]);

  const startPrune = useMutation({
    mutationFn: (asDryRun: boolean) =>
      startCuttingRoomPrune(snapshot.id, {
        confirmation,
        dryRun: asDryRun,
      }),
    onSuccess: (data, asDryRun) => {
      setPruneRunId(data.run.id);
      toast.success(asDryRun ? 'Dry-run started' : 'Prune started');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const stopPrune = useMutation({
    mutationFn: () => stopCuttingRoomPrune(snapshot.id),
    onSuccess: () => toast.success('Stopping after the current wave…'),
    onError: (err) => toast.error((err as Error).message),
  });

  const armed =
    dryRun ||
    confirmation.trim() === String(snapshot.selectedCount) ||
    confirmation.trim().toUpperCase() === 'PRUNE';

  const finished =
    run && (run.status === 'SUCCESS' || run.status === 'FAILED');

  useEffect(() => {
    if (finished) {
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'snapshot', snapshot.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'prunes'] });
    }
  }, [finished, queryClient, snapshot.id]);

  if (pruneRunId) {
    const pct =
      runProgress?.progress?.current && runProgress?.progress?.total
        ? Math.min(
            100,
            (runProgress.progress.current / runProgress.progress.total) * 100,
          )
        : null;
    return (
      <div className="py-8 flex flex-col items-center gap-4 text-center">
        {finished ? (
          run?.status === 'SUCCESS' ? (
            <CircleCheck className="h-10 w-10 text-emerald-300" />
          ) : (
            <CircleAlert className="h-10 w-10 text-rose-300" />
          )
        ) : (
          <Loader2 className="h-10 w-10 animate-spin text-[#facc15]" />
        )}
        <div className="text-lg font-bold text-white">
          {finished
            ? (runProgress?.headline ??
              (run?.status === 'SUCCESS' ? 'Done' : 'Failed'))
            : (runProgress?.progress?.message ?? 'Working…')}
        </div>
        {run?.dryRun ? (
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-sky-500/15 text-sky-100 border border-sky-500/25">
            DRY RUN — nothing was deleted
          </span>
        ) : null}
        {pct !== null && !finished ? (
          <div className="w-full max-w-md h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[#facc15] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
        <div className="flex gap-2 mt-2">
          {!finished && !run?.dryRun ? (
            <button
              type="button"
              onClick={() => stopPrune.mutate()}
              className={`${APP_PRESSABLE_CLASS} flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500/15 text-rose-100 border border-rose-500/25 font-bold text-sm`}
            >
              <StopCircle className="h-4 w-4" /> Stop
            </button>
          ) : null}
          {run ? (
            <a
              href={`${import.meta.env.BASE_URL ?? '/'}rewind/${run.id}`.replace('//', '/')}
              className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 border border-white/10 font-semibold text-sm`}
            >
              Open full report
            </a>
          ) : null}
          {finished ? (
            run?.dryRun ? (
              <button
                type="button"
                onClick={() => {
                  setPruneRunId(null);
                  setDryRun(false);
                }}
                className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-[#facc15] text-black font-bold text-sm`}
              >
                Looks good — do it for real
              </button>
            ) : (
              <button
                type="button"
                onClick={onDone}
                className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-[#facc15] text-black font-bold text-sm`}
              >
                Finish
              </button>
            )
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="text-lg font-black text-white">
            You are about to prune{' '}
            <span className="text-rose-300">
              {snapshot.selectedCount} {mediaType === 'movie' ? 'movies' : 'shows'}
            </span>{' '}
            · {fmtBytes(snapshot.selectedBytes)}
          </div>
          <FaqPill section="cutting-room-prune-safety" label="prune safety" />
        </div>
        <ul className="text-sm text-white/70 space-y-1 mt-3">
          <li className="flex items-start gap-2">
            <Scissors className="h-4 w-4 mt-0.5 text-white/50" />
            Files are deleted through{' '}
            {mediaType === 'movie' ? 'Radarr' : 'Sonarr'}; each entry stays
            behind, unmonitored and tagged{' '}
            <code className="text-[#fde68a]">deleted-by-immaculaterr</code>.
          </li>
          <li className="flex items-start gap-2">
            <ArchiveRestore className="h-4 w-4 mt-0.5 text-white/50" />
            Everything lands in Pruned History with one-click Restore
            (re-monitors and re-downloads).
          </li>
          <li className="flex items-start gap-2">
            <Recycle className="h-4 w-4 mt-0.5 text-white/50" />
            {recycleBin.configured === true ? (
              <span>
                {mediaType === 'movie' ? 'Radarr' : 'Sonarr'} Recycle Bin is{' '}
                <span className="text-emerald-300 font-bold">ON</span> — deleted
                files are recoverable from {recycleBin.path}.
              </span>
            ) : recycleBin.configured === false ? (
              <span>
                Recycle Bin is{' '}
                <span className="text-rose-300 font-bold">OFF</span> — file
                deletion is immediate and permanent.
              </span>
            ) : (
              <span>Recycle Bin status unknown.</span>
            )}
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 mt-0.5 text-white/50" />
            Each item is re-checked before deletion — anything watched since
            the scan is skipped. Runs in waves with a Stop button.
          </li>
        </ul>
      </div>

      <label className="flex items-center gap-3 p-4 rounded-2xl border border-sky-500/25 bg-sky-500/5 cursor-pointer">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={() => setDryRun((v) => !v)}
          className="h-4 w-4 accent-[#facc15]"
        />
        <div>
          <div className="font-bold text-white text-sm">
            Dry run first (recommended)
          </div>
          <div className="text-xs text-white/60">
            Rehearse the whole prune and get the exact would-delete list —
            nothing is touched.
          </div>
        </div>
      </label>

      {!dryRun ? (
        <div>
          <label className="text-sm text-white/80 block mb-2">
            Type <span className="font-bold text-white">{snapshot.selectedCount}</span>{' '}
            (the item count) or <span className="font-bold text-white">PRUNE</span>{' '}
            to arm the button
          </label>
          <input
            value={confirmation}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setConfirmation(e.target.value)
            }
            placeholder={String(snapshot.selectedCount)}
            className="w-full md:w-64 rounded-xl bg-black/30 border border-rose-500/30 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-rose-400"
          />
        </div>
      ) : null}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 font-semibold border border-white/10`}
        >
          Back
        </button>
        <button
          type="button"
          disabled={!armed || startPrune.isPending}
          onClick={() => {
            if (dryRun) startPrune.mutate(true);
            else setConfirmOpen(true);
          }}
          className={[
            APP_PRESSABLE_CLASS,
            'px-5 py-2.5 rounded-xl font-bold disabled:opacity-40',
            dryRun
              ? 'bg-sky-500/20 text-sky-100 border border-sky-500/30'
              : 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.35)]',
          ].join(' ')}
        >
          {dryRun ? 'Run dry-run rehearsal' : `Prune ${snapshot.selectedCount} items`}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          startPrune.mutate(false);
        }}
        title={`Prune ${snapshot.selectedCount} items (${fmtBytes(snapshot.selectedBytes)})?`}
        label="Final confirmation"
        variant="danger"
        description="Files will be deleted and entries unmonitored + tagged. Pruned History keeps a Restore button for every item."
        confirmText="Prune now"
        confirming={startPrune.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Large-file replacement wizard steps (exclusive "Oversized files" factor)

function LargeFilesTuneStep(props: {
  items: LargeFileItem[];
  loadedFloorGb: number;
  thresholdGb: number;
  setThresholdGb: (n: number) => void;
  targetGb: number;
  setTargetGb: (n: number) => void;
  selectedKeys: Set<string>;
  setSelectedKeys: (keys: Set<string>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const {
    items,
    loadedFloorGb,
    thresholdGb,
    setThresholdGb,
    targetGb,
    setTargetGb,
    selectedKeys,
    setSelectedKeys,
    onBack,
    onNext,
  } = props;

  const matching = useMemo(() => {
    const list = items.filter((item) => item.sizeBytes >= thresholdGb * 1e9);
    return {
      list,
      count: list.length,
      bytes: list.reduce((sum, item) => sum + item.sizeBytes, 0),
    };
  }, [items, thresholdGb]);

  const selected = useMemo(() => {
    let count = 0;
    let bytes = 0;
    for (const item of matching.list) {
      if (selectedKeys.has(lfItemKey(item))) {
        count += 1;
        bytes += item.sizeBytes;
      }
    }
    return { count, bytes };
  }, [matching.list, selectedKeys]);

  const maxGb = Math.max(1, Math.ceil(matching.bytes / 1e9));

  const autoSelect = () => {
    const next = new Set<string>();
    let bytes = 0;
    // Biggest first: each replacement frees the most space per search.
    for (const item of matching.list) {
      if (bytes >= targetGb * 1e9) break;
      next.add(lfItemKey(item));
      bytes += item.sizeBytes;
    }
    setSelectedKeys(next);
    toast.success(`Selected ${next.size} files · ${fmtBytes(bytes)}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between text-sm text-white/80 mb-2">
          <span className="font-bold flex items-center gap-2">
            How big is &ldquo;too big&rdquo; for one file?
            <FaqPill section="cutting-room-large-files" label="Large Files" />
          </span>
          <span className="font-bold text-[#facc15]">{thresholdGb} GB</span>
        </div>
        <FunCountSlider
          value={thresholdGb}
          min={loadedFloorGb}
          max={60}
          onValueChange={setThresholdGb}
          onValueCommit={setThresholdGb}
          aria-label="Oversized file threshold in GB"
        />
        <div className="mt-3 text-sm text-white/80">
          Over the bar:{' '}
          <span className="font-bold text-[#facc15]">
            {matching.count} files · {fmtBytes(matching.bytes)}
          </span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-sm text-white/80 mb-2">
          <span className="font-bold">
            How much oversized data do you want to replace?
          </span>
          <span className="font-bold text-[#facc15]">
            {targetGb > 0 ? fmtBytes(targetGb * 1e9) : 'pick manually'}
          </span>
        </div>
        <FunCountSlider
          value={targetGb}
          min={0}
          max={maxGb}
          onValueChange={setTargetGb}
          onValueCommit={setTargetGb}
          aria-label="Replacement target in GB"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={targetGb <= 0}
            onClick={autoSelect}
            className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-[#facc15]/15 text-[#fde68a] border border-[#facc15]/25 text-sm font-bold disabled:opacity-40`}
          >
            Auto-select biggest first
          </button>
          {selected.count > 0 ? (
            <span className="self-center text-sm text-white/70">
              currently selected:{' '}
              <span className="font-bold text-white">
                {selected.count} · {fmtBytes(selected.bytes)}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-white/50">
        Replaced files re-download automatically at a smaller size, so the
        space comes back as soon as the new copies land — this is a slimming
        pass, not a deletion.
      </p>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 font-semibold border border-white/10`}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className={`${APP_PRESSABLE_CLASS} px-5 py-2.5 rounded-xl bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)]`}
        >
          Review files
        </button>
      </div>
    </div>
  );
}

function LargeFilesReviewStep(props: {
  items: LargeFileItem[];
  selectedKeys: Set<string>;
  setSelectedKeys: (keys: Set<string>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { items, selectedKeys, setSelectedKeys, onBack, onNext } = props;

  const selectedCount = useMemo(
    () => items.filter((item) => selectedKeys.has(lfItemKey(item))).length,
    [items, selectedKeys],
  );
  const allSelected = selectedCount === items.length && items.length > 0;

  const toggle = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-white/70">
          Tick the files to replace —{' '}
          <span className="font-bold text-white">{selectedCount}</span> of{' '}
          {items.length} selected.
        </div>
        <button
          type="button"
          onClick={() =>
            setSelectedKeys(
              allSelected
                ? new Set()
                : new Set(items.map((item) => lfItemKey(item))),
            )
          }
          className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-white/5 text-white/70 border-white/10`}
        >
          {allSelected ? 'Clear selection' : `Select all ${items.length}`}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center text-white/50 text-sm">
          Nothing is over the bar — go back and lower it, or enjoy your lean
          library.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <LargeFilesTable
            items={items}
            selectedKeys={selectedKeys}
            onToggle={toggle}
          />
        </div>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 font-semibold border border-white/10`}
        >
          Back
        </button>
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={onNext}
          className={`${APP_PRESSABLE_CLASS} px-5 py-2.5 rounded-xl bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] disabled:opacity-50`}
        >
          Continue to confirm
        </button>
      </div>
    </div>
  );
}

function LargeFilesConfirmStep(props: {
  items: LargeFileItem[];
  onBack: () => void;
  onDone: () => void;
}) {
  const { items, onBack, onDone } = props;
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const totalBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.sizeBytes, 0),
    [items],
  );
  const episodeCount = items.filter((item) => item.kind === 'episode').length;

  const runQuery = useQuery({
    queryKey: ['cuttingRoom', 'lfReplaceRun', runId],
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const run = runQuery.data?.run ?? null;
  const runSummary = useMemo(() => {
    const summary = run?.summary as
      | {
          progress?: { message?: string; current?: number; total?: number };
          headline?: string;
        }
      | null
      | undefined;
    return summary ?? null;
  }, [run?.summary]);

  const startReplace = useMutation({
    mutationFn: (asDryRun: boolean) =>
      startLargeFilesReplace({
        items,
        confirmation,
        dryRun: asDryRun,
      }),
    onSuccess: (data, asDryRun) => {
      setRunId(data.run.id);
      setConfirmation('');
      toast.success(asDryRun ? 'Dry-run started' : 'Replacement started');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const armed =
    dryRun ||
    confirmation.trim() === String(items.length) ||
    confirmation.trim().toUpperCase() === 'PRUNE';

  const finished =
    run && (run.status === 'SUCCESS' || run.status === 'FAILED');

  useEffect(() => {
    if (finished) {
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'prunes'] });
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'largeFiles'],
      });
    }
  }, [finished, queryClient]);

  if (runId) {
    const pct =
      runSummary?.progress?.current && runSummary?.progress?.total
        ? Math.min(
            100,
            (runSummary.progress.current / runSummary.progress.total) * 100,
          )
        : null;
    return (
      <div className="py-8 flex flex-col items-center gap-4 text-center">
        {finished ? (
          run?.status === 'SUCCESS' ? (
            <CircleCheck className="h-10 w-10 text-emerald-300" />
          ) : (
            <CircleAlert className="h-10 w-10 text-rose-300" />
          )
        ) : (
          <Loader2 className="h-10 w-10 animate-spin text-[#facc15]" />
        )}
        <div className="text-lg font-bold text-white">
          {finished
            ? (runSummary?.headline ??
              (run?.status === 'SUCCESS' ? 'Done' : 'Failed'))
            : (runSummary?.progress?.message ?? 'Working…')}
        </div>
        {run?.dryRun ? (
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-sky-500/15 text-sky-100 border border-sky-500/25">
            DRY RUN — nothing was deleted
          </span>
        ) : null}
        {pct !== null && !finished ? (
          <div className="w-full max-w-md h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[#facc15] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
        <div className="flex gap-2 mt-2">
          {run ? (
            <a
              href={`${import.meta.env.BASE_URL ?? '/'}rewind/${run.id}`.replace('//', '/')}
              className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 border border-white/10 font-semibold text-sm`}
            >
              Open full report
            </a>
          ) : null}
          {finished ? (
            run?.dryRun ? (
              <button
                type="button"
                onClick={() => {
                  setRunId(null);
                  setDryRun(false);
                }}
                className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-[#facc15] text-black font-bold text-sm`}
              >
                Looks good — do it for real
              </button>
            ) : (
              <button
                type="button"
                onClick={onDone}
                className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-[#facc15] text-black font-bold text-sm`}
              >
                Finish
              </button>
            )
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="text-lg font-black text-white">
            You are about to replace{' '}
            <span className="text-rose-300">{items.length} oversized files</span>{' '}
            · {fmtBytes(totalBytes)}
          </div>
          <FaqPill section="cutting-room-large-files" label="Large Files" />
        </div>
        <ul className="text-sm text-white/70 space-y-1 mt-3">
          <li className="flex items-start gap-2">
            <Scissors className="h-4 w-4 mt-0.5 text-white/50" />
            Each file is deleted through Radarr/Sonarr (Recycle Bin honored
            when configured), the item is re-monitored, and it gets the{' '}
            <code className="text-[#fde68a]">size-reduction</code> tag.
          </li>
          <li className="flex items-start gap-2">
            <HardDrive className="h-4 w-4 mt-0.5 text-white/50" />
            Each item is switched to a size-capped quality profile (created on
            first run, reused after): movies max ~10 GB, episodes max 3 GB
            preferring 1–2 GB — so the re-download and all future upgrades
            stay small.
          </li>
          {episodeCount > 0 ? (
            <li className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 mt-0.5 text-white/50" />
              Episodes are monitored surgically — only the {episodeCount}{' '}
              oversized episode{episodeCount === 1 ? '' : 's'}, their seasons,
              and the show. Untouched episodes keep their current monitoring.
            </li>
          ) : null}
          <li className="flex items-start gap-2">
            <ArchiveRestore className="h-4 w-4 mt-0.5 text-white/50" />
            A fresh search starts immediately, so smaller copies download
            automatically — Pruned History records each one as{' '}
            <span className="text-white/85 font-semibold">
              replaced for size
            </span>
            .
          </li>
        </ul>
      </div>

      <label className="flex items-center gap-3 p-4 rounded-2xl border border-sky-500/25 bg-sky-500/5 cursor-pointer">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={() => setDryRun((v) => !v)}
          className="h-4 w-4 accent-[#facc15]"
        />
        <div>
          <div className="font-bold text-white text-sm">
            Dry run first (recommended)
          </div>
          <div className="text-xs text-white/60">
            Rehearse the whole replacement and see the exact would-replace
            list — nothing is touched.
          </div>
        </div>
      </label>

      {!dryRun ? (
        <div>
          <label className="text-sm text-white/80 block mb-2">
            Type <span className="font-bold text-white">{items.length}</span>{' '}
            (the file count) or <span className="font-bold text-white">PRUNE</span>{' '}
            to arm the button
          </label>
          <input
            value={confirmation}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setConfirmation(e.target.value)
            }
            placeholder={String(items.length)}
            className="w-full md:w-64 rounded-xl bg-black/30 border border-rose-500/30 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-rose-400"
          />
        </div>
      ) : null}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-white/10 text-white/80 font-semibold border border-white/10`}
        >
          Back
        </button>
        <button
          type="button"
          disabled={items.length === 0 || !armed || startReplace.isPending}
          onClick={() => {
            if (dryRun) startReplace.mutate(true);
            else setConfirmOpen(true);
          }}
          className={[
            APP_PRESSABLE_CLASS,
            'px-5 py-2.5 rounded-xl font-bold disabled:opacity-40',
            dryRun
              ? 'bg-sky-500/20 text-sky-100 border border-sky-500/30'
              : 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.35)]',
          ].join(' ')}
        >
          {dryRun
            ? 'Run dry-run rehearsal'
            : `Replace ${items.length} files`}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          startReplace.mutate(false);
        }}
        title={`Replace ${items.length} oversized files (${fmtBytes(totalBytes)})?`}
        label="Final confirmation"
        variant="danger"
        description="Files are deleted, exactly the affected items are re-monitored and tagged size-reduction, and a fresh search grabs smaller copies automatically."
        confirmText="Replace now"
        confirming={startReplace.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pruned History tab

function PrunedHistoryTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'all' | 'movie' | 'show' | 'restored'>(
    'all',
  );
  const [search, setSearch] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const take = 50;

  const historyQuery = useQuery({
    queryKey: ['cuttingRoom', 'prunes', page, filter, search],
    queryFn: () =>
      listPruneHistory({
        take,
        skip: page * take,
        mediaType:
          filter === 'movie' || filter === 'show' ? filter : undefined,
        restored: filter === 'restored' ? true : undefined,
        search: search || undefined,
      }),
  });
  const total = historyQuery.data?.total ?? 0;
  const items = historyQuery.data?.items ?? [];

  const restore = useMutation({
    mutationFn: (id: string) => restorePrune(id),
    onSuccess: () => {
      toast.success('Re-monitored and searching — it will re-download');
      setRestoreTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'prunes'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className={CARD_CLASS}>
      <div className="p-4 border-b border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['all', 'All'],
              ['movie', 'Movies'],
              ['show', 'Shows'],
              ['restored', 'Restored'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFilter(key);
                setPage(0);
              }}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                filter === key
                  ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
          <span className="self-center">
            <FaqPill section="cutting-room-pruned-tag-restore" label="Pruned History" />
          </span>
        </div>
        <input
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search pruned titles…"
          className="rounded-xl bg-black/30 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 md:w-64"
        />
      </div>

      {historyQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/60 p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-white/50 text-sm">
          Nothing pruned yet. The wizard&rsquo;s deletions land here with a
          Restore button.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr>
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-right">Size</th>
                <th className="p-3 text-left hidden md:table-cell">Pruned</th>
                <th className="p-3 text-left hidden md:table-cell">Action</th>
                <th className="p-3 text-right">Restore</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-white/5">
                  <td className="p-3 font-semibold text-white">
                    {item.title}
                    {item.year ? (
                      <span className="text-white/40"> ({item.year})</span>
                    ) : null}
                  </td>
                  <td className="p-3 text-white/60">{item.mediaType}</td>
                  <td className="p-3 text-right font-mono text-white/70">
                    {item.sizeBytes > 0 ? fmtBytes(item.sizeBytes) : '—'}
                  </td>
                  <td className="p-3 hidden md:table-cell text-white/60">
                    {fmtDate(item.createdAt)}
                  </td>
                  <td className="p-3 hidden md:table-cell">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-white/60 border border-white/10">
                      {item.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {item.restoredAt ? (
                      <span className="text-emerald-300 text-xs font-bold">
                        Restored
                      </span>
                    ) : item.action === 'replaced_for_size' ? (
                      <span
                        className="text-sky-300 text-xs"
                        title="A smaller copy re-downloads automatically"
                      >
                        auto re-downloads
                      </span>
                    ) : item.action === 'files_deleted_unmonitored' ? (
                      <button
                        type="button"
                        onClick={() =>
                          setRestoreTarget({ id: item.id, title: item.title })
                        }
                        className={`${APP_PRESSABLE_CLASS} px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-100 border border-emerald-500/25`}
                      >
                        Restore
                      </button>
                    ) : (
                      <span
                        className="text-white/30 text-xs"
                        title="Entry removed or Plex-only — re-add manually"
                      >
                        manual
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-3 flex items-center justify-between text-xs text-white/60 border-t border-white/10">
        <span>{total} pruned items</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30`}
          >
            Prev
          </button>
          <button
            type="button"
            disabled={(page + 1) * take >= total}
            onClick={() => setPage((p) => p + 1)}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30`}
          >
            Next
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && restore.mutate(restoreTarget.id)}
        title={`Restore "${restoreTarget?.title ?? ''}"?`}
        label="Restore"
        variant="primary"
        description="Re-monitors the entry, removes the pruned tag, and triggers a search so it re-downloads automatically."
        confirmText="Restore"
        confirming={restore.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wanted list tab

function WantedTab() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<'radarr' | 'sonarr'>('radarr');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [useAll, setUseAll] = useState(false);
  const [mode, setMode] = useState<'unmonitor' | 'remove'>('unmonitor');
  const [confirmation, setConfirmation] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const take = 50;

  const wantedQuery = useQuery({
    queryKey: ['cuttingRoom', 'wanted', type, page, search],
    queryFn: () =>
      listWanted({
        type,
        take,
        skip: page * take,
        search: search || undefined,
      }),
  });
  const total = wantedQuery.data?.total ?? 0;
  const items = wantedQuery.data?.items ?? [];

  const targetCount = useAll ? total : selectedIds.size;

  const runQuery = useQuery({
    queryKey: ['cuttingRoom', 'wantedRun', runId],
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const run = runQuery.data?.run ?? null;
  const runFinished = run && run.status !== 'PENDING' && run.status !== 'RUNNING';

  useEffect(() => {
    if (runFinished) {
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'wanted'] });
    }
  }, [runFinished, queryClient]);

  const startPrune = useMutation({
    mutationFn: () =>
      startWantedPrune({
        type,
        mode,
        confirmation,
        ...(useAll ? { all: true } : { arrIds: Array.from(selectedIds) }),
      }),
    onSuccess: (data) => {
      setRunId(data.run.id);
      setSelectedIds(new Set());
      setUseAll(false);
      setConfirmation('');
      toast.success('Wanted-list prune started');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const armed =
    confirmation.trim() === String(targetCount) ||
    confirmation.trim().toUpperCase() === 'PRUNE';

  return (
    <div className={CARD_CLASS}>
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-white/70">
            Monitored {type === 'radarr' ? 'movies' : 'shows'} that{' '}
            <span className="font-bold text-white">never downloaded anything</span>.
            Unmonitoring or removing them stops future downloads —{' '}
            <span className="text-emerald-300 font-semibold">no files are ever touched</span>.
          </p>
          <FaqPill section="cutting-room-wanted-list" label="Wanted List" />
        </div>
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['radarr', 'Radarr (movies)'],
                ['sonarr', 'Sonarr (shows)'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setType(key);
                  setPage(0);
                  setSelectedIds(new Set());
                  setUseAll(false);
                }}
                className={[
                  APP_PRESSABLE_CLASS,
                  'px-3 py-1.5 rounded-full text-xs font-semibold border',
                  type === key
                    ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                    : 'bg-white/5 text-white/60 border-white/10',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setUseAll((v) => !v);
                setSelectedIds(new Set());
              }}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                useAll
                  ? 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
            >
              {useAll ? `All ${total} selected` : 'Select ALL matching'}
            </button>
          </div>
          <input
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search titles…"
            className="rounded-xl bg-black/30 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 md:w-64"
          />
        </div>
      </div>

      {wantedQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/60 p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading wanted list…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr>
                <th className="p-3 text-left w-10" />
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left hidden md:table-cell">Added</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const checked = useAll || selectedIds.has(item.arrId);
                return (
                  <tr key={item.arrId} className="border-t border-white/5">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={useAll}
                        onChange={() =>
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.arrId)) next.delete(item.arrId);
                            else next.add(item.arrId);
                            return next;
                          })
                        }
                        className="h-4 w-4 accent-[#facc15]"
                        aria-label={`Select ${item.title}`}
                      />
                    </td>
                    <td className="p-3 font-semibold text-white">
                      {item.title}
                      {item.year ? (
                        <span className="text-white/40"> ({item.year})</span>
                      ) : null}
                    </td>
                    <td className="p-3 hidden md:table-cell text-white/60">
                      {item.added ? fmtDate(item.added) : '—'}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-white/50">
                    Wanted list is empty — nothing queued for download.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-3 flex items-center justify-between text-xs text-white/60 border-t border-white/10">
        <span>{total} entries</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30`}
          >
            Prev
          </button>
          <button
            type="button"
            disabled={(page + 1) * take >= total}
            onClick={() => setPage((p) => p + 1)}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30`}
          >
            Next
          </button>
        </div>
      </div>

      <div className="p-4 border-t border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['unmonitor', 'Unmonitor (keep entries)'],
              ['remove', 'Remove entries'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                mode === key
                  ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
          {targetCount > 0 ? (
            <input
              value={confirmation}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setConfirmation(e.target.value)
              }
              placeholder={`type ${targetCount} to arm`}
              className="rounded-xl bg-black/30 border border-white/15 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 w-36"
            />
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {run && !runFinished ? (
            <span className="flex items-center gap-2 text-xs text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> working…
            </span>
          ) : null}
          <button
            type="button"
            disabled={targetCount === 0 || !armed || startPrune.isPending}
            onClick={() => setConfirmOpen(true)}
            className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-rose-500/90 text-white font-bold text-sm disabled:opacity-40`}
          >
            {mode === 'unmonitor' ? 'Unmonitor' : 'Remove'} {targetCount || ''}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          startPrune.mutate();
        }}
        title={`${mode === 'unmonitor' ? 'Unmonitor' : 'Remove'} ${targetCount} wanted entries?`}
        label="Wanted list"
        variant="danger"
        description="No files are touched — this only stops future downloads. Everything is recorded in Pruned History."
        confirmText={mode === 'unmonitor' ? 'Unmonitor' : 'Remove'}
        confirming={startPrune.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duplicates tab

function DuplicatesTab() {
  const queryClient = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [preference, setPreference] = useState<'smallest_file' | 'largest_file'>(
    'smallest_file',
  );
  const [confirmation, setConfirmation] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);

  const duplicatesQuery = useQuery({
    queryKey: ['cuttingRoom', 'duplicates'],
    queryFn: () => listDuplicates(),
  });
  const groups = duplicatesQuery.data?.groups ?? [];
  const totalWaste = duplicatesQuery.data?.wasteBytes ?? 0;

  const runQuery = useQuery({
    queryKey: ['cuttingRoom', 'duplicatesRun', runId],
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const run = runQuery.data?.run ?? null;
  const runFinished = run && run.status !== 'PENDING' && run.status !== 'RUNNING';
  const runHeadline = useMemo(() => {
    const summary = run?.summary as { headline?: string } | null | undefined;
    return summary?.headline ?? null;
  }, [run?.summary]);

  useEffect(() => {
    if (runFinished && run && !run.dryRun) {
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'duplicates'],
      });
    }
  }, [runFinished, run, queryClient]);

  const startCleanup = useMutation({
    mutationFn: (asDryRun: boolean) =>
      startDuplicateCleanup({
        ratingKeys: Array.from(selectedKeys),
        deletePreference: preference,
        confirmation,
        dryRun: asDryRun,
      }),
    onSuccess: (data, asDryRun) => {
      setRunId(data.run.id);
      setConfirmation('');
      if (!asDryRun) setSelectedKeys(new Set());
      toast.success(asDryRun ? 'Dry-run started' : 'Duplicate cleanup started');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const armed =
    dryRun ||
    confirmation.trim() === String(selectedKeys.size) ||
    confirmation.trim().toUpperCase() === 'PRUNE';

  return (
    <div className={CARD_CLASS}>
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-white/70">
            Movies with <span className="font-bold text-white">more than one version</span> in
            Plex. Cleanup keeps one copy per movie and deletes the rest through
            Plex —{' '}
            <span className="font-bold text-[#fde68a]">
              {fmtBytes(totalWaste)}
            </span>{' '}
            reclaimable across {groups.length} movies.
          </p>
          <FaqPill section="cutting-room-duplicates" label="Duplicates" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['smallest_file', 'Keep largest copy'],
              ['largest_file', 'Keep smallest copy'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreference(key)}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                preference === key
                  ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              setSelectedKeys(
                selectedKeys.size === groups.length
                  ? new Set()
                  : new Set(groups.map((g) => g.ratingKey)),
              )
            }
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-white/5 text-white/70 border-white/10`}
          >
            {selectedKeys.size === groups.length && groups.length > 0
              ? 'Clear selection'
              : `Select all ${groups.length}`}
          </button>
        </div>
      </div>

      {duplicatesQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/60 p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning for duplicates…
        </div>
      ) : groups.length === 0 ? (
        <div className="p-8 text-center text-white/50 text-sm">
          No duplicate versions found — every movie has a single copy.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr>
                <th className="p-3 text-left w-10" />
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left">Versions</th>
                <th className="p-3 text-right">Reclaimable</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const checked = selectedKeys.has(group.ratingKey);
                const largest = Math.max(
                  ...group.versions.map((v) => v.sizeBytes),
                );
                return (
                  <tr key={group.ratingKey} className="border-t border-white/5">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.ratingKey))
                              next.delete(group.ratingKey);
                            else next.add(group.ratingKey);
                            return next;
                          })
                        }
                        className="h-4 w-4 accent-[#facc15]"
                        aria-label={`Select ${group.title}`}
                      />
                    </td>
                    <td className="p-3 font-semibold text-white">
                      {group.title}
                      {group.year ? (
                        <span className="text-white/40"> ({group.year})</span>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {group.versions.map((v, index) => (
                          <span
                            key={`${group.ratingKey}-${v.mediaId ?? index}`}
                            className={[
                              'px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                              v.sizeBytes === largest
                                ? 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25'
                                : 'bg-white/10 text-white/60 border-white/10',
                            ].join(' ')}
                            title={v.file ?? undefined}
                          >
                            {v.videoResolution ?? '?'} · {fmtBytes(v.sizeBytes)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono text-white/80">
                      {fmtBytes(group.wasteBytes)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-4 border-t border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={() => setDryRun((v) => !v)}
              className="h-4 w-4 accent-[#facc15]"
            />
            Dry run first
          </label>
          {!dryRun && selectedKeys.size > 0 ? (
            <input
              value={confirmation}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setConfirmation(e.target.value)
              }
              placeholder={`type ${selectedKeys.size} to arm`}
              className="rounded-xl bg-black/30 border border-white/15 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 w-36"
            />
          ) : null}
          {run && !runFinished ? (
            <span className="flex items-center gap-2 text-xs text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> working…
            </span>
          ) : null}
          {runFinished && runHeadline ? (
            <span className="text-xs text-emerald-200">{runHeadline}</span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={selectedKeys.size === 0 || !armed || startCleanup.isPending}
          onClick={() => {
            if (dryRun) startCleanup.mutate(true);
            else setConfirmOpen(true);
          }}
          className={[
            APP_PRESSABLE_CLASS,
            'px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-40',
            dryRun
              ? 'bg-sky-500/20 text-sky-100 border border-sky-500/30'
              : 'bg-rose-500/90 text-white',
          ].join(' ')}
        >
          {dryRun ? 'Rehearse cleanup' : `Clean up ${selectedKeys.size || ''}`}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          startCleanup.mutate(false);
        }}
        title={`Remove extra versions of ${selectedKeys.size} movies?`}
        label="Duplicates"
        variant="danger"
        description="One copy per movie is kept according to your preference; the rest are deleted through Plex. This requires Plex's 'Allow media deletion' setting."
        confirmText="Clean up"
        confirming={startCleanup.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Large Files tab

function LargeFilesTab() {
  const queryClient = useQueryClient();
  const [thresholdGb, setThresholdGb] = useState(10);
  const [appliedThreshold, setAppliedThreshold] = useState(10);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);

  const largeQuery = useQuery({
    queryKey: ['cuttingRoom', 'largeFiles', appliedThreshold],
    queryFn: () => listLargeFiles(appliedThreshold),
  });
  const items = largeQuery.data?.items ?? [];
  const totalBytes = largeQuery.data?.totalBytes ?? 0;

  const runQuery = useQuery({
    queryKey: ['cuttingRoom', 'largeFilesRun', runId],
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const run = runQuery.data?.run ?? null;
  const runFinished =
    run && run.status !== 'PENDING' && run.status !== 'RUNNING';
  const runHeadline = useMemo(() => {
    const summary = run?.summary as { headline?: string } | null | undefined;
    return summary?.headline ?? null;
  }, [run?.summary]);

  useEffect(() => {
    if (runFinished && run && !run.dryRun) {
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'largeFiles'],
      });
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'prunes'] });
    }
  }, [runFinished, run, queryClient]);

  const selectedItems = items.filter((item) =>
    selectedKeys.has(lfItemKey(item)),
  );

  const startReplace = useMutation({
    mutationFn: (asDryRun: boolean) =>
      startLargeFilesReplace({
        items: selectedItems,
        confirmation,
        dryRun: asDryRun,
      }),
    onSuccess: (data, asDryRun) => {
      setRunId(data.run.id);
      setConfirmation('');
      if (!asDryRun) setSelectedKeys(new Set());
      toast.success(asDryRun ? 'Dry-run started' : 'Replacement started');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const armed =
    dryRun ||
    confirmation.trim() === String(selectedItems.length) ||
    confirmation.trim().toUpperCase() === 'PRUNE';

  return (
    <div className={CARD_CLASS}>
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-white/70">
            Movies and episodes whose files exceed the size threshold. Replacing
            deletes the file, re-monitors{' '}
            <span className="font-bold text-white">
              exactly the affected items
            </span>{' '}
            (episodes: only those episodes, their seasons, and the show), tags
            them <code className="text-[#fde68a]">size-reduction</code>,
            switches them to a size-capped quality profile (movies ~10 GB max,
            episodes 3 GB max preferring 1–2 GB), and triggers a fresh search
            for a smaller copy.
          </p>
          <FaqPill section="cutting-room-large-files" label="Large Files" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-white/80">
            Larger than
            <input
              type="number"
              min={1}
              step={1}
              value={thresholdGb}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setThresholdGb(Math.max(1, Number(e.target.value) || 10))
              }
              className="w-20 rounded-xl bg-black/30 border border-white/15 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#facc15]/50"
            />
            GB
          </label>
          <button
            type="button"
            onClick={() => {
              setAppliedThreshold(thresholdGb);
              setSelectedKeys(new Set());
            }}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25`}
          >
            Scan
          </button>
          <button
            type="button"
            onClick={() =>
              setSelectedKeys(
                selectedItems.length === items.length
                  ? new Set()
                  : new Set(items.map((item) => lfItemKey(item))),
              )
            }
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-white/5 text-white/70 border-white/10`}
          >
            {selectedItems.length === items.length && items.length > 0
              ? 'Clear selection'
              : `Select all ${items.length}`}
          </button>
          <span className="text-xs text-white/50">
            {items.length} files · {fmtBytes(totalBytes)} total
          </span>
        </div>
      </div>

      {largeQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/60 p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning file sizes…
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-white/50 text-sm">
          Nothing over {appliedThreshold} GB — your files are already lean.
        </div>
      ) : (
        <LargeFilesTable
          items={items}
          selectedKeys={selectedKeys}
          onToggle={(key) =>
            setSelectedKeys((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        />
      )}

      <div className="p-4 border-t border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={() => setDryRun((v) => !v)}
              className="h-4 w-4 accent-[#facc15]"
            />
            Dry run first
          </label>
          {!dryRun && selectedItems.length > 0 ? (
            <input
              value={confirmation}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setConfirmation(e.target.value)
              }
              placeholder={`type ${selectedItems.length} to arm`}
              className="rounded-xl bg-black/30 border border-white/15 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 w-36"
            />
          ) : null}
          {run && !runFinished ? (
            <span className="flex items-center gap-2 text-xs text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> working…
            </span>
          ) : null}
          {runFinished && runHeadline ? (
            <span className="text-xs text-emerald-200">{runHeadline}</span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={selectedItems.length === 0 || !armed || startReplace.isPending}
          onClick={() => {
            if (dryRun) startReplace.mutate(true);
            else setConfirmOpen(true);
          }}
          className={[
            APP_PRESSABLE_CLASS,
            'px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-40',
            dryRun
              ? 'bg-sky-500/20 text-sky-100 border border-sky-500/30'
              : 'bg-rose-500/90 text-white',
          ].join(' ')}
        >
          {dryRun
            ? 'Rehearse replacement'
            : `Replace ${selectedItems.length || ''} files`}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          startReplace.mutate(false);
        }}
        title={`Replace ${selectedItems.length} oversized files (${fmtBytes(selectedItems.reduce((sum, item) => sum + item.sizeBytes, 0))})?`}
        label="Large Files"
        variant="danger"
        description="Files are deleted, exactly the affected items are re-monitored (episodes: only those episodes, their seasons, and the show), tagged size-reduction, and a fresh search grabs smaller copies automatically."
        confirmText="Replace"
        confirming={startReplace.isPending}
      />
    </div>
  );
}
