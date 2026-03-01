import { motion, useAnimation } from 'motion/react';
import { BookOpen } from 'lucide-react';
import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

export const FaqPage = () => {
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
  const handleCatalogSectionClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const { sectionId } = event.currentTarget.dataset;
      if (!sectionId) return;
      scrollToId(sectionId);
    },
    [],
  );
  const handleCatalogItemClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const { itemId } = event.currentTarget.dataset;
      if (!itemId) return;
      scrollToId(itemId);
    },
    [],
  );

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
                Radarr/Sonarr or Overseerr, which handle the request/download workflows.
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
                Radarr/Sonarr/Overseerr, TMDB, optional Google/OpenAI).
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
                Optionally connect Radarr/Sonarr and/or Overseerr (only if you want “Fetch Missing
                items” behavior).
              </li>
              <li>
                In Task Manager, choose your missing-item route per task card: direct ARR route or
                Overseerr route.
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
                If you run the HTTPS Docker Compose profile, both are available:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  HTTP: <code className="font-mono">http://&lt;server-ip&gt;:5454/</code>
                </li>
                <li>
                  HTTPS (local/LAN):{' '}
                  <code className="font-mono">https://&lt;server-ip&gt;:5464/</code>
                </li>
                <li>
                  HTTPS (public domain):{' '}
                  <code className="font-mono">https://&lt;your-domain&gt;/</code> on{' '}
                  <code className="font-mono">443</code> when configured.
                </li>
              </ul>
              <p>
                For local HTTPS, install the local certificate authority to remove warnings, or
                accept the browser risk page when prompted (some browsers may ask again in later
                sessions).
              </p>
            </>
          ),
        },
        {
          id: 'getting-started-http-and-https',
          question: 'Why keep both HTTP and HTTPS enabled?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                HTTP keeps existing setups working without breaking users who started on{' '}
                <code className="font-mono">5454</code>.
              </li>
              <li>
                HTTPS provides encrypted browser-to-app traffic for users who want stronger
                transport security.
              </li>
              <li>
                Some users prefer not to install a local certificate; HTTP stays available for
                those local-only environments while HTTPS remains available when needed.
              </li>
            </ul>
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
          id: 'automation-collection-threshold',
          question: 'When does Collection task trigger?',
          answer: (
            <p>
              By default, it triggers when Plex polling detects you’ve watched roughly{' '}
              <span className="font-semibold text-white/85">70%</span> of the item.
            </p>
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
              <li>
                The seed came from a Plex library you excluded in{' '}
                <span className="font-semibold text-white/85">
                  Command Center → Plex Library Selection
                </span>
                .
              </li>
            </ul>
          ),
        },
        {
          id: 'automation-library-selection-impact',
          question: 'How does Plex Library Selection affect auto-runs and manual runs?',
          answer: (
            <>
              <p>
                After Plex setup, you can choose which movie/show libraries Immaculaterr is allowed
                to use. You can update this any time from{' '}
                <span className="font-semibold text-white/85">
                  Command Center → Plex Library Selection
                </span>
                .
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  If a run targets a library you turned off, that part is skipped instead of failing
                  the whole job.
                </li>
                <li>
                  If no selected libraries are available for that media type, the run will show a
                  clear skipped reason in the report.
                </li>
                <li>
                  When you save after de-selecting a library, Immaculaterr warns you because that
                  library’s suggestion dataset is removed and its curated collections are removed from
                  Plex.
                </li>
              </ul>
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
                dataset, move items from pending → active when they appear in Plex, shuffle active
                items, and rebuild collections cleanly.
              </p>
              <p>
                Collection-triggered refreshes stay scoped to the triggering viewer/library, while
                standalone refresher runs sweep all eligible viewers/libraries.
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
          id: 'collections-viewer-pinning',
          question: 'How do per-viewer collections and Plex pin locations work?',
          answer: (
            <>
              <p>
                Each viewer gets their own recommendation rows, and each viewer’s dataset is kept
                separate so one person’s watch habits do not change another person’s suggestions.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Admin viewer rows are pinned to Library Recommended and Home.</li>
                <li>Shared-user rows are pinned to Friends Home.</li>
              </ul>
              <p>
                The row order is always consistent: Based on your recently watched, then Change of
                Taste, then Inspired by your Immaculate Taste.
              </p>
            </>
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
          id: 'collections-immaculate-how',
          question: 'How does the Immaculate Taste collection work?',
          answer: (
            <>
              <p>
                Immaculate Taste is a long-lived per-library suggestion set that evolves over time.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  The collection job adds or refreshes suggestions when new seeds are processed.
                </li>
                <li>
                  Suggestions are tracked as active (already in Plex) or pending (not in Plex yet).
                </li>
                <li>
                  Refresher jobs promote pending titles to active when they appear in Plex, then
                  rebuild the collection.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'collections-immaculate-points',
          question: 'How do Immaculate Taste points work?',
          answer: (
            <>
              <p>
                Points act like a freshness score for active titles in Immaculate Taste.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Freshly suggested active titles get high points.</li>
                <li>Pending titles start at zero points until they appear in Plex.</li>
                <li>
                  Active titles gradually lose points over future updates if they are not suggested
                  again.
                </li>
                <li>
                  When points run out, titles can drop from the active set to keep the list fresh.
                </li>
              </ul>
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
                Recommendations always start with TMDB (it builds a pool of candidates similar to the seed).
                What happens next depends on what you configured in Vault:
              </p>
              <div className="space-y-3">
                <div>
                  <div className="font-semibold text-white/85">Variant 1: TMDB only</div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>TMDB builds candidate pools (released / upcoming / unknown).</li>
                    <li>
                      The “future vs current” ratio dial is applied to choose a mix (see below).
                    </li>
                    <li>Final titles come from TMDB’s pool selection.</li>
                  </ul>
                </div>

                <div>
                  <div className="font-semibold text-white/85">Variant 2: TMDB + OpenAI</div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>TMDB builds candidate pools first.</li>
                    <li>OpenAI curates the final list from TMDB candidates (better “taste” and variety).</li>
                    <li>The final list still respects the released/upcoming mix you set.</li>
                  </ul>
                </div>

                <div>
                  <div className="font-semibold text-white/85">Variant 3: TMDB + Google + OpenAI</div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>TMDB builds the candidate pools.</li>
                    <li>Google search is used as a discovery booster (web context) to widen suggestions.</li>
                    <li>OpenAI uses both TMDB candidates and web context to curate the final list.</li>
                  </ul>
                </div>
              </div>
              <p className="mt-3">
                The job reports include a per-service breakdown (what each service suggested) plus the final{' '}
                “Generated” list.
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
                This dial lives in <span className="font-semibold text-white/85">Command Center → Recommendations</span>.
                It controls how many suggestions are:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-semibold text-white/85">Current releases</span>: already released and typically available to watch now
                </li>
                <li>
                  <span className="font-semibold text-white/85">Future releases</span>: upcoming titles that may not be released yet
                </li>
              </ul>
              <p>
                The system enforces that released stays at least <span className="font-semibold text-white/85">25%</span>,
                so upcoming is effectively capped.
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
                If “Fetch Missing items” is enabled for that job, Immaculaterr can optionally send
                missing items to Radarr/Sonarr directly, or to Overseerr if Overseerr mode is enabled
                for that task.
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
      id: 'observatory',
      title: 'Observatory (swipe review)',
      items: [
        {
          id: 'observatory-what-is',
          question: 'What is the Observatory page?',
          answer: (
            <p>
              Observatory is a swipe-based review deck for the Immaculate Taste dataset. It lets you
              approve download requests (optional), and curate your suggestions before/while they
              land in Plex collections.
            </p>
          ),
        },
        {
          id: 'observatory-approval-required',
          question: 'How do I require approval before sending anything to Radarr/Sonarr?',
          answer: (
            <>
              <p>
                In <span className="font-semibold text-white/85">Task Manager</span> →{' '}
                <span className="font-semibold text-white/85">Immaculate Taste Collection</span>, turn
                on <span className="font-semibold text-white/85">Approval required from Observatory</span>.
              </p>
              <p>
                When enabled, Immaculaterr will not send missing titles to Radarr/Sonarr until you{' '}
                <span className="font-semibold text-white/85">swipe right</span> on them in Observatory.
              </p>
              <p>
                Note: this applies to direct ARR mode. If you enable Overseerr routing for that task,
                Observatory approval is automatically disabled for that task.
              </p>
            </>
          ),
        },
        {
          id: 'observatory-controls',
          question: 'What do swipes do, and can I use keyboard shortcuts?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-semibold text-white/85">Swipe right</span>: approve (in approval
                mode) or keep (in review mode).
              </li>
              <li>
                <span className="font-semibold text-white/85">Swipe left</span>: reject/remove that
                suggestion. This adds it to your rejected list, so it won’t be suggested again.
              </li>
              <li>
                <span className="font-semibold text-white/85">Undo</span>: restores your last swipe.
              </li>
              <li>
                You can reset the rejected list from{' '}
                <span className="font-semibold text-white/85">Command Center</span> →{' '}
                <span className="font-semibold text-white/85">Reset Rejected List</span>.
              </li>
              <li>
                Desktop: use <span className="font-semibold text-white/85">←</span> and{' '}
                <span className="font-semibold text-white/85">→</span> to swipe the top card.
              </li>
            </ul>
          ),
        },
        {
          id: 'observatory-reset-immaculate',
          question: 'What does “Reset Immaculate Taste Collection” do?',
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
        {
          id: 'observatory-no-suggestions',
          question: 'Why does Observatory say there are no suggestions for my library?',
          answer: (
            <>
              <p>
                It usually means the collection job hasn’t generated suggestions yet for that library
                and media type.
              </p>
              <p>
                Please continue using Plex and let suggestions build up, or run the collection task
                manually from <span className="font-semibold text-white/85">Task Manager</span> for that
                media type to generate suggestions.
              </p>
            </>
          ),
        },
      ],
    },
    {
      id: 'arr',
      title: 'Radarr / Sonarr / Overseerr',
      items: [
        {
          id: 'arr-fetch-missing',
          question: 'What does “Fetch Missing items” actually do?',
          answer: (
            <p>
              It allows collection jobs to push missing recommendations out of Immaculaterr. You can
              route them directly to Radarr/Sonarr, or route them to Overseerr. If disabled, the app
              still tracks pending items but does not send requests anywhere.
            </p>
          ),
        },
        {
          id: 'arr-overseerr-setup',
          question: 'How do I set up Overseerr mode in simple steps?',
          answer: (
            <ol className="list-decimal pl-5 space-y-1">
              <li>
                Go to <span className="font-semibold text-white/85">Vault</span> and set Overseerr URL
                + API key.
              </li>
              <li>Enable Overseerr in Vault and run the test.</li>
              <li>
                Go to <span className="font-semibold text-white/85">Task Manager</span> and turn on{' '}
                <span className="font-semibold text-white/85">
                  Route missing items via Overseerr
                </span>{' '}
                for each task you want (Immaculate Taste and/or Based on Latest Watched).
              </li>
              <li>
                Run the task. New missing titles from that task will be requested in Overseerr.
              </li>
            </ol>
          ),
        },
        {
          id: 'arr-overseerr-routing',
          question: 'What changes when I turn on “Route missing items via Overseerr”?',
          answer: (
            <ul className="list-disc pl-5 space-y-1">
              <li>Missing titles from that task are sent to Overseerr instead of direct ARR sends.</li>
              <li>Direct Radarr/Sonarr toggles for that task are turned off.</li>
              <li>Approval required from Observatory is turned off for that task.</li>
              <li>
                For Immaculate Taste, <span className="font-semibold text-white/85">Start search immediately</span>{' '}
                is also turned off.
              </li>
              <li>
                Suggestions, pending/active tracking, and Plex collection updates still continue as
                normal.
              </li>
              <li>
                If Overseerr is unavailable for a run, those requests are skipped for that run and
                are not sent to Radarr/Sonarr as a fallback.
              </li>
            </ul>
          ),
        },
        {
          id: 'arr-overseerr-vs-observatory',
          question: 'What is the difference between in-app approval mode and Overseerr mode?',
          answer: (
            <>
              <p>
                <span className="font-semibold text-white/85">In-app approval mode</span>: you approve
                in Observatory, then Immaculaterr sends approved items directly to Radarr/Sonarr.
              </p>
              <p>
                <span className="font-semibold text-white/85">Overseerr mode</span>: Immaculaterr sends
                missing items to Overseerr, and Overseerr becomes the place where request workflow is
                handled.
              </p>
              <p>
                Use one flow per task card. If Overseerr mode is on, Immaculaterr’s Observatory approval
                flow for sending is disabled for that task.
              </p>
            </>
          ),
        },
        {
          id: 'arr-overseerr-reset',
          question: 'How do I clear all Overseerr requests from Immaculaterr?',
          answer: (
            <>
              <p>
                Go to <span className="font-semibold text-white/85">Command Center</span> and use{' '}
                <span className="font-semibold text-white/85">Reset Overseerr Requests</span>.
              </p>
              <p>
                You’ll get a confirmation dialog. Once confirmed, Immaculaterr asks Overseerr to
                delete all requests regardless of status.
              </p>
              <p>
                This only clears Overseerr requests. It does not delete your existing Plex media files.
              </p>
            </>
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
          question:
            'Immaculaterr can’t reach Plex/Radarr/Sonarr/Overseerr — what URL should I use from Docker?',
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
                  onClick={handleAnimateTitleIcon}
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
                    data-section-id={section.id}
                    onClick={handleCatalogSectionClick}
                    className="w-full text-left text-sm font-semibold text-white/90 hover:text-white transition-colors"
                  >
                    {section.title}
                  </button>
                  <div className="mt-3 space-y-1">
                    {section.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        data-item-id={item.id}
                        onClick={handleCatalogItemClick}
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
};
