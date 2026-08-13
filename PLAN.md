# PokeDraft — Rebuild Plan

Rebuild of `DraftMVP` as a proper multi-league Pokémon draft platform.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun + TypeScript |
| API | Elysia (Eden Treaty, native WS, `@elysiajs/cors`, `@elysiajs/openapi`) |
| DB | Postgres + Drizzle ORM (drizzle-kit migrations), docker compose for dev |
| Auth | Better Auth — Elysia integration, sessions in PG, email/password + Discord/Google OAuth |
| Pokémon data | `@pkmn/dex`, `@pkmn/sim`, `@pkmn/img`, `@pkmn/sets` (maintained Showdown extracts) |
| Frontend | TanStack Start (React) + Router + Query, Eden Treaty client |

## Repo shape (bun workspaces monorepo)

```
apps/api          — Elysia server, domain modules as plugins
apps/web          — TanStack Start app
packages/db       — drizzle schema + migrations
packages/dex      — @pkmn wrapper: species/format/legality services
packages/draft    — pure draft engine (no IO, bun:test)
packages/shared   — shared typebox schemas + Eden type export
```

## Core design decisions

### Dex in-memory, not in PG
`@pkmn/dex` loads in-process: species, moves, abilities, learnsets. `@pkmn/sim`
supplies format rulesets. Postgres stores only *user* data (leagues, picks,
points, matches). Species are referenced by canonical dex ID
(`landorustherian`) and validated against the dex at write time. Data upgrades
= package bump, no ETL, no stale mirror.

### Draft engine is pure
State machine, zero IO — same philosophy as MVP `src/draft.js`. Picks are
event-sourced in PG (append-only `draft_events`); state is a fold, cached on
the `drafts` row. One engine, two modes (per-league config): **live** (WS room
+ pick timer) and **async** (long turn deadlines + background expiry job).

### Roster is derived
Team roster = fold(picks + approved trades). Never a mutable `roster` table.
Standings, budgets, and K/D leaderboards are all derived views over event data.

### Transactions
Trades only in v1: proposer ↔ receiver, multi-mon, point-balance validated,
optional host approval. Schema keeps a `type` enum so free agency and waivers
land later without migration pain.

## Data model at a glance

```
users, sessions, accounts, verifications   (better auth)
leagues, league_members, league_invites
point_lists, point_entries                 (YML import, versioned)
drafts, draft_events, draft_queues         (event-sourced draft)
transactions, transaction_items            (trades)
weeks, matchups, match_reports, match_stats
brackets, bracket_matches
notifications, audit_log
```

## Phases

| # | Phase | Plan | Depends on |
|---|---|---|---|
| 1 | Scaffold & auth | [plans/phase-01-scaffold.md](plans/phase-01-scaffold.md) | — |
| 2 | Dex layer | [plans/phase-02-dex.md](plans/phase-02-dex.md) | 1 |
| 3 | Leagues & points | [plans/phase-03-leagues.md](plans/phase-03-leagues.md) | 1, 2 |
| 4 | Draft engine & room | [plans/phase-04-draft.md](plans/phase-04-draft.md) | 3 |
| 5 | Teams & visualizer API | [plans/phase-05-teams.md](plans/phase-05-teams.md) | 4 |
| 6 | Season & results | [plans/phase-06-season.md](plans/phase-06-season.md) | 3 (5 for stats) |
| 7 | Playoffs & brackets | [plans/phase-07-playoffs.md](plans/phase-07-playoffs.md) | 6 |
| 8 | Transactions | [plans/phase-08-transactions.md](plans/phase-08-transactions.md) | 4, 5 |
| 9 | Frontend | [plans/phase-09-frontend.md](plans/phase-09-frontend.md) | 2–8 (incremental) |
| — | Cross-cutting | [plans/phase-00-cross-cutting.md](plans/phase-00-cross-cutting.md) | all |

Phases 5–8 are largely parallelizable once 4 lands. Phase 9 can start against
phase 3's API and grow route-by-route as backend phases complete.

## Reference

Target feature parity with the league spreadsheet:
teams tab → phase 5; schedule/standings → phase 6; brackets → phase 7;
points sheet → phase 3; K/D leaderboards → phase 6 replay parsing.
