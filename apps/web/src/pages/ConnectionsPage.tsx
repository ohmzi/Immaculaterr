import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Loader2, PlugZap, Save } from 'lucide-react';

import { testSavedIntegration } from '@/api/integrations';
import { getPublicSettings, putSettings } from '@/api/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function readString(obj: Record<string, unknown> | undefined, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : '';
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
          : 'inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground'
      }
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

export function ConnectionsPage() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const settingsObj = useMemo(
    () => (settingsQuery.data?.settings ?? {}) as Record<string, unknown>,
    [settingsQuery.data],
  );
  const secretsPresent = useMemo(
    () => settingsQuery.data?.secretsPresent ?? {},
    [settingsQuery.data],
  );

  // Local draft state (we never show existing secrets; only allow replacement)
  const [plexBaseUrl, setPlexBaseUrl] = useState('');
  const [plexMovieLibraryName, setPlexMovieLibraryName] = useState('');
  const [plexTvLibraryName, setPlexTvLibraryName] = useState('');
  const [plexToken, setPlexToken] = useState('');

  const [radarrBaseUrl, setRadarrBaseUrl] = useState('');
  const [radarrApiKey, setRadarrApiKey] = useState('');

  const [sonarrBaseUrl, setSonarrBaseUrl] = useState('');
  const [sonarrApiKey, setSonarrApiKey] = useState('');

  const [tmdbApiKey, setTmdbApiKey] = useState('');

  const [googleSearchEngineId, setGoogleSearchEngineId] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');

  const [openAiApiKey, setOpenAiApiKey] = useState('');

  const [overseerrBaseUrl, setOverseerrBaseUrl] = useState('');
  const [overseerrApiKey, setOverseerrApiKey] = useState('');

  const plexBaseUrlValue = plexBaseUrl || readString(settingsObj, 'plex.baseUrl');
  const plexMovieLibraryNameValue =
    plexMovieLibraryName || readString(settingsObj, 'plex.movieLibraryName') || 'Movies';
  const plexTvLibraryNameValue =
    plexTvLibraryName || readString(settingsObj, 'plex.tvLibraryName') || 'TV Shows';

  const radarrBaseUrlValue = radarrBaseUrl || readString(settingsObj, 'radarr.baseUrl');
  const sonarrBaseUrlValue = sonarrBaseUrl || readString(settingsObj, 'sonarr.baseUrl');

  const googleSearchEngineIdValue =
    googleSearchEngineId || readString(settingsObj, 'google.searchEngineId');
  const overseerrBaseUrlValue = overseerrBaseUrl || readString(settingsObj, 'overseerr.baseUrl');

  const saveMutation = useMutation({
    mutationFn: async (params: { settings?: Record<string, unknown>; secrets?: Record<string, unknown> }) =>
      putSettings(params),
    onSuccess: async () => {
      setPlexToken('');
      setRadarrApiKey('');
      setSonarrApiKey('');
      setTmdbApiKey('');
      setGoogleApiKey('');
      setOpenAiApiKey('');
      setOverseerrApiKey('');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const [testState, setTestState] = useState<Record<string, { ok: boolean; message: string }>>({});
  const testMutation = useMutation({
    mutationFn: async (id: string) => testSavedIntegration(id),
    onSuccess: (_data, id) =>
      setTestState((prev) => ({ ...prev, [id]: { ok: true, message: 'OK' } })),
    onError: (err, id) =>
      setTestState((prev) => ({
        ...prev,
        [id]: { ok: false, message: err instanceof Error ? err.message : String(err) },
      })),
  });

  const isTesting = (id: string) => testMutation.isPending && testMutation.variables === id;

  const plexOk = Boolean(plexBaseUrlValue.trim()) && Boolean(secretsPresent.plex);
  const radarrOk = Boolean(radarrBaseUrlValue.trim()) && Boolean(secretsPresent.radarr);
  const sonarrOk = Boolean(sonarrBaseUrlValue.trim()) && Boolean(secretsPresent.sonarr);
  const tmdbOk = Boolean(secretsPresent.tmdb);
  const googleOk =
    Boolean(googleSearchEngineIdValue.trim()) && Boolean(secretsPresent.google);
  const openAiOk = Boolean(secretsPresent.openai);
  const overseerrOk =
    Boolean(overseerrBaseUrlValue.trim()) && Boolean(secretsPresent.overseerr);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Manage integrations. Saved API keys stay hidden — you can only replace them or test them.
        </p>
      </div>

      {settingsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : settingsQuery.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4" />
          <div>{(settingsQuery.error as Error).message}</div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                Plex <StatusPill ok={plexOk} label={plexOk ? 'Configured' : 'Missing'} />
              </CardTitle>
              <CardDescription>Used for collections, library lookups, and job execution.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Base URL</Label>
                <Input value={plexBaseUrlValue} onChange={(e) => setPlexBaseUrl(e.target.value)} placeholder="http://localhost:32400" />
              </div>
              <div className="grid gap-2">
                <Label>Movie library name</Label>
                <Input value={plexMovieLibraryNameValue} onChange={(e) => setPlexMovieLibraryName(e.target.value)} placeholder="Movies" />
              </div>
              <div className="grid gap-2">
                <Label>TV library name</Label>
                <Input value={plexTvLibraryNameValue} onChange={(e) => setPlexTvLibraryName(e.target.value)} placeholder="TV Shows" />
              </div>
              <div className="grid gap-2">
                <Label>Token (hidden)</Label>
                <Input
                  type="password"
                  value={plexToken}
                  onChange={(e) => setPlexToken(e.target.value)}
                  placeholder={secretsPresent.plex ? 'Saved (hidden) — enter to replace' : 'Enter token'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => testMutation.mutate('plex')}
                  disabled={!plexOk || isTesting('plex')}
                >
                  {isTesting('plex') ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Test
                </Button>
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      settings: {
                        plex: {
                          baseUrl: plexBaseUrlValue.trim(),
                          movieLibraryName: plexMovieLibraryNameValue.trim(),
                          tvLibraryName: plexTvLibraryNameValue.trim(),
                        },
                      },
                      secrets: plexToken.trim() ? { plex: { token: plexToken.trim() } } : undefined,
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
                {testState.plex ? (
                  <div className={testState.plex.ok ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-destructive'}>
                    {testState.plex.message}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                Radarr <StatusPill ok={radarrOk} label={radarrOk ? 'Configured' : 'Missing'} />
              </CardTitle>
              <CardDescription>Used by Monitor Confirm.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Base URL</Label>
                <Input value={radarrBaseUrlValue} onChange={(e) => setRadarrBaseUrl(e.target.value)} placeholder="http://localhost:7878" />
              </div>
              <div className="grid gap-2">
                <Label>API key (hidden)</Label>
                <Input
                  type="password"
                  value={radarrApiKey}
                  onChange={(e) => setRadarrApiKey(e.target.value)}
                  placeholder={secretsPresent.radarr ? 'Saved (hidden) — enter to replace' : 'Enter API key'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => testMutation.mutate('radarr')} disabled={!radarrOk || isTesting('radarr')}>
                  {isTesting('radarr') ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Test
                </Button>
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      settings: { radarr: { baseUrl: radarrBaseUrlValue.trim() } },
                      secrets: radarrApiKey.trim() ? { radarr: { apiKey: radarrApiKey.trim() } } : undefined,
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
                {testState.radarr ? (
                  <div className={testState.radarr.ok ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-destructive'}>
                    {testState.radarr.message}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                Sonarr <StatusPill ok={sonarrOk} label={sonarrOk ? 'Configured' : 'Missing'} />
              </CardTitle>
              <CardDescription>Used by Monitor Confirm + missing episode searches.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Base URL</Label>
                <Input value={sonarrBaseUrlValue} onChange={(e) => setSonarrBaseUrl(e.target.value)} placeholder="http://localhost:8989" />
              </div>
              <div className="grid gap-2">
                <Label>API key (hidden)</Label>
                <Input
                  type="password"
                  value={sonarrApiKey}
                  onChange={(e) => setSonarrApiKey(e.target.value)}
                  placeholder={secretsPresent.sonarr ? 'Saved (hidden) — enter to replace' : 'Enter API key'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => testMutation.mutate('sonarr')} disabled={!sonarrOk || isTesting('sonarr')}>
                  {isTesting('sonarr') ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Test
                </Button>
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      settings: { sonarr: { baseUrl: sonarrBaseUrlValue.trim() } },
                      secrets: sonarrApiKey.trim() ? { sonarr: { apiKey: sonarrApiKey.trim() } } : undefined,
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
                {testState.sonarr ? (
                  <div className={testState.sonarr.ok ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-destructive'}>
                    {testState.sonarr.message}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                TMDB <StatusPill ok={tmdbOk} label={tmdbOk ? 'Configured' : 'Optional'} />
              </CardTitle>
              <CardDescription>Optional (used by some metadata pipelines).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>API key (hidden)</Label>
                <Input
                  type="password"
                  value={tmdbApiKey}
                  onChange={(e) => setTmdbApiKey(e.target.value)}
                  placeholder={secretsPresent.tmdb ? 'Saved (hidden) — enter to replace' : 'Enter API key'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => testMutation.mutate('tmdb')} disabled={!tmdbOk || isTesting('tmdb')}>
                  {isTesting('tmdb') ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Test
                </Button>
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      secrets: tmdbApiKey.trim() ? { tmdb: { apiKey: tmdbApiKey.trim() } } : undefined,
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
                {testState.tmdb ? (
                  <div className={testState.tmdb.ok ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-destructive'}>
                    {testState.tmdb.message}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                Google CSE <StatusPill ok={googleOk} label={googleOk ? 'Configured' : 'Optional'} />
              </CardTitle>
              <CardDescription>Optional.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Search engine ID</Label>
                <Input value={googleSearchEngineIdValue} onChange={(e) => setGoogleSearchEngineId(e.target.value)} placeholder="cx=..." />
              </div>
              <div className="grid gap-2">
                <Label>API key (hidden)</Label>
                <Input
                  type="password"
                  value={googleApiKey}
                  onChange={(e) => setGoogleApiKey(e.target.value)}
                  placeholder={secretsPresent.google ? 'Saved (hidden) — enter to replace' : 'Enter API key'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => testMutation.mutate('google')} disabled={!googleOk || isTesting('google')}>
                  {isTesting('google') ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Test
                </Button>
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      settings: { google: { searchEngineId: googleSearchEngineIdValue.trim() } },
                      secrets: googleApiKey.trim() ? { google: { apiKey: googleApiKey.trim() } } : undefined,
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
                {testState.google ? (
                  <div className={testState.google.ok ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-destructive'}>
                    {testState.google.message}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                OpenAI <StatusPill ok={openAiOk} label={openAiOk ? 'Configured' : 'Optional'} />
              </CardTitle>
              <CardDescription>Optional.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>API key (hidden)</Label>
                <Input
                  type="password"
                  value={openAiApiKey}
                  onChange={(e) => setOpenAiApiKey(e.target.value)}
                  placeholder={secretsPresent.openai ? 'Saved (hidden) — enter to replace' : 'Enter API key'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => testMutation.mutate('openai')} disabled={!openAiOk || isTesting('openai')}>
                  {isTesting('openai') ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Test
                </Button>
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      secrets: openAiApiKey.trim() ? { openai: { apiKey: openAiApiKey.trim() } } : undefined,
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
                {testState.openai ? (
                  <div className={testState.openai.ok ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-destructive'}>
                    {testState.openai.message}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                Overseerr <StatusPill ok={overseerrOk} label={overseerrOk ? 'Configured' : 'Optional'} />
              </CardTitle>
              <CardDescription>Optional.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Base URL</Label>
                <Input value={overseerrBaseUrlValue} onChange={(e) => setOverseerrBaseUrl(e.target.value)} placeholder="http://localhost:5055" />
              </div>
              <div className="grid gap-2">
                <Label>API key (hidden)</Label>
                <Input
                  type="password"
                  value={overseerrApiKey}
                  onChange={(e) => setOverseerrApiKey(e.target.value)}
                  placeholder={secretsPresent.overseerr ? 'Saved (hidden) — enter to replace' : 'Enter API key'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => testMutation.mutate('overseerr')} disabled={!overseerrOk || isTesting('overseerr')}>
                  {isTesting('overseerr') ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Test
                </Button>
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      settings: { overseerr: { baseUrl: overseerrBaseUrlValue.trim() } },
                      secrets: overseerrApiKey.trim() ? { overseerr: { apiKey: overseerrApiKey.trim() } } : undefined,
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
                {testState.overseerr ? (
                  <div className={testState.overseerr.ok ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-destructive'}>
                    {testState.overseerr.message}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {saveMutation.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4" />
          <div>{(saveMutation.error as Error).message}</div>
        </div>
      ) : null}
    </div>
  );
}


