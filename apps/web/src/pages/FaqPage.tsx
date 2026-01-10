import { motion, useAnimation } from 'motion/react';
import { BookOpen } from 'lucide-react';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

export function FaqPage() {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();

  type FaqItem = {
    id: string;
    question: string;
    answer: React.ReactNode;
  };
  type FaqSection = {
    id: string;
    title: string;
    items: FaqItem[];
  };

  const scrollToId = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const anchorClass = 'scroll-mt-28 md:scroll-mt-32';

  const FAQ_SECTIONS: FaqSection[] = [
    {
      id: 'getting-started',
      title: 'Getting started',
      items: [
        {
          id: 'getting-started-what-is',
          question: 'What is Immaculaterr?',
          answer: (
            <>
              <p>
                Immaculaterr is a Plex “autopilot” that watches your Plex activity, generates curated
                recommendation collections, and runs a few safety-focused cleanup jobs so your
                library stays tidy.
              </p>
              <p>
                It does not download media by itself—it can optionally send missing titles to
                Radarr/Sonarr, which do the downloading.
              </p>
            </>
          ),
        },
        {
          id: 'getting-started-where-to-start',
          question: 'What are the three main pages I need to understand?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-semibold text-white/85">Vault</span>: connect services (Plex,
                Radarr/Sonarr, TMDB, optional Google/OpenAI).
              </li>
              <li>
                <span className="font-semibold text-white/85">Command Center</span>: tune how the
                app behaves (defaults and dials).
              </li>
              <li>
                <span className="font-semibold text-white/85">Task Manager</span>: run jobs
                manually, and enable/disable <span className="font-semibold">Auto-Run</span>.
              </li>
            </ul>
          ),
        },
        {
          id: 'getting-started-first-time-setup',
          question: 'How do I do first-time setup?',
          answer: (
            <ol className="list-decimal pl-5 space-y-1">
              <li>Create your admin login when prompted.</li>
              <li>
                Go to <span className="font-semibold text-white/85">Vault</span> and connect Plex
                (and TMDB at minimum for best results).
              </li>
              <li>
                Optionally connect Radarr/Sonarr (only if you want “Fetch Missing items” behavior).
              </li>
              <li>
                Go to <span className="font-semibold text-white/85">Task Manager</span> and enable{' '}
                <span className="font-semibold text-white/85">Auto-Run</span> for the jobs you want.
              </li>
            </ol>
          ),
        },
        {
          id: 'getting-started-port',
          question: 'What port does Immaculaterr use and how do I access it?',
          answer: (
            <>
              <p>
                By default, it serves the Web UI and API on port <code className="font-mono">3210</code>.
              </p>
              <p>
                Open: <code className="font-mono">http://&lt;server-ip&gt;:3210/</code>
              </p>
            </>
          ),
        },
        {
          id: 'getting-started-host-networking',
          question: 'Do I need Docker host networking? When should I use host.docker.internal?',
          answer: (
            <>
              <p>
                On Linux, this project defaults to Docker <code className="font-mono">host</code>{' '}
                networking so the container can reach services like Plex/Radarr/Sonarr via{' '}
                <code className="font-mono">localhost</code>.
              </p>
              <p>
                On Docker Desktop (Mac/Windows), use <code className="font-mono">host.docker.internal</code>{' '}
                for host services (for example, Plex at{' '}
                <code className="font-mono">http://host.docker.internal:32400</code>).
              </p>
            </>
          ),
        },
        {
          id: 'getting-started-data-storage',
          question: 'Where is the data stored (DB, settings, secrets)?',
          answer: (
            <>
              <p>
                In Docker, the app stores data under <code className="font-mono">/data</code> (a
                Docker volume by default).
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  SQLite DB: <code className="font-mono">/data/tcp.sqlite</code>
                </li>
                <li>
                  Master key file (if not provided by env/secret):{' '}
                  <code className="font-mono">/data/app-master.key</code>
                </li>
                <li>
                  Settings + encrypted secrets live in the DB (secrets are encrypted at rest).
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'getting-started-reset',
          question: 'How do I reset and start over? What does “Reset Account” delete?',
          answer: (
            <>
              <p>
                Use <span className="font-semibold text-white/85">Help → Reset Account</span> to wipe
                Immaculaterr’s local state and restart the setup flow.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Deletes app settings and stored secrets (keys/tokens).</li>
                <li>Deletes job history/logs stored by Immaculaterr.</li>
                <li>Logs you out and returns you to fresh setup.</li>
              </ul>
              <p>
                It does <span className="font-semibold text-white/85">not</span> delete Plex media
                files. It may have previously created Plex collections; those are managed by jobs and
                can be recreated later.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'automation',
      title: 'Automation & triggers',
      items: [
        {
          id: 'automation-plex-triggered',
          question: 'What does “Plex-Triggered Auto-Run” mean?',
          answer: (
            <>
              <p>
                When Auto-Run is enabled for a Plex-triggered job, Immaculaterr polls Plex and
                automatically starts the job when the trigger condition is met (for example, “watched
                percentage reached”).
              </p>
              <p>
                You can still run the job manually any time from Task Manager.
              </p>
            </>
          ),
        },
        {
          id: 'automation-which-jobs',
          question: 'Which jobs are Plex-triggered and which are scheduled?',
          answer: (
            <>
              <p>
                Task Manager labels jobs as <span className="font-semibold text-white/85">Plex-Triggered</span>{' '}
                or <span className="font-semibold text-white/85">Scheduled</span> above the Auto-Run
                toggle.
              </p>
              <p>
                If you’re unsure, trust the label in Task Manager—it reflects how that job is wired
                in this build.
              </p>
            </>
          ),
        },
        {
          id: 'automation-immaculate-threshold',
          question: 'When does “Immaculate Taste Collection” trigger?',
          answer: (
            <>
              <p>
                By default, it triggers when Plex polling detects you’ve watched roughly{' '}
                <span className="font-semibold text-white/85">70%</span> of the item.
              </p>
              <p>
                (Thresholds can be tuned via environment variables in advanced setups.)
              </p>
            </>
          ),
        },
        {
          id: 'automation-watched-threshold',
          question: 'When does “Based on Latest Watched Collection” trigger?',
          answer: (
            <>
              <p>
                By default, it triggers at about{' '}
                <span className="font-semibold text-white/85">60%</span> watched for the seed item,
                detected via Plex polling.
              </p>
            </>
          ),
        },
        {
          id: 'automation-did-not-trigger',
          question: 'Why didn’t a job trigger even though I watched past the threshold?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Auto-Run is off for that job in Task Manager.</li>
              <li>Plex polling is disabled (or not reaching Plex).</li>
              <li>The item is too short (minimum duration rules can apply).</li>
              <li>
                The job was recently triggered and deduped to prevent repeated runs.
              </li>
            </ul>
          ),
        },
        {
          id: 'automation-run-manually',
          question: 'How can I run a job manually?',
          answer: (
            <>
              <p>
                Go to <span className="font-semibold text-white/85">Task Manager</span>, open the job
                card, and press <span className="font-semibold text-white/85">Run now</span>.
              </p>
              <p>
                Some jobs ask for a seed (title/year/media type). Others run directly with no input.
              </p>
            </>
          ),
        },
        {
          id: 'automation-collection-vs-refresher',
          question: 'What is the difference between the Collection job and the Refresher job?',
          answer: (
            <>
              <p>
                <span className="font-semibold text-white/85">Collection</span> jobs generate new
                suggestions based on a seed (what you watched), then rebuild Plex collections.
              </p>
              <p>
                <span className="font-semibold text-white/85">Refresher</span> jobs revisit the saved
                dataset, move items from pending → active when they appear in Plex, shuffle active
                items, and rebuild collections cleanly.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'collections',
      title: 'Collections & recommendations',
      items: [
        {
          id: 'collections-what-creates',
          question: 'What Plex collections does the app create?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Inspired by your Immaculate Taste (Movies and TV)</li>
              <li>Based on your recently watched movie/show</li>
              <li>Change of Taste</li>
            </ul>
          ),
        },
        {
          id: 'collections-immaculate-vs-watched',
          question: 'What’s the difference between “Immaculate Taste” and “Based on Latest Watched”?',
          answer: (
            <>
              <p>
                Immaculate Taste is a longer-lived “taste profile” collection that refreshes over time.
              </p>
              <p>
                Based on Latest Watched is more “right now”: it uses your recent watch as a seed,
                generates suggestions, tracks pending/active items, and refreshes as titles become
                available.
              </p>
            </>
          ),
        },
        {
          id: 'collections-change-of-taste',
          question: 'What is “Change of Taste” and how is it chosen?',
          answer: (
            <p>
              It’s designed to intentionally vary from your “similar” recommendations—think adjacent
              genres, different eras, or a deliberate curveball—so your feed isn’t all the same vibe.
            </p>
          ),
        },
        {
          id: 'collections-how-generated',
          question: 'How are recommendation titles generated?',
          answer: (
            <>
              <p>
                Recommendations are primarily driven by TMDB “similar” logic, with optional enrichment
                from Google/OpenAI if you’ve configured them.
              </p>
              <p>
                The job reports include a per-service breakdown (what each service suggested) plus the
                final “Generated” list.
              </p>
            </>
          ),
        },
        {
          id: 'collections-not-enabled-skipped',
          question: 'Why do I see “not enabled” or “skipped”?',
          answer: (
            <p>
              Those cards are always shown for transparency. “Not enabled” means you didn’t configure
              that integration. “Skipped” means the job strategy didn’t need that service for this run.
            </p>
          ),
        },
        {
          id: 'collections-missing-in-plex',
          question: 'What happens when a recommended title isn’t in Plex?',
          answer: (
            <>
              <p>
                It’s recorded as <span className="font-semibold text-white/85">pending</span>. Pending
                items can later become active once they appear in Plex.
              </p>
              <p>
                If “Fetch Missing items” is enabled for that job, Immaculaterr can optionally send the
                missing items to Radarr/Sonarr.
              </p>
            </>
          ),
        },
        {
          id: 'collections-pending-to-active',
          question: 'How does the refresher move items from pending → active?',
          answer: (
            <p>
              On refresh, Immaculaterr checks pending titles against Plex. If a title is now found in
              Plex, it’s marked active and becomes eligible for the collection rebuild.
            </p>
          ),
        },
        {
          id: 'collections-why-recreate',
          question: 'Why does the app recreate Plex collections instead of editing them in place?',
          answer: (
            <p>
              Plex can keep old ordering even after remove/re-add operations. Recreating the
              collection is the most reliable way to guarantee ordering and to keep collections
              consistent across refreshes.
            </p>
          ),
        },
        {
          id: 'collections-posters',
          question: 'How does poster artwork work for collections? Can I customize posters?',
          answer: (
            <>
              <p>
                When collections are created/recreated, the app applies shipped poster artwork by
                matching collection name → poster file.
              </p>
              <p>
                Advanced: you can replace the poster files under{' '}
                <code className="font-mono">apps/web/src/assets/collection_artwork/posters</code> (or
                adjust the mapping in the backend) to customize.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'arr',
      title: 'Radarr / Sonarr',
      items: [
        {
          id: 'arr-fetch-missing',
          question: 'What does “Fetch Missing items” actually do?',
          answer: (
            <p>
              It allows certain collection jobs to send missing recommendations to Radarr (movies) or
              Sonarr (TV) so your downloader stack can grab them. If disabled, the app will still
              track “pending” items but won’t send anything to ARR.
            </p>
          ),
        },
        {
          id: 'arr-disable-toggles',
          question: 'If I disable Radarr/Sonarr toggles, what changes?',
          answer: (
            <p>
              The jobs stop making ARR “add/search” calls. Everything else (recommendations, Plex
              matching, pending/active dataset, collection rebuilds) continues to work.
            </p>
          ),
        },
        {
          id: 'arr-delete-media',
          question: 'Will it ever delete movies/shows?',
          answer: (
            <p>
              Immaculaterr does not delete your Plex media files. Some cleanup jobs may unmonitor
              duplicates in Radarr/Sonarr to reduce clutter, but they’re designed to be safety-first.
            </p>
          ),
        },
        {
          id: 'arr-cleanup-job',
          question: 'What happens during “Cleanup after adding new content”?',
          answer: (
            <p>
              It scans for duplicates across libraries and keeps the best one, then unmonitors
              duplicates in Radarr/Sonarr (with episode/season-aware rules for TV).
            </p>
          ),
        },
        {
          id: 'arr-duplicates',
          question: 'How are duplicates handled?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Duplicates are detected across libraries; the “best” one is kept.</li>
              <li>Movie duplicates can be unmonitored in Radarr.</li>
              <li>
                TV duplicates are handled carefully (single-episode duplicates can be unmonitored
                without nuking the whole show).
              </li>
            </ul>
          ),
        },
      ],
    },
    {
      id: 'updates',
      title: 'Updates & versions',
      items: [
        {
          id: 'updates-check',
          question: 'How does the app check for updates?',
          answer: (
            <p>
              The server checks the latest GitHub release and compares it to the running app version.
              The UI surfaces this in the Help menu and can toast when a newer version is available.
            </p>
          ),
        },
        {
          id: 'updates-available',
          question: 'Why does it say “Update available”? What should I do?',
          answer: (
            <>
              <p>It means a newer release exists than what your container is currently running.</p>
              <p className="font-mono text-xs text-white/80">
                docker compose pull && docker compose up -d
              </p>
            </>
          ),
        },
        {
          id: 'updates-where-version',
          question: 'Where can I see the current version and version history?',
          answer: (
            <p>
              In the Help menu: tap the Version button (and the Version History page will expand over
              time). You can also view releases on GitHub.
            </p>
          ),
        },
        {
          id: 'updates-not-working',
          question: 'Why isn’t update checking working?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Update checks can be disabled via environment configuration.</li>
              <li>GitHub API rate limits can block checks.</li>
              <li>
                If you’re checking a private repo, you may need a GitHub token configured for update
                checks.
              </li>
            </ul>
          ),
        },
      ],
    },
    {
      id: 'security',
      title: 'Security & backups',
      items: [
        {
          id: 'security-master-key',
          question: 'What is APP_MASTER_KEY and why is it required?',
          answer: (
            <p>
              It’s the encryption key used to protect stored secrets at rest (for example, API tokens).
              It must be stable so the app can decrypt what it previously encrypted.
            </p>
          ),
        },
        {
          id: 'security-where-store',
          question: 'Where should I store the master key (env var vs secret file)?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Recommended: Docker secret file via{' '}
                <code className="font-mono">APP_MASTER_KEY_FILE</code>
              </li>
              <li>
                Also supported: environment variable{' '}
                <code className="font-mono">APP_MASTER_KEY</code> (64-char hex or base64 that decodes
                to 32 bytes)
              </li>
              <li>
                If you provide neither, the app generates a key file in the data directory.
              </li>
            </ul>
          ),
        },
        {
          id: 'security-lose-key',
          question: 'What happens if I lose the master key?',
          answer: (
            <p>
              The app won’t be able to decrypt previously saved secrets. You’ll need to reset/re-enter
              secrets (or reset the account) and store a new stable key going forward.
            </p>
          ),
        },
        {
          id: 'security-backup',
          question: 'What should I back up to restore safely?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Your app data directory (Docker volume) including the SQLite database.</li>
              <li>Your master key (env var or key file), so encrypted secrets remain decryptable.</li>
              <li>Any deployment configuration (compose files/env values).</li>
            </ul>
          ),
        },
        {
          id: 'security-rotate',
          question: 'Can I rotate the master key?',
          answer: (
            <p>
              You can, but anything encrypted with the old key won’t decrypt with the new one. The
              safe rotation workflow is: rotate key, then re-enter secrets so they’re re-encrypted.
            </p>
          ),
        },
      ],
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      items: [
        {
          id: 'troubleshooting-login',
          question: 'I can’t log in / I keep getting logged out — what do I check?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Cookie/security settings (HTTP vs HTTPS deployments).</li>
              <li>Reverse proxy headers (X-Forwarded-Proto) if applicable.</li>
              <li>Browser blocking cookies (private browsing, strict settings, etc.).</li>
            </ul>
          ),
        },
        {
          id: 'troubleshooting-urls',
          question: 'Immaculaterr can’t reach Plex/Radarr/Sonarr — what URL should I use from Docker?',
          answer: (
            <>
              <p>
                On Linux with host networking, use{' '}
                <code className="font-mono">http://localhost:&lt;port&gt;</code>.
              </p>
              <p>
                On Docker Desktop, use{' '}
                <code className="font-mono">http://host.docker.internal:&lt;port&gt;</code>.
              </p>
            </>
          ),
        },
        {
          id: 'troubleshooting-tmdb',
          question: 'TMDB requests fail — what’s required and where do I configure it?',
          answer: (
            <p>
              Configure TMDB in <span className="font-semibold text-white/85">Vault</span>. If TMDB
              isn’t set up, recommendations may be incomplete or fail depending on the job strategy.
            </p>
          ),
        },
        {
          id: 'troubleshooting-empty-report',
          question: 'A job ran but the report looks empty — what does that mean?',
          answer: (
            <p>
              Usually it means there was nothing new to do (no new seed, no pending items became
              available, or collections were already up to date). Check the step-by-step breakdown and
              logs for details.
            </p>
          ),
        },
        {
          id: 'troubleshooting-posters',
          question: 'Collections created but no poster shows — why?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>The container image may be outdated (rebuild/pull and restart).</li>
              <li>The collection name may not match the artwork mapping.</li>
              <li>Plex may take time to refresh metadata.</li>
            </ul>
          ),
        },
        {
          id: 'troubleshooting-logs',
          question: 'How do I view logs and job history?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-semibold text-white/85">Rewind</span>: run history + job reports
              </li>
              <li>
                <span className="font-semibold text-white/85">Logs</span>: raw server log lines
              </li>
            </ul>
          ),
        },
      ],
    },
    {
      id: 'glossary',
      title: 'Glossary',
      items: [
        {
          id: 'glossary-auto-run',
          question: 'Auto-Run',
          answer: (
            <p>
              A toggle that allows a job to run automatically when its trigger condition occurs.
            </p>
          ),
        },
        {
          id: 'glossary-plex-triggered',
          question: 'Plex-Triggered',
          answer: (
            <p>
              Jobs that start based on Plex events detected by polling (watch threshold, new media, etc.).
            </p>
          ),
        },
        {
          id: 'glossary-scheduled',
          question: 'Scheduled',
          answer: <p>Jobs that run on a time schedule (daily/weekly/monthly/cron).</p>,
        },
        {
          id: 'glossary-seed',
          question: 'Seed',
          answer: (
            <p>
              The movie/show that triggers a run and is used to generate recommendations.
            </p>
          ),
        },
        {
          id: 'glossary-pending',
          question: 'Pending',
          answer: (
            <p>
              A suggested title that is not in Plex yet (but may become available later).
            </p>
          ),
        },
        {
          id: 'glossary-active',
          question: 'Active',
          answer: <p>A title that is in Plex and eligible to appear in a curated collection.</p>,
        },
        {
          id: 'glossary-refresher',
          question: 'Refresher',
          answer: (
            <p>
              A job that revisits the saved dataset, activates newly-available items, shuffles, and rebuilds collections.
            </p>
          ),
        },
      ],
    },
  ];

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-text [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Background (landing-page style, blue-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-sky-400/30 via-indigo-700/45 to-slate-950/70" />
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
                  aria-label="Animate FAQ icon"
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
                    <BookOpen className="w-8 h-8 md:w-10 md:h-10 text-black" strokeWidth={2.5} />
                  </motion.div>
                </motion.button>

                <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                  FAQ
                </h1>
              </div>

              <p className="text-sky-100/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                Frequently asked questions and quick answers. We’ll add the good stuff here soon.
              </p>
            </motion.div>
          </div>

          {/* Catalog */}
          <div className={cardClass}>
            <div className="text-white font-semibold text-xl">Catalog</div>
            <div className="mt-2 text-sm text-white/70 leading-relaxed">
              Tap a section (or a question) to jump directly to the answer.
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {FAQ_SECTIONS.map((section) => (
                <div
                  key={section.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <button
                    type="button"
                    onClick={() => scrollToId(section.id)}
                    className="w-full text-left text-sm font-semibold text-white/90 hover:text-white transition-colors"
                  >
                    {section.title}
                  </button>
                  <div className="mt-3 space-y-1">
                    {section.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => scrollToId(item.id)}
                        className="w-full text-left text-sm text-white/65 hover:text-white/90 transition-colors"
                      >
                        {item.question}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sections */}
          <div className="mt-6 space-y-6">
            {FAQ_SECTIONS.map((section) => (
              <div
                key={section.id}
                id={section.id}
                className={`${cardClass} ${anchorClass}`}
              >
                <div className="text-white font-semibold text-2xl">{section.title}</div>
                <div className="mt-5 space-y-6">
                  {section.items.map((item) => (
                    <div key={item.id} id={item.id} className={anchorClass}>
                      <div className="text-white font-semibold text-lg">{item.question}</div>
                      <div className="mt-2 text-sm text-white/70 leading-relaxed space-y-2">
                        {item.answer}
                      </div>
                      <div className="mt-5 h-px bg-white/10" />
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

