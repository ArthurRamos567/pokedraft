# Phase 5 — Teams & visualizer API

**Goal:** everything the "Teams" tab of the spreadsheet shows, served as one
coherent, computed resource. This phase writes almost no new tables — it's a
projection layer over picks, trades, and the dex.

## Roster derivation

```
roster(member) = picks(member)
               − species given away in approved trades
               + species received in approved trades
```

Implemented once in `apps/api/src/modules/teams/roster.ts` and used by *every*
consumer (draft validation, trade validation, match stats, standings). One
function, one definition of truth. Cached per member with invalidation on any
pick or trade event.

Only new persisted state:

```sql
team_profiles                     -- optional cosmetics, 1:1 with league_members
  member_id pk → league_members
  team_name text
  logo_url text
  color text
  motto text
```

## Computed team analytics (pure, `packages/dex/coverage.ts`)

All derived from the dex at request time — nothing stored, nothing to
invalidate:

| Metric | Definition |
|---|---|
| Type coverage (defensive) | Per attacking type: count of team members weak / resistant / immune |
| Type coverage (offensive) | Per defending type: does anyone hit it super-effectively with a STAB or a common coverage move |
| Speed tiers | Base speed, +/- nature and Choice Scarf variants, sorted, with the league's other teams as comparison markers |
| Stat profile | BST spread, physical vs. special attacker balance |
| Roster spend | Points spent, remaining budget, spend by tier bracket |
| Threat list | Undrafted-mon-agnostic: which opposing drafted mons this team has no resist to |

The defensive matrix is the one people actually use for scouting; the rest is
supporting detail. Type chart math is generation-aware (Steel resisting Ghost/
Dark pre-gen-6, Fairy existing at all) — `@pkmn/dex` supplies the per-gen
chart, so this must not be hardcoded.

## Endpoints

| Route | Returns |
|---|---|
| `GET /leagues/:id/teams` | all teams: name, owner, roster (species IDs + cost), spend, record |
| `GET /leagues/:id/teams/:memberId` | full team detail incl. dex data per mon |
| `GET /leagues/:id/teams/:memberId/coverage` | defensive + offensive matrices |
| `GET /leagues/:id/teams/:memberId/speed` | speed tiers with league percentile |
| `GET /leagues/:id/teams/:memberId/stats` | per-mon K/D from phase 6 match stats |
| `PATCH /leagues/:id/teams/me` | own profile cosmetics |
| `GET /leagues/:id/teams/:memberId/export?format=showdown` | Showdown-importable paste skeleton via `@pkmn/sets` |
| `GET /leagues/:id/pool?status=undrafted` | who's still available, with prices |

`GET /teams` is the single call the visualizer's league-wide view makes; it
must not N+1 — one query for members, one for picks, one for trades, joined in
memory against the in-process dex.

## Showdown export

`@pkmn/sets` builds a paste of the roster with empty movesets:

```
Landorus-Therian @
Ability: Intimidate
EVs:
- 
```

Enough for a player to paste into the Showdown teambuilder and fill in. A
*full* set recommendation (moves/EVs from usage stats) is deliberately not in
scope — it's a different product.

## Tests

- Roster after a trade reflects the swap for both sides, and picks are
  untouched (event sourcing preserved)
- Coverage matrix correctness against hand-computed fixtures for a known
  6-mon team in gen 9 and gen 5 (proves gen-awareness)
- Speed tier ordering with ties broken deterministically
- Export paste re-imports cleanly through `@pkmn/sets` (round-trip test)
- `GET /teams` on a 12-team league issues a bounded number of queries
  (assert with a query counter, not a stopwatch)

## Acceptance criteria

- The visualizer can render a full team page from exactly two API calls
  (detail + coverage)
- Every number shown on the spreadsheet's Teams tab has an API field behind it
- Roster logic exists in exactly one file; grep proves no second implementation
