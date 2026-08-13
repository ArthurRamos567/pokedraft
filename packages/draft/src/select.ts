import type { DraftState, MemberId, SpeciesId } from './types'

export const emptyTeam = () => ({ picks: [], spent: 0, skips: 0 })

export function teamOf(state: DraftState, memberId: MemberId) {
  return state.teams[memberId] ?? emptyTeam()
}

export function remainingBudget(state: DraftState, memberId: MemberId): number {
  return state.config.budget - teamOf(state, memberId).spent
}

export function rosterSize(state: DraftState, memberId: MemberId): number {
  return teamOf(state, memberId).picks.length
}

export function rosterOf(state: DraftState, memberId: MemberId): SpeciesId[] {
  return teamOf(state, memberId).picks.map((p) => p.speciesId)
}

export function costOf(state: DraftState, speciesId: SpeciesId): number | null {
  return state.config.points[speciesId]?.points ?? null
}

export function isTaken(state: DraftState, speciesId: SpeciesId): boolean {
  return speciesId in state.taken
}

/** Every species still on the board, cheapest last. */
export function availableSpecies(state: DraftState): { speciesId: SpeciesId; points: number }[] {
  const out: { speciesId: SpeciesId; points: number }[] = []
  for (const [speciesId, entry] of Object.entries(state.config.points)) {
    if (entry.banned) continue
    if (speciesId in state.taken) continue
    out.push({ speciesId, points: entry.points })
  }
  return out.sort((a, b) => b.points - a.points || a.speciesId.localeCompare(b.speciesId))
}

/**
 * What a member could actually take right now. The API returns this so the
 * client never reimplements affordability.
 */
export function affordableSpecies(
  state: DraftState,
  memberId: MemberId,
): { speciesId: SpeciesId; points: number }[] {
  const budget = remainingBudget(state, memberId)
  return availableSpecies(state).filter((s) => s.points <= budget)
}

/** Ascending costs of what's left — the input to the reachability check. */
export function cheapestCosts(state: DraftState, count: number): number[] {
  if (count <= 0) return []
  const costs = availableSpecies(state)
    .map((s) => s.points)
    .sort((a, b) => a - b)
  return costs.slice(0, count)
}

export function isFinished(state: DraftState, memberId: MemberId): boolean {
  return state.complete.includes(memberId)
}

export function totalPicks(state: DraftState): number {
  return Object.keys(state.taken).length
}
