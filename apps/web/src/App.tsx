import { useEffect, useState } from 'react';
import './App.css';

const ONBOARDING_STORAGE_KEY = 'tcp_onboarding_v1';

type OnboardingStored = {
  completed: boolean;
  completedAt?: string;
  rememberSecrets?: boolean;
  values?: Record<string, unknown>;
  results?: Record<string, unknown>;
};

function loadOnboarding(): OnboardingStored | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    return {
      completed: Boolean(obj.completed),
      completedAt: typeof obj.completedAt === 'string' ? obj.completedAt : undefined,
      rememberSecrets: Boolean(obj.rememberSecrets),
      values: typeof obj.values === 'object' && obj.values ? (obj.values as Record<string, unknown>) : undefined,
      results:
        typeof obj.results === 'object' && obj.results ? (obj.results as Record<string, unknown>) : undefined,
    };
  } catch {
    return null;
  }
}

function saveOnboarding(value: OnboardingStored) {
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(value));
}

function clearOnboarding() {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}

type HealthResponse = {
  status: 'ok';
  time: string;
};

type PlexCreatePinResponse = {
  id: number;
  expiresAt: string | null;
  authUrl: string;
  clientIdentifier: string;
};

type PlexCheckPinResponse = {
  id: number;
  authToken: string | null;
  expiresAt: string | null;
};

type PlexWhoamiResponse = {
  id: unknown;
  uuid: unknown;
  username: unknown;
  title: unknown;
};

type ArrTestResponse = {
  ok: boolean;
  status: unknown;
};

type GoogleTestResponse = {
  ok: boolean;
  results: Array<{ title: string; snippet: string; link: string }>;
  meta: unknown;
};

type TmdbTestResponse = {
  ok: boolean;
  summary: unknown;
  configuration: unknown;
};

type OpenAiTestResponse = {
  ok: boolean;
  meta: unknown;
};

type OverseerrTestResponse = {
  ok: boolean;
  status: unknown;
  summary: unknown;
};

function App() {
  const [stored, setStored] = useState<OnboardingStored | null>(() => loadOnboarding());

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [plexPin, setPlexPin] = useState<PlexCreatePinResponse | null>(null);
  const [plexAuthToken, setPlexAuthToken] = useState<string | null>(null);
  const [plexError, setPlexError] = useState<string | null>(null);
  const [isConnectingPlex, setIsConnectingPlex] = useState(false);
  const [plexLog, setPlexLog] = useState<string[]>([]);
  const [plexWhoami, setPlexWhoami] = useState<PlexWhoamiResponse | null>(null);
  const [plexWhoamiError, setPlexWhoamiError] = useState<string | null>(null);

  const [radarrBaseUrl, setRadarrBaseUrl] = useState(
    (stored?.values?.radarrBaseUrl as string | undefined) ?? 'http://localhost:7878',
  );
  const [radarrApiKey, setRadarrApiKey] = useState(
    (stored?.values?.radarrApiKey as string | undefined) ?? '',
  );
  const [radarrResult, setRadarrResult] = useState<ArrTestResponse | null>(null);
  const [radarrError, setRadarrError] = useState<string | null>(null);
  const [radarrLog, setRadarrLog] = useState<string[]>([]);

  const [sonarrBaseUrl, setSonarrBaseUrl] = useState(
    (stored?.values?.sonarrBaseUrl as string | undefined) ?? 'http://localhost:8989',
  );
  const [sonarrApiKey, setSonarrApiKey] = useState(
    (stored?.values?.sonarrApiKey as string | undefined) ?? '',
  );
  const [sonarrResult, setSonarrResult] = useState<ArrTestResponse | null>(null);
  const [sonarrError, setSonarrError] = useState<string | null>(null);
  const [sonarrLog, setSonarrLog] = useState<string[]>([]);

  const [googleApiKey, setGoogleApiKey] = useState(
    (stored?.values?.googleApiKey as string | undefined) ?? '',
  );
  const [googleCseId, setGoogleCseId] = useState(
    (stored?.values?.googleCseId as string | undefined) ?? '',
  );
  const [googleNumResults, setGoogleNumResults] = useState(
    (stored?.values?.googleNumResults as number | undefined) ?? 15,
  );
  const [googleQuery, setGoogleQuery] = useState(
    (stored?.values?.googleQuery as string | undefined) ?? 'imdb the matrix',
  );
  const [googleResult, setGoogleResult] = useState<GoogleTestResponse | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleLog, setGoogleLog] = useState<string[]>([]);

  const [tmdbApiKey, setTmdbApiKey] = useState(
    (stored?.values?.tmdbApiKey as string | undefined) ?? '',
  );
  const [tmdbResult, setTmdbResult] = useState<TmdbTestResponse | null>(null);
  const [tmdbError, setTmdbError] = useState<string | null>(null);
  const [tmdbLog, setTmdbLog] = useState<string[]>([]);

  const [openAiApiKey, setOpenAiApiKey] = useState(
    (stored?.values?.openAiApiKey as string | undefined) ?? '',
  );
  const [openAiResult, setOpenAiResult] = useState<OpenAiTestResponse | null>(null);
  const [openAiError, setOpenAiError] = useState<string | null>(null);
  const [openAiLog, setOpenAiLog] = useState<string[]>([]);

  const [overseerrBaseUrl, setOverseerrBaseUrl] = useState(
    (stored?.values?.overseerrBaseUrl as string | undefined) ?? 'http://localhost:5055',
  );
  const [overseerrApiKey, setOverseerrApiKey] = useState(
    (stored?.values?.overseerrApiKey as string | undefined) ?? '',
  );
  const [overseerrResult, setOverseerrResult] = useState<OverseerrTestResponse | null>(null);
  const [overseerrError, setOverseerrError] = useState<string | null>(null);
  const [overseerrLog, setOverseerrLog] = useState<string[]>([]);

  const [rememberSecrets, setRememberSecrets] = useState(stored?.rememberSecrets ?? true);
  const [wizardOpen, setWizardOpen] = useState(!stored?.completed);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as HealthResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setHealth(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!plexPin) return;
    if (plexAuthToken) return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/plex/pin/${plexPin.id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as PlexCheckPinResponse;
        if (cancelled) return;

        if (data.authToken) {
          setPlexAuthToken(data.authToken);
          setIsConnectingPlex(false);
          setPlexLog((prev) => [...prev, 'Plex token received. Validating…']);
        }
      } catch (err) {
        if (cancelled) return;
        setPlexError(err instanceof Error ? err.message : String(err));
        setIsConnectingPlex(false);
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [plexPin, plexAuthToken]);

  useEffect(() => {
    if (!plexAuthToken) return;

    let cancelled = false;
    setPlexWhoami(null);
    setPlexWhoamiError(null);

    fetch('/api/plex/whoami', {
      headers: {
        'X-Plex-Token': plexAuthToken,
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as PlexWhoamiResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setPlexWhoami(data);
        setPlexLog((prev) => [...prev, 'Plex token validated (whoami OK).']);
      })
      .catch((err) => {
        if (cancelled) return;
        setPlexWhoamiError(err instanceof Error ? err.message : String(err));
        setPlexLog((prev) => [...prev, 'Plex token validation failed.']);
      });

    return () => {
      cancelled = true;
    };
  }, [plexAuthToken]);

  async function onConnectPlex() {
    setPlexError(null);
    setPlexAuthToken(null);
    setPlexWhoami(null);
    setPlexWhoamiError(null);
    setPlexPin(null);
    setIsConnectingPlex(true);
    setPlexLog(['Requesting Plex PIN…']);

    try {
      const res = await fetch('/api/plex/pin', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as PlexCreatePinResponse;
      setPlexPin(data);
      setPlexLog((prev) => [
        ...prev,
        `Plex PIN created (id=${data.id}). Opening Plex authorization page…`,
      ]);

      // User-triggered button click -> popup should generally be allowed.
      window.open(data.authUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setPlexError(err instanceof Error ? err.message : String(err));
      setIsConnectingPlex(false);
    }
  }

  async function readApiError(res: Response) {
    const contentType = res.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const body = (await res.json().catch(() => null)) as unknown;
      if (body && typeof body === 'object') {
        const maybeMessage = (body as Record<string, unknown>)['message'];
        if (typeof maybeMessage === 'string') return maybeMessage;
        if (Array.isArray(maybeMessage)) return maybeMessage.join('; ');
      }
      return JSON.stringify(body);
    }

    const text = await res.text().catch(() => '');
    return text || `HTTP ${res.status}`;
  }

  async function onTestRadarr(): Promise<boolean> {
    setRadarrError(null);
    setRadarrResult(null);
    setRadarrLog(['Testing Radarr connection…']);

    try {
      if (!radarrBaseUrl.trim()) {
        setRadarrError('Base URL is required');
        setRadarrLog((prev) => [...prev, 'Radarr test FAILED.']);
        return false;
      }
      if (!radarrApiKey.trim()) {
        setRadarrError('API key is required');
        setRadarrLog((prev) => [...prev, 'Radarr test FAILED.']);
        return false;
      }

      const res = await fetch('/api/radarr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: radarrBaseUrl,
          apiKey: radarrApiKey,
        }),
      });
      if (!res.ok) {
        const msg = await readApiError(res);
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }
      const data = (await res.json()) as ArrTestResponse;
      setRadarrResult(data);
      setRadarrLog((prev) => [...prev, 'Radarr test OK.']);
      return true;
    } catch (err) {
      setRadarrError(err instanceof Error ? err.message : String(err));
      setRadarrLog((prev) => [...prev, 'Radarr test FAILED.']);
      return false;
    }
  }

  async function onTestSonarr(): Promise<boolean> {
    setSonarrError(null);
    setSonarrResult(null);
    setSonarrLog(['Testing Sonarr connection…']);

    try {
      if (!sonarrBaseUrl.trim()) {
        setSonarrError('Base URL is required');
        setSonarrLog((prev) => [...prev, 'Sonarr test FAILED.']);
        return false;
      }
      if (!sonarrApiKey.trim()) {
        setSonarrError('API key is required');
        setSonarrLog((prev) => [...prev, 'Sonarr test FAILED.']);
        return false;
      }

      const res = await fetch('/api/sonarr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
        }),
      });
      if (!res.ok) {
        const msg = await readApiError(res);
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }
      const data = (await res.json()) as ArrTestResponse;
      setSonarrResult(data);
      setSonarrLog((prev) => [...prev, 'Sonarr test OK.']);
      return true;
    } catch (err) {
      setSonarrError(err instanceof Error ? err.message : String(err));
      setSonarrLog((prev) => [...prev, 'Sonarr test FAILED.']);
      return false;
    }
  }

  async function onTestGoogle(): Promise<boolean> {
    setGoogleError(null);
    setGoogleResult(null);
    setGoogleLog(['Testing Google Programmable Search…']);

    try {
      if (!googleApiKey.trim()) {
        setGoogleError('GOOGLE_API_KEY is required');
        setGoogleLog((prev) => [...prev, 'Google test FAILED.']);
        return false;
      }
      if (!googleCseId.trim()) {
        setGoogleError('GOOGLE_CSE_ID (cx) is required for Google Programmable Search');
        setGoogleLog((prev) => [...prev, 'Google test FAILED.']);
        return false;
      }

      const res = await fetch('/api/google/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: googleApiKey,
          cseId: googleCseId,
          numResults: googleNumResults,
          query: googleQuery,
        }),
      });

      if (!res.ok) {
        const msg = await readApiError(res);
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }

      const data = (await res.json()) as GoogleTestResponse;
      setGoogleResult(data);
      setGoogleLog((prev) => [...prev, 'Google test OK.']);
      return true;
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : String(err));
      setGoogleLog((prev) => [...prev, 'Google test FAILED.']);
      return false;
    }
  }

  async function onTestTmdb(): Promise<boolean> {
    setTmdbError(null);
    setTmdbResult(null);
    setTmdbLog(['Testing TMDB connection…']);

    try {
      if (!tmdbApiKey.trim()) {
        setTmdbError('TMDB_API_KEY is required');
        setTmdbLog((prev) => [...prev, 'TMDB test FAILED.']);
        return false;
      }

      const res = await fetch('/api/tmdb/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: tmdbApiKey,
        }),
      });

      if (!res.ok) {
        const msg = await readApiError(res);
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }

      const data = (await res.json()) as TmdbTestResponse;
      setTmdbResult(data);
      setTmdbLog((prev) => [...prev, 'TMDB test OK.']);
      return true;
    } catch (err) {
      setTmdbError(err instanceof Error ? err.message : String(err));
      setTmdbLog((prev) => [...prev, 'TMDB test FAILED.']);
      return false;
    }
  }

  async function onTestOpenAi(): Promise<boolean> {
    setOpenAiError(null);
    setOpenAiResult(null);
    setOpenAiLog(['Testing OpenAI connection…']);

    try {
      if (!openAiApiKey.trim()) {
        setOpenAiError('OPENAI_API_KEY is required');
        setOpenAiLog((prev) => [...prev, 'OpenAI test FAILED.']);
        return false;
      }

      const res = await fetch('/api/openai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: openAiApiKey,
        }),
      });

      if (!res.ok) {
        const msg = await readApiError(res);
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }

      const data = (await res.json()) as OpenAiTestResponse;
      setOpenAiResult(data);
      setOpenAiLog((prev) => [...prev, 'OpenAI test OK.']);
      return true;
    } catch (err) {
      setOpenAiError(err instanceof Error ? err.message : String(err));
      setOpenAiLog((prev) => [...prev, 'OpenAI test FAILED.']);
      return false;
    }
  }

  async function onTestOverseerr(): Promise<boolean> {
    setOverseerrError(null);
    setOverseerrResult(null);
    setOverseerrLog(['Testing Overseerr connection…']);

    try {
      if (!overseerrBaseUrl.trim()) {
        setOverseerrError('Base URL is required');
        setOverseerrLog((prev) => [...prev, 'Overseerr test FAILED.']);
        return false;
      }
      if (!overseerrApiKey.trim()) {
        setOverseerrError('API key is required');
        setOverseerrLog((prev) => [...prev, 'Overseerr test FAILED.']);
        return false;
      }

      const res = await fetch('/api/overseerr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: overseerrBaseUrl,
          apiKey: overseerrApiKey,
        }),
      });

      if (!res.ok) {
        const msg = await readApiError(res);
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }

      const data = (await res.json()) as OverseerrTestResponse;
      setOverseerrResult(data);
      setOverseerrLog((prev) => [...prev, 'Overseerr test OK.']);
      return true;
    } catch (err) {
      setOverseerrError(err instanceof Error ? err.message : String(err));
      setOverseerrLog((prev) => [...prev, 'Overseerr test FAILED.']);
      return false;
    }
  }

  function allCredsPassed() {
    const plexOk = Boolean(plexAuthToken && plexWhoami);
    const radarrOk = Boolean(radarrResult && !radarrError);
    const sonarrOk = Boolean(sonarrResult && !sonarrError);
    const tmdbOk = Boolean(tmdbResult && !tmdbError);
    // Google, OpenAI, and Overseerr are optional (skippable)
    return plexOk && radarrOk && sonarrOk && tmdbOk;
  }

  function completeWizard() {
    if (!allCredsPassed()) return;

    const values: Record<string, unknown> = {
      radarrBaseUrl,
      sonarrBaseUrl,
      googleNumResults,
      googleQuery,
      overseerrBaseUrl,
    };

    if (rememberSecrets) {
      values.radarrApiKey = radarrApiKey;
      values.sonarrApiKey = sonarrApiKey;
      values.googleApiKey = googleApiKey;
      values.googleCseId = googleCseId;
      values.tmdbApiKey = tmdbApiKey;
      values.openAiApiKey = openAiApiKey;
      values.overseerrApiKey = overseerrApiKey;
      values.plexAuthToken = plexAuthToken;
    }

    const completed: OnboardingStored = {
      completed: true,
      completedAt: new Date().toISOString(),
      rememberSecrets,
      values,
      results: {
        plex: plexWhoami,
        radarr: radarrResult,
        sonarr: sonarrResult,
        google: googleResult,
        tmdb: tmdbResult,
        openai: openAiResult,
        overseerr: overseerrResult,
      },
    };

    saveOnboarding(completed);
    setStored(completed);

    setWizardOpen(false);
  }

  function resetWizard() {
    clearOnboarding();
    setStored(null);
    setWizardOpen(true);
    setWizardStep(0);
    
    // Reset all state variables
    setPlexPin(null);
    setPlexAuthToken(null);
    setPlexError(null);
    setIsConnectingPlex(false);
    setPlexLog([]);
    setPlexWhoami(null);
    setPlexWhoamiError(null);
    
    setRadarrBaseUrl('http://localhost:7878');
    setRadarrApiKey('');
    setRadarrResult(null);
    setRadarrError(null);
    setRadarrLog([]);
    
    setSonarrBaseUrl('http://localhost:8989');
    setSonarrApiKey('');
    setSonarrResult(null);
    setSonarrError(null);
    setSonarrLog([]);
    
    setGoogleApiKey('');
    setGoogleCseId('');
    setGoogleNumResults(15);
    setGoogleQuery('imdb the matrix');
    setGoogleResult(null);
    setGoogleError(null);
    setGoogleLog([]);
    
    setTmdbApiKey('');
    setTmdbResult(null);
    setTmdbError(null);
    setTmdbLog([]);
    
    setOpenAiApiKey('');
    setOpenAiResult(null);
    setOpenAiError(null);
    setOpenAiLog([]);
    
    setOverseerrBaseUrl('http://localhost:5055');
    setOverseerrApiKey('');
    setOverseerrResult(null);
    setOverseerrError(null);
    setOverseerrLog([]);
    
    setRememberSecrets(true);
  }

  useEffect(() => {
    // If Plex auth finishes while we're on the Plex step, advance automatically.
    if (!wizardOpen) return;
    if (wizardStep !== 0) return;
    if (plexAuthToken && plexWhoami) {
      setWizardStep(1);
    }
  }, [wizardOpen, wizardStep, plexAuthToken, plexWhoami]);

  async function submitWizardStep(step: number): Promise<boolean> {
    // Steps: 0 Plex, 1 Radarr, 2 Sonarr, 3 TMDB, 4 Google, 5 OpenAI, 6 Overseerr
    switch (step) {
      case 0: {
        if (plexAuthToken && plexWhoami) return true;
        if (!isConnectingPlex) {
          await onConnectPlex();
        }
        return false;
      }
      case 1:
        return await onTestRadarr();
      case 2:
        return await onTestSonarr();
      case 3:
        return await onTestTmdb();
      case 4:
        // Google is optional - allow skipping if either field is empty
        if (!googleApiKey.trim() || !googleCseId.trim()) {
          return true; // Skip if either field is empty
        }
        return await onTestGoogle();
      case 5:
        // OpenAI is optional - allow skipping if field is empty, otherwise test
        if (!openAiApiKey.trim()) {
          return true; // Skip if field is empty
        }
        return await onTestOpenAi();
      case 6:
        // Overseerr is optional - allow skipping if either field is empty
        if (!overseerrBaseUrl.trim() || !overseerrApiKey.trim()) {
          return true; // Skip if either field is empty
        }
        return await onTestOverseerr();
      default:
        return false;
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Tautulli Curated Plex (WIP)</h1>
        <p className="subtitle">TypeScript rewrite • Plex-native auth and monitoring (next)</p>
      </header>

      {stored?.completed ? (
        <section className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="panelTitle">Credential validation</div>
            <button
              onClick={resetWizard}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #ccc',
                background: '#fff',
                cursor: 'pointer',
                fontSize: 14,
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#f5f5f5';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = '#fff';
              }}
            >
              Reset Wizard
            </button>
          </div>
          <div className="muted">
            Last completed:{' '}
            {stored.completedAt ? new Date(stored.completedAt).toLocaleString() : 'unknown'}
          </div>
          <pre className="code" style={{ marginTop: 12 }}>
{JSON.stringify(
  {
    plex: Boolean((stored.results as Record<string, unknown> | undefined)?.plex),
    radarr: Boolean((stored.results as Record<string, unknown> | undefined)?.radarr),
    sonarr: Boolean((stored.results as Record<string, unknown> | undefined)?.sonarr),
    google: Boolean((stored.results as Record<string, unknown> | undefined)?.google),
    tmdb: Boolean((stored.results as Record<string, unknown> | undefined)?.tmdb),
    openai: Boolean((stored.results as Record<string, unknown> | undefined)?.openai),
    overseerr: Boolean((stored.results as Record<string, unknown> | undefined)?.overseerr),
  },
  null,
  2,
)}
          </pre>
        </section>
      ) : null}

      <section className="panel">
        <div className="panelTitle">Backend status</div>
        {error ? (
          <div className="error">Error: {error}</div>
        ) : health ? (
          <pre className="code">{JSON.stringify(health, null, 2)}</pre>
        ) : (
          <div className="muted">Loading…</div>
        )}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panelTitle">Plex (PIN auth)</div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onConnectPlex} disabled={isConnectingPlex}>
            {isConnectingPlex ? 'Connecting…' : 'Connect Plex'}
          </button>
          {plexPin?.authUrl ? (
            <a href={plexPin.authUrl} target="_blank" rel="noreferrer">
              Open Plex authorization page
            </a>
          ) : null}
        </div>

        {plexError ? <div className="error" style={{ marginTop: 12 }}>Error: {plexError}</div> : null}

        {plexAuthToken ? (
          <div style={{ marginTop: 12 }}>
            Connected. Token suffix: <code>{plexAuthToken.slice(-6)}</code>
            {plexWhoami ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>whoami</div>
                <pre className="code">{JSON.stringify(plexWhoami, null, 2)}</pre>
              </div>
            ) : plexWhoamiError ? (
              <div className="error" style={{ marginTop: 12 }}>
                whoami error: {plexWhoamiError}
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 12 }}>
                Validating token…
              </div>
            )}
          </div>
        ) : plexPin ? (
          <div style={{ marginTop: 12 }}>
            Authorize in the Plex window we opened. Waiting for approval…
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 12 }}>
            Not connected yet.
          </div>
        )}

        {plexLog.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Activity log</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {plexLog.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panelTitle">Radarr</div>

        <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>Base URL</div>
            <input
              value={radarrBaseUrl}
              onChange={(e) => setRadarrBaseUrl(e.target.value)}
              placeholder="http://localhost:7878  (or https://host/radarr)"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>API Key</div>
            <input
              value={radarrApiKey}
              onChange={(e) => setRadarrApiKey(e.target.value)}
              placeholder="Paste Radarr API key"
              type="password"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <div>
            <button onClick={onTestRadarr}>Test Radarr</button>
          </div>
        </div>

        {radarrError ? <div className="error" style={{ marginTop: 12 }}>Error: {radarrError}</div> : null}
        {radarrResult ? (
          <pre className="code" style={{ marginTop: 12 }}>{JSON.stringify(radarrResult, null, 2)}</pre>
        ) : null}

        {radarrLog.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Activity log</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {radarrLog.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panelTitle">Sonarr</div>

        <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>Base URL</div>
            <input
              value={sonarrBaseUrl}
              onChange={(e) => setSonarrBaseUrl(e.target.value)}
              placeholder="http://localhost:8989  (or https://host/sonarr)"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>API Key</div>
            <input
              value={sonarrApiKey}
              onChange={(e) => setSonarrApiKey(e.target.value)}
              placeholder="Paste Sonarr API key"
              type="password"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <div>
            <button onClick={onTestSonarr}>Test Sonarr</button>
          </div>
        </div>

        {sonarrError ? <div className="error" style={{ marginTop: 12 }}>Error: {sonarrError}</div> : null}
        {sonarrResult ? (
          <pre className="code" style={{ marginTop: 12 }}>{JSON.stringify(sonarrResult, null, 2)}</pre>
        ) : null}

        {sonarrLog.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Activity log</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {sonarrLog.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panelTitle">Google (Programmable Search)</div>

        <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>GOOGLE_API_KEY</div>
            <input
              value={googleApiKey}
              onChange={(e) => setGoogleApiKey(e.target.value)}
              placeholder="Paste Google API key"
              type="password"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>GOOGLE_CSE_ID (cx)</div>
            <input
              value={googleCseId}
              onChange={(e) => setGoogleCseId(e.target.value)}
              placeholder="Paste Programmable Search Engine ID (cx)"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ flex: '0 0 180px' }}>
              <div className="muted" style={{ marginBottom: 4 }}>num_results</div>
              <input
                value={String(googleNumResults)}
                onChange={(e) => setGoogleNumResults(Number.parseInt(e.target.value || '0', 10))}
                type="number"
                min={0}
                max={50}
                style={{ width: '100%', padding: 10, borderRadius: 8 }}
              />
            </label>
            <label style={{ flex: '1 1 320px' }}>
              <div className="muted" style={{ marginBottom: 4 }}>test query</div>
              <input
                value={googleQuery}
                onChange={(e) => setGoogleQuery(e.target.value)}
                placeholder="e.g. imdb the matrix"
                style={{ width: '100%', padding: 10, borderRadius: 8 }}
              />
            </label>
          </div>

          <div>
            <button onClick={onTestGoogle}>Test Google</button>
          </div>
        </div>

        {googleError ? <div className="error" style={{ marginTop: 12 }}>Error: {googleError}</div> : null}
        {googleResult ? (
          <pre className="code" style={{ marginTop: 12 }}>{JSON.stringify(googleResult, null, 2)}</pre>
        ) : null}

        {googleLog.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Activity log</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {googleLog.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panelTitle">TMDB</div>

        <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>TMDB_API_KEY</div>
            <input
              value={tmdbApiKey}
              onChange={(e) => setTmdbApiKey(e.target.value)}
              placeholder="Paste TMDB API key (v3)"
              type="password"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <div>
            <button onClick={onTestTmdb}>Test TMDB</button>
          </div>
        </div>

        {tmdbError ? <div className="error" style={{ marginTop: 12 }}>Error: {tmdbError}</div> : null}
        {tmdbResult ? (
          <pre className="code" style={{ marginTop: 12 }}>{JSON.stringify(tmdbResult, null, 2)}</pre>
        ) : null}

        {tmdbLog.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Activity log</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {tmdbLog.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panelTitle">OpenAI</div>

        <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>OPENAI_API_KEY</div>
            <input
              value={openAiApiKey}
              onChange={(e) => setOpenAiApiKey(e.target.value)}
              placeholder="Paste OpenAI API key"
              type="password"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <div>
            <button onClick={onTestOpenAi}>Test OpenAI</button>
          </div>
        </div>

        {openAiError ? (
          <div className="error" style={{ marginTop: 12 }}>
            Error: {openAiError}
          </div>
        ) : null}
        {openAiResult ? (
          <pre className="code" style={{ marginTop: 12 }}>{JSON.stringify(openAiResult, null, 2)}</pre>
        ) : null}

        {openAiLog.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Activity log</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {openAiLog.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panelTitle">Overseerr</div>

        <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>Base URL</div>
            <input
              value={overseerrBaseUrl}
              onChange={(e) => setOverseerrBaseUrl(e.target.value)}
              placeholder="http://localhost:5055  (or https://host/overseerr)"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <label>
            <div className="muted" style={{ marginBottom: 4 }}>API Key</div>
            <input
              value={overseerrApiKey}
              onChange={(e) => setOverseerrApiKey(e.target.value)}
              placeholder="Paste Overseerr API key"
              type="password"
              style={{ width: '100%', padding: 10, borderRadius: 8 }}
            />
          </label>
          <div>
            <button onClick={onTestOverseerr}>Test Overseerr</button>
          </div>
        </div>

        {overseerrError ? (
          <div className="error" style={{ marginTop: 12 }}>
            Error: {overseerrError}
          </div>
        ) : null}
        {overseerrResult ? (
          <pre className="code" style={{ marginTop: 12 }}>{JSON.stringify(overseerrResult, null, 2)}</pre>
        ) : null}

        {overseerrLog.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Activity log</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {overseerrLog.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {wizardOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div className="panelTitle">Setup wizard</div>
                <div className="muted">Validate credentials one-by-one to unlock the app.</div>
              </div>
            </div>

            <div className="stepper" style={{ marginTop: 12 }}>
              {['Plex', 'Radarr', 'Sonarr', 'TMDB', 'Google', 'OpenAI', 'Overseerr', 'Finish'].map(
                (label, idx) => (
                  <button
                    key={label}
                    className={idx === wizardStep ? 'stepActive' : 'step'}
                    onClick={() => setWizardStep(idx)}
                    disabled={wizardSubmitting || idx > wizardStep}
                    style={{ padding: '6px 10px' }}
                  >
                    {idx + 1}. {label}
                  </button>
                ),
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              {wizardStep === 0 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Plex</div>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Click Next to open Plex authorization, then approve access in the Plex window.
                  </div>

                  {plexPin?.authUrl ? (
                    <div style={{ marginBottom: 12 }}>
                      <a href={plexPin.authUrl} target="_blank" rel="noreferrer">
                        Open Plex authorization page
                      </a>
                    </div>
                  ) : null}

                  {plexError ? (
                    <div className="error" style={{ marginTop: 12 }}>
                      Error: {plexError}
                    </div>
                  ) : null}

                  {plexWhoami ? (
                    <div style={{ marginTop: 12 }}>Connected to Plex.</div>
                  ) : (
                    <div className="muted" style={{ marginTop: 12 }}>
                      {isConnectingPlex ? 'Waiting for approval…' : 'Not connected yet.'}
                    </div>
                  )}
                </>
              ) : null}

              {wizardStep === 1 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Radarr</div>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Enter Radarr details, then click Next to validate.
                  </div>
                  <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
                    <label>
                      <div className="muted" style={{ marginBottom: 4 }}>Base URL</div>
                      <input
                        value={radarrBaseUrl}
                        onChange={(e) => setRadarrBaseUrl(e.target.value)}
                        style={{ width: '100%', padding: 10, borderRadius: 8 }}
                      />
                    </label>
                    <label>
                      <div className="muted" style={{ marginBottom: 4 }}>API Key</div>
                      <input
                        value={radarrApiKey}
                        onChange={(e) => setRadarrApiKey(e.target.value)}
                        type="password"
                        style={{ width: '100%', padding: 10, borderRadius: 8 }}
                      />
                    </label>
                  </div>
                  {radarrError ? (
                    <div className="error" style={{ marginTop: 8 }}>
                      Error: {radarrError}
                    </div>
                  ) : null}
                </>
              ) : null}

              {wizardStep === 2 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Sonarr</div>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Enter Sonarr details, then click Next to validate.
                  </div>
                  <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
                    <label>
                      <div className="muted" style={{ marginBottom: 4 }}>Base URL</div>
                      <input
                        value={sonarrBaseUrl}
                        onChange={(e) => setSonarrBaseUrl(e.target.value)}
                        style={{ width: '100%', padding: 10, borderRadius: 8 }}
                      />
                    </label>
                    <label>
                      <div className="muted" style={{ marginBottom: 4 }}>API Key</div>
                      <input
                        value={sonarrApiKey}
                        onChange={(e) => setSonarrApiKey(e.target.value)}
                        type="password"
                        style={{ width: '100%', padding: 10, borderRadius: 8 }}
                      />
                    </label>
                  </div>
                  {sonarrError ? (
                    <div className="error" style={{ marginTop: 8 }}>
                      Error: {sonarrError}
                    </div>
                  ) : null}
                </>
              ) : null}

              {wizardStep === 3 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>TMDB</div>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Enter TMDB key, then click Next to validate.
                  </div>
                  <label>
                    <div className="muted" style={{ marginBottom: 4 }}>TMDB_API_KEY</div>
                    <input
                      value={tmdbApiKey}
                      onChange={(e) => setTmdbApiKey(e.target.value)}
                      type="password"
                      style={{ width: '100%', padding: 10, borderRadius: 8 }}
                    />
                  </label>
                  {tmdbError ? (
                    <div className="error" style={{ marginTop: 8 }}>
                      Error: {tmdbError}
                    </div>
                  ) : null}
                </>
              ) : null}

              {wizardStep === 4 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Google Programmable Search (Optional)</div>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Enter Google details to enable, or leave empty and click Next to skip.
                  </div>
                  <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
                    <label>
                      <div className="muted" style={{ marginBottom: 4 }}>GOOGLE_API_KEY</div>
                      <input
                        value={googleApiKey}
                        onChange={(e) => setGoogleApiKey(e.target.value)}
                        type="password"
                        style={{ width: '100%', padding: 10, borderRadius: 8 }}
                      />
                    </label>
                    <label>
                      <div className="muted" style={{ marginBottom: 4 }}>GOOGLE_CSE_ID (cx)</div>
                      <input
                        value={googleCseId}
                        onChange={(e) => setGoogleCseId(e.target.value)}
                        style={{ width: '100%', padding: 10, borderRadius: 8 }}
                      />
                    </label>
                  </div>
                  {googleError ? (
                    <div className="error" style={{ marginTop: 8 }}>
                      Error: {googleError}
                    </div>
                  ) : null}
                </>
              ) : null}

              {wizardStep === 5 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>OpenAI (Optional)</div>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Enter OpenAI key to enable, or leave empty and click Next to skip.
                  </div>
                  <label>
                    <div className="muted" style={{ marginBottom: 4 }}>OPENAI_API_KEY</div>
                    <input
                      value={openAiApiKey}
                      onChange={(e) => setOpenAiApiKey(e.target.value)}
                      type="password"
                      style={{ width: '100%', padding: 10, borderRadius: 8 }}
                    />
                  </label>
                  {openAiError ? (
                    <div className="error" style={{ marginTop: 8 }}>
                      Error: {openAiError}
                    </div>
                  ) : null}
                </>
              ) : null}

              {wizardStep === 6 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Overseerr (Optional)</div>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Enter Overseerr details to enable, or leave empty and click Next to skip.
                  </div>
                  <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
                    <label>
                      <div className="muted" style={{ marginBottom: 4 }}>Base URL</div>
                      <input
                        value={overseerrBaseUrl}
                        onChange={(e) => setOverseerrBaseUrl(e.target.value)}
                        style={{ width: '100%', padding: 10, borderRadius: 8 }}
                      />
                    </label>
                    <label>
                      <div className="muted" style={{ marginBottom: 4 }}>API Key</div>
                      <input
                        value={overseerrApiKey}
                        onChange={(e) => setOverseerrApiKey(e.target.value)}
                        type="password"
                        style={{ width: '100%', padding: 10, borderRadius: 8 }}
                      />
                    </label>
                  </div>
                  {overseerrError ? (
                    <div className="error" style={{ marginTop: 8 }}>
                      Error: {overseerrError}
                    </div>
                  ) : null}
                </>
              ) : null}

              {wizardStep === 7 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Confirmation</div>
                  <div className="muted">All integrations must be OK to finish.</div>
                  <pre className="code" style={{ marginTop: 12 }}>
{JSON.stringify(
  {
    plex: Boolean(plexAuthToken && plexWhoami),
    radarr: Boolean(radarrResult && !radarrError),
    sonarr: Boolean(sonarrResult && !sonarrError),
    tmdb: Boolean(tmdbResult && !tmdbError),
    google: Boolean(googleResult && !googleError) || (!googleApiKey.trim() && !googleCseId.trim()) ? 'skipped' : false,
    openai: Boolean(openAiResult && !openAiError) || !openAiApiKey.trim() ? 'skipped' : false,
    overseerr: Boolean(overseerrResult && !overseerrError) || (!overseerrBaseUrl.trim() && !overseerrApiKey.trim()) ? 'skipped' : false,
  },
  null,
  2,
)}
                  </pre>

                  <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={rememberSecrets}
                      onChange={(e) => setRememberSecrets(e.target.checked)}
                    />
                    <span>Remember credentials on this browser (temporary; we’ll move this server-side)</span>
                  </label>
                </>
              ) : null}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <button
                onClick={() => {
                  setWizardStep((s) => Math.max(0, s - 1));
                }}
                disabled={wizardSubmitting || wizardStep === 0}
              >
                Back
              </button>

              {wizardStep < 7 ? (
                <button
                  onClick={async () => {
                    if (wizardSubmitting) return;
                    setWizardSubmitting(true);
                    try {
                      const ok = await submitWizardStep(wizardStep);
                      if (ok) {
                        setWizardStep((s) => Math.min(7, s + 1));
                      }
                    } finally {
                      setWizardSubmitting(false);
                    }
                  }}
                  disabled={wizardSubmitting || (wizardStep === 0 && isConnectingPlex)}
                >
                  {wizardSubmitting ? 'Working…' : 'Next'}
                </button>
              ) : (
                <button
                  onClick={() => {
                    completeWizard();
                  }}
                  disabled={!allCredsPassed()}
                >
                  Finish setup
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
