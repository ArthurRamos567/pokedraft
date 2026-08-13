# Phase 6 — Season, results & replay parsing

**Goal:** schedule the regular season, let players report results, verify and
enrich those results from Showdown replays, and derive standings.

## Schema

```sql
seasons                            -- one per league run; supports future re-runs
  id uuid pk
  league_id → leagues
  number int
  status enum(scheduled, active, complete)

weeks
  id uuid pk
  season_id → seasons
  number int
  opens_at, closes_at timestamptz
  status enum(upcoming, open, closed)
  unique (season_id, number)

matchups
  id uuid pk
  week_id → weeks
  home_member_id → league_members
  away_member_id → league_members null      -- null = bye
  status enum(scheduled, reported, confirmed, disputed, forfeited, void)
  winner_member_id null
  home_score int, away_score int             -- mons remaining (differential)
  replay_url text null
  scheduled_at timestamptz null              -- players' agreed battle time
  unique (week_id, home_member_id)

match_reports                                -- who claimed what; audit trail
  id uuid pk
  matchup_id → matchups
  reported_by → league_members
  winner_member_id, home_score, away_score
  replay_url text null
  note text
  created_at

match_stats                                  -- per-mon, from replay parsing
  id uuid pk
  matchup_id → matchups
  member_id → league_members
  species_id text
  brought boolean
  kills int, deaths int
  unique (matchup_id, member_id, species_id)

replay_cache
  replay_id text pk                          -- showdown replay id
  fetched_at timestamptz
  raw_log text
  parsed jsonb
```

## Schedule generation

Port the MVP's circle-method round robin (`src/bracket.js:roundRobin`) into
`packages/draft`… no — into a new `packages/season` (it's season logic, not
draft logic). Generalize it:

- Odd member count → one bye per round, rotated fairly (nobody gets two byes
  before everyone gets one)
- `doubleRoundRobin: boolean` — second half mirrors home/away
- `weeks` count configurable; if fewer weeks than a full RR requires, generate
  a partial RR and warn the host explicitly rather than silently truncating
- Deterministic given a seed, so "regenerate" is reproducible and testable

```
POST /leagues/:id/season/generate
  { weeks: 9, doubleRoundRobin: false, startAt, weekLengthDays: 7, seed? }
  → preview of every week's matchups, committed by a second call
```

Same preview/commit split as the points import (phase 3) — hosts should never
be surprised by a schedule.

Manual adjustments after generation: `PATCH /matchups/:id` to swap opponents or
move a match to another week, host-only, audited.

## Result reporting flow

```
scheduled
   │ player reports (winner, score, optional replay)
   ▼
reported ──opponent confirms──▶ confirmed
   │                               ▲
   │ opponent disputes             │ host resolves
   ▼                               │
disputed ──────────────────────────┘
```

- Either participant may report; the *other* confirms
- Auto-confirm after 48h of silence (configurable), because leagues stall on
  unresponsive opponents more than on disagreements
- `replay_url` is stored and linked but **not parsed in v1** — it's evidence a
  human can click during a dispute
- Optional per-mon K/D entry on the report form fills `match_stats` by hand.
  Skippable; leaderboards degrade gracefully to "no data" rather than breaking
- Host can force any state (`forfeited`, `void`, override winner), always
  audited
- `closes_at` on the week doesn't hard-block reporting; late results are
  allowed but flagged, since real leagues run late

## Replay parsing — DEFERRED

**Not in v1.** Full design lives in [future.md](future.md#replay-parsing).

It needs a corpus of real Showdown replay JSON to build against; without
fixtures a parser is guesswork dressed as code. v1 stores `replay_url` as a
clickable link and takes scores from the report.

What v1 must preserve so the parser drops in later without migrations:

- `replay_url` on `matchups`, validated as a well-formed
  `replay.pokemonshowdown.com/<id>` URL and stored normalized to the bare ID
- `match_stats` table exists and is populated by optional manual entry — the
  parser will later write the same rows
- `replay_cache` table exists, unused
- Score is `home_score`/`away_score` as mons remaining, the same convention the
  parser will compute

Score = mons remaining for the winner, 0 for the loser (the usual differential
convention), taken from the report in v1.

## Standings

Derived, never stored. Ported and extended from the MVP's `standings()`:

Sort keys, in order:

1. Wins
2. Head-to-head result (only when exactly two teams are tied)
3. Differential (mons remaining scored for − against)
4. Total kills
5. Coin flip on a stable hash of member IDs (deterministic, so the table
   doesn't reshuffle on refresh)

League setting picks whether ties break on differential-first or
head-to-head-first — leagues genuinely disagree about this.

## Endpoints

| Route | Who |
|---|---|
| `POST /leagues/:id/season/generate` | host, preview |
| `POST /leagues/:id/season/commit` | host |
| `GET /leagues/:id/schedule?week=` | member |
| `GET /leagues/:id/matchups/:id` | member |
| `POST /leagues/:id/matchups/:id/report` | participant |
| `POST /leagues/:id/matchups/:id/confirm` \| `/dispute` | opponent |
| `POST /leagues/:id/matchups/:id/resolve` | host |
| `PATCH /leagues/:id/matchups/:id` | host: reschedule, forfeit, void |
| `GET /leagues/:id/standings` | public if league public |
| `GET /leagues/:id/leaderboard?stat=kills\|kd\|usage` | per-mon and per-player |

## Tests

- RR generator: every pair meets exactly once; byes distributed evenly; same
  seed → same schedule
- Report → confirm → standings update, end to end
- Dispute path: reporter and opponent disagree, host resolves
- Standings tiebreak chain, each level exercised in isolation
- Auto-confirm timer fires at the configured age and not before
- Malformed `replay_url` rejected; valid one normalized to a bare replay ID
- Leaderboard with zero `match_stats` rows returns empty, not an error

## Acceptance criteria

- A host generates a 9-week season for 8 players and every player sees their
  schedule
- Reporting a result and having the opponent confirm updates standings
  immediately
- Standings match a hand-computed fixture league, including tiebreaks
- Manually entered per-mon K/D produces a working leaderboard; skipping it
  degrades cleanly

## Risks

- **Manual reporting is trust-based in v1.** No replay verification means a
  dishonest report only surfaces via dispute. Acceptable — leagues are small
  and social — but it's the reason the dispute path must be good.
- **Username matching.** Deferred with the parser, but `showdownUsername` is
  collected from phase 1 onward so the data exists when it's needed.
