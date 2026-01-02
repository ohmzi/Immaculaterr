import { useState } from 'react';
import { Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface NavItem {
  label: string;
  dropdown?: string[];
}

const navItems: NavItem[] = [
  {
    label: 'Overview',
    dropdown: ['Company', 'Team', 'Careers', 'News'],
  },
  {
    label: 'Solution',
    dropdown: ['For Business', 'For Individuals', 'For Developers', 'Enterprise'],
  },
  {
    label: 'Service',
    dropdown: ['Lab Space', 'Build a Lab', 'Innovation Facilitation', 'Office Space'],
  },
];

export function Navigation() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

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

      {/* Desktop Navigation */}
      <nav className="fixed left-0 right-0 top-0 z-50 hidden justify-center pt-8 lg:flex">
        {/* Curved Cutout Container */}
        <div className="relative">
          {/* Main dark glassy overlay with curved bottom */}
          <div className="relative px-12 pb-12 pt-6">
            {/* Backdrop blur overlay with smooth curved bottom */}
            <div
              className="absolute inset-0 overflow-hidden bg-black/40 shadow-2xl backdrop-blur-xl"
              style={{
                borderRadius: '3rem 3rem 50% 50%',
              }}
            />

            {/* Navigation content */}
            <div className="relative flex items-center gap-8">
              {/* Logo */}
              <div className="mr-8 flex items-center gap-2">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  {/* Screen/Monitor */}
                  <rect
                    x="3"
                    y="4"
                    width="18"
                    height="13"
                    rx="2"
                    fill="none"
                    stroke="#facc15"
                    strokeWidth="2"
                  />
                  <path
                    d="M8 20h8M12 17v3"
                    stroke="#facc15"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  {/* Magnifying Glass */}
                  <circle
                    cx="10"
                    cy="10"
                    r="3"
                    fill="none"
                    stroke="#facc15"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M12.5 12.5L15 15"
                    stroke="#facc15"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-lg font-semibold tracking-tight text-white">
                  Tautulli Curated
                </span>
              </div>

              {/* Navigation Items */}
              <div className="flex items-center gap-1">
                {navItems.map((item, index) => (
                  <div
                    key={item.label}
                    className="relative"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <button className="group relative overflow-hidden rounded-2xl px-5 py-2.5 text-sm text-white/90 transition-all duration-300 hover:text-white">
                      {/* Glassy button background */}
                      <div className="absolute inset-0 rounded-2xl border border-white/10 bg-white/5 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100" />
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
                          className="absolute left-0 top-full mt-2 min-w-[220px] overflow-hidden rounded-2xl shadow-2xl"
                        >
                          <div className="border border-white/20 bg-white/95 p-2 backdrop-blur-xl">
                            {item.dropdown.map((subItem, subIndex) => (
                              <button
                                key={subIndex}
                                className="w-full rounded-xl px-4 py-3 text-left text-sm text-gray-800 transition-colors duration-200 hover:bg-gray-100"
                              >
                                {subItem}
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
              <div className="ml-8 flex items-center gap-3 overflow-visible">
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
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        className="mr-1 overflow-hidden"
                      >
                        <input
                          type="text"
                          placeholder="Search..."
                          autoFocus
                          className="w-full rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder-white/60 backdrop-blur-sm transition-colors focus:border-white/40 focus:outline-none"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.button
                    animate={{ x: isSearchOpen ? 0 : 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="relative z-10 rounded-full p-2.5 text-white/80 transition-colors duration-300 hover:bg-white/10 hover:text-white backdrop-blur-sm"
                    onClick={() => setIsSearchOpen(!isSearchOpen)}
                  >
                    <Search size={20} />
                  </motion.button>
                </div>

                <button className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm text-white transition-all duration-300 hover:bg-white/20 backdrop-blur-sm">
                  Help
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
