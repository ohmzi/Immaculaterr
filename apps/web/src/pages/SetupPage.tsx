import { motion, useAnimation } from 'motion/react';
import { Check, Copy, Wrench } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

const HTTP_ONLY_UPDATE_COMMAND = [
  'IMM_IMAGE="ghcr.io/ohmzi/immaculaterr:latest"',
  'APP_PORT=5454',
  '',
  'docker pull "$IMM_IMAGE"',
  'docker rm -f Immaculaterr 2>/dev/null || true',
  '',
  'docker run -d \\',
  '  --name Immaculaterr \\',
  '  -p ${APP_PORT}:${APP_PORT} \\',
  '  -e HOST=0.0.0.0 \\',
  '  -e PORT=${APP_PORT} \\',
  '  -e TRUST_PROXY=1 \\',
  '  -e APP_DATA_DIR=/data \\',
  '  -e DATABASE_URL=file:/data/tcp.sqlite \\',
  '  -v immaculaterr-data:/data \\',
  '  --restart unless-stopped \\',
  '  "$IMM_IMAGE"',
].join('\n');

const OPTIONAL_HTTPS_SIDECAR_COMMAND = [
  'mkdir -p ~/immaculaterr',
  'curl -fsSL -o ~/immaculaterr/caddy-entrypoint.sh \\',
  '  "https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/docker/immaculaterr/caddy-entrypoint.sh"',
  'curl -fsSL -o ~/immaculaterr/install-local-ca.sh \\',
  '  "https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/docker/immaculaterr/install-local-ca.sh"',
  'chmod +x ~/immaculaterr/caddy-entrypoint.sh ~/immaculaterr/install-local-ca.sh',
  '',
  'docker pull caddy:2.8.4-alpine',
  'docker rm -f ImmaculaterrHttps 2>/dev/null || true',
  '',
  'docker run -d \\',
  '  --name ImmaculaterrHttps \\',
  '  --network host \\',
  '  -e IMM_ENABLE_HTTP=false \\',
  '  -e IMM_ENABLE_HTTPS=true \\',
  '  -e IMM_HTTPS_PORT=5464 \\',
  '  -e IMM_INCLUDE_LOCALHOST=true \\',
  '  -e IMM_ENABLE_LAN_IP=true \\',
  '  -e APP_INTERNAL_PORT=5454 \\',
  '  -v ~/immaculaterr/caddy-entrypoint.sh:/etc/caddy/caddy-entrypoint.sh:ro \\',
  '  -v immaculaterr-caddy-data:/data \\',
  '  -v immaculaterr-caddy-config:/config \\',
  '  --restart unless-stopped \\',
  '  caddy:2.8.4-alpine \\',
  '  /bin/sh /etc/caddy/caddy-entrypoint.sh',
  '',
  'cd ~/immaculaterr',
  './install-local-ca.sh',
].join('\n');

async function copyToClipboard(text: string) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

export const SetupPage = () => {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const location = useLocation();
  const navigate = useNavigate();
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  const copiedResetTimeoutRef = useRef<number | null>(null);

  type SetupItem = {
    id: string;
    question: string;
    answer: React.ReactNode;
  };
  type SetupSection = {
    id: string;
    title: string;
    catalogLine: string;
    items: SetupItem[];
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
  const centerElementInViewport = useCallback((id: string, behavior: ScrollBehavior) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const headingAnchorOffset = Math.min(56, Math.max(0, rect.height / 3));
    const anchorY = rect.top + headingAnchorOffset;
    const targetTop = window.scrollY + anchorY - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, targetTop), behavior });
  }, []);

  const setCopiedState = useCallback((commandId: string) => {
    if (copiedResetTimeoutRef.current !== null) {
      window.clearTimeout(copiedResetTimeoutRef.current);
      copiedResetTimeoutRef.current = null;
    }
    setCopiedCommandId(commandId);
    copiedResetTimeoutRef.current = window.setTimeout(() => {
      setCopiedCommandId(null);
      copiedResetTimeoutRef.current = null;
    }, 1800);
  }, []);

  const handleCopyCommand = useCallback(
    async (commandId: string, command: string) => {
      try {
        await copyToClipboard(command);
        setCopiedState(commandId);
      } catch {
        // Clipboard can be blocked by browser permissions.
      }
    },
    [setCopiedState],
  );
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
  const renderCommandBlock = (commandId: string, command: string) => (
    <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0c0f]/40">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-3 py-2">
        <span className="font-mono text-[11px] text-white/70">bash</span>
        <button
          type="button"
          onClick={() => void handleCopyCommand(commandId, command)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white active:scale-[0.98]"
        >
          {copiedCommandId === commandId ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copiedCommandId === commandId ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-w-full overflow-auto p-4 text-[11px] text-white/85">
        <code>{command}</code>
      </pre>
    </div>
  );

  useEffect(() => {
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!hash) return;

    const rafId = window.requestAnimationFrame(() => {
      centerElementInViewport(hash, 'smooth');
    });
    const settleId = window.setTimeout(() => centerElementInViewport(hash, 'smooth'), 320);
    const finalId = window.setTimeout(() => centerElementInViewport(hash, 'auto'), 900);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleId);
      window.clearTimeout(finalId);
    };
  }, [centerElementInViewport, location.hash]);

  useEffect(() => {
    return () => {
      if (copiedResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedResetTimeoutRef.current);
        copiedResetTimeoutRef.current = null;
      }
    };
  }, []);

  const SETUP_SECTIONS: SetupSection[] = [
    {
      id: 'update-paths',
      title: 'Update helper',
      catalogLine: 'Open update commands and post-update checks.',
      items: [
        {
          id: 'update-paths-run-order',
          question: 'What should I run first?',
          answer: (
            <>
              <p>
                Use this page as the source of truth when the app says an update is available.
                The safe order is:
              </p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  Run <span className="font-semibold text-white/85">HTTP-only update</span> first
                  every time.
                </li>
                <li>
                  Run <span className="font-semibold text-white/85">Optional HTTPS sidecar</span>{' '}
                  only if you use the built-in local HTTPS helper on port{' '}
                  <code className="font-mono">5464</code>.
                </li>
                <li>
                  After the containers restart, verify sign-in, version, and the URL you normally
                  use.
                </li>
              </ol>
              <p>
                If you only use <code className="font-mono">http://&lt;server-ip&gt;:5454</code>,
                the first block is enough. If you browse on{' '}
                <code className="font-mono">https://&lt;server-ip&gt;:5464</code>, run both blocks.
              </p>
            </>
          ),
        },
        {
          id: 'update-paths-http-only',
          question: 'HTTP-only update (required)',
          answer: (
            <>
              <p>
                Run this first every time. It refreshes the main Immaculaterr app container on port{' '}
                <code className="font-mono">5454</code>.
              </p>
              <p>
                This is the part that actually updates the app image. It pulls the latest container,
                recreates <code className="font-mono">Immaculaterr</code>, and keeps the existing{' '}
                <code className="font-mono">immaculaterr-data</code> volume mounted at{' '}
                <code className="font-mono">/data</code>.
              </p>
              {renderCommandBlock('update-paths-http-only', HTTP_ONLY_UPDATE_COMMAND)}
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/55">
                  After this command
                </div>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  <li>
                    Open <code className="font-mono">http://&lt;server-ip&gt;:5454</code> and make
                    sure the app loads.
                  </li>
                  <li>Sign in and confirm your data, Vault settings, and Task Manager still load.</li>
                  <li>
                    If the Help menu previously showed an update banner, confirm it clears after the
                    restart.
                  </li>
                </ul>
              </div>
              <p>
                If you already terminate HTTPS with your own reverse proxy, this is still the command
                you run for the Immaculaterr app itself.
              </p>
            </>
          ),
        },
        {
          id: 'update-paths-https-sidecar',
          question: 'Optional HTTPS sidecar (run only if you use local HTTPS)',
          answer: (
            <>
              <p>
                Run this only when you want the bundled local HTTPS helper via Caddy. It can be added
                later without changing the HTTP-only update flow.
              </p>
              <p>
                Use it when you browse on{' '}
                <code className="font-mono">https://&lt;server-ip&gt;:5464</code> and want local
                secure-cookie behavior without setting up your own reverse proxy. If you only use
                plain HTTP or already have your own TLS setup, you can skip this block. This command
                also runs local CA certificate install on the Docker host.
              </p>
              {renderCommandBlock('update-paths-https-sidecar', OPTIONAL_HTTPS_SIDECAR_COMMAND)}
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/55">
                  After this command
                </div>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  <li>
                    Open <code className="font-mono">https://&lt;server-ip&gt;:5464</code> and verify
                    the sidecar is reachable.
                  </li>
                  <li>
                    On first use per device, trust the local certificate authority if you want a clean
                    browser experience.
                  </li>
                  <li>
                    If you browse from other devices, import{' '}
                    <code className="font-mono">/tmp/immaculaterr-local-ca.crt</code> from the Docker
                    host on those devices.
                  </li>
                  <li>
                    Keep using the same HTTPS URL after sign-in so browser cookies stay consistent.
                  </li>
                </ul>
              </div>
            </>
          ),
        },
        {
          id: 'update-paths-verify',
          question: 'What should I verify after updating?',
          answer: (
            <>
              <p>A quick smoke check after an update saves a lot of guessing later:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  The app opens at the URL you actually use:
                  <code className="ml-1 font-mono">http://&lt;server-ip&gt;:5454</code> or{' '}
                  <code className="font-mono">https://&lt;server-ip&gt;:5464</code>.
                </li>
                <li>You can sign in normally and your saved configuration is still present.</li>
                <li>The Help menu version or update banner reflects the new release state.</li>
                <li>Vault integrations and Task Manager still load without obvious errors.</li>
                <li>
                  If you use the local HTTPS helper, the browser trusts the certificate on the devices
                  that need it.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      id: 'truenas-guide',
      title: 'TrueNAS guide',
      catalogLine:
        'Open the TrueNAS setup guide with both HTTPS-sidecar and HTTP-compatibility options.',
      items: [
        {
          id: 'truenas-guide-overview',
          question: 'Need TrueNAS-specific setup steps?',
          answer: (
            <>
              <p>
                If you are deploying with TrueNAS SCALE Custom Apps, use the dedicated guide:
              </p>
              <p>
                <Link
                  to="/setup/truenas"
                  className="font-semibold text-sky-200 underline decoration-sky-200/40 underline-offset-4 hover:text-white hover:decoration-white/60"
                >
                  Open Setup: TrueNAS
                </Link>
              </p>
              <p>
                It includes both paths: Option 1 (HTTPS sidecar + encrypted secret transport) and
                Option 2 (HTTP-only compatibility with plaintext secret transport), plus working YAML
                and verification steps.
              </p>
            </>
          ),
        },
      ],
    },
  ];

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';

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
                  aria-label="Animate setup icon"
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
                    <Wrench className="w-8 h-8 md:w-10 md:h-10 text-black" strokeWidth={2.5} />
                  </motion.div>
                </motion.button>

                <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                  Setup
                </h1>
              </div>

              <p className="text-sky-100/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                Use this page as the update checklist whenever the app says a newer release is
                available.
              </p>
            </motion.div>
          </div>

          <div className={cardClass}>
            <div className="text-white font-semibold text-xl">Catalog</div>
            <div className="mt-2 text-sm text-white/70 leading-relaxed">
              Jump straight to the section you need.
            </div>

            <div className="mt-5 space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
              {SETUP_SECTIONS.map((section, index) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => navigateToAnchor(section.id)}
                  className="w-full rounded-xl border border-transparent px-3 py-3 text-left transition-colors hover:border-white/10 hover:bg-white/5"
                >
                  <div className="text-sm font-semibold text-white/90">{section.title}</div>
                  <div className="mt-1 text-sm text-white/65">{section.catalogLine}</div>
                  {index < SETUP_SECTIONS.length - 1 ? (
                    <div className="mt-3 h-px bg-white/10" />
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 space-y-6">
            {SETUP_SECTIONS.map((section) => (
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
