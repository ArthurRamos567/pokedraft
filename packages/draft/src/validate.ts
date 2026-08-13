import { cheapestCosts, remainingBudget, rosterSize } from './select'
import type { DraftState, MemberId, SpeciesId, ValidationResult } from './types'

/**
 * The eight checks, in order — the first failure wins, so the message a player
 * sees is the most specific reason rather than whichever check ran last.
 */
export function canPick(
  state: DraftState,
  memberId: MemberId,
  speciesId: SpeciesId,
  opts: { asHost?: boolean } = {},
): ValidationResult {
  if (state.status !== 'active') {
    return { ok: false, code: 'DRAFT_NOT_ACTIVE', message: `the draft is ${state.status}` }
  }

  if (state.onClock !== memberId) {
    return { ok: false, code: 'NOT_YOUR_TURN', message: 'it is not this team’s turn' }
  }
  // `asHost` lets a host pick for an absent player; it never bypasses the
  // turn — a host forcing a pick still picks for whoever is on the clock.
  void opts.asHost

  const entry = state.config.points[speciesId]
  if (!entry) {
    return {
      ok: false,
      code: 'SPECIES_NOT_IN_POOL',
      message: 'that species is not on this league’s points list',
    }
  }
  if (entry.banned) {
    return { ok: false, code: 'SPECIES_BANNED', message: 'that species is banned in this league' }
  }

  const takenBy = state.taken[speciesId]
  if (takenBy) {
    return {
      ok: false,
      code: 'SPECIES_ALREADY_PICKED',
      message: 'that species is already drafted',
      details: { memberId: takenBy },
    }
  }

  const budget = remainingBudget(state, memberId)
  if (entry.points > budget) {
    return {
      ok: false,
      code: 'INSUFFICIENT_POINTS',
      message: `that costs ${entry.points} and you have ${budget}`,
      details: { cost: entry.points, budget },
    }
  }

  const size = rosterSize(state, memberId)
  if (size >= state.config.rosterMax) {
    return { ok: false, code: 'ROSTER_FULL', message: 'your roster is already full' }
  }

  // Reachability. Without it a player spends everything on two monsters and
  // then cannot field a legal team — discovered rounds later, when it is far
  // too late to fix.
  const slotsAfter = state.config.rosterMin - (size + 1)
  if (slotsAfter > 0) {
    const after: DraftState = {
      ...state,
      taken: { ...state.taken, [speciesId]: memberId },
    }
    const cheapest = cheapestCosts(after, slotsAfter)
    if (cheapest.length < slotsAfter) {
      return {
        ok: false,
        code: 'ROSTER_UNREACHABLE',
        message: 'not enough undrafted species remain to fill a legal roster',
        details: { needed: slotsAfter, available: cheapest.length },
      }
    }
    const floor = cheapest.reduce((a, b) => a + b, 0)
    if (budget - entry.points < floor) {
      return {
        ok: false,
        code: 'ROSTER_UNREACHABLE',
        message: `that would leave ${budget - entry.points} for ${slotsAfter} more picks, and the cheapest cost ${floor}`,
        details: { remainingAfter: budget - entry.points, minimumNeeded: floor, slots: slotsAfter },
      }
    }
  }

  return { ok: true, cost: entry.points }
}

/**
 * Why a team is done, or null if it can still pick. Checked after every pick
 * so the clock never returns to a team with nothing left to do.
 */
export function finishReason(
  state: DraftState,
  memberId: MemberId,
): 'roster_full' | 'budget_out' | null {
  if (rosterSize(state, memberId) >= state.config.rosterMax) return 'roster_full'

  const budget = remainingBudget(state, memberId)
  const cheapest = cheapestCosts(state, 1)[0]
  if (cheapest === undefined || cheapest > budget) return 'budget_out'

  // A team that cannot reach `rosterMin` from here is stuck rather than done,
  // but the clock still has to move on.
  const slotsLeft = state.config.rosterMin - rosterSize(state, memberId)
  if (slotsLeft > 0) {
    const floor = cheapestCosts(state, slotsLeft)
    if (floor.length < slotsLeft || floor.reduce((a, b) => a + b, 0) > budget) return 'budget_out'
  }
  return null
}
