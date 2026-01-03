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
  const [plexToken, setPlexToken] = useState('');

  // Load existing settings when data is available
  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;

    const secrets = settingsQuery.data?.secretsPresent ?? {};

    const plexBaseUrlSaved = readString(settings, 'plex.baseUrl');
    const radarrBaseUrlSaved = readString(settings, 'radarr.baseUrl');
    const sonarrBaseUrlSaved = readString(settings, 'sonarr.baseUrl');
    const googleSearchEngineIdSaved = readString(settings, 'google.searchEngineId');
    const overseerrBaseUrlSaved = readString(settings, 'overseerr.baseUrl');

    if (plexBaseUrlSaved) setPlexBaseUrl(plexBaseUrlSaved);
    if (radarrBaseUrlSaved) setRadarrBaseUrl(radarrBaseUrlSaved);
    if (sonarrBaseUrlSaved) setSonarrBaseUrl(sonarrBaseUrlSaved);
    if (googleSearchEngineIdSaved) setGoogleSearchEngineId(googleSearchEngineIdSaved);
    if (overseerrBaseUrlSaved) setOverseerrBaseUrl(overseerrBaseUrlSaved);

    // Prefer explicit enabled flags from settings. Fallback to secrets-present for legacy configs.
    const radarrEnabledSaved = readBool(settings, 'radarr.enabled');
    const sonarrEnabledSaved = readBool(settings, 'sonarr.enabled');
    const googleEnabledSaved = readBool(settings, 'google.enabled');
    const openAiEnabledSaved = readBool(settings, 'openai.enabled');
    const overseerrEnabledSaved = readBool(settings, 'overseerr.enabled');

    setRadarrEnabled(radarrEnabledSaved ?? Boolean((secrets as any).radarr));
    setSonarrEnabled(sonarrEnabledSaved ?? Boolean((secrets as any).sonarr));
    setGoogleEnabled(googleEnabledSaved ?? Boolean((secrets as any).google));
    setOpenAiEnabled(openAiEnabledSaved ?? Boolean((secrets as any).openai));
    setOverseerrEnabled(overseerrEnabledSaved ?? Boolean((secrets as any).overseerr));
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

  // Note: enabled toggles are driven by settings (with a legacy fallback above),
  // not by re-auto-enabling whenever secrets exist.

  // Plex OAuth state
  const [isPlexOAuthLoading, setIsPlexOAuthLoading] = useState(false);

  const handlePlexOAuth = async () => {
    // Mobile Safari (and some browsers) will block popups if window.open is called
    // after an async boundary. Open a placeholder window synchronously, then
    // navigate it once we have the Plex authUrl.
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
    const popup = window.open('about:blank', 'PlexAuth', features);

    if (!popup) {
      toast.error('Popup blocked. Please allow popups to sign in with Plex.');
      return;
    }

    try {
      popup.document.title = 'Plex Login';
      popup.document.body.innerHTML =
        '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px;">Loading Plex login…</div>';
    } catch {
      // Cross-origin / sandboxed environments may block access. Safe to ignore.
    }

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

      // Step 2: Navigate the pre-opened window/tab to Plex auth.
      try {
        popup.location.href = authUrl;
      } catch {
        // Fallback: if we cannot set location for some reason, open a new tab.
        window.open(authUrl, '_blank', 'noopener,noreferrer');
      }

      toast.info('Login with Plex in the opened window/tab', { id: toastId });

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
              try {
                popup.close();
              } catch {
                // ignore
              }
              setPlexToken(checkData.authToken);
              setIsPlexOAuthLoading(false);
              toast.success('Connected to Plex.', { id: toastId });
            }
          }
        } catch (error) {
          // Continue polling on error
          console.error('Poll error:', error);
        }
      }, 2000); // Poll every 2 seconds

    } catch (error) {
      try {
        popup.close();
      } catch {
        // ignore
      }
      setIsPlexOAuthLoading(false);
      toast.error('Couldn’t start Plex login. Please try again.', { id: toastId });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentSettings = settingsQuery.data?.settings ?? {};
      const settingsPatch: Record<string, unknown> = {};
      const secretsPatch: Record<string, unknown> = {};

      const nextPlexBaseUrl = plexBaseUrl.trim();

      const curPlexBaseUrl = readString(currentSettings, 'plex.baseUrl');

      const plexBaseUrlChanged = Boolean(nextPlexBaseUrl) && nextPlexBaseUrl !== curPlexBaseUrl;

      const plexSettings: Record<string, unknown> = {};
      if (plexBaseUrlChanged) plexSettings.baseUrl = nextPlexBaseUrl;
      if (Object.keys(plexSettings).length) settingsPatch.plex = plexSettings;

      const plexTokenTrimmed = plexToken.trim();
      const plexTokenChanged = Boolean(plexTokenTrimmed) && plexTokenTrimmed !== MASKED_SECRET;

      // Optional services (diff-based patches; only when toggled on)
      const curRadarrBaseUrl = readString(currentSettings, 'radarr.baseUrl');
      const curSonarrBaseUrl = readString(currentSettings, 'sonarr.baseUrl');
      const curGoogleSearchEngineId = readString(currentSettings, 'google.searchEngineId');
      const curOverseerrBaseUrl = readString(currentSettings, 'overseerr.baseUrl');

      const curRadarrEnabled =
        readBool(currentSettings, 'radarr.enabled') ?? Boolean(secretsPresent.radarr);
      const curSonarrEnabled =
        readBool(currentSettings, 'sonarr.enabled') ?? Boolean(secretsPresent.sonarr);
      const curGoogleEnabled =
        readBool(currentSettings, 'google.enabled') ?? Boolean(secretsPresent.google);
      const curOpenAiEnabled =
        readBool(currentSettings, 'openai.enabled') ?? Boolean(secretsPresent.openai);
      const curOverseerrEnabled =
        readBool(currentSettings, 'overseerr.enabled') ?? Boolean(secretsPresent.overseerr);

      const nextRadarrBaseUrl = radarrBaseUrl.trim();
      const nextSonarrBaseUrl = sonarrBaseUrl.trim();
      const nextGoogleSearchEngineId = googleSearchEngineId.trim();
      const nextOverseerrBaseUrl = overseerrBaseUrl.trim();

      const radarrEnabledChanged = radarrEnabled !== curRadarrEnabled;
      const sonarrEnabledChanged = sonarrEnabled !== curSonarrEnabled;
      const googleEnabledChanged = googleEnabled !== curGoogleEnabled;
      const openAiEnabledChanged = openAiEnabled !== curOpenAiEnabled;
      const overseerrEnabledChanged = overseerrEnabled !== curOverseerrEnabled;

      const radarrBaseChanged =
        radarrEnabled && Boolean(nextRadarrBaseUrl) && nextRadarrBaseUrl !== curRadarrBaseUrl;
      const sonarrBaseChanged =
        sonarrEnabled && Boolean(nextSonarrBaseUrl) && nextSonarrBaseUrl !== curSonarrBaseUrl;
      const googleIdChanged =
        googleEnabled &&
        Boolean(nextGoogleSearchEngineId) &&
        nextGoogleSearchEngineId !== curGoogleSearchEngineId;
      const overseerrBaseChanged =
        overseerrEnabled &&
        Boolean(nextOverseerrBaseUrl) &&
        nextOverseerrBaseUrl !== curOverseerrBaseUrl;

      const radarrSettings: Record<string, unknown> = {};
      if (radarrEnabledChanged) radarrSettings.enabled = radarrEnabled;
      if (radarrBaseChanged) radarrSettings.baseUrl = nextRadarrBaseUrl;
      if (Object.keys(radarrSettings).length) settingsPatch.radarr = radarrSettings;

      const sonarrSettings: Record<string, unknown> = {};
      if (sonarrEnabledChanged) sonarrSettings.enabled = sonarrEnabled;
      if (sonarrBaseChanged) sonarrSettings.baseUrl = nextSonarrBaseUrl;
      if (Object.keys(sonarrSettings).length) settingsPatch.sonarr = sonarrSettings;

      const googleSettings: Record<string, unknown> = {};
      if (googleEnabledChanged) googleSettings.enabled = googleEnabled;
      if (googleIdChanged) googleSettings.searchEngineId = nextGoogleSearchEngineId;
      if (Object.keys(googleSettings).length) settingsPatch.google = googleSettings;

      const openAiSettings: Record<string, unknown> = {};
      if (openAiEnabledChanged) openAiSettings.enabled = openAiEnabled;
      if (Object.keys(openAiSettings).length) settingsPatch.openai = openAiSettings;

      const overseerrSettings: Record<string, unknown> = {};
      if (overseerrEnabledChanged) overseerrSettings.enabled = overseerrEnabled;
      if (overseerrBaseChanged) overseerrSettings.baseUrl = nextOverseerrBaseUrl;
      if (Object.keys(overseerrSettings).length) settingsPatch.overseerr = overseerrSettings;

      if (plexTokenChanged) {
        secretsPatch.plex = { token: plexTokenTrimmed };
      }

      const tmdbKeyTrimmed = tmdbApiKey.trim();
      const tmdbKeyChanged = Boolean(tmdbKeyTrimmed) && tmdbKeyTrimmed !== MASKED_SECRET;
      if (tmdbKeyChanged) {
        secretsPatch.tmdb = { apiKey: tmdbKeyTrimmed };
      }

      const radarrKeyTrimmed = radarrApiKey.trim();
      const radarrKeyChanged =
        radarrEnabled && Boolean(radarrKeyTrimmed) && radarrKeyTrimmed !== MASKED_SECRET;
      if (radarrKeyChanged) {
        secretsPatch.radarr = { apiKey: radarrKeyTrimmed };
      }

      const sonarrKeyTrimmed = sonarrApiKey.trim();
      const sonarrKeyChanged =
        sonarrEnabled && Boolean(sonarrKeyTrimmed) && sonarrKeyTrimmed !== MASKED_SECRET;
      if (sonarrKeyChanged) {
        secretsPatch.sonarr = { apiKey: sonarrKeyTrimmed };
      }

      const googleKeyTrimmed = googleApiKey.trim();
      const googleKeyChanged =
        googleEnabled && Boolean(googleKeyTrimmed) && googleKeyTrimmed !== MASKED_SECRET;
      if (googleKeyChanged) {
        secretsPatch.google = { apiKey: googleKeyTrimmed };
      }

      const openAiKeyTrimmed = openAiApiKey.trim();
      const openAiKeyChanged =
        openAiEnabled && Boolean(openAiKeyTrimmed) && openAiKeyTrimmed !== MASKED_SECRET;
      if (openAiKeyChanged) {
        secretsPatch.openai = { apiKey: openAiKeyTrimmed };
      }

      const overseerrKeyTrimmed = overseerrApiKey.trim();
      const overseerrKeyChanged =
        overseerrEnabled &&
        Boolean(overseerrKeyTrimmed) &&
        overseerrKeyTrimmed !== MASKED_SECRET;
      if (overseerrKeyChanged) {
        secretsPatch.overseerr = { apiKey: overseerrKeyTrimmed };
      }

      // --- Pre-save validation (only for changed items) ---
      // Plex: validate if any Plex field changed (settings or token)
      const plexChanged = plexBaseUrlChanged || plexTokenChanged;
      if (plexChanged) {
        const payload = {
          baseUrl: nextPlexBaseUrl || curPlexBaseUrl,
        };

        const res = plexTokenChanged
          ? await fetch('/api/plex/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, token: plexTokenTrimmed }),
            })
          : await fetch('/api/integrations/test/plex', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

        if (!res.ok) {
          throw new Error('Plex credentials are incorrect.');
        }
      }

      // Radarr: validate if baseUrl/apiKey changed (and enabled)
      const radarrBecameEnabled = radarrEnabled && !curRadarrEnabled;
      if (radarrEnabled && (radarrBecameEnabled || radarrBaseChanged || radarrKeyChanged)) {
        if (!nextRadarrBaseUrl) throw new Error('Please enter Radarr Base URL');
        if (!radarrKeyChanged && !secretsPresent.radarr)
          throw new Error('Please enter Radarr API Key');

        const res = radarrKeyChanged
          ? await fetch('/api/radarr/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl: nextRadarrBaseUrl, apiKey: radarrKeyTrimmed }),
            })
          : await fetch('/api/integrations/test/radarr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl: nextRadarrBaseUrl }),
            });
        if (!res.ok) throw new Error('Radarr credentials are incorrect.');
      }

      // Sonarr: validate if baseUrl/apiKey changed (and enabled)
      const sonarrBecameEnabled = sonarrEnabled && !curSonarrEnabled;
      if (sonarrEnabled && (sonarrBecameEnabled || sonarrBaseChanged || sonarrKeyChanged)) {
        if (!nextSonarrBaseUrl) throw new Error('Please enter Sonarr Base URL');
        if (!sonarrKeyChanged && !secretsPresent.sonarr)
          throw new Error('Please enter Sonarr API Key');

        const res = sonarrKeyChanged
          ? await fetch('/api/sonarr/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl: nextSonarrBaseUrl, apiKey: sonarrKeyTrimmed }),
            })
          : await fetch('/api/integrations/test/sonarr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl: nextSonarrBaseUrl }),
            });
        if (!res.ok) throw new Error('Sonarr credentials are incorrect.');
      }

      // Google: validate if searchEngineId/apiKey changed (and enabled)
      const googleBecameEnabled = googleEnabled && !curGoogleEnabled;
      if (googleEnabled && (googleBecameEnabled || googleIdChanged || googleKeyChanged)) {
        if (!nextGoogleSearchEngineId) throw new Error('Please enter Google Search Engine ID');
        if (!googleKeyChanged && !secretsPresent.google) throw new Error('Please enter Google API Key');

        const res = googleKeyChanged
          ? await fetch('/api/google/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                apiKey: googleKeyTrimmed,
                cseId: nextGoogleSearchEngineId,
                query: 'tautulli curated plex',
                numResults: 3,
              }),
            })
          : await fetch('/api/integrations/test/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ searchEngineId: nextGoogleSearchEngineId }),
            });
        if (!res.ok) throw new Error('Google credentials are incorrect.');
      }

      // OpenAI: validate if apiKey changed (and enabled)
      const openAiBecameEnabled = openAiEnabled && !curOpenAiEnabled;
      if (openAiEnabled && (openAiBecameEnabled || openAiKeyChanged)) {
        if (!openAiKeyChanged && !secretsPresent.openai) throw new Error('Please enter OpenAI API Key');

        const res = openAiKeyChanged
          ? await fetch('/api/openai/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ apiKey: openAiKeyTrimmed }),
            })
          : await fetch('/api/integrations/test/openai', { method: 'POST' });
        if (!res.ok) throw new Error('OpenAI API key is invalid.');
      }

      // Overseerr: validate if baseUrl/apiKey changed (and enabled)
      const overseerrBecameEnabled = overseerrEnabled && !curOverseerrEnabled;
      if (overseerrEnabled && (overseerrBecameEnabled || overseerrBaseChanged || overseerrKeyChanged)) {
        if (!nextOverseerrBaseUrl) throw new Error('Please enter Overseerr Base URL');
        if (!overseerrKeyChanged && !secretsPresent.overseerr)
          throw new Error('Please enter Overseerr API Key');

        const res = overseerrKeyChanged
          ? await fetch('/api/overseerr/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl: nextOverseerrBaseUrl, apiKey: overseerrKeyTrimmed }),
            })
          : await fetch('/api/integrations/test/overseerr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl: nextOverseerrBaseUrl }),
            });
        if (!res.ok) throw new Error('Overseerr credentials are incorrect.');
      }

      // TMDB: validate if apiKey changed
      if (tmdbKeyChanged) {
        const res = await fetch('/api/tmdb/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: tmdbKeyTrimmed }),
        });
        if (!res.ok) throw new Error('TMDB API key is invalid.');
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
      if (secretsPresent.plex && (!plexToken.trim() || plexToken === MASKED_SECRET)) {
        const response = await fetch('/api/integrations/test/plex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl: plexBaseUrl.trim() }),
        });

        if (response.ok) {
          toast.success('Connected to Plex.', { id: toastId });
        } else {
          toast.error('Plex credentials are incorrect.', { id: toastId });
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
          toast.success('Connected to Plex.', { id: toastId });
        } else {
          toast.error('Plex credentials are incorrect.', { id: toastId });
        }
      }
    } catch (error) {
      toast.error('Plex credentials are incorrect.', { id: toastId });
    }
  };

  const testRadarrConnection = async () => {
    const toastId = toast.loading('Testing Radarr connection...');
    try {
      const baseUrl = radarrBaseUrl.trim();
      const apiKey = radarrApiKey.trim();

      if (!baseUrl) {
        toast.error('Please enter Radarr Base URL', { id: toastId });
        return;
      }

      const response =
        secretsPresent.radarr && (!apiKey || apiKey === MASKED_SECRET)
          ? await fetch('/api/integrations/test/radarr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl }),
            })
          : await fetch('/api/radarr/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl, apiKey }),
            });

      if (response.ok) {
        toast.success('Connected to Radarr.', { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        const lower = String(msg).toLowerCase();
        if (lower.includes('http 401') || lower.includes('http 403') || lower.includes('unauthorized')) {
          toast.error('Radarr API key is incorrect.', { id: toastId });
        } else if (
          lower.includes('timeout') ||
          lower.includes('econnrefused') ||
          lower.includes('enotfound') ||
          lower.includes('failed to fetch')
        ) {
          toast.error('Couldn’t reach Radarr. Check the URL.', { id: toastId });
        } else {
          toast.error('Couldn’t connect to Radarr. Check the URL and API key.', { id: toastId });
        }
      }
    } catch (error) {
      toast.error('Couldn’t connect to Radarr. Check the URL and API key.', { id: toastId });
    }
  };

  const testSonarrConnection = async () => {
    const toastId = toast.loading('Testing Sonarr connection...');
    try {
      const baseUrl = sonarrBaseUrl.trim();
      const apiKey = sonarrApiKey.trim();

      if (!baseUrl) {
        toast.error('Please enter Sonarr Base URL', { id: toastId });
        return;
      }

      const response =
        secretsPresent.sonarr && (!apiKey || apiKey === MASKED_SECRET)
          ? await fetch('/api/integrations/test/sonarr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl }),
            })
          : await fetch('/api/sonarr/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl, apiKey }),
            });

      if (response.ok) {
        toast.success('Connected to Sonarr.', { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        const lower = String(msg).toLowerCase();
        if (lower.includes('http 401') || lower.includes('http 403') || lower.includes('unauthorized')) {
          toast.error('Sonarr API key is incorrect.', { id: toastId });
        } else if (
          lower.includes('timeout') ||
          lower.includes('econnrefused') ||
          lower.includes('enotfound') ||
          lower.includes('failed to fetch')
        ) {
          toast.error('Couldn’t reach Sonarr. Check the URL.', { id: toastId });
        } else {
          toast.error('Couldn’t connect to Sonarr. Check the URL and API key.', { id: toastId });
        }
      }
    } catch (error) {
      toast.error('Couldn’t connect to Sonarr. Check the URL and API key.', { id: toastId });
    }
  };

  const testTmdbConnection = async () => {
    const toastId = toast.loading('Testing TMDB connection...');
    try {
      // If credentials are saved (masked), test the saved credentials
      if (secretsPresent.tmdb && (!tmdbApiKey.trim() || tmdbApiKey === MASKED_SECRET)) {
        const response = await fetch('/api/integrations/test/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          toast.success('Connected to TMDB.', { id: toastId });
        } else {
          const error = await response.json().catch(() => ({ message: response.statusText }));
          const msg = error.message || response.statusText;
          const lower = String(msg).toLowerCase();
          if (lower.includes('http 401') || lower.includes('invalid api key') || lower.includes('unauthorized')) {
            toast.error('TMDB API key is invalid.', { id: toastId });
          } else {
            toast.error('Couldn’t connect to TMDB.', { id: toastId });
          }
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
          toast.success('Connected to TMDB.', { id: toastId });
        } else {
          const error = await response.json().catch(() => ({ message: response.statusText }));
          const msg = error.message || response.statusText;
          const lower = String(msg).toLowerCase();
          if (lower.includes('http 401') || lower.includes('invalid api key') || lower.includes('unauthorized')) {
            toast.error('TMDB API key is invalid.', { id: toastId });
          } else {
            toast.error('Couldn’t connect to TMDB.', { id: toastId });
          }
        }
      }
    } catch (error) {
      toast.error('Couldn’t connect to TMDB.', { id: toastId });
    }
  };

  const testGoogleConnection = async () => {
    const toastId = toast.loading('Testing Google Search connection...');
    try {
      const cseId = googleSearchEngineId.trim();
      const apiKey = googleApiKey.trim();

      if (!cseId) {
        toast.error('Please enter Google Search Engine ID', { id: toastId });
        return;
      }

      const response =
        secretsPresent.google && (!apiKey || apiKey === MASKED_SECRET)
          ? await fetch('/api/integrations/test/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ searchEngineId: cseId }),
            })
          : await fetch('/api/google/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                apiKey,
                cseId,
                query: 'tautulli curated plex',
                numResults: 3,
              }),
            });

      if (response.ok) {
        toast.success('Connected to Google Search.', { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        const lower = String(msg).toLowerCase();
        if (lower.includes('http 401') || lower.includes('http 403') || lower.includes('unauthorized')) {
          toast.error('Google Search credentials are incorrect.', { id: toastId });
        } else {
          toast.error('Couldn’t connect to Google Search. Check your API key and Search Engine ID.', {
            id: toastId,
          });
        }
      }
    } catch (error) {
      toast.error('Couldn’t connect to Google Search. Check your API key and Search Engine ID.', { id: toastId });
    }
  };

  const testOpenAiConnection = async () => {
    const toastId = toast.loading('Testing OpenAI connection...');
    try {
      const apiKey = openAiApiKey.trim();
      const response =
        secretsPresent.openai && (!apiKey || apiKey === MASKED_SECRET)
          ? await fetch('/api/integrations/test/openai', { method: 'POST' })
          : await fetch('/api/openai/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ apiKey }),
            });

      if (response.ok) {
        toast.success('Connected to OpenAI.', { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        const lower = String(msg).toLowerCase();
        if (lower.includes('http 401') || lower.includes('incorrect api key') || lower.includes('unauthorized')) {
          toast.error('OpenAI API key is invalid.', { id: toastId });
        } else if (lower.includes('http 429') || lower.includes('rate')) {
          toast.error('OpenAI is rate-limiting requests. Please try again.', { id: toastId });
        } else {
          toast.error('Couldn’t connect to OpenAI.', { id: toastId });
        }
      }
    } catch (error) {
      toast.error('Couldn’t connect to OpenAI.', { id: toastId });
    }
  };

  const testOverseerrConnection = async () => {
    const toastId = toast.loading('Testing Overseerr connection...');
    try {
      const baseUrl = overseerrBaseUrl.trim();
      const apiKey = overseerrApiKey.trim();

      if (!baseUrl) {
        toast.error('Please enter Overseerr Base URL', { id: toastId });
        return;
      }

      const response =
        secretsPresent.overseerr && (!apiKey || apiKey === MASKED_SECRET)
          ? await fetch('/api/integrations/test/overseerr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl }),
            })
          : await fetch('/api/overseerr/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl, apiKey }),
            });

      if (response.ok) {
        toast.success('Connected to Overseerr.', { id: toastId });
      } else {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const msg = error.message || response.statusText;
        const lower = String(msg).toLowerCase();
        if (lower.includes('http 401') || lower.includes('http 403') || lower.includes('unauthorized')) {
          toast.error('Overseerr API key is incorrect.', { id: toastId });
        } else if (
          lower.includes('timeout') ||
          lower.includes('econnrefused') ||
          lower.includes('enotfound') ||
          lower.includes('failed to fetch')
        ) {
          toast.error('Couldn’t reach Overseerr. Check the URL.', { id: toastId });
        } else {
          toast.error('Couldn’t connect to Overseerr. Check the URL and API key.', { id: toastId });
        }
      }
    } catch (error) {
      toast.error('Couldn’t connect to Overseerr. Check the URL and API key.', { id: toastId });
    }
  };

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const cardHeaderClass = 'flex items-center justify-between gap-4 mb-6 min-h-[44px]';
  const cardTitleClass = 'text-2xl font-semibold text-white';
  const labelClass = 'block text-sm font-medium text-white/70 mb-2';
  const inputBaseClass =
    'px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-400/70 focus:border-transparent outline-none transition';
  const inputClass = `w-full ${inputBaseClass}`;
  const inputFlexClass = `flex-1 min-w-0 ${inputBaseClass}`;
  const testButtonClass =
    'inline-flex items-center gap-2 rounded-full border border-yellow-200/25 bg-yellow-400/90 px-4 py-2 text-sm font-semibold text-gray-900 shadow-[0_16px_40px_-18px_rgba(250,204,21,0.9)] hover:bg-yellow-300 hover:-translate-y-px active:translate-y-0 active:scale-95 transition-all duration-200 min-h-[44px]';
  const toggleTrackClass = (enabled: boolean) =>
    `relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95 ${
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
                  <h2 className={cardTitleClass}>Radarr</h2>
                  <div className="flex items-center gap-3">
                    {radarrEnabled && (
                      <button
                        onClick={testRadarrConnection}
                        className={testButtonClass}
                      >
                        <TestTube size={18} />
                        Test
                      </button>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={radarrEnabled}
                      onClick={() => setRadarrEnabled((v) => !v)}
                      className={toggleTrackClass(radarrEnabled)}
                      aria-label="Toggle Radarr"
                    >
                      <span
                        className={toggleThumbClass(radarrEnabled)}
                      />
                    </button>
                  </div>
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
                  <h2 className={cardTitleClass}>Sonarr</h2>
                  <div className="flex items-center gap-3">
                    {sonarrEnabled && (
                      <button
                        onClick={testSonarrConnection}
                        className={testButtonClass}
                      >
                        <TestTube size={18} />
                        Test
                      </button>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={sonarrEnabled}
                      onClick={() => setSonarrEnabled((v) => !v)}
                      className={toggleTrackClass(sonarrEnabled)}
                      aria-label="Toggle Sonarr"
                    >
                      <span
                        className={toggleThumbClass(sonarrEnabled)}
                      />
                    </button>
                  </div>
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
                  <h2 className={cardTitleClass}>Google Search</h2>
                  <div className="flex items-center gap-3">
                    {googleEnabled && (
                      <button
                        onClick={testGoogleConnection}
                        className={testButtonClass}
                      >
                        <TestTube size={18} />
                        Test
                      </button>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={googleEnabled}
                      onClick={() => setGoogleEnabled((v) => !v)}
                      className={toggleTrackClass(googleEnabled)}
                      aria-label="Toggle Google Search"
                    >
                      <span
                        className={toggleThumbClass(googleEnabled)}
                      />
                    </button>
                  </div>
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
                  <h2 className={cardTitleClass}>OpenAI</h2>
                  <div className="flex items-center gap-3">
                    {openAiEnabled && (
                      <button
                        onClick={testOpenAiConnection}
                        className={testButtonClass}
                      >
                        <TestTube size={18} />
                        Test
                      </button>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={openAiEnabled}
                      onClick={() => setOpenAiEnabled((v) => !v)}
                      className={toggleTrackClass(openAiEnabled)}
                      aria-label="Toggle OpenAI"
                    >
                      <span
                        className={toggleThumbClass(openAiEnabled)}
                      />
                    </button>
                  </div>
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
                  <h2 className={cardTitleClass}>Overseerr</h2>
                  <div className="flex items-center gap-3">
                    {overseerrEnabled && (
                      <button
                        onClick={testOverseerrConnection}
                        className={testButtonClass}
                      >
                        <TestTube size={18} />
                        Test
                      </button>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={overseerrEnabled}
                      onClick={() => setOverseerrEnabled((v) => !v)}
                      className={toggleTrackClass(overseerrEnabled)}
                      aria-label="Toggle Overseerr"
                    >
                      <span
                        className={toggleThumbClass(overseerrEnabled)}
                      />
                    </button>
                  </div>
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
                <motion.button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  whileTap={{ scale: 0.96 }}
                  className="px-8 py-4 bg-gray-900 dark:bg-gray-800 text-white rounded-full hover:bg-gray-800 dark:hover:bg-gray-700 transition-all duration-300 shadow-lg hover:shadow-xl flex items-center gap-2 min-h-[44px] disabled:opacity-60 disabled:pointer-events-none"
                >
                  <Save size={20} />
                  {/* Reserve space so label swap doesn't cause a width/position jitter */}
                  <span className="grid">
                    <span className="col-start-1 row-start-1 opacity-0">
                      Save Configuration
                    </span>
                    <span className="col-start-1 row-start-1">
                      {saveMutation.isPending ? 'Saving…' : 'Save Configuration'}
                    </span>
                  </span>
                </motion.button>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
