# Elysia API. Built from the repo root so workspace packages resolve:
#   docker build -f apps/api/Dockerfile .
FROM oven/bun:1-alpine AS base
WORKDIR /app

# --- manifests --------------------------------------------------------------
# Manifests only, so the install layers cache until a dependency changes.
# Every workspace member is listed — bun resolves the lockfile against the whole
# workspace, and a missing member reads as "lockfile changed" under --frozen.
FROM base AS manifests
COPY package.json bun.lock* ./
COPY apps/api/package.json        apps/api/
COPY apps/web/package.json        apps/web/
COPY packages/db/package.json     packages/db/
COPY packages/dex/package.json    packages/dex/
COPY packages/draft/package.json  packages/draft/
COPY packages/season/package.json packages/season/
COPY packages/shared/package.json packages/shared/

# --- deps -------------------------------------------------------------------
# Runtime dependencies only. Bun installs isolated: real packages live in
# /app/node_modules/.bun and each member's node_modules is a symlink farm into
# it, so the runner needs both directories or nothing resolves.
FROM manifests AS deps
RUN bun install --frozen-lockfile --production

# --- runner -----------------------------------------------------------------
# Bun runs TypeScript directly, so there is nothing to compile — the image is
# dependencies plus source.
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S -G app app

COPY --from=deps /app/node_modules          ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
# Each package has its own symlink farm (drizzle-orm, @pkmn/*); source lands on
# top of it in the next COPY.
COPY --from=deps /app/packages ./packages
COPY package.json ./package.json
COPY apps/api     ./apps/api
COPY packages     ./packages

USER app
EXPOSE 3000
# Migrations run as a separate step (see docker-compose.full.yml), never at boot.
CMD ["bun", "run", "apps/api/src/index.ts"]
