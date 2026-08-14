# TanStack Start web app (SSR). Built from the repo root:
#   docker build -f apps/web/Dockerfile .
FROM oven/bun:1-alpine AS base
WORKDIR /app

# --- manifests --------------------------------------------------------------
# Every workspace member is listed — bun resolves the lockfile against the whole
# workspace, and a missing member reads as "lockfile changed" under --frozen.
FROM base AS manifests
COPY package.json bun.lock* ./
COPY apps/web/package.json        apps/web/
COPY apps/api/package.json        apps/api/
COPY packages/db/package.json     packages/db/
COPY packages/dex/package.json    packages/dex/
COPY packages/draft/package.json  packages/draft/
COPY packages/season/package.json packages/season/
COPY packages/shared/package.json packages/shared/

# --- build ------------------------------------------------------------------
# apps/api is present but never run here — the web app imports `typeof app`
# for Eden Treaty types, which is erased at build time.
FROM manifests AS build
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN bun install --frozen-lockfile
COPY . .
RUN bun run --filter '@pokedraft/web' build

# --- deps -------------------------------------------------------------------
# Runtime dependencies only, installed separately so vite and friends never
# reach the final image.
FROM manifests AS deps
RUN bun install --frozen-lockfile --production

# --- runner -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
# The Start server defaults to 3000, which the API owns. Pin it here so the
# container's port never depends on the caller remembering to set PORT.
ENV PORT=5173
RUN addgroup -S app && adduser -S -G app app

# The SSR bundle leaves react and friends external. Bun installs isolated —
# real packages in /app/node_modules/.bun, a symlink farm per member — so the
# runner needs both directories, at the paths the symlinks expect.
COPY --from=deps  /app/node_modules          ./node_modules
COPY --from=deps  /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/dist         ./apps/web/dist

USER app
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["bun", "run", "dist/server/server.js"]
