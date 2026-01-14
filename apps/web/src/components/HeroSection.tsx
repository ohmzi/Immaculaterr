import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, Lock } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { getPlexLibraryGrowth, getPlexLibraryGrowthVersion, type PlexLibraryGrowthResponse } from '@/api/plex';
import { APP_BG_IMAGE_URL } from '@/lib/ui-classes';

type TimeRangeKey = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL';

const TIME_RANGE_OPTIONS: Array<{
  key: TimeRangeKey;
  label: string;
  months?: number;
  title: string;
}> = [
  { key: '1M', label: '1M', months: 1, title: 'Last 1 month' },
  { key: '3M', label: '3M', months: 3, title: 'Last 3 months' },
  { key: '6M', label: '6M', months: 6, title: 'Last 6 months' },
  { key: '1Y', label: '1Y', months: 12, title: 'Last 1 year' },
  { key: '5Y', label: '5Y', months: 60, title: 'Last 5 years' },
  { key: 'ALL', label: 'All', title: 'All time' },
];

function parseUtcDateKey(value: string): Date | null {
  const [y, m, d] = value.split('-');
  const year = Number.parseInt(y ?? '', 10);
  const month = Number.parseInt(m ?? '', 10);
  const day = d ? Number.parseInt(d, 10) : 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (!Number.isFinite(day) || day <= 0) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseUtcDateKeyToMs(value: string): number | null {
  const dt = parseUtcDateKey(value);
  const ms = dt?.getTime();
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

function daysInMonthUtc(year: number, monthIndex0: number) {
  // monthIndex0: 0..11
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function addMonthsClampedUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const targetMonthIndex = m + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth0 = ((targetMonthIndex % 12) + 12) % 12;
  const maxDay = daysInMonthUtc(targetYear, targetMonth0);
  const clampedDay = Math.min(d, maxDay);
  return new Date(Date.UTC(targetYear, targetMonth0, clampedDay));
}

function formatTickDateUtc(ms: number, mode: 'day' | 'month' | 'monthOnly' | 'year2'): string {
  const dt = new Date(ms);
  if (mode === 'day') {
    return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  if (mode === 'monthOnly') {
    return dt.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });
  }
  if (mode === 'year2') {
    const yy = String(dt.getUTCFullYear()).slice(-2);
    return `'${yy}`;
  }
  return dt.toLocaleString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function formatTooltipDateUtc(ms: number): string {
  const dt = new Date(ms);
  return dt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function isoDayKeyUtc(ms: number): string {
  // YYYY-MM-DD in UTC
  return new Date(ms).toISOString().slice(0, 10);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function interpolateLinear(a: number, b: number, t: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t)) return a;
  return a + (b - a) * t;
}

function densifyDailySeries<T extends { x: number; movies: number; tv: number }>(params: {
  anchors: T[];
  startMs: number;
  endMs: number;
}) {
  const { anchors, startMs, endMs } = params;
  if (!anchors.length) return [];

  const DAY_MS = 86_400_000;
  const start = Math.floor(startMs / DAY_MS) * DAY_MS;
  const end = Math.floor(endMs / DAY_MS) * DAY_MS;

  const out: Array<{ month: string; x: number; movies: number; tv: number }> = [];
  let i = 0;

  for (let x = start; x <= end; x += DAY_MS) {
    while (i + 1 < anchors.length && anchors[i + 1]!.x < x) i++;
    const left = anchors[i]!;
    const right = anchors[i + 1] ?? left;

    const span = right.x - left.x;
    const tRaw = span > 0 ? (x - left.x) / span : 0;
    const t = clamp(tRaw, 0, 1);

    const movies = interpolateLinear(left.movies, right.movies, t);
    const tv = interpolateLinear(left.tv, right.tv, t);

    out.push({
      month: isoDayKeyUtc(x),
      x,
      movies,
      tv,
    });
  }

  return out;
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

function MonthXAxisTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: number };
  firstX: number;
  lastX: number;
  mode: 'day' | 'month' | 'monthOnly' | 'year2';
}) {
  const { x = 0, y = 0, payload, firstX, lastX, mode } = props;
  const value = typeof payload?.value === 'number' ? payload.value : NaN;
  const label = Number.isFinite(value) ? formatTickDateUtc(value, mode) : '';
  const anchor = value === firstX ? 'start' : value === lastX ? 'end' : 'middle';

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={16}
        textAnchor={anchor}
        fill="#9ca3af"
        style={{ fontSize: '12px' }}
      >
        {label}
      </text>
    </g>
  );
}

const PLEX_GROWTH_STORAGE_KEY = 'tcp.dashboard.plexLibraryGrowth.v1';

type StoredPlexGrowth = {
  version: string;
  cachedAt: number;
  data: PlexLibraryGrowthResponse;
};

function readStoredPlexGrowth(): StoredPlexGrowth | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(PLEX_GROWTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const version = typeof obj.version === 'string' ? obj.version : '';
    const cachedAt = typeof obj.cachedAt === 'number' ? obj.cachedAt : NaN;
    const data = obj.data as PlexLibraryGrowthResponse | undefined;
    if (!version) return null;
    if (!Number.isFinite(cachedAt) || cachedAt <= 0) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if ((data as { ok?: unknown }).ok !== true) return null;
    return { version, cachedAt, data };
  } catch {
    return null;
  }
}

function writeStoredPlexGrowth(next: StoredPlexGrowth) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PLEX_GROWTH_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

export function HeroSection() {
  const stored = useMemo(() => readStoredPlexGrowth(), []);
  const lastPersistedVersionRef = useRef<string | null>(stored?.version ?? null);

  const growthVersionQuery = useQuery({
    queryKey: ['plex', 'library-growth', 'version'],
    queryFn: getPlexLibraryGrowthVersion,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const version = growthVersionQuery.data?.version || stored?.version || 'unknown:0';

  const growthQuery = useQuery({
    queryKey: ['plex', 'library-growth', version],
    queryFn: getPlexLibraryGrowth,
    initialData: stored?.version === version ? stored.data : undefined,
    initialDataUpdatedAt: stored?.version === version ? stored.cachedAt : undefined,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (!growthQuery.data) return;
    if (!version) return;
    if (lastPersistedVersionRef.current === version) return;
    lastPersistedVersionRef.current = version;
    writeStoredPlexGrowth({ version, cachedAt: Date.now(), data: growthQuery.data });
  }, [growthQuery.data, version]);

  const series = growthQuery.data?.series ?? [];

  const [timeRange, setTimeRange] = useState<TimeRangeKey>('1Y');

  const seriesWithX = useMemo(() => {
    return series
      .map((p) => {
        const x = parseUtcDateKeyToMs(p.month);
        return x == null ? null : { ...p, x };
      })
      .filter((p): p is PlexLibraryGrowthResponse['series'][number] & { x: number } => Boolean(p))
      .sort((a, b) => a.x - b.x);
  }, [series]);

  const rangeBounds = useMemo(() => {
    const endDate = new Date();
    const endUtc = new Date(
      Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()),
    );
    const endMs = endUtc.getTime();

    if (timeRange === 'ALL') {
      const allStart = Date.UTC(2015, 0, 1);
      // Exceptional case: ALL ticks should be 2 years apart.
      return { startMs: allStart, endMs, stepMonths: 24, tickMode: 'year2' as const };
    }

    const opt = TIME_RANGE_OPTIONS.find((o) => o.key === timeRange) ?? null;
    const months = opt?.months ?? 12;

    const stepMonths = timeRange === '5Y' ? 12 : timeRange === '1Y' ? 2 : 1;
    // For month-based ranges (1M/3M/6M/1Y), X-axis labels should show only the month name.
    const tickMode = timeRange === '5Y' ? ('month' as const) : ('monthOnly' as const);

    const start = addMonthsClampedUtc(endUtc, -months);
    const startMs = start.getTime();
    return { startMs, endMs, stepMonths, tickMode };
  }, [timeRange]);

  const xAxisTicks = useMemo(() => {
    const { startMs, endMs, stepMonths } = rangeBounds;

    if (timeRange === 'ALL') {
      const ticks: number[] = [];
      const start = new Date(startMs);
      const end = new Date(endMs);
      for (let cursor = start; cursor <= end; cursor = addMonthsClampedUtc(cursor, stepMonths)) {
        ticks.push(cursor.getTime());
      }
      if (ticks.at(-1) !== endMs) ticks.push(endMs);
      return ticks;
    }

    const opt = TIME_RANGE_OPTIONS.find((o) => o.key === timeRange) ?? null;
    const months = opt?.months ?? 12;

    const end = new Date(endMs);
    const ticks: number[] = [];
    // Exactly N months, with a range-specific step:
    // - 1M/3M/6M: 1 month steps
    // - 1Y: 2 month steps
    // - 5Y: 6 month steps
    //
    // Always anchored to today and always includes the exact start/end.
    for (let i = months; i >= 0; i -= stepMonths) {
      ticks.push(addMonthsClampedUtc(end, -i).getTime());
    }
    const startTick = addMonthsClampedUtc(end, -months).getTime();
    if (ticks[0] !== startTick) ticks.unshift(startTick);
    if (ticks.at(-1) !== endMs) ticks.push(endMs);
    return ticks;
  }, [rangeBounds, timeRange]);

  const filteredSeries = useMemo(() => {
    if (!seriesWithX.length) return [];

    const { startMs, endMs } = rangeBounds;

    const inRange = seriesWithX.filter((p) => p.x >= startMs && p.x <= endMs);
    const prev = [...seriesWithX].reverse().find((p) => p.x < startMs) ?? null;
    const first = inRange[0] ?? null;

    const startPoint =
      prev ?? first
        ? {
            month: new Date(startMs).toISOString().slice(0, 10), // YYYY-MM-DD
            movies: (prev ?? first)!.movies,
            tv: (prev ?? first)!.tv,
            x: startMs,
          }
        : null;

    const endPoint = (() => {
      const last = inRange.at(-1) ?? null;
      if (last && last.x === endMs) return null;
      const base = last ?? prev ?? first;
      if (!base) return null;
      return {
        month: new Date(endMs).toISOString().slice(0, 10),
        movies: base.movies,
        tv: base.tv,
        x: endMs,
      };
    })();

    const next = [
      ...(startPoint ? [startPoint] : []),
      ...inRange,
      ...(endPoint ? [endPoint] : []),
    ]
      .filter((p, idx, arr) => arr.findIndex((q) => q.x === p.x) === idx)
      .sort((a, b) => a.x - b.x);

    return next;
  }, [rangeBounds, seriesWithX]);

  const dailySeries = useMemo(() => {
    return densifyDailySeries({
      anchors: filteredSeries,
      startMs: rangeBounds.startMs,
      endMs: rangeBounds.endMs,
    });
  }, [filteredSeries, rangeBounds.endMs, rangeBounds.startMs]);

  const rangeOpt = TIME_RANGE_OPTIONS.find((o) => o.key === timeRange) ?? null;
  const rangeLabel = rangeOpt?.label ?? timeRange;

  const rangeFirst = filteredSeries[0] ?? null;
  const rangeLast = filteredSeries.at(-1) ?? null;
  const hasRangeDelta = filteredSeries.length >= 2 && Boolean(rangeFirst) && Boolean(rangeLast);

  const moviesTotal = rangeLast?.movies ?? 0;
  const tvTotal = rangeLast?.tv ?? 0;
  const moviesRangeStart = rangeFirst?.movies ?? 0;
  const tvRangeStart = rangeFirst?.tv ?? 0;

  const moviesRangeDelta = hasRangeDelta ? moviesTotal - moviesRangeStart : 0;
  const tvRangeDelta = hasRangeDelta ? tvTotal - tvRangeStart : 0;

  const hasData = series.length > 0 && (moviesTotal > 0 || tvTotal > 0);
  const showBlur = !hasData;

  const [statsMedia, setStatsMedia] = useState<'movies' | 'tv'>('movies');
  const toggleStatsMedia = () =>
    setStatsMedia((m) => (m === 'movies' ? 'tv' : 'movies'));

  const statsLabel = statsMedia === 'movies' ? 'Movies' : 'TV Shows';
  const statsTotal = statsMedia === 'movies' ? moviesTotal : tvTotal;
  const statsRangeStartTotal = statsMedia === 'movies' ? moviesRangeStart : tvRangeStart;
  const statsRangeDelta = statsMedia === 'movies' ? moviesRangeDelta : tvRangeDelta;
  const statsGrowthPct =
    hasRangeDelta && statsRangeStartTotal > 0
      ? Math.round((statsRangeDelta / statsRangeStartTotal) * 100)
      : null;

  const moviesMax = dailySeries.reduce((acc, p) => Math.max(acc, p.movies), 0);
  const tvMax = dailySeries.reduce((acc, p) => Math.max(acc, p.tv), 0);
  const moviesScale = buildQuarterScale(moviesMax);
  const tvScale = buildQuarterScale(tvMax);
  const firstX = filteredSeries[0]?.x ?? 0;
  const lastX = filteredSeries.at(-1)?.x ?? 0;

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
    <section className="relative min-h-screen overflow-hidden pb-32 lg:pb-8 select-none [-webkit-touch-callout:none]">
      {/* Background Image */}
      <div className="pointer-events-none fixed inset-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt="Movie posters collection"
          className="h-full w-full object-cover object-center"
        />
      </div>
      
      {/* Gradient Overlay */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-yellow-400/90 via-yellow-300/85 to-green-400/90" />

      {/* Content Container */}
      <div className="relative z-10 container mx-auto px-6 lg:px-8 pt-28 sm:pt-32 lg:pt-40 pb-24">
        <div className="mx-auto w-full max-w-5xl flex flex-col items-center">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-center"
          >
            {/* Match headline spacing from /home/ohmz/Downloads/src, keep the original landing animation */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">
              <button
                type="button"
                className="group inline-flex flex-col items-center leading-tight bg-transparent border-0 p-0 appearance-none cursor-pointer select-none focus:outline-none"
                aria-label="Landing title"
                style={{ fontSize: 'inherit' }}
              >
                <span className="inline-flex items-center gap-0.5">
                  <span className="inline-flex items-baseline gap-[0.35em] transition-transform duration-300 ease-out group-hover:-translate-x-3 group-active:-translate-x-3">
                    <span className="font-tesla font-bold tracking-tight">Your</span>
                    <span className="font-tesla font-bold tracking-tight group-hover:tracking-normal transition-all duration-300">
                      Library
                    </span>
                  </span>

                  <span className="inline-block relative w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 -ml-2 align-middle transition-transform duration-300 ease-out group-hover:translate-x-3 group-active:translate-x-3">
                    <ChevronRight className="absolute inset-0 text-black w-full h-full stroke-[8]" />
                    <ChevronRight className="absolute inset-0 w-full h-full stroke-[5] text-[#e5a00d] transition-[filter] duration-300 ease-out group-hover:drop-shadow-[0_0_18px_rgba(229,160,13,0.9)] group-active:drop-shadow-[0_0_22px_rgba(229,160,13,0.95)]" />
                  </span>
                </span>
                <span className="inline-flex items-baseline gap-[0.35em] transition-transform duration-300 ease-out group-hover:translate-x-3 group-active:translate-x-3">
                  <span className="font-tesla font-bold tracking-tight">on</span>
                  <span className="font-plex font-bold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-black to-neutral-800 animate-pulse">
                    Autopilot.
                  </span>
                </span>
              </button>
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

          {/* Graph */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="mt-10 flex justify-center w-full"
          >
            <div className="relative w-full max-w-[560px]">
              {/* Analytics Card */}
              <div className="w-full bg-gradient-to-br from-gray-900 to-gray-800 dark:from-gray-800 dark:to-gray-900 rounded-3xl p-6 lg:p-8 shadow-2xl backdrop-blur-xl border border-white/10 dark:border-white/5">
                {/* Card Header */}
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-white text-lg font-semibold mb-1">Media Analytics</h3>
                    <p className="text-gray-400 dark:text-gray-500 text-sm">
                      Collection growth over time
                    </p>
                  </div>

                  <div className="w-full sm:w-auto">
                    <div className="max-w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <div
                        className="inline-flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 p-1 backdrop-blur-md whitespace-nowrap"
                        role="group"
                        aria-label="Select chart time range"
                      >
                        {TIME_RANGE_OPTIONS.map((opt) => {
                          const selected = timeRange === opt.key;
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => setTimeRange(opt.key)}
                              disabled={!hasData}
                              aria-pressed={selected}
                              title={opt.title}
                              className={[
                                'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
                                'disabled:opacity-40 disabled:cursor-not-allowed',
                                selected
                                  ? 'bg-white/15 text-white'
                                  : 'text-white/70 hover:text-white hover:bg-white/10',
                              ].join(' ')}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <div className="w-full h-[240px] relative min-w-0 overflow-hidden">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
                    <AreaChart
                      data={dailySeries}
                      margin={{ top: 8, right: 0, bottom: 8, left: 0 }}
                    >
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
                        dataKey="x"
                        type="number"
                        scale="time"
                        domain={[rangeBounds.startMs, rangeBounds.endMs]}
                        ticks={xAxisTicks}
                        stroke="#9ca3af" 
                        style={{ fontSize: '12px' }}
                        tick={(tickProps) => (
                          <MonthXAxisTick
                            {...tickProps}
                            firstX={xAxisTicks[0] ?? firstX}
                            lastX={xAxisTicks.at(-1) ?? lastX}
                            mode={rangeBounds.tickMode}
                          />
                        )}
                        interval={0}
                        minTickGap={0}
                        tickMargin={10}
                        padding={{ left: 0, right: 0 }}
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
                        labelFormatter={(label) => {
                          const n = typeof label === 'number' ? label : Number(label);
                          return Number.isFinite(n)
                            ? formatTooltipDateUtc(n)
                            : String(label);
                        }}
                        formatter={(value, name) => [
                          typeof value === 'number' ? Math.round(value) : value,
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
                      <p className="text-gray-400 dark:text-gray-500 text-xs mb-1">
                        Change ({rangeLabel})
                      </p>
                      <p className="text-white font-semibold">
                        {hasData
                          ? `${statsRangeDelta >= 0 ? '+' : ''}${statsRangeDelta.toLocaleString()}`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mb-1">
                        Growth ({rangeLabel})
                      </p>
                      <p
                        className={[
                          'font-semibold',
                          typeof statsGrowthPct === 'number' && statsGrowthPct < 0
                            ? 'text-rose-400 dark:text-rose-300'
                            : statsMedia === 'movies'
                              ? 'text-yellow-400 dark:text-yellow-300'
                              : 'text-blue-300 dark:text-blue-300',
                        ].join(' ')}
                      >
                        {hasData && typeof statsGrowthPct === 'number'
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