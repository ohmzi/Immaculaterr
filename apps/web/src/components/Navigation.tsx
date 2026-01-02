import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NavItem {
  label: string;
  to?: string;
  dropdown?: { label: string; to: string }[];
}

// Exact navigation items from the Figma design (conceptually)
// but mapped to functional areas where possible
const navItems: NavItem[] = [
  { 
    label: 'Overview',
    to: '/',
  },
  { 
    label: 'Solution',
    dropdown: [
      { label: 'Automated Jobs', to: '/jobs' },
      { label: 'Collection Manager', to: '/collections' },
      { label: 'Integration Tests', to: '/connections' },
    ]
  },
  { 
    label: 'Service',
    dropdown: [
      { label: 'Run History', to: '/runs' },
      { label: 'System Health', to: '/setup' },
    ]
  },
  { 
    label: 'Business',
    to: '/setup',
  },
];

export function Navigation() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-8 pointer-events-none">
      {/* Pointer events auto only on the nav container to allow clicking through to hero */}
      <div className="relative pointer-events-auto">
        {/* Main dark glassy overlay with curved bottom */}
        <div className="relative px-12 pt-6 pb-8">
          {/* Backdrop blur overlay - EXACT Figma Style */}
          <div className="absolute inset-0 bg-[#0f0f11]/60 backdrop-blur-2xl shadow-2xl" 
               style={{
                 borderRadius: '3rem',
                 clipPath: 'ellipse(90% 100% at 50% 0%)'
               }} 
          />
          
          {/* Navigation content */}
          <div className="relative flex items-center gap-10">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 mr-4 group">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="transition-transform group-hover:scale-110">
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
                      className="relative px-5 py-2.5 text-sm font-medium text-white/80 hover:text-white transition-all duration-300 rounded-2xl overflow-hidden group block"
                    >
                      <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl" />
                      <span className="relative z-10">{item.label}</span>
                    </Link>
                  ) : (
                    <button className="relative px-5 py-2.5 text-sm font-medium text-white/80 hover:text-white transition-all duration-300 rounded-2xl overflow-hidden group cursor-default">
                      <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl" />
                      <span className="relative z-10">{item.label}</span>
                    </button>
                  )}

                  {/* Dropdown Card */}
                  <AnimatePresence>
                    {hoveredIndex === index && item.dropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="absolute top-full left-0 mt-2 min-w-[200px] origin-top-left"
                      >
                        <div className="bg-[#1a1a1c]/90 backdrop-blur-xl border border-white/10 p-2 rounded-2xl shadow-xl overflow-hidden">
                          {item.dropdown.map((subItem, subIndex) => (
                            <Link
                              key={subIndex}
                              to={subItem.to}
                              className="block w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10 rounded-xl transition-colors duration-200"
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
            <div className="flex items-center gap-3 ml-4">
              <button className="p-2.5 text-white/80 hover:text-white transition-colors duration-300 rounded-full hover:bg-white/10">
                <Search size={20} />
              </button>
              <Link 
                to="/setup"
                className="px-6 py-2.5 text-sm font-medium text-white bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full transition-all duration-300 border border-white/10 hover:border-white/30"
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
