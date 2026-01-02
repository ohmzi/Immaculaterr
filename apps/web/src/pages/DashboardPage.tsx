import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Play, Settings2, Zap } from 'lucide-react';

import { listRuns, runJob } from '@/api/jobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useHealthQuery } from '@/api/queries';
import { getPublicSettings } from '@/api/settings';
import { cn } from '@/lib/utils';

function statusPill(status: string) {
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

export function DashboardPage() {
  const navigate = useNavigate();

  const { data: health, error, isLoading } = useHealthQuery();

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const runsQuery = useQuery({
    queryKey: ['jobRuns'],
    queryFn: () => listRuns({ take: 50 }),
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const setup = useMemo(() => {
    const s = settingsQuery.data?.settings as any;
    const onboarding = s?.onboarding ?? {};
    return {
      completed: Boolean(onboarding?.completed),
      completedAt: typeof onboarding?.completedAt === 'string' ? onboarding.completedAt : null,
    };
  }, [settingsQuery.data?.settings]);

  const setupComplete = setup.completed;

  const lastRunFor = useMemo(() => {
    const runs = runsQuery.data?.runs ?? [];
    const find = (jobId: string) => runs.find((r) => r.jobId === jobId) ?? null;
    return {
      monitorConfirm: find('monitorConfirm'),
      recentlyWatchedRefresher: find('recentlyWatchedRefresher'),
    };
  }, [runsQuery.data?.runs]);

  const runMutation = useMutation({
    mutationFn: async (params: { jobId: string; dryRun: boolean }) =>
      runJob(params.jobId, params.dryRun),
    onSuccess: async (data) => {
      void navigate(`/jobs/runs/${data.run.id}`);
    },
  });

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-transparent" />
          <CardHeader className="relative">
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>
              Quick actions, health, and your two main workflows.
            </CardDescription>
          </CardHeader>
          <CardContent className="relative flex flex-wrap items-center gap-2">
            <Button asChild variant={setupComplete ? 'secondary' : 'default'}>
              <Link to="/setup">
                <Settings2 className="h-4 w-4" />
                {setupComplete ? 'Review setup' : 'Run setup'}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/connections">Connections</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/jobs">Jobs</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/runs">Runs</Link>
            </Button>
          </CardContent>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Backend status</CardTitle>
            <CardDescription>Checks connectivity to the local API.</CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>
                  <div className="font-medium">API unreachable</div>
                  <div className="text-destructive/80">{error.message}</div>
                </div>
              </div>
            ) : health ? (
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                <div>
                  <div className="font-medium">OK</div>
                  <div className="text-muted-foreground">
                    Server time: {new Date(health.time).toLocaleString()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{isLoading ? 'Loading…' : '—'}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>Required integrations for MVP.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Status</span>
                <span className={setupComplete ? 'text-emerald-600' : 'text-muted-foreground'}>
                  {setupComplete ? 'Completed' : 'Not completed'}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Last run</span>
                <span>
                  {setup.completedAt ? new Date(setup.completedAt).toLocaleString() : '—'}
                </span>
              </div>
            </div>

            {!setupComplete ? (
              <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                Run setup to validate Plex/Radarr/Sonarr before running jobs.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Job 1 (primary): Monitor Confirm</CardTitle>
            <CardDescription>
              Unmonitor items already present in Plex and optionally trigger Sonarr “Search Monitored”.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => runMutation.mutate({ jobId: 'monitorConfirm', dryRun: true })}
                disabled={!setupComplete || runMutation.isPending}
              >
                <Play className="h-4 w-4" />
                Dry-run
              </Button>
              <Button
                onClick={() => runMutation.mutate({ jobId: 'monitorConfirm', dryRun: false })}
                disabled={!setupComplete || runMutation.isPending}
              >
                <Zap className="h-4 w-4" />
                Run
              </Button>
            </div>

            {lastRunFor.monitorConfirm ? (
              <div className="text-sm text-muted-foreground">
                Last run:{' '}
                <Link
                  className="font-mono text-xs underline-offset-4 hover:underline"
                  to={`/jobs/runs/${lastRunFor.monitorConfirm.id}`}
                >
                  {new Date(lastRunFor.monitorConfirm.startedAt).toLocaleString()}
                </Link>{' '}
                <span
                  className={cn(
                    'ml-2 rounded-full px-2 py-1 text-xs font-medium',
                    statusPill(lastRunFor.monitorConfirm.status),
                  )}
                >
                  {lastRunFor.monitorConfirm.status}
                </span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No runs yet.</div>
            )}

            {!setupComplete ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                Finish setup first (Plex + Radarr + Sonarr) to enable this.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job 2 (secondary): Recently Watched refresher</CardTitle>
            <CardDescription>Refresh Plex collections for recently watched recommendations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => runMutation.mutate({ jobId: 'recentlyWatchedRefresher', dryRun: true })}
                disabled={!setupComplete || runMutation.isPending}
              >
                <Play className="h-4 w-4" />
                Dry-run
              </Button>
              <Button
                onClick={() => runMutation.mutate({ jobId: 'recentlyWatchedRefresher', dryRun: false })}
                disabled={!setupComplete || runMutation.isPending}
              >
                <Zap className="h-4 w-4" />
                Run
              </Button>
            </div>

            {lastRunFor.recentlyWatchedRefresher ? (
              <div className="text-sm text-muted-foreground">
                Last run:{' '}
                <Link
                  className="font-mono text-xs underline-offset-4 hover:underline"
                  to={`/jobs/runs/${lastRunFor.recentlyWatchedRefresher.id}`}
                >
                  {new Date(lastRunFor.recentlyWatchedRefresher.startedAt).toLocaleString()}
                </Link>{' '}
                <span
                  className={cn(
                    'ml-2 rounded-full px-2 py-1 text-xs font-medium',
                    statusPill(lastRunFor.recentlyWatchedRefresher.status),
                  )}
                >
                  {lastRunFor.recentlyWatchedRefresher.status}
                </span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No runs yet.</div>
            )}

            {!setupComplete ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                Finish setup first (Plex + Radarr + Sonarr) to enable this.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {runMutation.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {(runMutation.error as Error).message}
        </div>
      ) : null}
    </div>
  );
}


