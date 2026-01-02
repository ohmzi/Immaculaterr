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
  linkUrl: string;
  clientIdentifier: string;
};

type PlexCheckPinResponse = {
  id: number;
  authToken: string | null;
  expiresAt: string | null;
};

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [plexPin, setPlexPin] = useState<PlexCreatePinResponse | null>(null);
  const [plexAuthToken, setPlexAuthToken] = useState<string | null>(null);
  const [plexError, setPlexError] = useState<string | null>(null);
  const [isConnectingPlex, setIsConnectingPlex] = useState(false);

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

  async function onConnectPlex() {
    setPlexError(null);
    setPlexAuthToken(null);
    setIsConnectingPlex(true);

    try {
      const res = await fetch('/api/plex/pin', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as PlexCreatePinResponse;
      setPlexPin(data);
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
          {plexPin?.linkUrl ? (
            <a href={plexPin.linkUrl} target="_blank" rel="noreferrer">
              Open Plex link page
            </a>
          ) : null}
        </div>

        {plexError ? <div className="error" style={{ marginTop: 12 }}>Error: {plexError}</div> : null}

        {plexAuthToken ? (
          <div style={{ marginTop: 12 }}>
            Connected. Token suffix: <code>{plexAuthToken.slice(-6)}</code>
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
      </section>
    </div>
  );
}

export default App;
