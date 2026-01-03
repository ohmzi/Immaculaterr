import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { testSavedIntegration } from '@/api/integrations';
import { putSettings } from '@/api/settings';
import { createPlexPin, checkPlexPin } from '@/api/plex';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type WizardStep =
  | 'welcome'
  | 'plex'
  | 'tmdb'
  | 'radarr'
  | 'sonarr'
  | 'google'
  | 'openai'
  | 'overseerr'
  | 'complete';

const STEP_ORDER: WizardStep[] = [
  'welcome',
  'plex',
  'tmdb',
  'radarr',
  'sonarr',
  'google',
  'openai',
  'overseerr',
  'complete',
];

export function MultiStepWizard({ onFinish }: { onFinish?: () => void }) {
  const queryClient = useQueryClient();

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
  const [plexMovieLibrary, setPlexMovieLibrary] = useState('Movies');
  const [plexTvLibrary, setPlexTvLibrary] = useState('TV Shows');
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

  // Overseerr state
  const [overseerrBaseUrl, setOverseerrBaseUrl] = useState('http://localhost:5055');
  const [overseerrApiKey, setOverseerrApiKey] = useState('');

  const getCurrentStepIndex = () => STEP_ORDER.indexOf(currentStep);
  const canGoBack = getCurrentStepIndex() > 0;

  // Poll for Plex OAuth token
  useEffect(() => {
    if (!isPollingPlex || !plexOAuthPinId) return;

    const pollInterval = setInterval(async () => {
      try {
        const result = await checkPlexPin(plexOAuthPinId);
        if (result.authToken) {
          setPlexToken(result.authToken);
          setIsPollingPlex(false);
          setPlexOAuthPinId(null);

          // Clear polling state
          try {
            localStorage.removeItem('wizard_plex_pin_id');
            localStorage.removeItem('wizard_plex_polling');
          } catch {
            // Ignore localStorage errors
          }

          toast.success('Successfully connected to Plex!');
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
    try {
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

      // Open Plex OAuth page in a new window with specific features to prevent navigation
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;

      window.open(pin.authUrl, 'PlexOAuth', features);

      toast.info('Please authorize in the Plex window...');
    } catch (error) {
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
            movieLibraryName: plexMovieLibrary.trim(),
            tvLibraryName: plexTvLibrary.trim(),
          },
        },
        secrets: {
          plex: { token: plexToken.trim() },
        },
      });

      // Validate
      toast.info('Validating Plex credentials...');
      await testSavedIntegration('plex');
      toast.success('Plex validated successfully!');
    },
    onSuccess: () => {
      // Only invalidate settings after successful validation, not during OAuth
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      handleNext();
    },
    onError: (error: Error) => {
      toast.error(`Plex validation failed: ${error.message}`);
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
      toast.success('TMDB validated successfully!');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      handleNext();
    },
    onError: (error: Error) => {
      toast.error(`TMDB validation failed: ${error.message}`);
    },
  });

  const saveOptionalService = useMutation({
    mutationFn: async (service: 'radarr' | 'sonarr' | 'google' | 'openai' | 'overseerr') => {
      const updates: any = {};

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
      } else if (service === 'overseerr' && overseerrBaseUrl && overseerrApiKey) {
        updates.settings = { overseerr: { baseUrl: overseerrBaseUrl.trim() } };
        updates.secrets = { overseerr: { apiKey: overseerrApiKey.trim() } };
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
          <div className="space-y-6 text-center">
            <div className="mx-auto w-20 h-20 bg-yellow-100 dark:bg-yellow-900/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Welcome to Immaculaterr!</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                This wizard will help you configure the required credentials to access your media server and start automation.
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 max-w-md mx-auto">
              <h3 className="font-semibold mb-2">What you'll need:</h3>
              <ul className="text-sm text-muted-foreground space-y-1 text-left">
                <li>✓ Plex Media Server URL and Token</li>
                <li>✓ TMDB API Key</li>
                <li>• Radarr (optional)</li>
                <li>• Sonarr (optional)</li>
                <li>• Other services (optional)</li>
              </ul>
            </div>
            <Button onClick={handleNext} size="lg">
              Get Started <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        );

      case 'plex':
        return (
          <div className="flex flex-col min-h-[480px]">
            <div className="flex-1 space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-2">Configure Plex (Required)</h2>
                <p className="text-sm text-muted-foreground">
                  Connect to your Plex Media Server to manage your media library.
                </p>
              </div>

              {/* OAuth Option */}
              <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">Sign in with Plex (Recommended)</h3>
                    <p className="text-sm text-muted-foreground">
                      Securely connect using OAuth. This will generate a permanent, non-expiring token for your scheduler.
                    </p>
                    {isPollingPlex && (
                      <div className="mt-3 space-y-1">
                        <p className="text-sm text-yellow-600 dark:text-yellow-400 font-medium">
                          Waiting for authorization...
                        </p>
                        <p className="text-xs text-muted-foreground">
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
                          className="text-xs underline text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <Button onClick={startPlexOAuth} disabled={isPollingPlex} size="sm">
                    {isPollingPlex ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Waiting...
                      </>
                    ) : (
                      <>
                        Sign in <ExternalLink className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or enter manually</span>
                </div>
              </div>

              {/* Manual Entry */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="plexBaseUrl">Plex Server URL</Label>
                  <Input
                    id="plexBaseUrl"
                    value={plexBaseUrl}
                    onChange={(e) => setPlexBaseUrl(e.target.value)}
                    placeholder="http://localhost:32400"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plexToken">Plex Token</Label>
                  <Input
                    id="plexToken"
                    type="password"
                    value={plexToken}
                    onChange={(e) => setPlexToken(e.target.value)}
                    placeholder="Enter your Plex token"
                  />
                  <p className="text-xs text-muted-foreground">
                    Manual tokens are permanent and will work for scheduled jobs. Get your token from Plex settings.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="plexMovieLibrary">Movie Library</Label>
                    <Input
                      id="plexMovieLibrary"
                      value={plexMovieLibrary}
                      onChange={(e) => setPlexMovieLibrary(e.target.value)}
                      placeholder="Movies"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plexTvLibrary">TV Library</Label>
                    <Input
                      id="plexTvLibrary"
                      value={plexTvLibrary}
                      onChange={(e) => setPlexTvLibrary(e.target.value)}
                      placeholder="TV Shows"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Fixed buttons at bottom */}
            <div className="flex gap-3 mt-6 pt-6 border-t">
              <Button variant="outline" onClick={handleBack} disabled={!canGoBack}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button
                onClick={() => saveAndValidatePlex.mutate()}
                disabled={!plexBaseUrl.trim() || !plexToken.trim() || saveAndValidatePlex.isPending}
                className="flex-1"
              >
                {saveAndValidatePlex.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Validating...
                  </>
                ) : (
                  <>
                    Next <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case 'tmdb':
        return (
          <div className="flex flex-col min-h-[480px]">
            <div className="flex-1 space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-2">Configure TMDB (Required)</h2>
                <p className="text-sm text-muted-foreground">
                  The Movie Database API provides metadata enrichment for your media.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tmdbApiKey">TMDB API Key</Label>
                  <Input
                    id="tmdbApiKey"
                    type="password"
                    value={tmdbApiKey}
                    onChange={(e) => setTmdbApiKey(e.target.value)}
                    placeholder="Enter your TMDB API key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Get your API key from{' '}
                    <a
                      href="https://www.themoviedb.org/settings/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      themoviedb.org
                    </a>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-6 border-t">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button
                onClick={() => saveAndValidateTmdb.mutate()}
                disabled={!tmdbApiKey.trim() || saveAndValidateTmdb.isPending}
                className="flex-1"
              >
                {saveAndValidateTmdb.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Validating...
                  </>
                ) : (
                  <>
                    Next <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case 'radarr':
        return (
          <div className="flex flex-col min-h-[480px]">
            <div className="flex-1 space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-2">Configure Radarr (Optional)</h2>
                <p className="text-sm text-muted-foreground">
                  Radarr manages your movie collection. Skip if you don't use it.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="radarrBaseUrl">Radarr URL</Label>
                  <Input
                    id="radarrBaseUrl"
                    value={radarrBaseUrl}
                    onChange={(e) => setRadarrBaseUrl(e.target.value)}
                    placeholder="http://localhost:7878"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radarrApiKey">Radarr API Key</Label>
                  <Input
                    id="radarrApiKey"
                    type="password"
                    value={radarrApiKey}
                    onChange={(e) => setRadarrApiKey(e.target.value)}
                    placeholder="Enter Radarr API key"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-6 border-t">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button variant="ghost" onClick={handleSkip} className="flex-1">
                Skip
              </Button>
              <Button
                onClick={() => saveOptionalService.mutate('radarr')}
                disabled={!radarrBaseUrl.trim() || !radarrApiKey.trim() || saveOptionalService.isPending}
                className="flex-1"
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
            </div>
          </div>
        );

      case 'sonarr':
        return (
          <div className="flex flex-col min-h-[480px]">
            <div className="flex-1 space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-2">Configure Sonarr (Optional)</h2>
                <p className="text-sm text-muted-foreground">
                  Sonarr manages your TV show collection. Skip if you don't use it.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sonarrBaseUrl">Sonarr URL</Label>
                  <Input
                    id="sonarrBaseUrl"
                    value={sonarrBaseUrl}
                    onChange={(e) => setSonarrBaseUrl(e.target.value)}
                    placeholder="http://localhost:8989"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sonarrApiKey">Sonarr API Key</Label>
                  <Input
                    id="sonarrApiKey"
                    type="password"
                    value={sonarrApiKey}
                    onChange={(e) => setSonarrApiKey(e.target.value)}
                    placeholder="Enter Sonarr API key"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-6 border-t">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button variant="ghost" onClick={handleSkip} className="flex-1">
                Skip
              </Button>
              <Button
                onClick={() => saveOptionalService.mutate('sonarr')}
                disabled={!sonarrBaseUrl.trim() || !sonarrApiKey.trim() || saveOptionalService.isPending}
                className="flex-1"
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
            </div>
          </div>
        );

      case 'google':
        return (
          <div className="flex flex-col min-h-[480px]">
            <div className="flex-1 space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-2">Configure Google CSE (Optional)</h2>
                <p className="text-sm text-muted-foreground">
                  Google Custom Search Engine for advanced search features.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="googleSearchEngineId">Search Engine ID</Label>
                  <Input
                    id="googleSearchEngineId"
                    value={googleSearchEngineId}
                    onChange={(e) => setGoogleSearchEngineId(e.target.value)}
                    placeholder="Enter search engine ID"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="googleApiKey">Google API Key</Label>
                  <Input
                    id="googleApiKey"
                    type="password"
                    value={googleApiKey}
                    onChange={(e) => setGoogleApiKey(e.target.value)}
                    placeholder="Enter Google API key"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-6 border-t">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button variant="ghost" onClick={handleSkip} className="flex-1">
                Skip
              </Button>
              <Button
                onClick={() => saveOptionalService.mutate('google')}
                disabled={!googleSearchEngineId.trim() || !googleApiKey.trim() || saveOptionalService.isPending}
                className="flex-1"
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
            </div>
          </div>
        );

      case 'openai':
        return (
          <div className="flex flex-col min-h-[480px]">
            <div className="flex-1 space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-2">Configure OpenAI (Optional)</h2>
                <p className="text-sm text-muted-foreground">
                  OpenAI API for AI-powered features and recommendations.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openAiApiKey">OpenAI API Key</Label>
                  <Input
                    id="openAiApiKey"
                    type="password"
                    value={openAiApiKey}
                    onChange={(e) => setOpenAiApiKey(e.target.value)}
                    placeholder="Enter OpenAI API key"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-6 border-t">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button variant="ghost" onClick={handleSkip} className="flex-1">
                Skip
              </Button>
              <Button
                onClick={() => saveOptionalService.mutate('openai')}
                disabled={!openAiApiKey.trim() || saveOptionalService.isPending}
                className="flex-1"
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
            </div>
          </div>
        );

      case 'overseerr':
        return (
          <div className="flex flex-col min-h-[480px]">
            <div className="flex-1 space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-2">Configure Overseerr (Optional)</h2>
                <p className="text-sm text-muted-foreground">
                  Overseerr for media requests and management.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="overseerrBaseUrl">Overseerr URL</Label>
                  <Input
                    id="overseerrBaseUrl"
                    value={overseerrBaseUrl}
                    onChange={(e) => setOverseerrBaseUrl(e.target.value)}
                    placeholder="http://localhost:5055"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="overseerrApiKey">Overseerr API Key</Label>
                  <Input
                    id="overseerrApiKey"
                    type="password"
                    value={overseerrApiKey}
                    onChange={(e) => setOverseerrApiKey(e.target.value)}
                    placeholder="Enter Overseerr API key"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-6 border-t">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button variant="ghost" onClick={handleSkip} className="flex-1">
                Skip
              </Button>
              <Button
                onClick={() => saveOptionalService.mutate('overseerr')}
                disabled={!overseerrBaseUrl.trim() || !overseerrApiKey.trim() || saveOptionalService.isPending}
                className="flex-1"
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
            </div>
          </div>
        );

      case 'complete':
        return (
          <div className="space-y-6 text-center">
            <div className="mx-auto w-20 h-20 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Setup Complete!</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Your Immaculaterr instance is now configured and ready to use.
              </p>
            </div>
            <Button onClick={() => completeWizard.mutate()} size="lg" disabled={completeWizard.isPending}>
              {completeWizard.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finishing...
                </>
              ) : (
                'Start Using Immaculaterr'
              )}
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress indicator */}
      {currentStep !== 'welcome' && currentStep !== 'complete' && (
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
            <span>Step {getCurrentStepIndex()} of {STEP_ORDER.length - 2}</span>
            <span>{Math.round((getCurrentStepIndex() / (STEP_ORDER.length - 1)) * 100)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(getCurrentStepIndex() / (STEP_ORDER.length - 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="bg-card border rounded-lg p-8">
        {renderStepContent()}
      </div>
    </div>
  );
}
