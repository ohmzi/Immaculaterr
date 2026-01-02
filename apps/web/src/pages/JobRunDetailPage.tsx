import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Loader2 } from 'lucide-react';

import { getRun, getRunLogs } from '@/api/jobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function statusColor(status: string) {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-600 text-white';
    case 'FAILED':
      return 'bg-destructive text-destructive-foreground';
    case 'RUNNING':
      return 'bg-amber-500 text-white';
    default:
      return 'bg-muted text-foreground';
  }
}

function levelStyles(level: string) {
  const l = level.toLowerCase();
  if (l === 'error') {
    return {
      row: 'bg-destructive/5',
      pill: 'text-destructive',
    };
  }
  if (l === 'warn' || l === 'warning') {
    return {
      row: 'bg-amber-500/10',
      pill: 'text-amber-700 dark:text-amber-300',
    };
  }
  if (l === 'debug') {
    return {
      row: '',
      pill: 'text-muted-foreground',
    };
  }
  return { row: '', pill: 'text-foreground' };
}

export function JobRunDetailPage() {
  const params = useParams();
  const runId = params.runId ?? '';

  const runQuery = useQuery({
    queryKey: ['jobRun', runId],
    queryFn: () => getRun(runId),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const data = q.state.data as { run: { status?: string } } | undefined;
      return data?.run?.status === 'RUNNING' ? 2000 : false;
    },
    refetchOnWindowFocus: false,
  });

  const isRunning = runQuery.data?.run?.status === 'RUNNING';

  const logsQuery = useQuery({
    queryKey: ['jobRunLogs', runId],
    queryFn: () => getRunLogs({ runId, take: 1000 }),
    enabled: Boolean(runId),
    refetchInterval: isRunning ? 2000 : false,
    refetchOnWindowFocus: false,
  });

  const run = runQuery.data?.run;
  const logs = useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data?.logs]);
  const logStats = useMemo(() => {
    const counts = { error: 0, warn: 0 };
    for (const l of logs) {
      const lvl = String(l.level ?? '').toLowerCase();
      if (lvl === 'error') counts.error += 1;
      else if (lvl === 'warn' || lvl === 'warning') counts.warn += 1;
    }
    return counts;
  }, [logs]);

  const title = useMemo(() => {
    if (!run) return 'Job run';
    return `${run.jobId} • ${run.status}`;
  }, [run]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Run ID: <span className="font-mono">{runId}</span>
          </p>
        </div>

        <Button asChild variant="outline">
          <Link to="/jobs">
            <ArrowLeft className="h-4 w-4" />
            Back to Jobs
          </Link>
        </Button>
      </div>

      {runQuery.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading run…
            </CardTitle>
          </CardHeader>
        </Card>
      ) : runQuery.error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <CircleAlert className="h-5 w-5" />
              Failed to load run
            </CardTitle>
            <CardDescription className="text-destructive/80">
              {(runQuery.error as Error).message}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : run ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span>Run</span>
                <span className={cn('rounded-full px-3 py-1 text-xs font-medium', statusColor(run.status))}>
                  {run.status}
                  {run.dryRun ? ' (dry-run)' : ''}
                </span>
              </CardTitle>
              <CardDescription>
                Started: {new Date(run.startedAt).toLocaleString()}
                {run.finishedAt ? ` • Finished: ${new Date(run.finishedAt).toLocaleString()}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {run.errorMessage ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  Error: {run.errorMessage}
                </div>
              ) : null}

              <div>
                <div className="mb-2 text-sm font-medium">Summary</div>
                <pre className="max-h-96 overflow-auto rounded-md bg-muted/30 p-3 text-xs">
{JSON.stringify(run.summary ?? null, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Logs</CardTitle>
              <CardDescription>
                {logsQuery.isLoading ? 'Loading…' : `${logs.length} lines`}
                {logStats.error ? ` • ${logStats.error} errors` : ''}
                {logStats.warn ? ` • ${logStats.warn} warnings` : ''}
                {isRunning ? ' • live' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {logsQuery.error ? (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <CircleAlert className="mt-0.5 h-4 w-4" />
                  <div>{(logsQuery.error as Error).message}</div>
                </div>
              ) : logs.length ? (
                <div className="max-h-[520px] overflow-auto rounded-md border bg-background">
                  <div className="divide-y">
                    {logs.map((line) => (
                      <div
                        key={line.id}
                        className={cn('px-3 py-2 text-xs', levelStyles(line.level).row)}
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-muted-foreground">
                            {new Date(line.time).toLocaleTimeString()}
                          </span>
                          <span className={cn('font-mono font-semibold', levelStyles(line.level).pill)}>
                            {line.level}
                          </span>
                          <span className="font-mono">{line.message}</span>
                        </div>
                        {line.context ? (
                          <pre className="mt-1 overflow-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
{JSON.stringify(line.context, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No logs yet.</div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Run not found</CardTitle>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}


