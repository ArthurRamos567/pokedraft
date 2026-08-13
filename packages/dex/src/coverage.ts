import type { GenerationNum } from '@pkmn/dex'
import { gen, toID } from './gens'

/** `???` and `Stellar` are engine constructs, not types a Pokémon can be. */
const PSEUDO_TYPES = new Set(['???', 'Stellar'])

/**
 * The chart is generation-aware on purpose: Steel resisted Ghost and Dark
 * before gen 6, and Fairy doesn't exist before it. Hardcoding gen 9 would
 * quietly lie in an old-gen league.
 */
export function typeNames(genNum: GenerationNum = 9): string[] {
  return [...gen(genNum).types].map((t) => t.name).filter((n) => !PSEUDO_TYPES.has(n))
}

/** Multiplier of one attacking type against one defending type. */
export function singleEffectiveness(
  attacking: string,
  defending: string,
  genNum: GenerationNum = 9,
): number {
  const atk = gen(genNum).types.get(toID(attacking))
  if (!atk) return 1
  return atk.effectiveness[defending as keyof typeof atk.effectiveness] ?? 1
}

/** Multiplier against a full (mono- or dual-type) defender. */
export function effectiveness(
  attacking: string,
  defenderTypes: readonly string[],
  genNum: GenerationNum = 9,
): number {
  let mult = 1
  for (const d of defenderTypes) mult *= singleEffectiveness(attacking, d, genNum)
  return mult
}

/** What every attacking type does to this defender. */
export function defensiveProfile(
  defenderTypes: readonly string[],
  genNum: GenerationNum = 9,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const atk of typeNames(genNum)) out[atk] = effectiveness(atk, defenderTypes, genNum)
  return out
}

export type TeamDefense = Record<
  string,
  { weak: number; neutral: number; resist: number; immune: number }
>

/**
 * Per attacking type, how the roster as a whole answers it. This is the
 * "which type wipes my team" view the visualizer draws.
 */
export function teamDefense(
  roster: readonly (readonly string[])[],
  genNum: GenerationNum = 9,
): TeamDefense {
  const out: TeamDefense = {}
  for (const atk of typeNames(genNum)) {
    const bucket = { weak: 0, neutral: 0, resist: 0, immune: 0 }
    for (const types of roster) {
      const m = effectiveness(atk, types, genNum)
      if (m === 0) bucket.immune++
      else if (m > 1) bucket.weak++
      else if (m < 1) bucket.resist++
      else bucket.neutral++
    }
    out[atk] = bucket
  }
  return out
}

export type OffensiveCoverage = Record<string, { best: number; from: string[] }>

/**
 * Given the attacking types available to a team, the best multiplier each
 * defending type takes — the gaps are what a draft is trying to close.
 */
export function offensiveCoverage(
  attackingTypes: readonly string[],
  genNum: GenerationNum = 9,
): OffensiveCoverage {
  const out: OffensiveCoverage = {}
  for (const def of typeNames(genNum)) {
    let best = 0
    let from: string[] = []
    for (const atk of attackingTypes) {
      const m = singleEffectiveness(atk, def, genNum)
      if (m > best) {
        best = m
        from = [atk]
      } else if (m === best && m > 0) {
        from.push(atk)
      }
    }
    out[def] = { best, from }
  }
  return out
}
