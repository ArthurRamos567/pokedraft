import type { GenerationNum, Species } from '@pkmn/dex'
import { dexFor, genOfFormat, toID } from './gens'

export type { Species }

export type SpeciesCard = {
  id: string
  name: string
  num: number
  types: string[]
  abilities: string[]
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
  bst: number
  tier: string | null
  baseSpecies: string | null
  forme: string | null
}

export type SpeciesDetail = SpeciesCard & {
  weightkg: number
  eggGroups: string[]
  prevo: string | null
  evos: string[]
  /** The whole line, base first, for the visualizer's evolution strip. */
  evolutionLine: string[]
  isCosmeticForme: boolean
  /** Sibling formes of the same base species, cosmetic ones excluded. */
  otherFormes: string[]
  genIntroduced: number
  /** `Past`, `Unobtainable`, … — legal only where the rule table readmits it. */
  nonstandard: string | null
}

export function toCard(s: Species): SpeciesCard {
  return {
    id: s.id,
    name: s.name,
    num: s.num,
    types: [...s.types],
    abilities: Object.values(s.abilities).filter(Boolean) as string[],
    baseStats: { ...s.baseStats },
    bst: s.bst,
    tier: s.tier ?? null,
    baseSpecies: s.baseSpecies === s.name ? null : s.baseSpecies,
    forme: s.forme || null,
  }
}

export function getSpecies(id: string, genNum: GenerationNum = 9): Species | null {
  const s = dexFor(genNum).species.get(toID(id))
  // An older generation's dex still answers for later mons; a gen-9 species
  // does not exist in gen 8 and must not resolve there.
  if (!s?.exists || s.gen > genNum) return null
  return s
}

export function getSpeciesForFormat(id: string, formatId: string): Species | null {
  return getSpecies(id, genOfFormat(formatId))
}

/**
 * Cosmetic formes (Gastrodon-East) carry the same stats, typing and movepool
 * as their base and must collapse. Functional formes (Rotom-Wash) must not.
 * @pkmn's own `isCosmeticForme` flag misses a few, so the base species'
 * `cosmeticFormes` list is the second opinion.
 */
export function isCosmeticForme(s: Species, genNum: GenerationNum = 9): boolean {
  if (s.isCosmeticForme) return true
  if (!s.baseSpecies || s.baseSpecies === s.name) return false
  const base = dexFor(genNum).species.get(toID(s.baseSpecies))
  return Array.isArray(base?.cosmeticFormes) && base.cosmeticFormes.includes(s.name)
}

/** Collapses a cosmetic forme onto its base; leaves functional formes alone. */
export function canonicalize(s: Species, genNum: GenerationNum = 9): Species {
  if (!isCosmeticForme(s, genNum)) return s
  return dexFor(genNum).species.get(toID(s.baseSpecies)) ?? s
}

export function evolutionLine(s: Species, genNum: GenerationNum = 9): string[] {
  const dex = dexFor(genNum)
  let root: Species = s
  const guard = new Set<string>()
  while (root.prevo && !guard.has(root.id)) {
    guard.add(root.id)
    const prev = dex.species.get(toID(root.prevo))
    if (!prev?.exists) break
    root = prev
  }
  const line: string[] = []
  const walk = (cur: Species) => {
    line.push(cur.name)
    for (const e of cur.evos ?? []) {
      const next = dex.species.get(toID(e))
      if (next?.exists && !line.includes(next.name)) walk(next)
    }
  }
  walk(root)
  return line
}

export function toDetail(s: Species, genNum: GenerationNum = 9): SpeciesDetail {
  const dex = dexFor(genNum)
  const base = s.baseSpecies ? dex.species.get(toID(s.baseSpecies)) : undefined
  const siblings = (base?.formeOrder ?? s.formeOrder ?? [])
    .filter((n) => n !== s.name)
    .filter((n) => {
      const sp = dex.species.get(toID(n))
      return sp?.exists ? !isCosmeticForme(sp, genNum) : false
    })

  return {
    ...toCard(s),
    weightkg: s.weightkg,
    eggGroups: [...(s.eggGroups ?? [])],
    prevo: s.prevo ?? null,
    evos: [...(s.evos ?? [])],
    evolutionLine: evolutionLine(s, genNum),
    isCosmeticForme: isCosmeticForme(s, genNum),
    otherFormes: siblings,
    genIntroduced: s.gen,
    nonstandard: s.isNonstandard ?? null,
  }
}

/**
 * Every species the generation's data knows about, Past-flagged ones included.
 * Filtering to what a format allows is `legality.ts`'s job, not this one's.
 */
export function allSpecies(genNum: GenerationNum = 9): Species[] {
  return dexFor(genNum)
    .species.all()
    .filter((s) => s.exists && s.gen <= genNum)
}
