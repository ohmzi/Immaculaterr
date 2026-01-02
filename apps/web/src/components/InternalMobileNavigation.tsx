import { Link, useLocation } from 'react-router-dom';
import { History, Home, Layers, ListChecks, PlugZap } from 'lucide-react';

import { cn } from '@/lib/utils';

export function InternalMobileNavigation() {
  const location = useLocation();

  const mobileItems = [
    { to: '/app', icon: Home, label: 'Home' },
    { to: '/collections', icon: Layers, label: 'Library' },
    { to: '/jobs', icon: ListChecks, label: 'Jobs' },
    { to: '/runs', icon: History, label: 'Runs' },
    { to: '/connections', icon: PlugZap, label: 'Connect' },
  ] as const;

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  return (
    <nav className="fixed bottom-6 left-4 right-4 z-50 lg:hidden">
      <div className="mx-auto max-w-md rounded-full border border-white/10 bg-[#1a1a1c]/90 p-2 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-around">
          {mobileItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);

            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl px-4 py-2 transition-all duration-200',
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}


