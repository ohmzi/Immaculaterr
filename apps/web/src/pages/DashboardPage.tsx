import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleAlert,
  Play,
  Settings2,
  Zap,
  PlugZap,
  Layers,
  History,
  FileUp,
  ListChecks,
  Activity,
} from 'lucide-react';

import { listRuns, runJob } from '@/api/jobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NavCard, NavCardGrid } from '@/components/ui/nav-card';
import { useHealthQuery } from '@/api/queries';
import { getPublicSettings } from '@/api/settings';
import { cn } from '@/lib/utils';

function statusPill(status: string) {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30';
    case 'FAILED':
      return 'bg-destructive/20 text-destructive border border-destructive/30';
    case 'RUNNING':
      return 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30';
    default:
      return 'bg-muted text-foreground border border-border';
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
    <div className="space-y-8 md:space-y-12">
      {/* Hero Section - CoLabs inspired */}
      <section className="relative animate-fade-in">
        <div className="absolute inset-0 -z-10 overflow-hidden rounded-3xl">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent" />
          <div className="absolute right-0 top-0 h-64 w-64 translate-x-1/3 -translate-y-1/3 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-48 w-48 -translate-x-1/4 translate-y-1/4 rounded-full bg-sky-500/10 blur-3xl" />
        </div>
        
        <div className="relative rounded-3xl border bg-card/50 p-8 backdrop-blur-sm md:p-12">
          <div className="max-w-2xl">
            <h1 className="animate-fade-in-up text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
              <span className="text-gradient">Curate</span> your
              <br />
              Plex experience
            </h1>
            <p className="mt-4 animate-fade-in-up delay-100 text-lg text-muted-foreground md:text-xl">
              Automate your media library with intelligent monitoring, collection management,
              and seamless integration with Radarr & Sonarr.
            </p>
            
            <div className="mt-8 flex flex-wrap items-center gap-3 animate-fade-in-up delay-200">
              {!setupComplete ? (
                <Button asChild size="lg">
                  <Link to="/setup">
                    <Settings2 className="h-5 w-5" />
                    Get Started
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="secondary" size="lg">
                  <Link to="/setup">
                    <Settings2 className="h-5 w-5" />
                    Review Setup
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline" size="lg">
                <Link to="/jobs">
                  <ListChecks className="h-5 w-5" />
                  View Jobs
                </Link>
              </Button>
            </div>
          </div>

          {/* Status indicator */}
          <div className="absolute right-6 top-6 md:right-8 md:top-8">
            {error ? (
              <div className="flex items-center gap-2 rounded-full bg-destructive/10 px-4 py-2 text-sm text-destructive">
                <CircleAlert className="h-4 w-4" />
                <span className="hidden sm:inline">Offline</span>
              </div>
            ) : health ? (
              <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                <Activity className="h-4 w-4 animate-pulse" />
                <span className="hidden sm:inline">Online</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground">
                <div className="h-4 w-4 shimmer rounded-full" />
                <span className="hidden sm:inline">Checking...</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Navigation Cards - CoLabs style grid */}
      <section>
        <h2 className="mb-6 text-2xl font-semibold tracking-tight animate-fade-in-up delay-300">
          Quick Access
        </h2>
        <NavCardGrid>
          <NavCard
            to="/setup"
            icon={Settings2}
            title="Setup"
            description="Configure your Plex, Radarr, and Sonarr connections to get started."
            badge={setupComplete ? 'Complete' : 'Required'}
            badgeVariant={setupComplete ? 'success' : 'warning'}
            delay={100}
          />
          <NavCard
            to="/connections"
            icon={PlugZap}
            title="Connections"
            description="Test and manage your integration connections with external services."
            delay={200}
          />
          <NavCard
            to="/collections"
            icon={Layers}
            title="Collections"
            description="Create and manage curated Plex collections for your media library."
            delay={300}
          />
          <NavCard
            to="/jobs"
            icon={ListChecks}
            title="Jobs"
            description="Configure and schedule automated workflows for your media."
            delay={400}
          />
          <NavCard
            to="/runs"
            icon={History}
            title="Run History"
            description="View detailed logs and history of all job executions."
            delay={500}
          />
          <NavCard
            to="/import"
            icon={FileUp}
            title="Import"
            description="Import settings from existing config.yaml files."
            delay={600}
          />
        </NavCardGrid>
      </section>

      {/* Quick Actions - Job Cards */}
      <section>
        <h2 className="mb-6 text-2xl font-semibold tracking-tight animate-fade-in delay-300">
          Workflows
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Monitor Confirm Job Card */}
          <Card className="animate-fade-in-up delay-400 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
            <CardHeader className="relative">
              <div className="flex items-start justify-between">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                  <Zap className="h-5 w-5" />
                </div>
                {lastRunFor.monitorConfirm && (
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium',
                      statusPill(lastRunFor.monitorConfirm.status),
                    )}
                  >
                    {lastRunFor.monitorConfirm.status}
                  </span>
                )}
              </div>
              <CardTitle className="mt-4">Monitor Confirm</CardTitle>
              <CardDescription>
                Unmonitor items already present in Plex and optionally trigger Sonarr "Search Monitored".
              </CardDescription>
            </CardHeader>
            <CardContent className="relative space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => runMutation.mutate({ jobId: 'monitorConfirm', dryRun: true })}
                  disabled={!setupComplete || runMutation.isPending}
                >
                  <Play className="h-4 w-4" />
                  Dry Run
                </Button>
                <Button
                  onClick={() => runMutation.mutate({ jobId: 'monitorConfirm', dryRun: false })}
                  disabled={!setupComplete || runMutation.isPending}
                >
                  <Zap className="h-4 w-4" />
                  Run Now
                </Button>
              </div>

              {lastRunFor.monitorConfirm && (
                <p className="text-sm text-muted-foreground">
                  Last run:{' '}
                  <Link
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    to={`/jobs/runs/${lastRunFor.monitorConfirm.id}`}
                  >
                    {new Date(lastRunFor.monitorConfirm.startedAt).toLocaleString()}
                  </Link>
                </p>
              )}

              {!setupComplete && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Complete setup to enable this workflow.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recently Watched Refresher Card */}
          <Card className="animate-fade-in-up delay-500 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 via-transparent to-transparent" />
            <CardHeader className="relative">
              <div className="flex items-start justify-between">
                <div className="rounded-xl bg-sky-500/10 p-2.5 text-sky-600 dark:text-sky-400">
                  <History className="h-5 w-5" />
                </div>
                {lastRunFor.recentlyWatchedRefresher && (
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium',
                      statusPill(lastRunFor.recentlyWatchedRefresher.status),
                    )}
                  >
                    {lastRunFor.recentlyWatchedRefresher.status}
                  </span>
                )}
              </div>
              <CardTitle className="mt-4">Recently Watched Refresher</CardTitle>
              <CardDescription>
                Refresh Plex collections with randomized content for recently watched recommendations.
              </CardDescription>
            </CardHeader>
            <CardContent className="relative space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => runMutation.mutate({ jobId: 'recentlyWatchedRefresher', dryRun: true })}
                  disabled={!setupComplete || runMutation.isPending}
                >
                  <Play className="h-4 w-4" />
                  Dry Run
                </Button>
                <Button
                  onClick={() => runMutation.mutate({ jobId: 'recentlyWatchedRefresher', dryRun: false })}
                  disabled={!setupComplete || runMutation.isPending}
                >
                  <Zap className="h-4 w-4" />
                  Run Now
                </Button>
              </div>

              {lastRunFor.recentlyWatchedRefresher && (
                <p className="text-sm text-muted-foreground">
                  Last run:{' '}
                  <Link
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    to={`/jobs/runs/${lastRunFor.recentlyWatchedRefresher.id}`}
                  >
                    {new Date(lastRunFor.recentlyWatchedRefresher.startedAt).toLocaleString()}
                  </Link>
                </p>
              )}

              {!setupComplete && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Complete setup to enable this workflow.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Error display */}
      {runMutation.isError && (
        <div className="animate-fade-in rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="flex items-start gap-3">
            <CircleAlert className="h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Job execution failed</p>
              <p className="mt-1 text-destructive/80">{(runMutation.error as Error).message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
