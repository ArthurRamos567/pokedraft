# Phase 0 — Cross-cutting concerns

Not a sequential phase. Conventions every other phase must respect. Read
before writing code in any phase.

## Module convention (Elysia)

Every domain is an Elysia plugin, one directory under `apps/api/src/modules/`:

```
modules/leagues/
  index.ts        — the Elysia plugin: routes only, thin
  service.ts      — business logic, takes db + deps, returns plain data
  model.ts        — typebox schemas: request bodies, responses, params
  repo.ts         — drizzle queries, no business rules
  errors.ts       — domain error classes mapped to HTTP in the global handler
  *.test.ts       — bun:test
```

Rules:

- Routes never touch `db` directly — they call `service`.
- `service` never throws raw strings; it throws typed domain errors
  (`NotFound`, `Forbidden`, `Conflict`, `ValidationError`) which the global
  `onError` maps to status codes. Keeps HTTP concerns out of logic.
- Every route declares `response` schemas so Eden Treaty types are exact and
  OpenAPI is complete.
- Plugins are named (`new Elysia({ name: 'leagues' })`) so Elysia dedupes them.

## Auth & authorization

Better Auth handles *authentication*. Authorization is ours:

- `authMacro` — `{ auth: true }` on a route resolves `user` + `session` or 401.
- `leagueMacro` — `{ league: 'member' | 'host' }` loads the league by
  `:leagueId` param, checks membership/role, injects `league` + `member` into
  context or 403. Every league-scoped route uses it; no ad-hoc checks.
- Private leagues are invisible to non-members: 404 (not 403) on read, so
  membership can't be probed.
- Host actions (start draft, edit points, veto trade, force result) are audited
  in `audit_log` with actor, action, target, before/after JSON.

## Error contract

```jsonc
{ "error": { "code": "ROSTER_FULL", "message": "…", "details": { … } } }
```

Stable machine-readable `code` per domain error. Frontend switches on `code`,
never on message text.

## IDs

- Primary keys: UUIDv7 (`uuidv7` pkg) — sortable, no sequence contention.
- Public league join uses a short `invite_code` (10 chars, base32, no
  ambiguous glyphs), separate from the PK.
- Pokémon: canonical dex ID via `toID()` (`landorustherian`). Never store
  display names — they change with dex updates and users type them
  inconsistently.

## Validation

Typebox everywhere (Elysia native). Shared schemas live in `packages/shared`
so `apps/web` reuses them for form validation. No zod — avoids two validators.

## Testing strategy

| Kind | Where | Tooling |
|---|---|---|
| Pure logic (draft engine, RR generator, replay parser, standings) | `packages/*` | `bun test`, no DB |
| Service/integration | `apps/api` | `bun test` + testcontainers-style throwaway PG schema per file |
| Route contract | `apps/api` | Eden Treaty against `app.handle()` in-process — no network |
| E2E | `apps/web` | Playwright, happy paths only (draft a mon, report a match, propose a trade) |

Rule: anything with interesting rules (snake order, budget, legality,
tiebreaks, trade validation) is a pure function in `packages/` and tested
without a database. If it needs a DB to test, it's in the wrong place.

Integration tests run against a real Postgres (`docker compose up -d db`),
each test file getting its own schema via `search_path`, dropped on teardown.

## Concurrency

Two writers can race in exactly three places. Each gets a hard DB guard, not
just an application check:

| Race | Guard |
|---|---|
| Two players pick the same mon | `UNIQUE (draft_id, species_id)` on the pick projection + row lock on `drafts` |
| Two accepts on overlapping trades | `SELECT … FOR UPDATE` on both members' rows, revalidate ownership inside txn |
| Timer expiry vs. a real pick landing | Advisory lock on `draft_id`; expiry no-ops if `pick_no` advanced |

Application-level checks exist for good error messages; the constraint exists
for correctness.

## Background jobs

In-process scheduler (`setInterval`) in v1, guarded by a PG advisory lock for
leader election so multiple API instances don't double-fire. Jobs:

- `draft-deadlines` — every 15s, expire async turns / live pick timers
- `replay-fetch` — retry queue for failed Showdown replay fetches
- `trade-expiry` — expire pending trades past their TTL

If job volume grows, swap to a proper queue (pg-boss) — the job interfaces are
written to make that a drop-in.

## Real-time

One WS endpoint per league, not per feature: `/leagues/:id/live`. Topics
multiplexed in the message envelope (`draft`, `chat`, `transactions`,
`results`). Clients subscribe to topics they render. Avoids N sockets per
user and gives one place for auth + presence.

Envelope:

```ts
{ topic: 'draft', seq: 42, type: 'PICK_MADE', payload: { … } }
```

`seq` is monotonic per league; on reconnect the client sends its last `seq`
and gets a replay of what it missed, then a snapshot if the gap is too large.

## Rate limiting & abuse

- Auth endpoints: strict per-IP limit (Better Auth built-in + `elysia-rate-limit`)
- Replay fetches: per-league limit, and a global politeness limit against
  `replay.pokemonshowdown.com` — we're a guest on their infra
- YML import: size cap (256KB) and entry cap
- Any user-supplied text (league name, team name, chat) is stored raw and
  escaped at render; no HTML allowed anywhere in v1

## Observability

- Structured logs (pino) with `requestId`, `userId`, `leagueId` bound
- `/health` (liveness) and `/ready` (DB ping) endpoints
- Slow-query log at 200ms, slow-request log at 1s

## Deployment

Railway (already in the toolchain): one Postgres service, one API service, one
static/SSR service for the web app. Migrations run in the release command, not
at boot, so a bad migration fails the deploy instead of crash-looping. Secrets
via Railway variables; `.env.example` documents every key.
