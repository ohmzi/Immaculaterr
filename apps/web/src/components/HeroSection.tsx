import { motion } from 'motion/react';
import { ArrowRight, Lock } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const chartData = [
  { month: 'Jan', value: 2400 },
  { month: 'Feb', value: 1398 },
  { month: 'Mar', value: 9800 },
  { month: 'Apr', value: 3908 },
  { month: 'May', value: 4800 },
  { month: 'Jun', value: 3800 },
  { month: 'Jul', value: 4300 },
];

export function HeroSection() {
  const showBlur = true;

  return (
    <section className="relative min-h-screen overflow-hidden pb-24 lg:pb-0">
      {/* Background Image */}
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
          alt="Movie posters collection"
          className="h-full w-full object-cover"
        />
      </div>

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-yellow-400/90 via-yellow-300/85 to-green-400/90" />

      {/* Content Container */}
      <div className="container relative z-10 mx-auto flex min-h-[calc(100vh-200px)] items-center pb-24 pt-32 lg:pt-48 px-6 lg:px-8">
        <div className="grid w-full justify-center items-center gap-6 lg:gap-1 lg:grid-cols-[auto_auto]">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-center lg:pr-4 lg:text-left"
          >
            <h1 className="text-4xl font-bold leading-tight text-gray-900 sm:text-5xl lg:text-6xl">
              Automate your
              <br />
              media collection
            </h1>

            {/* Placeholder elements - kept for future use */}
            <div className="hidden">
              <p className="max-w-md text-base text-gray-800 lg:text-lg">text</p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <button className="rounded-full bg-gray-900 px-8 py-4 text-white shadow-lg transition-all duration-300 hover:bg-gray-800 hover:shadow-xl">
                  button
                </button>
                <button className="group flex items-center justify-center gap-2 rounded-full border-2 border-gray-900 bg-transparent px-8 py-4 text-gray-900 transition-all duration-300 hover:bg-gray-900 hover:text-white">
                  button
                  <ArrowRight
                    size={18}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </button>
              </div>
            </div>
          </motion.div>

          {/* Right Content - Card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex w-full items-center justify-center lg:w-auto lg:justify-end"
          >
            <div className="relative w-full max-w-[380px] min-w-[320px]">
              {/* Analytics Card */}
              <div className="w-full rounded-3xl border border-white/10 bg-gradient-to-br from-gray-900 to-gray-800 p-6 shadow-2xl backdrop-blur-xl lg:p-8">
                {/* Card Header */}
                <div className="mb-6">
                  <h3 className="mb-1 text-lg font-semibold text-white">Media Analytics</h3>
                  <p className="text-sm text-gray-400">Collection growth over time</p>
                </div>

                {/* Chart */}
                <div className="relative h-[240px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#facc15" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                      <XAxis dataKey="month" stroke="#9ca3af" style={{ fontSize: '12px' }} />
                      <YAxis stroke="#9ca3af" style={{ fontSize: '12px' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: '1px solid #374151',
                          borderRadius: '12px',
                          color: '#fff',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#facc15"
                        strokeWidth={3}
                        fill="url(#colorValue)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>

                  {/* Blur Overlay */}
                  {showBlur && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-white/5 bg-gradient-to-br from-gray-900/60 via-gray-800/50 to-gray-900/60 backdrop-blur-xl"
                    >
                      <div className="mb-3 rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-4 backdrop-blur-sm">
                        <Lock className="h-6 w-6 text-yellow-400" />
                      </div>
                      <div className="px-4 text-center">
                        <p className="font-medium text-white">No Data Available</p>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Stats Footer */}
                <div className="relative mt-6 grid grid-cols-3 gap-4 border-t border-gray-700 pt-6">
                  <div>
                    <p className="mb-1 text-xs text-gray-400">Total Items</p>
                    <p className="font-semibold text-white">2,847</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-gray-400">This Month</p>
                    <p className="font-semibold text-white">+432</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-gray-400">Growth</p>
                    <p className="font-semibold text-yellow-400">+18%</p>
                  </div>

                  {/* Blur Overlay for Stats */}
                  {showBlur && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3, delay: 0.1 }}
                      className="absolute inset-0 rounded-lg border border-white/5 bg-gradient-to-r from-gray-900/50 via-gray-800/40 to-gray-900/50 backdrop-blur-lg"
                    />
                  )}
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
          className="mt-16 hidden max-w-2xl flex-col gap-4 sm:flex-row lg:mt-24"
        >
          <div className="flex flex-1 items-center gap-3 rounded-full bg-yellow-400 px-6 py-4 lg:px-8">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-900">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#facc15" strokeWidth="2" />
                <path
                  d="M9 12l2 2 4-4"
                  stroke="#facc15"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-800">badge text</p>
              <p className="text-sm font-semibold text-gray-900">badge title</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-full bg-yellow-400 px-6 py-4 lg:px-8">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-900">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2l3 7h7l-5.5 4.5 2 7-6.5-5-6.5 5 2-7L2 9h7l3-7z"
                  fill="#facc15"
                />
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-800">badge text</p>
              <p className="text-sm font-semibold text-gray-900">badge title</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

