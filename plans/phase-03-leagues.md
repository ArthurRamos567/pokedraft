# Phase 3 — Leagues, membership & points

**Goal:** create a league, configure its rules, get players in, and load the
points list. This is the phase that makes the product multi-tenant; everything
after it is scoped by `league_id`.

## Schema

```sql
leagues
  id uuid pk
  slug text unique                 -- url-friendly, generated from name
  name text
  description text
  visibility enum(public, private)
  status enum(setup, drafting, regular_season, playoffs, complete, archived)
  format_id text                   -- dex format id, validated in phase 2
  host_id uuid → users
  banner_url text, logo_url text
  created_at, updated_at

league_settings                    -- 1:1 with leagues, split so it can grow
  league_id uuid pk → leagues
  draft_mode enum(live, async)
  draft_type enum(snake, linear)
  pick_seconds int                 -- live mode
  turn_hours int                   -- async mode
  budget int                        -- total points per team
  roster_min int, roster_max int
  allow_undrafted boolean          -- can a team be short of roster_max
  max_members int
  trades_enabled boolean
  trades_require_host_approval boolean
  trade_deadline_week int null
  autopick_policy enum(skip, queue_then_skip, queue_then_best)

league_members
  id uuid pk
  league_id → leagues
  user_id → users
  role enum(host, cohost, player, spectator)
  team_name text, team_logo_url text
  draft_position int null          -- set when order is drawn
  status enum(active, removed)
  joined_at
  unique (league_id, user_id)

league_invites
  id uuid pk
  league_id → leagues
  code text unique                 -- short base32
  created_by → users
  max_uses int null, uses int
  expires_at timestamptz null
  revoked_at timestamptz null

point_lists
  id uuid pk
  league_id → leagues
  version int                      -- monotonic per league
  name text
  source enum(yml_upload, manual, cloned)
  raw_source text                  -- the original YML, kept verbatim
  created_by → users
  locked_at timestamptz null       -- set when the draft starts; immutable after
  created_at
  unique (league_id, version)

point_entries
  id uuid pk
  point_list_id → point_lists
  species_id text                  -- canonical dex id
  points int
  banned boolean default false     -- explicitly undraftable
  notes text null
  unique (point_list_id, species_id)
```

The active list is `point_lists` with the highest `version`. Lists are
versioned and immutable once a draft starts, so a mid-draft price edit can't
retroactively change what a pick cost.

## League lifecycle

```
setup ──start draft──▶ drafting ──complete──▶ regular_season
                                                  │
                                            generate playoffs
                                                  ▼
                                              playoffs ──▶ complete ──▶ archived
```

Status gates writes: you can't join a league that's `drafting`, can't edit
points after `setup`, can't report matches before `regular_season`. Gate checks
live in one `assertStatus(league, [...allowed])` helper, not scattered.

## Endpoints

**Discovery**

| Route | Notes |
|---|---|
| `GET /leagues?visibility=public&status=&q=&cursor=` | public directory only |
| `GET /leagues/mine` | leagues I'm in, any visibility |
| `GET /leagues/:slug` | private → 404 for non-members (phase 0 rule) |

**Management** (`{ league: 'host' }`)

| Route | Notes |
|---|---|
| `POST /leagues` | creator becomes host + a player member by default |
| `PATCH /leagues/:id` | name, description, visibility, format (setup only) |
| `PATCH /leagues/:id/settings` | rules; most fields locked once `drafting` |
| `POST /leagues/:id/invites` | returns a code + shareable URL |
| `DELETE /leagues/:id/invites/:code` | revoke |
| `DELETE /leagues/:id/members/:memberId` | kick (setup only; after that, mark inactive) |
| `PATCH /leagues/:id/members/:memberId` | role change, transfer host |
| `POST /leagues/:id/draft-order` | `{ mode: 'random' \| 'manual', order? }` |

**Membership**

| Route | Notes |
|---|---|
| `POST /leagues/:id/join` | public leagues, `setup` status, capacity check |
| `POST /leagues/join/:code` | private, via invite |
| `POST /leagues/:id/leave` | blocked once `drafting` |
| `PATCH /leagues/:id/me` | own team name/logo |

**Points**

| Route | Notes |
|---|---|
| `POST /leagues/:id/points/preview` | multipart or raw YML → diff, **writes nothing** |
| `POST /leagues/:id/points/commit` | creates the next version |
| `GET /leagues/:id/points` | active list, joined with dex data |
| `GET /leagues/:id/points/versions` | history |
| `PATCH /leagues/:id/points/entries/:speciesId` | single-mon tweak (setup only) → new version |

## YML import

Accept both shapes people actually keep their sheets in:

```yaml
# A — name → points
Landorus-Therian: 20
Weavile: 19
Heatran: 18
```

```yaml
# B — points → list of names
20:
  - Landorus-Therian
  - Kyurem-Black
19:
  - Weavile
banned:
  - Zacian-Crowned
```

Parse with `yaml` (safe schema, no custom tags). Pipeline:

1. Parse → normalize both shapes into `{ speciesId, points, banned }[]`
2. Resolve names through phase 2's resolver
3. Classify each row:
   - `ok` — resolved, legal in the league's format
   - `illegal` — resolved but banned by the format's rule table (warn, allow
     with an explicit override flag: some leagues intentionally unban)
   - `unknown` — unresolved, with up to 3 suggestions
   - `duplicate` — same species twice, last wins, flagged
4. Diff against the current active list: added / removed / repriced
5. Return the full report; **commit is a second, explicit call** that takes the
   preview's hash so nobody commits a report they didn't see

Limits: 256KB, 2000 entries, 30s parse timeout.

Preview response:

```ts
{
  hash: string,
  summary: { ok: 412, illegal: 3, unknown: 2, duplicates: 1 },
  diff: { added: [...], removed: [...], repriced: [{ speciesId, from, to }] },
  rows: [{ input: 'Lando-T', speciesId, points, status, suggestions? }]
}
```

An import with any `unknown` row is committable — unknown rows are dropped and
listed — but the UI must show them. Silently dropping a mon from a points list
is how a draft breaks at 2am.

## Tests

- Both YML shapes produce identical normalized output
- `banned:` key handled in shape B without being parsed as a points bucket
- Unknown name yields suggestions and never auto-resolves
- Committing with a stale hash → 409
- Version increments; committing doesn't mutate the previous list
- Points list locked after draft start → 409
- Private league is 404 to a non-member, 200 to a member
- Join blocked at capacity, at wrong status, with a revoked/expired code
- Host transfer leaves exactly one host

## Acceptance criteria

- A host can go from zero to "league ready to draft" through the API alone:
  create → configure → invite → members join → import points → draw order
- The MVP's `data/pool.json` can be converted to YML and imported with zero
  unknown rows (good regression corpus — it's a real 400-mon list)
- No endpoint outside this module needs to know how points are stored

## Risks

- **Format change after points import.** Changing `format_id` invalidates
  legality classifications. Solution: block format changes once a points list
  exists, or force a re-preview.
- **Host abandonment.** A league whose host disappears is stuck. Add
  `POST /leagues/:id/claim-host` gated on host inactivity (90 days) plus
  co-host presence — small feature, prevents dead leagues.
