import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, FileDown, FileUp, Loader2 } from 'lucide-react';

import { importYamlApply, importYamlPreview } from '@/api/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export function ImportPage() {
  const queryClient = useQueryClient();
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

  const preview = previewMutation.data;
  const applied = applyMutation.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
          <p className="text-sm text-muted-foreground">
            Migrate a legacy <span className="font-mono">config.yaml</span> into the DB-backed settings. Secrets are stored encrypted and never shown.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/connections">Go to Connections</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import legacy `config.yaml`</CardTitle>
          <CardDescription>
            Paste YAML or upload your existing config to migrate it. Use Preview first if you want to see what will be applied.
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
    </div>
  );
}


