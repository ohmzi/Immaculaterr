import { motion, useAnimation } from 'motion/react';
import { Tags } from 'lucide-react';
import { useState } from 'react';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

export function VersionHistoryPage() {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const [nonce, setNonce] = useState(0);

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
          {/* Page Header */}
          <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="flex flex-col gap-4"
            >
              <div className="flex items-center gap-4">
                <motion.button
                  key={nonce}
                  type="button"
                  onClick={() => {
                    setNonce((n) => n + 1);
                    titleIconControls.stop();
                    titleIconGlowControls.stop();
                    void titleIconControls.start({
                      scale: [1, 1.06, 1],
                      rotate: [-6, 0, -3],
                      transition: { duration: 0.6, ease: 'easeOut' },
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
                  <div className="relative p-3 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_20px_rgba(250,204,21,0.4)] border-2 border-white/10 group-hover:rotate-0 transition-transform duration-300">
                    <Tags className="w-8 h-8 text-black" strokeWidth={2.5} />
                  </div>
                </motion.button>

                <div className="min-w-0">
                  <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white drop-shadow-xl">
                    Version History
                  </h1>
                  <p className="mt-2 text-amber-100/70 text-lg font-medium max-w-xl leading-relaxed">
                    Release notes and version history. We’ll fill this in soon.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Placeholder content */}
          <div className={cardClass}>
            <div className="text-white font-semibold text-xl">Coming soon</div>
            <div className="mt-2 text-sm text-white/70 leading-relaxed">
              This page will contain version history and release notes.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

