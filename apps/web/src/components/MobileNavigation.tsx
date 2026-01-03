import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun, LogOut, ChevronDown } from 'lucide-react';

interface MobileNavigationProps {
  username: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
}

interface NavItem {
  label: string;
  dropdown?: { label: string; to: string }[];
}

const navItems: NavItem[] = [
  {
    label: 'Home',
    // No dropdown - just navigates to home
  },
  {
    label: 'Scheduler',
    dropdown: [
      { label: 'Jobs', to: '/jobs' },
      { label: 'Runs', to: '/runs' },
    ],
  },
  {
    label: 'Settings',
    dropdown: [
      { label: 'Collections', to: '/collections' },
      { label: 'Configuration', to: '/configuration' },
    ],
  },
];

export function MobileNavigation({ username, theme, onToggleTheme, onLogout }: MobileNavigationProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [buttonPositions, setButtonPositions] = useState<{ left: number; width: number }[]>([]);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const updatePositions = () => {
      const positions = buttonRefs.current.map((ref) => {
        if (ref) {
          const rect = ref.getBoundingClientRect();
          const parentRect = ref.parentElement?.getBoundingClientRect();
          return {
            left: rect.left - (parentRect?.left || 0),
            width: rect.width,
          };
        }
        return { left: 0, width: 0 };
      });
      setButtonPositions(positions);
    };

    updatePositions();
    window.addEventListener('resize', updatePositions);
    return () => window.removeEventListener('resize', updatePositions);
  }, []);

  const handleButtonClick = (index: number) => {
    // Home button (index 0) navigates to /app instead of showing dropdown
    if (index === 0) {
      navigate('/app');
      return;
    }

    if (selectedIndex === index) {
      setSelectedIndex(null);
    } else {
      setSelectedIndex(index);
    }
  };

  return (
    <>
      {/* Card that opens above navigation */}
      <AnimatePresence>
        {selectedIndex !== null && navItems[selectedIndex].dropdown && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="fixed bottom-28 left-4 right-4 z-40"
          >
            <div className="mx-auto max-w-md rounded-3xl border border-gray-200/50 bg-white/95 p-4 shadow-2xl backdrop-blur-2xl">
              <div className="grid grid-cols-2 gap-2">
                {navItems[selectedIndex].dropdown!.map((item, idx) => (
                  <motion.button
                    key={idx}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    className="rounded-2xl px-4 py-3 text-left text-sm font-medium text-gray-800 transition-all duration-200 hover:bg-gray-100"
                    onClick={() => {
                      setSelectedIndex(null);
                      navigate(item.to);
                    }}
                  >
                    {item.label}
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backdrop overlay */}
      <AnimatePresence>
        {selectedIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedIndex(null)}
            className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-6 pt-3">
        <div className="relative mx-auto max-w-md">
          {/* Main glassy container */}
          <div className="relative overflow-visible rounded-[2rem] border border-white/10 bg-gray-900/80 shadow-2xl backdrop-blur-2xl">
            {/* Animated selection indicator with bottleneck expansion */}
            <AnimatePresence>
              {selectedIndex !== null && buttonPositions[selectedIndex] && (
                <>
                  {/* Bottleneck expansion at top */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      x: buttonPositions[selectedIndex].left + buttonPositions[selectedIndex].width / 2,
                    }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{
                      duration: 0.4,
                      ease: [0.4, 0, 0.2, 1],
                    }}
                    className="absolute -top-3 left-0 z-10"
                    style={{ transformOrigin: 'bottom center' }}
                  >
                    <div className="relative" style={{ marginLeft: '-20px' }}>
                      {/* Curved expansion triangle */}
                      <svg width="40" height="12" viewBox="0 0 40 12" fill="none">
                        <path
                          d="M0 12 L20 0 L40 12 Z"
                          fill="rgba(17, 24, 39, 0.9)"
                          className="drop-shadow-lg"
                        />
                      </svg>
                    </div>
                  </motion.div>

                  {/* Selection indicator pill */}
                  <motion.div
                    layoutId="navIndicator"
                    initial={false}
                    animate={{
                      left: buttonPositions[selectedIndex].left,
                      width: buttonPositions[selectedIndex].width,
                    }}
                    transition={{
                      type: 'spring',
                      stiffness: 400,
                      damping: 30,
                    }}
                    className="absolute bottom-2 top-2 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm"
                    style={{ position: 'absolute' }}
                  />
                </>
              )}
            </AnimatePresence>

            {/* Navigation buttons */}
            <div className="relative flex items-center justify-around px-3 py-2">
              {navItems.map((item, index) => (
                <button
                  key={item.label}
                  ref={(el) => {
                    buttonRefs.current[index] = el;
                  }}
                  onClick={() => handleButtonClick(index)}
                  className="relative z-20 px-4 py-2.5 text-xs font-medium text-white/70 transition-colors duration-200 hover:text-white"
                >
                  <span className={selectedIndex === index ? 'text-white' : ''}>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* iPhone-style home indicator */}
          <div className="mt-2 flex justify-center">
            <div className="h-1 w-32 rounded-full bg-white/30" />
          </div>
        </div>
      </nav>

      {/* Top bar with logo and controls */}
      <div className="fixed left-0 right-0 top-0 z-50 bg-black/40 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          {/* Logo */}
          <button
            onClick={() => navigate('/')}
            className="flex flex-shrink-0 items-center gap-2 active:opacity-70 transition-opacity"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              {/* Screen/Monitor */}
              <rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="#facc15" strokeWidth="2" />
              <path d="M8 20h8M12 17v3" stroke="#facc15" strokeWidth="2" strokeLinecap="round" />
              {/* Magnifying Glass */}
              <circle cx="10" cy="10" r="3" fill="none" stroke="#facc15" strokeWidth="1.5" />
              <path d="M12.5 12.5L15 15" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="font-semibold tracking-tight text-white">Immaculaterr</span>
          </button>

          {/* Right side controls */}
          <div className="flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={onToggleTheme}
              className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white active:scale-95"
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            {/* User profile dropdown */}
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-white/80 transition-colors hover:bg-white/20 active:scale-95"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                {username[0]?.toUpperCase()}
              </div>
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* User menu dropdown */}
      <AnimatePresence>
        {showUserMenu && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUserMenu(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
            />

            {/* User menu card */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
              className="fixed top-16 right-4 z-50 lg:hidden"
            >
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-2 min-w-[200px]">
                <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="font-semibold text-gray-900 dark:text-white">{username}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Local Administrator</p>
                </div>

                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    onToggleTheme();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  Toggle Theme
                </button>

                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    onLogout();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <LogOut size={16} />
                  Sign Out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

