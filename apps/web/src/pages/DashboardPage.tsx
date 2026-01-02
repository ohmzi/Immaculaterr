import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Settings2,
  PlugZap,
  Layers,
  ListChecks,
  History,
  FileUp,
  Activity,
  Zap,
  Server,
  Clock,
  ChevronRight,
  Sparkles,
  Film,
  Tv,
  MonitorPlay,
} from 'lucide-react';

import { useHealthQuery } from '@/api/queries';
import { getPublicSettings } from '@/api/settings';
import { cn } from '@/lib/utils';

// Quick Access items - main navigation cards
const quickAccess = [
  {
    to: '/connections',
    icon: PlugZap,
    title: 'Connections',
    subtitle: 'Test services',
    color: 'from-blue-500 to-cyan-500',
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-400',
  },
  {
    to: '/collections',
    icon: Layers,
    title: 'Collections',
    subtitle: 'Manage library',
    color: 'from-violet-500 to-purple-500',
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-400',
  },
  {
    to: '/jobs',
    icon: ListChecks,
    title: 'Jobs',
    subtitle: 'Run workflows',
    color: 'from-amber-500 to-orange-500',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
  },
  {
    to: '/runs',
    icon: History,
    title: 'History',
    subtitle: 'View runs',
    color: 'from-rose-500 to-pink-500',
    iconBg: 'bg-rose-500/15',
    iconColor: 'text-rose-400',
  },
];

// My sections - room-card style
const sections = [
  {
    to: '/setup',
    icon: Settings2,
    title: 'Setup',
    count: 'Configure',
    accent: 'bg-emerald-500',
  },
  {
    to: '/import',
    icon: FileUp,
    title: 'Import',
    count: 'YAML',
    accent: 'bg-slate-500',
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

  const isOnline = health && !healthError;

  return (
    <div className="relative min-h-[calc(100vh-8rem)]">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 lg:px-8 lg:py-8">
        
        {/* Search Bar - Mobile prominent */}
        <div className="mb-6 lg:hidden">
          <div className="search-bar flex items-center gap-3 px-4 py-3">
            <Search className="h-5 w-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search features..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Hero Stat Card - Weather widget style */}
        <div className="mb-8 hero-text">
          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                {/* Status icon - like weather icon */}
                <div
                  className={cn(
                    'flex h-16 w-16 items-center justify-center rounded-2xl',
                    isOnline ? 'bg-emerald-500/20' : 'bg-red-500/20',
                  )}
                >
                  {isOnline ? (
                    <Activity className="h-8 w-8 text-emerald-400" />
                  ) : (
                    <Server className="h-8 w-8 text-red-400" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">System Status</p>
                  <p className="text-3xl font-bold tracking-tight">
                    {healthError ? 'Offline' : isOnline ? 'Online' : 'Connecting...'}
                  </p>
                  <p className="text-sm text-muted-foreground">Tautulli Curated</p>
                </div>
              </div>

              {/* Quick stats row */}
              <div className="hidden sm:block">
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">
                      {setupComplete ? '✓' : '—'}
                    </p>
                    <p className="text-muted-foreground">Setup</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">Local</p>
                    <p className="text-muted-foreground">Mode</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom stats row - like weather details */}
            <div className="mt-6 grid grid-cols-4 gap-4 border-t border-white/5 pt-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{isOnline ? 'Ready' : '—'}</span>
                </div>
                <p className="text-xs text-muted-foreground">Status</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <Server className="h-4 w-4 text-primary" />
                  <span className="font-semibold">Local</span>
                </div>
                <p className="text-xs text-muted-foreground">Server</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="font-semibold">Auto</span>
                </div>
                <p className="text-xs text-muted-foreground">Schedule</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{setupComplete ? 'Done' : 'Pending'}</span>
                </div>
                <p className="text-xs text-muted-foreground">Setup</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Access Section */}
        <section className="mb-8">
          <div className="mb-4 flex items-center justify-between hero-text hero-text-delay-1">
            <h2 className="section-title">Quick Access</h2>
            <Link
              to="/setup"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              See All
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {quickAccess.map((item, index) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'quick-card card-reveal group',
                    `card-delay-${index + 1}`,
                  )}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className={cn('icon-container', item.iconBg)}>
                      <Icon className={cn('h-5 w-5', item.iconColor)} />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.subtitle}</p>
                </Link>
              );
            })}
          </div>
        </section>

        {/* My Sections - Room card style */}
        <section className="mb-8">
          <div className="mb-4 flex items-center justify-between hero-text hero-text-delay-2">
            <h2 className="section-title">My Sections</h2>
            <Link
              to="/collections"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              See All
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {sections.map((item, index) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'dash-card group p-5 card-reveal',
                    `card-delay-${index + 3}`,
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        'flex h-14 w-14 items-center justify-center rounded-2xl',
                        item.accent + '/15',
                      )}
                    >
                      <Icon className={cn('h-7 w-7', item.accent.replace('bg-', 'text-').replace('-500', '-400'))} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">{item.count}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Desktop Hero Section - Bold like fintech reference */}
        <section className="hidden lg:block mb-12 hero-text hero-text-delay-3">
          <div className="dash-card overflow-hidden">
            <div className="relative p-8 lg:p-12">
              {/* Background gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />
              
              <div className="relative flex items-center justify-between">
                <div className="max-w-xl">
                  <h2 className="mb-4 text-4xl font-bold tracking-tight">
                    Automate your <span className="gradient-text">Plex library</span>
                  </h2>
                  <p className="mb-6 text-lg text-muted-foreground">
                    Intelligent monitoring, collection management, and seamless 
                    Radarr & Sonarr integration — all in one place.
                  </p>
                  <div className="flex items-center gap-4">
                    <Link
                      to={setupComplete ? '/jobs' : '/setup'}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full px-6 py-3',
                        'bg-primary text-white font-semibold',
                        'btn-lift shadow-lg shadow-primary/30',
                      )}
                    >
                      <Zap className="h-5 w-5" />
                      {setupComplete ? 'Run Jobs' : 'Get Started'}
                    </Link>
                    <Link
                      to="/collections"
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full px-6 py-3',
                        'glass font-semibold',
                        'transition-all hover:bg-accent',
                      )}
                    >
                      <Layers className="h-5 w-5" />
                      Collections
                    </Link>
                  </div>
                </div>

                {/* Floating cards - fintech style */}
                <div className="hidden xl:flex flex-col gap-4">
                  <div className="quick-card flex items-center gap-3 px-5 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15">
                      <Film className="h-5 w-5 text-violet-400" />
                    </div>
                    <div>
                      <p className="font-semibold">Movies</p>
                      <p className="text-sm text-muted-foreground">Radarr sync</p>
                    </div>
                  </div>
                  <div className="quick-card flex items-center gap-3 px-5 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15">
                      <Tv className="h-5 w-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="font-semibold">TV Shows</p>
                      <p className="text-sm text-muted-foreground">Sonarr sync</p>
                    </div>
                  </div>
                  <div className="quick-card flex items-center gap-3 px-5 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15">
                      <MonitorPlay className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="font-semibold">Plex</p>
                      <p className="text-sm text-muted-foreground">Collections</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Get Started CTA - Mobile */}
        {!setupComplete && (
          <section className="lg:hidden card-reveal card-delay-5">
            <Link
              to="/setup"
              className={cn(
                'dash-card flex items-center justify-between p-5',
                'bg-gradient-to-r from-primary/20 to-primary/5',
                'border-primary/30',
              )}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Complete Setup</h3>
                  <p className="text-sm text-muted-foreground">Configure your integrations</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-primary" />
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
