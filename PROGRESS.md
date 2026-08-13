# Progress

The build queue. **Do the first unchecked task, only that task.** Check the box
in the same commit that completes it. Read the phase plan in `plans/` before
starting a phase; read `CLAUDE.md` always.

A task is done when `./scripts/verify.sh` passes and the work matches the phase
plan — not when it looks finished.

Blocked? Append to `BLOCKERS.md`, leave the box unchecked, mark it `⛔`, and
move to the next task.

---

## Phase 1 — Scaffold & auth · [plan](plans/phase-01-scaffold.md)

- [x] 1.1 Root `package.json` (bun workspaces), `tsconfig.base.json` (strict, `@pokedraft/*` paths), workspace stubs
- [x] 1.2 Biome config, `typecheck`/`lint`/`test`/`dev` scripts, `.env.example`
- [x] 1.3 `packages/shared`: error code constants, shared typebox helpers
- [x] 1.4 `packages/db`: drizzle config, postgres.js client, `db:generate` / `db:migrate` scripts
- [x] 1.5 `apps/api/src/env.ts` — typebox-validated env, aggregate failure message
- [x] 1.6 `apps/api`: `app.ts` (exported instance) + `index.ts`, `/health` and `/ready` modules
- [x] 1.7 Errors plugin — `onError` → `{ error: { code, message, details } }`, domain error classes
- [x] 1.8 Logger plugin (pino) with requestId/userId binding
- [x] 1.9 CORS + OpenAPI plugins
- [x] 1.10 Better Auth instance, Drizzle adapter, auth tables committed to `packages/db` + migration
- [x] 1.11 Better Auth config: email/password, `user.additionalFields` (displayName, showdownUsername, avatarUrl), session settings
- [x] 1.12 Social providers built conditionally from env (see phase plan); `GET /api/auth/providers` lists enabled ones. Blank vars must not throw
- [x] 1.13 `authMacro` + protected route; 401 test with and without cookie
- [x] 1.14 Eden Treaty test harness against `app.handle()`, no network
- [x] 1.15 `audit_log` and `notifications` tables + service (used from phase 3 on)
- [x] 1.16 Rate limiting on auth routes
- [x] 1.17 GitHub Actions CI: install → typecheck → lint → test

## Phase 2 — Dex layer · [plan](plans/phase-02-dex.md)

- [x] 2.1 `packages/dex` scaffold, `@pkmn/{dex,data,sim,img,sets}` deps
- [x] 2.2 `gens.ts` — memoized `Generations` per gen
- [x] 2.3 `species.ts` — lookup + boot indices, lazy per format
- [x] 2.4 Name resolver: `toID` → aliases (seed from `DraftMVP/tools/scrape/aliases.json`) → forme normalization → fuzzy **as suggestion only**, with tests
- [x] 2.5 Forme handling: cosmetic collapse vs. functional distinct, with tests
- [x] 2.6 `formats.ts` — format list, `RuleTable`, curated `SUPPORTED_FORMATS`
- [x] 2.7 `legality.ts` + tests (banned in gen9ou, legal in gen9ubers, gen boundaries)
- [x] 2.8 Species-count-per-format snapshot test (catches silent `@pkmn` upgrades)
- [x] 2.9 `learnsets.ts` — move pool per species per format
- [x] 2.10 `sprites.ts` — `@pkmn/img` URL builders
- [x] 2.11 `coverage.ts` — generation-aware type chart math + tests
- [x] 2.12 `modules/dex` routes: formats, species search, species detail, learnset, moves, abilities
- [x] 2.13 `POST /dex/resolve` batch endpoint + cache headers

## Phase 3 — Leagues & points · [plan](plans/phase-03-leagues.md)

- [x] 3.1 Schema: `leagues`, `league_settings`, `league_members`, `league_invites` + migration
- [x] 3.2 Slug generation, league CRUD service
- [x] 3.3 `assertStatus()` lifecycle gate helper + tests
- [x] 3.4 `leagueMacro` — member/host scoping, private → 404
- [x] 3.5 Discovery endpoints: public directory, `/leagues/mine`, `/leagues/:slug`
- [x] 3.6 Invites: create, revoke, join by code, capacity + expiry checks
- [x] 3.7 Members: kick, role change, host transfer, own team profile
- [x] 3.8 Draft order: random draw + manual set
- [x] 3.9 Schema: `point_lists`, `point_entries` + migration
- [x] 3.10 YML parser — both shapes (name→points, points→names, `banned:`) + tests
- [x] 3.11 Import pipeline: resolve → classify (ok/illegal/unknown/duplicate) → diff
- [x] 3.12 `points/preview` + `points/commit` with hash guard, size/entry limits
- [x] 3.13 Points read endpoints, versions, single-entry edit
- [x] 3.14 Regression test: `DraftMVP/data/pool.json` → YML imports with zero unknowns

## Phase 4 — Draft engine & room · [plan](plans/phase-04-draft.md)

- [x] 4.1 `packages/draft` types: `DraftConfig`, `DraftState`, `DraftEvent`, `Pick`
- [x] 4.2 `order.ts` — snake + linear, finished teams skipped, tests for 4/6/8/odd
- [x] 4.3 `reduce.ts` — total `apply()`, typed `InvalidEvent`
- [x] 4.4 `validate.ts` — the 8 ordered checks including **roster reachability**, tests at the boundary
- [x] 4.5 `autopick.ts` + `select.ts` — queue > best affordable > skip
- [x] 4.6 Replay determinism test over a long event fixture
- [x] 4.7 Schema: `drafts`, `draft_events`, `draft_picks` (unique constraints), `draft_queues` + migration
- [x] 4.8 Write path: `FOR UPDATE` txn, event append, projection insert, state update
- [x] 4.9 Undo via truncate-and-replay
- [x] 4.10 Draft endpoints: start, get, pick, skip, pause/resume, force-pick, queue, events
- [x] 4.11 WS `/leagues/:id/live` — topic multiplexing, `seq`, snapshot on connect, gap recovery
- [x] 4.12 Presence tracking in the draft room
- [x] 4.13 `draft-deadlines` job — advisory lock, no-op if `pickNo` advanced, live + async modes
- [x] 4.14 Pause freezes deadlines; resume recomputes them
- [x] 4.15 Concurrency tests: double pick → one 409; timer vs. real pick → one event
- [x] 4.16 Full 8×10 draft integration test; rebuild-from-events matches cached state

## Phase 5 — Teams & visualizer API · [plan](plans/phase-05-teams.md)

- [ ] 5.1 `roster.ts` — the single derivation, with cache invalidation, + tests
- [ ] 5.2 `team_profiles` schema + migration
- [ ] 5.3 `GET /teams` and `/teams/:memberId` — no N+1, query-count test
- [ ] 5.4 Coverage endpoint (defensive + offensive matrices)
- [ ] 5.5 Speed tiers endpoint with league percentiles
- [ ] 5.6 Showdown paste export via `@pkmn/sets`, round-trip test
- [ ] 5.7 `GET /pool?status=undrafted`

## Phase 6 — Season & results · [plan](plans/phase-06-season.md)

- [ ] 6.1 `packages/season` scaffold
- [ ] 6.2 Round-robin generator (port `DraftMVP/src/bracket.js`), seeded + deterministic, fair byes, double-RR, + tests
- [ ] 6.3 Schema: `seasons`, `weeks`, `matchups`, `match_reports`, `match_stats`, `replay_cache` + migration
- [ ] 6.4 Season generate preview + commit
- [ ] 6.5 Schedule endpoints; host reschedule/forfeit/void
- [ ] 6.6 Report → confirm → dispute → host resolve flow
- [ ] 6.7 Optional manual per-mon K/D entry on the report
- [ ] 6.8 `replay_url` validation + normalization to bare ID (no parsing — deferred)
- [ ] 6.9 Auto-confirm job at configured age
- [ ] 6.10 Standings: tiebreak chain, both orderings, + tests
- [ ] 6.11 Leaderboard endpoints, empty-data safe

## Phase 7 — Playoffs · [plan](plans/phase-07-playoffs.md)

- [ ] 7.1 Schema: `brackets`, `bracket_matches` with slot sources + migration
- [ ] 7.2 Bracket generation pure fn: 4/8/16, byes to top seeds, + tests
- [ ] 7.3 `advance()` pure fn, idempotent, + tests
- [ ] 7.4 Double elimination + optional bracket reset
- [ ] 7.5 Third-place match
- [ ] 7.6 Generate preview/commit endpoints; frozen seeds
- [ ] 7.7 `GET /playoffs` render-ready tree
- [ ] 7.8 Host override with dependent-subtree cascade + tests

## Phase 8 — Transactions · [plan](plans/phase-08-transactions.md)

- [ ] 8.1 Schema: `transactions`, `transaction_items`, `transaction_votes` + migration
- [ ] 8.2 Trade validation pure fn — the 8 checks + tests
- [ ] 8.3 Propose / accept / reject / cancel endpoints
- [ ] 8.4 Approve / veto with ordered `FOR UPDATE` locking, revalidation inside txn
- [ ] 8.5 `POST /transactions/validate` dry run
- [ ] 8.6 Expiry job
- [ ] 8.7 Optional league-vote veto mode
- [ ] 8.8 Notifications on every state change
- [ ] 8.9 Concurrency tests: shared-mon race, mirrored trades don't deadlock
- [ ] 8.10 Roster fold after approval matches expectation for both sides

## Phase 9 — Frontend · [plan](plans/phase-09-frontend.md)

**Invoke `/frontend-design` before 9.2 and before every screen task.**

- [ ] 9.1 TanStack Start scaffold, router, Query, Eden Treaty client, auth client
- [ ] 9.2 Design system: tokens, type-color map, typography, primitives (Card, Table, Badge, StatBar, SpriteAvatar, TypeChip, Dialog)
- [ ] 9.3 Auth screens: login, signup, verify
- [ ] 9.4 Landing + public league directory + create/join flows
- [ ] 9.5 League shell: nav, context, overview page
- [ ] 9.6 Pool browser (search/filter/sort) + points list view
- [ ] 9.7 Points import UI: drop YML → preview table → diff → commit
- [ ] 9.8 `useLeagueSocket` hook — WS → Query cache, draft events via shared reducer, reconnect by `seq`
- [ ] 9.9 Draft room: pool pane, board, my-team pane, queue, timer, optimistic picks
- [ ] 9.10 Async draft variant: on-the-clock banner, queue-first interaction
- [ ] 9.11 Teams grid
- [ ] 9.12 Team visualizer: roster, coverage matrix, speed tiers, spend, export
- [ ] 9.13 Schedule + match report dialog + confirm/dispute
- [ ] 9.14 Standings table
- [ ] 9.15 Bracket (SVG tree, scroll container)
- [ ] 9.16 Trade builder + trade log, live `/validate`
- [ ] 9.17 Host settings: rules, members, season/playoff generation
- [ ] 9.18 Notifications, empty states, error states, loading skeletons
- [ ] 9.19 Playwright happy path: signup → league → points → draft → report → trade
- [ ] 9.20 Responsive pass + accessibility pass (type labels, keyboard draft board, aria-live timers)

---

## Done

Nothing yet. Plans and infra only.

- [x] 0.1 Repo init, plans, `CLAUDE.md`, `PROGRESS.md`, `scripts/verify.sh`
- [x] 0.2 Docker: `docker-compose.yml` (db + test db + adminer), `docker-compose.full.yml`, API and web Dockerfiles
