import { firstTurn, nextTurn } from './order'
import { apply, initialState } from './reduce'
import { rosterSize } from './select'
import type {
  DraftConfig,
  DraftEvent,
  DraftState,
  MemberId,
  SpeciesId,
  ValidationResult,
} from './types'
import { canPick, finishReason } from './validate'

export type CommandResult =
  | { ok: true; events: DraftEvent[]; state: DraftState; warnings: string[] }
  | { ok: false; error: Extract<ValidationResult, { ok: false }> }

/**
 * Every command returns the *whole* event sequence its move implies, so a
 * caller can never persist a PICK_MADE without the TURN_ADVANCED that belongs
 * with it. Server and client both fold the same list.
 */
function commit(state: DraftState, events: DraftEvent[], warnings: string[] = []): CommandResult {
  let next = state
  for (const e of events) next = apply(next, e)
  return { ok: true, events, state: next, warnings }
}

export function startDraft(
  state: DraftState,
  input: { order: MemberId[]; config: DraftConfig; at: number; deadline: number | null },
): CommandResult {
  const started: DraftEvent = {
    type: 'DRAFT_STARTED',
    at: input.at,
    order: input.order,
    config: input.config,
  }
  const seeded = apply(state, started)
  const first = firstTurn(seeded)
  const advance: DraftEvent = {
    type: 'TURN_ADVANCED',
    at: input.at,
    onClock: first?.onClock ?? null,
    round: first?.round ?? 0,
    deadline: first ? input.deadline : null,
  }
  return commit(state, [started, advance])
}

/**
 * Teams whose situation changed after a pick. Taking a species can price
 * *another* team out, so every team is re-checked rather than only the picker.
 */
function finishEvents(state: DraftState, at: number): DraftEvent[] {
  const events: DraftEvent[] = []
  for (const memberId of state.order) {
    if (state.complete.includes(memberId)) continue
    const reason = finishReason(state, memberId)
    if (reason) events.push({ type: 'TEAM_FINISHED', at, memberId, reason })
  }
  return events
}

function advanceOrComplete(
  state: DraftState,
  at: number,
  deadline: number | null,
): { events: DraftEvent[]; warnings: string[] } {
  const turn = nextTurn(state)
  if (turn) {
    return {
      events: [{ type: 'TURN_ADVANCED', at, onClock: turn.onClock, round: turn.round, deadline }],
      warnings: [],
    }
  }

  // Nobody left to pick. A league that requires full rosters still completes —
  // the host is told which teams came up short rather than left with a draft
  // that silently refuses to end.
  const warnings: string[] = []
  if (!state.config.allowUndrafted) {
    const short = state.order.filter((m) => rosterSize(state, m) < state.config.rosterMin)
    if (short.length > 0) {
      warnings.push(
        `these teams finished below the ${state.config.rosterMin}-mon minimum: ${short.join(', ')}`,
      )
    }
  }
  return { events: [{ type: 'DRAFT_COMPLETED', at }], warnings }
}

export function makePick(
  state: DraftState,
  input: {
    memberId: MemberId
    speciesId: SpeciesId
    at: number
    deadline: number | null
    auto?: 'queue' | 'best'
    asHost?: boolean
  },
): CommandResult {
  const check = canPick(state, input.memberId, input.speciesId, { asHost: input.asHost })
  if (!check.ok) return { ok: false, error: check }

  const pick: DraftEvent = {
    type: 'PICK_MADE',
    at: input.at,
    memberId: input.memberId,
    speciesId: input.speciesId,
    cost: check.cost,
    pickNo: state.pickNo,
    ...(input.auto ? { auto: input.auto } : {}),
  }

  let next = apply(state, pick)
  const finished = finishEvents(next, input.at)
  for (const e of finished) next = apply(next, e)

  const { events: tail, warnings } = advanceOrComplete(next, input.at, input.deadline)
  return commit(state, [pick, ...finished, ...tail], warnings)
}

export function skipTurn(
  state: DraftState,
  input: {
    memberId: MemberId
    at: number
    deadline: number | null
    reason: 'timeout' | 'manual'
    /** Ends the team's draft entirely rather than just this turn. */
    finish?: boolean
  },
): CommandResult {
  if (state.status !== 'active') {
    return {
      ok: false,
      error: { ok: false, code: 'DRAFT_NOT_ACTIVE', message: `the draft is ${state.status}` },
    }
  }
  if (state.onClock !== input.memberId) {
    return {
      ok: false,
      error: { ok: false, code: 'NOT_YOUR_TURN', message: 'it is not this team’s turn' },
    }
  }

  const skipped: DraftEvent = {
    type: 'TURN_SKIPPED',
    at: input.at,
    memberId: input.memberId,
    reason: input.reason,
  }
  let next = apply(state, skipped)

  const events: DraftEvent[] = [skipped]
  if (input.finish) {
    const done: DraftEvent = {
      type: 'TEAM_FINISHED',
      at: input.at,
      memberId: input.memberId,
      reason: 'manual',
    }
    events.push(done)
    next = apply(next, done)
  }

  const auto = finishEvents(next, input.at)
  for (const e of auto) next = apply(next, e)
  events.push(...auto)

  const { events: tail, warnings } = advanceOrComplete(next, input.at, input.deadline)
  return commit(state, [...events, ...tail], warnings)
}

export function pauseDraft(state: DraftState, at: number, reason?: string): CommandResult {
  return commit(state, [{ type: 'DRAFT_PAUSED', at, ...(reason ? { reason } : {}) }])
}

/** Resume recomputes the deadline from now — a pause never eats a player's clock. */
export function resumeDraft(state: DraftState, at: number, deadline: number | null): CommandResult {
  const resumed: DraftEvent = { type: 'DRAFT_RESUMED', at }
  const next = apply(state, resumed)
  return commit(state, [
    resumed,
    {
      type: 'TURN_ADVANCED',
      at,
      onClock: next.onClock,
      round: next.round,
      deadline,
    },
  ])
}

export { initialState }
