# Phase 2 — Dex layer

**Goal:** one package that answers every "what is this Pokémon / is it legal in
this format" question, in memory, with no database and no scraping. Everything
downstream (points import, draft legality, team visualizer, replay parsing)
depends on it.

## Package: `packages/dex`

```
packages/dex/src/
  gens.ts        — Generations instance, per-gen memoized
  species.ts     — species lookup, search, indices
  formats.ts     — format list + rule tables
  legality.ts    — is species/move legal in format
  learnsets.ts   — move pool for a species in a format
  sprites.ts     — @pkmn/img URL builders
  coverage.ts    — type chart math (used by phase 5)
  index.ts
  *.test.ts
```

## Dependencies and what each is for

| Package | Used for |
|---|---|
| `@pkmn/dex` | Species, moves, abilities, items, types, learnsets |
| `@pkmn/data` | `Generations` wrapper — gen-aware, async learnset access |
| `@pkmn/sim` | Format list and `RuleTable` (bans, unbans, clauses) |
| `@pkmn/img` | Sprite/icon URLs (Showdown CDN — no local asset dir) |
| `@pkmn/sets` | Showdown paste import/export (phase 5 team export) |

No scraping, no vendored copy of the showdown repo. Upgrading Pokémon data is
`bun update @pkmn/*` plus a test run.

## Boot-time indices

Built once at process start, held in memory (~ a few MB):

- `byId: Map<ID, Species>` per generation
- `searchIndex` — normalized name + alias trigrams for fuzzy lookup
  (seed aliases from the MVP's `tools/scrape/aliases.json`: "lando-t",
  "ttar", "pex", …)
- `formatSpecies: Map<FormatID, Set<ID>>` — legal species per supported format,
  precomputed so draft-time legality is a set membership test

Guard the boot cost: build lazily per format on first use, cached forever.

## Format handling

A league picks a format ID (`gen9ou`, `gen8nationaldex`, `gen9vgc2024regh`, …).
From `@pkmn/sim`:

- `Dex.formats.get(id)` → format with `ruleset`, `banlist`, `unbanlist`
- `format.ruleTable` → resolved bans including inherited rulesets
- Legality for the draft = species exists in that gen **and** is not banned by
  the rule table. Complex clauses (Species Clause, Item Clause) don't affect
  *draftability*, only battle legality — we surface them as league info text.

Expose a curated `SUPPORTED_FORMATS` list (the ones draft leagues actually
use) but allow any valid format ID — the list is for the UI dropdown, not a
whitelist.

## Endpoints (`apps/api/src/modules/dex`)

All read-only, cacheable, `Cache-Control: public, max-age=3600`. No auth
required — this is public reference data.

| Route | Returns |
|---|---|
| `GET /dex/formats` | curated + searchable format list |
| `GET /dex/formats/:id` | name, gen, ruleset summary, banned species count |
| `GET /dex/species?format=&q=&type=&ability=&minBst=&sort=&cursor=` | paginated species cards |
| `GET /dex/species/:id?format=` | full detail: stats, types, abilities, weight/height, evolution line, tier, sprite URLs |
| `GET /dex/species/:id/learnset?format=` | moves with category/power/accuracy/type |
| `GET /dex/moves/:id` | move detail |
| `GET /dex/abilities/:id` | ability detail |
| `POST /dex/resolve` | `{ names: string[] }` → canonical IDs + unmatched + suggestions |

`POST /dex/resolve` is the workhorse for phase 3's YML import and phase 6's
replay parsing — one place that turns human-typed names into dex IDs.

## Name resolution rules

1. `toID(input)` exact hit → done
2. Alias table hit (`lando-t` → `landorustherian`)
3. Formes: bare name + forme suffix normalization (`Landorus Therian`,
   `Landorus-T`, `Landorus (Therian)`)
4. Fuzzy match (trigram, threshold) → returned as a **suggestion**, never
   auto-applied. Silent fuzzy matching on a points list would misprice a mon.

Cosmetic formes (Gastrodon-East, Vivillon patterns) collapse to their base ID;
functional formes (Rotom-Wash, Urshifu-Rapid-Strike) stay distinct. This
distinction is a test case, not a comment.

## Sprites

`@pkmn/img` builds URLs against Showdown's CDN for both animated sprites and
dex icons; no local `assets/sprites` dir like the MVP. Sprite choice
(`gen5ani`, `dex`, `home`) is a client concern — the API returns the species
ID and a helper builds the URL client-side, so we don't bake CDN paths into
API responses.

## Tests

- Alias resolution table: every alias in the MVP's `aliases.json` resolves
- Forme handling: cosmetic collapse vs. functional distinct
- Legality: known-banned mon in `gen9ou` is excluded; the same mon in
  `gen9ubers` is included
- Gen boundaries: a gen-9 mon is absent from `gen8nationaldex`… and present in
  `gen9nationaldex`
- `resolve` never fuzzy-matches into a wrong-but-plausible mon
  (`"Mew"` must not become `"Mewtwo"`)
- Snapshot the species count per supported format so a `@pkmn` upgrade that
  silently changes the pool fails CI loudly

## Acceptance criteria

- `GET /dex/species?format=gen9ou&q=lando` returns Landorus-Therian first
- Full species detail round-trips every field the team visualizer needs
  (phase 5 has no unmet data dependency)
- Boot time impact under 300ms for the default format; other formats build
  lazily
- `@pkmn` version bump is a one-line change with a green test suite

## Risks

- **`@pkmn/sim` bundle weight.** It's the full simulator. If boot time or
  memory bites, extract only the format definitions at build time into a
  generated JSON and drop the runtime dependency — the interface here doesn't
  change.
- **Formats drift.** Smogon retires/renames formats each gen. The snapshot test
  is what tells us before a user does.
