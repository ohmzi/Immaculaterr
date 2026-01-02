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
  Bell,
  Plus,
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

// Mobile bottom nav items - 5 max for clean pill design
const mobileNavItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/connections', icon: PlugZap, label: 'Connect' },
  { to: '/collections', icon: Layers, label: 'Library' },
  { to: '/jobs', icon: ListChecks, label: 'Jobs' },
  { to: '/runs', icon: History, label: 'Runs' },
];

// Full nav for desktop/menu
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

  const username = meQuery.data?.user?.username ?? 'User';

  return (
    <div className="min-h-screen bg-background">
      {/* Background orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* Mobile Header - Greeting style like reference */}
      <header className="fixed left-0 right-0 top-0 z-40 lg:hidden">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            {/* User greeting */}
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-full',
                  'bg-gradient-to-br from-primary to-primary/70',
                  'text-lg font-bold text-white shadow-lg shadow-primary/30',
                )}
              >
                {username[0].toUpperCase()}
              </div>
              <div>
                <p className="text-lg font-semibold">Hi {username} 👋</p>
                <p className="text-sm text-muted-foreground">Welcome back</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-full glass"
              >
                <Plus className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-full glass"
              >
                <Bell className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Desktop Header */}
      <header className="fixed left-0 right-0 top-0 z-40 hidden lg:block">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <nav
            className={cn(
              'flex items-center justify-between rounded-2xl px-5 py-3',
              'glass-strong shadow-xl shadow-black/10',
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
                  'bg-gradient-to-br from-primary to-primary/70',
                  'text-sm font-bold text-white shadow-md shadow-primary/25',
                  'transition-transform group-hover:scale-105',
                )}
              >
                TC
              </div>
              <span className="text-lg font-semibold">Tautulli Curated</span>
            </Link>

            {/* Desktop Nav Links */}
            <div className="flex items-center gap-1">
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
                      'rounded-xl px-4 py-2.5 text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary text-white shadow-md shadow-primary/30'
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
                className="h-10 w-10 rounded-xl"
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
                  <Button variant="ghost" size="sm" className="gap-2 rounded-xl pl-2 pr-3">
                    <div
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg',
                        'bg-gradient-to-br from-primary to-primary/70',
                        'text-sm font-bold text-white',
                      )}
                    >
                      {username[0].toUpperCase()}
                    </div>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-xl">
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span className="font-semibold">{username}</span>
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
            </div>
          </nav>
        </div>
      </header>

      {/* Mobile Full-Screen Menu */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-background/98 backdrop-blur-xl transition-all duration-300 lg:hidden',
          mobileMenuOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none',
        )}
      >
        {/* Close button */}
        <div className="absolute right-4 top-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-full glass"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X className="h-6 w-6" />
          </Button>
        </div>

        <nav className="flex h-full flex-col items-center justify-center gap-3 p-8">
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
                  'text-lg font-semibold transition-all',
                  'card-reveal',
                  isActive
                    ? 'bg-primary text-white shadow-lg shadow-primary/30'
                    : 'glass hover:bg-accent',
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-xl',
                    isActive ? 'bg-white/20' : 'bg-primary/10',
                  )}
                >
                  <Icon className={cn('h-6 w-6', isActive ? 'text-white' : 'text-primary')} />
                </div>
                {item.label}
              </NavLink>
            );
          })}

          {/* Theme toggle in menu */}
          <button
            onClick={toggleTheme}
            className={cn(
              'flex w-full max-w-sm items-center gap-4 rounded-2xl px-6 py-4',
              'text-lg font-semibold glass hover:bg-accent transition-all',
              'card-reveal',
            )}
            style={{ animationDelay: `${navItems.length * 50}ms` }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
              {theme === 'dark' ? (
                <Sun className="h-6 w-6 text-amber-500" />
              ) : (
                <Moon className="h-6 w-6 text-amber-500" />
              )}
            </div>
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>

          {/* Sign out */}
          <button
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className={cn(
              'flex w-full max-w-sm items-center gap-4 rounded-2xl px-6 py-4',
              'text-lg font-semibold glass hover:bg-destructive/10 transition-all',
              'card-reveal',
            )}
            style={{ animationDelay: `${(navItems.length + 1) * 50}ms` }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
              <LogOut className="h-6 w-6 text-destructive" />
            </div>
            Sign Out
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <main className="relative z-10 min-h-screen pt-20 pb-28 lg:pt-24 lg:pb-8">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation - Floating Pill (exactly like reference) */}
      <nav
        className={cn(
          'nav-pill lg:hidden',
          'transition-all duration-300',
          mobileMenuOpen && 'opacity-0 pointer-events-none translate-y-4',
        )}
      >
        <div className="flex items-center justify-around">
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
                  'flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl',
                  'text-xs font-medium transition-all duration-200',
                  isActive
                    ? 'nav-item-active'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-5 w-5" />
                <span className={cn(isActive ? 'text-white' : 'opacity-80')}>
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </div>

        {/* Menu button integrated in nav */}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={cn(
            'absolute -top-14 right-4',
            'flex h-12 w-12 items-center justify-center rounded-full',
            'glass shadow-xl',
            'transition-all hover:scale-105',
          )}
        >
          <Menu className="h-5 w-5" />
        </button>
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
