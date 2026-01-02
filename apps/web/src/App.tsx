import { useEffect, useState } from 'react';
import './App.css';

type HealthResponse = {
  status: 'ok';
  time: string;
};

type PlexCreatePinResponse = {
  id: number;
  code: string;
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
            Enter this code in Plex: <code>{plexPin.code}</code>
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
    </div>
  );
}

export default App;
