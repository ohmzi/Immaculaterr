Setup: Unraid
===

Docker setup for Unraid. An in-app guide is also available at `/setup/unraid` after sign-in.

Choose one of the options below.

[← Back to Setup Guide](setupguide.md)

Option 1: HTTP-only (quick start)
---

The simplest path. Add two environment variables so the wizard and Vault work over plain HTTP.

> **Note:** By choosing this option, you accept responsibility for sending credentials in plaintext between browser and API. Use only on trusted local networks.

### Option 1 - Existing container (add env vars)

If you already have Immaculaterr running on Unraid:

1. Go to the **Docker** tab.
2. Click the Immaculaterr container icon, then **Edit**.
3. Click **Add another Path, Port, Variable, Label or Device** → **Variable**.
4. Add `SECRETS_TRANSPORT_ALLOW_PLAINTEXT` with value `true`.
5. Add another variable: `COOKIE_SECURE` with value `false`.
6. Click **Apply** to recreate the container.

### Option 1 - Fresh install (docker compose)

Create a `docker-compose.yml` on your array (e.g. `/mnt/user/appdata/immaculaterr/`):

```yaml
services:
  immaculaterr:
    container_name: Immaculaterr
    image: ohmzii/immaculaterr:latest
    network_mode: host
    ports:
      - "5454:5454"
    environment:
      - HOST=0.0.0.0
      - PORT=5454
      - APP_DATA_DIR=/data
      - DATABASE_URL=file:/data/tcp.sqlite
      - SECRETS_TRANSPORT_ALLOW_PLAINTEXT=true
      - COOKIE_SECURE=false
    volumes:
      - /mnt/user/appdata/immaculaterr:/data
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - NET_RAW
    restart: unless-stopped
```

Then run:

```bash
docker compose up -d
```

Open: `http://<server-ip>:5454`

Option 2 (recommended): HTTPS sidecar + encrypted secret transport
---

This keeps `SECRETS_TRANSPORT_ALLOW_PLAINTEXT=false` (the default). A Caddy sidecar terminates TLS locally so the browser has a secure context and WebCrypto works natively.

The main app listens on an internal port (`5455`) while Caddy serves HTTP on `:5454` and HTTPS on `:5464`.

### Option 2 - Main app container

```yaml
services:
  immaculaterr:
    container_name: Immaculaterr
    image: ohmzii/immaculaterr:latest
    network_mode: host
    ports:
      - "5455:5455"
    environment:
      - HOST=0.0.0.0
      - PORT=5455
      - APP_DATA_DIR=/data
      - DATABASE_URL=file:/data/tcp.sqlite
      - TRUST_PROXY=1
      - COOKIE_SECURE=true
    volumes:
      - /mnt/user/appdata/immaculaterr:/data
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - NET_RAW
    restart: unless-stopped
```

### Option 2 - Caddy HTTPS sidecar container

```yaml
services:
  immaculaterr-https:
    container_name: ImmaculaterrHttps
    image: caddy:2.8.4-alpine
    network_mode: host
    restart: unless-stopped
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

        :5454 {
          reverse_proxy 127.0.0.1:5455
        }

        https://localhost:5464, https://127.0.0.1:5464 {
          tls internal
          encode zstd gzip
          reverse_proxy 127.0.0.1:5455 {
            header_up Host {http.request.host}
            header_up X-Forwarded-Host {http.request.host}
            header_up X-Forwarded-Proto https
            header_up X-Forwarded-Port {server_port}
          }
        }
        EOF
        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
    volumes:
      - /mnt/user/appdata/immaculaterr-caddy/data:/data
      - /mnt/user/appdata/immaculaterr-caddy/config:/config
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - NET_RAW
```

### Option 2 - Collect and trust local CA cert

Open the Caddy container console in Unraid (click the container icon, then **Console**) and run:

```bash
cat /data/caddy/pki/authorities/local/root.crt
```

Copy the full PEM output, save it on each client as `~/Downloads/immaculaterr-local-ca.crt`, then install trust:

```bash
sudo cp ~/Downloads/immaculaterr-local-ca.crt /usr/local/share/ca-certificates/immaculaterr-local-ca.crt
sudo update-ca-certificates --fresh
```

Firefox only (if needed):

- `about:config` -> `security.enterprise_roots.enabled` -> `true`

### Option 2 - Verify

```bash
curl -I https://<server-ip>:5464
```

Run without `-k`. A successful response confirms certificate trust is configured correctly.

- Open `https://<server-ip>:5464` for encrypted access.
- HTTP on `http://<server-ip>:5454` also works (Caddy proxies both).
