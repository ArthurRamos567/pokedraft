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
- A valid replay whose parsed result matches the report auto-confirms
  immediately — this is the fast path and should be the common one
- Host can force any state (`forfeited`, `void`, override winner), always
  audited
- `closes_at` on the week doesn't hard-block reporting; late results are
  allowed but flagged, since real leagues run late

## Replay parsing

`packages/replay` — pure, testable against saved fixture logs.

Fetch: `https://replay.pokemonshowdown.com/<id>.json` → `{ log, players, … }`.
Rate-limited and cached in `replay_cache`; never fetched twice.

Parser walks the protocol log:

| Line | Use |
|---|---|
| `\|player\|p1\|Username\|…` | side → Showdown username → league member (via `users.showdownUsername`, host-confirmable fallback) |
| `\|poke\|p1\|Landorus-Therian, M` | team preview → `brought` candidates |
| `\|switch\|p1a: Nick\|Landorus-Therian, M\|100/100` | nickname → species map per side; marks `brought` |
| `\|replace\|`, `\|detailschange\|` | Illusion (Zoroark) and forme changes — must not corrupt the nickname map |
| `\|faint\|p1a: Nick` | +1 death for that species; +1 kill for the *opposing active* mon |
| `\|win\|Username` | winner |

Kill attribution rules:

- Kill goes to the opposing side's currently-active mon at faint time
- Hazard/status/weather/recoil deaths with no opposing contact: credited as an
  **indirect** kill to the mon that set the hazard where determinable, else
  unattributed — tracked as a separate `indirect` counter rather than fudged
  into `kills`
- Self-KO (Explosion, Life Orb, recoil) counts as a death, not an opposing kill

Validation against the report:

- Participants match the matchup's two members → else `REPLAY_PLAYER_MISMATCH`
- Species used are all on the reporting member's roster (phase 5) → else flag
  `ILLEGAL_SPECIES` for host review. This is how cheating actually gets caught,
  so it's a first-class outcome, not a warning log
- Winner matches the report → else `REPLAY_CONTRADICTS_REPORT`, forces
  `disputed`

Score = mons remaining for the winner, 0 for the loser (the usual differential
convention); computed from the log, not trusted from the report, when a replay
exists.

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
- Parser fixtures: a normal 6v6, a game with Zoroark Illusion, a forfeit, a
  timeout win, a game with hazard KOs, a forme-change game (Terastal / Mega)
- Kill attribution matches hand-counted fixtures
- Replay contradicting the report forces `disputed`
- Off-roster species in a replay raises `ILLEGAL_SPECIES`
- Standings tiebreak chain, each level exercised in isolation
- Auto-confirm timer fires at the configured age and not before

## Acceptance criteria

- A host generates a 9-week season for 8 players and every player sees their
  schedule
- Reporting with a valid replay URL confirms instantly and populates per-mon
  K/D
- Standings match a hand-computed fixture league, including tiebreaks
- The K/D leaderboard reproduces what the reference spreadsheet tracks

## Risks

- **Showdown replay availability.** Replays expire or are unlisted. Parsing
  must degrade to manual reporting, never block it. Cache raw logs on first
  fetch so an expired replay stays usable to us.
- **Protocol drift.** Showdown's battle protocol evolves. Fixture tests are the
  early warning; the parser ignores unknown lines rather than throwing.
- **Username matching.** Showdown names differ from ours and change. Store
  `showdownUsername` per user (phase 1), allow per-league override, and fall
  back to host confirmation instead of guessing.
