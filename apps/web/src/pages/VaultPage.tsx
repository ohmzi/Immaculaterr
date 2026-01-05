import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimation } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, LogIn, LockKeyhole } from 'lucide-react';
import { toast } from 'sonner';
import { getPublicSettings, putSettings } from '@/api/settings';
import { useLocation } from 'react-router-dom';

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

export function SettingsPage({
  pageTitle,
  headerIcon,
  subtitle,
  subtitleDetails,
  backgroundGradientClass = 'bg-gradient-to-br from-[#2e1065]/50 via-[#1e1b4b]/60 to-[#0f172a]/70',
  extraContent,
  showCards = true,
}: {
  pageTitle: string;
  headerIcon: ReactNode;
  subtitle: ReactNode;
  subtitleDetails?: ReactNode;
  backgroundGradientClass?: string;
  extraContent?: ReactNode;
  showCards?: boolean;
}) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const didInitServiceStatus = useRef(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const didRunLandingHealthCheck = useRef(false);
  const allowCardExpandAnimations = useRef(false);

  // Load settings to check which services are already configured
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    enabled: showCards,
  });

  const secretsPresent = useMemo(
    () => settingsQuery.data?.secretsPresent ?? {},
    [settingsQuery.data],
  );

  // Service setup state
  const [plexBaseUrl, setPlexBaseUrl] = useState('http://localhost:32400');
  const [plexToken, setPlexToken] = useState('');

  // Load existing settings when data is available
  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;

    const secrets: Record<string, boolean> = settingsQuery.data?.secretsPresent ?? {};

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

    const nextRadarrEnabled = radarrEnabledSaved ?? Boolean(secrets.radarr);
    const nextSonarrEnabled = sonarrEnabledSaved ?? Boolean(secrets.sonarr);
    const nextGoogleEnabled = googleEnabledSaved ?? Boolean(secrets.google);
    const nextOpenAiEnabled = openAiEnabledSaved ?? Boolean(secrets.openai);
    const nextOverseerrEnabled = overseerrEnabledSaved ?? Boolean(secrets.overseerr);

    setRadarrEnabled(nextRadarrEnabled);
    setSonarrEnabled(nextSonarrEnabled);
    setGoogleEnabled(nextGoogleEnabled);
    setOpenAiEnabled(nextOpenAiEnabled);
    setOverseerrEnabled(nextOverseerrEnabled);

    // Initialize UI status (only once per mount): enabled+saved creds => Active.
    if (!didInitServiceStatus.current) {
      didInitServiceStatus.current = true;
      setPlexTouched(false);
      setTmdbTouched(false);
      setRadarrTouched(false);
      setSonarrTouched(false);
      setGoogleTouched(false);
      setOpenAiTouched(false);
      setOverseerrTouched(false);

      setPlexTestOk(Boolean(secrets.plex) ? true : null);
      setTmdbTestOk(Boolean(secrets.tmdb) ? true : null);
      setRadarrTestOk(nextRadarrEnabled && Boolean(secrets.radarr) ? true : null);
      setSonarrTestOk(nextSonarrEnabled && Boolean(secrets.sonarr) ? true : null);
      setGoogleTestOk(
        nextGoogleEnabled && Boolean(secrets.google) && Boolean(googleSearchEngineIdSaved) ? true : null,
      );
      setOpenAiTestOk(nextOpenAiEnabled && Boolean(secrets.openai) ? true : null);
      setOverseerrTestOk(nextOverseerrEnabled && Boolean(secrets.overseerr) ? true : null);
    }

    // Signal that we've applied the persisted settings to local state.
    setSettingsHydrated(true);
  }, [settingsQuery.data?.settings]);

  // If a service is already enabled, we want its card to render expanded immediately (no "pop open"
  // after hydration). We still keep animations for user toggles after the first hydrated paint.
  useEffect(() => {
    if (!showCards) return;
    if (!settingsHydrated) return;
    allowCardExpandAnimations.current = true;
  }, [settingsHydrated, showCards]);

  // Support deep-linking to a specific integration card on Vault via hash
  // (e.g. /vault#vault-radarr). Wait for hydration so the target exists.
  useEffect(() => {
    if (!showCards) return;
    if (!settingsHydrated) return;
    const hash = location.hash || '';
    const id = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    requestAnimationFrame(() => {
      // Place the card slightly above center for nicer context while avoiding the "too high" feel.
      const rect = el.getBoundingClientRect();
      const desiredCenterY = window.innerHeight * 0.44; // tweakable
      const targetTop = window.scrollY + rect.top - (desiredCenterY - rect.height / 2);
      window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    });
  }, [location.hash, settingsHydrated, showCards]);

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

  type TestMode = 'manual' | 'auto' | 'background';
  type StatusPillVariant = 'inactive' | 'test' | 'testing' | 'active';

  // UI state for service connectivity status pills
  const [plexTouched, setPlexTouched] = useState(false);
  const [tmdbTouched, setTmdbTouched] = useState(false);
  const [radarrTouched, setRadarrTouched] = useState(false);
  const [sonarrTouched, setSonarrTouched] = useState(false);
  const [googleTouched, setGoogleTouched] = useState(false);
  const [openAiTouched, setOpenAiTouched] = useState(false);
  const [overseerrTouched, setOverseerrTouched] = useState(false);

  const [plexTestOk, setPlexTestOk] = useState<boolean | null>(null);
  const [tmdbTestOk, setTmdbTestOk] = useState<boolean | null>(null);
  const [radarrTestOk, setRadarrTestOk] = useState<boolean | null>(null);
  const [sonarrTestOk, setSonarrTestOk] = useState<boolean | null>(null);
  const [googleTestOk, setGoogleTestOk] = useState<boolean | null>(null);
  const [openAiTestOk, setOpenAiTestOk] = useState<boolean | null>(null);
  const [overseerrTestOk, setOverseerrTestOk] = useState<boolean | null>(null);

  const [plexIsTesting, setPlexIsTesting] = useState(false);
  const [tmdbIsTesting, setTmdbIsTesting] = useState(false);
  const [radarrIsTesting, setRadarrIsTesting] = useState(false);
  const [sonarrIsTesting, setSonarrIsTesting] = useState(false);
  const [googleIsTesting, setGoogleIsTesting] = useState(false);
  const [openAiIsTesting, setOpenAiIsTesting] = useState(false);
  const [overseerrIsTesting, setOverseerrIsTesting] = useState(false);

  const plexTestRunId = useRef(0);
  const tmdbTestRunId = useRef(0);
  const radarrTestRunId = useRef(0);
  const sonarrTestRunId = useRef(0);
  const googleTestRunId = useRef(0);
  const openAiTestRunId = useRef(0);
  const overseerrTestRunId = useRef(0);

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
              setPlexTouched(true);
              setPlexTestOk(null);
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

    } catch {
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
      toast.success(`${pageTitle} updated.`);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : `Failed to save ${pageTitle} changes`,
      );
    },
  });

  const integrationEnabledMutation = useMutation({
    mutationFn: async (params: {
      integration: 'radarr' | 'sonarr' | 'google' | 'openai' | 'overseerr';
      enabled: boolean;
    }) =>
      putSettings({
        settings: {
          [params.integration]: { enabled: params.enabled },
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });

  const handleSave = () => {
    saveMutation.mutate();
  };

  const testPlexConnection = async (mode: TestMode = 'manual'): Promise<boolean | null> => {
    const toastId = mode === 'manual' ? toast.loading('Testing Plex connection...') : undefined;
    const startedAt = Date.now();
    const showError = (message: string, opts?: { immediate?: boolean }) => {
      if (mode === 'background') return;
      const doToast = () => {
        if (toastId) toast.error(message, { id: toastId });
        else toast.error(message);
      };
      if (opts?.immediate) {
        doToast();
        return;
      }
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };
    const showSuccess = (message: string) => {
      if (!toastId) return;
      const doToast = () => toast.success(message, { id: toastId });
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };

    try {
      const baseUrl = plexBaseUrl.trim();
      const token = plexToken.trim();

      if (!baseUrl) {
        showError('Please enter Plex Base URL', { immediate: true });
        return null;
      }
      if (!secretsPresent.plex && !token) {
        showError('Please enter Plex Token', { immediate: true });
        return null;
      }

      const response =
        secretsPresent.plex && (!token || token === MASKED_SECRET)
          ? await fetch('/api/integrations/test/plex', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl }),
            })
          : await fetch('/api/plex/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl, token }),
            });

      if (response.ok) {
        showSuccess('Connected to Plex.');
        return true;
      }

      showError('Plex credentials are incorrect.');
      return false;
    } catch {
      showError('Plex credentials are incorrect.');
      return false;
    }
  };

  const testRadarrConnection = async (mode: TestMode = 'manual'): Promise<boolean | null> => {
    const toastId = mode === 'manual' ? toast.loading('Testing Radarr connection...') : undefined;
    const startedAt = Date.now();
    const showError = (message: string, opts?: { immediate?: boolean }) => {
      if (mode === 'background') return;
      const doToast = () => {
        if (toastId) toast.error(message, { id: toastId });
        else toast.error(message);
      };
      if (opts?.immediate) {
        doToast();
        return;
      }
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };
    const showSuccess = (message: string) => {
      if (!toastId) return;
      const doToast = () => toast.success(message, { id: toastId });
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };

    try {
      const baseUrl = radarrBaseUrl.trim();
      const apiKey = radarrApiKey.trim();

      if (!baseUrl) {
        showError('Please enter Radarr Base URL', { immediate: true });
        return null;
      }
      if (!secretsPresent.radarr && !apiKey) {
        showError('Please enter Radarr API Key', { immediate: true });
        return null;
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
        if (mode === 'manual') showSuccess('Connected to Radarr.');
        return true;
      }

      const error = await response.json().catch(() => ({ message: response.statusText }));
      const msg = error.message || response.statusText;
      const lower = String(msg).toLowerCase();
      if (lower.includes('http 401') || lower.includes('http 403') || lower.includes('unauthorized')) {
        showError('Radarr API key is incorrect.');
      } else if (
        lower.includes('timeout') ||
        lower.includes('econnrefused') ||
        lower.includes('enotfound') ||
        lower.includes('failed to fetch')
      ) {
        showError('Couldn’t reach Radarr. Check the URL.');
      } else {
        showError('Couldn’t connect to Radarr. Check the URL and API key.');
      }
      return false;
    } catch {
      showError('Couldn’t connect to Radarr. Check the URL and API key.');
      return false;
    }
  };

  const testSonarrConnection = async (mode: TestMode = 'manual'): Promise<boolean | null> => {
    const toastId = mode === 'manual' ? toast.loading('Testing Sonarr connection...') : undefined;
    const startedAt = Date.now();
    const showError = (message: string, opts?: { immediate?: boolean }) => {
      if (mode === 'background') return;
      const doToast = () => {
        if (toastId) toast.error(message, { id: toastId });
        else toast.error(message);
      };
      if (opts?.immediate) {
        doToast();
        return;
      }
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };
    const showSuccess = (message: string) => {
      if (!toastId) return;
      const doToast = () => toast.success(message, { id: toastId });
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };

    try {
      const baseUrl = sonarrBaseUrl.trim();
      const apiKey = sonarrApiKey.trim();

      if (!baseUrl) {
        showError('Please enter Sonarr Base URL', { immediate: true });
        return null;
      }
      if (!secretsPresent.sonarr && !apiKey) {
        showError('Please enter Sonarr API Key', { immediate: true });
        return null;
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
        if (mode === 'manual') showSuccess('Connected to Sonarr.');
        return true;
      }

      const error = await response.json().catch(() => ({ message: response.statusText }));
      const msg = error.message || response.statusText;
      const lower = String(msg).toLowerCase();
      if (lower.includes('http 401') || lower.includes('http 403') || lower.includes('unauthorized')) {
        showError('Sonarr API key is incorrect.');
      } else if (
        lower.includes('timeout') ||
        lower.includes('econnrefused') ||
        lower.includes('enotfound') ||
        lower.includes('failed to fetch')
      ) {
        showError('Couldn’t reach Sonarr. Check the URL.');
      } else {
        showError('Couldn’t connect to Sonarr. Check the URL and API key.');
      }
      return false;
    } catch {
      showError('Couldn’t connect to Sonarr. Check the URL and API key.');
      return false;
    }
  };

  const testTmdbConnection = async (mode: TestMode = 'manual'): Promise<boolean | null> => {
    const toastId = mode === 'manual' ? toast.loading('Testing TMDB connection...') : undefined;
    const startedAt = Date.now();
    const showError = (message: string, opts?: { immediate?: boolean }) => {
      if (mode === 'background') return;
      const doToast = () => {
        if (toastId) toast.error(message, { id: toastId });
        else toast.error(message);
      };
      if (opts?.immediate) {
        doToast();
        return;
      }
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };
    const showSuccess = (message: string) => {
      if (!toastId) return;
      const doToast = () => toast.success(message, { id: toastId });
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };

    try {
      const apiKey = tmdbApiKey.trim();
      if (!secretsPresent.tmdb && !apiKey) {
        showError('Please enter TMDB API Key', { immediate: true });
        return null;
      }

      const response =
        secretsPresent.tmdb && (!apiKey || apiKey === MASKED_SECRET)
          ? await fetch('/api/integrations/test/tmdb', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            })
          : await fetch('/api/tmdb/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ apiKey }),
            });

      if (response.ok) {
        showSuccess('Connected to TMDB.');
        return true;
      }

      const error = await response.json().catch(() => ({ message: response.statusText }));
      const msg = error.message || response.statusText;
      const lower = String(msg).toLowerCase();
      if (lower.includes('http 401') || lower.includes('invalid api key') || lower.includes('unauthorized')) {
        showError('TMDB API key is invalid.');
      } else {
        showError('Couldn’t connect to TMDB.');
      }
      return false;
    } catch {
      showError('Couldn’t connect to TMDB.');
      return false;
    }
  };

  const testGoogleConnection = async (mode: TestMode = 'manual'): Promise<boolean | null> => {
    const toastId = mode === 'manual' ? toast.loading('Testing Google Search connection...') : undefined;
    const startedAt = Date.now();
    const showError = (message: string, opts?: { immediate?: boolean }) => {
      if (mode === 'background') return;
      const doToast = () => {
        if (toastId) toast.error(message, { id: toastId });
        else toast.error(message);
      };
      if (opts?.immediate) {
        doToast();
        return;
      }
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };
    const showSuccess = (message: string) => {
      if (!toastId) return;
      const doToast = () => toast.success(message, { id: toastId });
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };

    try {
      const cseId = googleSearchEngineId.trim();
      const apiKey = googleApiKey.trim();

      if (!cseId) {
        showError('Please enter Google Search Engine ID', { immediate: true });
        return null;
      }
      if (!secretsPresent.google && !apiKey) {
        showError('Please enter Google API Key', { immediate: true });
        return null;
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
        if (mode === 'manual') showSuccess('Connected to Google Search.');
        return true;
      }

      const error = await response.json().catch(() => ({ message: response.statusText }));
      const msg = error.message || response.statusText;
      const lower = String(msg).toLowerCase();
      if (lower.includes('http 401') || lower.includes('http 403') || lower.includes('unauthorized')) {
        showError('Google Search credentials are incorrect.');
      } else {
        showError('Couldn’t connect to Google Search. Check your API key and Search Engine ID.');
      }
      return false;
    } catch {
      showError('Couldn’t connect to Google Search. Check your API key and Search Engine ID.');
      return false;
    }
  };

  const testOpenAiConnection = async (mode: TestMode = 'manual'): Promise<boolean | null> => {
    const toastId = mode === 'manual' ? toast.loading('Testing OpenAI connection...') : undefined;
    const startedAt = Date.now();
    const showError = (message: string, opts?: { immediate?: boolean }) => {
      if (mode === 'background') return;
      const doToast = () => {
        if (toastId) toast.error(message, { id: toastId });
        else toast.error(message);
      };
      if (opts?.immediate) {
        doToast();
        return;
      }
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };
    const showSuccess = (message: string) => {
      if (!toastId) return;
      const doToast = () => toast.success(message, { id: toastId });
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };

    try {
      const apiKey = openAiApiKey.trim();
      if (!secretsPresent.openai && !apiKey) {
        showError('Please enter OpenAI API Key', { immediate: true });
        return null;
      }

      const response =
        secretsPresent.openai && (!apiKey || apiKey === MASKED_SECRET)
          ? await fetch('/api/integrations/test/openai', { method: 'POST' })
          : await fetch('/api/openai/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ apiKey }),
            });

      if (response.ok) {
        if (mode === 'manual') showSuccess('Connected to OpenAI.');
        return true;
      }

      const error = await response.json().catch(() => ({ message: response.statusText }));
      const msg = error.message || response.statusText;
      const lower = String(msg).toLowerCase();
      if (lower.includes('http 401') || lower.includes('incorrect api key') || lower.includes('unauthorized')) {
        showError('OpenAI API key is invalid.');
      } else if (lower.includes('http 429') || lower.includes('rate')) {
        showError('OpenAI is rate-limiting requests. Please try again.');
      } else {
        showError('Couldn’t connect to OpenAI.');
      }
      return false;
    } catch {
      showError('Couldn’t connect to OpenAI.');
      return false;
    }
  };

  const testOverseerrConnection = async (mode: TestMode = 'manual'): Promise<boolean | null> => {
    const toastId = mode === 'manual' ? toast.loading('Testing Overseerr connection...') : undefined;
    const startedAt = Date.now();
    const showError = (message: string, opts?: { immediate?: boolean }) => {
      if (mode === 'background') return;
      const doToast = () => {
        if (toastId) toast.error(message, { id: toastId });
        else toast.error(message);
      };
      if (opts?.immediate) {
        doToast();
        return;
      }
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };
    const showSuccess = (message: string) => {
      if (!toastId) return;
      const doToast = () => toast.success(message, { id: toastId });
      const remaining = Math.max(0, 1000 - (Date.now() - startedAt));
      if (remaining) setTimeout(doToast, remaining);
      else doToast();
    };

    try {
      const baseUrl = overseerrBaseUrl.trim();
      const apiKey = overseerrApiKey.trim();

      if (!baseUrl) {
        showError('Please enter Overseerr Base URL', { immediate: true });
        return null;
      }
      if (!secretsPresent.overseerr && !apiKey) {
        showError('Please enter Overseerr API Key', { immediate: true });
        return null;
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
        if (mode === 'manual') showSuccess('Connected to Overseerr.');
        return true;
      }

      const error = await response.json().catch(() => ({ message: response.statusText }));
      const msg = error.message || response.statusText;
      const lower = String(msg).toLowerCase();
      if (lower.includes('http 401') || lower.includes('http 403') || lower.includes('unauthorized')) {
        showError('Overseerr API key is incorrect.');
      } else if (
        lower.includes('timeout') ||
        lower.includes('econnrefused') ||
        lower.includes('enotfound') ||
        lower.includes('failed to fetch')
      ) {
        showError('Couldn’t reach Overseerr. Check the URL.');
      } else {
        showError('Couldn’t connect to Overseerr. Check the URL and API key.');
      }
      return false;
    } catch {
      showError('Couldn’t connect to Overseerr. Check the URL and API key.');
      return false;
    }
  };

  const runPlexTest = async (mode: TestMode): Promise<boolean | null> => {
    const runId = ++plexTestRunId.current;
    const startedAt = Date.now();
    setPlexIsTesting(true);
    const result = await testPlexConnection(mode);
    if (plexTestRunId.current !== runId) return null;

    // UX: keep "Testing" visible for at least 1s (so it never flashes instantly).
    if (typeof result === 'boolean') {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 1000 - elapsed);
      if (remaining) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        if (plexTestRunId.current !== runId) return null;
      }
    }

    setPlexIsTesting(false);
    if (typeof result === 'boolean') setPlexTestOk(result);
    return typeof result === 'boolean' ? result : null;
  };

  const runTmdbTest = async (mode: TestMode): Promise<boolean | null> => {
    const runId = ++tmdbTestRunId.current;
    const startedAt = Date.now();
    setTmdbIsTesting(true);
    const result = await testTmdbConnection(mode);
    if (tmdbTestRunId.current !== runId) return null;

    if (typeof result === 'boolean') {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 1000 - elapsed);
      if (remaining) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        if (tmdbTestRunId.current !== runId) return null;
      }
    }

    setTmdbIsTesting(false);
    if (typeof result === 'boolean') setTmdbTestOk(result);
    return typeof result === 'boolean' ? result : null;
  };

  const runRadarrTest = async (mode: TestMode): Promise<boolean | null> => {
    const runId = ++radarrTestRunId.current;
    const startedAt = Date.now();
    setRadarrIsTesting(true);
    const result = await testRadarrConnection(mode);
    if (radarrTestRunId.current !== runId) return null;

    // UX: keep "Testing" visible for at least 1s (so it never flashes instantly).
    if (typeof result === 'boolean') {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 1000 - elapsed);
      if (remaining) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        if (radarrTestRunId.current !== runId) return null;
      }
    }

    setRadarrIsTesting(false);
    if (typeof result === 'boolean') setRadarrTestOk(result);
    return typeof result === 'boolean' ? result : null;
  };

  const runSonarrTest = async (mode: TestMode): Promise<boolean | null> => {
    const runId = ++sonarrTestRunId.current;
    const startedAt = Date.now();
    setSonarrIsTesting(true);
    const result = await testSonarrConnection(mode);
    if (sonarrTestRunId.current !== runId) return null;

    if (typeof result === 'boolean') {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 1000 - elapsed);
      if (remaining) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        if (sonarrTestRunId.current !== runId) return null;
      }
    }

    setSonarrIsTesting(false);
    if (typeof result === 'boolean') setSonarrTestOk(result);
    return typeof result === 'boolean' ? result : null;
  };

  const runGoogleTest = async (mode: TestMode): Promise<boolean | null> => {
    const runId = ++googleTestRunId.current;
    const startedAt = Date.now();
    setGoogleIsTesting(true);
    const result = await testGoogleConnection(mode);
    if (googleTestRunId.current !== runId) return null;

    if (typeof result === 'boolean') {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 1000 - elapsed);
      if (remaining) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        if (googleTestRunId.current !== runId) return null;
      }
    }

    setGoogleIsTesting(false);
    if (typeof result === 'boolean') setGoogleTestOk(result);
    return typeof result === 'boolean' ? result : null;
  };

  const runOpenAiTest = async (mode: TestMode): Promise<boolean | null> => {
    const runId = ++openAiTestRunId.current;
    const startedAt = Date.now();
    setOpenAiIsTesting(true);
    const result = await testOpenAiConnection(mode);
    if (openAiTestRunId.current !== runId) return null;

    if (typeof result === 'boolean') {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 1000 - elapsed);
      if (remaining) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        if (openAiTestRunId.current !== runId) return null;
      }
    }

    setOpenAiIsTesting(false);
    if (typeof result === 'boolean') setOpenAiTestOk(result);
    return typeof result === 'boolean' ? result : null;
  };

  const runOverseerrTest = async (mode: TestMode): Promise<boolean | null> => {
    const runId = ++overseerrTestRunId.current;
    const startedAt = Date.now();
    setOverseerrIsTesting(true);
    const result = await testOverseerrConnection(mode);
    if (overseerrTestRunId.current !== runId) return null;

    if (typeof result === 'boolean') {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 1000 - elapsed);
      if (remaining) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        if (overseerrTestRunId.current !== runId) return null;
      }
    }

    setOverseerrIsTesting(false);
    if (typeof result === 'boolean') setOverseerrTestOk(result);
    return typeof result === 'boolean' ? result : null;
  };

  // On landing, verify any "active" integrations in the persisted app data and
  // update UI + persisted enabled flags if something is no longer reachable.
  useEffect(() => {
    if (!settingsHydrated) return;
    if (!settingsQuery.data?.settings) return;
    if (didRunLandingHealthCheck.current) return;
    didRunLandingHealthCheck.current = true;

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    void (async () => {
      const tasks: Array<{
        key: 'plex' | 'tmdb' | 'radarr' | 'sonarr' | 'google' | 'openai' | 'overseerr';
        label: string;
        run: () => Promise<boolean | null>;
        disableOnFail: boolean;
      }> = [];

      // Always-configured integrations (active if secrets exist)
      if (secretsPresent.plex) tasks.push({ key: 'plex', label: 'Plex', run: () => runPlexTest('background'), disableOnFail: false });
      if (secretsPresent.tmdb) tasks.push({ key: 'tmdb', label: 'TMDB', run: () => runTmdbTest('background'), disableOnFail: false });

      // Optional integrations (active if enabled in persisted settings)
      if (radarrEnabled) tasks.push({ key: 'radarr', label: 'Radarr', run: () => runRadarrTest('background'), disableOnFail: true });
      if (sonarrEnabled) tasks.push({ key: 'sonarr', label: 'Sonarr', run: () => runSonarrTest('background'), disableOnFail: true });
      if (googleEnabled) tasks.push({ key: 'google', label: 'Google', run: () => runGoogleTest('background'), disableOnFail: true });
      if (openAiEnabled) tasks.push({ key: 'openai', label: 'OpenAI', run: () => runOpenAiTest('background'), disableOnFail: true });
      if (overseerrEnabled) tasks.push({ key: 'overseerr', label: 'Overseerr', run: () => runOverseerrTest('background'), disableOnFail: true });

      const results = await Promise.all(
        tasks.map(async (t, idx) => {
          // Slight stagger so the UI doesn't feel like everything "snaps" at once.
          await sleep(idx * 120);
          const result = await t.run();
          return { ...t, result };
        }),
      );

      const disablePatch: Record<string, unknown> = {};
      for (const r of results) {
        const ok = r.result === true;
        if (ok) continue;

        // If it was "active" from persisted settings, but the test failed, notify the user.
        toast.error(`${r.label} status changed: Active → Inactive`);

        // For non-toggle services, ensure the status pill reflects the failure even if the test
        // couldn't run due to missing fields (null result).
        if (r.key === 'plex') setPlexTestOk(false);
        if (r.key === 'tmdb') setTmdbTestOk(false);

        // For toggleable services, disable them in local state AND persist it (app data) so jobs
        // don't keep trying to use a broken integration.
        if (r.disableOnFail) {
          if (r.key === 'radarr') {
            setRadarrEnabled(false);
            disablePatch.radarr = { enabled: false };
          } else if (r.key === 'sonarr') {
            setSonarrEnabled(false);
            disablePatch.sonarr = { enabled: false };
          } else if (r.key === 'google') {
            setGoogleEnabled(false);
            disablePatch.google = { enabled: false };
          } else if (r.key === 'openai') {
            setOpenAiEnabled(false);
            disablePatch.openai = { enabled: false };
          } else if (r.key === 'overseerr') {
            setOverseerrEnabled(false);
            disablePatch.overseerr = { enabled: false };
          }
        }
      }

      if (Object.keys(disablePatch).length) {
        try {
          const updated = await putSettings({ settings: disablePatch });
          queryClient.setQueryData(['settings'], updated);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`Failed to update settings after health check: ${msg}`);
        }
      }
    })();
  }, [
    settingsHydrated,
    settingsQuery.data?.settings,
    secretsPresent.plex,
    secretsPresent.tmdb,
    radarrEnabled,
    sonarrEnabled,
    googleEnabled,
    openAiEnabled,
    overseerrEnabled,
    queryClient,
  ]);

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const cardHeaderClass = 'flex items-center justify-between gap-4 mb-6 min-h-[44px]';
  const cardTitleClass = 'text-2xl font-semibold text-white';
  const labelClass = 'block text-sm font-medium text-white/70 mb-2';
  const inputBaseClass =
    'px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-400/70 focus:border-transparent outline-none transition';
  const inputClass = `w-full ${inputBaseClass}`;
  const inputFlexClass = `flex-1 min-w-0 ${inputBaseClass}`;
  const toggleTrackClass = (enabled: boolean) =>
    `relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full transition-colors active:scale-95 ${
      enabled ? 'bg-yellow-400' : 'bg-white/15'
    }`;
  const toggleThumbClass = (enabled: boolean) =>
    `inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
      enabled ? 'translate-x-6' : 'translate-x-1'
    }`;

  const statusPillBaseClass =
    'inline-flex items-center justify-center gap-2 rounded-full px-4 text-xs font-semibold transition-all duration-200 h-7 min-w-[110px] border active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed';
  const statusPillClass = (variant: StatusPillVariant) => {
    switch (variant) {
      case 'active':
        return `${statusPillBaseClass} bg-emerald-500/90 text-white border-emerald-200/20 shadow-[0_16px_40px_-18px_rgba(16,185,129,0.75)]`;
      case 'test':
        return `${statusPillBaseClass} bg-yellow-400/90 text-gray-900 border-yellow-200/25 shadow-[0_16px_40px_-18px_rgba(250,204,21,0.9)] hover:bg-yellow-300`;
      case 'testing':
        return `${statusPillBaseClass} bg-yellow-400/60 text-gray-900 border-yellow-200/25`;
      case 'inactive':
      default:
        return `${statusPillBaseClass} bg-white/10 text-white/70 border-white/15`;
    }
  };
  const statusLabel = (variant: StatusPillVariant) => {
    switch (variant) {
      case 'active':
        return 'Active';
      case 'test':
        return 'Test';
      case 'testing':
        return 'Testing';
      case 'inactive':
      default:
        return 'Inactive';
    }
  };
  const statusDotClass = (variant: StatusPillVariant) => {
    switch (variant) {
      case 'active':
        return 'bg-white/90';
      case 'test':
        return 'bg-gray-900/70';
      case 'testing':
        return 'bg-gray-900/70';
      case 'inactive':
      default:
        return 'bg-white/35';
    }
  };

  const plexNeedsTest =
    plexTouched || (Boolean(plexToken.trim()) && plexToken.trim() !== MASKED_SECRET);
  const tmdbNeedsTest =
    tmdbTouched || (Boolean(tmdbApiKey.trim()) && tmdbApiKey.trim() !== MASKED_SECRET);
  const radarrNeedsTest =
    radarrTouched || (Boolean(radarrApiKey.trim()) && radarrApiKey.trim() !== MASKED_SECRET);
  const sonarrNeedsTest =
    sonarrTouched || (Boolean(sonarrApiKey.trim()) && sonarrApiKey.trim() !== MASKED_SECRET);
  const googleNeedsTest =
    googleTouched || (Boolean(googleApiKey.trim()) && googleApiKey.trim() !== MASKED_SECRET);
  const openAiNeedsTest =
    openAiTouched || (Boolean(openAiApiKey.trim()) && openAiApiKey.trim() !== MASKED_SECRET);
  const overseerrNeedsTest =
    overseerrTouched || (Boolean(overseerrApiKey.trim()) && overseerrApiKey.trim() !== MASKED_SECRET);

  const plexStatus: StatusPillVariant = plexIsTesting
    ? 'testing'
    : plexTestOk === true
      ? 'active'
      : plexTestOk === false
        ? 'inactive'
        : plexNeedsTest
          ? 'test'
          : 'inactive';
  const tmdbStatus: StatusPillVariant = tmdbIsTesting
    ? 'testing'
    : tmdbTestOk === true
      ? 'active'
      : tmdbTestOk === false
        ? 'inactive'
        : tmdbNeedsTest
          ? 'test'
          : 'inactive';
  const radarrStatus: StatusPillVariant = !radarrEnabled
    ? 'inactive'
    : radarrIsTesting
      ? 'testing'
      : radarrTestOk === true
        ? 'active'
        : radarrTestOk === false
          ? 'inactive'
          : radarrNeedsTest
            ? 'test'
            : 'inactive';
  const sonarrStatus: StatusPillVariant = !sonarrEnabled
    ? 'inactive'
    : sonarrIsTesting
      ? 'testing'
      : sonarrTestOk === true
        ? 'active'
        : sonarrTestOk === false
          ? 'inactive'
          : sonarrNeedsTest
            ? 'test'
            : 'inactive';
  const googleStatus: StatusPillVariant = !googleEnabled
    ? 'inactive'
    : googleIsTesting
      ? 'testing'
      : googleTestOk === true
        ? 'active'
        : googleTestOk === false
          ? 'inactive'
          : googleNeedsTest
            ? 'test'
            : 'inactive';
  const openAiStatus: StatusPillVariant = !openAiEnabled
    ? 'inactive'
    : openAiIsTesting
      ? 'testing'
      : openAiTestOk === true
        ? 'active'
        : openAiTestOk === false
          ? 'inactive'
          : openAiNeedsTest
            ? 'test'
            : 'inactive';
  const overseerrStatus: StatusPillVariant = !overseerrEnabled
    ? 'inactive'
    : overseerrIsTesting
      ? 'testing'
      : overseerrTestOk === true
        ? 'active'
        : overseerrTestOk === false
          ? 'inactive'
          : overseerrNeedsTest
            ? 'test'
            : 'inactive';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Background (landing-page style, blue-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className={`absolute inset-0 ${backgroundGradientClass}`} />
        <div className="absolute inset-0 bg-[#0b0c0f]/15" />
      </div>

      {/* Settings Content */}
      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16">
        <div className="container mx-auto px-4 pb-20 max-w-5xl">
          <div className="mb-12">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-5">
                <motion.button
                  type="button"
                  onClick={() => {
                    titleIconControls.stop();
                    titleIconGlowControls.stop();
                    void titleIconControls.start({
                      scale: [1, 1.06, 1],
                      transition: { duration: 0.55, ease: 'easeOut' },
                    });
                    void titleIconGlowControls.start({
                      opacity: [0, 0.7, 0, 0.55, 0, 0.4, 0],
                      transition: { duration: 1.4, ease: 'easeInOut' },
                    });
                  }}
                  animate={titleIconControls}
                  className="relative group focus:outline-none touch-manipulation"
                  aria-label={`Animate ${pageTitle} icon`}
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                  <motion.div
                    initial={{ rotate: -10, scale: 0.94, y: 2 }}
                    animate={{ rotate: -6, scale: 1, y: 0 }}
                    whileHover={{ rotate: 0, scale: 1.04 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    style={{ backfaceVisibility: 'hidden' }}
                    className="relative will-change-transform transform-gpu p-3 md:p-4 bg-[#facc15] rounded-2xl shadow-[0_0_30px_rgba(250,204,21,0.3)] border border-white/20"
                  >
                    {headerIcon}
                  </motion.div>
                </motion.button>
                <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                  {pageTitle}
                </h1>
              </div>

              <p className="text-purple-200/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                {subtitle}
                {subtitleDetails ? (
                  <>
                    <br />
                    <span className="text-sm opacity-60 font-normal">
                      {subtitleDetails}
                    </span>
                  </>
                ) : null}
              </p>
            </motion.div>
          </div>

          {extraContent ? <div className="mb-8 space-y-6">{extraContent}</div> : null}

          {showCards ? (
            !settingsHydrated ? (
              <div className="space-y-6">
                <div className={cardClass}>
                  <div className="flex items-center gap-3 text-white/80">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="font-medium">Loading your integrations…</span>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Settings Form */}
                <div className="space-y-6">
              {/* Plex Settings */}
              <div className={cardClass}>
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>Plex Media Server</h2>
                  <button
                    type="button"
                    disabled={plexStatus === 'testing' || (plexStatus === 'inactive' && plexTestOk !== false)}
                    onClick={() => void runPlexTest('manual')}
                    className={statusPillClass(plexStatus)}
                    aria-label={`Plex status: ${statusLabel(plexStatus)}`}
                  >
                    {plexStatus === 'testing' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className={`h-2 w-2 rounded-full ${statusDotClass(plexStatus)}`} />
                    )}
                    {statusLabel(plexStatus)}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelClass}>Base URL</label>
                    <input
                      type="text"
                      value={plexBaseUrl}
                      onChange={(e) => {
                        setPlexTouched(true);
                        setPlexTestOk(null);
                        setPlexBaseUrl(e.target.value);
                      }}
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
                        onChange={(e) => {
                          setPlexTouched(true);
                          setPlexTestOk(null);
                          setPlexToken(e.target.value);
                        }}
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
              </div>

              {/* TMDB Settings */}
              <div className={cardClass}>
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>The Movie Database (TMDB)</h2>
                  <button
                    type="button"
                    disabled={tmdbStatus === 'testing' || (tmdbStatus === 'inactive' && tmdbTestOk !== false)}
                    onClick={() => void runTmdbTest('manual')}
                    className={statusPillClass(tmdbStatus)}
                    aria-label={`TMDB status: ${statusLabel(tmdbStatus)}`}
                  >
                    {tmdbStatus === 'testing' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className={`h-2 w-2 rounded-full ${statusDotClass(tmdbStatus)}`} />
                    )}
                    {statusLabel(tmdbStatus)}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      value={tmdbApiKey}
                      onChange={(e) => {
                        setTmdbTouched(true);
                        setTmdbTestOk(null);
                        setTmdbApiKey(e.target.value);
                      }}
                      placeholder={secretsPresent.tmdb ? "Saved (enter new to replace)" : "Enter TMDB API key"}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Radarr Settings */}
              <div id="vault-radarr" className={`${cardClass} scroll-mt-24`}>
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>Radarr</h2>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={
                        !radarrEnabled || radarrStatus === 'testing' || (radarrStatus === 'inactive' && radarrTestOk !== false)
                      }
                      onClick={() => void runRadarrTest('manual')}
                      className={statusPillClass(radarrStatus)}
                      aria-label={`Radarr status: ${statusLabel(radarrStatus)}`}
                    >
                      {radarrStatus === 'testing' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className={`h-2 w-2 rounded-full ${statusDotClass(radarrStatus)}`} />
                      )}
                      {statusLabel(radarrStatus)}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={radarrEnabled}
                      onClick={() => {
                        const prev = radarrEnabled;
                        const next = !radarrEnabled;
                        setRadarrEnabled(next);
                        setRadarrTestOk(null);
                        radarrTestRunId.current += 1;
                        setRadarrIsTesting(false);

                        integrationEnabledMutation.mutate(
                          { integration: 'radarr', enabled: next },
                          {
                            onError: (err) => {
                              setRadarrEnabled(prev);
                              toast.error(
                                (err as Error)?.message ??
                                  'Failed to save Radarr enabled state',
                              );
                            },
                          },
                        );

                        if (!next) return;
                        const apiKey = radarrApiKey.trim();
                        const usesSavedCreds =
                          secretsPresent.radarr && (!apiKey || apiKey === MASKED_SECRET);
                        if (usesSavedCreds && !radarrTouched) {
                          void runRadarrTest('auto');
                        }
                      }}
                      disabled={
                        integrationEnabledMutation.isPending &&
                        integrationEnabledMutation.variables?.integration === 'radarr'
                      }
                      className={toggleTrackClass(radarrEnabled)}
                      aria-label="Toggle Radarr"
                    >
                      <span
                        className={toggleThumbClass(radarrEnabled)}
                      />
                    </button>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {radarrEnabled && (
                    <motion.div
                      initial={
                        allowCardExpandAnimations.current
                          ? { height: 0, opacity: 0 }
                          : false
                      }
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className={labelClass}>Base URL</label>
                          <input
                            type="text"
                            value={radarrBaseUrl}
                            onChange={(e) => {
                              setRadarrTouched(true);
                              setRadarrTestOk(null);
                              setRadarrBaseUrl(e.target.value);
                            }}
                            placeholder="http://localhost:7878"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>API Key</label>
                          <input
                            type="password"
                            value={radarrApiKey}
                            onChange={(e) => {
                              setRadarrTouched(true);
                              setRadarrTestOk(null);
                              setRadarrApiKey(e.target.value);
                            }}
                            placeholder={
                              secretsPresent.radarr ? 'Saved (enter new to replace)' : 'Enter Radarr API key'
                            }
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Sonarr Settings */}
              <div className={cardClass}>
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>Sonarr</h2>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={
                        !sonarrEnabled || sonarrStatus === 'testing' || (sonarrStatus === 'inactive' && sonarrTestOk !== false)
                      }
                      onClick={() => void runSonarrTest('manual')}
                      className={statusPillClass(sonarrStatus)}
                      aria-label={`Sonarr status: ${statusLabel(sonarrStatus)}`}
                    >
                      {sonarrStatus === 'testing' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className={`h-2 w-2 rounded-full ${statusDotClass(sonarrStatus)}`} />
                      )}
                      {statusLabel(sonarrStatus)}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={sonarrEnabled}
                      onClick={() => {
                        const prev = sonarrEnabled;
                        const next = !sonarrEnabled;
                        setSonarrEnabled(next);
                        setSonarrTestOk(null);
                        sonarrTestRunId.current += 1;
                        setSonarrIsTesting(false);

                        integrationEnabledMutation.mutate(
                          { integration: 'sonarr', enabled: next },
                          {
                            onError: (err) => {
                              setSonarrEnabled(prev);
                              toast.error(
                                (err as Error)?.message ??
                                  'Failed to save Sonarr enabled state',
                              );
                            },
                          },
                        );

                        if (!next) return;
                        const apiKey = sonarrApiKey.trim();
                        const usesSavedCreds =
                          secretsPresent.sonarr && (!apiKey || apiKey === MASKED_SECRET);
                        if (usesSavedCreds && !sonarrTouched) {
                          void runSonarrTest('auto');
                        }
                      }}
                      disabled={
                        integrationEnabledMutation.isPending &&
                        integrationEnabledMutation.variables?.integration === 'sonarr'
                      }
                      className={toggleTrackClass(sonarrEnabled)}
                      aria-label="Toggle Sonarr"
                    >
                      <span
                        className={toggleThumbClass(sonarrEnabled)}
                      />
                    </button>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {sonarrEnabled && (
                    <motion.div
                      initial={
                        allowCardExpandAnimations.current
                          ? { height: 0, opacity: 0 }
                          : false
                      }
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className={labelClass}>Base URL</label>
                          <input
                            type="text"
                            value={sonarrBaseUrl}
                            onChange={(e) => {
                              setSonarrTouched(true);
                              setSonarrTestOk(null);
                              setSonarrBaseUrl(e.target.value);
                            }}
                            placeholder="http://localhost:8989"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>API Key</label>
                          <input
                            type="password"
                            value={sonarrApiKey}
                            onChange={(e) => {
                              setSonarrTouched(true);
                              setSonarrTestOk(null);
                              setSonarrApiKey(e.target.value);
                            }}
                            placeholder={
                              secretsPresent.sonarr ? 'Saved (enter new to replace)' : 'Enter Sonarr API key'
                            }
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Google Settings */}
              <div className={cardClass}>
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>Google Search</h2>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={
                        !googleEnabled || googleStatus === 'testing' || (googleStatus === 'inactive' && googleTestOk !== false)
                      }
                      onClick={() => void runGoogleTest('manual')}
                      className={statusPillClass(googleStatus)}
                      aria-label={`Google Search status: ${statusLabel(googleStatus)}`}
                    >
                      {googleStatus === 'testing' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className={`h-2 w-2 rounded-full ${statusDotClass(googleStatus)}`} />
                      )}
                      {statusLabel(googleStatus)}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={googleEnabled}
                      onClick={() => {
                        const prev = googleEnabled;
                        const next = !googleEnabled;
                        setGoogleEnabled(next);
                        setGoogleTestOk(null);
                        googleTestRunId.current += 1;
                        setGoogleIsTesting(false);

                        integrationEnabledMutation.mutate(
                          { integration: 'google', enabled: next },
                          {
                            onError: (err) => {
                              setGoogleEnabled(prev);
                              toast.error(
                                (err as Error)?.message ??
                                  'Failed to save Google enabled state',
                              );
                            },
                          },
                        );

                        if (!next) return;
                        const apiKey = googleApiKey.trim();
                        const cseId = googleSearchEngineId.trim();
                        const usesSavedCreds =
                          secretsPresent.google && (!apiKey || apiKey === MASKED_SECRET);
                        if (usesSavedCreds && !googleTouched && Boolean(cseId)) {
                          void runGoogleTest('auto');
                        }
                      }}
                      disabled={
                        integrationEnabledMutation.isPending &&
                        integrationEnabledMutation.variables?.integration === 'google'
                      }
                      className={toggleTrackClass(googleEnabled)}
                      aria-label="Toggle Google Search"
                    >
                      <span
                        className={toggleThumbClass(googleEnabled)}
                      />
                    </button>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {googleEnabled && (
                    <motion.div
                      initial={
                        allowCardExpandAnimations.current
                          ? { height: 0, opacity: 0 }
                          : false
                      }
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className={labelClass}>Search Engine ID</label>
                          <input
                            type="text"
                            value={googleSearchEngineId}
                            onChange={(e) => {
                              setGoogleTouched(true);
                              setGoogleTestOk(null);
                              setGoogleSearchEngineId(e.target.value);
                            }}
                            placeholder="Enter Google Search Engine ID"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>API Key</label>
                          <input
                            type="password"
                            value={googleApiKey}
                            onChange={(e) => {
                              setGoogleTouched(true);
                              setGoogleTestOk(null);
                              setGoogleApiKey(e.target.value);
                            }}
                            placeholder={
                              secretsPresent.google ? 'Saved (enter new to replace)' : 'Enter Google API key'
                            }
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* OpenAI Settings */}
              <div className={cardClass}>
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>OpenAI</h2>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={
                        !openAiEnabled ||
                        openAiStatus === 'testing' ||
                        (openAiStatus === 'inactive' && openAiTestOk !== false)
                      }
                      onClick={() => void runOpenAiTest('manual')}
                      className={statusPillClass(openAiStatus)}
                      aria-label={`OpenAI status: ${statusLabel(openAiStatus)}`}
                    >
                      {openAiStatus === 'testing' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className={`h-2 w-2 rounded-full ${statusDotClass(openAiStatus)}`} />
                      )}
                      {statusLabel(openAiStatus)}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={openAiEnabled}
                      onClick={() => {
                        const prev = openAiEnabled;
                        const next = !openAiEnabled;
                        setOpenAiEnabled(next);
                        setOpenAiTestOk(null);
                        openAiTestRunId.current += 1;
                        setOpenAiIsTesting(false);

                        integrationEnabledMutation.mutate(
                          { integration: 'openai', enabled: next },
                          {
                            onError: (err) => {
                              setOpenAiEnabled(prev);
                              toast.error(
                                (err as Error)?.message ??
                                  'Failed to save OpenAI enabled state',
                              );
                            },
                          },
                        );

                        if (!next) return;
                        const apiKey = openAiApiKey.trim();
                        const usesSavedCreds =
                          secretsPresent.openai && (!apiKey || apiKey === MASKED_SECRET);
                        if (usesSavedCreds && !openAiTouched) {
                          void runOpenAiTest('auto');
                        }
                      }}
                      disabled={
                        integrationEnabledMutation.isPending &&
                        integrationEnabledMutation.variables?.integration === 'openai'
                      }
                      className={toggleTrackClass(openAiEnabled)}
                      aria-label="Toggle OpenAI"
                    >
                      <span
                        className={toggleThumbClass(openAiEnabled)}
                      />
                    </button>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {openAiEnabled && (
                    <motion.div
                      initial={
                        allowCardExpandAnimations.current
                          ? { height: 0, opacity: 0 }
                          : false
                      }
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 gap-6">
                        <div>
                          <label className={labelClass}>API Key</label>
                          <input
                            type="password"
                            value={openAiApiKey}
                            onChange={(e) => {
                              setOpenAiTouched(true);
                              setOpenAiTestOk(null);
                              setOpenAiApiKey(e.target.value);
                            }}
                            placeholder={
                              secretsPresent.openai ? 'Saved (enter new to replace)' : 'Enter OpenAI API key'
                            }
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Overseerr Settings */}
              <div className={cardClass}>
                <div className={cardHeaderClass}>
                  <h2 className={cardTitleClass}>Overseerr</h2>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={
                        !overseerrEnabled ||
                        overseerrStatus === 'testing' ||
                        (overseerrStatus === 'inactive' && overseerrTestOk !== false)
                      }
                      onClick={() => void runOverseerrTest('manual')}
                      className={statusPillClass(overseerrStatus)}
                      aria-label={`Overseerr status: ${statusLabel(overseerrStatus)}`}
                    >
                      {overseerrStatus === 'testing' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className={`h-2 w-2 rounded-full ${statusDotClass(overseerrStatus)}`} />
                      )}
                      {statusLabel(overseerrStatus)}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={overseerrEnabled}
                      onClick={() => {
                        const prev = overseerrEnabled;
                        const next = !overseerrEnabled;
                        setOverseerrEnabled(next);
                        setOverseerrTestOk(null);
                        overseerrTestRunId.current += 1;
                        setOverseerrIsTesting(false);

                        integrationEnabledMutation.mutate(
                          { integration: 'overseerr', enabled: next },
                          {
                            onError: (err) => {
                              setOverseerrEnabled(prev);
                              toast.error(
                                (err as Error)?.message ??
                                  'Failed to save Overseerr enabled state',
                              );
                            },
                          },
                        );

                        if (!next) return;
                        const baseUrl = overseerrBaseUrl.trim();
                        const apiKey = overseerrApiKey.trim();
                        const usesSavedCreds =
                          secretsPresent.overseerr && (!apiKey || apiKey === MASKED_SECRET);
                        if (usesSavedCreds && !overseerrTouched && Boolean(baseUrl)) {
                          void runOverseerrTest('auto');
                        }
                      }}
                      disabled={
                        integrationEnabledMutation.isPending &&
                        integrationEnabledMutation.variables?.integration === 'overseerr'
                      }
                      className={toggleTrackClass(overseerrEnabled)}
                      aria-label="Toggle Overseerr"
                    >
                      <span
                        className={toggleThumbClass(overseerrEnabled)}
                      />
                    </button>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {overseerrEnabled && (
                    <motion.div
                      initial={
                        allowCardExpandAnimations.current
                          ? { height: 0, opacity: 0 }
                          : false
                      }
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className={labelClass}>Base URL</label>
                          <input
                            type="text"
                            value={overseerrBaseUrl}
                            onChange={(e) => {
                              setOverseerrTouched(true);
                              setOverseerrTestOk(null);
                              setOverseerrBaseUrl(e.target.value);
                            }}
                            placeholder="http://localhost:5055"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>API Key</label>
                          <input
                            type="password"
                            value={overseerrApiKey}
                            onChange={(e) => {
                              setOverseerrTouched(true);
                              setOverseerrTestOk(null);
                              setOverseerrApiKey(e.target.value);
                            }}
                            placeholder={
                              secretsPresent.overseerr
                                ? 'Saved (enter new to replace)'
                                : 'Enter Overseerr API key'
                            }
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Save Button */}
              <div className="flex justify-end">
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
                      Save Changes
                    </span>
                    <span className="col-start-1 row-start-1">
                      {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
                    </span>
                  </span>
                </motion.button>
              </div>
                </div>
              </>
            )
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function VaultPage() {
  return (
    <SettingsPage
      pageTitle="Vault"
      headerIcon={
        <LockKeyhole
          className="w-8 h-8 md:w-10 md:h-10 text-black"
          strokeWidth={2.5}
        />
      }
      subtitle={
        <>
          Safely manage your{' '}
          <span className="text-[#facc15] font-bold">secrets</span> and integrations.
        </>
      }
      subtitleDetails={
        <>Saved keys stay masked — enter a new value to rotate.</>
      }
    />
  );
}
