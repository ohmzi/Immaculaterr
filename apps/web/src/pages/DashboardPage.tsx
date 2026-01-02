import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Settings2,
  PlugZap,
  Layers,
  ListChecks,
  History,
  FileUp,
  ArrowRight,
  Sparkles,
  Zap,
  Activity,
} from 'lucide-react';

import { useHealthQuery } from '@/api/queries';
import { getPublicSettings } from '@/api/settings';
import { cn } from '@/lib/utils';

// Page navigation data
const pages = [
  {
    to: '/setup',
    icon: Settings2,
    title: 'Setup',
    description: 'Configure your integrations',
    color: 'from-emerald-500 to-teal-600',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    to: '/connections',
    icon: PlugZap,
    title: 'Connections',
    description: 'Test service connectivity',
    color: 'from-blue-500 to-cyan-600',
    bgColor: 'bg-blue-500/10',
    textColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    to: '/collections',
    icon: Layers,
    title: 'Collections',
    description: 'Manage Plex collections',
    color: 'from-violet-500 to-purple-600',
    bgColor: 'bg-violet-500/10',
    textColor: 'text-violet-600 dark:text-violet-400',
  },
  {
    to: '/jobs',
    icon: ListChecks,
    title: 'Jobs',
    description: 'Run & schedule workflows',
    color: 'from-amber-500 to-orange-600',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-600 dark:text-amber-400',
  },
  {
    to: '/runs',
    icon: History,
    title: 'Runs',
    description: 'View execution history',
    color: 'from-rose-500 to-pink-600',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-600 dark:text-rose-400',
  },
  {
    to: '/import',
    icon: FileUp,
    title: 'Import',
    description: 'Import from config.yaml',
    color: 'from-slate-500 to-gray-600',
    bgColor: 'bg-slate-500/10',
    textColor: 'text-slate-600 dark:text-slate-400',
  },
];

export function DashboardPage() {
  const { data: health, error: healthError } = useHealthQuery();

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const setupComplete = useMemo(() => {
    const s = settingsQuery.data?.settings;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    const onboarding = (s as Record<string, unknown>)['onboarding'];
    if (!onboarding || typeof onboarding !== 'object' || Array.isArray(onboarding)) return false;
    return Boolean((onboarding as Record<string, unknown>)['completed']);
  }, [settingsQuery.data?.settings]);

  return (
    <div className="relative min-h-[calc(100vh-8rem)]">
      {/* Animated background orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-16">
        {/* Hero Section - Full width, bold like CoLabs */}
        <header className="mb-16 text-center lg:mb-24 lg:text-left">
          {/* Status badge */}
          <div className="mb-8 flex justify-center lg:justify-start">
            <div
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium',
                'border backdrop-blur-sm',
                healthError
                  ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                  : health
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-border bg-muted text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full status-dot',
                  healthError
                    ? 'bg-red-500'
                    : health
                      ? 'bg-emerald-500'
                      : 'bg-muted-foreground',
                )}
              />
              {healthError ? 'Offline' : health ? 'System Online' : 'Connecting...'}
            </div>
          </div>

          {/* Main headline */}
          <h1 className="hero-text mb-6">
            <span className="block text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              Making space for
            </span>
            <span className="block text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl gradient-text">
              curated media
            </span>
          </h1>

          <p className="hero-text hero-text-delay-1 mx-auto max-w-2xl text-lg text-muted-foreground sm:text-xl lg:mx-0 lg:text-2xl">
            Automate your Plex library with intelligent monitoring, 
            collection management, and seamless Radarr & Sonarr integration.
          </p>

          {/* Quick action buttons */}
          <div className="hero-text hero-text-delay-2 mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start">
            {!setupComplete ? (
              <Link
                to="/setup"
                className={cn(
                  'group inline-flex items-center gap-3 rounded-full px-8 py-4',
                  'bg-primary text-primary-foreground font-semibold text-lg',
                  'btn-float shadow-lg shadow-primary/25',
                )}
              >
                <Sparkles className="h-5 w-5 icon-bounce" />
                Get Started
                <ArrowRight className="h-5 w-5 arrow-slide" />
              </Link>
            ) : (
              <Link
                to="/jobs"
                className={cn(
                  'group inline-flex items-center gap-3 rounded-full px-8 py-4',
                  'bg-primary text-primary-foreground font-semibold text-lg',
                  'btn-float shadow-lg shadow-primary/25',
                )}
              >
                <Zap className="h-5 w-5 icon-bounce" />
                Run Jobs
                <ArrowRight className="h-5 w-5 arrow-slide" />
              </Link>
            )}
            <Link
              to="/collections"
              className={cn(
                'group inline-flex items-center gap-3 rounded-full px-8 py-4',
                'border-2 border-border bg-background/80 backdrop-blur-sm',
                'font-semibold text-lg text-foreground',
                'btn-float',
              )}
            >
              <Layers className="h-5 w-5 icon-bounce" />
              Collections
            </Link>
          </div>
        </header>

        {/* Page Navigation Cards - CoLabs style grid */}
        <section>
          <h2 className="hero-text hero-text-delay-3 mb-8 text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground lg:text-left">
            Explore Features
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
            {pages.map((page, index) => {
              const Icon = page.icon;
              return (
                <Link
                  key={page.to}
                  to={page.to}
                  className={cn(
                    'group page-card card-reveal p-6 sm:p-8',
                    `card-delay-${index + 1}`,
                  )}
                >
                  {/* Gradient overlay */}
                  <div
                    className={cn(
                      'absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100',
                      'bg-gradient-to-br',
                      page.color,
                    )}
                    style={{ opacity: 0.03 }}
                  />

                  <div className="relative">
                    {/* Icon */}
                    <div
                      className={cn(
                        'mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl',
                        page.bgColor,
                      )}
                    >
                      <Icon className={cn('h-7 w-7 icon-bounce', page.textColor)} />
                    </div>

                    {/* Title & Description */}
                    <h3 className="mb-2 text-xl font-bold tracking-tight sm:text-2xl">
                      {page.title}
                    </h3>
                    <p className="text-muted-foreground">
                      {page.description}
                    </p>

                    {/* Arrow indicator */}
                    <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary">
                      <span className="opacity-0 transition-opacity group-hover:opacity-100">
                        Explore
                      </span>
                      <ArrowRight className="h-4 w-4 arrow-slide" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Quick Stats Footer */}
        <footer className="mt-16 lg:mt-24">
          <div className="card-reveal card-delay-6 rounded-3xl border bg-card/50 p-6 backdrop-blur-sm sm:p-8">
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="text-center sm:text-left">
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <Activity className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Status</span>
                </div>
                <p className="mt-2 text-2xl font-bold">
                  {healthError ? 'Offline' : health ? 'Online' : '...'}
                </p>
              </div>
              <div className="text-center sm:text-left">
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <Settings2 className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Setup</span>
                </div>
                <p className="mt-2 text-2xl font-bold">
                  {setupComplete ? 'Complete' : 'Pending'}
                </p>
              </div>
              <div className="text-center sm:text-left">
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <Zap className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Mode</span>
                </div>
                <p className="mt-2 text-2xl font-bold">Local Server</p>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
