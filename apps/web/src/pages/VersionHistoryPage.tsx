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
              <div className="text-white font-black text-2xl tracking-tight">
                V1.5.0
              </div>

              <div className="mt-4 space-y-3 text-sm text-white/75 leading-relaxed">
                <div className="text-white/90 font-semibold">
                  Per-viewer personalization (Movies + TV)
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Each Plex viewer gets their own curated rows for recently watched, change of
                    taste, and immaculate taste collections.
                  </li>
                  <li>
                    Recommendation datasets are isolated per viewer and per library so one viewer
                    does not affect another viewer's rows.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">Role-based Plex pinning</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Admin rows pin to Library Recommended and Home.</li>
                  <li>
                    Shared-user rows pin to Friends Home to match current Plex shared-user
                    behavior.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">
                  Deterministic curated row ordering
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Based on your recently watched</li>
                  <li>Change of Taste</li>
                  <li>Inspired by your Immaculate Taste</li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">
                  Plex library selection guardrails
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Select movie/show libraries during onboarding and later in Command Center.
                  </li>
                  <li>New Plex movie/show libraries are auto-included unless disabled.</li>
                  <li>
                    Disabled or temporarily unavailable libraries are skipped safely with clear run
                    report visibility.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">
                  Refresher scoping and scheduling improvements
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Chained refreshes stay scoped to the triggering viewer and library.</li>
                  <li>
                    Standalone refresher runs sweep eligible users/libraries in deterministic
                    order, with admin processed last.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">
                  Overseerr integration (optional centralized request flow)
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Route missing movie/TV requests to Overseerr per task card.</li>
                  <li>Command Center includes a reset action for Overseerr requests.</li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">
                  Observatory workflow upgrades
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Swipe-left now adds suggestions to a rejected list so they are not suggested
                    again.
                  </li>
                  <li>Command Center can reset the rejected list.</li>
                  <li>
                    Fixed an Observatory black-screen crash and replaced library selection with a
                    custom glass dropdown.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">
                  Operational visibility and reliability updates
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Expanded user-aware reset/debug controls and clearer user/media run reporting.
                  </li>
                  <li>Compose keeps host networking while still showing mapped ports.</li>
                  <li>Removed GitHub token env dependency from update checks.</li>
                </ul>
              </div>
            </div>

            <div className={cardClass}>
              <div className="text-white font-black text-2xl tracking-tight">
                V1.0.0
              </div>

              <div className="mt-4 space-y-3 text-sm text-white/75 leading-relaxed">
                <div className="text-white/90 font-semibold">Plex-triggered automation</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Automatically reacts to Plex library activity and runs smart workflows in real time.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">Scheduler automation</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Off hours fetching media or refreshing the Plex home screen.</li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">
                  Curated Movies and TV Shows collections
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Inspired by your Immaculate Taste (long term collection)</li>
                  <li>Based on your recently watched (refreshes on every watch)</li>
                  <li>Change of Taste (refreshes on every watch)</li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">Recommendation engine</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>TMDB-powered suggestions</li>
                  <li>Optional - Google + OpenAI</li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">Keeps a snapshot database</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Recommmended database for refresher task to monitor titles as they become
                    available in Plex.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">Radarr + Sonarr integration</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Seamlessly organizes your media collection and automatically sends movies and
                    series to ARR downloaders for monitoring and acquisition.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">Observatory</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Swipe to approve download requests (optional “approval required” mode), curate
                    suggestions.
                  </li>
                </ul>

                <div className="pt-2 text-white/90 font-semibold">Job reports & logs</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Step-by-step breakdowns, metrics tables, and run history.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
