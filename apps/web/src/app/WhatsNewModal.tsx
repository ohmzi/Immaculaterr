import { motion, AnimatePresence } from 'motion/react';

import type { VersionHistoryEntry } from '@/lib/version-history';

export function WhatsNewModal(props: {
  open: boolean;
  entry: VersionHistoryEntry | null;
  versionLabel: string;
  onAcknowledge: () => void;
  acknowledging?: boolean;
}) {
  const { open, entry, versionLabel, onAcknowledge, acknowledging = false } = props;
  const highlights =
    entry?.popupHighlights && entry.popupHighlights.length > 0
      ? entry.popupHighlights
      : (entry?.sections ?? []).map((section) => section.title).slice(0, 5);

  const splitHighlight = (line: string): { feature: string; detail: string } | null => {
    const idx = line.indexOf(':');
    if (idx <= 0) return null;
    const feature = line.slice(0, idx).trim();
    const detail = line.slice(idx + 1).trim();
    if (!feature || !detail) return null;
    return { feature, detail };
  };

  return (
    <AnimatePresence>
      {open && entry ? (
        <motion.div
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="What's New in Immaculaterr"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[#0b0c0f]/85 shadow-2xl backdrop-blur-2xl"
            style={{ maxHeight: 'min(84dvh, 760px)' }}
          >
            <div className="border-b border-white/10 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
                  What&apos;s New in Immaculaterr
                </h2>
                <span className="rounded-full border border-[#facc15]/35 bg-[#facc15]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#facc15]">
                  New in {versionLabel}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/55 sm:text-sm">
                Quick highlights for this update.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
              <div className="space-y-2">
                {highlights.map((line) => (
                  <div
                    key={line}
                    className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#facc15]"
                    />
                    <p className="text-sm leading-relaxed text-white/80">
                      {(() => {
                        const parsed = splitHighlight(line);
                        if (!parsed) return line;
                        return (
                          <>
                            <span className="font-semibold text-[#facc15]">
                              {parsed.feature}:
                            </span>{' '}
                            <span className="text-white/80">{parsed.detail}</span>
                          </>
                        );
                      })()}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-white/10 bg-[#090a0d]/75 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-6">
              <div className="flex items-center justify-between gap-4">
                <a
                  href="/version-history"
                  className="text-xs text-white/55 transition-colors hover:text-white/85 sm:text-sm"
                >
                  View Full Version History
                </a>

                <button
                  type="button"
                  onClick={onAcknowledge}
                  disabled={acknowledging}
                  className="min-h-[40px] rounded-xl border border-[#facc15]/20 bg-[#facc15] px-4 py-2 text-sm font-bold text-black shadow-[0_0_20px_rgba(250,204,21,0.25)] transition hover:bg-[#fde68a] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-[44px] sm:px-5"
                >
                  Okay, Let&apos;s Go!
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
