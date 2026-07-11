import { motion, useAnimation } from 'motion/react';
import { Link2, Tags } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { copyToClipboard } from '@/lib/clipboard';

import { formatDisplayVersion, VERSION_HISTORY_ENTRIES } from '@/lib/version-history';

function versionAnchorId(version: string): string {
  return `v-${version.replace(/[^a-zA-Z0-9.-]+/g, '-')}`;
}

export function VersionHistoryPage() {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const location = useLocation();

  // Deep-link support: /version-history#v-1.7.10-beta-3 scrolls to that release.
  useEffect(() => {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(hash)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  const cardClass =
    'rounded-[32px] border border-white/10 bg-[#0b0c0f]/65 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl lg:p-8';
  const sectionCardClass =
    'rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]';

  const handleAnimateTitleIcon = useCallback(() => {
    titleIconControls.stop();
    titleIconGlowControls.stop();
    titleIconControls
      .start({
        scale: [1, 1.06, 1],
        transition: { duration: 0.55, ease: 'easeOut' },
      })
      .catch(() => undefined);
    titleIconGlowControls
      .start({
        opacity: [0, 0.7, 0, 0.55, 0, 0.4, 0],
        transition: { duration: 1.4, ease: 'easeInOut' },
      })
      .catch(() => undefined);
  }, [titleIconControls, titleIconGlowControls]);

  return (
    <div className="relative min-h-screen overflow-hidden select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Background (landing-page style, amber-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-300/25 via-yellow-700/35 to-slate-950/75" />
      </div>

      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16">
        <div className="container mx-auto max-w-5xl px-4 pb-20">
          <div className="mb-12">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-5">
                <motion.button
                  type="button"
                  onClick={handleAnimateTitleIcon}
                  animate={titleIconControls}
                  className="relative group focus:outline-none touch-manipulation"
                  aria-label="Animate Version History icon"
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 transition-opacity duration-500 group-hover:opacity-40" />
                  <motion.div
                    initial={{ rotate: -10, scale: 0.94, y: 2 }}
                    animate={{ rotate: -6, scale: 1, y: 0 }}
                    whileHover={{ rotate: 0, scale: 1.04 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    style={{ backfaceVisibility: 'hidden' }}
                    className="relative will-change-transform transform-gpu rounded-2xl border border-white/20 bg-[#facc15] p-3 shadow-[0_0_30px_rgba(250,204,21,0.3)] md:p-4"
                  >
                    <Tags className="h-8 w-8 text-black md:h-10 md:w-10" strokeWidth={2.5} />
                  </motion.div>
                </motion.button>

                <h1 className="text-5xl font-black tracking-tighter text-white drop-shadow-2xl md:text-6xl">
                  Version History
                </h1>
              </div>

              <p className="ml-1 max-w-lg text-lg font-medium leading-relaxed text-amber-100/70">
                Release notes and version history.
              </p>
            </motion.div>
          </div>

          <div className="space-y-6">
            {VERSION_HISTORY_ENTRIES.map((entry, entryIndex) => (
              <div
                key={entry.version}
                id={versionAnchorId(entry.version)}
                className={`${cardClass} scroll-mt-28`}
              >
                <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-200/60">
                      Release Line
                    </div>
                    <div className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
                      V{formatDisplayVersion(entry.version) ?? entry.version}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {entryIndex === 0 ? (
                      <span className="rounded-full border border-[#facc15]/35 bg-[#facc15]/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#facc15]">
                        Current Highlights
                      </span>
                    ) : null}
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/60">
                      {entry.sections.length} section{entry.sections.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const url = `${window.location.origin}${window.location.pathname}#${versionAnchorId(entry.version)}`;
                        void copyToClipboard(url)
                          .then(() => toast.success('Release link copied'))
                          .catch(() => toast.error('Copy failed'));
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white/90"
                      title="Copy a link to this release"
                    >
                      <Link2 className="h-3.5 w-3.5" /> Copy link
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {entry.sections.map((section, sectionIndex) => (
                    <div
                      key={`${entry.version}-${section.title}`}
                      className={[
                        sectionCardClass,
                        entry.sections.length % 2 === 1 &&
                        sectionIndex === entry.sections.length - 1
                          ? 'md:col-span-2'
                          : '',
                      ].join(' ')}
                    >
                      <div className="mb-3 flex items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#facc15] shadow-[0_0_12px_rgba(250,204,21,0.45)]"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold tracking-tight text-white">
                            <span className="text-[#facc15]">{section.title}</span>
                          </div>
                        </div>
                      </div>
                      <ul className="space-y-2">
                        {section.bullets.map((bullet) => (
                          <li
                            key={`${entry.version}-${section.title}-${bullet}`}
                            className="flex items-start gap-3 text-sm leading-relaxed text-white/74"
                          >
                            <span
                              aria-hidden="true"
                              className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-white/30"
                            />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
