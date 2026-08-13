import { emptyTeam } from './select'
import {
  type DraftConfig,
  type DraftEvent,
  type DraftState,
  InvalidEvent,
  type MemberId,
  type TeamState,
} from './types'

export function initialState(config: DraftConfig, order: MemberId[] = []): DraftState {
  return {
    status: 'pending',
    config,
    order,
    round: 0,
    pickNo: 0,
    onClock: null,
    deadline: null,
    taken: {},
    teams: Object.fromEntries(order.map((m) => [m, emptyTeam()])),
    complete: [],
  }
}

const cloneTeam = (t: TeamState | undefined): TeamState =>
  t ? { picks: [...t.picks], spent: t.spent, skips: t.skips } : emptyTeam()

/**
 * Total: every event either advances the state or throws `InvalidEvent`.
 * Nothing here reads the clock — an event carries its own `at`, which is what
 * makes replay deterministic and the tests boring.
 */
export function apply(state: DraftState, event: DraftEvent): DraftState {
  switch (event.type) {
    case 'DRAFT_STARTED': {
      if (state.status !== 'pending') throw new InvalidEvent(event, 'draft has already started')
      return {
        ...initialState(event.config, event.order),
        status: 'active',
      }
    }

    case 'ORDER_CHANGED': {
      if (state.status !== 'pending') {
        throw new InvalidEvent(event, 'the order is fixed once the draft starts')
      }
      return {
        ...state,
        order: event.order,
        teams: Object.fromEntries(event.order.map((m) => [m, state.teams[m] ?? emptyTeam()])),
      }
    }

    case 'PICK_MADE': {
      if (state.status !== 'active') throw new InvalidEvent(event, `draft is ${state.status}`)
      if (event.speciesId in state.taken) throw new InvalidEvent(event, 'species already taken')
      if (event.pickNo !== state.pickNo) {
        throw new InvalidEvent(event, `expected pickNo ${state.pickNo}, got ${event.pickNo}`)
      }
      const team = cloneTeam(state.teams[event.memberId])
      team.picks.push({
        speciesId: event.speciesId,
        cost: event.cost,
        round: state.round,
        pickNo: event.pickNo,
        auto: event.auto !== undefined,
      })
      team.spent += event.cost
      return {
        ...state,
        pickNo: state.pickNo + 1,
        taken: { ...state.taken, [event.speciesId]: event.memberId },
        teams: { ...state.teams, [event.memberId]: team },
      }
    }

    case 'TURN_SKIPPED': {
      if (state.status !== 'active') throw new InvalidEvent(event, `draft is ${state.status}`)
      const team = cloneTeam(state.teams[event.memberId])
      team.skips += 1
      return { ...state, teams: { ...state.teams, [event.memberId]: team } }
    }

    case 'TURN_ADVANCED': {
      if (state.status !== 'active') throw new InvalidEvent(event, `draft is ${state.status}`)
      return { ...state, onClock: event.onClock, round: event.round, deadline: event.deadline }
    }

    case 'TEAM_FINISHED': {
      if (state.complete.includes(event.memberId)) return state
      return { ...state, complete: [...state.complete, event.memberId] }
    }

    case 'DRAFT_PAUSED': {
      if (state.status !== 'active') throw new InvalidEvent(event, `draft is ${state.status}`)
      // The deadline is dropped rather than remembered: on resume it is
      // recomputed from the resume moment, so a pause never eats a player's clock.
      return { ...state, status: 'paused', deadline: null }
    }

    case 'DRAFT_RESUMED': {
      if (state.status !== 'paused') throw new InvalidEvent(event, `draft is ${state.status}`)
      return { ...state, status: 'active' }
    }

    case 'DRAFT_COMPLETED': {
      return { ...state, status: 'complete', onClock: null, deadline: null }
    }

    case 'PICK_UNDONE': {
      // Undo is truncate-and-replay at the persistence layer; inverting a fold
      // in place is where subtle corruption lives. Seeing one here means the
      // caller took the wrong path.
      throw new InvalidEvent(event, 'undo is performed by replaying a truncated log')
    }
  }
}

export function replay(events: readonly DraftEvent[], seed?: DraftState): DraftState {
  let state =
    seed ??
    initialState(
      { type: 'snake', budget: 0, rosterMin: 0, rosterMax: 0, allowUndrafted: true, points: {} },
      [],
    )
  for (const event of events) state = apply(state, event)
  return state
}
