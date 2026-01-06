import { useMemo, useState } from 'react';
import { motion, useAnimation } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Loader2, ScrollText } from 'lucide-react';

import { listServerLogs } from '@/api/logs';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
  APP_PRESSABLE_CLASS,
} from '@/lib/ui-classes';

function formatLevel(raw: string) {
  const l = String(raw ?? '').toLowerCase();
  if (l === 'error') return 'Error';
  if (l === 'warn' || l === 'warning') return 'Warning';
  if (l === 'debug') return 'Debug';
  return 'Info';
}

function levelClass(raw: string) {
  const l = String(raw ?? '').toLowerCase();
  if (l === 'error') return 'text-red-200';
  if (l === 'warn' || l === 'warning') return 'text-amber-200';
  if (l === 'debug') return 'text-white/50';
  return 'text-white/80';
}

export function LogsPage() {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const [filter, setFilter] = useState<'all' | 'plex' | 'errors'>('all');
  const [query, setQuery] = useState('');
  const logsQuery = useQuery({
    queryKey: ['serverLogs'],
    queryFn: () => listServerLogs({ limit: 5000 }),
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const logs = useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data?.logs]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byText = q
      ? logs.filter((l) => (l.message || '').toLowerCase().includes(q))
      : logs;
    if (filter === 'plex') {
      return byText.filter((l) => (l.message || '').toLowerCase().includes('plex'));
    }
    if (filter === 'errors') {
      return byText.filter((l) => String(l.level).toLowerCase() === 'error');
    }
    return byText;
  }, [logs, query, filter]);

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-3 shadow-2xl';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Background (landing-page style, cyan-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/30 via-sky-700/40 to-indigo-900/65" />
        <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
        <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
      </div>

      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16">
        <div className="container mx-auto px-4 pb-20 max-w-5xl">
          {/* Page Header */}
          <div className="mb-12">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-5">
                <motion.button
                  type="button"
                  onClick={() => {
                    titleIconControls.stop();
                    titleIconGlowControls.stop();
                    void titleIconControls.start({
                      scale: [1, 1.06, 1],
                      transition: { duration: 0.55, ease: 'easeOut' },
                    });
                    void titleIconGlowControls.start({
                      opacity: [0, 0.7, 0, 0.55, 0, 0.4, 0],
                      transition: { duration: 1.4, ease: 'easeInOut' },
                    });
                  }}
                  animate={titleIconControls}
                  className="relative group focus:outline-none touch-manipulation"
                  aria-label="Animate Logs icon"
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                  <div className="relative p-3 md:p-4 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_30px_rgba(250,204,21,0.3)] border border-white/20 group-hover:rotate-0 transition-transform duration-300 ease-spring">
                    <ScrollText className="w-8 h-8 md:w-10 md:h-10 text-black" strokeWidth={2.5} />
                  </div>
                </motion.button>
                <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                  Logs
                </h1>
              </div>

              <p className="text-purple-200/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                Real-time server <span className="text-[#facc15] font-bold">monitoring</span>. <br />
                <span className="text-sm opacity-60 font-normal">
                  Watch your system breathe, one log line at a time.
                </span>
              </p>
            </motion.div>
          </div>

          <div className={cardClass}>
            {logsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-white/70 p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : logsQuery.error ? (
              <div className="flex items-start gap-2 text-sm text-red-200 p-4">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>{(logsQuery.error as Error).message}</div>
              </div>
            ) : filtered.length ? (
              <>
                <div className="p-3 md:p-4 border-b border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFilter('all')}
                      className={[
                        APP_PRESSABLE_CLASS,
                        'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                        filter === 'all'
                          ? 'bg-white/15 text-white border-white/20'
                          : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                      ].join(' ')}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilter('plex')}
                      className={[
                        APP_PRESSABLE_CLASS,
                        'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                        filter === 'plex'
                          ? 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25'
                          : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                      ].join(' ')}
                    >
                      Plex
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilter('errors')}
                      className={[
                        APP_PRESSABLE_CLASS,
                        'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                        filter === 'errors'
                          ? 'bg-red-500/15 text-red-100 border-red-500/25'
                          : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                      ].join(' ')}
                    >
                      Errors
                    </button>
                  </div>

                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter… (e.g. scrobble, library.new, OFFLINE)"
                    className="w-full md:w-[360px] px-4 py-2 rounded-full border border-white/15 bg-white/5 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-white/15"
                  />
                </div>
              <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-white/60 sticky top-0 z-20 bg-[#0b0c0f]/95 backdrop-blur-sm">
                    <tr>
                      <th className="border-b border-white/10 px-4 py-3 whitespace-nowrap">
                        Timestamp
                      </th>
                      <th className="border-b border-white/10 px-4 py-3 whitespace-nowrap">
                        Level
                      </th>
                      <th className="border-b border-white/10 px-4 py-3">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((line) => (
                      <tr key={line.id} className="border-t border-white/10 hover:bg-white/5">
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-white/60">
                          {new Date(line.time).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={['font-mono text-xs font-semibold', levelClass(line.level)].join(' ')}
                          >
                            {formatLevel(line.level)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-white/85">
                          {line.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            ) : (
              <div className="text-sm text-white/70 p-4">No logs yet.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}


