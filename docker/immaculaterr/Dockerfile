# Keep to an LTS line; Node 25 has shown flaky Prisma getDMMF failures on arm64 QEMU builds.
ARG NODE_IMAGE=node:24-trixie-slim

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# Keep builder image minimal; do not install distro OpenSSL packages.
# Prisma may log OpenSSL detection warnings during generate, but generation works.

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

# Ensure Prisma client/types exist for `nest build` in CI/Docker.
RUN npm -w apps/api run db:generate

# 2) Build
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force


FROM ${NODE_IMAGE} AS runner

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

# Drop privileges for the actual app process. We avoid `gosu` (it is frequently
# flagged by image scanners due to the Go stdlib version used to build the
# Debian package). The entrypoint uses built-in tools (`setpriv`/`runuser`/`su`)
# to switch users after doing one-time permission fixes on the mounted data volume.
# NOTE: Do not install distro OpenSSL in the runtime image; we rely on the Node
# base image defaults to reduce exposure to OpenSSL CVEs from apt packages.

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin app

# Reuse prod deps and Prisma client generated in builder. This avoids a second
# registry install in runner (which can be flaky on arm64 CI) and keeps runtime
# dependency set aligned with the lockfile used by builder.
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/api/node_modules/.prisma /app/apps/api/node_modules/.prisma
COPY --from=builder /app/apps/api/node_modules/@prisma/client /app/apps/api/node_modules/@prisma/client

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
