import { type Generation, Generations } from '@pkmn/data'
import type { GenerationNum, ID } from '@pkmn/dex'
import { Dex, toID } from '@pkmn/dex'

export type { Generation, GenerationNum, ID }
export { Dex, toID }

/**
 * Two views of the same data, on purpose.
 *
 * `Dex.forGen(n)` is the *whole* dex for a generation, Past-flagged entries
 * included — Mega Venusaur still exists in gen 9 data, it's just illegal in
 * standard play. National Dex leagues need exactly those, so legality is
 * decided by the format's rule table rather than by hiding rows.
 *
 * `gens` (@pkmn/data) is only used where its async learnset walking and type
 * chart are worth having; its species iterator filters Past out.
 */
export const gens = new Generations(Dex)

export const LATEST_GEN = 9 as GenerationNum

export function dexFor(genNum: GenerationNum = LATEST_GEN) {
  return Dex.forGen(genNum)
}

export function gen(num: GenerationNum = LATEST_GEN): Generation {
  return gens.get(num)
}

/** `gen9ou` → 9, `gen8nationaldex` → 8. Falls back to the latest gen. */
export function genOfFormat(formatId: string): GenerationNum {
  const m = /^gen(\d+)/.exec(formatId)
  if (!m?.[1]) return LATEST_GEN
  const n = Number(m[1])
  return n >= 1 && n <= LATEST_GEN ? (n as GenerationNum) : LATEST_GEN
}

export function genForFormat(formatId: string): Generation {
  return gen(genOfFormat(formatId))
}
