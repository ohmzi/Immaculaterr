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

WORKDIR /app

# Install prod deps only
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=builder /app/apps/web/dist /app/apps/web/dist

EXPOSE 3210

CMD ["sh", "-c", "npm -w apps/api run db:migrate && node apps/api/dist/main.js"]


