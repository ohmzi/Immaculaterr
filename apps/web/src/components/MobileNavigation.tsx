import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Search } from 'lucide-react';

interface MobileNavigationProps {
  onLogout: () => void;
}

interface NavItem {
  label: string;
  dropdown?: { label: string; to: string }[];
}

const navItems: NavItem[] = [
  {
    label: 'Overview',
    dropdown: [
      { label: 'Dashboard', to: '/' },
      { label: 'Collections', to: '/collections' },
      { label: 'Jobs', to: '/jobs' },
      { label: 'Runs', to: '/runs' },
    ],
  },
  {
    label: 'Settings',
    dropdown: [
      { label: 'Configuration', to: '/configuration' },
    ],
  },
  {
    label: 'Scheduler',
    dropdown: [
      { label: 'Jobs', to: '/jobs' },
      { label: 'Runs', to: '/runs' },
    ],
  },
];

export function MobileNavigation({ onLogout }: MobileNavigationProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
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
    setIsHelpOpen(false);
    setIsSearchOpen(false);
    if (selectedIndex === index) {
      setSelectedIndex(null);
    } else {
      setSelectedIndex(index);
    }
  };

  const handleResetAccount = async () => {
    setIsHelpOpen(false);
    if (
      !confirm(
        'Are you sure you want to reset your account? This will:\n\n• Delete all settings and configurations\n• Delete all secrets (API keys)\n• Force you through setup wizard again\n• Log you out\n\nThis action CANNOT be undone!',
      )
    ) {
      return;
    }

    try {
      const response = await fetch('/api/auth/reset-dev', {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        try {
          localStorage.clear();
        } catch {
          // ignore
        }
        try {
          sessionStorage.clear();
        } catch {
          // ignore
        }
        window.location.href = '/';
      } else {
        alert('Failed to reset account. Please try logging out and back in.');
      }
    } catch {
      alert('Network error while resetting account.');
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
            <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-[#0b0c0f]/75 p-4 shadow-2xl backdrop-blur-2xl">
              <div className="grid grid-cols-2 gap-2">
                {navItems[selectedIndex].dropdown!.map((item, idx) => (
                  <motion.button
                    key={idx}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    className="rounded-2xl px-4 py-3 text-left text-sm font-medium text-white/90 transition-all duration-200 hover:bg-white/10 active:scale-[0.99]"
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
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Logo */}
          <button
            onClick={() => navigate('/')}
            className="flex min-w-0 items-center gap-2 active:opacity-70 transition-opacity"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              {/* Screen/Monitor */}
              <rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="#facc15" strokeWidth="2" />
              <path d="M8 20h8M12 17v3" stroke="#facc15" strokeWidth="2" strokeLinecap="round" />
              {/* Magnifying Glass */}
              <circle cx="10" cy="10" r="3" fill="none" stroke="#facc15" strokeWidth="1.5" />
              <path d="M12.5 12.5L15 15" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span
              className={`${isSearchOpen ? 'hidden' : 'inline'} max-w-[150px] truncate text-lg font-semibold tracking-tight text-white sm:max-w-none`}
            >
              Immaculaterr
            </span>
          </button>

          {/* Right side controls */}
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
            {/* Search (icon -> expands into full bar) */}
            <div className="relative flex min-w-0 flex-1 items-center justify-end overflow-visible">
              <AnimatePresence>
                {isSearchOpen && (
                  <motion.div
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: '100%', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="min-w-0 overflow-hidden"
                  >
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/60" />
                      <input
                        type="text"
                        placeholder="Search…"
                        autoFocus
                        onBlur={() => setIsSearchOpen(false)}
                        className="h-9 w-full rounded-full border border-white/20 bg-white/10 pl-9 pr-3 text-sm text-white placeholder-white/60 backdrop-blur-sm outline-none transition-colors focus:border-white/40"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!isSearchOpen && (
                <button
                  onClick={() => {
                    setSelectedIndex(null);
                    setIsHelpOpen(false);
                    setIsSearchOpen(true);
                  }}
                  className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white active:scale-95"
                  aria-label="Search"
                >
                  <Search size={20} />
                </button>
              )}
            </div>

            {/* Help button (matches desktop top bar) */}
            <button
              onClick={() => {
                setSelectedIndex(null);
                setIsSearchOpen(false);
                setIsHelpOpen((v) => !v);
              }}
              className="px-4 py-2 text-sm text-white bg-white/10 hover:bg-white/15 backdrop-blur-sm rounded-full transition-all duration-300 border border-white/20 active:scale-95"
            >
              Help
            </button>
          </div>
        </div>
      </div>

      {/* Help dropdown (mobile) */}
      <AnimatePresence>
        {isHelpOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHelpOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 lg:hidden"
            />

            {/* Help card */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
              className="fixed top-16 left-4 right-4 z-[60] lg:hidden"
            >
              <div className="ml-auto w-full max-w-sm bg-[#0b0c0f]/75 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
                <div className="p-4">
                  <h3 className="text-lg font-semibold text-white mb-2">Help & Support</h3>
                  <p className="text-sm text-white/70 mb-4">
                    Need assistance? Visit our documentation or contact support.
                  </p>

                  <div className="space-y-2">
                    <button
                      onClick={handleResetAccount}
                      className="w-full px-4 py-2.5 text-left text-sm text-orange-300 hover:bg-white/10 rounded-xl transition-colors font-medium"
                    >
                      Reset Account to Fresh Setup
                    </button>
                  </div>

                  <div className="mt-4 pt-4 border-t border-white/10">
                    <button
                      onClick={() => {
                        setIsHelpOpen(false);
                        onLogout();
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm text-red-300 hover:bg-white/10 rounded-xl transition-colors flex items-center gap-2 font-medium"
                    >
                      <LogOut size={16} />
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

