import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Menu,
  X,
  ChevronDown,
  LogOut,
  RotateCcw,
  Moon,
  Sun,
  Home,
  Settings2,
  PlugZap,
  Layers,
  ListChecks,
  History,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getMe, logout, resetDev } from '@/api/auth';
import { getPublicSettings } from '@/api/settings';
import { SetupWizardModal } from '@/app/SetupWizardModal';
import { getInitialTheme, setTheme, type Theme } from '@/app/theme';

// Mobile bottom nav items
const mobileNavItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/connections', icon: PlugZap, label: 'Connect' },
  { to: '/collections', icon: Layers, label: 'Collections' },
  { to: '/jobs', icon: ListChecks, label: 'Jobs' },
  { to: '/runs', icon: History, label: 'Runs' },
];

// Full nav for sidebar/mobile menu
const navItems = [
  { to: '/', icon: Home, label: 'Dashboard' },
  { to: '/setup', icon: Settings2, label: 'Setup' },
  { to: '/connections', icon: PlugZap, label: 'Connections' },
  { to: '/collections', icon: Layers, label: 'Collections' },
  { to: '/jobs', icon: ListChecks, label: 'Jobs' },
  { to: '/runs', icon: History, label: 'Runs' },
];

export function AppShell() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMe,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const onboardingCompleted = useMemo(() => {
    const s = settingsQuery.data?.settings;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    const onboarding = (s as Record<string, unknown>)['onboarding'];
    if (!onboarding || typeof onboarding !== 'object' || Array.isArray(onboarding)) return false;
    return Boolean((onboarding as Record<string, unknown>)['completed']);
  }, [settingsQuery.data?.settings]);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      queryClient.removeQueries({ queryKey: ['settings'] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: resetDev,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      queryClient.removeQueries();
      window.location.reload();
    },
  });

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    setTheme(next);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Header - Minimal, floating style */}
      <header className="fixed left-0 right-0 top-0 z-50">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <nav
            className={cn(
              'flex items-center justify-between rounded-2xl px-4 py-3',
              'border bg-background/80 backdrop-blur-xl',
              'shadow-lg shadow-black/5 dark:shadow-black/20',
            )}
          >
            {/* Logo */}
            <Link
              to="/"
              className="group flex items-center gap-3 font-bold tracking-tight"
            >
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl',
                  'bg-gradient-to-br from-primary to-primary/80',
                  'text-primary-foreground shadow-md shadow-primary/25',
                  'transition-transform group-hover:scale-105',
                )}
              >
                TC
              </div>
              <span className="hidden text-lg sm:inline">Tautulli Curated</span>
            </Link>

            {/* Desktop Nav - Hidden on mobile */}
            <div className="hidden items-center gap-1 lg:flex">
              {navItems.slice(0, 5).map((item) => {
                const isActive =
                  item.to === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'rounded-xl px-4 py-2 text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </NavLink>
                );
              })}
            </div>

            {/* Right side actions */}
            <div className="flex items-center gap-2">
              {/* Theme toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="rounded-xl"
              >
                {theme === 'dark' ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </Button>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 rounded-xl">
                    <div
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg',
                        'bg-primary/10 text-sm font-bold text-primary',
                      )}
                    >
                      {(meQuery.data?.user?.username ?? 'A')[0].toUpperCase()}
                    </div>
                    <ChevronDown className="hidden h-4 w-4 opacity-50 sm:inline" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-xl">
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span className="font-semibold">
                        {meQuery.data?.user?.username ?? 'Admin'}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Local Administrator
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setWizardOpen(true)} className="gap-2">
                    <Settings2 className="h-4 w-4" />
                    Setup Wizard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleTheme} className="gap-2">
                    {theme === 'dark' ? (
                      <Sun className="h-4 w-4" />
                    ) : (
                      <Moon className="h-4 w-4" />
                    )}
                    {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                  {import.meta.env.DEV && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          if (
                            window.confirm(
                              'DEV: This wipes the database. Continue?',
                            )
                          ) {
                            resetMutation.mutate();
                          }
                        }}
                        disabled={resetMutation.isPending}
                        className="gap-2 text-amber-600"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reset (Dev)
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Mobile menu button */}
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl lg:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </Button>
            </div>
          </nav>
        </div>
      </header>

      {/* Mobile Full-Screen Menu */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-background/95 backdrop-blur-xl transition-all duration-300 lg:hidden',
          mobileMenuOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none',
        )}
      >
        <nav className="flex h-full flex-col items-center justify-center gap-4 p-8">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex w-full max-w-sm items-center gap-4 rounded-2xl px-6 py-4',
                  'text-xl font-semibold transition-all',
                  'border',
                  isActive
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-transparent hover:border-border hover:bg-accent',
                )}
                style={{
                  animationDelay: `${index * 50}ms`,
                }}
              >
                <Icon className="h-6 w-6" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <main className="min-h-screen pt-24 pb-24 lg:pb-8">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation - Floating pill */}
      <nav
        className={cn(
          'fixed bottom-6 left-4 right-4 z-50 lg:hidden',
          mobileMenuOpen && 'opacity-0 pointer-events-none',
        )}
      >
        <div
          className={cn(
            'mx-auto flex max-w-md items-center justify-around',
            'rounded-2xl border bg-background/90 p-2 backdrop-blur-xl',
            'shadow-xl shadow-black/10 dark:shadow-black/30',
          )}
        >
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl px-3 py-2',
                  'text-xs font-medium transition-all',
                  isActive
                    ? 'bg-primary text-primary-foreground scale-105'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className={cn('h-5 w-5', isActive && 'animate-pulse')} />
                <span className={cn(!isActive && 'opacity-70')}>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <SetupWizardModal
        open={wizardOpen || !onboardingCompleted}
        required={!onboardingCompleted}
        onClose={() => setWizardOpen(false)}
        onFinished={() => setWizardOpen(false)}
      />
    </div>
  );
}
