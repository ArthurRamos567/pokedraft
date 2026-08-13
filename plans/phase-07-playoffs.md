# Phase 7 — Playoffs & brackets

**Goal:** cut the top N from the regular season into a bracket, run it to a
champion, and render it. Reuses phase 6's reporting flow entirely — a bracket
match is a matchup with a bracket slot attached.

## Schema

```sql
brackets
  id uuid pk
  season_id → seasons
  type enum(single_elim, double_elim)
  size int                          -- 4, 8, 16 (padded with byes)
  third_place boolean
  seeds jsonb                       -- [memberId] in seed order, frozen at generation
  status enum(pending, active, complete)
  champion_member_id null

bracket_matches
  id uuid pk
  bracket_id → brackets
  matchup_id → matchups null        -- created when both slots fill
  slot text                         -- 'W1-1', 'L2-3', 'F', '3P'
  round int
  bracket_side enum(winners, losers, final)
  home_source jsonb                 -- { kind: 'seed', n } | { kind: 'winner_of', slot } | { kind: 'loser_of', slot }
  away_source jsonb
  home_member_id null, away_member_id null
  winner_member_id null
  unique (bracket_id, slot)
```

Slots and their *sources* are generated up front; members flow into them as
results land. This is what makes the bracket renderable before it's played and
makes progression a pure function rather than ad-hoc pointer updates.

## Generation

```
POST /leagues/:id/playoffs/generate
  { type: 'single_elim', size: 4, thirdPlace: true }
  → preview (seeds + full slot tree), committed separately
```

- Seeds come from phase 6 standings at generation time and are **frozen** —
  later result corrections don't reseed a running bracket
- `size` > qualifying teams → byes assigned to the top seeds (standard 1v8,
  2v7 pairing so byes reward seeding)
- Requires the regular season `complete`, or an explicit host override
- Double elimination generates the losers bracket with the standard drop
  pattern; grand final optionally has a bracket reset (league setting)

## Progression

```ts
onMatchConfirmed(matchup) →
  find bracket_match by matchup_id
  set winner
  for each bracket_match whose source references this slot:
     fill home_member_id / away_member_id
     if both filled → create the matchup (phase 6) in the current playoff week
  if final decided → bracket.complete, league.status = complete
```

Pure function `advance(bracket, slot, winnerId) → bracket` in
`packages/season`, tested without a database. The service is a thin wrapper
that persists what the function returns.

Host correction of a decided bracket match cascades: dependent downstream slots
are cleared and their matchups voided. Destructive, so it requires explicit
confirmation and is fully audited.

## Endpoints

| Route | Who |
|---|---|
| `POST /leagues/:id/playoffs/generate` | host, preview |
| `POST /leagues/:id/playoffs/commit` | host |
| `GET /leagues/:id/playoffs` | anyone who can see the league — full tree with sources resolved |
| `PATCH /leagues/:id/playoffs/matches/:slot` | host: override winner (cascades) |
| `DELETE /leagues/:id/playoffs` | host: scrap and regenerate, `pending` only |

`GET /playoffs` returns a render-ready tree (rounds → matches → resolved
member names/logos/seeds), not raw rows — the client shouldn't reconstruct
bracket topology.

## Tests

- 4/8/16-team single elim: every slot reachable, exactly one champion
- Non-power-of-two (6 teams into size 8): byes go to seeds 1–2, tree still valid
- Double elim: a team losing once can still reach the grand final; losing twice
  cannot
- Bracket reset behaves per the league setting
- Progression is idempotent — replaying the same confirmation doesn't
  double-advance
- Host override cascade clears exactly the dependent subtree, nothing more
- Third-place match sources the two semifinal losers

## Acceptance criteria

- Top-4 cut from a completed 8-team season produces a playable bracket
- A full playoff run from generation to champion works through the API
- Bracket renders correctly *before* any match is played (empty tree with
  seeds and byes shown)
