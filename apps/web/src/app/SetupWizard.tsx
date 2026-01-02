import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleAlert,
  FileDown,
  FileUp,
  Loader2,
  PlugZap,
  ShieldCheck,
} from 'lucide-react';

import { testSavedIntegration } from '@/api/integrations';
import {
  getPublicSettings,
  importYamlApply,
  importYamlPreview,
  putSettings,
} from '@/api/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type IntegrationId = 'plex' | 'radarr' | 'sonarr' | 'tmdb' | 'google' | 'openai' | 'overseerr';

function readString(obj: Record<string, unknown> | undefined, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : '';
}

function StatusRow({
  label,
  configured,
  onTest,
  testing,
  lastResult,
}: {
  label: string;
  configured: boolean;
  onTest: () => void;
  testing: boolean;
  lastResult: { ok: boolean; message: string } | null;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        {configured ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <CircleAlert className="h-4 w-4 text-muted-foreground" />
        )}
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {configured ? 'Saved (hidden)' : 'Not configured'}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {lastResult ? (
          <div
            className={
              lastResult.ok
                ? 'text-xs text-emerald-700 dark:text-emerald-300'
                : 'text-xs text-destructive'
            }
          >
            {lastResult.message}
          </div>
        ) : null}
        <Button variant="outline" size="sm" onClick={onTest} disabled={!configured || testing}>
          {testing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Testing…
            </>
          ) : (
            <>
              <PlugZap className="h-4 w-4" />
              Test
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function SetupWizard({ onFinish }: { onFinish?: () => void }) {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [yamlText, setYamlText] = useState('');

  const previewMutation = useMutation({
    mutationFn: async () => importYamlPreview(yamlText),
  });

  const applyMutation = useMutation({
    mutationFn: async () => importYamlApply(yamlText),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const [plexBaseUrl, setPlexBaseUrl] = useState('');
  const [plexMovieLibraryName, setPlexMovieLibraryName] = useState('');
  const [plexTvLibraryName, setPlexTvLibraryName] = useState('');
  const [plexToken, setPlexToken] = useState('');
  const [radarrBaseUrl, setRadarrBaseUrl] = useState('');
  const [radarrApiKey, setRadarrApiKey] = useState('');
  const [sonarrBaseUrl, setSonarrBaseUrl] = useState('');
  const [sonarrApiKey, setSonarrApiKey] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const settingsPatch: Record<string, unknown> = {};
      const secretsPatch: Record<string, unknown> = {};

      const plexSettings: Record<string, unknown> = {};
      if (plexBaseUrl.trim()) plexSettings.baseUrl = plexBaseUrl.trim();
      if (plexMovieLibraryName.trim()) plexSettings.movieLibraryName = plexMovieLibraryName.trim();
      if (plexTvLibraryName.trim()) plexSettings.tvLibraryName = plexTvLibraryName.trim();
      if (Object.keys(plexSettings).length) settingsPatch.plex = plexSettings;
      if (radarrBaseUrl.trim()) settingsPatch.radarr = { baseUrl: radarrBaseUrl.trim() };
      if (sonarrBaseUrl.trim()) settingsPatch.sonarr = { baseUrl: sonarrBaseUrl.trim() };

      if (plexToken.trim()) secretsPatch.plex = { token: plexToken.trim() };
      if (radarrApiKey.trim()) secretsPatch.radarr = { apiKey: radarrApiKey.trim() };
      if (sonarrApiKey.trim()) secretsPatch.sonarr = { apiKey: sonarrApiKey.trim() };

      return await putSettings({
        settings: Object.keys(settingsPatch).length ? settingsPatch : undefined,
        secrets: Object.keys(secretsPatch).length ? secretsPatch : undefined,
      });
    },
    onSuccess: async () => {
      setPlexToken('');
      setRadarrApiKey('');
      setSonarrApiKey('');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const secretsPresent = settingsQuery.data?.secretsPresent ?? {};
  const settingsObj = useMemo(
    () => (settingsQuery.data?.settings ?? {}) as Record<string, unknown>,
    [settingsQuery.data?.settings],
  );

  const plexConfigured = Boolean(readString(settingsObj, 'plex.baseUrl')) && Boolean(secretsPresent.plex);
  const radarrConfigured =
    Boolean(readString(settingsObj, 'radarr.baseUrl')) && Boolean(secretsPresent.radarr);
  const sonarrConfigured =
    Boolean(readString(settingsObj, 'sonarr.baseUrl')) && Boolean(secretsPresent.sonarr);
  const tmdbConfigured = Boolean(secretsPresent.tmdb);
  const googleConfigured =
    Boolean(secretsPresent.google) && Boolean(readString(settingsObj, 'google.searchEngineId'));
  const openAiConfigured = Boolean(secretsPresent.openai);
  const overseerrConfigured =
    Boolean(secretsPresent.overseerr) && Boolean(readString(settingsObj, 'overseerr.baseUrl'));

  // Allow finishing if the required values are either already saved OR entered in this wizard.
  const plexReady =
    (Boolean(readString(settingsObj, 'plex.baseUrl')) || Boolean(plexBaseUrl.trim())) &&
    (Boolean(secretsPresent.plex) || Boolean(plexToken.trim()));
  const radarrReady =
    (Boolean(readString(settingsObj, 'radarr.baseUrl')) || Boolean(radarrBaseUrl.trim())) &&
    (Boolean(secretsPresent.radarr) || Boolean(radarrApiKey.trim()));
  const sonarrReady =
    (Boolean(readString(settingsObj, 'sonarr.baseUrl')) || Boolean(sonarrBaseUrl.trim())) &&
    (Boolean(secretsPresent.sonarr) || Boolean(sonarrApiKey.trim()));

  const readyToFinish = plexReady && radarrReady && sonarrReady;

  const [testState, setTestState] = useState<
    Partial<Record<IntegrationId, { ok: boolean; message: string }>>
  >({});
  const testMutation = useMutation({
    mutationFn: async (id: IntegrationId) => testSavedIntegration(id),
    onSuccess: (_data, id) => {
      setTestState((prev) => ({ ...prev, [id]: { ok: true, message: 'OK' } }));
    },
    onError: (err, id) => {
      setTestState((prev) => ({
        ...prev,
        [id]: { ok: false, message: err instanceof Error ? err.message : String(err) },
      }));
    },
  });

  const finishMutation = useMutation({
    mutationFn: async () => {
      if (!readyToFinish) {
        throw new Error('Missing required config: Plex + Radarr + Sonarr must be configured.');
      }

      // Persist any entered values (so users don't have to click Save first),
      // and mark onboarding as completed in one request.
      const settingsPatch: Record<string, unknown> = {
        onboarding: {
          completed: true,
          completedAt: new Date().toISOString(),
        },
      };
      const secretsPatch: Record<string, unknown> = {};

      const plexSettings: Record<string, unknown> = {};
      if (plexBaseUrl.trim()) plexSettings.baseUrl = plexBaseUrl.trim();
      if (plexMovieLibraryName.trim()) plexSettings.movieLibraryName = plexMovieLibraryName.trim();
      if (plexTvLibraryName.trim()) plexSettings.tvLibraryName = plexTvLibraryName.trim();
      if (Object.keys(plexSettings).length) settingsPatch.plex = plexSettings;
      if (radarrBaseUrl.trim()) settingsPatch.radarr = { baseUrl: radarrBaseUrl.trim() };
      if (sonarrBaseUrl.trim()) settingsPatch.sonarr = { baseUrl: sonarrBaseUrl.trim() };

      if (plexToken.trim()) secretsPatch.plex = { token: plexToken.trim() };
      if (radarrApiKey.trim()) secretsPatch.radarr = { apiKey: radarrApiKey.trim() };
      if (sonarrApiKey.trim()) secretsPatch.sonarr = { apiKey: sonarrApiKey.trim() };

      return await putSettings({
        settings: settingsPatch,
        secrets: Object.keys(secretsPatch).length ? secretsPatch : undefined,
      });
    },
    onSuccess: async () => {
      // Clear any typed secrets so they don't linger in memory.
      setPlexToken('');
      setRadarrApiKey('');
      setSonarrApiKey('');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      onFinish?.();
    },
  });

  const onboarding = useMemo(() => {
    const raw = settingsObj['onboarding'];
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  }, [settingsObj]);

  const completed = Boolean(onboarding?.completed);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">Setup</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure integrations. API keys are encrypted server-side and never shown again.
          </p>
        </div>
        {completed ? (
          <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            Completed
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Import legacy `config.yaml`</CardTitle>
            <CardDescription>
              Fastest way to get going. Paste YAML or upload your existing file, then apply.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  previewMutation.reset();
                  applyMutation.reset();
                  setYamlText('');
                }}
              >
                Clear
              </Button>

              <label className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <FileUp className="h-4 w-4" />
                <span>Upload YAML</span>
                <input
                  type="file"
                  accept=".yaml,.yml,text/yaml"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setYamlText(text);
                  }}
                />
              </label>
            </div>

            <div className="grid gap-2">
              <Label>YAML</Label>
              <textarea
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                placeholder="Paste your legacy config/config.yaml here…"
                className="min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => previewMutation.mutate()}
                disabled={!yamlText.trim() || previewMutation.isPending || applyMutation.isPending}
              >
                {previewMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Previewing…
                  </>
                ) : (
                  <>
                    <FileDown className="h-4 w-4" />
                    Preview
                  </>
                )}
              </Button>

              <Button
                onClick={() => applyMutation.mutate()}
                disabled={!yamlText.trim() || applyMutation.isPending || previewMutation.isPending}
              >
                {applyMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying…
                  </>
                ) : (
                  'Apply import'
                )}
              </Button>
            </div>

            {previewMutation.error ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>{(previewMutation.error as Error).message}</div>
              </div>
            ) : null}

            {applyMutation.error ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>{(applyMutation.error as Error).message}</div>
              </div>
            ) : null}

            {applyMutation.data ? (
              <div className="rounded-lg border bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                Import applied. Warnings: {applyMutation.data.warnings.length}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Core connections (manual)</CardTitle>
            <CardDescription>
              Enter values once. After saving, API keys are hidden and only “Test” remains.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Plex base URL</Label>
              <Input
                value={plexBaseUrl || readString(settingsObj, 'plex.baseUrl')}
                onChange={(e) => setPlexBaseUrl(e.target.value)}
                placeholder="http://localhost:32400"
              />
            </div>
            <div className="grid gap-2">
              <Label>Plex token</Label>
              <Input
                type="password"
                value={plexToken}
                onChange={(e) => setPlexToken(e.target.value)}
                placeholder={secretsPresent.plex ? 'Saved (hidden) — enter to replace' : 'Enter token'}
              />
            </div>
            <div className="grid gap-2">
              <Label>Plex movie library name</Label>
              <Input
                value={
                  plexMovieLibraryName ||
                  readString(settingsObj, 'plex.movieLibraryName') ||
                  readString(settingsObj, 'plex.movie_library_name') ||
                  'Movies'
                }
                onChange={(e) => setPlexMovieLibraryName(e.target.value)}
                placeholder="Movies"
              />
            </div>
            <div className="grid gap-2">
              <Label>Plex TV library name</Label>
              <Input
                value={
                  plexTvLibraryName ||
                  readString(settingsObj, 'plex.tvLibraryName') ||
                  readString(settingsObj, 'plex.tv_library_name') ||
                  'TV Shows'
                }
                onChange={(e) => setPlexTvLibraryName(e.target.value)}
                placeholder="TV Shows"
              />
            </div>

            <div className="grid gap-2">
              <Label>Radarr base URL</Label>
              <Input
                value={radarrBaseUrl || readString(settingsObj, 'radarr.baseUrl')}
                onChange={(e) => setRadarrBaseUrl(e.target.value)}
                placeholder="http://localhost:7878"
              />
            </div>
            <div className="grid gap-2">
              <Label>Radarr API key</Label>
              <Input
                type="password"
                value={radarrApiKey}
                onChange={(e) => setRadarrApiKey(e.target.value)}
                placeholder={secretsPresent.radarr ? 'Saved (hidden) — enter to replace' : 'Enter API key'}
              />
            </div>

            <div className="grid gap-2">
              <Label>Sonarr base URL</Label>
              <Input
                value={sonarrBaseUrl || readString(settingsObj, 'sonarr.baseUrl')}
                onChange={(e) => setSonarrBaseUrl(e.target.value)}
                placeholder="http://localhost:8989"
              />
            </div>
            <div className="grid gap-2">
              <Label>Sonarr API key</Label>
              <Input
                type="password"
                value={sonarrApiKey}
                onChange={(e) => setSonarrApiKey(e.target.value)}
                placeholder={secretsPresent.sonarr ? 'Saved (hidden) — enter to replace' : 'Enter API key'}
              />
            </div>

            {saveMutation.error ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>{(saveMutation.error as Error).message}</div>
              </div>
            ) : null}

            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Confirm connections</CardTitle>
          <CardDescription>
            Keys remain hidden. Use Test to validate the saved credentials anytime.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusRow
            label="Plex"
            configured={plexConfigured}
            testing={testMutation.isPending && testMutation.variables === 'plex'}
            onTest={() => testMutation.mutate('plex')}
            lastResult={testState.plex ?? null}
          />
          <StatusRow
            label="Radarr"
            configured={radarrConfigured}
            testing={testMutation.isPending && testMutation.variables === 'radarr'}
            onTest={() => testMutation.mutate('radarr')}
            lastResult={testState.radarr ?? null}
          />
          <StatusRow
            label="Sonarr"
            configured={sonarrConfigured}
            testing={testMutation.isPending && testMutation.variables === 'sonarr'}
            onTest={() => testMutation.mutate('sonarr')}
            lastResult={testState.sonarr ?? null}
          />
          <StatusRow
            label="TMDB"
            configured={tmdbConfigured}
            testing={testMutation.isPending && testMutation.variables === 'tmdb'}
            onTest={() => testMutation.mutate('tmdb')}
            lastResult={testState.tmdb ?? null}
          />
          <StatusRow
            label="Google CSE"
            configured={googleConfigured}
            testing={testMutation.isPending && testMutation.variables === 'google'}
            onTest={() => testMutation.mutate('google')}
            lastResult={testState.google ?? null}
          />
          <StatusRow
            label="OpenAI"
            configured={openAiConfigured}
            testing={testMutation.isPending && testMutation.variables === 'openai'}
            onTest={() => testMutation.mutate('openai')}
            lastResult={testState.openai ?? null}
          />
          <StatusRow
            label="Overseerr"
            configured={overseerrConfigured}
            testing={testMutation.isPending && testMutation.variables === 'overseerr'}
            onTest={() => testMutation.mutate('overseerr')}
            lastResult={testState.overseerr ?? null}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="text-sm text-muted-foreground">
          {readyToFinish ? (
            <span>Ready to finish. You can run jobs after closing this wizard.</span>
          ) : (
            <span>To finish, configure Plex + Radarr + Sonarr (base URL + API key/token).</span>
          )}
        </div>

        <Button onClick={() => finishMutation.mutate()} disabled={!readyToFinish || finishMutation.isPending}>
          {finishMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Finishing…
            </>
          ) : (
            'Finish setup'
          )}
        </Button>
      </div>

      {finishMutation.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4" />
          <div>{(finishMutation.error as Error).message}</div>
        </div>
      ) : null}
    </div>
  );
}


