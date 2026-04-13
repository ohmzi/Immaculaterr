import { AnimatePresence, motion, useAnimation } from 'motion/react';
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronUp,
  Clock,
  CircleAlert,
  Film,
  History,
  MonitorPlay,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Tv,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { RadarrLogo, SonarrLogo } from '@/components/ArrLogos';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';
import {
  COMMAND_CENTER_CARD_ID_BY_FAQ_SECTION,
  TASK_MANAGER_CARD_ID_BY_FAQ_SECTION,
} from '@/lib/faq-feature-links';

export const FaqPage = () => {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const location = useLocation();
  const navigate = useNavigate();
  const [flashSection, setFlashSection] = useState<{ id: string; nonce: number } | null>(null);
  const [showScrollTopButton, setShowScrollTopButton] = useState(false);

  type FaqItem = {
    id: string;
    question: string;
    answer: ReactNode;
  };
  type FaqSection = {
    id: string;
    title: string;
    items: FaqItem[];
  };

  const handleAnimateTitleIcon = useCallback(() => {
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
  }, [titleIconControls, titleIconGlowControls]);

  const anchorClass = 'scroll-mt-28 md:scroll-mt-32';
  const faqLinkClass =
    'font-semibold text-white/85 underline underline-offset-2 hover:text-white';
  const centerElementInViewport = useCallback((id: string, behavior: ScrollBehavior) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const headingAnchorOffset = Math.min(56, Math.max(0, rect.height / 3));
    const anchorY = rect.top + headingAnchorOffset;
    const targetTop = window.scrollY + anchorY - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, targetTop), behavior });
  }, []);
  const navigateToAnchor = useCallback(
    (id: string) => {
      if (!id) return;
      const nextHash = `#${id}`;
      if (location.hash === nextHash) {
        centerElementInViewport(id, 'smooth');
        return;
      }
      navigate({ pathname: location.pathname, hash: nextHash });
    },
    [centerElementInViewport, location.hash, location.pathname, navigate],
  );
  const handleScrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const renderSectionFlash = (sectionId: string) => (
    <AnimatePresence initial={false}>
      {flashSection?.id === sectionId ? (
        <motion.div
          key={`${flashSection.nonce}-${sectionId}-glow`}
          className="pointer-events-none absolute inset-0 rounded-3xl"
          initial={{ boxShadow: '0 0 0px rgba(250, 204, 21, 0)' }}
          animate={{
            boxShadow: [
              '0 0 0px rgba(250, 204, 21, 0)',
              '0 0 30px rgba(250, 204, 21, 0.5)',
              '0 0 0px rgba(250, 204, 21, 0)',
              '0 0 30px rgba(250, 204, 21, 0.5)',
              '0 0 0px rgba(250, 204, 21, 0)',
              '0 0 30px rgba(250, 204, 21, 0.5)',
              '0 0 0px rgba(250, 204, 21, 0)',
            ],
          }}
          exit={{ boxShadow: '0 0 0px rgba(250, 204, 21, 0)' }}
          transition={{ duration: 3.8, ease: 'easeInOut' }}
        />
      ) : null}
    </AnimatePresence>
  );

  useEffect(() => {
    if (!flashSection) return;
    const t = window.setTimeout(() => setFlashSection(null), 4200);
    return () => window.clearTimeout(t);
  }, [flashSection]);

  useEffect(() => {
    const updateScrollTopButton = () => {
      setShowScrollTopButton(window.scrollY > 280);
    };

    updateScrollTopButton();
    window.addEventListener('scroll', updateScrollTopButton, { passive: true });
    return () => window.removeEventListener('scroll', updateScrollTopButton);
  }, []);

  const FAQ_SECTIONS = useMemo<FaqSection[]>(() => [
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
                Immaculaterr is a Plex autopilot that watches your Plex activity, generates curated
                recommendation collections, and runs a few safety-focused cleanup jobs so your
                library stays tidy.
              </p>
              <p>
                It does not download media by itself. It can optionally send missing titles to
                Radarr/Sonarr or Seerr, which handle the request/download workflows.
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
                Radarr/Sonarr/Seerr, TMDB, optional Google/OpenAI).
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
                During initial setup, you already added Plex and TMDB API keys; those are enough
                to create Plex collections.
              </li>
              <li>
                Optionally configure Radarr/Sonarr and/or Seerr in Vault if you want missing-item
                requests.
              </li>
              <li>
                In Task Manager, choose your missing-item route per task card: direct ARR or
                Seerr.
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
              <p>If you use the built-in local HTTPS helper, both are available:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  HTTP: <code className="font-mono">http://&lt;server-ip&gt;:5454/</code>
                </li>
                <li>
                  HTTPS (local/LAN):{' '}
                  <code className="font-mono">https://&lt;server-ip&gt;:5464/</code>
                </li>
              </ul>
              <p>
                For local HTTPS update/setup steps, use{' '}
                <Link to="/setup#update-paths-https-sidecar" className={faqLinkClass}>
                  Setup - Optional HTTPS sidecar
                </Link>
                .
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'task-manager',
      title: 'Task Manager',
      items: [
        {
          id: 'task-manager-what-is',
          question: 'What is Task Manager for?',
          answer: (
            <>
              <p>
                Task Manager is the page where you decide when each job runs and whether it should
                run automatically.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Each card is a separate job.</li>
                <li>
                  <span className="font-semibold text-white/85">Run now</span> starts that job
                  manually.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Auto-Run</span> lets that card run
                  on a Plex trigger or on a schedule, depending on the job.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'task-manager-keep-it-simple',
          question: 'How do I keep Task Manager simple by default?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Leave most cards off until you know you want that automation.</li>
              <li>
                For scheduled cards, the built-in default times are already set to off-peak hours.
              </li>
              <li>
                For collection cards, direct{' '}
                <span className="font-semibold text-white/85">Radarr</span> /{' '}
                <span className="font-semibold text-white/85">Sonarr</span> fetch is the simplest
                path if you want missing-item requests.
              </li>
              <li>
                Only turn on{' '}
                <span className="font-semibold text-white/85">
                  Route missing items via Seerr
                </span>{' '}
                if you want Seerr to become the request workflow instead.
              </li>
              <li>
                Leave{' '}
                <span className="font-semibold text-white/85">
                  Approval required from Observatory
                </span>{' '}
                off unless you want to review each missing title first.
              </li>
              <li>
                Leave <span className="font-semibold text-white/85">Start search immediately</span>{' '}
                off unless you truly want instant ARR searching. Use{' '}
                <span className="font-semibold text-white/85">Search Monitored</span> for off-peak
                searching instead.
              </li>
            </ul>
          ),
        },
        {
          id: 'task-manager-run-types',
          question: 'What is the difference between manual runs, Plex-Triggered Auto-Run, and Scheduled Auto-Run?',
          answer: (
            <>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">Run now</span>: starts a job right
                  away when you press the button.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Plex-Triggered Auto-Run</span>:
                  waits for Plex activity such as a completed watch or newly added media.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Scheduled Auto-Run</span>: runs by
                  the clock at the time and cadence you set.
                </li>
              </ul>
              <p>
                In simple terms: manual runs are for testing or catch-up, Plex-triggered jobs react
                to activity, and scheduled jobs handle off-peak maintenance.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-schedule-controls',
          question: 'What do the schedule controls mean?',
          answer: (
            <>
              <p>Scheduled cards all use the same basic controls:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">Repeat</span>: choose{' '}
                  <span className="font-semibold text-white/85">Daily</span>,{' '}
                  <span className="font-semibold text-white/85">Weekly</span>, or{' '}
                  <span className="font-semibold text-white/85">Monthly</span>.
                </li>
                <li>
                  Weekly lets you choose one or more weekdays.
                </li>
                <li>
                  Monthly lets you choose dates <span className="font-semibold text-white/85">1-28</span>{' '}
                  so shorter months do not break the schedule.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Time</span>: the time of day for the
                  run.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Next Run</span>: shows the next
                  scheduled run and can expand to preview the next few runs.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'task-manager-run-now-seeds',
          question: 'Why do some Run now buttons ask for media type, title, and year?',
          answer: (
            <>
              <p>
                Only the collection-style cards need a seed when you run them manually. The dialog is
                letting you simulate the same kind of input the job would normally get from Plex.
              </p>
              <p>
                Enter the media type, the title, and optionally the year. The run then behaves like a
                manual watch-triggered request instead of a simple maintenance sweep.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-open-vault',
          question: 'Why is a task card blocked or sending me to Vault?',
          answer: (
            <>
              <p>
                Some jobs depend on Radarr, Sonarr, or Seerr being configured and reachable.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">Confirm Monitored</span> and{' '}
                  <span className="font-semibold text-white/85">Search Monitored</span> can block the
                  whole card if ARR is not ready.
                </li>
                <li>
                  Other cards usually stay usable, but trying to enable a missing integration toggle
                  opens a setup shortcut to Vault.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'task-manager-queue-and-cooldown',
          question: "Why don't tasks run at the same time?",
          answer: (
            <>
              <p>
                Tasks are intentionally serialized — only one task runs at a time. This prevents
                multiple jobs from hitting Plex and other external services simultaneously, which can
                cause errors or rate-limiting.
              </p>
              <p>
                Manual runs, schedules, Plex-triggered jobs, and Plex polling all feed into the same
                persisted FIFO queue.
              </p>
              <p>
                After a task finishes, there is a{' '}
                <span className="font-semibold text-white/85">1-minute cooldown</span> before the
                next queued task starts. This gives Plex and upstream services a short recovery window
                between runs.
              </p>
              <p>
                If a task is requested while another is already running or the cooldown is active, it
                is automatically queued as{' '}
                <span className="font-semibold text-white/85">Pending</span>. Pending tasks
                auto-start in order once the cooldown expires — no manual action is needed.
              </p>
              <p>
                Rewind now shows the live queue state, including queued time, ETA, blocked reason,
                delayed-run hints, and whether a hidden/internal task is currently ahead of you in
                line.
              </p>
              <p>
                If the app restarts, pending work stays queued and previously running work is marked
                failed so the queue can recover cleanly instead of getting stuck.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'task-manager-confirm-monitored',
      title: 'Confirm Monitored',
      items: [
        {
          id: 'task-manager-confirm-monitored-what-does',
          question: 'What does Confirm Monitored do?',
          answer: (
            <p>
              It keeps ARR monitoring aligned with what already exists in Plex. In simple English: if
              Plex already has the movie or the episode, this task helps stop Radarr or Sonarr from
              still treating that specific item like something that needs attention.
            </p>
          ),
        },
        {
          id: 'task-manager-confirm-monitored-when-use',
          question: 'When should I use Confirm Monitored?',
          answer: (
            <>
              <p>
                Use it as routine maintenance or after large imports, library moves, or cleanup work.
              </p>
              <p>
                If you want it running in the background, just enable its schedule and keep it on an
                off-peak time.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-confirm-monitored-settings',
          question: 'Does Confirm Monitored have any special settings?',
          answer: (
            <p>
              No. This card is intentionally simple: schedule it if you want automation, or use{' '}
              <span className="font-semibold text-white/85">Run now</span> when you want an immediate
              pass. It still needs Radarr or Sonarr to be available.
            </p>
          ),
        },
      ],
    },
    {
      id: 'task-manager-confirm-unmonitored',
      title: 'Confirm Unmonitored',
      items: [
        {
          id: 'task-manager-confirm-unmonitored-what-does',
          question: 'What does Confirm Unmonitored do?',
          answer: (
            <p>
              It checks Radarr movies that are already marked unmonitored and verifies they really
              exist in Plex. If a movie is unmonitored in Radarr but missing from every Plex movie
              library, this task re-monitors it so Radarr can pay attention to it again.
            </p>
          ),
        },
        {
          id: 'task-manager-confirm-unmonitored-when-use',
          question: 'When should I use Confirm Unmonitored?',
          answer: (
            <>
              <p>
                Use it after library rebuilds, large cleanups, storage moves, or anytime you suspect
                Radarr has stale unmonitored state.
              </p>
              <p>
                It is especially useful when you have a very large collection and want a deliberate
                maintenance pass instead of letting missing titles stay unmonitored quietly.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-confirm-unmonitored-settings',
          question: 'Does Confirm Unmonitored have any special settings?',
          answer: (
            <p>
              No. This card is intentionally manual-only. Use{' '}
              <span className="font-semibold text-white/85">Run now</span> when you want a full
              cross-check across all Plex movie libraries. It needs Plex and Radarr configured, and
              the report shows what stayed unmonitored, what was re-monitored, and what was skipped.
            </p>
          ),
        },
      ],
    },
    {
      id: 'task-manager-cleanup-after-adding-new-content',
      title: 'Cleanup After Adding New Content',
      items: [
        {
          id: 'task-manager-cleanup-what-does',
          question: 'What does Cleanup After Adding New Content do?',
          answer: (
            <p>
              This is the post-download cleanup card. It reacts to newly added Plex media and can run
              cleanup actions such as duplicate cleanup, ARR unmonitoring, and watchlist cleanup.
            </p>
          ),
        },
        {
          id: 'task-manager-cleanup-toggles',
          question: 'What do the cleanup toggles mean?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-semibold text-white/85">Delete duplicate media</span>: remove
                lower-quality duplicate files/versions via the Plex API, keeping the best copy. When
                off, no Plex media files are deleted.
              </li>
              <li>
                <span className="font-semibold text-white/85">
                  Unmonitor recently downloaded media
                </span>
                : stop ARR from continuing to monitor items that just landed.
              </li>
              <li>
                <span className="font-semibold text-white/85">
                  Remove recently added media from watchlist
                </span>
                : clear those newly satisfied items out of the watchlist flow.
              </li>
            </ul>
          ),
        },
        {
          id: 'task-manager-cleanup-auto-vs-run-now',
          question: 'What is the difference between Plex-Triggered Auto-Run and Run now for this card?',
          answer: (
            <>
              <p>
                <span className="font-semibold text-white/85">Plex-Triggered Auto-Run</span> reacts to
                new-media events from Plex.
              </p>
              <p>
                <span className="font-semibold text-white/85">Run now</span> is the broad catch-up
                option. It performs a full cleanup sweep across all libraries instead of waiting for a
                new-media event.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-cleanup-all-off',
          question: 'What happens if I turn every cleanup toggle off?',
          answer: (
            <p>
              The card can still run, but it behaves like a no-op. That is useful if you want to keep
              the card visible without having it perform cleanup actions.
            </p>
          ),
        },
      ],
    },
    {
      id: 'task-manager-search-monitored',
      title: 'Search Monitored',
      items: [
        {
          id: 'task-manager-search-monitored-what-does',
          question: 'What does Search Monitored do?',
          answer: (
            <p>
              It is the off-peak missing-search card for monitored ARR items. This is the scheduled
              place to let Radarr and Sonarr search for missing content instead of firing searches
              immediately.
            </p>
          ),
        },
        {
          id: 'task-manager-search-monitored-includes',
          question: 'What does the Includes section do?',
          answer: (
            <>
              <p>
                <span className="font-semibold text-white/85">Includes</span> lets you choose whether
                the scheduled run should target <span className="font-semibold text-white/85">Radarr</span>,{' '}
                <span className="font-semibold text-white/85">Sonarr</span>, or both.
              </p>
              <p>
                If both are enabled on a scheduled run, Sonarr starts about one hour after the
                scheduled time. Manual runs do not delay Sonarr. If an ARR service is not fully
                configured, turning that toggle on sends you to the matching Vault setup shortcut.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-search-monitored-vs-immediate',
          question: 'When should I use Search Monitored instead of Start search immediately?',
          answer: (
            <p>
              Use <span className="font-semibold text-white/85">Search Monitored</span> when you want
              missing searches to happen on a calmer schedule. Use{' '}
              <span className="font-semibold text-white/85">Start search immediately</span> only if you
              want ARR searching to begin as soon as a collection job adds missing titles.
            </p>
          ),
        },
      ],
    },
    {
      id: 'task-manager-tmdb-upcoming-movies',
      title: 'TMDB Upcoming Movies',
      items: [
        {
          id: 'task-manager-tmdb-upcoming-how-it-works',
          question: 'How does TMDB Upcoming Movies work?',
          answer: (
            <>
              <p>
                This task finds upcoming movies from TMDB and routes selected titles to Radarr or
                Seerr.
              </p>
              <p>Run flow:</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  Every enabled filter set runs a TMDB discover query inside the configured date
                  window.
                </li>
                <li>Results are merged, deduplicated by TMDB id, and ranked by popularity.</li>
                <li>
                  The final list is capped by your global limit and then sent to your selected route.
                </li>
              </ol>
            </>
          ),
        },
        {
          id: 'task-manager-tmdb-upcoming-defaults',
          question: 'What are the defaults if I do not create custom filters?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                A hidden baseline filter is used (no genre, language, certification, or watch-provider
                restrictions).
              </li>
              <li>
                Score min defaults to <span className="font-semibold text-white/85">6</span> and score
                max is fixed at <span className="font-semibold text-white/85">10</span>.
              </li>
              <li>
                Window defaults to <span className="font-semibold text-white/85">today through +2 months</span>.
              </li>
              <li>
                Global limit defaults to <span className="font-semibold text-white/85">100</span> (you
                can raise it up to <span className="font-semibold text-white/85">1000</span>).
              </li>
              <li>
                Route defaults to <span className="font-semibold text-white/85">Radarr</span> unless
                you turn on Seerr routing.
              </li>
            </ul>
          ),
        },
        {
          id: 'task-manager-tmdb-upcoming-custom-filters',
          question: 'How do I set custom filters on this card?',
          answer: (
            <>
              <p>
                Open the card, go to <span className="font-semibold text-white/85">Filter sets</span>,
                press <span className="font-semibold text-white/85">Add filter</span>, then edit that
                filter.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Name and enable/disable each filter set independently.</li>
                <li>
                  When you press <span className="font-semibold text-white/85">Add filter</span>, the UI
                  scrolls to the new filter and focuses its name so you can rename immediately.
                </li>
                <li>
                  Only one new pending filter can be created at a time until you leave that new filter
                  name field.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Genres</span> use match-any behavior
                  (OR): selecting multiple genres matches titles with any selected genre.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Languages</span> allow one language per
                  filter (deselect first to pick a different one).
                </li>
                <li>
                  Add optional <span className="font-semibold text-white/85">Certifications (US)</span>{' '}
                  and set score min (score max stays fixed at 10).
                </li>
                <li>
                  <span className="font-semibold text-white/85">Where to watch</span> values are
                  currently ignored by TMDB Upcoming discovery (leave them empty for expected
                  behavior).
                </li>
                <li>
                  Keep filters focused; multiple broad filters can overlap heavily and reduce unique
                  output.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'task-manager-tmdb-upcoming-expected-results',
          question: 'What results should I expect after a run?',
          answer: (
            <>
              <p>
                Each enabled filter gets part of the global limit. All candidates are then merged,
                deduplicated, ranked, and routed.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>If a destination reports “already exists,” the job can backfill with reserves.</li>
                <li>If all custom filters are disabled, the hidden baseline runs instead.</li>
                <li>
                  Rewind shows per-filter discovered/selected counts and destination outcomes so you can
                  tune filters.
                </li>
                <li>
                  Rewind keeps the run title as{' '}
                  <span className="font-semibold text-white/85">TMDB Upcoming Movies</span> for this
                  job.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      id: 'task-manager-rotten-tomatoes-upcoming-movies',
      title: 'Rotten Tomatoes Upcoming Movies',
      items: [
        {
          id: 'task-manager-rotten-tomatoes-upcoming-how-it-works',
          question: 'How does Rotten Tomatoes Upcoming Movies work?',
          answer: (
            <>
              <p>
                This task scrapes fixed Rotten Tomatoes upcoming and newest movie pages, merges the
                results, and routes safe matches to Radarr or, when enabled, to Seerr.
              </p>
              <p>Run flow:</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Immaculaterr fetches each built-in Rotten Tomatoes source page.</li>
                <li>
                  Movie cards are parsed from the page HTML, then deduplicated by normalized title and
                  year.
                </li>
                <li>
                  Radarr is checked once up front, then each candidate is matched conservatively before
                  it is added to Radarr or requested in Seerr.
                </li>
              </ol>
            </>
          ),
        },
        {
          id: 'task-manager-rotten-tomatoes-upcoming-sources',
          question: 'What sources does it check?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>One Rotten Tomatoes in-theaters newest page.</li>
              <li>
                Eleven Rotten Tomatoes at-home newest pages for Fandango at Home, Apple TV+, Netflix,
                Prime Video, Disney+, Max, Peacock, Hulu, Paramount+, AMC+, and Acorn TV.
              </li>
              <li>
                These URLs are fixed in code for this task, so there is no custom source editor on the
                card.
              </li>
              <li>
                If one source page fails, the run keeps going and reports that source as skipped.
              </li>
            </ul>
          ),
        },
        {
          id: 'task-manager-rotten-tomatoes-upcoming-route-via-seerr',
          question: 'What does the Route via Seerr toggle do?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                When the toggle is off, matched movies are added directly to Radarr with the app’s
                saved Radarr defaults.
              </li>
              <li>
                When the toggle is on, matched movies are requested in Seerr instead of being added
                directly to Radarr.
              </li>
              <li>
                Rotten Tomatoes titles are still matched conservatively through Radarr lookup first,
                so Seerr requests only happen for safe title and year matches.
              </li>
              <li>
                If Seerr routing is enabled but Seerr is not configured, discovery still completes and
                the destination step is marked skipped.
              </li>
            </ul>
          ),
        },
        {
          id: 'task-manager-rotten-tomatoes-upcoming-results',
          question: 'What results should I expect after a run?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Movies already present in Radarr, or already present/requested in Seerr, are counted as
                existing instead of surfacing as hard failures.
              </li>
              <li>
                If Radarr is not configured, discovery still completes and the destination step is
                marked skipped. If Seerr routing is enabled but Seerr is not configured, the routing
                step is skipped too.
              </li>
              <li>
                Rewind shows source-page counts plus destination outcomes for attempted, requested or
                added, existing, failed, and skipped movies.
              </li>
              <li>
                This task does not use TMDB filters. Seerr routing is optional, but safe matching still
                relies on Radarr lookup.
              </li>
            </ul>
          ),
        },
      ],
    },
    {
      id: 'task-manager-immaculate-taste-collection',
      title: 'Immaculate Taste Collection',
      items: [
        {
          id: 'task-manager-immaculate-collection-what-does',
          question: 'What does Immaculate Taste Collection do?',
          answer: (
            <>
              <p>
                This is the watch-triggered Immaculate Taste updater. After you finish watching, it
                updates the taste dataset, refreshes the recommendation pool, and can optionally route
                missing titles to Radarr, Sonarr, or Seerr.
              </p>
              <p>
                It is the main card for growing and updating the Immaculate Taste pipeline.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-immaculate-collection-refresher-toggle',
          question: 'What does the Immaculate Taste Refresher toggle do?',
          answer: (
            <>
              <p>
                It chains the follow-up refresher after this watch-triggered update so the saved
                dataset can rebuild the <span className="font-semibold text-white/85">Inspired by your
                Immaculate Taste</span> collection.
              </p>
              <p>
                If you turn this off, you can still run or schedule the separate{' '}
                <span className="font-semibold text-white/85">Immaculate Taste Refresher</span> card
                on its own.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-immaculate-collection-fetch-missing',
          question: 'What does Fetch Missing items do on this card?',
          answer: (
            <p>
              It allows missing Immaculate Taste suggestions to leave Immaculaterr. In direct ARR mode,
              movies can go to Radarr and shows can go to Sonarr. If you leave these toggles off, the
              card still creates suggestions and tracking data, but it does not send missing items out
              for requests.
            </p>
          ),
        },
        {
          id: 'task-manager-immaculate-collection-start-search',
          question: 'When should I use Start search immediately?',
          answer: (
            <>
              <p>
                Turn it on only if you want Radarr or Sonarr to start searching as soon as this card
                adds missing titles.
              </p>
              <p>
                If you prefer calmer, off-peak searching, leave it off and use{' '}
                <span className="font-semibold text-white/85">Search Monitored</span> instead. The UI
                even offers that option when you enable this toggle.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-immaculate-collection-approval',
          question: 'What does Approval required from Observatory do?',
          answer: (
            <>
              <p>
                It adds a review step before direct ARR requests are sent. Missing titles stay pending
                until you swipe right on them in Observatory.
              </p>
              <p>
                This only applies to direct ARR mode. If you switch the task to Seerr routing,
                approval mode turns off for this card.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-immaculate-collection-seerr',
          question: 'What changes when I turn on Route missing items via Seerr?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>New missing items are requested in Seerr instead of being sent directly to ARR.</li>
              <li>Direct Radarr and Sonarr fetch toggles are turned off for this card.</li>
              <li>
                <span className="font-semibold text-white/85">Start search immediately</span> is turned
                off.
              </li>
              <li>
                <span className="font-semibold text-white/85">
                  Approval required from Observatory
                </span>{' '}
                is turned off.
              </li>
            </ul>
          ),
        },
        {
          id: 'task-manager-immaculate-collection-run-now',
          question: 'Why does Run now ask for media type, title, and year on this card?',
          answer: (
            <>
              <p>
                Manual runs on this card simulate a watch-triggered seed. You choose the media type,
                enter the title, and optionally provide the year so Immaculaterr knows what you want it
                to build from.
              </p>
              <p>
                Expect a real collection-style run, not just a quick health check.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'task-manager-immaculate-taste-refresher',
      title: 'Immaculate Taste Refresher',
      items: [
        {
          id: 'task-manager-immaculate-refresher-what-does',
          question: 'What does Immaculate Taste Refresher do?',
          answer: (
            <p>
              It is the off-peak rebuild card for the Immaculate Taste collection. It revisits the
              saved dataset across eligible libraries, promotes items that are now available in Plex,
              and refreshes the managed collection.
            </p>
          ),
        },
        {
          id: 'task-manager-immaculate-refresher-when-use',
          question: 'When should I use the separate refresher card if the collection card already has a refresher toggle?',
          answer: (
            <>
              <p>
                Use the separate card when you want a standalone scheduled rebuild, even when no recent
                watch event happened.
              </p>
              <p>
                The toggle on the collection card is only for chaining a refresher right after that
                card runs.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-immaculate-refresher-default',
          question: 'What is a good default setup for Immaculate Taste Refresher?',
          answer: (
            <p>
              If you want background upkeep, enable the schedule and keep it on an off-peak time. If
              you prefer more control, leave it off and use{' '}
              <span className="font-semibold text-white/85">Run now</span> only when you want a manual
              rebuild.
            </p>
          ),
        },
      ],
    },
    {
      id: 'task-manager-based-on-latest-watched-collection',
      title: 'Based on Latest Watched Collection',
      items: [
        {
          id: 'task-manager-latest-watched-collection-what-does',
          question: 'What does Based on Latest Watched Collection do?',
          answer: (
            <p>
              This is the watch-triggered recommendation-builder for the latest thing you watched. It
              turns that seed into fresh suggestions, updates the saved dataset, and can optionally send
              missing titles out for requests.
            </p>
          ),
        },
        {
          id: 'task-manager-latest-watched-collection-fetch-missing',
          question: 'What does Fetch Missing items do on this card?',
          answer: (
            <p>
              It allows missing recommendations from this flow to go directly to Radarr or Sonarr. If
              you leave these toggles off, the card still builds recommendations and tracks pending
              items, but it does not send them anywhere.
            </p>
          ),
        },
        {
          id: 'task-manager-latest-watched-collection-approval',
          question: 'What does Approval required from Observatory do here?',
          answer: (
            <>
              <p>
                It adds a review step before direct ARR requests are sent. Missing titles stay pending
                until you approve them in Observatory.
              </p>
              <p>
                Like the Immaculate Taste card, this only applies to direct ARR mode.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-latest-watched-collection-seerr',
          question: 'What changes when I turn on Route missing items via Seerr?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Missing titles are sent to Seerr instead of directly to ARR.</li>
              <li>Direct Radarr and Sonarr fetch toggles are turned off for this card.</li>
              <li>
                <span className="font-semibold text-white/85">
                  Approval required from Observatory
                </span>{' '}
                is turned off.
              </li>
            </ul>
          ),
        },
        {
          id: 'task-manager-latest-watched-collection-run-now',
          question: 'Why does Run now ask for media type, title, and year on this card?',
          answer: (
            <>
              <p>
                Manual runs on this card also simulate a watch-triggered seed. Enter the item you want
                to build from, and Immaculaterr runs the latest-watched flow as if that watch event had
                just happened.
              </p>
              <p>
                Expect a full recommendation run rather than a simple maintenance task.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'task-manager-based-on-latest-watched-refresher',
      title: 'Based on Latest Watched Refresher',
      items: [
        {
          id: 'task-manager-latest-watched-refresher-what-does',
          question: 'What does Based on Latest Watched Refresher do?',
          answer: (
            <p>
              It is the off-peak refresh card for the latest-watched style collections. It revisits the
              saved dataset, promotes titles that have become available in Plex, reshuffles the active
              set, and rebuilds the managed rows.
            </p>
          ),
        },
        {
          id: 'task-manager-latest-watched-refresher-vs-collection',
          question: 'When should I use this refresher instead of the collection card?',
          answer: (
            <>
              <p>
                Use the collection card when you want a fresh run based on a new watch event.
              </p>
              <p>
                Use the refresher when you want the saved latest-watched datasets to catch up and
                reshuffle without waiting for a new trigger.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-latest-watched-refresher-default',
          question: 'What is a good default setup for Based on Latest Watched Refresher?',
          answer: (
            <p>
              If you want regular background upkeep, enable the schedule and keep it off-peak. If not,
              leave it off and run it manually when you want a refresh.
            </p>
          ),
        },
      ],
    },
    {
      id: 'task-manager-fresh-out-of-the-oven',
      title: 'Fresh Out Of The Oven',
      items: [
        {
          id: 'task-manager-fresh-out-of-the-oven-what-does',
          question: 'What does Fresh Out Of The Oven do?',
          answer: (
            <>
              <p>
                It builds shared Fresh Out baselines from your selected Plex movie and TV libraries
                using TMDB release dates for the last 3 months, then filters those baselines per Plex
                user so each viewer only gets movies and shows they have not already watched.
              </p>
              <p>
                Movies and shows can be toggled independently inside the task card, and each user gets
                their own Fresh Out collections refreshed on every run.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-fresh-out-of-the-oven-pinning',
          question: 'Where does Fresh Out Of The Oven pin in Plex?',
          answer: (
            <>
              <p>
                Admin gets this row on Plex Home only. Shared users get it on Shared Home only.
              </p>
              <p>
                Fresh Out never pins to Library Recommended. The movie row stays after the other
                Immaculaterr-managed movie rows, and the TV row stays after the other
                Immaculaterr-managed TV rows.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-fresh-out-of-the-oven-default',
          question: 'What is a good default setup for Fresh Out Of The Oven?',
          answer: (
            <p>
              Daily off-peak with both Movies and Shows enabled is a good default because it keeps new
              releases and premieres flowing in while removing anything a user has already watched. If
              you prefer manual control, leave the schedule off and use{' '}
              <span className="font-semibold text-white/85">Run now</span> after big library updates.
            </p>
          ),
        },
      ],
    },
    {
      id: 'task-manager-import-plex-history',
      title: 'Plex Watch History Import',
      items: [
        {
          id: 'task-manager-import-plex-what-does',
          question: 'What does Plex Watch History Import do?',
          answer: (
            <>
              <p>
                It scans your Plex server&apos;s watched history and feeds it into the same
                recommendation pipeline as your normal Plex-triggered activity. The import runs
                through a multi-phase pipeline:
              </p>
              <ol className="mt-3 space-y-1.5 list-decimal list-inside text-white/60">
                <li>
                  <span className="font-semibold text-white/85">Fetch</span> — watched movies and
                  TV shows are retrieved from your Plex server library sections.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Classification</span> — each title
                  is looked up via TMDB and classified as a movie or TV show.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Recommendation generation</span> —
                  for each classified title (up to 50 per run), similar and change-of-taste
                  recommendations are generated using the same engine as Plex-triggered flows.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Aggregation</span> — all generated
                  recommendations are merged, deduplicated by TMDB ID, and capped to the configured
                  collection limit.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Plex History collections</span> —
                  aggregated results are written to dedicated Plex History Picks and Plex History:
                  Change of Taste Plex collections.
                </li>
                <li>
                  <span className="font-semibold text-white/85">
                    Recently Watched / Change of Taste sync
                  </span>{' '}
                  — the same recommendations are additively injected into the standard Based on your
                  recently watched and Change of Taste collections, preserving any existing rows from
                  Plex-triggered runs.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Immaculate Taste sync</span> — the
                  Immaculate Taste points system is updated so your full watch history influences the
                  long-lived taste profile. The next Immaculate Taste Refresher run rebuilds the Plex
                  collection with this data included.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Plex collection rebuild</span> —
                  all affected Plex collections are rebuilt, reordered, and pinned.
                </li>
              </ol>
            </>
          ),
        },
        {
          id: 'task-manager-import-plex-collections',
          question: 'What Plex collections does the import affect?',
          answer: (
            <>
              <p>The import touches several collection families:</p>
              <ul className="mt-3 space-y-1.5 list-disc list-inside text-white/60">
                <li>
                  <span className="font-semibold text-white/85">Plex History Picks</span> and{' '}
                  <span className="font-semibold text-white/85">
                    Plex History: Change of Taste
                  </span>{' '}
                  — dedicated Plex history collections that are fully replaced each run.
                </li>
                <li>
                  <span className="font-semibold text-white/85">
                    Based on your recently watched Movie/Show
                  </span>{' '}
                  — Plex history recommendations are merged in additively alongside your existing
                  Plex-triggered rows.
                </li>
                <li>
                  <span className="font-semibold text-white/85">
                    Change of Movie/Show Taste
                  </span>{' '}
                  — same additive merge for change-of-taste recommendations.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Immaculate Taste</span> — the
                  points dataset is updated in the background. The visible Plex collection rebuilds
                  on the next Immaculate Taste Refresher run (scheduled or manual).
                </li>
              </ul>
              <p className="mt-3">
                Additive means existing rows from Plex-triggered runs are preserved — only genuinely
                new recommendations are inserted.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-import-plex-rerun',
          question: 'What happens if I run it again?',
          answer: (
            <p>
              Titles that were already imported are skipped automatically. Only genuinely new titles
              from your Plex watch history are processed. The report shows exactly which seed titles
              were used for recommendations.
            </p>
          ),
        },
        {
          id: 'task-manager-import-plex-seed-cap',
          question: 'What happens if I have more than 50 watched titles?',
          answer: (
            <p>
              Each run processes up to 50 unique classified titles. If your history contains more,
              the remaining titles stay as pending entries in the database. Run the import again from
              Task Manager to process the next batch. Already-processed titles are skipped
              automatically.
            </p>
          ),
        },
        {
          id: 'task-manager-import-plex-global-lock',
          question: 'Why are other tasks blocked while the import is running?',
          answer: (
            <p>
              The import follows the same shared job queue as every other task. Because it
              makes many TMDB API calls and generates recommendations for every seed, it can take
              longer than most tasks. While it runs, other tasks queue as{' '}
              <span className="font-semibold text-white/85">Pending</span> and auto-start once the
              import finishes and the 1-minute cooldown expires. Rewind shows the live queue state
              and ETA while you wait.
            </p>
          ),
        },
        {
          id: 'task-manager-import-plex-manual-only',
          question: 'Can this task run automatically?',
          answer: (
            <p>
              No. Plex Watch History Import is manual-only — you must trigger it from the Task
              Manager card or opt in during onboarding. There is no schedule or Plex-triggered
              auto-run for this task.
            </p>
          ),
        },
        {
          id: 'task-manager-import-plex-seed-titles',
          question: 'How do I see which titles were used as seeds?',
          answer: (
            <p>
              Open the job report after a run — it includes a Seed Titles section listing every
              movie and TV show from your watch history that was matched via TMDB and used as a
              recommendation seed.
            </p>
          ),
        },
      ],
    },
    {
      id: 'task-manager-import-netflix-history',
      title: 'Netflix Watch History Import',
      items: [
        {
          id: 'task-manager-import-netflix-what-does',
          question: 'What does Netflix Watch History Import do?',
          answer: (
            <>
              <p>
                It lets you upload a Netflix viewing-history CSV so that your external watch history
                feeds into the same recommendation pipeline as your Plex activity. The import runs
                through a multi-phase pipeline:
              </p>
              <ol className="mt-3 space-y-1.5 list-decimal list-inside text-white/60">
                <li>
                  <span className="font-semibold text-white/85">Classification</span> — each Netflix
                  title is looked up via TMDB and classified as a movie or TV show.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Recommendation generation</span> — for
                  each classified title (up to 50 per run), similar and change-of-taste recommendations
                  are generated using the same engine as Plex-triggered flows.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Aggregation</span> — all generated
                  recommendations are merged, deduplicated by TMDB ID, and capped to the configured
                  collection limit.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Netflix collections</span> — aggregated
                  results are written to dedicated Netflix Import Picks and Netflix Import: Change of
                  Taste Plex collections.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Recently Watched / Change of Taste sync</span>{' '}
                  — the same recommendations are additively injected into the standard Based on your
                  recently watched and Change of Taste collections, preserving any existing rows from
                  Plex-triggered runs.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Immaculate Taste sync</span> — the
                  Immaculate Taste points system is updated so your Netflix history influences the
                  long-lived taste profile. The next Immaculate Taste Refresher run rebuilds the Plex
                  collection with this data included.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Plex collection rebuild</span> — all
                  affected Plex collections are rebuilt, reordered, and pinned.
                </li>
              </ol>
            </>
          ),
        },
        {
          id: 'task-manager-import-netflix-how-csv',
          question: 'Where do I get the Netflix CSV file?',
          answer: (
            <>
              <p>
                Log in to Netflix on a browser, go to{' '}
                <span className="font-semibold text-white/85">Account → Profile → Viewing Activity</span>,
                then click <span className="font-semibold text-white/85">Download All</span> at the bottom
                of the page. You will receive a CSV with two columns:{' '}
                <span className="text-white/85">Title</span> and{' '}
                <span className="text-white/85">Date</span>.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-import-netflix-collections',
          question: 'What Plex collections does the import affect?',
          answer: (
            <>
              <p>The import touches several collection families:</p>
              <ul className="mt-3 space-y-1.5 list-disc list-inside text-white/60">
                <li>
                  <span className="font-semibold text-white/85">Netflix Import Picks</span> and{' '}
                  <span className="font-semibold text-white/85">Netflix Import: Change of Taste</span>{' '}
                  — dedicated Netflix collections that are fully replaced each run.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Based on your recently watched Movie/Show</span>{' '}
                  — Netflix recommendations are merged in additively alongside your existing
                  Plex-triggered rows.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Change of Movie/Show Taste</span>{' '}
                  — same additive merge for change-of-taste recommendations.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Immaculate Taste</span>{' '}
                  — the points dataset is updated in the background. The visible Plex collection
                  rebuilds on the next Immaculate Taste Refresher run (scheduled or manual).
                </li>
              </ul>
              <p className="mt-3">
                Additive means existing rows from Plex-triggered runs are preserved — only genuinely
                new recommendations are inserted.
              </p>
            </>
          ),
        },
        {
          id: 'task-manager-import-netflix-reupload',
          question: 'What happens if I upload the same file again?',
          answer: (
            <p>
              Titles that were already imported are skipped automatically. Only genuinely new titles
              are inserted as pending entries and processed. The response tells you exactly how many
              were new vs already imported, and no job is enqueued if nothing is new.
            </p>
          ),
        },
        {
          id: 'task-manager-import-netflix-seed-cap',
          question: 'What happens if I have more than 50 Netflix titles?',
          answer: (
            <p>
              Each run processes up to 50 unique classified titles. If your CSV contains more, the
              remaining titles stay as pending entries in the database. Re-upload or run the import
              again from Task Manager to process the next batch. Already-processed titles are skipped
              automatically, so you can safely re-upload the same file.
            </p>
          ),
        },
        {
          id: 'task-manager-import-netflix-global-lock',
          question: 'Why are other tasks blocked while the import is running?',
          answer: (
            <p>
              The import follows the same shared job queue as every other task. Because it
              makes many TMDB API calls and generates recommendations for every seed, it can take
              longer than most tasks. While it runs, other tasks queue as{' '}
              <span className="font-semibold text-white/85">Pending</span> and auto-start once
              the import finishes and the 1-minute cooldown expires. Rewind shows the live queue
              state and ETA while you wait.
            </p>
          ),
        },
        {
          id: 'task-manager-import-netflix-manual-only',
          question: 'Can this task run automatically?',
          answer: (
            <p>
              No. Netflix Watch History Import is manual-only — you must upload a CSV each time via
              the wizard during onboarding or from the Task Manager card. There is no schedule or
              Plex-triggered auto-run for this task.
            </p>
          ),
        },
      ],
    },
    {
      id: 'recommendations',
      title: 'Recommendations',
      items: [
        {
          id: 'recommendations-what-controls',
          question: 'What does Recommendations control?',
          answer: (
            <>
              <p>
                Recommendations is the part of Immaculaterr that decides how seed-based suggestions
                are built and what kind of release mix you get back.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>TMDB is always the starting point for candidate titles.</li>
                <li>
                  If Google and/or OpenAI are enabled in Vault, they can widen discovery or refine
                  the final list.
                </li>
                <li>
                  The current-vs-future release dial changes how much of the final mix leans toward
                  titles you can watch now versus upcoming titles.
                </li>
                <li>
                  Task Manager still decides whether missing titles stay tracked, go directly to ARR,
                  or route through Seerr.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'automation-plex-triggered',
          question: 'What does "Plex-Triggered Auto-Run" mean?',
          answer: (
            <>
              <p>
                Plex-Triggered Auto-Run means the job waits for Plex activity instead of a
                clock-based schedule.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  These jobs do not run on a timer. They wait for the matching Plex event.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Watched trigger (~60% / ~70%):</span>{' '}
                  these are default Plex polling thresholds—~60% for "Based on your recently watched"
                  and ~70% for Immaculate Taste. Immaculate Taste can also trigger via Plex webhooks
                  at Plex scrobble timing.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Repeat-watch dedupe:</span> once one
                  of these auto-runs completes successfully for the same Plex user, library, and
                  exact movie/episode, repeated watches of that same item are skipped automatically.
                  Manual runs still work any time.
                </li>
                <li>
                  <span className="font-semibold text-white/85">New content trigger:</span> when a
                  new movie or show episode is added, the cleanup task can trigger to scan for
                  duplicates.
                </li>
              </ul>
              <p>You can still run these tasks manually any time from Task Manager.</p>
            </>
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
                dataset, move items from pending to active when they appear in Plex, shuffle active
                items, and rebuild collections cleanly.
              </p>
              <p>
                Collection-triggered refreshes stay scoped to the triggering viewer/library, while
                standalone refresher runs sweep all eligible viewers/libraries.
              </p>
            </>
          ),
        },
        {
          id: 'collections-what-creates',
          question: 'What Plex collections does the app create?',
          answer: (
            <>
              <p>Current base collection names are:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Based on your recently watched Movie</li>
                <li>Change of Movie Taste</li>
                <li>Inspired by your Immaculate Taste in Movies</li>
                <li>Based on your recently watched Show</li>
                <li>Change of Show Taste</li>
                <li>Inspired by your Immaculate Taste in Shows</li>
              </ul>
              <p>
                When multiple Plex users are monitored, Immaculaterr appends the viewer name so each
                person gets a separate row.
              </p>
            </>
          ),
        },
        {
          id: 'collections-how-generated',
          question: 'How are recommendation titles generated?',
          answer: (
            <>
              <p>
                Recommendation runs now use a richer TMDB-based ranking flow instead of simple
                heuristic scoring.
              </p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">Seed profile:</span> the watched
                  title, manual seed, or imported history title is resolved and profiled with extra
                  language and origin hints when available.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Candidate lanes:</span> TMDB pulls
                  fuller metadata and builds the normal candidate pool plus wildcard lanes for
                  global-language films and hidden gems.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Ranking engine:</span> candidates
                  are scored across four main signals: content similarity, quality, novelty, and
                  indie/popularity value.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Contextual weights:</span> the
                  weights change by intent, so latest-watched and change-of-taste runs rank
                  differently, including different released vs. upcoming balance.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Interleaving:</span> the final list
                  mixes primary picks with wildcard titles so the set stays relevant while still
                  surfacing surprises.
                </li>
              </ol>
              <p className="mt-3">
                If Google or OpenAI are enabled, they can still widen or curate the pool, but the
                core ranking now follows the flow above.
              </p>
            </>
          ),
        },
        {
          id: 'collections-upcoming-ratio',
          question: 'What does the ratio of future releases vs current releases do?',
          answer: (
            <>
              <p>
                This dial lives in <span className="font-semibold text-white/85">Command Center - Recommendations</span>.
                It controls how many suggestions are:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">Current releases</span>: already
                  released and typically available to watch now
                </li>
                <li>
                  <span className="font-semibold text-white/85">Future releases</span>: upcoming
                  titles that may not be released yet
                </li>
              </ul>
              <p>
                The system enforces that released stays at least{' '}
                <span className="font-semibold text-white/85">25%</span>, so upcoming is effectively
                capped.
              </p>
            </>
          ),
        },
        {
          id: 'collections-missing-in-plex',
          question: 'What happens when a recommended title isn&apos;t in Plex?',
          answer: (
            <>
              <p>
                It is recorded as <span className="font-semibold text-white/85">pending</span>.
                Pending items can later become active once they appear in Plex.
              </p>
              <p>
                If the job is allowed to fetch missing items, Immaculaterr can send those missing
                titles to Radarr/Sonarr directly or route them to Seerr, depending on your task
                settings.
              </p>
            </>
          ),
        },
        {
          id: 'collections-pending-to-active',
          question: 'How does the refresher move items from pending to active?',
          answer: (
            <p>
              On refresh, Immaculaterr checks pending titles against Plex. If a title is now found in
              Plex, it is marked active and becomes eligible for the collection rebuild.
            </p>
          ),
        },
        {
          id: 'collections-not-enabled-skipped',
          question: 'Why do I see "not enabled" or "skipped"?',
          answer: (
            <p>
              Those cards are always shown for transparency. "Not enabled" means you did not
              configure that integration. "Skipped" means the job strategy did not need that service
              for this run.
            </p>
          ),
        },
        {
          id: 'collections-why-recreate',
          question: 'Why does the app recreate Plex collections instead of editing them in place?',
          answer: (
            <>
              <p>
                This normally should not create duplicate collections. Immaculaterr keeps track of
                the Plex collections it created and updates those tracked collections over time.
              </p>
              <p>
                Duplicates usually happen only when app state is lost (for example, app data is
                corrupted, or the app is removed and reinstalled). In that case, a fresh install may
                not be able to link to previously existing Immaculaterr-managed collections.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'plex-library-selection',
      title: 'Plex Library Selection',
      items: [
        {
          id: 'automation-library-selection-impact',
          question: 'How does Plex Library Selection affect auto-runs and manual runs?',
          answer: (
            <>
              <p>
                After setup, you can choose which movie/show libraries Immaculaterr is allowed to use.
                You can update this any time from{' '}
                <Link
                  to="/command-center#command-center-plex-library-selection"
                  className={faqLinkClass}
                >
                  Command Center - Plex Library Selection
                </Link>
                .
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Auto-runs and manual runs only use selected libraries.</li>
                <li>
                  If a run targets a library you turned off, that part is skipped instead of failing
                  the whole job.
                </li>
                <li>
                  If no selected libraries are available for that media type, the run shows a clear
                  skipped reason in the report.
                </li>
                <li>
                  When you save after de-selecting a library, Immaculaterr warns you because that
                  library&apos;s dataset is removed and its curated collections are removed from Plex.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      id: 'plex-user-monitoring',
      title: 'Plex User Monitoring',
      items: [
        {
          id: 'plex-user-monitoring-what-does',
          question: 'What does Plex User Monitoring do?',
          answer: (
            <>
              <p>
                Plex User Monitoring decides which Plex accounts can trigger recommendation runs and
                receive viewer-specific rows.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Each monitored viewer gets a separate dataset.</li>
                <li>One person&apos;s watch habits do not change another person&apos;s suggestions.</li>
                <li>If you stop monitoring a user, future triggers from that user stop immediately.</li>
                <li>
                  When saving the change, Immaculaterr lets you decide whether to keep or remove that
                  user&apos;s existing managed collections.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'collections-viewer-pinning',
          question: 'How do per-viewer collections and Plex pin locations work?',
          answer: (
            <>
              <p>
                Per-viewer collections do two things: they keep each viewer&apos;s recommendations
                separate, and they pin each viewer&apos;s rows to the right Plex surface.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Each monitored viewer gets a separate dataset, so one person&apos;s watch habits do not
                  change another person&apos;s suggestions.
                </li>
                <li>Admin viewer rows are pinned to Library Recommended and Home.</li>
                <li>Shared-user rows are pinned to Friends Home.</li>
                <li>
                  The row order stays consistent: Based on your recently watched, then Change of
                  Taste, then Inspired by your Immaculate Taste.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      id: 'immaculate-taste-profiles',
      title: 'Immaculate Taste Profiles',
      items: [
        {
          id: 'collections-immaculate-vs-watched',
          question: 'What&apos;s the difference between "Immaculate Taste" and "Based on Latest Watched"?',
          answer: (
            <>
              <p>
                Immaculate Taste is a longer-lived taste-profile collection that refreshes over time.
              </p>
              <p>
                Based on Latest Watched is more immediate: it uses your recent watch as a seed,
                generates suggestions, tracks pending/active items, and refreshes as titles become
                available.
              </p>
            </>
          ),
        },
        {
          id: 'collections-immaculate-how',
          question: 'How does the Immaculate Taste collection work?',
          answer: (
            <>
              <p>
                Immaculate Taste is a long-lived per-library suggestion system. You can run it in
                simple one-lane mode or switch to profile-based lanes for finer control.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">Default mode:</span> one shared rule
                  set keeps behavior straightforward.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Profile mode:</span> each profile can
                  define user scope, media type, include/exclude filters, collection naming, and
                  ARR/Seerr routing.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Deterministic matching:</span>{' '}
                  profiles are evaluated in order, excluded filters win, and unmatched seeds are
                  skipped and logged.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Same lifecycle:</span> suggestions
                  are tracked as active or pending, then refresher runs promote and rebuild as items
                  appear in Plex.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'collections-profiles-smart-filters',
          question: 'What are Immaculate Taste profiles and smart filters, and when should I use them?',
          answer: (
            <>
              <p>
                Profiles are the advanced way to split Immaculate Taste into multiple lanes instead
                of using one shared rule set.
              </p>
              <p>
                Use profiles when you want different rules for different users, media types, or
                filter sets. If one shared lane is enough, you can stay with the default mode.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>If no users are selected, the profile applies to all monitored Plex users.</li>
                <li>Included genres or languages act as allowlists.</li>
                <li>
                  "Match any filter" means an included genre or language can match. "Match all
                  filters" means every enabled include group must match.
                </li>
                <li>Excluded filters always win over included filters.</li>
                <li>If no enabled profile matches, the run is skipped and logged in Rewind.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'collections-profile-user-scope-editing',
          question: 'How does User scope editing work (All users vs selected user)?',
          answer: (
            <>
              <p>
                In the profile editor, the selected chip in{' '}
                <span className="font-semibold text-white/85">User scope</span> decides which
                settings you are editing.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">All users</span> edits shared
                  profile settings for everyone currently in scope.
                </li>
                <li>
                  Clicking a user chip edits that user&apos;s scoped override only.
                </li>
                <li>
                  Adding a user from search auto-selects that user so settings are ready to
                  customize immediately.
                </li>
                <li>
                  Clicking <span className="font-semibold text-white/85">X</span> on a scoped user
                  removes the override and reverts that user back to inherited shared settings
                  (filters and naming).
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'collections-profile-collection-rename',
          question: 'How do I rename Immaculate Taste collections from a profile?',
          answer: (
            <>
              <p>
                In <span className="font-semibold text-white/85">Command Center</span> -{' '}
                <span className="font-semibold text-white/85">Immaculate Taste Profiles</span>, open
                a profile and edit{' '}
                <span className="font-semibold text-white/85">
                  Movie collection base name
                </span>{' '}
                and/or{' '}
                <span className="font-semibold text-white/85">TV collection base name</span>, then
                save profile.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  With <span className="font-semibold text-white/85">All users</span> selected,
                  shared base-name updates keep per-user suffix naming when collections are renamed
                  (for example: <code>immaculate (ohmz_i)</code>).
                </li>
                <li>
                  With a specific user selected, scoped custom base names are applied for that user
                  only, without automatically appending the username.
                </li>
                <li>
                  If you remove a scoped user override, that user&apos;s collection naming reverts to
                  the inherited shared naming convention.
                </li>
              </ul>
              <p>
                For enabled profiles, Immaculaterr attempts to rename matching managed Plex
                collections for monitored users in selected libraries. If no existing managed
                collection matches yet, the next collection or refresher run uses the new base name.
              </p>
            </>
          ),
        },
        {
          id: 'collections-immaculate-points',
          question: 'How do Immaculate Taste points work?',
          answer: (
            <>
              <p>Points act like a freshness score for active Immaculate Taste titles.</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Freshly suggested active titles get high points.</li>
                <li>Pending titles stay at zero until the item appears in Plex.</li>
                <li>Active titles gradually lose points when they stop being re-suggested.</li>
                <li>When points run out, those older titles can drop from the active set.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'collections-change-of-taste',
          question: 'What is "Change of Taste" and how is it chosen?',
          answer: (
            <>
              <p>
                Change of Taste is the row meant to add controlled variety, not just more of the
                same.
              </p>
              <p>
                It deliberately leans away from your closest matches so the feed does not stay locked
                to one genre, mood, or era.
              </p>
              <p>
                Expect adjacent genres, different eras, or other nearby taste shifts rather than
                random unrelated picks.
              </p>
            </>
          ),
        },
        {
          id: 'observatory-what-is',
          question: 'What is the Observatory page?',
          answer: (
            <p>
              Observatory is a swipe-based review deck for Immaculate Taste and related
              recommendation datasets (e.g., Based on Latest Watched). It lets you approve download
              requests (optional) and curate your suggestions before or while they land in Plex
              collections.
            </p>
          ),
        },
        {
          id: 'observatory-approval-required',
          question: 'How do I require approval before sending anything to Radarr/Sonarr?',
          answer: (
            <>
              <p>
                In <span className="font-semibold text-white/85">Task Manager</span> -{' '}
                <span className="font-semibold text-white/85">Immaculate Taste Collection</span>, turn
                on <span className="font-semibold text-white/85">Approval required from Observatory</span>.
              </p>
              <p>
                When enabled, Immaculaterr will not send missing titles to Radarr/Sonarr until you{' '}
                <span className="font-semibold text-white/85">swipe right</span> on them in
                Observatory.
              </p>
              <p>
                This only applies to direct ARR mode. If you enable Seerr routing for that task,
                Observatory approval is automatically disabled for that task.
              </p>
            </>
          ),
        },
        {
          id: 'observatory-no-suggestions',
          question: 'Why does Observatory say there are no suggestions for my library?',
          answer: (
            <>
              <p>
                It usually means the collection job has not generated suggestions yet for that library
                and media type.
              </p>
              <p>
                Keep using Plex and let suggestions build up, or run the collection task manually
                from <span className="font-semibold text-white/85">Task Manager</span> for that media
                type to generate suggestions.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'reset-immaculate-taste-collection',
      title: 'Reset Immaculate Taste Collection',
      items: [
        {
          id: 'observatory-reset-immaculate',
          question: 'What does "Reset Immaculate Taste Collection" do?',
          answer: (
            <>
              <p>
                It deletes the Immaculate Taste Plex collection for the selected library and clears
                the saved dataset for that library (pending/active tracking).
              </p>
              <p>
                After reset, run the Immaculate Taste Collection job again (or let it auto-run) to
                rebuild suggestions and recreate the Plex collection.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'reset-seerr-requests',
      title: 'Reset Seerr Requests',
      items: [
        {
          id: 'arr-seerr-setup',
          question: 'How do I set up Seerr mode in simple steps?',
          answer: (
            <ol className="list-decimal pl-5 space-y-1">
              <li>
                Go to <span className="font-semibold text-white/85">Vault</span> and set Seerr
                URL + API key.
              </li>
              <li>Enable Seerr in Vault and run the test.</li>
              <li>
                In <span className="font-semibold text-white/85">Task Manager</span>, turn on{' '}
                <span className="font-semibold text-white/85">Route missing items via Seerr</span>{' '}
                for each task you want.
              </li>
              <li>Run the task so new missing titles are requested in Seerr.</li>
            </ol>
          ),
        },
        {
          id: 'arr-seerr-routing',
          question: 'What changes when I turn on "Route missing items via Seerr"?',
          answer: (
            <>
              <p>
                Turning on{' '}
                <span className="font-semibold text-white/85">Route missing items via Seerr</span>{' '}
                changes the request path for that task, not the recommendation or tracking side of
                the job.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Missing titles from that task are sent to Seerr instead of direct ARR sends.</li>
                <li>Direct Radarr/Sonarr toggles for that task are turned off.</li>
                <li>Approval required from Observatory is turned off for that task.</li>
                <li>For Immaculate Taste, Start search immediately is also turned off.</li>
                <li>Suggestions, pending/active tracking, and Plex collection updates still continue.</li>
                <li>
                  If Seerr is unavailable, those requests are skipped for that run and are not
                  sent to ARR as a fallback.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'arr-seerr-vs-observatory',
          question: 'What is the difference between in-app approval mode and Seerr mode?',
          answer: (
            <>
              <p>
                <span className="font-semibold text-white/85">In-app approval mode</span>: you approve
                in Observatory, then Immaculaterr sends approved items directly to Radarr/Sonarr.
              </p>
              <p>
                <span className="font-semibold text-white/85">Seerr mode</span>: Immaculaterr sends
                missing items to Seerr, and Seerr becomes the request workflow.
              </p>
              <p>Use one flow per task card. If Seerr mode is on, Observatory approval is off.</p>
            </>
          ),
        },
        {
          id: 'arr-seerr-reset',
          question: 'How do I clear all Seerr requests from Immaculaterr?',
          answer: (
            <>
              <p>
                Go to{' '}
                <Link
                  to="/command-center#command-center-reset-seerr-requests"
                  className={faqLinkClass}
                >
                  Command Center - Reset Seerr Requests
                </Link>
                .
              </p>
              <p>
                After confirmation, Immaculaterr asks Seerr to delete every request regardless of
                status. This clears <strong>all</strong> Seerr requests—including user-created
                requests, not only Immaculaterr-managed ones. It clears request records only; it does
                not delete Plex media files.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'reset-rejected-list',
      title: 'Reset Rejected List',
      items: [
        {
          id: 'observatory-controls',
          question: 'What do swipes do, and when should I reset the rejected list?',
          answer: (
            <>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">Swipe right</span>: approve in
                  approval mode or keep in review mode.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Swipe left</span>: reject/remove that
                  suggestion. It goes onto your rejected list so it will not be suggested again.
                </li>
                <li>
                  <span className="font-semibold text-white/85">Undo</span>: restores your last swipe.
                </li>
                <li>
                  Desktop keyboard shortcuts: use the{' '}
                  <span className="font-semibold text-white/85">left arrow</span> and{' '}
                  <span className="font-semibold text-white/85">right arrow</span> keys to swipe the
                  top card.
                </li>
              </ul>
              <p>
                Use{' '}
                <Link
                  to="/command-center#command-center-reset-rejected-list"
                  className={faqLinkClass}
                >
                  Command Center - Reset Rejected List
                </Link>{' '}
                when you want previously swiped-left suggestions to become eligible again.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'collection-posters',
      title: 'Collection Posters',
      items: [
        {
          id: 'collections-posters',
          question: 'How does poster artwork work for collections? Can I customize posters?',
          answer: (
            <>
              <p>
                Yes. You can upload custom poster artwork for Immaculaterr-managed collections directly
                in Command Center.
              </p>
              <p>
                Uploaded posters are saved in app data and stay in place after restarts. If you do
                not set a custom poster, Immaculaterr uses its built-in default artwork.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'radarr',
      title: 'Radarr',
      items: [
        {
          id: 'arr-fetch-missing',
          question: 'What does "Fetch Missing items" actually do?',
          answer: (
            <>
              <p>
                <span className="font-semibold text-white/85">Fetch Missing items</span> is the
                toggle that lets a collection job send missing recommendations out of Immaculaterr.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>In direct ARR mode, movies can go to Radarr and shows can go to Sonarr.</li>
                <li>
                  If you leave it off, the app still builds suggestions and tracks pending items, but
                  it does not send requests anywhere.
                </li>
                <li>
                  If you want Seerr to manage requests instead, use{' '}
                  <span className="font-semibold text-white/85">
                    Route missing items via Seerr
                  </span>{' '}
                  for that task.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'radarr-disable-toggles',
          question: 'If I disable Radarr toggles, what changes?',
          answer: (
            <p>
              Movie jobs stop making Radarr add/search calls. Recommendations, Plex matching,
              pending/active tracking, and collection rebuilds continue to work.
            </p>
          ),
        },
        {
          id: 'arr-cleanup-job',
          question: 'What happens during "Cleanup after adding new content"?',
          answer: (
            <p>
              It scans for duplicates across libraries, keeps the best copy, and can unmonitor movie
              duplicates in Radarr. When <span className="font-semibold text-white/85">Delete duplicate media</span> is
              enabled, it can also remove lower-quality duplicate files/versions via the Plex API.
              The process is designed to be safety-first and report what was changed in Rewind.
            </p>
          ),
        },
        {
          id: 'arr-delete-media',
          question: 'Will it ever delete movies?',
          answer: (
            <p>
              When <span className="font-semibold text-white/85">Delete duplicate media</span> is enabled on the
              Cleanup After Adding New Content card, Immaculaterr can delete lower-quality duplicate
              files/versions via the Plex API, keeping the best copy. If that toggle is off, it only
              unmonitors duplicates in Radarr and does not delete Plex media files.
            </p>
          ),
        },
      ],
    },
    {
      id: 'sonarr',
      title: 'Sonarr',
      items: [
        {
          id: 'arr-duplicates',
          question: 'How are TV duplicates handled in Sonarr?',
          answer: (
            <>
              <p>TV duplicate cleanup is designed to be cautious, not destructive.</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>TV duplicates are checked with episode-aware and season-aware rules.</li>
                <li>Single-episode duplicates can be unmonitored in Sonarr without affecting the whole show.</li>
                <li>
                  When <span className="font-semibold text-white/85">Delete duplicate media</span> is enabled, lower-quality
                  episode copies can also be removed from Plex (best resolution kept).
                </li>
                <li>Rewind still reports what was scanned, skipped, unmonitored, or deleted.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'sonarr-disable-toggles',
          question: 'What changes if I disable Sonarr toggles?',
          answer: (
            <p>
              TV-focused jobs stop making Sonarr add/search calls. Everything else around
              recommendations, Plex matching, and collection rebuilds keeps working.
            </p>
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
            <>
              <p>
                The server checks the latest GitHub release and compares it to the running app
                version. The UI surfaces this in the Help menu and can toast when a newer version
                is available.
              </p>
              <p>
                When an update is available, use the{' '}
                <Link to="/setup#update-paths-http-only" className={faqLinkClass}>
                  Setup page
                </Link>{' '}
                as the source of truth for update commands.
              </p>
            </>
          ),
        },
        {
          id: 'updates-available',
          question: 'Why does it say "Update available"? What should I do?',
          answer: (
            <>
              <p>It means a newer release exists than what your container is currently running.</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  Run{' '}
                  <Link to="/setup#update-paths-http-only" className={faqLinkClass}>
                    Setup - HTTP-only update (required)
                  </Link>
                  .
                </li>
                <li>
                  If you use local HTTPS on port <code className="font-mono">5464</code>, also run{' '}
                  <Link to="/setup#update-paths-https-sidecar" className={faqLinkClass}>
                    Setup - Optional HTTPS sidecar
                  </Link>
                  .
                </li>
              </ol>
            </>
          ),
        },
        {
          id: 'updates-where-version',
          question: 'Where can I see the current version and version history?',
          answer: (
            <>
              <p>
                In the Help menu, tap the Version button. You can also view releases on GitHub.
              </p>
              <p>
                For actual upgrade commands, use the{' '}
                <Link to="/setup#update-paths-http-only" className={faqLinkClass}>
                  Setup page
                </Link>
                .
              </p>
            </>
          ),
        },
        {
          id: 'updates-not-working',
          question: 'Why isn&apos;t update checking working?',
          answer: (
            <>
              <p>Update checking usually fails for a small set of reasons.</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Update checks can be disabled by environment configuration.</li>
                <li>GitHub API rate limits can temporarily block checks.</li>
                <li>
                  If you&apos;re checking a private repo, you may need a GitHub token configured for
                  update checks.
                </li>
              </ul>
              <p>
                Even if update checks are unavailable, you can still update manually from{' '}
                <Link to="/setup#update-paths-http-only" className={faqLinkClass}>
                  Setup
                </Link>
                .
              </p>
            </>
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
              It is the encryption key used to protect stored secrets at rest (for example, API
              tokens). It must be stable so the app can decrypt what it previously encrypted.
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
                <code className="font-mono">APP_MASTER_KEY</code> (64-char hex or base64 that
                decodes to 32 bytes)
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
              The app will not be able to decrypt previously saved secrets. You will need to
              reset/re-enter secrets (or reset the account) and store a new stable key going
              forward.
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
              <li>
                By default, the container also writes a pre-migration SQLite snapshot before startup
                migrations under <code className="font-mono">/data/backups/pre-migrate</code>.
              </li>
            </ul>
          ),
        },
        {
          id: 'security-rotate',
          question: 'Can I rotate the master key?',
          answer: (
            <p>
              You can, but anything encrypted with the old key will not decrypt with the new one.
              The safe workflow is: rotate the key, then re-enter secrets so they are re-encrypted.
            </p>
          ),
        },
        {
          id: 'security-modern-measures',
          question: 'What modern security measures does the app use?',
          answer: (
            <>
              <p>
                The app uses layered protections around saved secrets, sign-in flows, and admin-only
                actions.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Secrets are encrypted at rest using your stable{' '}
                  <code className="font-mono">APP_MASTER_KEY</code>.
                </li>
                <li>
                  Sensitive credentials support encrypted envelope transport and secret-reference
                  reuse, reducing repeated plaintext handling.
                </li>
                <li>
                  Session auth uses cookie protections (for example{' '}
                  <code className="font-mono">HttpOnly</code> and{' '}
                  <code className="font-mono">SameSite=Lax</code>), with secure-cookie behavior on
                  HTTPS deployments.
                </li>
                <li>
                  State-changing API requests include origin checks to reduce cross-site request
                  abuse.
                </li>
                <li>
                  Login and recovery flows include throttling/lockout protections against brute-force
                  attempts.
                </li>
                <li>
                  Security headers are applied on responses, and admin-only endpoints remain protected
                  by authorization checks.
                </li>
              </ul>
            </>
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
          question: "I can't log in / I keep getting logged out - what do I check?",
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Use one base URL consistently (for example, stay on only{' '}
                <code className="font-mono">http://&lt;host&gt;:5454</code> or only{' '}
                <code className="font-mono">https://&lt;host&gt;:5464</code>).
              </li>
              <li>
                If you use a reverse proxy, ensure forwarded protocol headers are correct
                (especially <code className="font-mono">X-Forwarded-Proto</code>) and keep{' '}
                <code className="font-mono">TRUST_PROXY=1</code>.
              </li>
              <li>
                Check browser cookie policy for this site (private mode and strict tracking
                protection can block session cookies).
              </li>
              <li>After config/protocol changes, clear site cookies and sign in again.</li>
            </ul>
          ),
        },
        {
          id: 'troubleshooting-urls',
          question:
            "Immaculaterr can't reach Plex/Radarr/Sonarr/Seerr - what URL should I use from Docker?",
          answer: (
            <>
              <p>Use URLs from the container&apos;s point of view:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Linux with <code className="font-mono">--network host</code>:{' '}
                  <code className="font-mono">http://localhost:&lt;port&gt;</code>
                </li>
                <li>
                  Docker Desktop (Mac/Windows):{' '}
                  <code className="font-mono">http://host.docker.internal:&lt;port&gt;</code>
                </li>
                <li>
                  Same Docker network/compose stack: use service DNS names like{' '}
                  <code className="font-mono">http://radarr:7878</code> or{' '}
                  <code className="font-mono">http://sonarr:8989</code>
                </li>
              </ul>
              <p>
                Then use the test buttons in <span className="font-semibold text-white/85">Vault</span>{' '}
                to confirm each integration from inside the app.
              </p>
            </>
          ),
        },
        {
          id: 'troubleshooting-tmdb',
          question: "TMDB requests fail - what's required and where do I configure it?",
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Configure TMDB in <span className="font-semibold text-white/85">Vault</span> and save
                a valid API key.
              </li>
              <li>Run the TMDB test in Vault to verify connectivity and key validity.</li>
              <li>
                If TMDB is missing or failing, recommendation jobs may be incomplete or fail based on
                your selected strategy.
              </li>
            </ul>
          ),
        },
        {
          id: 'automation-did-not-trigger',
          question: "Why didn't a job trigger even though I watched past the threshold?",
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Auto-Run is off for that job in Task Manager.</li>
              <li>Plex polling is disabled or not reaching Plex.</li>
              <li>
                The item is too short (the default minimum is 1 minute for polling-trigger checks).
              </li>
              <li>The job was recently triggered and deduped to prevent repeated runs.</li>
              <li>
                The triggering user may be disabled in{' '}
                <Link
                  to="/command-center#command-center-plex-user-monitoring"
                  className={faqLinkClass}
                >
                  Command Center - Plex User Monitoring
                </Link>
                .
              </li>
              <li>
                The source library may be disabled in{' '}
                <Link
                  to="/command-center#command-center-plex-library-selection"
                  className={faqLinkClass}
                >
                  Command Center - Plex Library Selection
                </Link>
                .
              </li>
              <li>
                The seed&apos;s genre or audio language may be excluded by your rules in{' '}
                <Link
                  to="/command-center#command-center-immaculate-taste-profiles"
                  className={faqLinkClass}
                >
                  Command Center - Immaculate Taste Profiles
                </Link>
                .
              </li>
            </ul>
          ),
        },
        {
          id: 'troubleshooting-empty-report',
          question: 'A job ran but the report looks empty - what does that mean?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Most often it was a no-op run: no new seed, no pending titles became available, or
                the collection was already up to date.
              </li>
              <li>Open the report steps and logs to see exactly which stage skipped and why.</li>
              <li>
                In Rewind, use <span className="font-semibold text-white/85">See raw response</span>{' '}
                for the full run summary/log JSON when you need deeper debugging.
              </li>
            </ul>
          ),
        },
        {
          id: 'troubleshooting-posters',
          question: 'Collections created but no poster shows - why?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>The container image may be outdated (pull/update and restart).</li>
              <li>
                If you renamed collection bases, your old mapping may no longer match the current
                collection names.
              </li>
              <li>Plex can lag on metadata refresh; force-refresh and wait a minute.</li>
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
                (including step breakdown and raw response)
              </li>
              <li>
                <span className="font-semibold text-white/85">Logs</span>: raw server log lines
              </li>
            </ul>
          ),
        },
        {
          id: 'troubleshooting-resets',
          question:
            'When should I use reset tools (Rejected List, Seerr Requests, Immaculate Taste Collection)?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Use{' '}
                <Link
                  to="/command-center#command-center-reset-rejected-list"
                  className={faqLinkClass}
                >
                  Command Center - Reset Rejected List
                </Link>{' '}
                when you want previously swiped-left suggestions to become eligible again.
              </li>
              <li>
                Use{' '}
                <Link
                  to="/command-center#command-center-reset-seerr-requests"
                  className={faqLinkClass}
                >
                  Command Center - Reset Seerr Requests
                </Link>{' '}
                to clear all Seerr requests (including user-created ones, not only
                Immaculaterr-managed).
              </li>
              <li>
                Use{' '}
                <Link
                  to="/command-center#command-center-reset-immaculate-taste-collection"
                  className={faqLinkClass}
                >
                  Command Center - Reset Immaculate Taste Collection
                </Link>{' '}
                when you need to rebuild that library&apos;s dataset/collection from a clean state.
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
              Jobs that start based on Plex events detected by polling (watch threshold, new media,
              and related triggers).
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
              A job that revisits the saved dataset, activates newly-available items, shuffles, and
              rebuilds collections.
            </p>
          ),
        },
      ],
    },
  ], [faqLinkClass]);

  useEffect(() => {
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!hash) return;
    const sectionIdByItemId = FAQ_SECTIONS.reduce<Record<string, string>>((acc, section) => {
      section.items.forEach((item) => {
        acc[item.id] = section.id;
      });
      return acc;
    }, {});
    const flashTargetId =
      FAQ_SECTIONS.some((section) => section.id === hash) ? hash : sectionIdByItemId[hash] ?? null;

    const rafId = window.requestAnimationFrame(() => {
      centerElementInViewport(hash, 'smooth');
    });
    const settleId = window.setTimeout(() => centerElementInViewport(hash, 'smooth'), 320);
    const finalId = window.setTimeout(() => centerElementInViewport(hash, 'auto'), 900);
    const flashId =
      flashTargetId !== null
        ? window.setTimeout(() => {
            setFlashSection({ id: flashTargetId, nonce: Date.now() });
          }, 0)
        : null;

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleId);
      window.clearTimeout(finalId);
      if (flashId !== null) {
        window.clearTimeout(flashId);
      }
    };
  }, [FAQ_SECTIONS, centerElementInViewport, location.hash]);

  const sectionDescriptions: Record<string, string> = {
    'getting-started': 'Basics, first-run setup, and how to reach the app.',
    'task-manager':
      'How jobs run, what the main controls mean, and how to keep automation simple.',
    'task-manager-confirm-monitored':
      'Keep ARR monitoring aligned with what already exists in Plex.',
    'task-manager-confirm-unmonitored':
      'Verify Radarr unmonitored movies still exist in Plex and re-monitor anything missing.',
    'task-manager-cleanup-after-adding-new-content':
      'Plex-triggered cleanup actions for newly added media.',
    'task-manager-search-monitored': 'Off-peak missing searches for monitored ARR items.',
    'task-manager-tmdb-upcoming-movies':
      'What this task does, how each run works, and how to edit filters.',
    'task-manager-rotten-tomatoes-upcoming-movies':
      'Fixed-source Rotten Tomatoes discovery that routes safe matches to Radarr or Seerr.',
    'task-manager-immaculate-taste-collection':
      'Watch-triggered Immaculate Taste updates and missing-item routing.',
    'task-manager-immaculate-taste-refresher':
      'Standalone off-peak rebuilds for the Immaculate Taste collection.',
    'task-manager-based-on-latest-watched-collection':
      'Watch-triggered recommendation generation from your latest watch.',
    'task-manager-based-on-latest-watched-refresher':
      'Off-peak refreshes for latest-watched recommendation rows.',
    'task-manager-fresh-out-of-the-oven':
      'Recent-release movie rows filtered per Plex user by what they have already watched.',
    'task-manager-import-plex-history':
      'Scan your Plex watched history to seed recommendations and build dedicated collections.',
    'task-manager-import-netflix-history':
      'Upload a Netflix CSV to seed recommendations from your external watch history.',
    recommendations: 'Seeds, generated lists, and how recommendation rows refresh over time.',
    'plex-library-selection': 'Which Plex libraries can participate in manual and automatic runs.',
    'plex-user-monitoring': 'How viewer-specific datasets, monitoring, and row pinning work.',
    'immaculate-taste-profiles':
      'Advanced taste lanes, Observatory behavior, and profile matching rules.',
    'reset-immaculate-taste-collection':
      'Reset the saved Immaculate Taste dataset for a selected library.',
    'reset-seerr-requests':
      'Seerr routing behavior and how to clear managed request history.',
    'reset-rejected-list':
      'Swipe actions, rejected suggestions, and how to make them eligible again.',
    'collection-posters': 'Custom artwork for managed collections and poster override behavior.',
    radarr: 'Movie request routing, cleanup behavior, and direct ARR expectations.',
    sonarr: 'TV request routing, duplicate handling, and what toggles actually change.',
    updates: 'Release checks, version visibility, and the safest update flow.',
    security: 'Master key handling, backups, and the app’s built-in security controls.',
    troubleshooting: 'Common login, integration, empty-run, and reset questions.',
    glossary: 'Shared terms used throughout the app and job reports.',
  };
  const sectionVisuals: Record<
    string,
    { icon: (className: string) => ReactNode; toneClass: string }
  > = {
    'getting-started': {
      icon: (className) => <BookOpen className={className} strokeWidth={2.4} />,
      toneClass: 'text-[#facc15]',
    },
    'task-manager': {
      icon: (className) => <Clock className={className} />,
      toneClass: 'text-sky-200',
    },
    'task-manager-confirm-monitored': {
      icon: (className) => <MonitorPlay className={className} />,
      toneClass: 'text-blue-300',
    },
    'task-manager-confirm-unmonitored': {
      icon: (className) => <MonitorPlay className={className} />,
      toneClass: 'text-emerald-300',
    },
    'task-manager-cleanup-after-adding-new-content': {
      icon: (className) => <CheckCircle2 className={className} />,
      toneClass: 'text-teal-200',
    },
    'task-manager-search-monitored': {
      icon: (className) => <Search className={className} />,
      toneClass: 'text-fuchsia-200',
    },
    'task-manager-tmdb-upcoming-movies': {
      icon: (className) => <Film className={className} />,
      toneClass: 'text-cyan-200',
    },
    'task-manager-rotten-tomatoes-upcoming-movies': {
      icon: (className) => <Film className={className} />,
      toneClass: 'text-rose-200',
    },
    'task-manager-immaculate-taste-collection': {
      icon: (className) => <Sparkles className={className} />,
      toneClass: 'text-amber-200',
    },
    'task-manager-immaculate-taste-refresher': {
      icon: (className) => <RotateCcw className={className} />,
      toneClass: 'text-yellow-200',
    },
    'task-manager-based-on-latest-watched-collection': {
      icon: (className) => <Sparkles className={className} />,
      toneClass: 'text-violet-200',
    },
    'task-manager-based-on-latest-watched-refresher': {
      icon: (className) => <RotateCcw className={className} />,
      toneClass: 'text-violet-200',
    },
    'task-manager-fresh-out-of-the-oven': {
      icon: (className) => <Film className={className} />,
      toneClass: 'text-orange-200',
    },
    'task-manager-import-plex-history': {
      icon: (className) => <History className={className} />,
      toneClass: 'text-amber-200',
    },
    'task-manager-import-netflix-history': {
      icon: (className) => <Upload className={className} />,
      toneClass: 'text-red-200',
    },
    recommendations: {
      icon: (className) => <Film className={className} />,
      toneClass: 'text-purple-300',
    },
    'plex-library-selection': {
      icon: (className) => <Tv className={className} />,
      toneClass: 'text-sky-200',
    },
    'plex-user-monitoring': {
      icon: (className) => <Users className={className} />,
      toneClass: 'text-cyan-200',
    },
    'immaculate-taste-profiles': {
      icon: (className) => <Film className={className} />,
      toneClass: 'text-fuchsia-200',
    },
    'reset-immaculate-taste-collection': {
      icon: (className) => <RotateCcw className={className} />,
      toneClass: 'text-amber-200',
    },
    'reset-seerr-requests': {
      icon: (className) => <RotateCcw className={className} />,
      toneClass: 'text-cyan-200',
    },
    'reset-rejected-list': {
      icon: (className) => <RotateCcw className={className} />,
      toneClass: 'text-rose-200',
    },
    'collection-posters': {
      icon: (className) => <Upload className={className} />,
      toneClass: 'text-amber-200',
    },
    radarr: {
      icon: (className) => <RadarrLogo className={className} />,
      toneClass: 'text-[#facc15]',
    },
    sonarr: {
      icon: (className) => <SonarrLogo className={className} />,
      toneClass: 'text-sky-400',
    },
    updates: {
      icon: (className) => <Wrench className={className} />,
      toneClass: 'text-[#facc15]',
    },
    security: {
      icon: (className) => <Shield className={className} />,
      toneClass: 'text-emerald-200',
    },
    troubleshooting: {
      icon: (className) => <CircleAlert className={className} />,
      toneClass: 'text-rose-200',
    },
    glossary: {
      icon: (className) => <BookOpen className={className} strokeWidth={2.4} />,
      toneClass: 'text-white/80',
    },
  };
  const sectionThemes = [
    {
      glow: 'from-sky-400/25 via-cyan-400/10',
      pill: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
    },
    {
      glow: 'from-emerald-400/25 via-teal-400/10',
      pill: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
    },
    {
      glow: 'from-fuchsia-400/25 via-violet-400/10',
      pill: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100',
    },
    {
      glow: 'from-amber-300/25 via-yellow-400/10',
      pill: 'border-amber-300/30 bg-amber-300/10 text-amber-50',
    },
    {
      glow: 'from-rose-400/25 via-pink-400/10',
      pill: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
    },
  ] as const;
  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 p-6 shadow-2xl backdrop-blur-2xl lg:p-8';
  const answerBodyClass =
    'mt-4 space-y-3 text-sm leading-relaxed text-white/70 [&_code]:rounded-md [&_code]:border [&_code]:border-white/10 [&_code]:bg-black/25 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-white/90 [&_ol]:space-y-1.5 [&_ul]:space-y-1.5';
  const featureLinkButtonClass =
    'inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold leading-none text-white/75 transition hover:bg-white/10 hover:text-[#fde68a] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs';
  const topGlowFadeStyle = {
    WebkitMaskImage: 'linear-gradient(to bottom, rgba(0, 0, 0, 1), rgba(0, 0, 0, 0))',
    maskImage: 'linear-gradient(to bottom, rgba(0, 0, 0, 1), rgba(0, 0, 0, 0))',
  } satisfies React.CSSProperties;
  const renderSectionIconTile = (sectionId: string, size: 'catalog' | 'section') => {
    const visual = sectionVisuals[sectionId] ?? sectionVisuals.glossary;
    const sizeClass = size === 'catalog' ? 'h-11 w-11' : 'h-14 w-14';
    const iconClass = size === 'catalog' ? 'h-6 w-6' : 'h-7 w-7';

    return (
      <div
        className={`${sizeClass} shrink-0 rounded-2xl border border-white/10 bg-[#0F0B15] shadow-inner flex items-center justify-center ${visual.toneClass}`}
      >
        {visual.icon(iconClass)}
      </div>
    );
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-text [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
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
                  className="relative group touch-manipulation focus:outline-none"
                  aria-label="Animate FAQ icon"
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#facc15] opacity-0 blur-xl"
                  />
                  <div className="absolute inset-0 bg-[#facc15] opacity-20 blur-xl transition-opacity duration-500 group-hover:opacity-40" />
                  <motion.div
                    initial={{ rotate: -10, scale: 0.94, y: 2 }}
                    animate={{ rotate: -6, scale: 1, y: 0 }}
                    whileHover={{ rotate: 0, scale: 1.04 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    style={{ backfaceVisibility: 'hidden' }}
                    className="relative transform-gpu rounded-2xl border border-white/20 bg-[#facc15] p-3 shadow-[0_0_30px_rgba(250,204,21,0.3)] will-change-transform md:p-4"
                  >
                    <BookOpen className="h-8 w-8 text-black md:h-10 md:w-10" strokeWidth={2.5} />
                  </motion.div>
                </motion.button>

                <h1 className="text-5xl font-black tracking-tighter text-white drop-shadow-2xl md:text-6xl">
                  FAQ
                </h1>
              </div>

              <p className="ml-1 max-w-2xl text-lg font-medium leading-relaxed text-sky-100/70">
                Deep-linkable answers for Task Manager and Command Center features, plus update,
                security, and troubleshooting guidance that matches the in-app flow.
              </p>
            </motion.div>
          </div>

          <div className={cardClass}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xl font-semibold text-white">Catalog</div>
                <div className="mt-2 text-sm leading-relaxed text-white/70">
                  Browse by feature area, then jump straight to a full answer card below.
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {FAQ_SECTIONS.map((section, index) => {
                const theme = sectionThemes[index % sectionThemes.length];
                const sectionLabel = `Section ${String(index + 1).padStart(2, '0')}`;
                const extraQuestionCount = Math.max(0, section.items.length - 3);

                return (
                  <div
                    key={section.id}
                    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-white/15 hover:bg-white/10"
                  >
                    <div
                      className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-r ${theme.glow} to-transparent opacity-80`}
                      style={topGlowFadeStyle}
                    />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.pill}`}
                          >
                            {sectionLabel}
                          </div>
                          <div className="mt-3 flex items-center gap-3">
                            {renderSectionIconTile(section.id, 'catalog')}
                            <button
                              type="button"
                              onClick={() => navigateToAnchor(section.id)}
                              className="min-w-0 flex-1 text-left text-base font-semibold text-white/90 transition-colors group-hover:text-white"
                            >
                              {section.title}
                            </button>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-white/60">
                            {sectionDescriptions[section.id] ?? 'Browse this FAQ section.'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        {section.items.slice(0, 3).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => navigateToAnchor(item.id)}
                            className="flex w-full items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-white/70 transition hover:border-white/15 hover:bg-white/10 hover:text-white"
                          >
                            <span className="min-w-0">{item.question}</span>
                            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" />
                          </button>
                        ))}
                        {extraQuestionCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => navigateToAnchor(section.id)}
                            className="w-full text-left text-xs font-semibold uppercase tracking-[0.16em] text-white/45 transition hover:text-white/70"
                          >
                            + {extraQuestionCount} more answer{extraQuestionCount === 1 ? '' : 's'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 space-y-6">
            {FAQ_SECTIONS.map((section, index) => {
              const theme = sectionThemes[index % sectionThemes.length];
              const sectionLabel = `Section ${String(index + 1).padStart(2, '0')}`;
              const commandCenterCardId =
                section.id in COMMAND_CENTER_CARD_ID_BY_FAQ_SECTION
                  ? COMMAND_CENTER_CARD_ID_BY_FAQ_SECTION[
                      section.id as keyof typeof COMMAND_CENTER_CARD_ID_BY_FAQ_SECTION
                    ]
                  : null;
              const taskManagerCardId =
                section.id in TASK_MANAGER_CARD_ID_BY_FAQ_SECTION
                  ? TASK_MANAGER_CARD_ID_BY_FAQ_SECTION[
                      section.id as keyof typeof TASK_MANAGER_CARD_ID_BY_FAQ_SECTION
                    ]
                  : null;
              const featureLink = commandCenterCardId
                ? {
                    to: `/command-center#${commandCenterCardId}`,
                    title: `Open ${section.title} in Command Center`,
                  }
                : taskManagerCardId
                  ? {
                      to: `/task-manager#job-${taskManagerCardId}`,
                      title: `Open ${section.title} in Task Manager`,
                    }
                  : null;
              const isFlashingSection = flashSection?.id === section.id;

              return (
                <div
                  key={section.id}
                  id={section.id}
                  className={`${anchorClass} relative`}
                >
                  {renderSectionFlash(section.id)}
                  <div className={`${cardClass} relative overflow-hidden`}>
                    <div
                      className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-r ${theme.glow} to-transparent opacity-80`}
                      style={topGlowFadeStyle}
                    />
                    <div className="relative">
                      <div className="min-w-0">
                        <div
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.pill}`}
                        >
                          {sectionLabel}
                        </div>
                        <div className="mt-4 flex items-start gap-4">
                        {renderSectionIconTile(section.id, 'section')}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <motion.h2
                              className="text-2xl font-semibold tracking-tight text-white"
                              animate={
                                isFlashingSection
                                  ? {
                                      color: [
                                        'rgba(255,255,255,1)',
                                        'rgba(253,230,138,1)',
                                        'rgba(255,255,255,1)',
                                        'rgba(253,230,138,1)',
                                        'rgba(255,255,255,1)',
                                        'rgba(253,230,138,1)',
                                        'rgba(255,255,255,1)',
                                      ],
                                      textShadow: [
                                        '0 0 0px rgba(250,204,21,0)',
                                        '0 0 20px rgba(250,204,21,0.45)',
                                        '0 0 0px rgba(250,204,21,0)',
                                        '0 0 20px rgba(250,204,21,0.45)',
                                        '0 0 0px rgba(250,204,21,0)',
                                        '0 0 20px rgba(250,204,21,0.45)',
                                        '0 0 0px rgba(250,204,21,0)',
                                      ],
                                    }
                                  : {
                                      color: 'rgba(255,255,255,1)',
                                      textShadow: '0 0 0px rgba(250,204,21,0)',
                                    }
                              }
                              transition={{ duration: isFlashingSection ? 3.8 : 0.2, ease: 'easeInOut' }}
                            >
                              {section.title}
                            </motion.h2>
                            {featureLink ? (
                              <Link
                                to={featureLink.to}
                                className={featureLinkButtonClass}
                                title={featureLink.title}
                                aria-label={`Open ${section.title} feature`}
                              >
                                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                                <span className="max-[420px]:hidden">Feature</span>
                              </Link>
                            ) : null}
                          </div>
                          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/65">
                            {sectionDescriptions[section.id] ?? 'Detailed answers for this FAQ section.'}
                          </p>
                        </div>
                        </div>
                      </div>

                      <div className="mt-6 space-y-4">
                        {section.items.map((item, itemIndex) => (
                          <div
                            key={item.id}
                            id={item.id}
                            className={`${anchorClass} group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-white/15 hover:bg-white/10`}
                          >
                            <div
                              className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${theme.glow} to-transparent opacity-90`}
                            />
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div
                                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.pill}`}
                                >
                                  Q{String(itemIndex + 1).padStart(2, '0')}
                                </div>
                                <Link
                                  to={`${location.pathname}#${item.id}`}
                                  className="mt-3 block text-lg font-semibold leading-tight text-white transition hover:text-[#fde68a]"
                                >
                                  {item.question}
                                </Link>
                              </div>
                            </div>

                            <div className={answerBodyClass}>{item.answer}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <AnimatePresence>
        {showScrollTopButton ? (
          <motion.button
            type="button"
            onClick={handleScrollToTop}
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.94 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-28 right-4 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-[#0F0B15]/90 text-[#facc15] shadow-[0_0_24px_rgba(250,204,21,0.18)] backdrop-blur-xl transition hover:bg-[#15101f]/95 hover:text-[#fde68a] active:scale-95 active:opacity-80 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[#facc15]/40 sm:bottom-8 sm:right-6"
            aria-label="Scroll to top"
            title="Scroll to top"
          >
            <ChevronUp className="h-5 w-5" />
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
