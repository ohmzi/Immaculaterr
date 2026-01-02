import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function HeroSection() {
  return (
    <section className="relative min-h-screen overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1715593948040-d013495c3647?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjB3b3Jrc3BhY2UlMjB5ZWxsb3clMjBncmVlbnxlbnwxfHx8fDE3NjczNTk0MTV8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
          alt="Background"
          className="w-full h-full object-cover"
        />
        {/* Yellow overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-yellow-400/90 via-yellow-300/80 to-green-400/70" />
      </div>

      {/* Content Container */}
      <div className="relative z-10 container mx-auto px-8 pt-48 pb-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-8"
          >
            <h1 className="text-6xl font-bold text-gray-900 leading-tight">
              Simplify your all
              <br />
              transactions with us.
            </h1>
            <p className="text-lg text-gray-800 max-w-md">
              From easy money management to travel perks and investments.
              <br />
              Open your account in flash.
            </p>
            <div className="flex gap-4">
              <Link 
                to="/setup"
                className="px-8 py-4 bg-gray-900 text-white rounded-full hover:bg-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl"
              >
                Get free account
              </Link>
              <Link 
                to="/collections"
                className="px-8 py-4 bg-transparent border-2 border-gray-900 text-gray-900 rounded-full hover:bg-gray-900 hover:text-white transition-all duration-300 flex items-center gap-2 group"
              >
                Get a demo
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </motion.div>

          {/* Right Content - Card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex justify-center lg:justify-end"
          >
            <div className="relative">
              {/* Credit Card */}
              <div className="w-[340px] bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl border border-white/10">
                {/* Card Header */}
                <div className="flex justify-between items-center mb-8">
                  <div className="flex items-center gap-2">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M13 2L3 14h8l-2 8 10-12h-8l2-8z" fill="#facc15" stroke="#facc15" strokeWidth="2" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-white font-semibold">Growup</span>
                  </div>
                  <button className="px-6 py-2 bg-yellow-400 text-gray-900 rounded-full text-sm font-medium hover:bg-yellow-300 transition-colors">
                    Add Money
                  </button>
                </div>

                {/* Balance */}
                <div className="mb-8">
                  <p className="text-gray-400 text-sm mb-1">Balance</p>
                  <p className="text-white text-4xl font-bold">$45,897.00</p>
                  <p className="text-gray-400 text-sm mt-2">•••• •••• •••• 8767</p>
                </div>

                {/* Card Footer */}
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-white font-medium">DAVID MARTIN</p>
                  </div>
                  <div className="text-gray-400">18/35</div>
                  <div className="w-12 h-8 bg-yellow-400 rounded flex items-center justify-center">
                    <span className="text-gray-900 font-bold text-xs rotate-90">VISA</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom Badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="mt-24 flex flex-wrap gap-4 max-w-2xl"
        >
          <div className="flex-1 min-w-[200px] bg-yellow-400 rounded-full px-8 py-4 flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#facc15" strokeWidth="2"/>
                <path d="M9 12l2 2 4-4" stroke="#facc15" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-800">The world's best digital bank</p>
              <p className="text-sm font-semibold text-gray-900">2025</p>
            </div>
          </div>
          <div className="bg-yellow-400 rounded-full px-8 py-4 flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2l3 7h7l-5.5 4.5 2 7-6.5-5-6.5 5 2-7L2 9h7l3-7z" fill="#facc15"/>
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-800">Excellent 4.9/5.0</p>
              <p className="text-sm font-semibold text-gray-900">2025</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Dark Section with Logos */}
      <div className="absolute bottom-0 left-0 right-0 bg-gray-900 py-8">
        <div className="container mx-auto px-8">
          <div className="flex justify-between items-center opacity-40 overflow-x-auto gap-8">
            <div className="text-gray-400 font-semibold text-xl whitespace-nowrap">dbt</div>
            <div className="text-gray-400 font-semibold text-xl whitespace-nowrap">tableau</div>
            <div className="text-gray-400 font-semibold text-xl whitespace-nowrap">anaplan</div>
            <div className="text-gray-400 font-semibold text-xl whitespace-nowrap">Qlik</div>
            <div className="text-gray-400 font-semibold text-xl whitespace-nowrap">snowflake</div>
            <div className="text-gray-400 font-semibold text-xl whitespace-nowrap hidden md:block">Azure</div>
            <div className="text-gray-400 font-semibold text-xl whitespace-nowrap hidden lg:block">python</div>
          </div>
        </div>
      </div>
    </section>
  );
}

