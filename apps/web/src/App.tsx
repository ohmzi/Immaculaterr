import { useEffect, useState } from 'react';
import './App.css';

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

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [plexPin, setPlexPin] = useState<PlexCreatePinResponse | null>(null);
  const [plexAuthToken, setPlexAuthToken] = useState<string | null>(null);
  const [plexError, setPlexError] = useState<string | null>(null);
  const [isConnectingPlex, setIsConnectingPlex] = useState(false);
  const [plexLog, setPlexLog] = useState<string[]>([]);
  const [plexWhoami, setPlexWhoami] = useState<PlexWhoamiResponse | null>(null);
  const [plexWhoamiError, setPlexWhoamiError] = useState<string | null>(null);

  const [radarrBaseUrl, setRadarrBaseUrl] = useState('');
  const [radarrApiKey, setRadarrApiKey] = useState('');
  const [radarrResult, setRadarrResult] = useState<ArrTestResponse | null>(null);
  const [radarrError, setRadarrError] = useState<string | null>(null);
  const [radarrLog, setRadarrLog] = useState<string[]>([]);

  const [sonarrBaseUrl, setSonarrBaseUrl] = useState('');
  const [sonarrApiKey, setSonarrApiKey] = useState('');
  const [sonarrResult, setSonarrResult] = useState<ArrTestResponse | null>(null);
  const [sonarrError, setSonarrError] = useState<string | null>(null);
  const [sonarrLog, setSonarrLog] = useState<string[]>([]);

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

  async function onTestRadarr() {
    setRadarrError(null);
    setRadarrResult(null);
    setRadarrLog(['Testing Radarr connection…']);

    try {
      const res = await fetch('/api/radarr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: radarrBaseUrl,
          apiKey: radarrApiKey,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ArrTestResponse;
      setRadarrResult(data);
      setRadarrLog((prev) => [...prev, 'Radarr test OK.']);
    } catch (err) {
      setRadarrError(err instanceof Error ? err.message : String(err));
      setRadarrLog((prev) => [...prev, 'Radarr test FAILED.']);
    }
  }

  async function onTestSonarr() {
    setSonarrError(null);
    setSonarrResult(null);
    setSonarrLog(['Testing Sonarr connection…']);

    try {
      const res = await fetch('/api/sonarr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ArrTestResponse;
      setSonarrResult(data);
      setSonarrLog((prev) => [...prev, 'Sonarr test OK.']);
    } catch (err) {
      setSonarrError(err instanceof Error ? err.message : String(err));
      setSonarrLog((prev) => [...prev, 'Sonarr test FAILED.']);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Tautulli Curated Plex (WIP)</h1>
        <p className="subtitle">TypeScript rewrite • Plex-native auth and monitoring (next)</p>
      </header>

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
    </div>
  );
}

export default App;
