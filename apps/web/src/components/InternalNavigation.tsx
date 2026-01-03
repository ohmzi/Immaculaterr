import { Link, NavLink } from 'react-router-dom';
import {
  ChevronDown,
  LogOut,
  Moon,
  Sun,
  Home,
  Settings2,
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
  { to: '/app', icon: Home, label: 'Home' },
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
            to="/app"
            className="group flex items-center gap-3 font-bold tracking-tight"
          >
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-xl',
                'bg-yellow-400 dark:bg-yellow-500 text-gray-900 dark:text-white shadow-md shadow-yellow-400/25',
                'transition-transform group-hover:scale-105',
              )}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2"/>
                <path d="M8 20h8M12 17v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="10" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12.5 12.5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-xl font-semibold">Immaculaterr</span>
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

            {/* Scheduler Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all flex items-center gap-1">
                  Scheduler
                  <ChevronDown className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/jobs" className="cursor-pointer">
                    <ListChecks className="mr-2 h-4 w-4" />
                    Jobs
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/runs" className="cursor-pointer">
                    <History className="mr-2 h-4 w-4" />
                    Runs
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Settings Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all flex items-center gap-1">
                  Settings
                  <ChevronDown className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/collections" className="cursor-pointer">
                    <Layers className="mr-2 h-4 w-4" />
                    Collections
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/configuration" className="cursor-pointer">
                    <Settings2 className="mr-2 h-4 w-4" />
                    Configuration
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

