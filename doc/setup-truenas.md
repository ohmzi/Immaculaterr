Setup: TrueNAS SCALE
===

GUI-only Custom Apps setup for TrueNAS SCALE. An in-app guide is also available at `/setup/truenas` after sign-in.

Choose one of the options below.

[← Back to Setup Guide](setupguide.md)

Option 1 (recommended): HTTPS sidecar + encrypted secret transport
---

This keeps `SECRETS_TRANSPORT_ALLOW_PLAINTEXT=false` and uses local HTTPS on `:5464`.

Create two Custom Apps in TrueNAS:

1. `immaculaterr` (main app on `:5454`)
2. `immaculaterr-https` (Caddy sidecar on `:5464`)

### Option 1 - Main app (`immaculaterr`)

In TrueNAS: **Apps -> Discover Apps -> Custom App** (name: `immaculaterr`), then paste:

```yaml
services:
  immaculaterr:
    image: ohmzii/immaculaterr:latest
    platform: linux/amd64
    pull_policy: always
    privileged: false
    restart: unless-stopped
    stdin_open: false
    tty: false
    environment:
      HOST: "0.0.0.0"
      PORT: "5454"
      APP_DATA_DIR: "/data"
      DATABASE_URL: "file:/data/tcp.sqlite"
      TRUST_PROXY: "1"
      COOKIE_SECURE: "true"
      SECRETS_TRANSPORT_ALLOW_PLAINTEXT: "false"
      CORS_ORIGINS: "https://immaculaterr.local:5464"
      TZ: "America/New_York"
      NVIDIA_VISIBLE_DEVICES: "void"
    ports:
      - "5454:5454"
    volumes:
      - immaculaterr-data:/data
    group_add:
      - "568"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - NET_RAW

volumes:
  immaculaterr-data: {}
```

### Option 1 - HTTPS sidecar app (`immaculaterr-https`)

Create a second Custom App (name: `immaculaterr-https`), then paste:

```yaml
services:
  immaculaterr-https:
    image: caddy:2.8.4-alpine
    restart: unless-stopped
    ports:
      - "5464:5464"
    command:
      - /bin/sh
      - -lc
      - |
        cat >/etc/caddy/Caddyfile <<'EOF'
        {
          admin off
          auto_https disable_redirects
          servers {
            strict_sni_host insecure_off
          }
        }

        https://immaculaterr.local:5464, https://localhost:5464, https://127.0.0.1:5464 {
          tls internal
          encode zstd gzip
          reverse_proxy http://192.168.122.179:5454 {
            header_up Host {http.request.host}
            header_up X-Forwarded-Host {http.request.host}
            header_up X-Forwarded-Proto https
            header_up X-Forwarded-Port {server_port}
          }
        }
        EOF
        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
    volumes:
      - immaculaterr-caddy-data:/data
      - immaculaterr-caddy-config:/config

volumes:
  immaculaterr-caddy-data: {}
  immaculaterr-caddy-config: {}
```

Notes:

- Replace `192.168.122.179` with your TrueNAS IP.
- Keep using `https://immaculaterr.local:5464` (hostname, not raw IP) for browser access.

### Option 1 - Client hostname mapping

On each client machine:

```bash
echo "192.168.122.179 immaculaterr.local" | sudo tee -a /etc/hosts
```

### Option 1 - Collect and trust local CA cert

In TrueNAS shell for the `immaculaterr-https` app:

```bash
cat /data/caddy/pki/authorities/local/root.crt
```

Copy full PEM output, save it on each Ubuntu client as:

`~/Downloads/immaculaterr-local-ca.crt`

Install trust:

```bash
sudo cp ~/Downloads/immaculaterr-local-ca.crt /usr/local/share/ca-certificates/immaculaterr-local-ca.crt
sudo update-ca-certificates --fresh
```

Firefox only (if needed):

- `about:config` -> `security.enterprise_roots.enabled` -> `true`

### Option 1 - Verify

```bash
curl -I http://192.168.122.179:5454
curl -I https://immaculaterr.local:5464
```

Run HTTPS verification without `-k`. A successful response confirms certificate trust is configured correctly.

Option 2: HTTP-only compatibility mode (plaintext secret transport)
---

Use this when you want setup to work directly over HTTP with no HTTPS sidecar.

> **Note:** By choosing this option, you accept responsibility for sending credentials in plaintext between browser and API. Use only on trusted local networks.

Create only one Custom App named `immaculaterr` and use:

```yaml
services:
  immaculaterr:
    image: ohmzii/immaculaterr:latest
    platform: linux/amd64
    pull_policy: always
    privileged: false
    restart: unless-stopped
    stdin_open: false
    tty: false
    environment:
      HOST: "0.0.0.0"
      PORT: "5454"
      APP_DATA_DIR: "/data"
      DATABASE_URL: "file:/data/tcp.sqlite"
      TRUST_PROXY: "1"
      COOKIE_SECURE: "false"
      SECRETS_TRANSPORT_ALLOW_PLAINTEXT: "true"
      TZ: "America/New_York"
      NVIDIA_VISIBLE_DEVICES: "void"
    ports:
      - "5454:5454"
    volumes:
      - immaculaterr-data:/data
    group_add:
      - "568"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - NET_RAW

volumes:
  immaculaterr-data: {}
```

Open: `http://192.168.122.179:5454`

Updating
---

TrueNAS Custom Apps use `pull_policy: always`, so recreating the app pulls the latest image automatically.

1. Go to **Apps → Installed Applications**.
2. Click the three-dot menu on the **immaculaterr** app, then **Edit**.
3. Click **Save** without changing anything. TrueNAS will repull the image and recreate the container.
4. If you use the HTTPS sidecar (`immaculaterr-https`), you only need to update the main app. The Caddy sidecar rarely needs updating.

After updating, verify:

```bash
curl -I http://<truenas-ip>:5454
curl -I https://immaculaterr.local:5464   # if using HTTPS sidecar
```
