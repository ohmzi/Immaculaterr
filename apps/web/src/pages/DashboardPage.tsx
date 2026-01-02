import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Settings2,
  PlugZap,
  Layers,
  ListChecks,
  History,
  FileUp,
  Activity,
  Zap,
  Server,
  Film,
  Tv,
  MonitorPlay,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

import { useHealthQuery } from '@/api/queries';
import { getPublicSettings } from '@/api/settings';
import { cn } from '@/lib/utils';

// Quick Access items
const quickAccess = [
  {
    to: '/connections',
    icon: PlugZap,
    title: 'Connections',
    subtitle: 'Test services',
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-400',
  },
  {
    to: '/collections',
    icon: Layers,
    title: 'Collections',
    subtitle: 'Manage library',
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-400',
  },
  {
    to: '/jobs',
    icon: ListChecks,
    title: 'Jobs',
    subtitle: 'Run workflows',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
  },
  {
    to: '/runs',
    icon: History,
    title: 'History',
    subtitle: 'View runs',
    iconBg: 'bg-rose-500/15',
    iconColor: 'text-rose-400',
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
    <div className="min-h-screen">
      {/* Hero Section - Figma Growup Style */}
      <section className="relative min-h-[85vh] overflow-hidden">
        {/* Background with gradient overlay */}
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1536440136628-849c177e76a1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1920"
            alt="Cinema background"
            className="w-full h-full object-cover"
          />
          {/* Yellow/Green gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-400/90 via-yellow-300/80 to-green-400/70 dark:from-gray-900/95 dark:via-gray-900/90 dark:to-gray-800/95" />
        </div>

        {/* Content */}
        <div className="relative z-10 container mx-auto px-6 pt-32 pb-16 lg:pt-40 lg:pb-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="space-y-8"
            >
              <h1 className="text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white leading-tight">
                Automate your
                <br />
                <span className="text-gray-800 dark:text-primary">Plex library.</span>
              </h1>
              <p className="text-lg text-gray-800 dark:text-gray-300 max-w-md">
                Intelligent monitoring, collection management, and seamless
                Radarr & Sonarr integration — all in one place.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  to={setupComplete ? '/jobs' : '/setup'}
                  className="btn-primary inline-flex items-center gap-2 group"
                >
                  {setupComplete ? (
                    <>
                      <Zap className="w-5 h-5" />
                      Run Jobs
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Get Started
                    </>
                  )}
                </Link>
                <Link
                  to="/collections"
                  className="btn-secondary inline-flex items-center gap-2 group"
                >
                  View Collections
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </motion.div>

            {/* Right Content - Status Card (Credit Card Style) */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex justify-center lg:justify-end"
            >
              <div className="credit-card w-full max-w-[380px]">
                {/* Card Header */}
                <div className="flex justify-between items-center mb-8">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                      <Zap className="w-5 h-5 text-primary-foreground" />
                    </div>
                    <span className="text-white font-semibold">Tautulli</span>
                  </div>
                  <Link
                    to="/setup"
                    className="px-5 py-2 bg-primary text-primary-foreground rounded-full text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    Configure
                  </Link>
                </div>

                {/* Status */}
                <div className="mb-8">
                  <p className="text-gray-400 text-sm mb-1">System Status</p>
                  <p className="text-white text-4xl font-bold">
                    {healthError ? 'Offline' : isOnline ? 'Online' : 'Connecting...'}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full',
                        isOnline ? 'bg-green-500' : 'bg-red-500'
                      )}
                    />
                    <span className="text-gray-400 text-sm">
                      {isOnline ? 'All systems operational' : 'Waiting for connection'}
                    </span>
                  </div>
                </div>

                {/* Card Footer - Integration Status */}
                <div className="flex justify-between items-center pt-4 border-t border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Film className="w-4 h-4 text-violet-400" />
                      <span className="text-white text-sm">Movies</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tv className="w-4 h-4 text-blue-400" />
                      <span className="text-white text-sm">TV</span>
                    </div>
                  </div>
                  <div className="px-3 py-1.5 bg-primary rounded text-xs font-bold text-primary-foreground">
                    PLEX
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Bottom Badges */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="mt-16 flex flex-wrap gap-4 max-w-2xl"
          >
            <div className="badge-yellow">
              <div className="w-10 h-10 bg-gray-900 rounded-full flex items-center justify-center">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-gray-800">Setup Status</p>
                <p className="text-sm font-semibold text-gray-900">
                  {setupComplete ? 'Complete' : 'Pending'}
                </p>
              </div>
            </div>
            <div className="badge-yellow">
              <div className="w-10 h-10 bg-gray-900 rounded-full flex items-center justify-center">
                <Server className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-gray-800">Server Mode</p>
                <p className="text-sm font-semibold text-gray-900">Local</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom Dark Section with Partners/Features */}
        <div className="absolute bottom-0 left-0 right-0 bg-gray-900 py-6">
          <div className="container mx-auto px-6">
            <div className="flex justify-center lg:justify-between items-center gap-8 flex-wrap opacity-50">
              <span className="text-gray-400 font-semibold">Plex</span>
              <span className="text-gray-400 font-semibold">Radarr</span>
              <span className="text-gray-400 font-semibold">Sonarr</span>
              <span className="text-gray-400 font-semibold hidden sm:block">Tautulli</span>
              <span className="text-gray-400 font-semibold hidden md:block">TMDB</span>
              <span className="text-gray-400 font-semibold hidden lg:block">Overseerr</span>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Access Section */}
      <section className="py-16 px-6 bg-background">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-8 flex items-center justify-between"
          >
            <h2 className="section-title">Quick Access</h2>
            <Link
              to="/setup"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              See All
              <ChevronRight className="w-4 h-4" />
            </Link>
          </motion.div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {quickAccess.map((item, index) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.to}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                >
                  <Link to={item.to} className="quick-card block group">
                    <div className="flex items-start justify-between mb-3">
                      <div className={cn('icon-container', item.iconBg)}>
                        <Icon className={cn('w-5 h-5', item.iconColor)} />
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.subtitle}</p>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Additional Sections */}
      <section className="py-16 px-6 bg-muted/30">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-8"
          >
            <h2 className="section-title">My Sections</h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
            >
              <Link to="/setup" className="stat-card block group hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
                    <Settings2 className="w-7 h-7 text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">Setup</h3>
                    <p className="text-sm text-muted-foreground">Configure integrations</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <Link to="/import" className="stat-card block group hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-500/15 flex items-center justify-center">
                    <FileUp className="w-7 h-7 text-slate-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">Import</h3>
                    <p className="text-sm text-muted-foreground">Import from config.yaml</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
