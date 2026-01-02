FROM node:20-bookworm-slim AS builder

WORKDIR /app

# 1) Install deps (cached)
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# 2) Build
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build


FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

# Install prod deps only
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --from=builder /app/apps/web/dist /app/apps/web/dist

EXPOSE 3000

CMD ["node", "apps/server/dist/main.js"]


