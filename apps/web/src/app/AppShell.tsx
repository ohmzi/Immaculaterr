import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, ChevronDown, LogOut, RotateCcw, Settings2, Moon, Sun } from 'lucide-react';
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
    <nav className="grid gap-4 p-2">
      {navSections.map((section) => (
        <div key={section.label} className="space-y-1">
          <div className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {section.label}
          </div>
          <div className="grid gap-1">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      isActive && 'bg-accent text-accent-foreground',
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
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
        <aside className="hidden w-72 shrink-0 border-r bg-card/30 backdrop-blur lg:flex lg:flex-col">
          <div className="flex h-14 items-center px-4">
            <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <div className="grid h-9 w-9 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                TC
              </div>
              <div className="leading-tight">
                <div>Tautulli Curated Plex</div>
                <div className="text-xs font-normal text-muted-foreground">Local dashboard</div>
              </div>
            </Link>
          </div>
          <Separator />
          <SidebarNav />
          <div className="mt-auto px-4 py-3 text-xs text-muted-foreground">
            Runs on your server. Access on LAN via <span className="font-mono">:5173</span> (dev).
          </div>
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-14 items-center gap-2 px-3 lg:px-6">
              {/* Mobile menu */}
              <div className="lg:hidden">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="Open navigation">
                      <Menu className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="p-0">
                    <div className="flex h-14 items-center px-4">
                      <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
                        <div className="grid h-9 w-9 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                          TC
                        </div>
                        <div className="leading-tight">
                          <div>Tautulli Curated Plex</div>
                          <div className="text-xs font-normal text-muted-foreground">
                            Local dashboard
                          </div>
                        </div>
                      </Link>
                    </div>
                    <Separator />
                    <SidebarNav />
                  </SheetContent>
                </Sheet>
              </div>

              <div className="flex items-center gap-2">
                <div className="font-semibold tracking-tight">{title}</div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => setWizardOpen(true)}
                  aria-label="Open setup wizard"
                >
                  <Settings2 className="h-4 w-4" />
                  Setup
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-1">
                      {meQuery.data?.user?.username ?? 'Admin'}
                      <ChevronDown className="h-4 w-4 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Account</DropdownMenuLabel>
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
                      Theme: {theme === 'dark' ? 'Dark' : 'Light'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => logoutMutation.mutate()}
                      disabled={logoutMutation.isPending}
                      className="gap-2"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </DropdownMenuItem>
                    {import.meta.env.DEV ? (
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
                          className="gap-2 text-destructive focus:text-destructive"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Reset (dev)
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <main className="container flex-1 py-6 pb-24 lg:pb-6">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation (app-like) */}
      <div className="fixed bottom-4 left-0 right-0 z-50 lg:hidden">
        <div className="mx-auto w-fit rounded-full border bg-background/75 p-1 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <nav className="flex items-center gap-1">
            {bottomNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-colors',
                      'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      isActive && 'bg-primary text-primary-foreground hover:bg-primary',
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
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


