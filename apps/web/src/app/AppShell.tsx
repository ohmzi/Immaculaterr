import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, ChevronDown, LogOut, RotateCcw, Settings2, Moon, Sun, Sparkles } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { navItems, navSections } from '@/app/nav';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
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

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="grid gap-6 p-4">
      {navSections.map((section, sectionIndex) => (
        <div key={section.label} className="space-y-2">
          <div className="px-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {section.label}
          </div>
          <div className="grid gap-1">
            {section.items.map((item, itemIndex) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                      'transition-all duration-200',
                      'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      'hover:translate-x-1',
                      isActive && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                    )
                  }
                  style={{ animationDelay: `${sectionIndex * 50 + itemIndex * 30}ms` }}
                >
                  <Icon className="h-4 w-4 transition-transform group-hover:scale-110" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    const s = settingsQuery.data?.settings as any;
    return Boolean(s?.onboarding?.completed);
  }, [settingsQuery.data?.settings]);

  useEffect(() => {
    if (settingsQuery.isLoading || settingsQuery.error) return;
    if (!onboardingCompleted) setWizardOpen(true);
  }, [settingsQuery.isLoading, settingsQuery.error, onboardingCompleted]);

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

  const title = useMemo(() => {
    const path = location.pathname.replace(/\/+$/, '');
    const match = navItems.find((n) => (n.to === '/' ? path === '' || path === '/' : path.startsWith(n.to)));
    return match?.label ?? 'Dashboard';
  }, [location.pathname]);

  const bottomNavItems = useMemo(() => {
    const wanted = new Set(['/', '/connections', '/collections', '/jobs', '/runs']);
    return navItems.filter((n) => wanted.has(n.to));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 border-r border-border/50 bg-card/30 backdrop-blur-xl lg:flex lg:flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center px-6">
            <Link to="/" className="group flex items-center gap-3 font-semibold tracking-tight">
              <div className="relative">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 transition-transform group-hover:scale-105">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="absolute -inset-1 -z-10 rounded-xl bg-primary/20 blur-lg opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="leading-tight">
                <div className="font-bold">Tautulli Curated</div>
                <div className="text-xs font-normal text-muted-foreground">Plex Collection Manager</div>
              </div>
            </Link>
          </div>
          
          <Separator className="opacity-50" />
          
          <div className="flex-1 overflow-auto py-2">
            <SidebarNav />
          </div>
          
          <div className="border-t border-border/50 px-6 py-4">
            <div className="text-xs text-muted-foreground/70">
              Running locally • Port <span className="font-mono">5173</span>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center gap-4 px-4 lg:px-8">
              {/* Mobile menu trigger */}
              <div className="lg:hidden">
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Open navigation">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-72 p-0">
                    <div className="flex h-16 items-center px-6">
                      <Link 
                        to="/" 
                        className="flex items-center gap-3 font-semibold tracking-tight"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25">
                          <Sparkles className="h-5 w-5" />
                        </div>
                        <div className="leading-tight">
                          <div className="font-bold">Tautulli Curated</div>
                          <div className="text-xs font-normal text-muted-foreground">
                            Plex Collection Manager
                          </div>
                        </div>
                      </Link>
                    </div>
                    <Separator className="opacity-50" />
                    <SidebarNav onNavigate={() => setMobileMenuOpen(false)} />
                  </SheetContent>
                </Sheet>
              </div>

              {/* Page title */}
              <div className="flex-1">
                <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden gap-2 sm:flex"
                  onClick={() => setWizardOpen(true)}
                  aria-label="Open setup wizard"
                >
                  <Settings2 className="h-4 w-4" />
                  <span className="hidden md:inline">Setup</span>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                      <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                        {(meQuery.data?.user?.username ?? 'A')[0].toUpperCase()}
                      </div>
                      <span className="hidden sm:inline">{meQuery.data?.user?.username ?? 'Admin'}</span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium">{meQuery.data?.user?.username ?? 'Admin'}</p>
                        <p className="text-xs text-muted-foreground">Local administrator</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        const next: Theme = theme === 'dark' ? 'light' : 'dark';
                        setThemeState(next);
                        setTheme(next);
                      }}
                      className="gap-2"
                    >
                      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                      Switch to {theme === 'dark' ? 'Light' : 'Dark'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setWizardOpen(true)}
                      className="gap-2 sm:hidden"
                    >
                      <Settings2 className="h-4 w-4" />
                      Setup
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => logoutMutation.mutate()}
                      disabled={logoutMutation.isPending}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                    {import.meta.env.DEV && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            const ok = window.confirm(
                              'DEV RESET: This wipes the database (users, secrets, runs). Continue?',
                            );
                            if (!ok) return;
                            resetMutation.mutate();
                          }}
                          disabled={resetMutation.isPending}
                          className="gap-2 text-amber-600 focus:text-amber-600"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Reset Database (Dev)
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {/* Main content area */}
          <main className="flex-1 px-4 py-6 pb-28 lg:px-8 lg:py-8 lg:pb-8">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation - Floating pill style like CoLabs */}
      <div className="fixed bottom-6 left-4 right-4 z-50 lg:hidden">
        <nav className="mx-auto flex max-w-md items-center justify-around rounded-2xl border border-border/50 bg-card/90 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'group flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium',
                  'transition-all duration-200',
                  'text-muted-foreground hover:text-foreground',
                  isActive && 'bg-primary text-primary-foreground',
                )}
              >
                <Icon className={cn(
                  'h-5 w-5 transition-transform',
                  isActive ? 'scale-110' : 'group-hover:scale-110',
                )} />
                <span className={cn(
                  'transition-all',
                  isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
                )}>
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <SetupWizardModal
        open={wizardOpen || !onboardingCompleted}
        required={!onboardingCompleted}
        onClose={() => setWizardOpen(false)}
        onFinished={() => setWizardOpen(false)}
      />
    </div>
  );
}
