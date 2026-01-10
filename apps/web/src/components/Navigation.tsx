import { useState, useEffect, useRef } from 'react';
import { LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { logout, resetDev } from '@/api/auth';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getUpdates } from '@/api/updates';

interface NavItem {
  label: string;
  dropdown?: { label: string; to: string }[];
}

const navItems: NavItem[] = [
  {
    label: 'Overview',
    dropdown: [
      { label: 'Dashboard', to: '/' },
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
  }
];

export function Navigation() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [buttonPositions, setButtonPositions] = useState<{ left: number; width: number }[]>([]);
  const didToastUpdateRef = useRef(false);
  const helpRef = useRef<HTMLDivElement | null>(null);

  const updatesQuery = useQuery({
    queryKey: ['updates'],
    queryFn: getUpdates,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const updateAvailable =
    Boolean(updatesQuery.data?.updateAvailable) && Boolean(updatesQuery.data?.latestVersion);
  const updateLabel = updatesQuery.data?.latestVersion ? `v${updatesQuery.data.latestVersion}` : null;
  const currentLabel = updatesQuery.data?.currentVersion ? `v${updatesQuery.data.currentVersion}` : null;

  useEffect(() => {
    if (!updateAvailable || !updateLabel) return;

    // Only toast once per page-load session.
    if (didToastUpdateRef.current) return;
    didToastUpdateRef.current = true;

    toast.info(`${updateLabel} available`, {
      description: 'Update your Docker container to get the latest build (docker compose pull && docker compose up -d).',
    });
  }, [updateAvailable, updateLabel]);

  // Close Help when clicking/tapping anywhere outside of the Help button + dropdown.
  useEffect(() => {
    if (!isHelpOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = helpRef.current;
      const target = e.target as Node | null;
      if (!el || !target) return;
      if (!el.contains(target)) setIsHelpOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [isHelpOpen]);

  // Update button positions when they change
  useEffect(() => {
    const updatePositions = () => {
      const positions = buttonRefs.current.map((ref) => {
        if (ref) {
          const rect = ref.getBoundingClientRect();
          const parentRect = ref.parentElement?.parentElement?.getBoundingClientRect();
          return {
            left: rect.left - (parentRect?.left || 0),
            width: rect.width,
          };
        }
        return { left: 0, width: 0 };
      });
      setButtonPositions(positions);
    };

    // Initial update and on resize
    const timeoutId = setTimeout(updatePositions, 100);
    window.addEventListener('resize', updatePositions);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updatePositions);
    };
  }, []);

  // Update positions when hover changes
  useEffect(() => {
    if (hoveredIndex !== null) {
      const updatePositions = () => {
        const positions = buttonRefs.current.map((ref) => {
          if (ref) {
            const rect = ref.getBoundingClientRect();
            const parentRect = ref.parentElement?.parentElement?.getBoundingClientRect();
            return {
              left: rect.left - (parentRect?.left || 0),
              width: rect.width,
            };
          }
          return { left: 0, width: 0 };
        });
        setButtonPositions(positions);
      };
      const timeoutId = setTimeout(updatePositions, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [hoveredIndex]);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      // Backend has already invalidated session & cleared session cookie

      // Clear ALL React Query cache for safety
      queryClient.clear();

      // Clear all localStorage
      try {
        localStorage.clear();
      } catch (e) {
        console.error('Failed to clear localStorage:', e);
      }

      // Clear all sessionStorage
      try {
        sessionStorage.clear();
      } catch (e) {
        console.error('Failed to clear sessionStorage:', e);
      }

      // Navigate to home and reload to force user to log back in
      // This ensures all in-memory state is cleared
      navigate('/');
      window.location.reload();
    },
  });

  const handleLogout = () => {
    setIsHelpOpen(false);
    logoutMutation.mutate();
  };

  const handleResetAccount = async () => {
    setIsHelpOpen(false);
    setResetError(null);
    setResetOpen(true);
  };

  const resetMutation = useMutation({
    mutationFn: async () => {
      await resetDev();
    },
    onSuccess: () => {
      // Clear everything like logout
      queryClient.clear();
      try {
        localStorage.clear();
      } catch (e) {
        void e;
      }
      try {
        sessionStorage.clear();
      } catch (e) {
        void e;
      }
      window.location.href = '/';
    },
    onError: (err) => {
      setResetError(err instanceof Error ? err.message : String(err));
    },
  });

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden lg:flex fixed top-0 left-0 right-0 z-50 justify-center pt-8">
        {/* Curved Cutout Container */}
        <div className="relative">
          {/* Main dark glassy overlay with curved bottom */}
          <div className="relative px-12 pt-6 pb-12">
            {/* Backdrop blur overlay with smooth curved bottom */}
            <div className="absolute inset-0 bg-[#0b0c0f]/55 backdrop-blur-2xl shadow-2xl overflow-hidden border border-white/10"
                 style={{
                   borderRadius: '3rem 3rem 50% 50%'
                 }}
            />
            
            {/* Navigation content */}
            <div className="relative flex items-center gap-8">
              {/* Logo */}
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 mr-8 hover:opacity-80 active:opacity-70 transition-opacity cursor-pointer"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  {/* Screen/Monitor */}
                  <rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="#facc15" strokeWidth="2"/>
                  <path d="M8 20h8M12 17v3" stroke="#facc15" strokeWidth="2" strokeLinecap="round"/>
                  {/* Magnifying Glass */}
                  <circle cx="10" cy="10" r="3" fill="none" stroke="#facc15" strokeWidth="1.5"/>
                  <path d="M12.5 12.5L15 15" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span className="text-white text-lg font-semibold tracking-tight">Immaculaterr</span>
              </button>

              {/* Navigation Items */}
              <div className="relative flex items-center gap-1">
                {/* Sliding rectangle indicator - hover only */}
                {hoveredIndex !== null && 
                 buttonPositions.length > hoveredIndex && 
                 buttonPositions[hoveredIndex] && 
                 buttonPositions[hoveredIndex].width > 0 && (
                  <motion.div
                    layoutId="navIndicator"
                    initial={false}
                    animate={{
                      left: buttonPositions[hoveredIndex]?.left ?? 0,
                      width: buttonPositions[hoveredIndex]?.width ?? 0,
                    }}
                    transition={{
                      type: 'spring',
                      stiffness: 400,
                      damping: 30,
                    }}
                    className="absolute bottom-0 top-0 rounded-xl bg-white/20 backdrop-blur-sm pointer-events-none z-0"
                    style={{ position: 'absolute' }}
                  />
                )}

                {navItems.map((item, index) => (
                  <div
                    key={item.label}
                    className="relative"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <button
                      ref={(el) => {
                        buttonRefs.current[index] = el;
                      }}
                      className="relative px-5 py-2.5 text-sm text-white/90 hover:text-white active:text-white transition-all duration-300 rounded-2xl overflow-hidden group active:scale-[0.98]"
                    >
                      {/* Glassy button background */}
                      <div className="absolute inset-0 bg-white/8 backdrop-blur-sm opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-300 rounded-2xl border border-white/15" />
                      <span className="relative z-10">{item.label}</span>
                    </button>

                    {/* Dropdown Card */}
                    <AnimatePresence>
                      {hoveredIndex === index && item.dropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute top-full left-0 mt-2 min-w-[220px] rounded-2xl overflow-hidden shadow-2xl"
                        >
                          <div className="bg-[#0b0c0f]/70 backdrop-blur-2xl border border-white/10 p-2">
                            {item.dropdown.map((subItem, subIndex) => (
                              <button
                                key={subIndex}
                                className="w-full text-left px-4 py-3 text-sm text-white/90 rounded-xl transition-all duration-200 hover:bg-white/10 active:bg-white/12 active:scale-[0.99]"
                                onClick={() => {
                                  setHoveredIndex(null);
                                  navigate(subItem.to);
                                }}
                              >
                                {subItem.label}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>

              {/* Right side buttons */}
              <div className="flex items-center gap-3 ml-8 overflow-visible">
                <div
                  ref={helpRef}
                  className="relative pb-2"
                  onMouseLeave={() => setIsHelpOpen(false)}
                >
                  <button
                    onClick={() => setIsHelpOpen(!isHelpOpen)}
                    className="px-5 py-2.5 text-sm text-white bg-white/10 hover:bg-white/15 active:bg-white/20 active:scale-[0.98] backdrop-blur-sm rounded-full transition-all duration-300 border border-white/20"
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

                  {/* Help Card */}
                  <AnimatePresence>
                    {isHelpOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="absolute top-full right-0 mt-2 w-64 bg-[#0b0c0f]/75 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden z-50"
                      >
                        <div className="p-4 space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              setIsHelpOpen(false);
                              navigate('/faq');
                            }}
                            className="w-full px-4 py-2.5 text-left text-sm text-white/90 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all font-semibold border border-white/10 bg-white/5"
                          >
                            FAQ
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setIsHelpOpen(false);
                              navigate('/version-history');
                            }}
                            className="w-full px-4 py-2.5 text-left text-sm text-white/70 hover:text-white/90 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all font-mono border border-white/10 bg-white/5"
                          >
                            Version: {currentLabel ?? '—'}
                          </button>

                            {updateAvailable && updateLabel ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const url = updatesQuery.data?.latestUrl;
                                  if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                }}
                                className="w-full px-4 py-2.5 text-left text-sm text-[#facc15] hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all font-semibold border border-white/10 bg-white/5"
                              >
                                Update available {updateLabel}
                              </button>
                            ) : null}

                            <button
                              onClick={handleResetAccount}
                              disabled={logoutMutation.isPending || resetMutation.isPending}
                              className="w-full px-4 py-2.5 text-left text-sm text-white/70 hover:text-white/90 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all font-medium disabled:opacity-50"
                            >
                              Reset Account to Fresh Setup
                            </button>

                          <div className="mt-4 pt-4 border-t border-white/10">
                            <button
                              onClick={handleLogout}
                              disabled={logoutMutation.isPending}
                              className="w-full px-4 py-2.5 text-left text-sm text-red-300 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all flex items-center gap-2 font-medium disabled:opacity-50"
                            >
                              <LogOut size={16} />
                              {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => resetMutation.mutate()}
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
        confirming={resetMutation.isPending}
        error={resetError}
      />
    </>
  );
}