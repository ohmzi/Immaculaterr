import { SettingsPage } from '@/pages/VaultPage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ExternalLink, Loader2, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRadarrOptions } from '@/api/integrations';
import { getPublicSettings, putSettings } from '@/api/settings';

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
        <div className="rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-semibold text-white">Radarr</h2>
                {settingsQuery.isLoading ? (
                  <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-white/10 text-white/70 border border-white/10">
                    Checking…
                  </span>
                ) : settingsQuery.isError ? (
                  <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-red-500/15 text-red-200 border border-red-500/20">
                    Error
                  </span>
                ) : radarrEnabled ? (
                  <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-emerald-500/15 text-emerald-200 border border-emerald-500/20">
                    Enabled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-yellow-400/10 text-yellow-200 border border-yellow-400/20">
                    Not set up
                  </span>
                )}

                {saveRadarrDefaultsMutation.isPending ? (
                  <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-white/10 text-white/70 border border-white/10">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving…
                  </span>
                ) : null}
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
                          Couldn’t load Radarr folders/profiles/tags. Verify your Radarr connection
                          in{' '}
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
                          <div className="mt-1 text-[11px] text-white/45">
                            Default: first folder (if not configured)
                          </div>
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
                          <div className="mt-1 text-[11px] text-white/45">
                            Default: profile id 1 (if available)
                          </div>
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
                              setDraftTagId(Number.isFinite(next ?? NaN) ? (next as number) : null);
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
                          <div className="mt-1 text-[11px] text-white/45">
                            Leave blank to add without tags
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {saveRadarrDefaultsMutation.isError ? (
                    <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                      <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        {(saveRadarrDefaultsMutation.error as Error).message}
                      </span>
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
      }
      showCards={false}
    />
  );
}


