import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, FileDown, FileUp, Loader2, PlugZap } from 'lucide-react';

import { getPublicSettings, importYamlApply, importYamlPreview } from '@/api/settings';
import { testSavedIntegration } from '@/api/integrations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

function ConnectionRow(params: {
  label: string;
  detail?: string;
  configured: boolean;
  testing: boolean;
  lastResult: { ok: boolean; message: string } | null;
  onTest: () => void;
}) {
  const { label, detail, configured, testing, lastResult, onTest } = params;
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
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
        {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
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

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [yamlText, setYamlText] = useState('');

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const previewMutation = useMutation({
    mutationFn: async () => importYamlPreview(yamlText),
  });

  const applyMutation = useMutation({
    mutationFn: async () => importYamlApply(yamlText),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const preview = previewMutation.data;
  const applied = applyMutation.data;

  const dataDir = useMemo(() => settingsQuery.data?.meta?.dataDir ?? null, [settingsQuery.data]);
  const settingsObj = useMemo(
    () => (settingsQuery.data?.settings ?? {}) as Record<string, unknown>,
    [settingsQuery.data],
  );
  const secretsPresent = useMemo(
    () => settingsQuery.data?.secretsPresent ?? {},
    [settingsQuery.data],
  );

  const [testState, setTestState] = useState<Record<string, { ok: boolean; message: string }>>({});
  const testMutation = useMutation({
    mutationFn: async (id: string) => testSavedIntegration(id),
    onSuccess: (_data, id) => setTestState((prev) => ({ ...prev, [id]: { ok: true, message: 'OK' } })),
    onError: (err, id) =>
      setTestState((prev) => ({
        ...prev,
        [id]: { ok: false, message: err instanceof Error ? err.message : String(err) },
      })),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Manage service connections (Plex, Radarr, Sonarr, Tautulli, TMDB…).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Import legacy `config.yaml`</CardTitle>
            <CardDescription>
              Paste YAML or upload your existing config to migrate it into the DB-backed settings.
              Secrets are stored encrypted on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void previewMutation.reset();
                  void applyMutation.reset();
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
                className="min-h-56 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    Preview import
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

            {preview ? (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="text-sm font-medium">Preview</div>
                {preview.warnings.length ? (
                  <div className="text-sm text-muted-foreground">
                    Warnings: {preview.warnings.length}
                    <ul className="mt-2 list-disc pl-5">
                      {preview.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No warnings.</div>
                )}

                <div className="text-sm text-muted-foreground">
                  Secrets to set: {preview.preview.secretsPaths.length || 0}
                </div>

                <pre className="max-h-64 overflow-auto rounded-md bg-background/60 p-3 text-xs">
{JSON.stringify(preview.preview.settingsPatch, null, 2)}
                </pre>
              </div>
            ) : null}

            {applied ? (
              <div className="rounded-lg border bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                Applied. Warnings: {applied.warnings.length}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved connections</CardTitle>
            <CardDescription>
              API keys are hidden. Use Test to validate your saved credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {settingsQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : settingsQuery.error ? (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>{(settingsQuery.error as Error).message}</div>
              </div>
            ) : settingsQuery.data ? (
              <>
                <div className="text-sm text-muted-foreground">
                  Data dir: <span className="font-mono">{dataDir ?? '—'}</span>
                </div>

                <div className="space-y-2">
                  <ConnectionRow
                    label="Plex"
                    detail={readString(settingsObj, 'plex.baseUrl') ? `Base URL: ${readString(settingsObj, 'plex.baseUrl')}` : ''}
                    configured={Boolean(readString(settingsObj, 'plex.baseUrl')) && Boolean(secretsPresent.plex)}
                    testing={testMutation.isPending && testMutation.variables === 'plex'}
                    lastResult={testState.plex ?? null}
                    onTest={() => testMutation.mutate('plex')}
                  />
                  <ConnectionRow
                    label="Radarr"
                    detail={readString(settingsObj, 'radarr.baseUrl') ? `Base URL: ${readString(settingsObj, 'radarr.baseUrl')}` : ''}
                    configured={Boolean(readString(settingsObj, 'radarr.baseUrl')) && Boolean(secretsPresent.radarr)}
                    testing={testMutation.isPending && testMutation.variables === 'radarr'}
                    lastResult={testState.radarr ?? null}
                    onTest={() => testMutation.mutate('radarr')}
                  />
                  <ConnectionRow
                    label="Sonarr"
                    detail={readString(settingsObj, 'sonarr.baseUrl') ? `Base URL: ${readString(settingsObj, 'sonarr.baseUrl')}` : ''}
                    configured={Boolean(readString(settingsObj, 'sonarr.baseUrl')) && Boolean(secretsPresent.sonarr)}
                    testing={testMutation.isPending && testMutation.variables === 'sonarr'}
                    lastResult={testState.sonarr ?? null}
                    onTest={() => testMutation.mutate('sonarr')}
                  />
                  <ConnectionRow
                    label="TMDB"
                    detail=""
                    configured={Boolean(secretsPresent.tmdb)}
                    testing={testMutation.isPending && testMutation.variables === 'tmdb'}
                    lastResult={testState.tmdb ?? null}
                    onTest={() => testMutation.mutate('tmdb')}
                  />
                  <ConnectionRow
                    label="Google CSE"
                    detail={
                      readString(settingsObj, 'google.searchEngineId')
                        ? `Search engine ID: ${readString(settingsObj, 'google.searchEngineId')}`
                        : ''
                    }
                    configured={
                      Boolean(secretsPresent.google) &&
                      Boolean(readString(settingsObj, 'google.searchEngineId'))
                    }
                    testing={testMutation.isPending && testMutation.variables === 'google'}
                    lastResult={testState.google ?? null}
                    onTest={() => testMutation.mutate('google')}
                  />
                  <ConnectionRow
                    label="OpenAI"
                    detail=""
                    configured={Boolean(secretsPresent.openai)}
                    testing={testMutation.isPending && testMutation.variables === 'openai'}
                    lastResult={testState.openai ?? null}
                    onTest={() => testMutation.mutate('openai')}
                  />
                  <ConnectionRow
                    label="Overseerr"
                    detail={
                      readString(settingsObj, 'overseerr.baseUrl')
                        ? `Base URL: ${readString(settingsObj, 'overseerr.baseUrl')}`
                        : ''
                    }
                    configured={
                      Boolean(secretsPresent.overseerr) &&
                      Boolean(readString(settingsObj, 'overseerr.baseUrl'))
                    }
                    testing={testMutation.isPending && testMutation.variables === 'overseerr'}
                    lastResult={testState.overseerr ?? null}
                    onTest={() => testMutation.mutate('overseerr')}
                  />
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


