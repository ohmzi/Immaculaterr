import { motion } from 'motion/react';
import { useState } from 'react';
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

function niceCeilStep(rawStep: number) {
  // Round the step up to a "nice" magnitude: 10s / 100s / 1000s, etc.
  // - < 10: keep integer precision
  // - 10..99: round to nearest 10
  // - 100+: keep ~2 significant digits (e.g. 30,804 -> 31,000)
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  if (rawStep < 10) return Math.max(1, Math.ceil(rawStep));
  if (rawStep < 100) return Math.ceil(rawStep / 10) * 10;

  const exp = Math.floor(Math.log10(rawStep));
  const granularity = 10 ** Math.max(0, exp - 1);
  return Math.ceil(rawStep / granularity) * granularity;
}

function buildQuarterScale(maxValue: number) {
  // Keep the smallest visible scale at 20 (0..20) to avoid a cramped chart.
  const minDomainMax = 20;
  const safeMax = Number.isFinite(maxValue) ? Math.max(0, maxValue) : 0;
  const targetMax = Math.max(minDomainMax, safeMax);

  const step = niceCeilStep(targetMax / 4);
  const domainMax = step * 4;
  // UX: avoid showing "0" on the Y-axis.
  const ticks = [step, step * 2, step * 3, domainMax];
  return { ticks, domain: [0, domainMax] as [number, number] };
}

function formatCompactCount(value: number) {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000_000) {
    const v = abs / 1_000_000_000;
    const digits = v >= 10 ? 0 : 1;
    return `${sign}${v.toFixed(digits).replace(/\.0$/, '')}B`;
  }
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    const digits = v >= 10 ? 0 : 1;
    return `${sign}${v.toFixed(digits).replace(/\.0$/, '')}M`;
  }
  if (abs >= 1_000) {
    const v = abs / 1_000;
    const digits = v >= 10 ? 0 : 1;
    return `${sign}${v.toFixed(digits).replace(/\.0$/, '')}k`;
  }
  return `${sign}${abs.toLocaleString()}`;
}

function CombinedYAxisTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: number };
  tvTicks: number[];
  movieTicks: number[];
}) {
  const { x = 0, y = 0, payload, tvTicks, movieTicks } = props;
  const v = typeof payload?.value === 'number' ? payload.value : 0;
  const idx = movieTicks.indexOf(v);
  const tvValue = idx >= 0 ? (tvTicks[idx] ?? 0) : 0;

  const tvText = formatCompactCount(tvValue);
  const movieText = formatCompactCount(v);

  // Always align tick labels to the *actual* left edge of the chart area.
  // (Mobile browsers can shift axis group x/width differently than desktop.)
  const leftX = -x;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={leftX}
        y={-7}
        textAnchor="start"
        dominantBaseline="middle"
        style={{ fontSize: '12px' }}
        fill="#facc15"
      >
        {movieText}
      </text>
      <text
        x={leftX}
        y={7}
        textAnchor="start"
        dominantBaseline="middle"
        style={{ fontSize: '12px' }}
        fill="#60a5fa"
      >
        {tvText}
      </text>
    </g>
  );
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

  const moviesTotal = last?.movies ?? 0;
  const tvTotal = last?.tv ?? 0;
  const moviesPrev = prev?.movies ?? 0;
  const tvPrev = prev?.tv ?? 0;

  const moviesThisMonth = last ? moviesTotal - moviesPrev : 0;
  const tvThisMonth = last ? tvTotal - tvPrev : 0;

  const hasData = series.length > 0 && (moviesTotal > 0 || tvTotal > 0);
  const showBlur = !hasData;

  const [statsMedia, setStatsMedia] = useState<'movies' | 'tv'>('movies');
  const toggleStatsMedia = () =>
    setStatsMedia((m) => (m === 'movies' ? 'tv' : 'movies'));

  const statsLabel = statsMedia === 'movies' ? 'Movies' : 'TV Shows';
  const statsTotal = statsMedia === 'movies' ? moviesTotal : tvTotal;
  const statsPrevTotal = statsMedia === 'movies' ? moviesPrev : tvPrev;
  const statsThisMonth = statsMedia === 'movies' ? moviesThisMonth : tvThisMonth;
  const statsGrowthPct =
    statsPrevTotal > 0
      ? Math.round(((statsTotal - statsPrevTotal) / statsPrevTotal) * 100)
      : 0;

  const moviesMax = series.reduce((acc, p) => Math.max(acc, p.movies), 0);
  const tvMax = series.reduce((acc, p) => Math.max(acc, p.tv), 0);
  const moviesScale = buildQuarterScale(moviesMax);
  const tvScale = buildQuarterScale(tvMax);

  const yAxisWidth = (() => {
    const lens: number[] = [];
    for (let i = 0; i < moviesScale.ticks.length; i++) {
      const movieLabel = formatCompactCount(moviesScale.ticks[i] ?? 0);
      const tvLabel = formatCompactCount(tvScale.ticks[i] ?? 0);
      lens.push(Math.max(movieLabel.length, tvLabel.length));
    }
    const maxLen = lens.length ? Math.max(...lens) : 0;
    // Tighter px estimate for 12px text: ~6px/char + small gutter.
    return Math.max(28, Math.min(64, Math.ceil(maxLen * 6 + 10)));
  })();

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
        <div className="grid lg:grid-cols-[1fr_560px] gap-8 lg:gap-12 items-center w-full">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:pr-4 text-center lg:text-left"
          >
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight lg:tracking-normal text-black dark:text-black leading-tight">
              Your library, on autopilot.
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
            className="flex justify-center lg:justify-end items-center w-full"
          >
            <div className="relative w-full max-w-[560px]">
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
                        yAxisId="tv"
                        hide
                        domain={tvScale.domain}
                        ticks={tvScale.ticks}
                      />
                      <YAxis
                        yAxisId="movies"
                        orientation="left"
                        stroke="#9ca3af"
                        axisLine={{ stroke: '#9ca3af' }}
                        tickLine={{ stroke: '#9ca3af' }}
                        style={{ fontSize: '12px' }}
                        width={yAxisWidth}
                        tickMargin={0}
                        tick={(tickProps) => (
                          <CombinedYAxisTick
                            {...tickProps}
                            tvTicks={tvScale.ticks}
                            movieTicks={moviesScale.ticks}
                          />
                        )}
                        domain={moviesScale.domain}
                        ticks={moviesScale.ticks}
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
                <button
                  type="button"
                  onClick={toggleStatsMedia}
                  aria-label={`Toggle stats between Movies and TV Shows. Currently showing ${statsLabel}.`}
                  className="mt-6 pt-6 border-t border-gray-700 dark:border-gray-600 relative w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <div className="absolute -top-3 right-0">
                    <div
                      className={[
                        'px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-sm',
                        statsMedia === 'movies'
                          ? 'bg-yellow-400/10 text-yellow-200 border-yellow-400/20'
                          : 'bg-blue-400/10 text-blue-200 border-blue-400/20',
                      ].join(' ')}
                    >
                      {statsLabel}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mb-1">Total Items</p>
                      <p className="text-white font-semibold">
                        {hasData ? statsTotal.toLocaleString() : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mb-1">This Month</p>
                      <p className="text-white font-semibold">
                        {hasData
                          ? `${statsThisMonth >= 0 ? '+' : ''}${statsThisMonth.toLocaleString()}`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mb-1">Growth</p>
                      <p
                        className={[
                          'font-semibold',
                          statsMedia === 'movies'
                            ? 'text-yellow-400 dark:text-yellow-300'
                            : 'text-blue-300 dark:text-blue-300',
                        ].join(' ')}
                      >
                        {hasData && statsPrevTotal > 0
                          ? `${statsGrowthPct >= 0 ? '+' : ''}${statsGrowthPct}%`
                          : '—'}
                      </p>
                    </div>
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
                </button>
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