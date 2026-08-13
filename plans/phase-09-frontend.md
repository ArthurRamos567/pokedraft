# Phase 9 — Frontend (TanStack Start)

**Goal:** the app people actually use. Ships incrementally alongside backend
phases — the league shell can exist as soon as phase 3 lands.

## Stack

| Concern | Choice |
|---|---|
| Framework | TanStack Start (React 19, SSR + streaming) |
| Routing | TanStack Router — file-based, typed params, loader-driven |
| Server state | TanStack Query, hydrated from route loaders |
| API client | Eden Treaty (`treaty<App>(...)`) — types flow from Elysia, no codegen |
| Auth client | `better-auth/react` |
| Forms | TanStack Form + typebox schemas from `packages/shared` |
| Tables | TanStack Table (points list, standings, pool browser) |
| Styling | Tailwind + a small hand-rolled component layer |

## Dev ports

The web dev server binds **5173**, from `WEB_PORT`. TanStack Start's vite dev
server defaults to 3000, which the API already owns, so `vite.config.ts` sets
`server.port` (and `preview.port`) explicitly — no default fallback to 3000.
`WEB_ORIGIN` on the API side must match, or CORS and auth cookies break.

Eden + Query is the pairing that earns TanStack here: `queryFn` calls
`api.leagues({id}).teams.get()` and the response type is the server's response
type, with no generated client and no drift.

## Route tree

```
/                                  landing, public league directory
/login  /signup  /verify
/leagues/new
/leagues/$slug                     shell: nav + league context
  /                                overview: next match, standings snippet, recent activity
  /draft                           draft room (live board or async turn view)
  /teams                           all teams grid
  /teams/$memberId                 team visualizer
  /pool                            draftable pool browser + points
  /schedule                        weeks, matchups, report dialog
  /standings
  /playoffs                        bracket
  /transactions                    trade log + builder
  /settings                        host-only: rules, points import, members, season/playoff generation
/me                                profile, showdown username, my leagues
```

Loaders prefetch into the Query cache so SSR renders with data and the client
hydrates without a second fetch.

## Real-time integration

One `useLeagueSocket(leagueId)` hook opens phase 0's multiplexed WS and routes
messages into the Query cache:

```ts
onMessage(({ topic, type, payload }) => {
  if (topic === 'draft')        applyDraftEvent(queryClient, payload)
  if (topic === 'transactions') queryClient.invalidateQueries(txKeys(leagueId))
  if (topic === 'results')      queryClient.invalidateQueries(standingsKeys(leagueId))
})
```

Draft events apply *through the shared reducer* from `packages/draft` rather
than invalidating — the board updates instantly and the client can't disagree
with the server about the rules. Everything else invalidates, which is cheaper
to reason about and fast enough.

Reconnect: the hook tracks `seq`, resubscribes with it, and falls back to a
snapshot refetch on a gap.

## Screens that matter

### Draft room

The screen the product lives or dies on.

- Left: pool browser — search, filter (type, cost, BST, tier), sort;
  affordability and legality computed client-side from the same engine, so
  illegal picks are visibly disabled rather than rejected after a click
- Center: the board — round × player grid, filling in live, current pick
  highlighted, timer counting down
- Right: my team (budget bar, roster slots), my queue (drag to rank), event log
- Async mode swaps the timer for a "you're on the clock, X hours left" banner
  and makes the queue the primary interaction
- Optimistic pick with rollback on 409 — someone sniping your mon must feel
  immediate, not laggy

Keyboard: `/` focus search, `enter` pick highlighted, `q` queue it.

### Team visualizer

- Roster grid: animated sprite, cost, types, base stats bar, K/D record
- Defensive coverage matrix — the scouting tool, color-coded per type
- Speed tier chart with league-wide markers
- Spend breakdown and remaining budget
- Showdown export button (copies paste to clipboard)

### Schedule & reporting

- Week strip navigation; match cards with both teams' logos
- Report dialog: winner, score, replay URL. Paste a replay → live parse
  preview showing per-mon K/D before submit
- Confirm/dispute inline for the opponent

### Points import (host)

- Drop a `.yml` → preview table: resolved / illegal / unknown with suggestions
- Diff view vs. current list (added, removed, repriced)
- Commit is a distinct, deliberate button showing counts

### Bracket

- SVG tree, byes and seeds rendered before play, winners advancing with a
  highlighted path to the champion
- Horizontal scroll container on narrow screens (the tree must never blow out
  the page)

## Design direction

**Invoke the `/frontend-design` skill before writing any UI code.** Every
screen in this phase goes through it — it exists precisely to stop the generic
AI-dashboard look, which is the default failure mode for an unattended build.

Pokédex energy without cosplaying Nintendo: dark-first surfaces, type colors
as the accent system (they're already a familiar visual language), animated
sprites from `@pkmn/img` used generously since they're the product's texture.
Dense data tables that stay readable — this is a spreadsheet replacement, and
losing information density would be losing the point.

Establish the design system **once**, before any screen: color tokens, type
color map, spacing scale, typography, and the core primitives (Card, Table,
Badge, StatBar, SpriteAvatar, TypeChip, Dialog). Every later screen composes
those primitives. Building screens first and extracting a system later
produces eleven inconsistent pages.

Responsive: the draft room is desktop-first (three panes) and collapses to
tabbed panes on mobile; everything else is mobile-usable, since half of async
drafting happens on a phone.

Accessibility: type colors always paired with a text label, never color alone;
the draft board is keyboard-navigable; timers announce via `aria-live`.

## Testing

- Component tests for the pool filter and coverage matrix (pure render logic)
- Playwright happy paths: sign up → create league → import points → invite →
  draft a mon → report a match → propose a trade
- A draft-room test with two browser contexts asserting both see the same board
  after a pick

## Acceptance criteria

- No API response type is declared by hand in the frontend — all inferred from
  Eden
- A live draft with 8 concurrent clients stays in sync through picks, timeouts,
  and a forced disconnect/reconnect
- Every spreadsheet tab has a screen that replaces it
- Lighthouse: usable on a mid-range phone over 4G for non-draft screens

## Build order

1. Auth shell + league directory + create/join (needs phase 3)
2. Pool browser + points import (phases 2–3)
3. Draft room (phase 4) — the big one
4. Teams + visualizer (phase 5)
5. Schedule, reporting, standings (phase 6)
6. Bracket (phase 7)
7. Trades (phase 8)
8. Polish: notifications, profile, empty states, error states
