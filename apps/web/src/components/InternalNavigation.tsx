import { Link, NavLink } from 'react-router-dom';
import {
  ChevronDown,
  LogOut,
  Moon,
  Sun,
  Home,
  Settings2,
  PlugZap,
  Layers,
  ListChecks,
  History,
} from 'lucide-react';
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

interface InternalNavigationProps {
  username: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
}

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/collections', icon: Layers, label: 'Collections' },
  { to: '/jobs', icon: ListChecks, label: 'Jobs' },
  { to: '/runs', icon: History, label: 'Runs' },
  { to: '/connections', icon: PlugZap, label: 'Connections' },
  { to: '/setup', icon: Settings2, label: 'Setup' },
];

export function InternalNavigation({ 
  username, 
  theme, 
  onToggleTheme, 
  onLogout 
}: InternalNavigationProps) {
  return (
    <header className="fixed left-0 right-0 top-0 z-40 hidden lg:block">
      <div className="mx-auto max-w-7xl px-6 py-4">
        <nav
          className={cn(
            'flex items-center justify-between rounded-2xl px-5 py-3',
            'bg-background/80 backdrop-blur-xl border border-border/50',
            'shadow-sm',
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
                'bg-primary text-primary-foreground shadow-md shadow-primary/25',
                'transition-transform group-hover:scale-105',
              )}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M13 2L3 14h8l-2 8 10-12h-8l2-8z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-lg font-semibold">Tautulli Curated</span>
          </Link>

          {/* Nav Links */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn(
                  'rounded-xl px-4 py-2.5 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleTheme}
              className="h-10 w-10 rounded-xl"
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 rounded-xl pl-2 pr-3">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg',
                      'bg-primary/10 text-sm font-bold text-primary',
                    )}
                  >
                    {username[0]?.toUpperCase()}
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
                <DropdownMenuItem onClick={onToggleTheme} className="gap-2">
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  Toggle Theme
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onLogout}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
      </div>
    </header>
  );
}

