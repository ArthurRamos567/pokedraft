# Elysia API. Built from the repo root so workspace packages resolve:
#   docker build -f apps/api/Dockerfile .
FROM oven/bun:1-alpine AS base
WORKDIR /app

# --- deps -------------------------------------------------------------------
# Manifests only, so this layer caches until a dependency actually changes.
FROM base AS deps
COPY package.json bun.lock* ./
COPY apps/api/package.json        apps/api/
COPY packages/db/package.json     packages/db/
COPY packages/dex/package.json    packages/dex/
COPY packages/draft/package.json  packages/draft/
COPY packages/season/package.json packages/season/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN bun run --filter '@pokedraft/api' build

# --- runner -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S -G app app

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/apps/api     ./apps/api
COPY --from=build /app/packages     ./packages
COPY --from=build /app/package.json ./package.json

USER app
EXPOSE 3000
# Migrations run as a separate step (see docker-compose.full.yml), never at boot.
CMD ["bun", "run", "apps/api/src/index.ts"]
