import { motion, useAnimation } from 'motion/react';
import { ArrowLeft, Check, Copy, Server } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

const TRUENAS_MAIN_APP_HTTPS_YAML = [
  'services:',
  '  immaculaterr:',
  '    image: ohmzii/immaculaterr:v1.7.4-beta-1',
  '    platform: linux/amd64',
  '    pull_policy: always',
  '    privileged: false',
  '    restart: unless-stopped',
  '    stdin_open: false',
  '    tty: false',
  '    environment:',
  '      HOST: "0.0.0.0"',
  '      PORT: "5454"',
  '      APP_DATA_DIR: "/data"',
  '      DATABASE_URL: "file:/data/tcp.sqlite"',
  '      TRUST_PROXY: "1"',
  '      COOKIE_SECURE: "true"',
  '      SECRETS_TRANSPORT_ALLOW_PLAINTEXT: "false"',
  '      CORS_ORIGINS: "https://immaculaterr.local:5464"',
  '      TZ: "America/Los_Angeles"',
  '      NVIDIA_VISIBLE_DEVICES: "void"',
  '    ports:',
  '      - "5454:5454"',
  '    volumes:',
  '      - immaculaterr-data:/data',
  '    group_add:',
  '      - "568"',
  '    security_opt:',
  '      - no-new-privileges:true',
  '    cap_drop:',
  '      - NET_RAW',
  '',
  'volumes:',
  '  immaculaterr-data: {}',
].join('\n');

const TRUENAS_MAIN_APP_HTTP_COMPAT_YAML = [
  'services:',
  '  immaculaterr:',
  '    image: ohmzii/immaculaterr:v1.7.4-beta-1',
  '    platform: linux/amd64',
  '    pull_policy: always',
  '    privileged: false',
  '    restart: unless-stopped',
  '    stdin_open: false',
  '    tty: false',
  '    environment:',
  '      HOST: "0.0.0.0"',
  '      PORT: "5454"',
  '      APP_DATA_DIR: "/data"',
  '      DATABASE_URL: "file:/data/tcp.sqlite"',
  '      TRUST_PROXY: "1"',
  '      COOKIE_SECURE: "false"',
  '      SECRETS_TRANSPORT_ALLOW_PLAINTEXT: "true"',
  '      TZ: "America/Los_Angeles"',
  '      NVIDIA_VISIBLE_DEVICES: "void"',
  '    ports:',
  '      - "5454:5454"',
  '    volumes:',
  '      - immaculaterr-data:/data',
  '    group_add:',
  '      - "568"',
  '    security_opt:',
  '      - no-new-privileges:true',
  '    cap_drop:',
  '      - NET_RAW',
  '',
  'volumes:',
  '  immaculaterr-data: {}',
].join('\n');

const TRUENAS_HTTPS_SIDECAR_YAML = [
  'services:',
  '  immaculaterr-https:',
  '    image: caddy:2.8.4-alpine',
  '    restart: unless-stopped',
  '    ports:',
  '      - "5464:5464"',
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
  '        https://immaculaterr.local:5464, https://localhost:5464, https://127.0.0.1:5464 {',
  '          tls internal',
  '          encode zstd gzip',
  '          reverse_proxy http://192.168.122.179:5454 {',
  '            header_up Host {http.request.host}',
  '            header_up X-Forwarded-Host {http.request.host}',
  '            header_up X-Forwarded-Proto https',
  '            header_up X-Forwarded-Port {server_port}',
  '          }',
  '        }',
  '        EOF',
  '        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile',
  '    volumes:',
  '      - immaculaterr-caddy-data:/data',
  '      - immaculaterr-caddy-config:/config',
  '',
  'volumes:',
  '  immaculaterr-caddy-data: {}',
  '  immaculaterr-caddy-config: {}',
].join('\n');

const HOSTS_ENTRY_COMMAND = [
  '# Run on each client machine that will open the app',
  'echo "192.168.122.179 immaculaterr.local" | sudo tee -a /etc/hosts',
].join('\n');

const CERT_COLLECT_COMMAND = [
  '# In TrueNAS: Apps -> immaculaterr-https -> Shell',
  'cat /data/caddy/pki/authorities/local/root.crt',
].join('\n');

const UBUNTU_CERT_INSTALL_COMMAND = [
  '# Save the copied cert as ~/Downloads/immaculaterr-local-ca.crt first',
  'sudo cp ~/Downloads/immaculaterr-local-ca.crt /usr/local/share/ca-certificates/immaculaterr-local-ca.crt',
  'sudo update-ca-certificates --fresh',
].join('\n');

const VERIFY_HTTPS_COMMAND = [
  'curl -I https://immaculaterr.local:5464',
].join('\n');

const VERIFY_HTTP_COMPAT_COMMAND = [
  'curl -I http://192.168.122.179:5454',
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

export function SetupTrueNasPage() {
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
                  aria-label="Animate TrueNAS setup icon"
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
                    <Server className="w-8 h-8 md:w-10 md:h-10 text-black" strokeWidth={2.5} />
                  </motion.div>
                </motion.button>

                <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter drop-shadow-2xl">
                  Setup: TrueNAS
                </h1>
              </div>

              <p className="text-sky-100/70 text-lg font-medium max-w-3xl leading-relaxed ml-1">
                Choose one of two TrueNAS SCALE setup paths: Option 1 (recommended) keeps encrypted
                secret transport with an HTTPS sidecar, while Option 2 runs HTTP-only with plaintext
                secret transport enabled.
              </p>
              <p className="text-sm text-white/70 ml-1">
                Replace <code className="font-mono">192.168.122.179</code> with your TrueNAS IP if
                it differs.
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
            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 1 (recommended): HTTPS sidecar + encrypted secret transport
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                This is the secure default path. Keep{' '}
                <code className="font-mono">SECRETS_TRANSPORT_ALLOW_PLAINTEXT=false</code>, use the
                HTTPS sidecar on <code className="font-mono">:5464</code>, and trust the local CA on
                client devices.
              </p>
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">Option 1 - 1) Create the main app</h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                In TrueNAS: <span className="text-white/85">Apps -&gt; Discover Apps -&gt; Custom App</span>.
                Name it <code className="font-mono">immaculaterr</code>, paste this YAML, then deploy.
              </p>
              {renderCodeBlock('truenas-main-app-https-yaml', 'yaml', TRUENAS_MAIN_APP_HTTPS_YAML)}
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">Option 1 - 2) Create the HTTPS sidecar app</h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Create a second Custom App named{' '}
                <code className="font-mono">immaculaterr-https</code>, then paste this YAML. This
                sidecar serves <code className="font-mono">https://immaculaterr.local:5464</code>{' '}
                using a local Caddy CA.
              </p>
              {renderCodeBlock('truenas-https-sidecar-yaml', 'yaml', TRUENAS_HTTPS_SIDECAR_YAML)}
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">Option 1 - 3) Add hostname mapping on clients</h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Run this on each client machine that will open the web UI.
              </p>
              {renderCodeBlock('truenas-hosts-entry', 'bash', HOSTS_ENTRY_COMMAND)}
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">Option 1 - 4) Collect the local CA certificate</h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                In TrueNAS, open the shell for the{' '}
                <code className="font-mono">immaculaterr-https</code> app and run:
              </p>
              {renderCodeBlock('truenas-collect-cert', 'bash', CERT_COLLECT_COMMAND)}
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Copy the full PEM block and save it on the client as{' '}
                <code className="font-mono">~/Downloads/immaculaterr-local-ca.crt</code>.
              </p>
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 1 - 5) Install the certificate on Ubuntu clients
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Run these commands on each Ubuntu client machine.
              </p>
              {renderCodeBlock('truenas-ubuntu-cert-install', 'bash', UBUNTU_CERT_INSTALL_COMMAND)}
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                If Firefox still warns, set{' '}
                <code className="font-mono">about:config -&gt; security.enterprise_roots.enabled = true</code>{' '}
                and restart Firefox.
              </p>
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">Option 1 - 6) Verify HTTPS</h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Verify TLS trust and app reachability without using <code className="font-mono">-k</code>.
              </p>
              {renderCodeBlock('truenas-verify-https', 'bash', VERIFY_HTTPS_COMMAND)}
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-white/75">
                <li>
                  Open <code className="font-mono">https://immaculaterr.local:5464</code>.
                </li>
                <li>
                  Keep <code className="font-mono">SECRETS_TRANSPORT_ALLOW_PLAINTEXT=false</code> in
                  the main app config.
                </li>
                <li>
                  If login shows Forbidden, confirm{' '}
                  <code className="font-mono">CORS_ORIGINS=https://immaculaterr.local:5464</code> is
                  set in the main app.
                </li>
              </ul>
            </div>

            <div className={cardClass}>
              <h2 className="text-white font-semibold text-2xl">
                Option 2: HTTP-only compatibility (plaintext secret transport)
              </h2>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Use this only if you do not want to run an HTTPS sidecar. This sets{' '}
                <code className="font-mono">SECRETS_TRANSPORT_ALLOW_PLAINTEXT=true</code> so setup
                works directly over HTTP.
              </p>
              <p className="mt-2 rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
                By choosing this option, you accept responsibility for sending credentials in
                plaintext between browser and API. Use only on trusted local networks.
              </p>
              <p className="mt-3 text-sm text-white/70 leading-relaxed">
                In TrueNAS: <span className="text-white/85">Apps -&gt; Discover Apps -&gt; Custom App</span>{' '}
                (name: <code className="font-mono">immaculaterr</code>), then use this YAML:
              </p>
              {renderCodeBlock('truenas-main-app-http-compat-yaml', 'yaml', TRUENAS_MAIN_APP_HTTP_COMPAT_YAML)}
              <p className="mt-3 text-sm text-white/70 leading-relaxed">
                Verify and open HTTP directly:
              </p>
              {renderCodeBlock('truenas-verify-http-compat', 'bash', VERIFY_HTTP_COMPAT_COMMAND)}
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                URL: <code className="font-mono">http://192.168.122.179:5454</code>
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
