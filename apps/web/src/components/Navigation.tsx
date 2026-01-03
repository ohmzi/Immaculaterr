import { useState } from 'react';
import { Search, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logout } from '@/api/auth';

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
      { label: 'History', to: '/history' },
      { label: 'Logs', to: '/logs' },
    ],
  }
];

export function Navigation() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
    if (!confirm('Are you sure you want to reset your account? This will:\n\n• Delete all settings and configurations\n• Delete all secrets (API keys)\n• Force you through setup wizard again\n• Log you out\n\nThis action CANNOT be undone!')) {
      return;
    }

    try {
      const response = await fetch('/api/auth/reset-dev', {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        // Clear everything like logout
        queryClient.clear();
        try { localStorage.clear(); } catch (e) {}
        try { sessionStorage.clear(); } catch (e) {}

        // Reload to force fresh state
        window.location.href = '/';
      } else {
        alert('Failed to reset account. Please try logging out and back in.');
      }
    } catch (error) {
      alert('Network error while resetting account.');
    }
  };

  return (
    <>
      {/* Search backdrop - closes search when clicked */}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSearchOpen(false)}
            className="fixed inset-0 z-40"
          />
        )}
      </AnimatePresence>

      {/* Help backdrop - closes help when clicked */}
      <AnimatePresence>
        {isHelpOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsHelpOpen(false)}
            className="fixed inset-0 z-40"
          />
        )}
      </AnimatePresence>

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
              <div className="flex items-center gap-1">
                {navItems.map((item, index) => (
                  <div
                    key={item.label}
                    className="relative"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <button className="relative px-5 py-2.5 text-sm text-white/90 hover:text-white active:text-white transition-all duration-300 rounded-2xl overflow-hidden group active:scale-[0.98]">
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
                <div className="relative flex items-center">
                  {/* Search bar that slides open */}
                  <AnimatePresence>
                    {isSearchOpen && (
                      <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 200, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ 
                          duration: 0.3,
                          ease: [0.16, 1, 0.3, 1]
                        }}
                        className="overflow-hidden mr-1"
                      >
                        <input
                          type="text"
                          placeholder="Search..."
                          autoFocus
                          className="w-full px-4 py-2 text-base text-white placeholder-white/60 bg-white/10 backdrop-blur-sm rounded-full border border-white/20 focus:outline-none focus:border-white/40 transition-colors"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  <motion.button
                    animate={{ x: isSearchOpen ? 0 : 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="p-2.5 text-white/80 hover:text-white transition-all duration-300 rounded-full hover:bg-white/10 active:bg-white/15 active:scale-95 backdrop-blur-sm relative z-10"
                    onClick={() => setIsSearchOpen(!isSearchOpen)}
                  >
                    <Search size={20} />
                  </motion.button>
                </div>

                <div className="relative">
                  <button
                    onClick={() => setIsHelpOpen(!isHelpOpen)}
                    className="px-5 py-2.5 text-sm text-white bg-white/10 hover:bg-white/15 active:bg-white/20 active:scale-[0.98] backdrop-blur-sm rounded-full transition-all duration-300 border border-white/20"
                  >
                    Help
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
                        <div className="p-4">
                          <h3 className="text-lg font-semibold text-white mb-2">Help & Support</h3>
                          <p className="text-sm text-white/70 mb-4">
                            Need assistance? Visit our documentation or contact support.
                          </p>

                          <div className="space-y-2">
                            <button
                              onClick={handleResetAccount}
                              disabled={logoutMutation.isPending}
                              className="w-full px-4 py-2.5 text-left text-sm text-orange-300 hover:bg-white/10 active:bg-white/12 active:scale-[0.99] rounded-xl transition-all font-medium disabled:opacity-50"
                            >
                              Reset Account to Fresh Setup
                            </button>
                          </div>

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
    </>
  );
}