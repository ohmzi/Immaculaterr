import { useState, useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  Globe,
  HardDrive,
  Key,
  Loader2,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  getPlexLibraries,
  savePlexLibrarySelection,
  testSavedIntegration,
} from '@/api/integrations';
import { putSettings } from '@/api/settings';
import { createPlexPin, checkPlexPin } from '@/api/plex';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type WizardStep =
  | 'welcome'
  | 'plex'
  | 'plexLibraries'
  | 'tmdb'
  | 'radarr'
  | 'sonarr'
  | 'google'
  | 'openai'
  | 'complete';

const STEP_ORDER: WizardStep[] = [
  'welcome',
  'plex',
  'plexLibraries',
  'tmdb',
  'radarr',
  'sonarr',
  'google',
  'openai',
  'complete',
];

export function MultiStepWizard({ onFinish }: { onFinish?: () => void }) {
  const queryClient = useQueryClient();
  const CORE_STEPS: WizardStep[] = [
    'plex',
    'plexLibraries',
    'tmdb',
    'radarr',
    'sonarr',
    'google',
    'openai',
  ];

  // Restore wizard progress from localStorage if available
  const [currentStep, setCurrentStep] = useState<WizardStep>(() => {
    try {
      const saved = localStorage.getItem('wizard_current_step');
      if (saved && STEP_ORDER.includes(saved as WizardStep)) {
        return saved as WizardStep;
      }
    } catch {
      // Ignore localStorage errors
    }
    return 'welcome';
  });

  // Plex state - restore from localStorage if available
  const [plexBaseUrl, setPlexBaseUrl] = useState('http://localhost:32400');
  const [plexToken, setPlexToken] = useState('');
  const [plexTokenFromOAuth, setPlexTokenFromOAuth] = useState(false);
  const [plexOAuthPinId, setPlexOAuthPinId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem('wizard_plex_pin_id');
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });
  const [isPollingPlex, setIsPollingPlex] = useState(() => {
    try {
      return localStorage.getItem('wizard_plex_polling') === 'true';
    } catch {
      return false;
    }
  });
  const [wizardSelectedLibraryKeys, setWizardSelectedLibraryKeys] = useState<
    string[]
  >([]);
  const [libraryMinDialogOpen, setLibraryMinDialogOpen] = useState(false);

  // TMDB state
  const [tmdbApiKey, setTmdbApiKey] = useState('');

  // Radarr state
  const [radarrBaseUrl, setRadarrBaseUrl] = useState('http://localhost:7878');
  const [radarrApiKey, setRadarrApiKey] = useState('');

  // Sonarr state
  const [sonarrBaseUrl, setSonarrBaseUrl] = useState('http://localhost:8989');
  const [sonarrApiKey, setSonarrApiKey] = useState('');

  // Google state
  const [googleSearchEngineId, setGoogleSearchEngineId] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');

  // OpenAI state
  const [openAiApiKey, setOpenAiApiKey] = useState('');

  const getCurrentStepIndex = () => STEP_ORDER.indexOf(currentStep);
  const canGoBack = getCurrentStepIndex() > 0;

  const isCoreStep = CORE_STEPS.includes(currentStep);
  const coreStepNumber = isCoreStep ? CORE_STEPS.indexOf(currentStep) + 1 : 0;
  const coreStepTotal = CORE_STEPS.length;
  const coreProgressPct = isCoreStep ? Math.round((coreStepNumber / coreStepTotal) * 100) : 0;

  const plexLibrariesQuery = useQuery({
    queryKey: ['integrations', 'plex', 'libraries'],
    queryFn: getPlexLibraries,
    enabled: currentStep === 'plexLibraries',
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (currentStep !== 'plexLibraries') return;
    if (!plexLibrariesQuery.data) return;
    setWizardSelectedLibraryKeys(plexLibrariesQuery.data.selectedSectionKeys);
  }, [currentStep, plexLibrariesQuery.data]);

  // Poll for Plex OAuth token
  useEffect(() => {
    if (!isPollingPlex || !plexOAuthPinId) return;

    const pollInterval = setInterval(async () => {
      try {
        const result = await checkPlexPin(plexOAuthPinId);
        if (result.authToken) {
          setPlexToken(result.authToken);
          setPlexTokenFromOAuth(true);
          setIsPollingPlex(false);
          setPlexOAuthPinId(null);

          // Clear polling state
          try {
            localStorage.removeItem('wizard_plex_pin_id');
            localStorage.removeItem('wizard_plex_polling');
          } catch {
            // Ignore localStorage errors
          }

          toast.success('Connected to Plex.');
        }
      } catch (error) {
        console.error('Error polling Plex pin:', error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [isPollingPlex, plexOAuthPinId]);

  const handleNext = async () => {
    const currentIndex = getCurrentStepIndex();
    if (currentIndex < STEP_ORDER.length - 1) {
      const nextStep = STEP_ORDER[currentIndex + 1];
      setCurrentStep(nextStep);
      try {
        localStorage.setItem('wizard_current_step', nextStep);
      } catch {
        // Ignore localStorage errors
      }
    }
  };

  const handleBack = () => {
    const currentIndex = getCurrentStepIndex();
    if (currentIndex > 0) {
      const prevStep = STEP_ORDER[currentIndex - 1];
      setCurrentStep(prevStep);
      try {
        localStorage.setItem('wizard_current_step', prevStep);
      } catch {
        // Ignore localStorage errors
      }
    }
  };

  const handleSkip = () => {
    handleNext();
  };

  const startPlexOAuth = async () => {
    // Mobile Safari (and some in-app browsers) will block popups if window.open is called
    // after an async boundary. Open a placeholder window synchronously, then navigate it.
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
    const popup = window.open('about:blank', 'PlexOAuth', features);

    try {
      if (popup) {
        try {
          popup.document.title = 'Plex Login';
          popup.document.body.innerHTML =
            '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px;">Loading Plex login…</div>';
        } catch {
          // Cross-origin / sandboxed environments may block access. Safe to ignore.
        }
      }

      const pin = await createPlexPin();
      setPlexOAuthPinId(pin.id);
      setIsPollingPlex(true);

      // Persist OAuth state in case of remount
      try {
        localStorage.setItem('wizard_plex_pin_id', String(pin.id));
        localStorage.setItem('wizard_plex_polling', 'true');
      } catch {
        // Ignore localStorage errors
      }

      // Navigate the pre-opened window/tab to Plex auth.
      if (popup) {
        try {
          popup.location.href = pin.authUrl;
        } catch {
          // Fallback: if we cannot set location for some reason, open a new tab.
          window.open(pin.authUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        // Popup blocked: fall back to same-window navigation (works in most native WebViews).
        window.location.href = pin.authUrl;
        return;
      }

      toast.info('Please authorize in the Plex window/tab...');
    } catch (error) {
      try {
        popup?.close();
      } catch {
        // ignore
      }
      toast.error('Failed to start Plex OAuth');
      console.error(error);
    }
  };

  const saveAndValidatePlex = useMutation({
    mutationFn: async () => {
      // Save Plex credentials
      await putSettings({
        settings: {
          plex: {
            baseUrl: plexBaseUrl.trim(),
          },
        },
        secrets: {
          plex: { token: plexToken.trim() },
        },
      });

      // Validate
      toast.info('Validating Plex credentials...');
      await testSavedIntegration('plex');
      toast.success('Connected to Plex.');
    },
    onSuccess: () => {
      // Only invalidate settings after successful validation, not during OAuth
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      handleNext();
    },
    onError: () => {
      if (plexTokenFromOAuth) {
        toast.error(
          'Plex token was created, but authentication failed. Check the Plex Server URL in the wizard and make sure it matches your local Plex server.'
        );
        return;
      }
      toast.error('Plex credentials are incorrect.');
    },
  });

  const toggleWizardLibrarySelection = (librarySectionKey: string, checked: boolean) => {
    setWizardSelectedLibraryKeys((prev) => {
      const has = prev.includes(librarySectionKey);
      if (checked) {
        if (has) return prev;
        return [...prev, librarySectionKey];
      }
      if (!has) return prev;
      if (prev.length <= 1) {
        setLibraryMinDialogOpen(true);
        return prev;
      }
      return prev.filter((key) => key !== librarySectionKey);
    });
  };

  const savePlexLibrarySelectionStep = useMutation({
    mutationFn: async () => {
      if (wizardSelectedLibraryKeys.length < 1) {
        throw new Error('Please keep at least one Plex library selected.');
      }
      return await savePlexLibrarySelection({
        selectedSectionKeys: wizardSelectedLibraryKeys,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['integrations', 'plex', 'libraries'] });
      toast.success('Saved Plex library selection.');
      handleNext();
    },
    onError: (error: Error) => {
      toast.error(error?.message ?? 'Couldn’t save Plex library selection.');
    },
  });

  const saveAndValidateTmdb = useMutation({
    mutationFn: async () => {
      // Save TMDB credentials
      await putSettings({
        secrets: {
          tmdb: { apiKey: tmdbApiKey.trim() },
        },
      });

      // Validate
      toast.info('Validating TMDB credentials...');
      await testSavedIntegration('tmdb');
      toast.success('Connected to TMDB.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      handleNext();
    },
    onError: (error: Error) => {
      const msg = (error?.message ?? '').toLowerCase();
      if (msg.includes('http 401') || msg.includes('invalid api key') || msg.includes('unauthorized')) {
        toast.error('TMDB API key is invalid.');
        return;
      }
      toast.error('Couldn’t connect to TMDB.');
    },
  });

  const saveOptionalService = useMutation({
    mutationFn: async (service: 'radarr' | 'sonarr' | 'google' | 'openai') => {
      const updates: Parameters<typeof putSettings>[0] = {};

      if (service === 'radarr' && radarrBaseUrl && radarrApiKey) {
        updates.settings = { radarr: { baseUrl: radarrBaseUrl.trim() } };
        updates.secrets = { radarr: { apiKey: radarrApiKey.trim() } };
      } else if (service === 'sonarr' && sonarrBaseUrl && sonarrApiKey) {
        updates.settings = { sonarr: { baseUrl: sonarrBaseUrl.trim() } };
        updates.secrets = { sonarr: { apiKey: sonarrApiKey.trim() } };
      } else if (service === 'google' && googleSearchEngineId && googleApiKey) {
        updates.settings = { google: { searchEngineId: googleSearchEngineId.trim() } };
        updates.secrets = { google: { apiKey: googleApiKey.trim() } };
      } else if (service === 'openai' && openAiApiKey) {
        updates.secrets = { openai: { apiKey: openAiApiKey.trim() } };
      }

      if (updates.settings || updates.secrets) {
        await putSettings(updates);
        toast.success(`${service} configured successfully!`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      handleNext();
    },
  });

  const completeWizard = useMutation({
    mutationFn: async () => {
      await putSettings({
        settings: {
          onboarding: {
            completed: true,
            completedAt: new Date().toISOString(),
          },
        },
      });
    },
    onSuccess: () => {
      // Clear all wizard progress from localStorage
      try {
        localStorage.removeItem('wizard_current_step');
        localStorage.removeItem('wizard_plex_pin_id');
        localStorage.removeItem('wizard_plex_polling');
      } catch {
        // Ignore localStorage errors
      }
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Setup complete! Welcome to Immaculaterr!');
      onFinish?.();
    },
  });

  const renderStepContent = () => {
    switch (currentStep) {
      case 'welcome':
        return (
          <div className="relative -mx-4 -my-4 overflow-hidden sm:-mx-6 sm:-my-6">
            {/* Decorative background gradients inside the card */}
            <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-yellow-500/10 blur-3xl" />

            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="relative flex flex-col items-center px-8 py-12 text-center sm:px-12"
            >
              {/* Header Icon */}
              <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-yellow-500/10 ring-1 ring-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
                <ShieldCheck className="h-10 w-10 text-yellow-500" />
              </div>

              {/* Title */}
              <h1 className="mb-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Welcome to Immaculaterr!
              </h1>
              <p className="mb-10 max-w-md text-zinc-400">
                This wizard will help you configure the required credentials to access your media server
                and start automation.
              </p>

              {/* Requirements List */}
              <div className="mb-10 w-full rounded-2xl border border-white/5 bg-white/5 p-6 text-left shadow-inner">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  What you&apos;ll need:
                </h3>

                <ul className="space-y-3">
                  <RequirementItem
                    icon={<Server className="h-4 w-4 text-emerald-400" />}
                    text="Plex Media Server URL and Token"
                    required
                  />
                  <RequirementItem
                    icon={<Key className="h-4 w-4 text-emerald-400" />}
                    text="TMDB API Key"
                    required
                  />
                  <RequirementItem icon={<Database className="h-4 w-4 text-zinc-500" />} text="Radarr (optional)" />
                  <RequirementItem icon={<HardDrive className="h-4 w-4 text-zinc-500" />} text="Sonarr (optional)" />
                  <RequirementItem icon={<Globe className="h-4 w-4 text-zinc-500" />} text="Other services (optional)" />
                </ul>
              </div>

              {/* Action Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleNext}
                className="group relative flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-semibold text-black shadow-lg shadow-white/10 transition-all hover:bg-zinc-100 hover:shadow-white/20"
              >
                <span>Get Started</span>
                <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
              </motion.button>
            </motion.div>
          </div>
        );

      case 'plex':
        return (
          <WizardShell
            step={currentStep}
            title={
              <>
                <span className="text-yellow-400">Plex</span> Configuration
              </>
            }
            subtitle="Connect your media server to enable library synchronization and automation."
            progress={{
              stepNumber: coreStepNumber,
              stepTotal: coreStepTotal,
              percent: coreProgressPct,
            }}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={!canGoBack}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => saveAndValidatePlex.mutate()}
                  disabled={!plexBaseUrl.trim() || !plexToken.trim() || saveAndValidatePlex.isPending}
                  className="h-12 flex-1 rounded-xl bg-white text-black hover:bg-zinc-100"
                >
                  {saveAndValidatePlex.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Validating...
                    </>
                  ) : (
                    <>
                      Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </>
            }
          >
            <div className="space-y-6">

              {/* OAuth Option */}
              <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold text-white">Sign in with Plex</h3>
                      <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-300">
                        Recommended
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-400">
                      Authenticate securely via Plex.tv. We&apos;ll automatically fetch your server URL and generate a
                      permanent token.
                    </p>
                    {isPollingPlex && (
                      <div className="mt-4 space-y-1">
                        <p className="text-sm font-medium text-yellow-300">Waiting for authorization...</p>
                        <p className="text-xs text-zinc-400">
                          You have up to 30 minutes to complete authorization. The token will never expire once created.
                        </p>
                        <button
                          onClick={() => {
                            setIsPollingPlex(false);
                            setPlexOAuthPinId(null);
                            try {
                              localStorage.removeItem('wizard_plex_pin_id');
                              localStorage.removeItem('wizard_plex_polling');
                            } catch {
                              // Ignore localStorage errors
                            }
                          }}
                          className="text-xs underline text-zinc-400 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={startPlexOAuth}
                    disabled={isPollingPlex}
                    size="icon"
                    className="h-12 w-12 rounded-full bg-yellow-500 text-black hover:bg-yellow-400"
                    aria-label="Sign in with Plex"
                  >
                    {isPollingPlex ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-5 w-5" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Or configure manually
                </span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              {/* Manual Entry */}
              <WizardSection>
                <div className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="plexBaseUrl"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Server URL
                  </Label>
                  <Input
                    id="plexBaseUrl"
                    value={plexBaseUrl}
                    onChange={(e) => setPlexBaseUrl(e.target.value)}
                    placeholder="http://localhost:32400"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="plexToken"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Plex Token
                  </Label>
                  <Input
                    id="plexToken"
                    type="password"
                    value={plexToken}
                    onChange={(e) => {
                      setPlexToken(e.target.value);
                      setPlexTokenFromOAuth(false);
                    }}
                    placeholder="Enter your Plex token"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
                </div>
              </WizardSection>
            </div>
          </WizardShell>
        );

      case 'plexLibraries':
        return (
          <WizardShell
            step={currentStep}
            title={
              <>
                <span className="text-yellow-400">Plex</span> Library Selection
              </>
            }
            subtitle="Choose which Plex movie/TV libraries Immaculaterr can use. Excluded libraries are ignored for auto and manual collection runs."
            progress={{
              stepNumber: coreStepNumber,
              stepTotal: coreStepTotal,
              percent: coreProgressPct,
            }}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => savePlexLibrarySelectionStep.mutate()}
                  disabled={
                    !plexLibrariesQuery.data?.libraries.length ||
                    wizardSelectedLibraryKeys.length < 1 ||
                    savePlexLibrarySelectionStep.isPending ||
                    plexLibrariesQuery.isLoading
                  }
                  className="h-12 flex-1 rounded-xl bg-white text-black hover:bg-zinc-100"
                >
                  {savePlexLibrarySelectionStep.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </>
            }
          >
            <WizardSection>
              {plexLibrariesQuery.isLoading ? (
                <div className="flex items-center gap-3 text-sm text-zinc-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading Plex libraries...
                </div>
              ) : plexLibrariesQuery.isError ? (
                <div className="space-y-4">
                  <p className="text-sm text-red-200">
                    Couldn&apos;t load Plex libraries. Check Plex settings and try
                    again.
                  </p>
                  <Button
                    variant="outline"
                    className="h-10 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                    onClick={() => {
                      void plexLibrariesQuery.refetch();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : !plexLibrariesQuery.data?.libraries.length ? (
                <div className="space-y-4">
                  <p className="text-sm text-zinc-300">
                    No movie or TV libraries were found in Plex. Immaculaterr
                    requires at least one eligible library.
                  </p>
                  <Button
                    variant="outline"
                    className="h-10 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                    onClick={() => {
                      void plexLibrariesQuery.refetch();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-zinc-500">
                    Selected {wizardSelectedLibraryKeys.length} of{' '}
                    {plexLibrariesQuery.data.libraries.length}. At least one
                    library must stay selected.
                  </p>
                  <div className="space-y-2">
                    {plexLibrariesQuery.data.libraries.map((lib) => (
                      <label
                        key={lib.key}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-200"
                      >
                        <input
                          type="checkbox"
                          checked={wizardSelectedLibraryKeys.includes(lib.key)}
                          onChange={(e) =>
                            toggleWizardLibrarySelection(lib.key, e.target.checked)
                          }
                          className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#facc15] focus:ring-[#facc15] focus:ring-offset-0"
                        />
                        <span className="flex-1 truncate">{lib.title}</span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          {lib.type === 'movie' ? 'Movie' : 'TV'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </WizardSection>
          </WizardShell>
        );

      case 'tmdb':
        return (
          <WizardShell
            step={currentStep}
            title={
              <>
                <span className="text-yellow-400">TMDB</span> Configuration
              </>
            }
            subtitle="Add your TMDB API key to enrich your library with high-quality metadata."
            progress={{
              stepNumber: coreStepNumber,
              stepTotal: coreStepTotal,
              percent: coreProgressPct,
            }}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => saveAndValidateTmdb.mutate()}
                  disabled={!tmdbApiKey.trim() || saveAndValidateTmdb.isPending}
                  className="h-12 flex-1 rounded-xl bg-white text-black hover:bg-zinc-100"
                >
                  {saveAndValidateTmdb.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Validating...
                    </>
                  ) : (
                    <>
                      Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </>
            }
          >
            <WizardSection>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tmdbApiKey" className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    TMDB API Key
                  </Label>
                  <Input
                    id="tmdbApiKey"
                    type="password"
                    value={tmdbApiKey}
                    onChange={(e) => setTmdbApiKey(e.target.value)}
                    placeholder="Enter your TMDB API key"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                  <p className="text-xs text-zinc-500">
                    Get your API key from{' '}
                    <a
                      href="https://www.themoviedb.org/settings/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-white/20 underline-offset-4 hover:text-white"
                    >
                      themoviedb.org
                    </a>
                    .
                  </p>
                </div>
              </div>
            </WizardSection>
          </WizardShell>
        );

      case 'radarr':
        return (
          <WizardShell
            step={currentStep}
            title={
              <>
                <span className="text-yellow-400">Radarr</span> Configuration
              </>
            }
            subtitle="Optional: connect Radarr to manage and automate your movie collection."
            progress={{
              stepNumber: coreStepNumber,
              stepTotal: coreStepTotal,
              percent: coreProgressPct,
            }}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  className="h-12 flex-1 rounded-xl text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  Skip
                </Button>
                <Button
                  onClick={() => saveOptionalService.mutate('radarr')}
                  disabled={!radarrBaseUrl.trim() || !radarrApiKey.trim() || saveOptionalService.isPending}
                  className="h-12 flex-1 rounded-xl bg-white text-black hover:bg-zinc-100"
                >
                  {saveOptionalService.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      Save & Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </>
            }
          >
            <WizardSection>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="radarrBaseUrl"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Radarr URL
                  </Label>
                  <Input
                    id="radarrBaseUrl"
                    value={radarrBaseUrl}
                    onChange={(e) => setRadarrBaseUrl(e.target.value)}
                    placeholder="http://localhost:7878"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="radarrApiKey"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Radarr API Key
                  </Label>
                  <Input
                    id="radarrApiKey"
                    type="password"
                    value={radarrApiKey}
                    onChange={(e) => setRadarrApiKey(e.target.value)}
                    placeholder="Enter Radarr API key"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
              </div>
            </WizardSection>
          </WizardShell>
        );

      case 'sonarr':
        return (
          <WizardShell
            step={currentStep}
            title={
              <>
                <span className="text-yellow-400">Sonarr</span> Configuration
              </>
            }
            subtitle="Optional: connect Sonarr to manage and automate your TV show collection."
            progress={{
              stepNumber: coreStepNumber,
              stepTotal: coreStepTotal,
              percent: coreProgressPct,
            }}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  className="h-12 flex-1 rounded-xl text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  Skip
                </Button>
                <Button
                  onClick={() => saveOptionalService.mutate('sonarr')}
                  disabled={!sonarrBaseUrl.trim() || !sonarrApiKey.trim() || saveOptionalService.isPending}
                  className="h-12 flex-1 rounded-xl bg-white text-black hover:bg-zinc-100"
                >
                  {saveOptionalService.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      Save & Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </>
            }
          >
            <WizardSection>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="sonarrBaseUrl"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Sonarr URL
                  </Label>
                  <Input
                    id="sonarrBaseUrl"
                    value={sonarrBaseUrl}
                    onChange={(e) => setSonarrBaseUrl(e.target.value)}
                    placeholder="http://localhost:8989"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="sonarrApiKey"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Sonarr API Key
                  </Label>
                  <Input
                    id="sonarrApiKey"
                    type="password"
                    value={sonarrApiKey}
                    onChange={(e) => setSonarrApiKey(e.target.value)}
                    placeholder="Enter Sonarr API key"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
              </div>
            </WizardSection>
          </WizardShell>
        );

      case 'google':
        return (
          <WizardShell
            step={currentStep}
            title={
              <>
                <span className="text-yellow-400">Google</span> Configuration
              </>
            }
            subtitle="Optional: add Google Custom Search Engine keys for advanced search features."
            progress={{
              stepNumber: coreStepNumber,
              stepTotal: coreStepTotal,
              percent: coreProgressPct,
            }}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  className="h-12 flex-1 rounded-xl text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  Skip
                </Button>
                <Button
                  onClick={() => saveOptionalService.mutate('google')}
                  disabled={!googleSearchEngineId.trim() || !googleApiKey.trim() || saveOptionalService.isPending}
                  className="h-12 flex-1 rounded-xl bg-white text-black hover:bg-zinc-100"
                >
                  {saveOptionalService.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      Save & Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </>
            }
          >
            <WizardSection>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="googleSearchEngineId"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Search Engine ID
                  </Label>
                  <Input
                    id="googleSearchEngineId"
                    value={googleSearchEngineId}
                    onChange={(e) => setGoogleSearchEngineId(e.target.value)}
                    placeholder="Enter search engine ID"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="googleApiKey"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Google API Key
                  </Label>
                  <Input
                    id="googleApiKey"
                    type="password"
                    value={googleApiKey}
                    onChange={(e) => setGoogleApiKey(e.target.value)}
                    placeholder="Enter Google API key"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
              </div>
            </WizardSection>
          </WizardShell>
        );

      case 'openai':
        return (
          <WizardShell
            step={currentStep}
            title={
              <>
                <span className="text-yellow-400">OpenAI</span> Configuration
              </>
            }
            subtitle="Optional: enable AI-powered features and recommendations by adding your OpenAI API key."
            progress={{
              stepNumber: coreStepNumber,
              stepTotal: coreStepTotal,
              percent: coreProgressPct,
            }}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  className="h-12 flex-1 rounded-xl text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  Skip
                </Button>
                <Button
                  onClick={() => saveOptionalService.mutate('openai')}
                  disabled={!openAiApiKey.trim() || saveOptionalService.isPending}
                  className="h-12 flex-1 rounded-xl bg-white text-black hover:bg-zinc-100"
                >
                  {saveOptionalService.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      Save & Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </>
            }
          >
            <WizardSection>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="openAiApiKey"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    OpenAI API Key
                  </Label>
                  <Input
                    id="openAiApiKey"
                    type="password"
                    value={openAiApiKey}
                    onChange={(e) => setOpenAiApiKey(e.target.value)}
                    placeholder="Enter OpenAI API key"
                    className="h-12 rounded-xl border-white/10 bg-black/20 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-yellow-500/30"
                  />
                </div>
              </div>
            </WizardSection>
          </WizardShell>
        );

      case 'complete':
        return (
          <div className="relative -mx-4 -my-4 overflow-hidden text-center sm:-mx-6 sm:-my-6">
            <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/18 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-yellow-500/10 blur-3xl" />

            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="relative flex flex-col items-center px-8 py-12 sm:px-12"
            >
              <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.12)]">
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              </div>
              <h1 className="mb-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Setup Complete!</h1>
              <p className="mb-10 max-w-md text-zinc-400">
                Your Immaculaterr instance is now configured and ready to use.
              </p>
              <Button
                onClick={() => completeWizard.mutate()}
                size="lg"
                disabled={completeWizard.isPending}
                className="h-12 w-full max-w-xs rounded-xl bg-white text-black hover:bg-zinc-100"
              >
                {completeWizard.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finishing...
                  </>
                ) : (
                  'Start Using Immaculaterr'
                )}
              </Button>
            </motion.div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <div className={currentStep === 'welcome' || currentStep === 'complete' ? 'w-full' : 'mx-auto w-full max-w-4xl'}>
        {renderStepContent()}
      </div>
      <ConfirmDialog
        open={libraryMinDialogOpen}
        onClose={() => setLibraryMinDialogOpen(false)}
        onConfirm={() => setLibraryMinDialogOpen(false)}
        title="At Least One Library Required"
        description="Immaculaterr requires at least one Plex movie or TV library to stay selected."
        confirmText="Got it"
        cancelText="Close"
        variant="primary"
      />
    </>
  );
}

function RequirementItem({
  icon,
  text,
  required = false,
}: {
  icon: ReactNode;
  text: string;
  required?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 text-zinc-300">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
          required ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-white/5 bg-white/5'
        }`}
      >
        {required ? <Check className="h-4 w-4 text-emerald-500" /> : <div className="h-1.5 w-1.5 rounded-full bg-zinc-600" />}
      </div>
      <div className="flex flex-1 items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${required ? 'bg-white/5' : 'bg-transparent'}`}>
          {icon}
        </div>
        <span className={required ? 'font-medium text-zinc-200' : 'text-zinc-400'}>{text}</span>
      </div>
    </li>
  );
}

function WizardSection({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/5 p-6">{children}</div>;
}

function WizardShell(params: {
  step: WizardStep;
  title: ReactNode;
  subtitle: string;
  progress: { stepNumber: number; stepTotal: number; percent: number };
  children: ReactNode;
  actions: ReactNode;
}) {
  const { title, subtitle, progress, children, actions } = params;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-6 sm:px-10 sm:py-10">
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-yellow-500/8 blur-3xl" />

      {/* Progress */}
      <div className="relative mb-8">
        <div className="mb-3 flex items-center justify-between text-sm text-zinc-400">
          <span>
            Step {progress.stepNumber} of {progress.stepTotal}
          </span>
          <span>{progress.percent}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/10">
          <div
            className="h-2 rounded-full bg-yellow-400 transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      {/* Title */}
      <div className="relative mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-white">{title}</h2>
        <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
      </div>

      {/* Body */}
      <div className="relative">{children}</div>

      {/* Actions */}
      <div className="relative mt-8 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row">
        {actions}
      </div>
    </div>
  );
}
