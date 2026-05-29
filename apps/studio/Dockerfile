# syntax=docker/dockerfile:1.7
# Multi-stage build for the Studio (Next.js 16 standalone) in the pnpm monorepo.
# Build context is the REPO ROOT (see infra/docker-compose.yml: context: ..).

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/agent-core/package.json packages/agent-core/
COPY apps/studio/package.json apps/studio/
COPY apps/cli/package.json apps/cli/
RUN pnpm install --frozen-lockfile

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# agent-core must be built to dist first (Studio imports the compiled package).
RUN pnpm --filter @ai-cms/agent-core build \
    && pnpm --filter @ai-cms/studio build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# git is required at runtime: each tenant site is a git working tree (TenantRepo).
RUN apk add --no-cache git \
    && addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 \
    && mkdir -p /data && chown -R nextjs:nodejs /data

# Standalone bundle traces the whole monorepo (incl. templates/, packages/agent-core).
COPY --from=builder --chown=nextjs:nodejs /app/apps/studio/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/studio/.next/static ./apps/studio/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/studio/public ./apps/studio/public

USER nextjs
ENV HOME=/data
EXPOSE 3000
# cwd = /app; server at apps/studio/server.js. Data/template paths come from env
# (TENANTS_ROOT, SITES_ROOT, TEMPLATE_DIR set in docker-compose).
CMD ["node", "apps/studio/server.js"]
