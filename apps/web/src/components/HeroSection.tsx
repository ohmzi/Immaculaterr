import { motion } from 'motion/react';
import { ArrowRight, Lock } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { getPlexLibraryGrowth } from '@/api/plex';

function formatMonthLabel(value: string) {
  const [y, m] = value.split('-');
  const year = Number.parseInt(y ?? '', 10);
  const month = Number.parseInt(m ?? '', 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return value;
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleString(undefined, { month: 'short', year: '2-digit' });
}

function buildQuarterScale(maxValue: number) {
  // Keep the smallest visible scale at 20 (0,5,10,15,20) to avoid a cramped chart.
  const minMax = 20;
  const safeMax = Number.isFinite(maxValue) ? Math.max(0, maxValue) : 0;
  const domainMax = Math.max(minMax, safeMax);
  const step = Math.max(1, Math.ceil(domainMax / 4));
  const niceMax = step * 4;
  const ticks = [0, step, step * 2, step * 3, niceMax];
  return { ticks, domain: [0, niceMax] as [number, number] };
}

export function HeroSection() {
  const growthQuery = useQuery({
    queryKey: ['plex', 'library-growth'],
    queryFn: getPlexLibraryGrowth,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const series = growthQuery.data?.series ?? [];
  const last = series.at(-1) ?? null;
  const prev = series.length >= 2 ? series.at(-2)! : null;

  const totalItems = last ? last.movies + last.tv : 0;
  const prevTotal = prev ? prev.movies + prev.tv : 0;
  const thisMonthDelta = last ? totalItems - prevTotal : 0;
  const growthPct =
    prevTotal > 0 ? Math.round(((totalItems - prevTotal) / prevTotal) * 100) : 0;

  const hasData = series.length > 0 && totalItems > 0;
  const showBlur = !hasData;

  const moviesMax = series.reduce((acc, p) => Math.max(acc, p.movies), 0);
  const tvMax = series.reduce((acc, p) => Math.max(acc, p.tv), 0);
  const moviesScale = buildQuarterScale(moviesMax);
  const tvScale = buildQuarterScale(tvMax);

  return (
    <section className="relative min-h-screen overflow-hidden pb-32 lg:pb-8">
      {/* Background Image */}
      <div className="pointer-events-none fixed inset-0">
        <img 
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt="Movie posters collection"
          className="h-full w-full object-cover object-center"
        />
      </div>
      
      {/* Gradient Overlay */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-yellow-400/90 via-yellow-300/85 to-green-400/90" />

      {/* Content Container */}
      <div className="relative z-10 container mx-auto px-6 lg:px-8 pt-32 lg:pt-48 pb-24 flex items-center min-h-[calc(100vh-200px)]">
        <div className="grid lg:grid-cols-[auto_auto] gap-6 lg:gap-1 items-center w-full justify-center">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:pr-4 text-center lg:text-left"
          >
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white leading-tight">
              Automate your
              <br />
              media collection
            </h1>
            {/* Placeholder elements - kept for future use */}
            <div className="hidden">
              <p className="text-base lg:text-lg text-gray-800 max-w-md">
                text
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <button className="px-8 py-4 bg-gray-900 text-white rounded-full hover:bg-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl">
                  button
                </button>
                <button className="px-8 py-4 bg-transparent border-2 border-gray-900 text-gray-900 rounded-full hover:bg-gray-900 hover:text-white transition-all duration-300 flex items-center justify-center gap-2 group">
                  button
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </motion.div>

          {/* Right Content - Card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex justify-center lg:justify-end items-center w-full lg:w-auto"
          >
            <div className="relative w-full max-w-[380px] min-w-[320px]">
              {/* Analytics Card */}
              <div className="w-full bg-gradient-to-br from-gray-900 to-gray-800 dark:from-gray-800 dark:to-gray-900 rounded-3xl p-6 lg:p-8 shadow-2xl backdrop-blur-xl border border-white/10 dark:border-white/5">
                {/* Card Header */}
                <div className="mb-6">
                  <h3 className="text-white text-lg font-semibold mb-1">Media Analytics</h3>
                  <p className="text-gray-400 dark:text-gray-500 text-sm">Collection growth over time</p>
                </div>

                {/* Chart */}
                <div className="w-full h-[240px] relative min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
                    <AreaChart data={series}>
                      <defs>
                        <linearGradient id="colorMovies" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#facc15" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#facc15" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorTv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.22}/>
                          <stop offset="95%" stopColor="#60a5fa" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                      <XAxis 
                        dataKey="month"
                        stroke="#9ca3af" 
                        style={{ fontSize: '12px' }}
                        tickFormatter={formatMonthLabel}
                      />
                      <YAxis
                        yAxisId="movies"
                        orientation="left"
                        stroke="#facc15"
                        style={{ fontSize: '12px' }}
                        tick={{ fill: '#facc15' }}
                        domain={moviesScale.domain}
                        ticks={moviesScale.ticks}
                      />
                      <YAxis
                        yAxisId="tv"
                        orientation="right"
                        stroke="#60a5fa"
                        style={{ fontSize: '12px' }}
                        tick={{ fill: '#60a5fa' }}
                        domain={tvScale.domain}
                        ticks={tvScale.ticks}
                      />
                      <Tooltip 
                        labelFormatter={(label) => formatMonthLabel(String(label))}
                        formatter={(value, name) => [
                          value,
                          name === 'movies' ? 'Movies' : name === 'tv' ? 'TV Shows' : String(name),
                        ]}
                        contentStyle={{ 
                          backgroundColor: '#1f2937', 
                          border: '1px solid #374151',
                          borderRadius: '12px',
                          color: '#fff'
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="movies"
                        yAxisId="movies"
                        stroke="#facc15" 
                        strokeWidth={2.5}
                        fill="url(#colorMovies)" 
                      />
                      <Area
                        type="monotone"
                        dataKey="tv"
                        yAxisId="tv"
                        stroke="#60a5fa"
                        strokeWidth={2.5}
                        fill="url(#colorTv)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  
                  {/* Blur Overlay */}
                  {showBlur && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="absolute inset-0 backdrop-blur-xl bg-gradient-to-br from-gray-900/60 via-gray-800/50 to-gray-900/60 rounded-xl flex flex-col items-center justify-center border border-white/5"
                    >
                      <div className="bg-yellow-400/10 p-4 rounded-2xl backdrop-blur-sm border border-yellow-400/20 mb-3">
                        <Lock className="w-6 h-6 text-yellow-400" />
                      </div>
                      <div className="text-center px-4">
                        <p className="text-white font-medium">
                          {growthQuery.isLoading ? 'Loading…' : 'No Data Available'}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Stats Footer */}
                <div className="mt-6 pt-6 border-t border-gray-700 dark:border-gray-600 grid grid-cols-3 gap-4 relative">
                  <div>
                    <p className="text-gray-400 dark:text-gray-500 text-xs mb-1">Total Items</p>
                    <p className="text-white font-semibold">{hasData ? totalItems.toLocaleString() : '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 dark:text-gray-500 text-xs mb-1">This Month</p>
                    <p className="text-white font-semibold">
                      {hasData ? `${thisMonthDelta >= 0 ? '+' : ''}${thisMonthDelta.toLocaleString()}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 dark:text-gray-500 text-xs mb-1">Growth</p>
                    <p className="text-yellow-400 dark:text-yellow-300 font-semibold">
                      {hasData && prevTotal > 0 ? `${growthPct >= 0 ? '+' : ''}${growthPct}%` : '—'}
                    </p>
                  </div>
                  
                  {/* Blur Overlay for Stats */}
                  {showBlur && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3, delay: 0.1 }}
                      className="absolute inset-0 backdrop-blur-lg bg-gradient-to-r from-gray-900/50 via-gray-800/40 to-gray-900/50 rounded-lg border border-white/5"
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
          className="mt-16 lg:mt-24 flex-col sm:flex-row gap-4 max-w-2xl hidden"
        >
          <div className="flex-1 bg-yellow-400 rounded-full px-6 lg:px-8 py-4 flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#facc15" strokeWidth="2"/>
                <path d="M9 12l2 2 4-4" stroke="#facc15" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-800">badge text</p>
              <p className="text-sm font-semibold text-gray-900">badge title</p>
            </div>
          </div>
          <div className="bg-yellow-400 rounded-full px-6 lg:px-8 py-4 flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2l3 7h7l-5.5 4.5 2 7-6.5-5-6.5 5 2-7L2 9h7l3-7z" fill="#facc15"/>
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