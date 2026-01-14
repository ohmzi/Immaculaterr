FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Prisma engines need OpenSSL available during generation/build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

# 1) Install deps (cached)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci

# Ensure Prisma client/types exist for `nest build` in CI/Docker.
RUN npm -w apps/api run db:generate

# 2) Build
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build


FROM node:20-bookworm-slim AS runner

# Source of truth for the app's version is `apps/api/src/app.meta.ts`.
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
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin app

# Install prod deps only
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev && npm cache clean --force

# Ensure Prisma client exists at runtime (the Nest app imports @prisma/client).
RUN npm -w apps/api run db:generate

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

