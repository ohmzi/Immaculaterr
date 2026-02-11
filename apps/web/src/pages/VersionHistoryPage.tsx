import { motion, useAnimation } from 'motion/react';
import { Tags } from 'lucide-react';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';
import { VERSION_HISTORY_ENTRIES } from '@/lib/version-history';

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
              <div key={`${entry.version}-${entryIndex}`} className={cardClass}>
                <div className="text-2xl font-black tracking-tight text-white">V{entry.version}</div>

                <div className="mt-4 space-y-3 text-sm leading-relaxed text-white/75">
                  {entry.sections.map((section, sectionIndex) => (
                    <div key={`${section.title}-${sectionIndex}`} className={sectionIndex ? 'pt-2' : ''}>
                      <div className="font-semibold text-white/90">{section.title}</div>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {section.bullets.map((bullet, bulletIndex) => (
                          <li key={`${section.title}-${bulletIndex}`}>{bullet}</li>
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
