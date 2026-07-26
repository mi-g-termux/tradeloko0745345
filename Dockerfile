# MemePump production image.
#
# Works as-is on Docker, Docker Compose, Fly.io, Google Cloud Run, Render,
# Railway, DigitalOcean App Platform, Coolify/Dokploy, Kubernetes, and any VPS.
#
# Multi-stage so the runtime image carries no build tooling and no dev deps.
# Relies on next.config.mjs honouring BUILD_STANDALONE=1.

# ---------- 1. deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
# libc6-compat: some native deps expect glibc symbols on Alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
# Use a reproducible install when a lockfile exists, otherwise fall back.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------- 2. build ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so they
# must be present here, not only at runtime. Pass them with --build-arg.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=$NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

ENV BUILD_STANDALONE=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- 3. runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as a non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# standalone/ already contains the pruned node_modules and server.js.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Bind to every interface or the platform's health check cannot reach the app.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
