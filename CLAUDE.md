# PokeDraft — working agreement

Multi-league Pokémon draft platform. Full design in `PLAN.md` + `plans/`.
Read the relevant `plans/phase-0X-*.md` before working on that phase.

## Stack

Bun · TypeScript · Elysia (Eden Treaty, native WS, OpenAPI) · Postgres +
Drizzle · Better Auth · `@pkmn/*` for Pokémon data · TanStack Start/Router/
Query for the frontend. Monorepo via bun workspaces:
`apps/api`, `apps/web`, `packages/{db,dex,draft,season,shared}`.

## Non-negotiables

**Pure logic lives in `packages/`.** Anything with interesting rules — draft
order, pick validation, legality, schedule generation, bracket progression,
standings, trade validation — is a pure function with no IO, tested without a
database. If it needs a DB to test, it's in the wrong place.

**Roster is derived, never stored.** `roster = picks − traded away + traded
for`. One implementation, in `apps/api/src/modules/teams/roster.ts`. Every
consumer calls it. A second implementation is a bug.

**The draft is event-sourced.** `draft_events` is append-only and is the truth;
`drafts.state` is a cache. Undo = delete trailing events and replay, never
invert. State must be reconstructible from events alone.

**Species are canonical dex IDs.** `toID()` → `landorustherian`. Never store
display names. Never fuzzy-match a name automatically — suggest it.

**Preview then commit.** Points import, schedule generation, and playoff
generation all return a preview first and commit on a second explicit call
carrying the preview's hash. Hosts are never surprised.

**Client and server share the rules.** `apps/web` imports `packages/draft` and
applies WS events with the same reducer the server uses. Never reimplement a
rule in the frontend.

## Module shape (Elysia)

```
modules/<domain>/
  index.ts    — Elysia plugin, routes only, thin
  service.ts  — business logic; takes deps, returns data, throws domain errors
  model.ts    — typebox schemas for params/body/response
  repo.ts     — drizzle queries, no business rules
  *.test.ts
```

Routes never touch `db`. Services never throw strings or set status codes —
they throw typed domain errors that the global `onError` maps. Every route
declares a `response` schema so Eden types and OpenAPI stay exact.

## Conventions

- **IDs**: UUIDv7 primary keys. Invite codes are short base32, separate column.
- **Validation**: typebox only, shared schemas in `packages/shared`. No zod.
- **Errors**: `{ error: { code, message, details? } }`. Stable `code`
  constants; clients switch on `code`, never on message text.
- **Auth**: `{ auth: true }` macro for authentication; `{ league: 'member' |
  'host' }` macro for league scoping. No ad-hoc permission checks in routes.
- **Private leagues** return 404, not 403, to non-members.
- **Concurrency**: DB constraints are the guarantee, app checks are for error
  messages. `UNIQUE (draft_id, species_id)` for picks; `FOR UPDATE` ordered by
  ID for trades.
- **Comments** explain why, not what. Match the density of surrounding code.

## Commands

```bash
docker compose up -d          # postgres
bun db:generate               # drizzle-kit generate after schema edits
bun db:migrate                # apply migrations
bun dev                       # api + web, watch mode
./scripts/verify.sh           # typecheck + lint + test — the gate
```

Migrations are always generated and committed. Never `db push` outside local
scratch work.

## Working rules for agents

1. Read the phase plan before starting. Follow its schema and endpoint list.
2. Pure package + tests first, then persistence, then routes. Not the reverse.
3. `./scripts/verify.sh` must pass before a commit. Red = fix it now.
4. One task, one commit. Small commits are revertable.
5. Blocked or ambiguous? Append to `BLOCKERS.md` and move to the next task.
   Do not invent an answer to an unanswerable question and build on it.
6. Do not modify completed phases. Do not expand scope beyond the task text.
7. Frontend work: invoke the `/frontend-design` skill first, every time.

## Deferred

Replay parsing, auction drafts, keepers, free agency, waivers, Discord bot —
see `plans/future.md`. Do not build these. v1 preserves the seams they need.
