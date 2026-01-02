import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NavItem {
  label: string;
  to?: string;
  dropdown?: { label: string; to: string }[];
}

const navItems: NavItem[] = [
  { 
    label: 'Overview',
    to: '/',
    dropdown: [
      { label: 'Dashboard', to: '/' },
      { label: 'Setup', to: '/setup' },
      { label: 'Import Config', to: '/import' },
    ]
  },
  { 
    label: 'Library',
    to: '/collections',
    dropdown: [
      { label: 'Collections', to: '/collections' },
      { label: 'Connections', to: '/connections' },
    ]
  },
  { 
    label: 'Automation',
    to: '/jobs',
    dropdown: [
      { label: 'Jobs', to: '/jobs' },
      { label: 'Run History', to: '/runs' },
    ]
  },
  { 
    label: 'Settings',
    to: '/setup',
  },
];

export function Navigation() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-8">
      {/* Curved Cutout Container */}
      <div className="relative">
        {/* Main dark glassy overlay with curved bottom */}
        <div className="relative px-12 pt-6 pb-8">
          {/* Backdrop blur overlay */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xl rounded-[3rem] shadow-2xl" 
               style={{
                 clipPath: 'ellipse(90% 100% at 50% 0%)'
               }} 
          />
          
          {/* Navigation content */}
          <div className="relative flex items-center gap-8">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 mr-8">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M13 2L3 14h8l-2 8 10-12h-8l2-8z" fill="#facc15" stroke="#facc15" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
              <span className="text-white text-lg font-semibold tracking-tight">Tautulli</span>
            </Link>

            {/* Navigation Items */}
            <div className="flex items-center gap-1">
              {navItems.map((item, index) => (
                <div
                  key={item.label}
                  className="relative"
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {item.to && !item.dropdown ? (
                    <Link 
                      to={item.to}
                      className="relative px-5 py-2.5 text-sm text-white/90 hover:text-white transition-all duration-300 rounded-2xl overflow-hidden group block"
                    >
                      {/* Glassy button background */}
                      <div className="absolute inset-0 bg-white/5 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl border border-white/10" />
                      <span className="relative z-10">{item.label}</span>
                    </Link>
                  ) : (
                    <button className="relative px-5 py-2.5 text-sm text-white/90 hover:text-white transition-all duration-300 rounded-2xl overflow-hidden group">
                      {/* Glassy button background */}
                      <div className="absolute inset-0 bg-white/5 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl border border-white/10" />
                      <span className="relative z-10">{item.label}</span>
                    </button>
                  )}

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
                        <div className="bg-white/95 backdrop-blur-xl border border-white/20 p-2">
                          {item.dropdown.map((subItem, subIndex) => (
                            <Link
                              key={subIndex}
                              to={subItem.to}
                              className="block w-full text-left px-4 py-3 text-sm text-gray-800 hover:bg-gray-100 rounded-xl transition-colors duration-200"
                            >
                              {subItem.label}
                            </Link>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>

            {/* Right side buttons */}
            <div className="flex items-center gap-3 ml-8">
              <button className="p-2.5 text-white/80 hover:text-white transition-colors duration-300 rounded-full hover:bg-white/10 backdrop-blur-sm">
                <Search size={20} />
              </button>
              <Link 
                to="/setup"
                className="px-5 py-2.5 text-sm text-white bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full transition-all duration-300 border border-white/20"
              >
                Help
              </Link>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

// Mobile bottom navigation
export function MobileNavigation() {
  return (
    <nav className="fixed bottom-6 left-4 right-4 z-50 lg:hidden">
      <div className="mx-auto max-w-md bg-gray-900/95 backdrop-blur-xl rounded-full p-2 shadow-2xl border border-white/10">
        <div className="flex items-center justify-around">
          <Link to="/" className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl text-white/80 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="text-xs">Home</span>
          </Link>
          <Link to="/collections" className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl text-white/80 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs">Library</span>
          </Link>
          <Link to="/jobs" className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl text-white/80 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-xs">Jobs</span>
          </Link>
          <Link to="/runs" className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl text-white/80 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs">History</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
