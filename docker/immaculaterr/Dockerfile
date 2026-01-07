FROM node:20-bookworm-slim AS builder

WORKDIR /app

# 1) Install deps (cached)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci

# 2) Build
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build


FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3210
ENV APP_DATA_DIR=/data
ENV DATABASE_URL=file:/data/tcp.sqlite

WORKDIR /app

# Drop privileges for the actual app process. We use gosu to switch users after
# doing any one-time permission fixes on the mounted data volume.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin app

# Install prod deps only
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev && npm cache clean --force

# Copy built artifacts
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=builder /app/apps/web/dist /app/apps/web/dist

# Entrypoint script (handles /data perms then starts the app as non-root).
COPY docker/immaculaterr/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3210

CMD ["/entrypoint.sh"]

