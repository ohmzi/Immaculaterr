import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Loader2 } from 'lucide-react';

import { listServerLogs } from '@/api/logs';

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
  const logsQuery = useQuery({
    queryKey: ['serverLogs'],
    queryFn: () => listServerLogs({ limit: 500 }),
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const logs = useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data?.logs]);

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Background (landing-page style, cyan-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/30 via-sky-700/40 to-indigo-900/65" />
        <div className="absolute inset-0 bg-[#0b0c0f]/15" />
      </div>

      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-10">
        <div className="container mx-auto px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-5xl mx-auto"
          >
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.05 }}
              className={cardClass}
            >
              <div className="mb-6">
                <div className="text-2xl font-semibold text-white">Logs</div>
                <div className="mt-2 text-sm text-white/70">Live logs from server</div>
              </div>

              {logsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : logsQuery.error ? (
                <div className="flex items-start gap-2 text-sm text-red-200">
                  <CircleAlert className="mt-0.5 h-4 w-4" />
                  <div>{(logsQuery.error as Error).message}</div>
                </div>
              ) : logs.length ? (
                <div className="max-h-[560px] overflow-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-white/60">
                      <tr>
                        <th className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0c0f] px-4 py-3 whitespace-nowrap">
                          Timestamp
                        </th>
                        <th className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0c0f] px-4 py-3 whitespace-nowrap">
                          Level
                        </th>
                        <th className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0c0f] px-4 py-3">
                          Message
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((line) => (
                        <tr
                          key={line.id}
                          className="border-t border-white/10 hover:bg-white/5"
                        >
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-white/60">
                            {new Date(line.time).toLocaleTimeString()}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={[
                                'font-mono text-xs font-semibold',
                                levelClass(line.level),
                              ].join(' ')}
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
              ) : (
                <div className="text-sm text-white/70">No logs yet.</div>
              )}
            </motion.div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}


