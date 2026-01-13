import { motion, useAnimation } from 'motion/react';
import { Tags } from 'lucide-react';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

export function VersionHistoryPage() {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Background (landing-page style, amber-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-amber-300/25 via-yellow-700/35 to-slate-950/75" />
        <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
        <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
      </div>

      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16">
        <div className="container mx-auto px-4 pb-20 max-w-5xl">
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
                  aria-label="Animate Version History icon"
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                  <motion.div
                    initial={{ rotate: -10, scale: 0.94, y: 2 }}
                    animate={{ rotate: -6, scale: 1, y: 0 }}
                    whileHover={{ rotate: 0, scale: 1.04 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    style={{ backfaceVisibility: 'hidden' }}
                    className="relative will-change-transform transform-gpu p-3 md:p-4 bg-[#facc15] rounded-2xl shadow-[0_0_30px_rgba(250,204,21,0.3)] border border-white/20"
                  >
                    <Tags className="w-8 h-8 md:w-10 md:h-10 text-black" strokeWidth={2.5} />
                  </motion.div>
                </motion.button>

                <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                  Version History
                </h1>
              </div>

              <p className="text-amber-100/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                Release notes and version history.
              </p>
            </motion.div>
          </div>

          <div className="space-y-6">
            <div className={cardClass}>
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3">
                <div className="text-white font-black text-2xl tracking-tight">
                  v1.0.0.0
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/45">
                  Major update
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm text-white/75 leading-relaxed">
                <div className="text-white/90 font-semibold">
                  Observatory + approval-gated downloads
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Observatory swipe review for <span className="text-white/90 font-semibold">Immaculate Taste</span> (Movies + TV), including Undo and batched apply.
                  </li>
                  <li>
                    Observatory swipe review for <span className="text-white/90 font-semibold">Based on Latest Watched</span> with a 2-stage flow: Recently Watched then Change of Taste.
                  </li>
                  <li>
                    Optional <span className="text-white/90 font-semibold">“Approval required from Observatory”</span> toggle to gate Radarr/Sonarr requests behind right-swipes.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">
                  Quality-of-life
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Observatory header styling/spacing polish across tabs.</li>
                  <li>“Run now” dialog inputs aligned consistently.</li>
                </ul>
              </div>
            </div>

            <div className={cardClass}>
              <div className="text-white font-black text-2xl tracking-tight">
                Previous releases
              </div>
              <div className="mt-3 text-sm text-white/70 leading-relaxed">
                Older release notes are available in the repository at{' '}
                <span className="text-white/85 font-semibold">doc/Version_History.md</span>.
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

