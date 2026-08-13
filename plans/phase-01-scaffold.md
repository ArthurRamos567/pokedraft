# Phase 1 — Scaffold & auth

**Goal:** a monorepo that boots, migrates, authenticates, type-checks, and
tests in CI. Nothing Pokémon-specific. Everything after this phase assumes
these rails exist.

## Deliverables

1. Bun workspaces monorepo with shared tsconfig + biome
2. Postgres via docker compose, Drizzle schema + migration pipeline
3. Elysia API booting with env validation, error handler, OpenAPI, CORS
4. Better Auth wired to Drizzle: email/password + Discord + Google
5. `authMacro` for protected routes
6. Eden Treaty type export consumed by a throwaway client test
7. GitHub Actions: install → typecheck → lint → test

## Layout

```
pokedraft/
  package.json            — workspaces: ["apps/*", "packages/*"]
  tsconfig.base.json      — strict, paths for @pokedraft/*
  biome.json
  docker-compose.yml      — postgres:17 + named volume
  .env.example
  .github/workflows/ci.yml
  apps/api/
    src/
      index.ts            — compose plugins, listen
      app.ts              — the Elysia instance (exported for tests + Eden)
      env.ts              — typebox-validated process.env, fails fast
      db.ts               — drizzle client singleton
      auth.ts             — better-auth instance
      plugins/
        auth.ts           — mount handler + authMacro
        errors.ts         — onError → error contract
        logger.ts
      modules/health/
  packages/db/
    src/schema/
      index.ts
      auth.ts             — better-auth tables
    drizzle.config.ts
    migrations/
  packages/shared/
    src/index.ts          — shared typebox schemas, error codes enum
```

The API instance lives in `app.ts` and is *exported*, so tests call
`app.handle(new Request(…))` with no port binding, and `apps/web` imports
`typeof app` for Eden.

## Env contract (`.env.example`)

```
DATABASE_URL=postgres://pokedraft:pokedraft@localhost:5432/pokedraft
BETTER_AUTH_SECRET=            # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
WEB_ORIGIN=http://localhost:5173
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
LOG_LEVEL=debug
```

`env.ts` validates with typebox at import time and exits with a readable
message listing every missing key — not one at a time.

## Auth wiring

Better Auth owns its four tables (`user`, `session`, `account`,
`verification`) through the Drizzle adapter. Generate them with the
Better Auth CLI, then commit the generated schema into `packages/db` so it
lives under normal migrations rather than a second source of truth.

Config:

- `emailAndPassword: { enabled: true, requireEmailVerification: true }`
- `socialProviders: { discord, google }` — Discord matters most; draft leagues
  already live there
- `session: { expiresIn: 30d, updateAge: 1d, cookieCache: { enabled: true } }`
- `user.additionalFields: { displayName, showdownUsername, avatarUrl }` —
  `showdownUsername` is used later in phase 6 to match replay participants
- `trustedOrigins: [WEB_ORIGIN]`

Mounting in Elysia:

```ts
app.mount(auth.handler)                   // /api/auth/*
```

`authMacro` resolves the session once per request:

```ts
.macro({
  auth: {
    async resolve({ request, status }) {
      const s = await auth.api.getSession({ headers: request.headers })
      if (!s) return status(401, unauthorized())
      return { user: s.user, session: s.session }
    },
  },
})
```

Routes then declare `{ auth: true }` and get a typed `user` in context.

## Migration policy

- Migrations are generated (`drizzle-kit generate`) and committed — never
  `db push` outside local scratch work.
- Every migration is reviewed for lock behavior: no `ALTER TABLE … SET NOT
  NULL` on a large table without a backfill + validated constraint dance.
- `bun db:migrate` runs in the deploy release step (phase 0).

## Scripts

| Script | Does |
|---|---|
| `bun dev` | API with `--watch` + web dev server, concurrently |
| `bun db:up` | docker compose up -d db |
| `bun db:generate` | drizzle-kit generate |
| `bun db:migrate` | apply migrations |
| `bun db:studio` | drizzle studio |
| `bun test` | all workspaces |
| `bun typecheck` | `tsc --noEmit` per workspace |
| `bun lint` | biome check |

## Tests

- `env.test.ts` — missing key produces the aggregate error, not a crash
- `health.test.ts` — Eden Treaty call to `/health` returns typed `{ ok: true }`
- `auth.test.ts` — sign-up, sign-in, session read on a `{ auth: true }` route,
  401 without a cookie

## Acceptance criteria

- `bun install && bun db:up && bun db:migrate && bun dev` boots clean from a
  fresh clone with only `.env` filled
- `POST /api/auth/sign-up/email` then a call to a protected route succeeds with
  the returned cookie; the same call without it is 401
- `/openapi` renders every registered route with request/response schemas
- CI green on typecheck, lint, and test

## Risks

- **Better Auth + Drizzle schema drift.** Their CLI regenerates tables; pin the
  version and re-run generation deliberately, never automatically.
- **Bun + Drizzle driver choice.** Use `postgres.js` rather than `bun:sql` until
  Drizzle's Bun driver support is boring; it's one line to switch.
