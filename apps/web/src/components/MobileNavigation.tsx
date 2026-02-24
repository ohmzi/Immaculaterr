import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LogOut } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { resetDev } from '@/api/auth';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getUpdates } from '@/api/updates';
import { useSafeNavigate } from '@/lib/navigation';
import { createDebuggerUrl } from '@/lib/debugger';
import { clearClientUserData } from '@/lib/security/clearClientUserData';

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
        { label: 'Observatory', to: '/observatory' },
      ],
  },
  {
    label: 'Settings',
    dropdown: [
      { label: 'Command Center', to: '/command-center' },
      { label: 'Vault', to: '/vault' },
    ],
  },
  {
    label: 'Scheduler',
    dropdown: [
      { label: 'Task Manager', to: '/task-manager' },
      { label: 'Rewind', to: '/rewind' },
      { label: 'Logs', to: '/logs' },
    ],
  },
];

export function MobileNavigation({ onLogout }: MobileNavigationProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [buttonPositions, setButtonPositions] = useState<{ left: number; width: number }[]>([]);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const debugLongPressTimeoutRef = useRef<number | null>(null);
  const debugLongPressTriggeredRef = useRef(false);
  const navigate = useSafeNavigate();

  const go = (to: string) => {
    const dest = (to ?? '').trim();
    if (!dest) return;

    // iOS "Add to Home Screen" / standalone PWAs can have flaky SPA navigation,
    // especially after visiting heavy animated/backdrop-filter pages (Observatory).
    // Prefer a hard navigation there to guarantee leaving the current view.
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      Boolean((navigator as unknown as { standalone?: boolean } | undefined)?.standalone);
    if (isStandalone) {
      window.location.assign(dest);
      return;
    }

    // Prefer SPA navigation with a safety fallback handled by useSafeNavigate.
    navigate(dest);
  };

  const updatesQuery = useQuery({
    queryKey: ['updates'],
    queryFn: getUpdates,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: 1,
  });

  const updateAvailable =
    Boolean(updatesQuery.data?.updateAvailable) && Boolean(updatesQuery.data?.latestVersion);
  const updateLabel = updatesQuery.data?.latestVersion ? `v${updatesQuery.data.latestVersion}` : null;
  const currentLabel = updatesQuery.data?.currentVersion ? `v${updatesQuery.data.currentVersion}` : null;

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
    if (selectedIndex === index) {
      setSelectedIndex(null);
    } else {
      setSelectedIndex(index);
    }
  };

  const doResetAccount = async () => {
    if (resetting) return;
    setResetError(null);
    setResetting(true);
    try {
      await resetDev();
      await clearClientUserData();
      window.location.href = '/';
    } catch {
      setResetError('Network error while resetting account.');
    } finally {
      setResetting(false);
    }
  };

  const clearDebugLongPress = () => {
    const t = debugLongPressTimeoutRef.current;
    if (t !== null) window.clearTimeout(t);
    debugLongPressTimeoutRef.current = null;
  };

  const openDebugger = () => {
    setIsHelpOpen(false);
    const url = createDebuggerUrl();
    go(url);
  };

  const startDebugLongPress = (pointerType: string) => {
    if (pointerType !== 'touch') return;
    clearDebugLongPress();
    debugLongPressTriggeredRef.current = false;
    debugLongPressTimeoutRef.current = window.setTimeout(() => {
      debugLongPressTriggeredRef.current = true;
      openDebugger();
    }, 1100);
  };

  useEffect(() => {
    return () => {
      clearDebugLongPress();
    };
  }, []);

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
            // Very high z-index so Dashboard hero visuals (charts/tooltips) can't steal taps on mobile.
            className="fixed bottom-28 left-4 right-4 z-[1001]"
          >
            <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-[#0b0c0f]/70 p-4 shadow-2xl backdrop-blur-2xl">
              <div className="grid grid-cols-2 gap-2">
                {navItems[selectedIndex].dropdown!.map((item, idx) => (
                  <button
                    key={idx}
                    className="rounded-2xl px-4 py-3 text-left text-sm font-medium text-white/90 transition-all duration-200 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] touch-manipulation"
                    onClick={() => {
                      setSelectedIndex(null);
                      go(item.to);
                    }}
                  >
                    {item.label}
                  </button>
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
            className="fixed inset-0 z-[1000] bg-black/20 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-[1002] px-4 pb-6 pt-3">
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
                    // IMPORTANT: Keep layoutId unique vs desktop Navigation to avoid Motion shared-layout collisions
                    // (both components are mounted at the same time; one is only CSS-hidden).
                    layoutId="navIndicatorMobile"
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
            <div className="relative flex items-center justify-around px-3 py-2.5">
              {navItems.map((item, index) => (
                <button
                  key={item.label}
                  ref={(el) => {
                    buttonRefs.current[index] = el;
                  }}
                  onClick={() => handleButtonClick(index)}
                  className="relative z-20 rounded-full px-4 py-2.5 text-xs font-medium text-white/70 transition-all duration-200 hover:text-white active:bg-white/10 active:text-white active:scale-[0.98] touch-manipulation"
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
      <div className="fixed left-0 right-0 top-0 z-[1002] bg-black/40 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Logo */}
          <button
            onClick={() => go('/')}
            className="flex min-w-0 items-center gap-2 active:opacity-70 transition-opacity touch-manipulation"
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
              className="inline max-w-[150px] truncate text-lg font-semibold tracking-tight text-white sm:max-w-none"
            >
              Immaculaterr
            </span>
          </button>

          {/* Right side controls */}
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
            {/* Help button (matches desktop top bar) */}
            <button
              onClick={() => {
                setSelectedIndex(null);
                setIsHelpOpen((v) => {
                  const next = !v;
                  if (next) void updatesQuery.refetch();
                  return next;
                });
              }}
              className="px-4 py-2 text-sm text-white bg-white/10 hover:bg-white/15 active:bg-white/20 backdrop-blur-sm rounded-full transition-all duration-300 border border-white/20 active:scale-95 touch-manipulation"
            >
              <span className="inline-flex items-center gap-2">
                Help
                {updateAvailable ? (
                  <span
                    aria-label="Update available"
                    className="h-2 w-2 rounded-full bg-[#facc15] shadow-[0_0_12px_rgba(250,204,21,0.55)]"
                  />
                ) : null}
              </span>
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
                  <button
                    type="button"
                    onClick={() => {
                      setIsHelpOpen(false);
                      go('/faq');
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-white/90 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all font-semibold border border-white/10 bg-white/5"
                  >
                    FAQ
                  </button>

                  <div className="mt-2 space-y-2">
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        startDebugLongPress(e.pointerType);
                      }}
                      onPointerUp={() => clearDebugLongPress()}
                      onPointerLeave={() => clearDebugLongPress()}
                      onPointerCancel={() => clearDebugLongPress()}
                      onClick={(event) => {
                        if (debugLongPressTriggeredRef.current) {
                          debugLongPressTriggeredRef.current = false;
                          return;
                        }
                        if (event.altKey || event.shiftKey || event.metaKey) {
                          openDebugger();
                          return;
                        }
                        setIsHelpOpen(false);
                        go('/version-history');
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm text-white/70 hover:text-white/90 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all font-mono border border-white/10 bg-white/5 touch-manipulation"
                    >
                      Version: {currentLabel ?? '—'}
                    </button>

                    {updateAvailable && updateLabel ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsHelpOpen(false);
                          const url = updatesQuery.data?.latestUrl;
                          if (url) window.open(url, '_blank', 'noopener,noreferrer');
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-[#facc15] hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all font-semibold border border-white/10 bg-white/5"
                      >
                        Update available {updateLabel}
                      </button>
                    ) : null}

                    <button
                      onClick={() => {
                        setIsHelpOpen(false);
                        setResetError(null);
                        setResetOpen(true);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm text-rose-100/80 hover:text-rose-100 hover:bg-rose-500/10 active:bg-rose-500/15 active:scale-[0.99] rounded-xl transition-all font-medium border border-white/10 bg-rose-500/5"
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
                      className="w-full px-4 py-2.5 text-left text-sm text-red-300 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all flex items-center gap-2 font-medium"
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

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => void doResetAccount()}
        label="Reset"
        title="Reset account?"
        description={
          <div className="space-y-2">
            <div>This will:</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Delete all settings and setup data</li>
              <li>Delete all secrets (API keys)</li>
              <li>Force you through setup wizard again</li>
              <li>Log you out</li>
            </ul>
            <div className="text-xs text-white/55">This action cannot be undone.</div>
          </div>
        }
        confirmText="Reset account"
        cancelText="Cancel"
        variant="danger"
        confirming={resetting}
        error={resetError}
      />
    </>
  );
}
