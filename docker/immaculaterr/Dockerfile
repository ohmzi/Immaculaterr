# Keep to an LTS line; Node 25 has shown flaky Prisma getDMMF failures on arm64 QEMU builds.
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Mitigate GHSA-qffp-2rhf-9h96 and CVE-2026-27904 from npm's bundled dependencies.
RUN npm i -g --no-audit --no-fund tar@7.5.10 minimatch@10.2.4 \
  && rm -rf /usr/local/lib/node_modules/npm/node_modules/tar \
  && rm -rf /usr/local/lib/node_modules/npm/node_modules/minimatch \
  && cp -a /usr/local/lib/node_modules/tar /usr/local/lib/node_modules/npm/node_modules/tar \
  && cp -a /usr/local/lib/node_modules/minimatch /usr/local/lib/node_modules/npm/node_modules/minimatch \
  && npm cache clean --force

# Prisma uses the `openssl` CLI to detect the host OpenSSL version at generate
# time and selects the matching query-engine binary. Without it, Prisma defaults
# to openssl-1.1.x which is wrong for bookworm (libssl3 / OpenSSL 3.0.x) and
# produces a runtime engine mismatch on ARM64.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# 1) Install deps (cached)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
ARG NPM_CI_RETRIES=3
RUN set -eu; \
  attempt=1; \
  while :; do \
    npm ci && break; \
    if [ "$attempt" -ge "$NPM_CI_RETRIES" ]; then \
      echo "npm ci failed after ${attempt} attempt(s)" >&2; \
      exit 1; \
    fi; \
    echo "npm ci failed (attempt ${attempt}/${NPM_CI_RETRIES}); retrying..." >&2; \
    npm cache clean --force || true; \
    attempt=$((attempt + 1)); \
    sleep $((attempt * 5)); \
  done

# npm@11 can sometimes omit the Prisma CLI binary path in this workspace layout.
# Ensure a Prisma CLI executable exists for startup migrations.
RUN if [ ! -x /app/apps/api/node_modules/.bin/prisma ] && [ ! -x /app/node_modules/.bin/prisma ]; then \
      npm i --no-save prisma@6.19.1; \
    fi \
    && npm -w apps/api run db:generate

# Ensure Prisma client/types exist for `nest build` in CI/Docker.
# 2) Build
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build \
  && npm prune --omit=dev --workspaces --include-workspace-root \
  && mkdir -p apps/api/node_modules \
  && npm cache clean --force


FROM node:24-bookworm-slim AS runner

# Source of truth for the app's version is `apps/api/src/version.ts`.
# (We do not inject APP_VERSION into the runtime container env; allowing APP_VERSION
# overrides causes confusing "stuck on old version" situations in Portainer when
# env vars are preserved across recreates.)
ARG APP_BUILD_SHA=
ARG APP_BUILD_TIME=

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5454
ENV APP_DATA_DIR=/data
ENV DATABASE_URL=file:/data/tcp.sqlite
ENV APP_BUILD_SHA=$APP_BUILD_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME

WORKDIR /app

# Mitigate GHSA-qffp-2rhf-9h96 and CVE-2026-27904 from npm's bundled dependencies.
RUN npm i -g --no-audit --no-fund tar@7.5.10 minimatch@10.2.4 \
  && rm -rf /usr/local/lib/node_modules/npm/node_modules/tar \
  && rm -rf /usr/local/lib/node_modules/npm/node_modules/minimatch \
  && cp -a /usr/local/lib/node_modules/tar /usr/local/lib/node_modules/npm/node_modules/tar \
  && cp -a /usr/local/lib/node_modules/minimatch /usr/local/lib/node_modules/npm/node_modules/minimatch \
  && npm cache clean --force

# Drop privileges for the actual app process. We avoid `gosu` (it is frequently
# flagged by image scanners due to the Go stdlib version used to build the
# Debian package). The entrypoint uses built-in tools (`setpriv`/`runuser`/`su`)
# to switch users after doing one-time permission fixes on the mounted data volume.

# Prisma's query engine links against system libssl at runtime. Without the
# openssl package, Prisma cannot detect the host OpenSSL version and falls back
# to openssl-1.1.x (wrong for bookworm/libssl3), emitting noisy warnings on
# every startup.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin app

# Reuse deps and Prisma artifacts from builder. This avoids a second registry
# install in runner (which can be flaky on arm64 CI) and keeps runtime
# dependency set aligned with the lockfile used by builder.
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=builder /app/apps/api/prisma /app/apps/api/prisma

# Copy built artifacts
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=builder /app/apps/web/dist /app/apps/web/dist

# Curated collection artwork (posters/backgrounds) used when creating/recreating Plex collections.
# Source of truth lives under the web app assets folder, but is used by the API at runtime.
COPY apps/web/src/assets/collection_artwork /app/apps/web/src/assets/collection_artwork

# Entrypoint script (handles /data perms then starts the app as non-root).
COPY docker/immaculaterr/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5454

CMD ["/entrypoint.sh"]
