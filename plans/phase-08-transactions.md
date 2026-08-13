# Phase 8 — Transactions (trades)

**Goal:** players swap Pokémon after the draft, with validation that keeps
every roster legal and every budget honest. Trades only in v1; the schema is
shaped so free agency and waivers are additive later.

## Schema

```sql
transactions
  id uuid pk
  league_id → leagues
  type enum(trade, free_agency, waiver)      -- only 'trade' used in v1
  status enum(proposed, accepted, pending_approval, approved,
              rejected, cancelled, vetoed, expired)
  proposer_member_id → league_members
  counterparty_member_id → league_members null
  message text
  week_id → weeks null                        -- which week it lands in
  expires_at timestamptz
  decided_at timestamptz null
  decided_by uuid null → users
  veto_reason text null
  created_at

transaction_items
  id uuid pk
  transaction_id → transactions
  from_member_id → league_members
  to_member_id → league_members
  species_id text
  -- no quantity: one row per mon, uneven trades are just unequal row counts

transaction_votes                             -- optional league-vote veto mode
  transaction_id → transactions
  member_id → league_members
  vote enum(approve, veto)
  unique (transaction_id, member_id)
```

Trades never mutate `draft_picks`. Roster is a fold over picks + approved
transactions (phase 5) — that's what keeps draft history intact and makes
"who originally drafted this mon" answerable forever.

## Flow

```
proposed ──counterparty accepts──▶ accepted
   │                                   │
   │ rejected / cancelled / expired    │ league requires host approval?
   ▼                                   ├── no ──▶ approved (roster changes now)
 terminal                              └── yes ─▶ pending_approval
                                                     │
                                        host approves├──▶ approved
                                        host vetoes  └──▶ vetoed
```

- Proposer may cancel while `proposed`
- Auto-expire at `expires_at` (default 72h, league-configurable)
- Optional league-vote veto mode: a trade in `pending_approval` is vetoed if
  ≥ N members vote veto within the window. Off by default — most leagues just
  trust the host

## Validation

Run at **propose** time (fail fast, good UX) and again inside the **approve**
transaction (correctness — rosters change between the two):

1. `trades_enabled` on the league
2. League status is `regular_season` (or `playoffs` if the league allows it)
3. Trade window open, and before `trade_deadline_week`
4. Both members active, not the same member
5. Every offered species is currently on the offering member's roster
6. Post-trade roster size within `[rosterMin, rosterMax]` for both sides
7. Post-trade point spend ≤ budget for both sides — **only if** the league
   enforces a post-trade cap (setting; many leagues let value drift after the
   draft, which is the point of trading)
8. No duplicate species on either resulting roster

Failures return stable codes: `TRADE_WINDOW_CLOSED`, `NOT_ON_ROSTER`,
`ROSTER_LIMIT`, `OVER_CAP`, `DUPLICATE_SPECIES`.

## Concurrency

Two accepted trades sharing a mon is the obvious bug. Guard, per phase 0:

```
BEGIN
  SELECT … FROM league_members
   WHERE id IN (proposer, counterparty) ORDER BY id FOR UPDATE   -- ordered: no deadlock
  revalidate ownership + limits against current rosters
  UPDATE transactions SET status = 'approved'
  INSERT audit_log
COMMIT
→ invalidate roster caches, broadcast on WS topic 'transactions'
```

Ordering the lock acquisition by member ID is what prevents two mirrored trades
from deadlocking each other.

Any *other* pending trade that involved a now-moved mon is not auto-rejected —
it fails revalidation at its own approval time with `NOT_ON_ROSTER`, which is
the honest outcome and needs no cascade logic.

## Endpoints

| Route | Who |
|---|---|
| `POST /leagues/:id/transactions` | member: `{ counterpartyId, gives: [speciesId], gets: [speciesId], message }` |
| `GET /leagues/:id/transactions?status=&member=` | member: league trade log |
| `GET /leagues/:id/transactions/mine` | member: incoming + outgoing pending |
| `POST /leagues/:id/transactions/:tid/accept` \| `/reject` | counterparty |
| `POST /leagues/:id/transactions/:tid/cancel` | proposer |
| `POST /leagues/:id/transactions/:tid/approve` \| `/veto` | host |
| `POST /leagues/:id/transactions/:tid/vote` | member, vote-veto mode |
| `POST /leagues/:id/transactions/validate` | dry run — used by the UI live as the user builds an offer |

`/validate` matters: the trade builder should grey out illegal offers before
the user hits submit, using the same code path the server enforces.

## Notifications

`notifications` table (phase 0) + WS push: trade proposed to you, your trade
accepted/rejected, host approved/vetoed, trade expiring in 12h.

## Tests

- Uneven trade (2-for-1) respecting roster limits on both sides
- Trade violating `rosterMin` on the giving side → rejected
- Post-trade cap enforcement toggled on and off produces different outcomes for
  the same trade
- Concurrent approval of two trades sharing a mon: one approved, one
  `NOT_ON_ROSTER`
- Mirrored simultaneous trades don't deadlock (ordered locking)
- Expiry job transitions only `proposed`/`pending_approval`, never `approved`
- Roster fold after approval matches expected for both members
- Trade after the deadline week → `TRADE_WINDOW_CLOSED`

## Acceptance criteria

- Two players complete a trade end-to-end, with and without host approval
  enabled
- The trade log is a readable history of the league's roster movement
- Phase 5's roster function needs no change — trades were already in its
  definition

## Future (schema already fits)

- **Free agency**: `type='free_agency'`, items with `from_member = null`
  (undrafted pool) — needs a pool-availability check and a points-refund rule
- **Waivers**: a `waiver_claims` table with priority order, processed as a
  batch job that emits `type='waiver'` transactions
