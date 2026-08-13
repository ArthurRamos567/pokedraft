# Phase 4 — Draft engine & draft room

**Goal:** the core of the product. A pure, tested state machine plus the
persistence and real-time layer around it. Supports live drafts (everyone
online, pick timer) and async drafts (turn deadlines over days) from one
engine.

## Part A — `packages/draft` (pure, no IO)

```
packages/draft/src/
  types.ts       — DraftConfig, DraftState, DraftEvent, Pick, TeamState
  order.ts       — snake/linear turn order math
  reduce.ts      — apply(state, event) → state
  validate.ts    — canPick(state, memberId, speciesId) → Ok | Reason
  autopick.ts    — queue → best affordable → skip
  select.ts      — derived selectors (current turn, budgets, remaining)
  index.ts
  *.test.ts
```

No imports from `@pokedraft/db`, no `Date.now()` inside logic — every event
carries its own timestamp, which is what makes replay deterministic and tests
trivial.

### State

```ts
type DraftState = {
  status: 'pending' | 'active' | 'paused' | 'complete'
  config: DraftConfig            // budget, rosterMin/Max, type, order, pointsById
  order: MemberId[]              // draft position order
  round: number                  // 0-indexed
  pickNo: number                 // global monotonic pick counter
  onClock: MemberId | null
  deadline: number | null        // epoch ms, set by the caller
  taken: Record<SpeciesId, MemberId>
  teams: Record<MemberId, { picks: Pick[]; spent: number; skips: number }>
  complete: MemberId[]           // teams that can't or won't pick further
}
```

### Events (append-only)

| Event | Payload | Emitted by |
|---|---|---|
| `DRAFT_STARTED` | order, config snapshot | host |
| `PICK_MADE` | memberId, speciesId, cost, pickNo | player or host |
| `PICK_AUTO` | + reason: `queue` \| `best` | timer job |
| `TURN_SKIPPED` | memberId, reason: `timeout` \| `manual` | timer job / player |
| `PICK_UNDONE` | pickNo | host only |
| `TURN_ADVANCED` | onClock, round, deadline | engine |
| `DRAFT_PAUSED` / `DRAFT_RESUMED` | reason | host |
| `TEAM_FINISHED` | memberId, reason: `roster_full` \| `budget_out` \| `manual` | engine |
| `DRAFT_COMPLETED` | — | engine |
| `ORDER_CHANGED` | order | host, `pending` only |

`apply()` is total: every event either advances state or throws a typed
`InvalidEvent`. Replaying the full log always reproduces the cached state —
asserted by a test that replays a 1000-event fixture.

### Turn order

Snake, ported from the MVP's approach but generalized:

```
round even → order
round odd  → reversed(order)
```

with two refinements the MVP lacked:

- **Finished teams are skipped**, not just passed over — `turnOrder(round)`
  filters `complete[]`, so a team that's out of budget doesn't stall the clock
- **Linear mode** — same order every round, for leagues that price by tier
  rather than snake fairness

### Pick validation (ordered, first failure wins)

1. Draft is `active`
2. It's this member's turn (or the actor is the host acting for them)
3. Species exists in the league's points list
4. Species not `banned` in the list
5. Species not already `taken`
6. Cost ≤ member's remaining budget
7. Roster not already at `rosterMax`
8. **Reachability**: after this pick, can the member still fill `rosterMin`
   with the cheapest remaining legal mons? If not, reject. Without this a
   player spends everything on two mons and can't field a team.

Each failure returns a stable `code` from phase 0's error contract
(`NOT_YOUR_TURN`, `ALREADY_TAKEN`, `OVER_BUDGET`, `ROSTER_FULL`,
`ROSTER_UNREACHABLE`).

### Completion

A team is finished when `roster == rosterMax`, or no undrafted mon is
affordable, or they declare done. Draft completes when every team is finished.
Leagues with `allow_undrafted: false` block completion until every team hits
`rosterMin` — the host is warned rather than silently stuck.

### Tests (pure, fast, no DB)

- Snake order for 4/6/8/odd member counts across many rounds
- Finished team removed mid-round without corrupting the sequence
- Budget exhaustion → `TEAM_FINISHED(budget_out)`
- `ROSTER_UNREACHABLE` triggers exactly at the boundary, not one pick early
- Undo restores budget, frees the species, rewinds `onClock`
- Replay determinism over a long fixture log
- Autopick precedence: queue hit > best affordable > skip

## Part B — persistence

```sql
drafts
  id uuid pk
  league_id → leagues (unique)
  point_list_id → point_lists          -- snapshot: which list this draft used
  status enum(pending, active, paused, complete)
  state jsonb                          -- cached fold, rebuildable
  seq int                              -- last applied event seq
  started_at, completed_at
  version int                          -- optimistic concurrency

draft_events
  id uuid pk
  draft_id → drafts
  seq int
  type text
  payload jsonb
  actor_id uuid null → users
  created_at
  unique (draft_id, seq)

draft_picks                            -- projection, for queries + constraints
  draft_id → drafts
  member_id → league_members
  species_id text
  cost int
  round int, pick_no int
  unique (draft_id, species_id)        -- the hard anti-double-pick guard
  unique (draft_id, pick_no)

draft_queues                           -- a player's pre-ranked wishlist
  member_id → league_members
  species_id text
  rank int
  unique (member_id, species_id)
```

`draft_picks` is derived from events but stored, because it's what every other
phase joins against, and because the unique constraint is the real guarantee
that two simultaneous picks can't take the same mon.

Write path, all inside one transaction:

```
BEGIN
  SELECT … FROM drafts WHERE id = $1 FOR UPDATE      -- serialize writers
  state ← drafts.state
  event ← engine.validate + build
  INSERT draft_events (seq = drafts.seq + 1)
  INSERT draft_picks  (if PICK_*)                     -- unique constraint fires here
  UPDATE drafts SET state = apply(state, event), seq = seq + 1
COMMIT
→ broadcast event on the league WS topic
```

Undo deletes the trailing events and rebuilds by replay rather than trying to
invert `apply()`. Simpler and provably correct.

## Part C — real-time & timers

**WS** — reuses phase 0's single league socket, `topic: 'draft'`:

- On connect: `{ type: 'SNAPSHOT', state, seq }`
- Then incremental events; client applies them with the same
  `packages/draft` reducer it imports, so client and server states can't drift
- On gap (`clientSeq < serverSeq - N`): resend snapshot
- Presence: who's connected, shown in the room so the host knows who's AFK

**Timers** — `draft-deadlines` job (phase 0), every 15s:

```
for each active draft where deadline < now:
  acquire advisory lock on draft_id
  re-read state; if pickNo advanced, no-op            -- the race guard
  autopick per league policy → PICK_AUTO or TURN_SKIPPED
```

Live mode sets `deadline = now + pick_seconds`; async sets
`now + turn_hours`. Async additionally sends a notification when a member goes
on the clock, and a reminder at 25% remaining.

Paused drafts freeze deadlines: on resume, deadlines are recomputed from the
resume timestamp, not the original one.

## Endpoints

| Route | Who |
|---|---|
| `POST /leagues/:id/draft/start` | host; validates order set, points locked, members ≥ 2 |
| `GET /leagues/:id/draft` | member; state + available pool + my budget |
| `POST /leagues/:id/draft/pick` | on-clock member `{ speciesId }` |
| `POST /leagues/:id/draft/skip` | on-clock member |
| `POST /leagues/:id/draft/pause` \| `/resume` | host |
| `POST /leagues/:id/draft/undo` | host |
| `POST /leagues/:id/draft/force-pick` | host, for an absent player |
| `GET/PUT /leagues/:id/draft/queue` | member's own wishlist |
| `GET /leagues/:id/draft/events?since=` | replay/audit |
| `WS /leagues/:id/live` | topic `draft` |

`GET /draft` returns the *available* pool already filtered by budget
affordability, so the client doesn't reimplement the rules.

## Integration tests

- Two concurrent picks of the same species: one 201, one 409 `ALREADY_TAKEN`
- Timer expiry racing a real pick: exactly one event lands
- Full 8-player × 10-round draft driven through the API, then state rebuilt
  from events matches the cached state byte-for-byte
- WS client receives every event in order with no gaps

## Acceptance criteria

- A complete live draft runs end-to-end with timers and reconnects
- An async draft advances correctly across simulated day boundaries
- Draft state is fully reconstructible from `draft_events` alone — dropping the
  `state` column and replaying yields the same result
- Zero business rules duplicated between server and client (both import the
  engine)

## Explicitly out of scope for v1

Auction drafts, keeper leagues, tiered/positional draft requirements. The event
model accommodates them later (`BID_PLACED`, `LOT_WON`) without a redesign.
