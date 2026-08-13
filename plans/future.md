# Future work — deliberately out of v1

Designed, not built. Each entry says why it's deferred and what v1 must not
break so it can land later without a migration or a redesign.

---

## Replay parsing

**Deferred from phase 6.** Needs a corpus of real Showdown replay JSON to build
against — a parser written without fixtures is fiction that happens to compile.

### Prerequisite before starting

Download 8 real replays into `packages/replay/fixtures/` covering:

| Fixture | Exercises |
|---|---|
| Standard 6v6 singles, clean finish | Baseline parse, kill attribution |
| Game with Zoroark/Zorua | `\|replace\|` must not corrupt the nickname map |
| Terastallization / Mega evolution | `\|detailschange\|` species identity |
| Hazard/status/weather KOs | Indirect kill attribution |
| Explosion / recoil self-KO | Death without an opposing kill |
| Forfeit | No `\|faint\|` sequence, winner still resolvable |
| Timeout win | Same |
| Nicknamed team | Nickname → species mapping is not identity |

Save the raw JSON verbatim. Never regenerate them — they're the contract.

### Design

`packages/replay` — pure, no network. A separate fetcher handles IO.

Fetch: `https://replay.pokemonshowdown.com/<id>.json` → `{ log, players, … }`,
rate-limited, cached in `replay_cache`, never fetched twice.

Parser walks the protocol log:

| Line | Use |
|---|---|
| `\|player\|p1\|Username\|…` | side → Showdown username → league member (via `users.showdownUsername`) |
| `\|poke\|p1\|Landorus-Therian, M` | team preview → `brought` candidates |
| `\|switch\|p1a: Nick\|Landorus-Therian, M\|100/100` | nickname → species map per side |
| `\|replace\|`, `\|detailschange\|` | Illusion and forme changes — must not corrupt the map |
| `\|faint\|p1a: Nick` | +1 death for that species; +1 kill for the opposing active |
| `\|win\|Username` | winner |

Kill attribution:

- Kill goes to the opposing side's active mon at faint time
- Hazard/status/weather deaths with no opposing contact → separate `indirect`
  counter, credited to the hazard setter where determinable. Never fudged into
  `kills`
- Self-KO (Explosion, Life Orb, recoil) → death, no opposing kill

Validation against the report:

- `REPLAY_PLAYER_MISMATCH` — participants aren't the matchup's two members
- `ILLEGAL_SPECIES` — a used species isn't on that member's roster. First-class
  outcome: this is how cheating actually gets caught
- `REPLAY_CONTRADICTS_REPORT` — winner disagrees → force `disputed`

A valid replay matching the report auto-confirms the matchup instantly.

### v1 must preserve

`replay_url` stored normalized to a bare replay ID · `match_stats` and
`replay_cache` tables exist · score convention is mons-remaining. All present in
phase 6.

### Risks when it lands

Replays expire — cache raw logs on first fetch. Protocol drifts — the parser
ignores unknown lines rather than throwing, and fixtures are the early warning.

---

## Auction drafts

Phase 4's event model already accommodates it: add `LOT_OPENED`, `BID_PLACED`,
`LOT_WON` events and a bidding timer. No schema redesign — `draft_events` is
generic. Blocked on nothing but demand.

## Keeper leagues

Carry N mons from a previous season at a price escalation. Needs `seasons`
(exists, phase 6) plus a `keepers` table and a draft-start hook that pre-fills
picks. The engine's pick validation already handles pre-seeded rosters.

## Free agency

`transactions.type = 'free_agency'` with `from_member_id = null`. Needs a
pool-availability check and a points-refund rule (drop refunds full price? none?
league setting). Schema from phase 8 already fits.

## Waivers

A `waiver_claims` table with priority order, processed by a batch job that emits
`type='waiver'` transactions. Priority is either reverse standings or rolling.

## Usage statistics

Aggregate draft rates, win rates by species, and price-vs-performance across
leagues. Pure read model over existing data — a materialized view and a couple
of endpoints. Genuinely interesting once there's data volume; useless before.

## Discord integration

Bot posting draft turns, results, and trade notifications to a league's server.
The notification layer from phase 8 is the seam — add a Discord transport
alongside the in-app one.

## Set recommendations

Suggested movesets/EVs per drafted mon from Smogon usage stats. Different
product, deliberately excluded — phase 5 exports an empty skeleton paste and
stops there.
