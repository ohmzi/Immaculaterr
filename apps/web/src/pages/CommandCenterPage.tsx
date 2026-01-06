import { SettingsPage } from '@/pages/VaultPage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ExternalLink, Film, Info, Loader2, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRadarrOptions, getSonarrOptions } from '@/api/integrations';
import { getPublicSettings, putSettings } from '@/api/settings';
import { RadarrLogo, SonarrLogo } from '@/components/ArrLogos';
import { FunCountSlider } from '@/components/FunCountSlider';
import { SavingPill } from '@/components/SavingPill';
import { FunSplitSlider } from '@/components/FunSplitSlider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

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
    readNumber(settingsQuery.data?.settings, 'recommendations.count') ?? 50;
  const savedUpcomingPercentRaw =
    readNumber(settingsQuery.data?.settings, 'recommendations.upcomingPercent') ?? 25;
  const savedUpcomingPercent = Math.max(0, Math.min(75, Math.trunc(savedUpcomingPercentRaw)));

  const [draftRecommendationCount, setDraftRecommendationCount] = useState<number>(50);
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
      Math.trunc(Number.isFinite(draftRecommendationCount) ? draftRecommendationCount : 50),
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
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-purple-300">
                    <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                      <Film className="w-7 h-7" />
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold text-white">Recommendations</h2>
                  <div className="flex items-center gap-2">
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
                    ) : null}

                    <SavingPill
                      active={saveRecommendationsMutation.isPending}
                      className="shrink-0"
                    />
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
                            Released target: {releasedTarget}
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-purple-500/10 text-purple-200 border border-purple-500/20">
                            Upcoming target: {upcomingTarget}
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
            </div>
          </div>

          {/* Radarr */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-purple-500/10 focus-within:border-white/15 focus-within:shadow-purple-500/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-purple-500/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-[#facc15]">
                    <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                      <RadarrLogo className="w-7 h-7" />
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold text-white">Radarr</h2>
                  <div className="flex items-center gap-2">
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
                      className="shrink-0"
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
                            <select
                              value={draftRootFolderPath || effectiveDefaults.rootFolderPath}
                      onChange={(e) => {
                                const next = e.target.value;
                                setDraftRootFolderPath(next);
                                saveRadarrDefaultsMutation.mutate({
                                  defaultRootFolderPath: next,
                                });
                              }}
                              disabled={
                                saveRadarrDefaultsMutation.isPending ||
                                !radarrOptionsQuery.data?.rootFolders.length
                              }
                              className="w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition"
                            >
                              {(radarrOptionsQuery.data?.rootFolders ?? []).map((rf) => (
                                <option key={rf.id} value={rf.path}>
                                  {rf.path}
                                </option>
                              ))}
                            </select>
              </div>

                  <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Quality profile
                            </label>
                            <select
                              value={String(
                                draftQualityProfileId || effectiveDefaults.qualityProfileId,
                              )}
                      onChange={(e) => {
                                const next = Number.parseInt(e.target.value, 10);
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
                              className="w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition"
                            >
                              {(radarrOptionsQuery.data?.qualityProfiles ?? []).map((qp) => (
                                <option key={qp.id} value={String(qp.id)}>
                                  {qp.name}
                                </option>
                              ))}
                            </select>
                </div>

                        <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Tag (optional)
                            </label>
                            <select
                              value={draftTagId ? String(draftTagId) : ''}
                            onChange={(e) => {
                                const raw = e.target.value;
                                const next = raw ? Number.parseInt(raw, 10) : null;
                                setDraftTagId(
                                  Number.isFinite(next ?? NaN) ? (next as number) : null,
                                );
                                saveRadarrDefaultsMutation.mutate({
                                  defaultTagId:
                                    Number.isFinite(next ?? NaN) ? (next as number) : null,
                                });
                              }}
                              disabled={saveRadarrDefaultsMutation.isPending}
                              className="w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition"
                            >
                              <option value="">No tag</option>
                              {(radarrOptionsQuery.data?.tags ?? []).map((t) => (
                                <option key={t.id} value={String(t.id)}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
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
              <div className="min-w-0">
                  <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-sky-400">
                    <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                      <SonarrLogo className="w-7 h-7" />
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold text-white">Sonarr</h2>
                  <div className="flex items-center gap-2">
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
                      className="shrink-0"
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
                            <select
                              value={
                                sonarrDraftRootFolderPath || sonarrEffectiveDefaults.rootFolderPath
                              }
                            onChange={(e) => {
                                const next = e.target.value;
                                setSonarrDraftRootFolderPath(next);
                                saveSonarrDefaultsMutation.mutate({
                                  defaultRootFolderPath: next,
                                });
                              }}
                      disabled={
                                saveSonarrDefaultsMutation.isPending ||
                                !sonarrOptionsQuery.data?.rootFolders.length
                              }
                              className="w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition"
                            >
                              {(sonarrOptionsQuery.data?.rootFolders ?? []).map((rf) => (
                                <option key={rf.id} value={rf.path}>
                                  {rf.path}
                                </option>
                              ))}
                            </select>
                </div>

                        <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Quality profile
                            </label>
                            <select
                              value={String(
                                sonarrDraftQualityProfileId ||
                                  sonarrEffectiveDefaults.qualityProfileId,
                              )}
                            onChange={(e) => {
                                const next = Number.parseInt(e.target.value, 10);
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
                              className="w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition"
                            >
                              {(sonarrOptionsQuery.data?.qualityProfiles ?? []).map((qp) => (
                                <option key={qp.id} value={String(qp.id)}>
                                  {qp.name}
                                </option>
                              ))}
                            </select>
                </div>

                        <div>
                            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Tag (optional)
                            </label>
                            <select
                              value={sonarrDraftTagId ? String(sonarrDraftTagId) : ''}
                            onChange={(e) => {
                                const raw = e.target.value;
                                const next = raw ? Number.parseInt(raw, 10) : null;
                                setSonarrDraftTagId(
                                  Number.isFinite(next ?? NaN) ? (next as number) : null,
                                );
                                saveSonarrDefaultsMutation.mutate({
                                  defaultTagId:
                                    Number.isFinite(next ?? NaN) ? (next as number) : null,
                                });
                              }}
                              disabled={saveSonarrDefaultsMutation.isPending}
                              className="w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition"
                            >
                              <option value="">No tag</option>
                              {(sonarrOptionsQuery.data?.tags ?? []).map((t) => (
                                <option key={t.id} value={String(t.id)}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
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


