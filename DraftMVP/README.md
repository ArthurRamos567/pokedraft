# Pokédraft

LAN draft board for a small Pokémon tournament. Players have a point budget,
every Pokémon has a cost derived from its **viability ranking** in the format
being drafted (gen 8 National Dex OU / UU / RU, out of the box), and the draft
snakes back and forth until nobody can afford anything else.

Formats live in the database, not in the code: several can be stored side by
side and the board picks one. See [Pools and tiers](#pools-and-tiers).

Your PC runs the server; everyone else opens the URL on their phone or laptop.
The server owns the draft, keeps it in SQLite and pushes every change to all
devices over SSE. No accounts, no roles — anyone connected can act, and the
server serializes actions so two people tapping the same Pokémon can't both get
it. No dependencies; needs Node 22+ for `node:sqlite`.

## Run it

```bash
npm start                                    # port 4173, draft.db in the project root
node tools/server.mjs 8080 /path/to/other.db
```

A database with no pools in it seeds itself on boot, so there is nothing to run
first.

The server prints the LAN URL on boot:

```text
  draft board → http://localhost:4173
  on your LAN  → http://192.168.0.42:4173
```

Everyone joins that second URL. The dot next to the title is green while the
device is live and the label beside it counts connected devices. If wifi drops,
the browser reconnects on its own and pulls the current board.

## How the draft works

1. Add players (each gets the global **Budget**).
2. **🎲 Randomize order** — Fisher–Yates, can be re-rolled until the draft starts.
3. **Start draft** — locks the roster and the order.
4. Tap a Pokémon in the store to draft it for whoever's turn it is; a
   confirmation dialog guards against misclicks.
5. Order snakes: round 1 goes first→last, round 2 last→first, round 3 first→last…
   so the player at each end of the order picks twice in a row at the turn.
6. A player who can't afford the cheapest remaining Pokémon is **skipped**
   automatically. The draft ends when that's true for everyone.
   Set **Max roster** > 0 to also cap how many Pokémon a player may take.

Other controls: **Undo** rolls back the last pick (budget, pool and turn all
revert), **Mark done** takes a player out of the rotation early, **Export**
downloads the draft as JSON and **Import** pushes one back to the server.
**Reset** wipes the draft on every connected device.

## Tournament stage

The **Bracket** tab runs the matches once drafting is done. Same synced state, so
every device sees results the moment they are entered.

1. **🎲 Draw round robin** — random draw, unrelated to the draft order. With 8
   players that is 7 rounds of 4 matches, 28 in total; everyone plays everyone
   once. Odd player counts get a bye each round.
2. Tap the winner's name on a match card, adjust the series score (2–0, 2–1,
   3–1 … quick buttons, or type it) and save. The ↶ on a played match clears it.
3. **Standings** order by match wins, then game difference, then head-to-head,
   then games won. The top 4 are highlighted.
4. When all 28 are played the **top 4 cut** unlocks: 1v4 and 2v3 semis, then the
   final and a 3rd-place match. Winners feed forward automatically.

### Matchups display

`http://<your-ip>:4173/bracket.html` is a read-only page with nothing but the
player names, who plays whom and the scores — for a second screen, a TV, or to
hand round so nobody has to scroll past the store. It follows the same SSE
stream, so a result entered on the board lands there instantly. There is not a
single button on it; results are only ever entered from the Bracket tab. Linked
from the header as **Matchups ↗**.

Clearing a round-robin result takes the cut down with it; clearing a semi
un-fills the final. Results that no longer have both players are dropped rather
than left pointing at someone who is no longer in the match.

## Sync model

| endpoint | what |
|---|---|
| `GET /api/pool` | the active pool's store (713 Pokémon by default) |
| `GET /api/pools` | `{active, pools}` — every stored format with its tiers and size |
| `GET /api/state` | `{revision, state}` snapshot |
| `GET /api/events` | SSE — a `state` frame on every change, `presence` on connect/disconnect, `: ping` every 20 s |
| `POST /api/action` | `{revision, action}` → validates, applies, broadcasts |

Every action carries the revision the device was showing. If the board moved on
in the meantime the server answers **409** with the real state, the client
adopts it and shows *"Board changed — have another look."* That's what stops a
stale phone from drafting on the wrong player's turn. Actions from a single
device are queued client-side so they can never invalidate each other.

State lives in `draft.db`:

```bash
sqlite3 draft.db 'select player, mon, cost, round from picks order by seq'
```

The `draft` table holds the canonical JSON (one row); `picks` is a denormalized
mirror rebuilt on every write, there purely so the results stay queryable
afterwards. Kill the server mid-draft and restart it — same revision, same board.
The same file also holds the catalog — `pools`, `tiers`, `pokemon`,
`pool_pokemon` — so the store is queryable too:

```bash
sqlite3 draft.db 'select p.name, pp.cost, pp.tier from pool_pokemon pp
                  join pokemon p on p.id = pp.pokemon_id
                  join pools on pools.id = pp.pool_id
                  where pools.key = "gen8-natdex" order by pp.cost desc limit 10'
```

Sprites and pool data are served from your PC, so the draft survives the venue
wifi dying; devices only need to reach the server.

## Security

The threat model is "everyone in the room is a friend". There is no auth: any
device that can reach the port can draft, undo or reset. That is deliberate —
run it on a network you trust, and don't port-forward it or expose it to the
internet.

What the server does guard against:

- **File exposure** — only `/index.html`, `/bracket.html`, `/styles.css`,
  `/src/*` and `/assets/*` are served. `draft.db`, `tools/`, `data/` and
  `package.json` return 403, and path traversal (`/../`, `%2f`) is rejected before any read.
- **Malformed input** — every action is type-checked server-side; an imported
  save file is validated field by field, including that its drafted Pokémon
  exist in the pool.
- **Request size** — action bodies over 2 MB are refused.
- **Race conditions** — see the revision check in [Sync model](#sync-model).

Firewall: nothing to open on a default Ubuntu install (ufw ships disabled). If
yours is on:

```bash
sudo ufw allow 4173/tcp     # or: sudo ufw allow from 192.168.0.0/24 to any port 4173
```

If the venue wifi is shared with strangers, either tether the players to a
phone hotspot you control, or restrict the port to your subnet as above.

## Costs

Cost comes from the Pokémon's viability rank in the tier it's ranked in. A mon
ranked in two tiers keeps its **highest** cost and is tagged with that tier.
Every number below is a row in the database — the table here is what the
`gen8-natdex` seeder puts there, not a constant in the code.

**Tier weighs more than rank**: the bands are spaced so that a bottom-of-OU mon
still outprices almost every UU mon, and every UU mon outprices every RU mon.
The only overlap left is OU's floor (9) sitting under the top UU ranks (10–11).

| rank | OU | UU | RU |
|------|----|----|----|
| S    | 20 | 11 |  6 |
| S-   | 19 | 10 |  6 |
| A+   | 18 | 10 |  5 |
| A    | 17 |  9 |  5 |
| A-   | 16 |  8 |  4 |
| B+   | 15 |  8 |  4 |
| B    | 14 |  7 |  4 |
| B-   | 13 |  6 |  3 |
| C+   | 12 |  5 |  3 |
| C    | 11 |  5 |  2 |
| C-   | 10 |  5 |  2 |
| D    |  9 |  5 |  1 |

Everything else that is *legal* in gen 8 National Dex but unranked in all three
threads is badged **UR** and priced off raw stats instead of a rank
(`unranked_bands`): linear on BST, clamped at both ends. That is 493 of the 713
Pokémon — every Beldum, Weedle and Alakazam is draftable if someone wants one.

The band depends on the mon's National Dex tier, because "unranked" means
something different in each. A UUBL Pokémon nobody bothered to rank is still
banned from UU for a reason, so it sits between the ranked OU and UU bands:

| ND tier | 400 BST | 600 BST | sits between |
|---------|---------|---------|--------------|
| UUBL    |       9 |      13 | ranked OU and UU |
| RUBL    |       5 |       9 | ranked UU and RU |
| anything else | 1 |       8 | — |

On top of that, **anything with 500 BST or more costs at least 4**
(`pools.bulk_bst` / `bulk_cost`), whatever its rank or lack of one says.

Price overrides are the escape hatch for Pokémon whose stats and tier both lie
about them — applied last, so they beat every curve and floor. They are stored
per pool and declared in the seeder:

```js
overrides: {
  Smeargle: 13,          // 250 BST, but Spore + Baton Pass off any moveset
  Politoed: 12,          // Drizzle — the price is the weather, not the stats
  'Greninja-Bond': 16,   // turns into Greninja-Ash mid-battle, so it costs the same
},
```

The scraper fails loudly if an override names a Pokémon that is not in the pool,
so a typo cannot sit there doing nothing.

Not draftable at any price: **ND Uber and AG** (banned in OU, UU and RU alike),
Gigantamax formes, battle-only formes (Aegislash-Blade, Darmanitan-Zen…), Totem
formes, and CAP. The legal set and its tiers come from Showdown's
`data/mods/gen8/formats-data.ts` (`natDexTier`), so it matches what the ladder
actually allowed.

To retune: edit the curve in `tools/seeds/gen8-natdex.mjs` and re-run
`npm run seed` (definitions are always refreshed) then `npm run scrape`; or
`UPDATE pool_pokemon SET cost = …` for a one-off; or tap the ✎ on any store card
to reprice a single Pokémon mid-draft (that override is part of the draft state,
so it syncs to every device and is dropped if the format changes).

## Pools and tiers

A **pool** is a draft format: a set of Pokémon with prices, plus the tiers those
prices come from. Several are stored at once and the **Format** picker in the
header switches the board between them. Switching is refused once the draft has
started or anything has been drafted — undo or reset first — because prices,
and therefore every budget already spent, belong to the pool they were set in.
The store's tier chips are built from the active pool, so a format with other
tiers filters by those instead.

Everything the scraper needs lives in the catalog rather than in code:

| table | holds |
|---|---|
| `pools` | the format: dex page, Showdown data mod, banned tiers, bulk floor |
| `tiers` | one row per tier: its VR thread, and the `top`/`step`/`floor` curve its ranks price through |
| `unranked_bands` | BST → cost band per National Dex tier, for the unranked bin |
| `price_overrides` | hand-set prices, with the reason in `note` |
| `pokemon` | species metadata, shared by every pool that lists the species |
| `pool_pokemon` | what a species costs *in this pool*, and its tier there |
| `pool_ranks` | every rank a species holds, one row per tier that ranked it |

### Seeders

`tools/seeds/` is one module per shipped pool, exporting its definition and its
Pokémon. That is what makes the tables above readable — the gen 8 National Dex
sources, curves, bands and overrides are all in
[`tools/seeds/gen8-natdex.mjs`](tools/seeds/gen8-natdex.mjs), and its 713
Pokémon come from `data/pool.json`, the scraper's last run kept as a fixture so
a fresh database is usable without waiting on Smogon.

```bash
npm run seed                              # anything missing; definitions always refreshed
node tools/seed.mjs --force               # rewrite the Pokémon from the fixture too
node tools/seed.mjs --only=gen8-natdex --db=/tmp/x.db
```

Re-running never clobbers a scrape or a hand-edited price unless `--force` says
so. A definition *is* authoritative: drop a tier from a seeder and the row goes
away rather than lingering as a stale filter chip.

**Adding a format:** write `tools/seeds/<key>.mjs` exporting `pool` and
`mons()`, list it in `tools/seeds/index.mjs`, then `npm run seed &&
npm run scrape -- --pool=<key>`. No scraper code changes.

## Re-scraping the data

```bash
npm run scrape                                  # every pool: ranks + metadata + sprites
node tools/scrape/cli.mjs --pool=gen8-natdex
node tools/scrape/cli.mjs --no-sprites          # skip the sprite download
node tools/scrape/cli.mjs --json                # also refresh the data/pool.json fixture
```

Sources come from the pool's own row, and for `gen8-natdex` they are:

| data | where |
|---|---|
| ND OU ranks | [SS National Dex OU Viability Rankings](https://www.smogon.com/forums/threads/ss-national-dex-ou-viability-rankings.3765657/) |
| ND UU ranks | [National Dex UU Viability Rankings](https://www.smogon.com/forums/threads/national-dex-uu-viability-rankings.3672482/) |
| ND RU ranks | [Gen 8 ND RU Resources, post #3](https://www.smogon.com/forums/threads/gen-8-national-dex-ru-resources.3764650/post-10552909) |
| types / stats / abilities | `dexSettings` JSON embedded in the [SS National Dex](https://www.smogon.com/dex/ss/formats/national-dex/) page |
| sprites | `play.pokemonshowdown.com/sprites/ani` (animated), `…/gen5` fallback |

The scraper **fails loudly** rather than dropping data: any name in a VR thread
it can't map to a dex entry, and any Pokémon whose sprite won't download, is
printed and the run exits non-zero. Fix a name by adding it to
`tools/scrape/aliases.json` (`"Landorus T": "Landorus-Therian"`); the `__ignore`
list there holds prose fragments the parser should not treat as Pokémon.

Sprites stay files on disk under `assets/sprites/` and are served statically —
only the path is stored — so a re-scrape never re-downloads what is already
there.

Current pool: **713 Pokémon** — 96 priced off OU, 54 off UU, 70 off RU, and 493
unranked at 1 point. Costs 1–20. A full scrape takes about 30 s.

## Tests

```bash
npm test
```

- `tools/draft.test.mjs` — draft rules: snake order, skipping, undo, end conditions
- `tools/bracket.test.mjs` — schedule shape, standings tiebreaks, cut seeding,
  results feeding forward, clearing results unwinding what depended on them
- `tools/catalog.test.mjs` — pools, tiers and seeding: an empty DB seeding
  itself, re-seeds keeping scraped prices, two pools pricing one species apart
- `tools/scrape.test.mjs` — the offline halves of the scraper: VR thread
  parsing, aliases, and every pricing rule
- `tools/server.test.mjs` — boots a real server against a temp DB: SSE fan-out,
  presence, stale-revision 409s, two devices racing for the same Pokémon,
  switching pools, restart-from-SQLite

## Layout

```text
index.html          three-panel board (Draft + Bracket tabs)
bracket.html        read-only matchups display
styles.css
src/draft.js        pure draft rules — no DOM, no I/O
src/bracket.js      pure round-robin + standings + top-4 cut
src/actions.js      the only way state mutates; the server applies actions through it
src/app.js          rendering, SSE subscription, POSTing actions
src/matchups.js     the display page — reads state, never writes
data/pool.json      GENERATED — seed fixture for the gen8-natdex pool
assets/sprites/     GENERATED — 712 animated sprites (~56 MB)
tools/server.mjs    static files + state + SSE
tools/paths.mjs     project root + default DB path
tools/seed.mjs      CLI: fill a database with the shipped pools
tools/db/           SQLite: schema.mjs, draft.mjs (the board), pool.mjs (the catalog)
tools/seeds/        one module per shipped pool — gen8-natdex.mjs
tools/scrape/       data pipeline: cli.mjs, dex, viability, showdown, pricing,
                    sprites, names, http, aliases.json
tools/*.test.mjs
```
