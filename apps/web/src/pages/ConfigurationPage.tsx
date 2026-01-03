import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, TestTube, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { getPublicSettings, putSettings } from '@/api/settings';

const MASKED_SECRET = '••••••••••••';

function readString(obj: unknown, path: string): string {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : '';
}

export function ConfigurationPage() {
  const queryClient = useQueryClient();

  // Load settings to check which services are already configured
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
  });

  const secretsPresent = useMemo(
    () => settingsQuery.data?.secretsPresent ?? {},
    [settingsQuery.data],
  );

  // Service configuration states
  const [plexBaseUrl, setPlexBaseUrl] = useState('http://localhost:32400');
  const [plexMovieLibrary, setPlexMovieLibrary] = useState('Movies');
  const [plexTvLibrary, setPlexTvLibrary] = useState('TV Shows');
  const [plexToken, setPlexToken] = useState('');

  // Load existing settings when data is available
  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;

    const plexBaseUrlSaved = readString(settings, 'plex.baseUrl');
    const plexMovieSaved = readString(settings, 'plex.movieLibraryName');
    const plexTvSaved = readString(settings, 'plex.tvLibraryName');
    const radarrBaseUrlSaved = readString(settings, 'radarr.baseUrl');
    const sonarrBaseUrlSaved = readString(settings, 'sonarr.baseUrl');
    const googleSearchEngineIdSaved = readString(settings, 'google.searchEngineId');
    const overseerrBaseUrlSaved = readString(settings, 'overseerr.baseUrl');

    if (plexBaseUrlSaved) setPlexBaseUrl(plexBaseUrlSaved);
    if (plexMovieSaved) setPlexMovieLibrary(plexMovieSaved);
    if (plexTvSaved) setPlexTvLibrary(plexTvSaved);
    if (radarrBaseUrlSaved) setRadarrBaseUrl(radarrBaseUrlSaved);
    if (sonarrBaseUrlSaved) setSonarrBaseUrl(sonarrBaseUrlSaved);
    if (googleSearchEngineIdSaved) setGoogleSearchEngineId(googleSearchEngineIdSaved);
    if (overseerrBaseUrlSaved) setOverseerrBaseUrl(overseerrBaseUrlSaved);
  }, [settingsQuery.data?.settings]);

  const [radarrBaseUrl, setRadarrBaseUrl] = useState('http://localhost:7878');
  const [radarrApiKey, setRadarrApiKey] = useState('');

  const [sonarrBaseUrl, setSonarrBaseUrl] = useState('http://localhost:8989');
  const [sonarrApiKey, setSonarrApiKey] = useState('');

  const [tmdbApiKey, setTmdbApiKey] = useState('');

  const [googleSearchEngineId, setGoogleSearchEngineId] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');

  const [openAiApiKey, setOpenAiApiKey] = useState('');

  const [overseerrBaseUrl, setOverseerrBaseUrl] = useState('http://localhost:5055');
  const [overseerrApiKey, setOverseerrApiKey] = useState('');

  // Show asterisks for saved credentials
  useEffect(() => {
    if (secretsPresent.plex && !plexToken) {
      setPlexToken(MASKED_SECRET);
    }
    if (secretsPresent.radarr && !radarrApiKey) {
      setRadarrApiKey(MASKED_SECRET);
    }
    if (secretsPresent.sonarr && !sonarrApiKey) {
      setSonarrApiKey(MASKED_SECRET);
    }
    if (secretsPresent.tmdb && !tmdbApiKey) {
      setTmdbApiKey(MASKED_SECRET);
    }
    if (secretsPresent.google && !googleApiKey) {
      setGoogleApiKey(MASKED_SECRET);
    }
    if (secretsPresent.openai && !openAiApiKey) {
      setOpenAiApiKey(MASKED_SECRET);
    }
    if (secretsPresent.overseerr && !overseerrApiKey) {
      setOverseerrApiKey(MASKED_SECRET);
    }
  }, [secretsPresent]);

  // Service toggle states
  const [radarrEnabled, setRadarrEnabled] = useState(false);
  const [sonarrEnabled, setSonarrEnabled] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [openAiEnabled, setOpenAiEnabled] = useState(false);
  const [overseerrEnabled, setOverseerrEnabled] = useState(false);

  // Auto-enable toggles for services that have saved credentials
  useEffect(() => {
    if (secretsPresent.radarr && !radarrEnabled) {
      setRadarrEnabled(true);
    }
    if (secretsPresent.sonarr && !sonarrEnabled) {
      setSonarrEnabled(true);
    }
    if (secretsPresent.google && !googleEnabled) {
      setGoogleEnabled(true);
    }
    if (secretsPresent.openai && !openAiEnabled) {
      setOpenAiEnabled(true);
    }
    if (secretsPresent.overseerr && !overseerrEnabled) {
      setOverseerrEnabled(true);
    }
  }, [secretsPresent]);

  // Plex OAuth state
  const [isPlexOAuthLoading, setIsPlexOAuthLoading] = useState(false);

  const handlePlexOAuth = async () => {
    setIsPlexOAuthLoading(true);
    const toastId = toast.loading('Opening Plex login...');

    try {
      // Step 1: Create a PIN
      const pinResponse = await fetch('/api/plex/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!pinResponse.ok) {
        throw new Error('Failed to create Plex PIN');
      }

      const pinData = await pinResponse.json();
      const { id: pinId, authUrl } = pinData;

      // Step 2: Open popup window
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl,
        'PlexAuth',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes`
      );

      if (!popup) {
        throw new Error('Failed to open popup. Please allow popups for this site.');
      }

      toast.success('Login with Plex in the popup window', { id: toastId });

      // Step 3: Poll for the auth token
      let attempts = 0;
      const maxAttempts = 60; // 60 attempts * 2 seconds = 2 minutes max

      const pollInterval = setInterval(async () => {
        attempts++;

        // Check if popup is closed
        if (popup.closed) {
          clearInterval(pollInterval);
          setIsPlexOAuthLoading(false);
          toast.error('Login cancelled', { id: toastId });
          return;
        }

        // Max attempts reached
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          popup.close();
          setIsPlexOAuthLoading(false);
          toast.error('Login timed out. Please try again.', { id: toastId });
          return;
        }

        try {
          const checkResponse = await fetch(`/api/plex/pin/${pinId}`);
          if (checkResponse.ok) {
            const checkData = await checkResponse.json();

            if (checkData.authToken) {
              // Success! Got the token
              clearInterval(pollInterval);
              popup.close();
              setPlexToken(checkData.authToken);
              setIsPlexOAuthLoading(false);
              toast.success('✓ Successfully logged in with Plex!', { id: toastId });
            }
          }
        } catch (error) {
          // Continue polling on error
          console.error('Poll error:', error);
        }
      }, 2000); // Poll every 2 seconds

    } catch (error) {
      setIsPlexOAuthLoading(false);
      toast.error(`OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { id: toastId });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const settingsPatch: Record<string, unknown> = {};
      const secretsPatch: Record<string, unknown> = {};

      const plexSettings: Record<string, unknown> = {};
      if (plexBaseUrl.trim()) plexSettings.baseUrl = plexBaseUrl.trim();
      if (plexMovieLibrary.trim()) plexSettings.movieLibraryName = plexMovieLibrary.trim();
      if (plexTvLibrary.trim()) plexSettings.tvLibraryName = plexTvLibrary.trim();
      if (Object.keys(plexSettings).length) settingsPatch.plex = plexSettings;

      if (radarrEnabled && radarrBaseUrl.trim()) {
        settingsPatch.radarr = { baseUrl: radarrBaseUrl.trim() };
      }
      if (sonarrEnabled && sonarrBaseUrl.trim()) {
        settingsPatch.sonarr = { baseUrl: sonarrBaseUrl.trim() };
      }
      if (googleEnabled && googleSearchEngineId.trim()) {
        settingsPatch.google = { searchEngineId: googleSearchEngineId.trim() };
      }
      if (overseerrEnabled && overseerrBaseUrl.trim()) {
        settingsPatch.overseerr = { baseUrl: overseerrBaseUrl.trim() };
      }

      if (plexToken.trim() && plexToken !== MASKED_SECRET) {
        secretsPatch.plex = { token: plexToken.trim() };
      }
      if (tmdbApiKey.trim() && tmdbApiKey !== MASKED_SECRET) {
        secretsPatch.tmdb = { apiKey: tmdbApiKey.trim() };
      }
      if (radarrApiKey.trim() && radarrApiKey !== MASKED_SECRET) {
        secretsPatch.radarr = { apiKey: radarrApiKey.trim() };
      }
      if (sonarrApiKey.trim() && sonarrApiKey !== MASKED_SECRET) {
        secretsPatch.sonarr = { apiKey: sonarrApiKey.trim() };
      }
      if (googleApiKey.trim() && googleApiKey !== MASKED_SECRET) {
        secretsPatch.google = { apiKey: googleApiKey.trim() };
      }
      if (openAiApiKey.trim() && openAiApiKey !== MASKED_SECRET) {
        secretsPatch.openai = { apiKey: openAiApiKey.trim() };
      }
      if (overseerrApiKey.trim() && overseerrApiKey !== MASKED_SECRET) {
        secretsPatch.overseerr = { apiKey: overseerrApiKey.trim() };
      }

      return await putSettings({
        settings: Object.keys(settingsPatch).length ? settingsPatch : undefined,
        secrets: Object.keys(secretsPatch).length ? secretsPatch : undefined,
      });
    },
    onSuccess: async () => {
      // Clear secret inputs after save (they are never shown again).
      setPlexToken('');
      setRadarrApiKey('');
      setSonarrApiKey('');
      setTmdbApiKey('');
      setGoogleApiKey('');
      setOpenAiApiKey('');
      setOverseerrApiKey('');

      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Configuration saved.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save configuration');
    },
  });

  const handleSave = () => {
    saveMutation.mutate();
  };

  const testPlexConnection = async () => {
    const toastId = toast.loading('Testing Plex connection...');
    try {
      // If credentials are saved (masked), test the saved credentials
      if (secretsPresent.plex && plexToken === MASKED_SECRET) {
        const response = await fetch('/api/integrations/test/plex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          toast.success('✓ Connected to Plex with saved credentials!', { id: toastId });
        } else {
          const error = await response.json().catch(() => ({ message: response.statusText }));
          toast.error(`Plex test failed: ${error.message || 'Connection error'}`, { id: toastId });
        }
      } else {
        // Test with the values in the form
        if (!plexBaseUrl || !plexToken) {
          toast.error('Please enter Plex Base URL and Token', { id: toastId });
          return;
        }

        const response = await fetch('/api/plex/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl: plexBaseUrl, token: plexToken }),
        });

        if (response.ok) {
          const data = await response.json();
          toast.success(`✓ Connected to Plex! ID: ${data.machineIdentifier.substring(0, 8)}...`, { id: toastId });
        } else {
          const error = await response.json().catch(() => ({ message: response.statusText }));
          const msg = error.message || response.statusText;
          if (msg.includes('401') || msg.includes('Unauthorized')) {
            toast.error('Invalid Plex token or server not accessible', { id: toastId });
          } else if (msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
            toast.error('Cannot reach Plex server - check URL and network', { id: toastId });
          } else {
            toast.error(`Plex: ${msg}`, { id: toastId });
          }
        }
      }
    } catch (error) {
      toast.error(`Network error: Cannot reach Plex server`, { id: toastId });
    }
  };

  const testRadarrConnection = async () => {
    if (!radarrBaseUrl || !radarrApiKey) {
      toast.error('Please enter Radarr Base URL and API Key');
      return;
    }

    const toastId = toast.loading('Testing Radarr connection...');
    try {
      const response = await fetch('/api/radarr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: radarrBaseUrl, apiKey: radarrApiKey }),
      });

      if (response.ok) {
        const data = await response.json();
        const version = data.status?.version || 'unknown';
        toast.success(`✓ Connected to Radarr v${version}`, { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        if (msg.includes('401') || msg.includes('Unauthorized')) {
          toast.error('Invalid Radarr API key', { id: toastId });
        } else if (msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
          toast.error('Cannot reach Radarr - check URL (usually :7878)', { id: toastId });
        } else {
          toast.error(`Radarr: ${msg}`, { id: toastId });
        }
      }
    } catch (error) {
      toast.error(`Network error: Cannot reach Radarr`, { id: toastId });
    }
  };

  const testSonarrConnection = async () => {
    if (!sonarrBaseUrl || !sonarrApiKey) {
      toast.error('Please enter Sonarr Base URL and API Key');
      return;
    }

    const toastId = toast.loading('Testing Sonarr connection...');
    try {
      const response = await fetch('/api/sonarr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: sonarrBaseUrl, apiKey: sonarrApiKey }),
      });

      if (response.ok) {
        const data = await response.json();
        const version = data.status?.version || 'unknown';
        toast.success(`✓ Connected to Sonarr v${version}`, { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        if (msg.includes('401') || msg.includes('Unauthorized')) {
          toast.error('Invalid Sonarr API key', { id: toastId });
        } else if (msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
          toast.error('Cannot reach Sonarr - check URL (usually :8989)', { id: toastId });
        } else {
          toast.error(`Sonarr: ${msg}`, { id: toastId });
        }
      }
    } catch (error) {
      toast.error(`Network error: Cannot reach Sonarr`, { id: toastId });
    }
  };

  const testTmdbConnection = async () => {
    const toastId = toast.loading('Testing TMDB connection...');
    try {
      // If credentials are saved (masked), test the saved credentials
      if (secretsPresent.tmdb && tmdbApiKey === MASKED_SECRET) {
        const response = await fetch('/api/integrations/test/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          toast.success('✓ Connected to TMDB with saved credentials!', { id: toastId });
        } else {
          const error = await response.json().catch(() => ({ message: response.statusText }));
          toast.error(`TMDB test failed: ${error.message || 'Connection error'}`, { id: toastId });
        }
      } else {
        // Test with the values in the form
        if (!tmdbApiKey) {
          toast.error('Please enter TMDB API Key', { id: toastId });
          return;
        }

        const response = await fetch('/api/tmdb/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: tmdbApiKey }),
        });

        if (response.ok) {
          toast.success('✓ Connected to TMDB successfully!', { id: toastId });
        } else {
          const error = await response.json().catch(() => ({ message: response.statusText }));
          const msg = error.message || response.statusText;
          if (msg.includes('401') || msg.includes('Invalid API key')) {
            toast.error('Invalid TMDB API key - get one at themoviedb.org/settings/api', { id: toastId, duration: 5000 });
          } else {
            toast.error(`TMDB: ${msg}`, { id: toastId });
          }
        }
      }
    } catch (error) {
      toast.error(`Network error: Cannot reach TMDB`, { id: toastId });
    }
  };

  const testGoogleConnection = async () => {
    if (!googleSearchEngineId || !googleApiKey) {
      toast.error('Please enter Google Search Engine ID and API Key');
      return;
    }

    const toastId = toast.loading('Testing Google Search connection...');
    try {
      const response = await fetch('/api/google/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: googleApiKey,
          cseId: googleSearchEngineId,
          query: 'tautulli curated plex',
          numResults: 3
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const numResults = data.results?.length || 0;
        toast.success(`✓ Connected to Google! Found ${numResults} results`, { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        toast.error(`Google: ${msg}`, { id: toastId, duration: 6000 });
      }
    } catch (error) {
      toast.error(`Network error: Cannot reach Google API`, { id: toastId });
    }
  };

  const testOpenAiConnection = async () => {
    if (!openAiApiKey) {
      toast.error('Please enter OpenAI API Key');
      return;
    }

    const toastId = toast.loading('Testing OpenAI connection...');
    try {
      const response = await fetch('/api/openai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: openAiApiKey }),
      });

      if (response.ok) {
        const data = await response.json();
        const modelCount = data.models?.length || 0;
        toast.success(`✓ Connected to OpenAI! ${modelCount} models available`, { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        if (msg.includes('401') || msg.includes('Incorrect API key')) {
          toast.error('Invalid OpenAI API key - check your key at platform.openai.com', { id: toastId, duration: 5000 });
        } else {
          toast.error(`OpenAI: ${msg}`, { id: toastId });
        }
      }
    } catch (error) {
      toast.error(`Network error: Cannot reach OpenAI API`, { id: toastId });
    }
  };

  const testOverseerrConnection = async () => {
    if (!overseerrBaseUrl || !overseerrApiKey) {
      toast.error('Please enter Overseerr Base URL and API Key');
      return;
    }

    const toastId = toast.loading('Testing Overseerr connection...');
    try {
      const response = await fetch('/api/overseerr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: overseerrBaseUrl, apiKey: overseerrApiKey }),
      });

      if (response.ok) {
        const data = await response.json();
        const version = data.version || 'unknown';
        toast.success(`✓ Connected to Overseerr v${version}`, { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        if (msg.includes('401') || msg.includes('Unauthorized')) {
          toast.error('Invalid Overseerr API key', { id: toastId });
        } else if (msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
          toast.error('Cannot reach Overseerr - check URL (usually :5055)', { id: toastId });
        } else {
          toast.error(`Overseerr: ${msg}`, { id: toastId });
        }
      }
    } catch (error) {
      toast.error(`Network error: Cannot reach Overseerr`, { id: toastId });
    }
  };

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const cardHeaderClass = 'flex items-center justify-between gap-4 mb-6';
  const cardTitleClass = 'text-2xl font-semibold text-white';
  const labelClass = 'block text-sm font-medium text-white/70 mb-2';
  const inputBaseClass =
    'px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-400/70 focus:border-transparent outline-none transition';
  const inputClass = `w-full ${inputBaseClass}`;
  const inputFlexClass = `flex-1 min-w-0 ${inputBaseClass}`;
  const testButtonClass =
    'px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-full active:scale-95 transition-all duration-300 flex items-center gap-2 min-h-[44px] font-medium';
  const toggleTrackClass = (enabled: boolean) =>
    `relative inline-flex h-7 w-12 items-center rounded-full transition-colors active:scale-95 ${
      enabled ? 'bg-yellow-400' : 'bg-white/15'
    }`;
  const toggleThumbClass = (enabled: boolean) =>
    `inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
      enabled ? 'translate-x-6' : 'translate-x-1'
    }`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Background (landing-page style, blue-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-sky-500/55 via-blue-700/45 to-indigo-900/60" />
        <div className="absolute inset-0 bg-[#0b0c0f]/15" />
      </div>

      {/* Configuration Content */}
      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-10">
        <div className="container mx-auto px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-5xl mx-auto"
          >
            {/* Page Header */}
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-white mb-2">Service Configuration</h1>
              <p className="text-lg text-white/70">Configure your media services and API integrations</p>
            </div>

            {/* Configuration Form */}
            <div className="space-y-6">
              {/* Plex Configuration */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className={cardClass}
              >
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>Plex Media Server</h2>
                  <button
                    onClick={testPlexConnection}
                    className={testButtonClass}
                  >
                    <TestTube size={18} />
                    Test
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelClass}>Base URL</label>
                    <input
                      type="text"
                      value={plexBaseUrl}
                      onChange={(e) => setPlexBaseUrl(e.target.value)}
                      placeholder="http://localhost:32400"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Token</label>
                    <div className="flex min-w-0 gap-2">
                      <input
                        type="password"
                        value={plexToken}
                        onChange={(e) => setPlexToken(e.target.value)}
                        placeholder={secretsPresent.plex ? "Saved (enter new to replace)" : "Enter Plex token"}
                        className={inputFlexClass}
                      />
                      <button
                        onClick={handlePlexOAuth}
                        disabled={isPlexOAuthLoading}
                        className="shrink-0 px-4 py-3 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-xl active:scale-95 transition-all duration-300 flex items-center gap-2 min-h-[44px] font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        title="Login with Plex"
                      >
                        <LogIn size={18} />
                        {isPlexOAuthLoading ? 'Logging in...' : 'OAuth'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Movie Library Name</label>
                    <input
                      type="text"
                      value={plexMovieLibrary}
                      onChange={(e) => setPlexMovieLibrary(e.target.value)}
                      placeholder="Movies"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>TV Library Name</label>
                    <input
                      type="text"
                      value={plexTvLibrary}
                      onChange={(e) => setPlexTvLibrary(e.target.value)}
                      placeholder="TV Shows"
                      className={inputClass}
                    />
                  </div>
                </div>
              </motion.div>

              {/* TMDB Configuration */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className={cardClass}
              >
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>The Movie Database (TMDB)</h2>
                  <button
                    onClick={testTmdbConnection}
                    className={testButtonClass}
                  >
                    <TestTube size={18} />
                    Test
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      value={tmdbApiKey}
                      onChange={(e) => setTmdbApiKey(e.target.value)}
                      placeholder={secretsPresent.tmdb ? "Saved (enter new to replace)" : "Enter TMDB API key"}
                      className={inputClass}
                    />
                  </div>
                </div>
              </motion.div>

              {/* Radarr Configuration */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className={cardClass}
              >
                <div className={cardHeaderClass}>
                  <div className="flex items-center gap-4">
                    <h2 className={cardTitleClass}>Radarr</h2>
                    <button
                      onClick={() => setRadarrEnabled(!radarrEnabled)}
                      className={toggleTrackClass(radarrEnabled)}
                      aria-label="Toggle Radarr"
                    >
                      <span
                        className={toggleThumbClass(radarrEnabled)}
                      />
                    </button>
                  </div>
                  {radarrEnabled && (
                    <button
                      onClick={testRadarrConnection}
                      className={testButtonClass}
                    >
                      <TestTube size={18} />
                      Test
                    </button>
                  )}
                </div>
                {radarrEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelClass}>Base URL</label>
                    <input
                      type="text"
                      value={radarrBaseUrl}
                      onChange={(e) => setRadarrBaseUrl(e.target.value)}
                      placeholder="http://localhost:7878"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      value={radarrApiKey}
                      onChange={(e) => setRadarrApiKey(e.target.value)}
                      placeholder={secretsPresent.radarr ? "Saved (enter new to replace)" : "Enter Radarr API key"}
                      className={inputClass}
                    />
                  </div>
                </div>
                )}
              </motion.div>

              {/* Sonarr Configuration */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className={cardClass}
              >
                <div className={cardHeaderClass}>
                  <div className="flex items-center gap-4">
                    <h2 className={cardTitleClass}>Sonarr</h2>
                    <button
                      onClick={() => setSonarrEnabled(!sonarrEnabled)}
                      className={toggleTrackClass(sonarrEnabled)}
                      aria-label="Toggle Sonarr"
                    >
                      <span
                        className={toggleThumbClass(sonarrEnabled)}
                      />
                    </button>
                  </div>
                  {sonarrEnabled && (
                    <button
                      onClick={testSonarrConnection}
                      className={testButtonClass}
                    >
                      <TestTube size={18} />
                      Test
                    </button>
                  )}
                </div>
                {sonarrEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelClass}>Base URL</label>
                    <input
                      type="text"
                      value={sonarrBaseUrl}
                      onChange={(e) => setSonarrBaseUrl(e.target.value)}
                      placeholder="http://localhost:8989"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      value={sonarrApiKey}
                      onChange={(e) => setSonarrApiKey(e.target.value)}
                      placeholder={secretsPresent.sonarr ? "Saved (enter new to replace)" : "Enter Sonarr API key"}
                      className={inputClass}
                    />
                  </div>
                </div>
                )}
              </motion.div>

              {/* Google Configuration */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
                className={cardClass}
              >
                <div className={cardHeaderClass}>
                  <div className="flex items-center gap-4">
                    <h2 className={cardTitleClass}>Google Search</h2>
                    <button
                      onClick={() => setGoogleEnabled(!googleEnabled)}
                      className={toggleTrackClass(googleEnabled)}
                      aria-label="Toggle Google Search"
                    >
                      <span
                        className={toggleThumbClass(googleEnabled)}
                      />
                    </button>
                  </div>
                  {googleEnabled && (
                    <button
                      onClick={testGoogleConnection}
                      className={testButtonClass}
                    >
                      <TestTube size={18} />
                      Test
                    </button>
                  )}
                </div>
                {googleEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelClass}>Search Engine ID</label>
                    <input
                      type="text"
                      value={googleSearchEngineId}
                      onChange={(e) => setGoogleSearchEngineId(e.target.value)}
                      placeholder="Enter Google Search Engine ID"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      value={googleApiKey}
                      onChange={(e) => setGoogleApiKey(e.target.value)}
                      placeholder={secretsPresent.google ? "Saved (enter new to replace)" : "Enter Google API key"}
                      className={inputClass}
                    />
                  </div>
                </div>
                )}
              </motion.div>

              {/* OpenAI Configuration */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.6 }}
                className={cardClass}
              >
                <div className={cardHeaderClass}>
                  <div className="flex items-center gap-4">
                    <h2 className={cardTitleClass}>OpenAI</h2>
                    <button
                      onClick={() => setOpenAiEnabled(!openAiEnabled)}
                      className={toggleTrackClass(openAiEnabled)}
                      aria-label="Toggle OpenAI"
                    >
                      <span
                        className={toggleThumbClass(openAiEnabled)}
                      />
                    </button>
                  </div>
                  {openAiEnabled && (
                    <button
                      onClick={testOpenAiConnection}
                      className={testButtonClass}
                    >
                      <TestTube size={18} />
                      Test
                    </button>
                  )}
                </div>
                {openAiEnabled && (
                  <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      value={openAiApiKey}
                      onChange={(e) => setOpenAiApiKey(e.target.value)}
                      placeholder={secretsPresent.openai ? "Saved (enter new to replace)" : "Enter OpenAI API key"}
                      className={inputClass}
                    />
                  </div>
                </div>
                )}
              </motion.div>

              {/* Overseerr Configuration */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.7 }}
                className={cardClass}
              >
                <div className={cardHeaderClass}>
                  <div className="flex items-center gap-4">
                    <h2 className={cardTitleClass}>Overseerr</h2>
                    <button
                      onClick={() => setOverseerrEnabled(!overseerrEnabled)}
                      className={toggleTrackClass(overseerrEnabled)}
                      aria-label="Toggle Overseerr"
                    >
                      <span
                        className={toggleThumbClass(overseerrEnabled)}
                      />
                    </button>
                  </div>
                  {overseerrEnabled && (
                    <button
                      onClick={testOverseerrConnection}
                      className={testButtonClass}
                    >
                      <TestTube size={18} />
                      Test
                    </button>
                  )}
                </div>
                {overseerrEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelClass}>Base URL</label>
                    <input
                      type="text"
                      value={overseerrBaseUrl}
                      onChange={(e) => setOverseerrBaseUrl(e.target.value)}
                      placeholder="http://localhost:5055"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      value={overseerrApiKey}
                      onChange={(e) => setOverseerrApiKey(e.target.value)}
                      placeholder={secretsPresent.overseerr ? "Saved (enter new to replace)" : "Enter Overseerr API key"}
                      className={inputClass}
                    />
                  </div>
                </div>
                )}
              </motion.div>

              {/* Save Button */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.8 }}
                className="flex justify-end"
              >
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="px-8 py-4 bg-gray-900 dark:bg-gray-800 text-white rounded-full hover:bg-gray-800 dark:hover:bg-gray-700 active:scale-95 transition-all duration-300 shadow-lg hover:shadow-xl flex items-center gap-2 min-h-[44px] disabled:opacity-60 disabled:pointer-events-none"
                >
                  <Save size={20} />
                  {saveMutation.isPending ? 'Saving…' : 'Save Configuration'}
                </button>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
