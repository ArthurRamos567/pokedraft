# TanStack Start web app (SSR). Built from the repo root:
#   docker build -f apps/web/Dockerfile .
FROM oven/bun:1-alpine AS base
WORKDIR /app

# --- deps -------------------------------------------------------------------
FROM base AS deps
COPY package.json bun.lock* ./
COPY apps/web/package.json        apps/web/
COPY apps/api/package.json        apps/api/
COPY packages/dex/package.json    packages/dex/
COPY packages/draft/package.json  packages/draft/
COPY packages/season/package.json packages/season/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# --- build ------------------------------------------------------------------
# apps/api is present but never run here — the web app imports `typeof app`
# for Eden Treaty types, which is erased at build time.
FROM deps AS build
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN bun run --filter '@pokedraft/web' build

# --- runner -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S -G app app

COPY --from=build /app/apps/web/.output ./.output

USER app
EXPOSE 5173
CMD ["bun", "run", ".output/server/index.mjs"]
