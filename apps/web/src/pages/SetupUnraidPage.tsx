import { motion, useAnimation } from 'motion/react';
import { ArrowLeft, Check, Copy, Server } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

const UNRAID_HTTP_ONLY_COMPOSE_YAML = [
  'services:',
  '  immaculaterr:',
  '    container_name: Immaculaterr',
  '    image: ohmzii/immaculaterr:latest',
  '    network_mode: host',
  '    ports:',
  '      - "5454:5454"',
  '    environment:',
  '      - HOST=0.0.0.0',
  '      - PORT=5454',
  '      - TZ=America/New_York',
  '      - APP_DATA_DIR=/data',
  '      - DATABASE_URL=file:/data/tcp.sqlite',
  '      - SECRETS_TRANSPORT_ALLOW_PLAINTEXT=true',
  '      - COOKIE_SECURE=false',
  '    volumes:',
  '      - /mnt/user/appdata/immaculaterr:/data',
  '    security_opt:',
  '      - no-new-privileges:true',
  '    cap_drop:',
  '      - NET_RAW',
  '    restart: unless-stopped',
].join('\n');

const UNRAID_HTTP_ONLY_ENV_VARS = [
  'SECRETS_TRANSPORT_ALLOW_PLAINTEXT=true',
  'COOKIE_SECURE=false',
  'TZ=America/New_York',
].join('\n');

const UNRAID_HTTPS_MAIN_APP_COMPOSE_YAML = [
  'services:',
  '  immaculaterr:',
  '    container_name: Immaculaterr',
  '    image: ohmzii/immaculaterr:latest',
  '    network_mode: host',
  '    ports:',
  '      - "5455:5455"',
  '    environment:',
  '      - HOST=0.0.0.0',
  '      - PORT=5455',
  '      - TZ=America/New_York',
  '      - APP_DATA_DIR=/data',
  '      - DATABASE_URL=file:/data/tcp.sqlite',
  '      - TRUST_PROXY=1',
  '      - COOKIE_SECURE=true',
  '    volumes:',
  '      - /mnt/user/appdata/immaculaterr:/data',
  '    security_opt:',
  '      - no-new-privileges:true',
  '    cap_drop:',
  '      - NET_RAW',
  '    restart: unless-stopped',
].join('\n');

const UNRAID_HTTPS_CADDY_COMPOSE_YAML = [
  'services:',
  '  immaculaterr-https:',
  '    container_name: ImmaculaterrHttps',
  '    image: caddy:2.8.4-alpine',
  '    network_mode: host',
  '    restart: unless-stopped',
  '    command:',
  '      - /bin/sh',
  '      - -lc',
  '      - |',
  "        cat >/etc/caddy/Caddyfile <<'EOF'",
  '        {',
  '          admin off',
  '          auto_https disable_redirects',
  '          servers {',
  '            strict_sni_host insecure_off',
  '          }',
  '        }',
  '',
  '        :5454 {',
  '          reverse_proxy 127.0.0.1:5455',
  '        }',
  '',
  '        https://localhost:5464, https://127.0.0.1:5464 {',
  '          tls internal',
  '          encode zstd gzip',
  '          reverse_proxy 127.0.0.1:5455 {',
  '            header_up Host {http.request.host}',
  '            header_up X-Forwarded-Host {http.request.host}',
  '            header_up X-Forwarded-Proto https',
  '            header_up X-Forwarded-Port {server_port}',
  '          }',
  '        }',
  '        EOF',
  '        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile',
  '    volumes:',
  '      - /mnt/user/appdata/immaculaterr-caddy/data:/data',
  '      - /mnt/user/appdata/immaculaterr-caddy/config:/config',
  '    security_opt:',
  '      - no-new-privileges:true',
  '    cap_drop:',
  '      - NET_RAW',
].join('\n');

const UNRAID_CERT_COLLECT_COMMAND = [
  '# Unraid terminal: click the Caddy container icon -> Console',
  'cat /data/caddy/pki/authorities/local/root.crt',
].join('\n');

const UBUNTU_CERT_INSTALL_COMMAND = [
  '# Save the copied cert as ~/Downloads/immaculaterr-local-ca.crt first',
  'sudo cp ~/Downloads/immaculaterr-local-ca.crt /usr/local/share/ca-certificates/immaculaterr-local-ca.crt',
  'sudo update-ca-certificates --fresh',
].join('\n');

const VERIFY_HTTPS_COMMAND = [
  'curl -I https://<server-ip>:5464',
].join('\n');

const VERIFY_HTTP_COMMAND = [
  'curl -I http://<server-ip>:5454',
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

export function SetupUnraidPage() {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null);
  const copiedResetTimeoutRef = useRef<number | null>(null);

  const setCopiedState = useCallback((blockId: string) => {
    if (copiedResetTimeoutRef.current !== null) {
      window.clearTimeout(copiedResetTimeoutRef.current);
      copiedResetTimeoutRef.current = null;
    }
    setCopiedBlockId(blockId);
    copiedResetTimeoutRef.current = window.setTimeout(() => {
      setCopiedBlockId(null);
      copiedResetTimeoutRef.current = null;
    }, 1800);
  }, []);

  const handleCopy = useCallback(
    async (blockId: string, value: string) => {
      try {
        await copyToClipboard(value);
        setCopiedState(blockId);
      } catch {
        // Clipboard can be blocked by browser permissions.
      }
    },
    [setCopiedState],
  );

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

  useEffect(() => {
    return () => {
      if (copiedResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedResetTimeoutRef.current);
        copiedResetTimeoutRef.current = null;
      }
    };
  }, []);

  const cardClass =
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';

  const renderCodeBlock = (blockId: string, title: string, value: string) => (
    <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0c0f]/40">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-3 py-2">
        <span className="font-mono text-[11px] text-white/70">{title}</span>
        <button
          type="button"
          onClick={() => void handleCopy(blockId, value)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white active:scale-[0.98]"
        >
          {copiedBlockId === blockId ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copiedBlockId === blockId ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-w-full overflow-auto p-4 text-[11px] text-white/85">
        <code>{value}</code>
      </pre>
    </div>
  );

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
                  aria-label="Animate Unraid setup icon"
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#f97316] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#f97316] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                  <motion.div
                    initial={{ rotate: -10, scale: 0.94, y: 2 }}
                    animate={{ rotate: -6, scale: 1, y: 0 }}
                    whileHover={{ rotate: 0, scale: 1.04 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    style={{ backfaceVisibility: 'hidden' }}
                    className="relative will-change-transform transform-gpu p-3 md:p-4 bg-[#f97316] rounded-2xl shadow-[0_0_30px_rgba(249,115,22,0.3)] border border-white/20"
                  >
                    <Server className="w-8 h-8 md:w-10 md:h-10 text-white" strokeWidth={2.5} />
                  </motion.div>
                </motion.button>

                <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter drop-shadow-2xl">
                  Setup: Unraid
                </h1>
              </div>

              <p className="text-sky-100/70 text-lg font-medium max-w-3xl leading-relaxed ml-1">
                Choose one of two Unraid setup paths: Option 1 runs HTTP-only with minimal
                configuration, while Option 2 (recommended) adds an HTTPS sidecar for encrypted
                secret transport.
              </p>
              <p className="text-sm text-white/70 ml-1">
                Replace <code className="font-mono">&lt;server-ip&gt;</code> with your Unraid
                server IP throughout this guide.
              </p>
              <div className="ml-1">
                <Link
                  to="/setup"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Setup
                </Link>
              </div>
            </motion.div>
          </div>

          <div className="space-y-6">
            {/* ── Option 1: HTTP-only ── */}
            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 1: HTTP-only (quick start)
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                The simplest path. This sets{' '}
                <code className="font-mono">SECRETS_TRANSPORT_ALLOW_PLAINTEXT=true</code> so the
                wizard and Vault work over plain HTTP. No extra containers required.
              </p>
              <p className="mt-2 rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
                By choosing this option, you accept responsibility for sending credentials in
                plaintext between browser and API. Use only on trusted local networks.
              </p>
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 1 - Existing container (add env vars)
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                If you already have Immaculaterr running on Unraid and hit the TMDB wizard error,
                add these two environment variables to your existing container:
              </p>
              <ol className="mt-3 list-decimal pl-5 space-y-1 text-sm text-white/75 leading-relaxed">
                <li>
                  Go to <span className="text-white/85">Docker</span> tab in Unraid.
                </li>
                <li>
                  Click the Immaculaterr container icon, then{' '}
                  <span className="text-white/85">Edit</span>.
                </li>
                <li>
                  Click{' '}
                  <span className="text-white/85">
                    Add another Path, Port, Variable, Label or Device
                  </span>.
                </li>
                <li>
                  Select <span className="text-white/85">Variable</span>. Set the name/key to{' '}
                  <code className="font-mono">SECRETS_TRANSPORT_ALLOW_PLAINTEXT</code> and the
                  value to <code className="font-mono">true</code>. Click Save.
                </li>
                <li>
                  Repeat: add another variable with name{' '}
                  <code className="font-mono">COOKIE_SECURE</code> and value{' '}
                  <code className="font-mono">false</code>.
                </li>
                <li>
                  Click <span className="text-white/85">Apply</span> to recreate the container.
                </li>
              </ol>
              {renderCodeBlock('unraid-http-only-env-vars', 'environment variables', UNRAID_HTTP_ONLY_ENV_VARS)}
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 1 - Fresh install (docker compose)
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                For a fresh install using docker compose on Unraid, create a{' '}
                <code className="font-mono">docker-compose.yml</code> in a directory on your array
                (e.g.{' '}
                <code className="font-mono">/mnt/user/appdata/immaculaterr</code>), then run{' '}
                <code className="font-mono">docker compose up -d</code>.
              </p>
              {renderCodeBlock('unraid-http-only-compose', 'docker-compose.yml', UNRAID_HTTP_ONLY_COMPOSE_YAML)}
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 1 - Verify
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Confirm the app is reachable:
              </p>
              {renderCodeBlock('unraid-verify-http', 'bash', VERIFY_HTTP_COMMAND)}
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-white/75">
                <li>
                  Open{' '}
                  <code className="font-mono">http://&lt;server-ip&gt;:5454</code> in your
                  browser.
                </li>
                <li>The wizard should now accept API keys without WebCrypto errors.</li>
              </ul>
            </div>

            {/* ── Option 2: HTTPS sidecar ── */}
            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 2 (recommended): HTTPS sidecar + encrypted secret transport
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                This is the secure path. A Caddy sidecar terminates TLS locally so the browser
                has a secure context. WebCrypto works natively, and{' '}
                <code className="font-mono">SECRETS_TRANSPORT_ALLOW_PLAINTEXT</code> stays{' '}
                <code className="font-mono">false</code>.
              </p>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                The main app listens on an internal port{' '}
                (<code className="font-mono">5455</code>) while Caddy serves HTTP on{' '}
                <code className="font-mono">:5454</code> and HTTPS on{' '}
                <code className="font-mono">:5464</code>.
              </p>
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 2 - 1) Main app container
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Create the main app container. Note the internal port is{' '}
                <code className="font-mono">5455</code> (Caddy will front it on{' '}
                <code className="font-mono">5454</code>/<code className="font-mono">5464</code>).
              </p>
              {renderCodeBlock('unraid-https-main-app', 'docker-compose.yml — main app', UNRAID_HTTPS_MAIN_APP_COMPOSE_YAML)}
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 2 - 2) Caddy HTTPS sidecar container
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Create a second container running Caddy. This handles HTTP on{' '}
                <code className="font-mono">:5454</code> and HTTPS with local TLS on{' '}
                <code className="font-mono">:5464</code>, proxying to the main app on{' '}
                <code className="font-mono">:5455</code>.
              </p>
              {renderCodeBlock('unraid-https-caddy', 'docker-compose.yml — caddy sidecar', UNRAID_HTTPS_CADDY_COMPOSE_YAML)}
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 2 - 3) Collect and trust the local CA certificate
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Open the Caddy container console in Unraid (click container icon, then{' '}
                <span className="text-white/85">Console</span>) and run:
              </p>
              {renderCodeBlock('unraid-collect-cert', 'bash', UNRAID_CERT_COLLECT_COMMAND)}
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Copy the full PEM block and save it on the client as{' '}
                <code className="font-mono">~/Downloads/immaculaterr-local-ca.crt</code>.
              </p>
              <p className="mt-3 text-sm text-white/70 leading-relaxed">
                Install trust on Ubuntu/Debian clients:
              </p>
              {renderCodeBlock('unraid-ubuntu-cert-install', 'bash', UBUNTU_CERT_INSTALL_COMMAND)}
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                If Firefox still warns, set{' '}
                <code className="font-mono">
                  about:config -&gt; security.enterprise_roots.enabled = true
                </code>{' '}
                and restart Firefox.
              </p>
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 2 - 4) Verify
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Verify TLS trust and app reachability without using{' '}
                <code className="font-mono">-k</code>.
              </p>
              {renderCodeBlock('unraid-verify-https', 'bash', VERIFY_HTTPS_COMMAND)}
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-white/75">
                <li>
                  Open{' '}
                  <code className="font-mono">https://&lt;server-ip&gt;:5464</code> for encrypted
                  access.
                </li>
                <li>
                  HTTP on{' '}
                  <code className="font-mono">http://&lt;server-ip&gt;:5454</code> also works
                  (Caddy proxies both).
                </li>
                <li>
                  Keep{' '}
                  <code className="font-mono">SECRETS_TRANSPORT_ALLOW_PLAINTEXT</code> unset or{' '}
                  <code className="font-mono">false</code> for encrypted secret transport.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
