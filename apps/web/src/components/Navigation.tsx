import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  Home,
  Settings2,
  PlugZap,
  Layers,
  ListChecks,
  History,
  FileUp,
  Moon,
  Sun,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
  dropdown?: { label: string; to: string }[];
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    to: '/',
    icon: Home,
  },
  {
    label: 'Setup',
    to: '/setup',
    icon: Settings2,
    dropdown: [
      { label: 'Connections', to: '/connections' },
      { label: 'Import YAML', to: '/import' },
    ],
  },
  {
    label: 'Collections',
    to: '/collections',
    icon: Layers,
  },
  {
    label: 'Jobs',
    to: '/jobs',
    icon: ListChecks,
    dropdown: [
      { label: 'Run History', to: '/runs' },
    ],
  },
];

interface NavigationProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  username: string;
}

export function Navigation({ theme, onToggleTheme, onLogout, username }: NavigationProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const location = useLocation();

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-6">
      {/* Curved container with clip-path */}
      <div className="relative">
        {/* Backdrop with curved bottom */}
        <div className="relative px-8 pt-5 pb-6">
          {/* Dark glassy background */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-xl shadow-2xl"
            style={{
              borderRadius: '3rem',
              clipPath: 'ellipse(95% 100% at 50% 0%)',
            }}
          />

          {/* Navigation content */}
          <div className="relative flex items-center gap-6">
            {/* Logo */}
            <NavLink to="/" className="flex items-center gap-2 mr-6">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path 
                    d="M13 2L3 14h8l-2 8 10-12h-8l2-8z" 
                    fill="currentColor" 
                    className="text-primary-foreground"
                  />
                </svg>
              </div>
              <span className="text-white text-lg font-semibold tracking-tight">
                Tautulli
              </span>
            </NavLink>

            {/* Navigation Items */}
            <div className="flex items-center gap-1">
              {navItems.map((item, index) => {
                const Icon = item.icon;
                const active = isActive(item.to);

                return (
                  <div
                    key={item.label}
                    className="relative"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <NavLink
                      to={item.to}
                      className={cn(
                        'nav-btn flex items-center gap-2 text-sm',
                        active && 'text-white'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                      {item.dropdown && (
                        <ChevronDown className="w-3 h-3 opacity-50" />
                      )}
                    </NavLink>

                    {/* Dropdown */}
                    <AnimatePresence>
                      {hoveredIndex === index && item.dropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute top-full left-0 mt-2 min-w-[180px] overflow-hidden z-50"
                        >
                          <div className="glass-light p-2">
                            {item.dropdown.map((subItem) => (
                              <NavLink
                                key={subItem.to}
                                to={subItem.to}
                                className={cn(
                                  'block w-full text-left px-4 py-2.5 text-sm rounded-lg transition-colors',
                                  'text-gray-800 hover:bg-gray-100',
                                  isActive(subItem.to) && 'bg-gray-100 font-medium'
                                )}
                              >
                                {subItem.label}
                              </NavLink>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Right side buttons */}
            <div className="flex items-center gap-2 ml-6">
              <button className="p-2.5 text-white/80 hover:text-white transition-colors rounded-full hover:bg-white/10">
                <Search className="w-5 h-5" />
              </button>
              <button
                onClick={onToggleTheme}
                className="p-2.5 text-white/80 hover:text-white transition-colors rounded-full hover:bg-white/10"
              >
                {theme === 'dark' ? (
                  <Sun className="w-5 h-5" />
                ) : (
                  <Moon className="w-5 h-5" />
                )}
              </button>
              <button
                onClick={onLogout}
                className="px-4 py-2 text-sm text-white bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full transition-all border border-white/20"
              >
                {username}
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

// Mobile bottom navigation
export function MobileNavigation() {
  const location = useLocation();

  const mobileItems = [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/connections', icon: PlugZap, label: 'Connect' },
    { to: '/collections', icon: Layers, label: 'Library' },
    { to: '/jobs', icon: ListChecks, label: 'Jobs' },
    { to: '/runs', icon: History, label: 'Runs' },
  ];

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  return (
    <nav className="nav-pill-mobile lg:hidden">
      <div className="flex items-center justify-around">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl',
                'text-xs font-medium transition-all duration-200',
                active
                  ? 'nav-item-active'
                  : 'text-white/60 hover:text-white/90',
              )}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

