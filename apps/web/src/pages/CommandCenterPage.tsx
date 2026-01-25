import { SettingsPage } from '@/pages/VaultPage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import {
  CircleAlert,
  ExternalLink,
  Film,
  Info,
  Loader2,
  RotateCcw,
  Settings2,
  Tv,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { getRadarrOptions, getSonarrOptions } from '@/api/integrations';
import {
  getImmaculateTasteCollections,
  getImmaculateTasteUserSummary,
  resetImmaculateTasteCollection,
  resetImmaculateTasteUserCollection,
} from '@/api/immaculate';
import {
  resetRejectedSuggestions,
  listRejectedSuggestions,
  deleteRejectedSuggestion,
  type RejectedSuggestionItem,
} from '@/api/observatory';
import { getPublicSettings, putSettings } from '@/api/settings';
import { RadarrLogo, SonarrLogo } from '@/components/ArrLogos';
import { FunCountSlider } from '@/components/FunCountSlider';
import { SavingPill } from '@/components/SavingPill';
import { FunSplitSlider } from '@/components/FunSplitSlider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { APP_HEADER_STATUS_PILL_BASE_CLASS } from '@/lib/ui-classes';

function readBool(obj: unknown, path: string): boolean | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'boolean' ? cur : null;
}

function readString(obj: unknown, path: string): string {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur.trim() : '';
}

function readNumber(obj: unknown, path: string): number | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === 'number' && Number.isFinite(cur)) return cur;
  if (typeof cur === 'string' && cur.trim()) {
    const n = Number.parseInt(cur.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function CommandCenterPage() {
  const queryClient = useQueryClient();
  const [immaculateResetTarget, setImmaculateResetTarget] = useState<{
    mediaType: 'movie' | 'tv';
    librarySectionKey: string;
    libraryTitle: string;
    dataset: { total: number; active: number; pending: number };
    plex: {
      collectionName: string;
      collectionRatingKey: string | null;
      itemCount: number | null;
    };
  } | null>(null);
  const [activeImmaculateUserId, setActiveImmaculateUserId] = useState<string | null>(
    null,
  );
  const [immaculateUserResetTarget, setImmaculateUserResetTarget] = useState<{
    plexUserId: string;
    plexUserTitle: string;
    mediaType: 'movie' | 'tv';
    total: number;
  } | null>(null);
  const [rejectedResetOpen, setRejectedResetOpen] = useState(false);
  const [rejectedListOpen, setRejectedListOpen] = useState(false);
  const [rejectedMediaTab, setRejectedMediaTab] = useState<'movie' | 'tv'>('movie');
  const [rejectedKind, setRejectedKind] = useState<
    'all' | 'immaculateTaste' | 'recentlyWatched' | 'changeOfTaste'
  >('all');
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const immaculateCollectionsQuery = useQuery({
    queryKey: ['immaculateTaste', 'collections'],
    queryFn: getImmaculateTasteCollections,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const immaculateUsersQuery = useQuery({
    queryKey: ['immaculateTaste', 'users'],
    queryFn: getImmaculateTasteUserSummary,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const resetImmaculateMutation = useMutation({
    mutationFn: resetImmaculateTasteCollection,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'collections'] });
      void queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'users'] });
    },
  });

  const resetImmaculateUserMutation = useMutation({
    mutationFn: resetImmaculateTasteUserCollection,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'collections'] });
      void queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'users'] });
      toast.success(
        `${data.plexUserTitle} ${data.mediaType === 'movie' ? 'movies' : 'TV'} reset (${data.dataset.deleted} removed).`,
      );
    },
  });

  const resetRejectedMutation = useMutation({
    mutationFn: resetRejectedSuggestions,
    onSuccess: (data) => {
      toast.success(`Rejected list reset (${data.deleted} removed).`);
      // Observatory pages should refresh their decks next time they mount.
      void queryClient.invalidateQueries({ queryKey: ['observatory'] });
    },
  });

  const rejectedListQuery = useQuery({
    queryKey: ['observatory', 'rejected'],
    queryFn: listRejectedSuggestions,
    enabled: rejectedListOpen,
    staleTime: 0,
    retry: 1,
  });

  const deleteRejectedMutation = useMutation({
    mutationFn: async (id: string) => await deleteRejectedSuggestion(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['observatory', 'rejected'] });
    },
  });

  const filteredRejectedItems = useMemo<RejectedSuggestionItem[]>(() => {
    const items = rejectedListQuery.data?.items ?? [];
    return items
      .filter((i) => i.mediaType === rejectedMediaTab)
      .filter((i) => (rejectedKind === 'all' ? true : i.collectionKind === rejectedKind));
  }, [rejectedListQuery.data?.items, rejectedMediaTab, rejectedKind]);

  const immaculateUsers = immaculateUsersQuery.data?.users ?? [];
  const adminImmaculateUser =
    immaculateUsers.find((user) => user.isAdmin) ?? immaculateUsers[0] ?? null;
  const nonAdminImmaculateUsers = immaculateUsers.filter((user) => !user.isAdmin);
  const hasMultipleImmaculateUsers = immaculateUsers.length > 1;

  const kindLabel = (k: RejectedSuggestionItem['collectionKind']) => {
    if (k === 'immaculateTaste') return 'Immaculate Taste';
    if (k === 'changeOfTaste') return 'Change of Taste';
    return 'Recently Watched';
  };

  const secretsPresent = settingsQuery.data?.secretsPresent ?? {};

  const radarrEnabledFlag = readBool(settingsQuery.data?.settings, 'radarr.enabled');
  const radarrBaseUrl = readString(settingsQuery.data?.settings, 'radarr.baseUrl');
  const radarrHasSecret = Boolean(secretsPresent.radarr);
  // Back-compat: if radarr.enabled isn't set, treat "secret present" as enabled.
  const radarrEnabled = (radarrEnabledFlag ?? radarrHasSecret) && Boolean(radarrBaseUrl) && radarrHasSecret;

  const radarrOptionsQuery = useQuery({
    queryKey: ['integrations', 'radarr', 'options'],
    queryFn: getRadarrOptions,
    enabled: radarrEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const configuredRootFolderPath = readString(
    settingsQuery.data?.settings,
    'radarr.defaultRootFolderPath',
  );
  const configuredQualityProfileId =
    readNumber(settingsQuery.data?.settings, 'radarr.defaultQualityProfileId') ?? null;
  const configuredTagId =
    readNumber(settingsQuery.data?.settings, 'radarr.defaultTagId') ?? null;

  const effectiveDefaults = useMemo(() => {
    const opts = radarrOptionsQuery.data;
    const rootFolders = opts?.rootFolders ?? [];
    const qualityProfiles = opts?.qualityProfiles ?? [];
    const tags = opts?.tags ?? [];

    const rootFolderPath =
      (configuredRootFolderPath &&
        rootFolders.some((r) => r.path === configuredRootFolderPath) &&
        configuredRootFolderPath) ||
      (rootFolders[0]?.path ?? '');

    const qualityProfileId = (() => {
      if (
        configuredQualityProfileId &&
        qualityProfiles.some((p) => p.id === configuredQualityProfileId)
      )
        return configuredQualityProfileId;
      if (qualityProfiles.some((p) => p.id === 1)) return 1;
      return qualityProfiles[0]?.id ?? 1;
    })();

    const tagId =
      configuredTagId && tags.some((t) => t.id === configuredTagId)
        ? configuredTagId
        : null;

    return { rootFolderPath, qualityProfileId, tagId };
  }, [
    configuredRootFolderPath,
    configuredQualityProfileId,
    configuredTagId,
    radarrOptionsQuery.data,
  ]);

  const didInitRadarrDefaults = useRef(false);
  const [draftRootFolderPath, setDraftRootFolderPath] = useState('');
  const [draftQualityProfileId, setDraftQualityProfileId] = useState<number>(1);
  const [draftTagId, setDraftTagId] = useState<number | null>(null);

  useEffect(() => {
    if (!radarrEnabled) {
      didInitRadarrDefaults.current = false;
      return;
    }
    if (!radarrOptionsQuery.data) return;
    if (didInitRadarrDefaults.current) return;
    didInitRadarrDefaults.current = true;
    setDraftRootFolderPath(effectiveDefaults.rootFolderPath);
    setDraftQualityProfileId(effectiveDefaults.qualityProfileId);
    setDraftTagId(effectiveDefaults.tagId);
  }, [radarrEnabled, radarrOptionsQuery.data, effectiveDefaults]);

  const saveRadarrDefaultsMutation = useMutation({
    mutationFn: async (patch: {
      defaultRootFolderPath?: string;
      defaultQualityProfileId?: number;
      defaultTagId?: number | null;
    }) =>
      putSettings({
        settings: {
          radarr: patch,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });

  const sonarrEnabledFlag = readBool(settingsQuery.data?.settings, 'sonarr.enabled');
  const sonarrBaseUrl = readString(settingsQuery.data?.settings, 'sonarr.baseUrl');
  const sonarrHasSecret = Boolean(secretsPresent.sonarr);
  // Back-compat: if sonarr.enabled isn't set, treat "secret present" as enabled.
  const sonarrEnabled =
    (sonarrEnabledFlag ?? sonarrHasSecret) &&
    Boolean(sonarrBaseUrl) &&
    sonarrHasSecret;

  const sonarrOptionsQuery = useQuery({
    queryKey: ['integrations', 'sonarr', 'options'],
    queryFn: getSonarrOptions,
    enabled: sonarrEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const configuredSonarrRootFolderPath = readString(
    settingsQuery.data?.settings,
    'sonarr.defaultRootFolderPath',
  );
  const configuredSonarrQualityProfileId =
    readNumber(settingsQuery.data?.settings, 'sonarr.defaultQualityProfileId') ??
    null;
  const configuredSonarrTagId =
    readNumber(settingsQuery.data?.settings, 'sonarr.defaultTagId') ?? null;

  const sonarrEffectiveDefaults = useMemo(() => {
    const opts = sonarrOptionsQuery.data;
    const rootFolders = opts?.rootFolders ?? [];
    const qualityProfiles = opts?.qualityProfiles ?? [];
    const tags = opts?.tags ?? [];

    const rootFolderPath =
      (configuredSonarrRootFolderPath &&
        rootFolders.some((r) => r.path === configuredSonarrRootFolderPath) &&
        configuredSonarrRootFolderPath) ||
      (rootFolders[0]?.path ?? '');

    const qualityProfileId = (() => {
      if (
        configuredSonarrQualityProfileId &&
        qualityProfiles.some((p) => p.id === configuredSonarrQualityProfileId)
      )
        return configuredSonarrQualityProfileId;
      if (qualityProfiles.some((p) => p.id === 1)) return 1;
      return qualityProfiles[0]?.id ?? 1;
    })();

    const tagId =
      configuredSonarrTagId && tags.some((t) => t.id === configuredSonarrTagId)
        ? configuredSonarrTagId
        : null;

    return { rootFolderPath, qualityProfileId, tagId };
  }, [
    configuredSonarrRootFolderPath,
    configuredSonarrQualityProfileId,
    configuredSonarrTagId,
    sonarrOptionsQuery.data,
  ]);

  const didInitSonarrDefaults = useRef(false);
  const [sonarrDraftRootFolderPath, setSonarrDraftRootFolderPath] = useState('');
  const [sonarrDraftQualityProfileId, setSonarrDraftQualityProfileId] = useState<number>(1);
  const [sonarrDraftTagId, setSonarrDraftTagId] = useState<number | null>(null);

  useEffect(() => {
    if (!sonarrEnabled) {
      didInitSonarrDefaults.current = false;
        return;
      }
    if (!sonarrOptionsQuery.data) return;
    if (didInitSonarrDefaults.current) return;
    didInitSonarrDefaults.current = true;
    setSonarrDraftRootFolderPath(sonarrEffectiveDefaults.rootFolderPath);
    setSonarrDraftQualityProfileId(sonarrEffectiveDefaults.qualityProfileId);
    setSonarrDraftTagId(sonarrEffectiveDefaults.tagId);
  }, [sonarrEnabled, sonarrOptionsQuery.data, sonarrEffectiveDefaults]);

  const saveSonarrDefaultsMutation = useMutation({
    mutationFn: async (patch: {
      defaultRootFolderPath?: string;
      defaultQualityProfileId?: number;
      defaultTagId?: number | null;
    }) =>
      putSettings({
        settings: {
          sonarr: patch,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });

  const didInitRecommendations = useRef(false);
  const savedRecommendationCount =
    readNumber(settingsQuery.data?.settings, 'recommendations.count') ?? 10;
  const savedUpcomingPercentRaw =
    readNumber(settingsQuery.data?.settings, 'recommendations.upcomingPercent') ?? 25;
  const savedUpcomingPercent = Math.max(0, Math.min(75, Math.trunc(savedUpcomingPercentRaw)));

  const [draftRecommendationCount, setDraftRecommendationCount] = useState<number>(10);
  const [draftUpcomingPercent, setDraftUpcomingPercent] = useState<number>(25);

  useEffect(() => {
    if (!settingsQuery.data?.settings) return;
    if (didInitRecommendations.current) return;
    didInitRecommendations.current = true;
    setDraftRecommendationCount(
      Math.max(5, Math.min(100, Math.trunc(savedRecommendationCount))),
    );
    setDraftUpcomingPercent(savedUpcomingPercent);
  }, [settingsQuery.data?.settings, savedRecommendationCount, savedUpcomingPercent]);

  const saveRecommendationsMutation = useMutation({
    mutationFn: async (patch: { count?: number; upcomingPercent?: number }) =>
      putSettings({
        settings: {
          recommendations: patch,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });

  const effectiveRecommendationCount = Math.max(
    5,
    Math.min(
      100,
      Math.trunc(Number.isFinite(draftRecommendationCount) ? draftRecommendationCount : 10),
    ),
  );
  const effectiveUpcomingPercent = Math.max(
    0,
    Math.min(75, Math.trunc(draftUpcomingPercent || 0)),
  );
  const effectiveReleasedPercent = 100 - effectiveUpcomingPercent;
  const upcomingTargetRaw = Math.round(
    (effectiveRecommendationCount * effectiveUpcomingPercent) / 100,
  );
  const minReleasedTarget = Math.ceil((effectiveRecommendationCount * 25) / 100);
  const maxUpcomingTarget = Math.max(0, effectiveRecommendationCount - minReleasedTarget);
  const upcomingTarget = Math.max(0, Math.min(upcomingTargetRaw, maxUpcomingTarget));
  const releasedTarget = Math.max(0, effectiveRecommendationCount - upcomingTarget);

  const renderAdminCollectionList = () => (
    <div className="space-y-3">
      {(immaculateCollectionsQuery.data?.collections ?? []).map((c) => {
        const typeLabel = c.mediaType === 'movie' ? 'Movie' : 'TV';
        const plexLabel =
          c.plex.collectionRatingKey
            ? typeof c.plex.itemCount === 'number'
              ? `${c.plex.itemCount} items`
              : '—'
            : 'Not found';

        return (
          <div
            key={`${c.mediaType}:${c.librarySectionKey}`}
            className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/70">
                  {typeLabel}
                </span>
                <div className="truncate text-sm font-semibold text-white">
                  {c.libraryTitle}
                </div>
              </div>
              <div className="mt-1 text-xs text-white/60">
                Plex: {plexLabel} • Dataset: {c.dataset.total} tracked (
                {c.dataset.active} active, {c.dataset.pending} pending)
              </div>
            </div>

            <button
              type="button"
              disabled={resetImmaculateMutation.isPending}
              onClick={() => {
                setImmaculateResetTarget({
                  mediaType: c.mediaType,
                  librarySectionKey: c.librarySectionKey,
                  libraryTitle: c.libraryTitle,
                  dataset: c.dataset,
                  plex: c.plex,
                });
              }}
              className="inline-flex items-center gap-2 shrink-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
            >
              {resetImmaculateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Reset
            </button>
          </div>
        );
      })}

      {!immaculateCollectionsQuery.isLoading &&
      !immaculateCollectionsQuery.isError &&
      (immaculateCollectionsQuery.data?.collections ?? []).length === 0 ? (
        <div className="text-sm text-white/60">No Plex libraries found.</div>
      ) : null}
    </div>
  );

  return (
    <SettingsPage
      pageTitle="Command Center"
      headerIcon={
        <Settings2
          className="w-8 h-8 md:w-10 md:h-10 text-black"
          strokeWidth={2.5}
        />
      }
      backgroundGradientClass="bg-gradient-to-br from-sky-900/55 via-cyan-900/60 to-slate-900/75"
      subtitle={
        <>
          Tweak, tune, and turbocharge your{' '}
          <span className="text-[#facc15] font-bold">setup</span>.
        </>
      }
      subtitleDetails={<>Remember: With great power comes great uptime.</>}
      extraContent={
        <div className="space-y-6">
          {/* Recommendations */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-purple-500/10 focus-within:border-white/15 focus-within:shadow-purple-500/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-purple-500/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-purple-300">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <Film className="w-7 h-7" />
                  </span>
                </div>
                <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                  Recommendations
                </h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {settingsQuery.isLoading ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}>
                    Checking…
                  </span>
                ) : settingsQuery.isError ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}>
                    Error
                  </span>
                ) : null}

                <SavingPill active={saveRecommendationsMutation.isPending} className="static" />
              </div>
            </div>

            {settingsQuery.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Couldn’t load settings. Please refresh and try again.</span>
              </div>
            ) : (
              <>
                    <p className="mt-3 text-sm text-white/70 leading-relaxed">
                      Set how many to generate, then slide the mix:{' '}
                      <span className="text-white">released</span> vs{' '}
                      <span className="text-white">upcoming</span>.
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label="Recommendations info"
                            className="ml-2 inline-flex align-middle items-center justify-center w-7 h-7 rounded-full border border-white/10 bg-white/5 text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-72 bg-[#0F0B15] border-white/10 text-white shadow-2xl"
                        >
                          <div className="space-y-2 text-sm text-white/80">
                            <div>Used by Immaculate Taste + Recently Watched.</div>
                            <div>Released stays ≥ 25%.</div>
                            <div>Count can’t go below 5.</div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </p>

                    <div className="mt-6 space-y-8">
                      {/* Count */}
                      <div className="space-y-3">
                        <div className="flex items-end justify-between gap-4">
                          <label className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                            Recommendation count
                          </label>
                        </div>

                        <FunCountSlider
                          value={effectiveRecommendationCount}
                          min={0}
                          max={100}
                          disabled={saveRecommendationsMutation.isPending}
                          onValueChange={(next) => {
                            const clamped = Number.isFinite(next)
                              ? Math.max(5, Math.min(100, Math.trunc(next)))
                              : 50;
                            setDraftRecommendationCount(clamped);
                          }}
                          onValueCommit={(next) => {
                            const clamped = Number.isFinite(next)
                              ? Math.max(5, Math.min(100, Math.trunc(next)))
                              : 50;
                            saveRecommendationsMutation.mutate({ count: clamped });
                          }}
                          aria-label="Recommendation count"
                        />
                      </div>

                      {/* Split */}
                      <div className="space-y-3">
                        <FunSplitSlider
                          value={effectiveReleasedPercent}
                          min={25}
                          max={100}
                          disabled={saveRecommendationsMutation.isPending}
                          onValueChange={(releasedPct) => {
                            const clampedReleased = Number.isFinite(releasedPct)
                              ? Math.max(25, Math.min(100, Math.trunc(releasedPct)))
                              : 75;
                            const nextUpcoming = Math.max(
                              0,
                              Math.min(75, Math.trunc(100 - clampedReleased)),
                            );
                            setDraftUpcomingPercent(nextUpcoming);
                          }}
                          onValueCommit={(releasedPct) => {
                            const clampedReleased = Number.isFinite(releasedPct)
                              ? Math.max(25, Math.min(100, Math.trunc(releasedPct)))
                              : 75;
                            const nextUpcoming = Math.max(
                              0,
                              Math.min(75, Math.trunc(100 - clampedReleased)),
                            );
                            saveRecommendationsMutation.mutate({
                              upcomingPercent: nextUpcoming,
                            });
                          }}
                          aria-label="Distribution split (released percent)"
                        />

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-emerald-500/10 text-emerald-200 border border-emerald-500/20">
                            Ready to watch: {releasedTarget}
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-purple-500/10 text-purple-200 border border-purple-500/20">
                            On the horizon: {upcomingTarget}
                          </span>
                        </div>

                        {saveRecommendationsMutation.isError ? (
                          <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{(saveRecommendationsMutation.error as Error).message}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
              </>
            )}
          </div>

          {/* Reset Immaculate Taste */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-amber-400/10 focus-within:border-white/15 focus-within:shadow-amber-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-amber-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-amber-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <RotateCcw className="w-7 h-7" />
                  </span>
                </div>
                <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                  Reset Immaculate Taste Collection
                </h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {immaculateCollectionsQuery.isLoading ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}>
                    Checking…
                  </span>
                ) : immaculateCollectionsQuery.isError ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}>
                    Error
                  </span>
                ) : null}

                <SavingPill active={resetImmaculateMutation.isPending} className="static" />
              </div>
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              {hasMultipleImmaculateUsers
                ? 'Select a Plex user. Admin shows per-library resets, other users reset by media type.'
                : 'Pick a library to reset. This removes the Plex collection and clears its dataset.'}
            </p>

            {immaculateCollectionsQuery.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Couldn’t load Immaculate Taste status. Check Plex settings.</span>
              </div>
            ) : null}

            {hasMultipleImmaculateUsers ? (
              <div className="mt-5 space-y-3">
                {adminImmaculateUser ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveImmaculateUserId((prev) =>
                          prev === adminImmaculateUser.id ? null : adminImmaculateUser.id,
                        )
                      }
                      className="w-full flex items-center justify-between gap-4 text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-[#facc15]/15 text-[#facc15] border border-[#facc15]/30">
                            Admin
                          </span>
                          <div className="text-sm font-semibold text-white truncate">
                            {adminImmaculateUser.plexAccountTitle || 'Admin'}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-white/60">
                          Movie: {adminImmaculateUser.movieCount} • TV: {adminImmaculateUser.tvCount}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-white/60">
                        {activeImmaculateUserId === adminImmaculateUser.id ? 'Hide' : 'View'}
                      </span>
                    </button>

                    {activeImmaculateUserId === adminImmaculateUser.id ? (
                      <div className="mt-4">{renderAdminCollectionList()}</div>
                    ) : null}
                  </div>
                ) : null}

                {nonAdminImmaculateUsers.map((user) => {
                  const isActive = activeImmaculateUserId === user.id;
                  const movieCount = user.movieCount ?? 0;
                  const tvCount = user.tvCount ?? 0;
                  return (
                    <div
                      key={user.id}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setActiveImmaculateUserId((prev) => (prev === user.id ? null : user.id))
                        }
                        className="w-full flex items-center justify-between gap-4 text-left"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">
                            {user.plexAccountTitle || 'Plex User'}
                          </div>
                          <div className="mt-1 text-xs text-white/60">
                            Movie: {movieCount} • TV: {tvCount}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-white/60">
                          {isActive ? 'Hide' : 'View'}
                        </span>
                      </button>

                      {isActive ? (
                        <div className="mt-4 overflow-x-auto">
                          <table className="min-w-[420px] w-full text-sm text-white/80 border border-white/10 rounded-2xl overflow-hidden bg-white/5">
                            <thead className="text-[11px] uppercase tracking-wider text-white/50">
                              <tr className="bg-white/5">
                                <th className="px-4 py-3 text-left font-semibold">User</th>
                                <th className="px-4 py-3 text-left font-semibold">Movie</th>
                                <th className="px-4 py-3 text-left font-semibold">TV Shows</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-t border-white/10">
                                <td className="px-4 py-3 font-semibold text-white">
                                  {user.plexAccountTitle || 'Plex User'}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs text-white/70">
                                      {movieCount} items
                                    </span>
                                    <button
                                      type="button"
                                      disabled={resetImmaculateUserMutation.isPending || movieCount === 0}
                                      onClick={() =>
                                        setImmaculateUserResetTarget({
                                          plexUserId: user.id,
                                          plexUserTitle: user.plexAccountTitle || 'Plex User',
                                          mediaType: 'movie',
                                          total: movieCount,
                                        })
                                      }
                                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                      Reset
                                    </button>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs text-white/70">{tvCount} items</span>
                                    <button
                                      type="button"
                                      disabled={resetImmaculateUserMutation.isPending || tvCount === 0}
                                      onClick={() =>
                                        setImmaculateUserResetTarget({
                                          plexUserId: user.id,
                                          plexUserTitle: user.plexAccountTitle || 'Plex User',
                                          mediaType: 'tv',
                                          total: tvCount,
                                        })
                                      }
                                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                      Reset
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5">{renderAdminCollectionList()}</div>
            )}
          </div>

          {/* Reset Rejected List */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-red-400/10 focus-within:border-white/15 focus-within:shadow-red-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-red-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-rose-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <RotateCcw className="w-7 h-7" />
                  </span>
                </div>
                <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                  Reset Rejected List
                </h2>
              </div>

              <SavingPill active={resetRejectedMutation.isPending} className="static" />
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Clears your Observatory rejected list so previously swiped-left suggestions can show up
              again.
            </p>

            {resetRejectedMutation.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{(resetRejectedMutation.error as Error).message}</span>
              </div>
            ) : null}

            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setRejectedListOpen(true)}
                  disabled={resetRejectedMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                >
                  <Info className="w-4 h-4" />
                  View rejected list
                </button>

                <button
                  type="button"
                  disabled={resetRejectedMutation.isPending}
                  onClick={() => setRejectedResetOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset rejected list
                </button>
              </div>
            </div>
          </div>

          {/* Reset Immaculate Taste - Confirm Dialog */}
          <AnimatePresence>
            {immaculateResetTarget && (
              <motion.div
                className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (resetImmaculateMutation.isPending) return;
                  setImmaculateResetTarget(null);
                }}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={(e) => e.stopPropagation()}
                  className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-amber-500/10 overflow-hidden"
                >
                  <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Reset
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Immaculate Taste Collection
                        </h2>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-white/10 text-white/75 border border-white/10">
                            {immaculateResetTarget.mediaType === 'movie' ? 'Movie' : 'TV'}
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-white/10 text-white/75 border border-white/10">
                            {immaculateResetTarget.libraryTitle}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (resetImmaculateMutation.isPending) return;
                          setImmaculateResetTarget(null);
                        }}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={resetImmaculateMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-200" />
                        <div className="min-w-0">
                          <div className="text-white/85 font-semibold">
                            This will delete the Plex collection and clear the dataset for this
                            library.
                          </div>
                          <div className="mt-2 text-xs text-white/55">
                            Dataset: {immaculateResetTarget.dataset.total} tracked (
                            {immaculateResetTarget.dataset.active} active,{' '}
                            {immaculateResetTarget.dataset.pending} pending) • Plex:{' '}
                            {immaculateResetTarget.plex.collectionRatingKey
                              ? typeof immaculateResetTarget.plex.itemCount === 'number'
                                ? `${immaculateResetTarget.plex.itemCount} items`
                                : 'Found'
                              : 'Not found'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {resetImmaculateMutation.isError ? (
                      <div className="mt-4 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(resetImmaculateMutation.error as Error).message}</span>
                      </div>
                    ) : null}

                    <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setImmaculateResetTarget(null)}
                        className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetImmaculateMutation.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (resetImmaculateMutation.isPending) return;
                          const target = immaculateResetTarget;
                          if (!target) return;
                          resetImmaculateMutation.mutate(
                            {
                              mediaType: target.mediaType,
                              librarySectionKey: target.librarySectionKey,
                            },
                            {
                              onSuccess: () => setImmaculateResetTarget(null),
                            },
                          );
                        }}
                        className="h-12 rounded-full px-6 bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetImmaculateMutation.isPending}
                      >
                        {resetImmaculateMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Resetting…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Reset
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reset Immaculate Taste (User) - Confirm Dialog */}
          <AnimatePresence>
            {immaculateUserResetTarget && (
              <motion.div
                className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (resetImmaculateUserMutation.isPending) return;
                  setImmaculateUserResetTarget(null);
                }}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={(e) => e.stopPropagation()}
                  className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-amber-500/10 overflow-hidden"
                >
                  <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Reset
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Immaculate Taste (User)
                        </h2>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-white/10 text-white/75 border border-white/10">
                            {immaculateUserResetTarget.mediaType === 'movie' ? 'Movie' : 'TV'}
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-white/10 text-white/75 border border-white/10">
                            {immaculateUserResetTarget.plexUserTitle}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (resetImmaculateUserMutation.isPending) return;
                          setImmaculateUserResetTarget(null);
                        }}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={resetImmaculateUserMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-200" />
                        <div className="min-w-0">
                          <div className="text-white/85 font-semibold">
                            This removes all {immaculateUserResetTarget.mediaType === 'movie' ? 'movie' : 'TV'} entries
                            for this user across every Plex library.
                          </div>
                          <div className="mt-2 text-xs text-white/55">
                            Items: {immaculateUserResetTarget.total}
                          </div>
                        </div>
                      </div>
                    </div>

                    {resetImmaculateUserMutation.isError ? (
                      <div className="mt-4 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(resetImmaculateUserMutation.error as Error).message}</span>
                      </div>
                    ) : null}

                    <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setImmaculateUserResetTarget(null)}
                        className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetImmaculateUserMutation.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (resetImmaculateUserMutation.isPending) return;
                          const target = immaculateUserResetTarget;
                          if (!target) return;
                          resetImmaculateUserMutation.mutate(
                            {
                              plexUserId: target.plexUserId,
                              mediaType: target.mediaType,
                            },
                            {
                              onSuccess: () => setImmaculateUserResetTarget(null),
                            },
                          );
                        }}
                        className="h-12 rounded-full px-6 bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetImmaculateUserMutation.isPending}
                      >
                        {resetImmaculateUserMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Resetting…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Reset
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reset Rejected List - Confirm Dialog */}
          <AnimatePresence>
            {rejectedResetOpen && (
              <motion.div
                className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (resetRejectedMutation.isPending) return;
                  setRejectedResetOpen(false);
                }}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={(e) => e.stopPropagation()}
                  className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-rose-500/10 overflow-hidden"
                >
                  <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Reset
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Rejected List
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (resetRejectedMutation.isPending) return;
                          setRejectedResetOpen(false);
                        }}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={resetRejectedMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-rose-200" />
                        <div className="min-w-0">
                          <div className="text-white/85 font-semibold">
                            This will remove all rejected suggestions for your account.
                          </div>
                          <div className="mt-2 text-xs text-white/55">
                            After resetting, previously rejected cards can appear again in
                            Observatory.
                          </div>
                        </div>
                      </div>
                    </div>

                    {resetRejectedMutation.isError ? (
                      <div className="mt-4 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(resetRejectedMutation.error as Error).message}</span>
                      </div>
                    ) : null}

                    <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setRejectedResetOpen(false)}
                        className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetRejectedMutation.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (resetRejectedMutation.isPending) return;
                          resetRejectedMutation.mutate(undefined, {
                            onSuccess: () => setRejectedResetOpen(false),
                          });
                        }}
                        className="h-12 rounded-full px-6 bg-[#f43f5e] text-white font-bold shadow-[0_0_20px_rgba(244,63,94,0.25)] hover:shadow-[0_0_28px_rgba(244,63,94,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetRejectedMutation.isPending}
                      >
                        {resetRejectedMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Resetting…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Reset
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* View Rejected List Modal */}
          <AnimatePresence>
            {rejectedListOpen && (
              <motion.div
                // Mobile: keep the modal within the visible area between the fixed top bar and bottom nav.
                // Desktop/tablet: center as usual.
                className="fixed inset-0 z-[100000] flex items-start sm:items-center justify-center px-4 pt-20 pb-28 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (deleteRejectedMutation.isPending) return;
                  setRejectedListOpen(false);
                }}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={(e) => e.stopPropagation()}
                  className="relative w-full sm:max-w-3xl max-h-[calc(100dvh-184px)] sm:max-h-[84vh] rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-rose-500/10 overflow-hidden flex flex-col"
                >
                  <div className="p-6 sm:p-7 border-b border-white/10">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Manage
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Rejected Suggestions
                        </h2>
                        <p className="mt-2 text-sm text-white/60">
                          Filter and remove items to let them appear in Observatory again.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (deleteRejectedMutation.isPending) return;
                          setRejectedListOpen(false);
                        }}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={deleteRejectedMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Tabs + filters */}
                    <div className="mt-5 flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setRejectedMediaTab('movie')}
                          className={[
                            'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider border transition',
                            rejectedMediaTab === 'movie'
                              ? 'bg-[#facc15] text-black border-[#facc15]/30'
                              : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                          ].join(' ')}
                        >
                          <Film className="w-4 h-4" />
                          Movies
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectedMediaTab('tv')}
                          className={[
                            'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider border transition',
                            rejectedMediaTab === 'tv'
                              ? 'bg-[#facc15] text-black border-[#facc15]/30'
                              : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                          ].join(' ')}
                        >
                          <Tv className="w-4 h-4" />
                          TV Shows
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(
                          [
                            ['all', 'All'],
                            ['immaculateTaste', 'Immaculate Taste'],
                            ['recentlyWatched', 'Recently Watched'],
                            ['changeOfTaste', 'Change of Taste'],
                          ] as const
                        ).map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setRejectedKind(k)}
                            className={[
                              'inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold border transition',
                              rejectedKind === k
                                ? 'bg-purple-500/20 text-purple-100 border-purple-500/30'
                                : 'bg-white/5 text-white/65 border-white/10 hover:bg-white/10',
                            ].join(' ')}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 sm:p-7">
                    {rejectedListQuery.isLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-white/50" />
                      </div>
                    ) : rejectedListQuery.isError ? (
                      <div className="flex items-start gap-2 text-sm text-red-200/90 py-4">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>Failed to load rejected list. Please try again.</span>
                      </div>
                    ) : filteredRejectedItems.length === 0 ? (
                      <div className="text-center py-12 text-white/50 text-sm">
                        No rejected suggestions found.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredRejectedItems.map((item) => {
                          const title =
                            item.mediaType === 'tv' && item.externalSource === 'tvdb'
                              ? item.externalName ?? 'Unknown show'
                              : item.externalName ??
                                (item.externalSource === 'tmdb'
                                  ? `TMDB ${item.externalId}`
                                  : `${item.externalSource.toUpperCase()}: ${item.externalId}`);
                          return (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="min-w-0 truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-medium text-white/70">
                                    {title}
                                  </span>
                                  <span className="shrink-0 rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 font-medium text-purple-200">
                                    {kindLabel(item.collectionKind)}
                                  </span>
                                </div>
                                <div className="mt-1.5 text-xs text-white/40">
                                  {new Date(item.createdAt).toLocaleDateString()}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  deleteRejectedMutation.mutate(item.id, {
                                    onSuccess: () => toast.success('Removed from rejected list.'),
                                    onError: () => toast.error('Failed to remove.'),
                                  })
                                }
                                disabled={deleteRejectedMutation.isPending}
                                className="shrink-0 w-9 h-9 rounded-xl border border-white/10 bg-white/5 text-white/60 hover:bg-rose-500/20 hover:border-rose-500/30 hover:text-rose-200 transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                                aria-label="Remove from rejected list"
                                title="Remove from rejected list"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="p-6 sm:p-7 border-t border-white/10">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-xs text-white/50">
                        {filteredRejectedItems.length} item{filteredRejectedItems.length === 1 ? '' : 's'}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRejectedListOpen(false)}
                        className="h-10 rounded-full px-5 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98]"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Radarr */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-purple-500/10 focus-within:border-white/15 focus-within:shadow-purple-500/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-purple-500/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-[#facc15]">
                    <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                      <RadarrLogo className="w-7 h-7" />
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">Radarr</h2>
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    {settingsQuery.isLoading ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                      >
                        Checking…
                      </span>
                    ) : settingsQuery.isError ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}
                      >
                        Error
                      </span>
                    ) : radarrEnabled ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-emerald-500/15 text-emerald-200 border-emerald-500/20`}
                      >
                        Enabled
                      </span>
                    ) : (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-yellow-400/10 text-yellow-200 border-yellow-400/20`}
                      >
                        Not set up
                      </span>
                    )}

                    <SavingPill
                      active={saveRadarrDefaultsMutation.isPending}
                      className="static shrink-0"
                    />
                  </div>
                </div>

                {settingsQuery.isError ? (
                  <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                    <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Couldn’t load settings to check Radarr status. Please open{' '}
                      <Link
                        to="/vault#vault-radarr"
                        className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                      >
                        Vault
                      </Link>{' '}
                      and verify your Radarr configuration.
                    </span>
                </div>
                ) : radarrEnabled ? (
                  <>
                    <p className="mt-3 text-sm text-white/70 leading-relaxed">
                      Choose the defaults used when this app sends missing movies to Radarr. Manage
                      the URL and API key in{' '}
                      <Link
                        to="/vault#vault-radarr"
                        className="text-white underline underline-offset-4 hover:text-white/90 transition-colors inline-flex items-center gap-1"
                      >
                        Vault <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                      .
                    </p>

                    <div className="mt-5">
                      {radarrOptionsQuery.isLoading ? (
                        <div className="flex items-center gap-3 text-white/70 text-sm">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading Radarr options…
                        </div>
                      ) : radarrOptionsQuery.isError ? (
                        <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                          <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>
                            Couldn’t load Radarr folders/profiles/tags. Verify your Radarr
                            connection in{' '}
                            <Link
                              to="/vault#vault-radarr"
                              className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                            >
                              Vault
                            </Link>
                            .
                          </span>
                </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Root folder
                            </label>
                          <Select
                            value={draftRootFolderPath || effectiveDefaults.rootFolderPath}
                            onValueChange={(next) => {
                              setDraftRootFolderPath(next);
                              saveRadarrDefaultsMutation.mutate({
                                defaultRootFolderPath: next,
                              });
                            }}
                            disabled={
                              saveRadarrDefaultsMutation.isPending ||
                              !radarrOptionsQuery.data?.rootFolders.length
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select root folder" />
                            </SelectTrigger>
                            <SelectContent>
                              {(radarrOptionsQuery.data?.rootFolders ?? []).map((rf) => (
                                <SelectItem key={rf.id} value={rf.path}>
                                  {rf.path}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
              </div>

                  <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Quality profile
                            </label>
                          <Select
                            value={String(
                              draftQualityProfileId || effectiveDefaults.qualityProfileId,
                            )}
                            onValueChange={(raw) => {
                              const next = Number.parseInt(raw, 10);
                              if (!Number.isFinite(next)) return;
                              setDraftQualityProfileId(next);
                              saveRadarrDefaultsMutation.mutate({
                                defaultQualityProfileId: next,
                              });
                            }}
                            disabled={
                              saveRadarrDefaultsMutation.isPending ||
                              !radarrOptionsQuery.data?.qualityProfiles.length
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select quality profile" />
                            </SelectTrigger>
                            <SelectContent>
                              {(radarrOptionsQuery.data?.qualityProfiles ?? []).map((qp) => (
                                <SelectItem key={qp.id} value={String(qp.id)}>
                                  {qp.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                </div>

                        <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Tag (optional)
                            </label>
                          <Select
                            value={draftTagId !== null ? String(draftTagId) : 'none'}
                            onValueChange={(raw) => {
                              const parsed = raw === 'none' ? null : Number.parseInt(raw, 10);
                              const next = Number.isFinite(parsed ?? NaN)
                                ? (parsed as number)
                                : null;
                              setDraftTagId(next);
                              saveRadarrDefaultsMutation.mutate({
                                defaultTagId: next,
                              });
                            }}
                            disabled={saveRadarrDefaultsMutation.isPending}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="No tag" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tag</SelectItem>
                              {(radarrOptionsQuery.data?.tags ?? []).map((t) => (
                                <SelectItem key={t.id} value={String(t.id)}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                  )}
              </div>

                    {saveRadarrDefaultsMutation.isError ? (
                      <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(saveRadarrDefaultsMutation.error as Error).message}</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-white/70 leading-relaxed">
                    Radarr isn’t set up yet. Please enable and configure{' '}
                    <Link
                      to="/vault#vault-radarr"
                      className="text-white underline underline-offset-4 hover:text-white/90 transition-colors inline-flex items-center gap-1"
                    >
                      Radarr in Vault <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                    .
                  </p>
                )}
                  </div>
                </div>
              </div>

          {/* Sonarr */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-purple-500/10 focus-within:border-white/15 focus-within:shadow-purple-500/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-purple-500/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-sky-400">
                    <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                      <SonarrLogo className="w-7 h-7" />
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">Sonarr</h2>
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    {settingsQuery.isLoading ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                      >
                        Checking…
                      </span>
                    ) : settingsQuery.isError ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}
                      >
                        Error
                      </span>
                    ) : sonarrEnabled ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-emerald-500/15 text-emerald-200 border-emerald-500/20`}
                      >
                        Enabled
                      </span>
                    ) : (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-yellow-400/10 text-yellow-200 border-yellow-400/20`}
                      >
                        Not set up
                      </span>
                    )}

                    <SavingPill
                      active={saveSonarrDefaultsMutation.isPending}
                      className="static shrink-0"
                    />
                  </div>
                </div>

                {settingsQuery.isError ? (
                  <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                    <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Couldn’t load settings to check Sonarr status. Please open{' '}
                      <Link
                        to="/vault#vault-sonarr"
                        className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                      >
                        Vault
                      </Link>{' '}
                      and verify your Sonarr configuration.
                    </span>
                  </div>
                ) : sonarrEnabled ? (
                  <>
                    <p className="mt-3 text-sm text-white/70 leading-relaxed">
                      Choose defaults for Sonarr actions that create or manage series. Manage the
                      URL and API key in{' '}
                      <Link
                        to="/vault#vault-sonarr"
                        className="text-white underline underline-offset-4 hover:text-white/90 transition-colors inline-flex items-center gap-1"
                      >
                        Vault <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                      .
                    </p>

                    <div className="mt-5">
                      {sonarrOptionsQuery.isLoading ? (
                        <div className="flex items-center gap-3 text-white/70 text-sm">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading Sonarr options…
                </div>
                      ) : sonarrOptionsQuery.isError ? (
                        <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                          <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>
                            Couldn’t load Sonarr folders/profiles/tags. Verify your Sonarr
                            connection in{' '}
                            <Link
                              to="/vault#vault-sonarr"
                              className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                            >
                              Vault
                            </Link>
                            .
                          </span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Root folder
                            </label>
                          <Select
                            value={
                              sonarrDraftRootFolderPath || sonarrEffectiveDefaults.rootFolderPath
                            }
                            onValueChange={(next) => {
                              setSonarrDraftRootFolderPath(next);
                              saveSonarrDefaultsMutation.mutate({
                                defaultRootFolderPath: next,
                              });
                            }}
                            disabled={
                              saveSonarrDefaultsMutation.isPending ||
                              !sonarrOptionsQuery.data?.rootFolders.length
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select root folder" />
                            </SelectTrigger>
                            <SelectContent>
                              {(sonarrOptionsQuery.data?.rootFolders ?? []).map((rf) => (
                                <SelectItem key={rf.id} value={rf.path}>
                                  {rf.path}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                </div>

                        <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Quality profile
                            </label>
                          <Select
                            value={String(
                              sonarrDraftQualityProfileId ||
                                sonarrEffectiveDefaults.qualityProfileId,
                            )}
                            onValueChange={(raw) => {
                              const next = Number.parseInt(raw, 10);
                              if (!Number.isFinite(next)) return;
                              setSonarrDraftQualityProfileId(next);
                              saveSonarrDefaultsMutation.mutate({
                                defaultQualityProfileId: next,
                              });
                            }}
                            disabled={
                              saveSonarrDefaultsMutation.isPending ||
                              !sonarrOptionsQuery.data?.qualityProfiles.length
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select quality profile" />
                            </SelectTrigger>
                            <SelectContent>
                              {(sonarrOptionsQuery.data?.qualityProfiles ?? []).map((qp) => (
                                <SelectItem key={qp.id} value={String(qp.id)}>
                                  {qp.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                </div>

                        <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Tag (optional)
                            </label>
                          <Select
                            value={sonarrDraftTagId !== null ? String(sonarrDraftTagId) : 'none'}
                            onValueChange={(raw) => {
                              const parsed = raw === 'none' ? null : Number.parseInt(raw, 10);
                              const next = Number.isFinite(parsed ?? NaN)
                                ? (parsed as number)
                                : null;
                              setSonarrDraftTagId(next);
                              saveSonarrDefaultsMutation.mutate({
                                defaultTagId: next,
                              });
                            }}
                            disabled={saveSonarrDefaultsMutation.isPending}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="No tag" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tag</SelectItem>
                              {(sonarrOptionsQuery.data?.tags ?? []).map((t) => (
                                <SelectItem key={t.id} value={String(t.id)}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                  )}
              </div>

                    {saveSonarrDefaultsMutation.isError ? (
                      <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(saveSonarrDefaultsMutation.error as Error).message}</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-white/70 leading-relaxed">
                    Sonarr isn’t set up yet. Please enable and configure{' '}
                    <Link
                      to="/vault#vault-sonarr"
                      className="text-white underline underline-offset-4 hover:text-white/90 transition-colors inline-flex items-center gap-1"
                    >
                      Sonarr in Vault <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                    .
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      }
      showCards={false}
    />
  );
}


