import { affordableSpecies } from './select'
import type { DraftState, MemberId, SpeciesId } from './types'
import { canPick } from './validate'

export type AutopickPolicy = 'skip' | 'queue_then_skip' | 'queue_then_best'

export type AutopickChoice =
  | { action: 'pick'; speciesId: SpeciesId; reason: 'queue' | 'best' }
  | { action: 'skip' }

/**
 * Queue first, then the best affordable mon, then skip — in that order, and
 * only as far as the league's policy allows.
 *
 * "Best" is the most expensive thing the team can legally take: with a points
 * list, price is the league's own statement of value, so spending the budget
 * is a better default than hoarding it.
 */
export function autopick(
  state: DraftState,
  memberId: MemberId,
  queue: readonly SpeciesId[],
  policy: AutopickPolicy,
): AutopickChoice {
  if (policy === 'skip') return { action: 'skip' }

  for (const speciesId of queue) {
    if (canPick(state, memberId, speciesId).ok) {
      return { action: 'pick', speciesId, reason: 'queue' }
    }
  }

  if (policy === 'queue_then_best') {
    // `affordableSpecies` is already sorted most expensive first; the full
    // check still runs because reachability can rule out the top of that list.
    for (const candidate of affordableSpecies(state, memberId)) {
      if (canPick(state, memberId, candidate.speciesId).ok) {
        return { action: 'pick', speciesId: candidate.speciesId, reason: 'best' }
      }
    }
  }

  return { action: 'skip' }
}
