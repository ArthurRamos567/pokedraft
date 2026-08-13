import type { Species } from '@pkmn/dex'
import { getRuleTable, getSimFormat } from './formats'
import { genOfFormat, toID } from './gens'
import { allSpecies, getSpecies } from './species'

/**
 * Draftability, not battle legality. Complex clauses (Species Clause, Item
 * Clause) constrain how a team is built for a battle; they never make a mon
 * undraftable, so they are surfaced as league info text instead.
 */
export type LegalityResult =
  | { legal: true }
  | { legal: false; reason: 'unknown_species' | 'not_in_generation' | 'banned' | 'nonstandard' }

const LEGAL: LegalityResult = { legal: true }

export function checkLegality(speciesId: string, formatId: string): LegalityResult {
  const genNum = genOfFormat(formatId)
  const s = getSpecies(speciesId, genNum)
  if (!s) return { legal: false, reason: 'unknown_species' }
  if (s.gen > genNum) return { legal: false, reason: 'not_in_generation' }

  const table = getRuleTable(formatId)
  if (!getSimFormat(formatId) || !table) return LEGAL

  // Past/Unobtainable entries are dead everywhere except formats that
  // explicitly readmit their tag — this is how National Dex gets its Megas
  // back without a second dataset.
  if (s.isNonstandard && !table.has(`+pokemontag:${toID(s.isNonstandard)}`)) {
    return { legal: false, reason: 'nonstandard' }
  }
  if (table.isBannedSpecies(s as unknown as Parameters<typeof table.isBannedSpecies>[0])) {
    return { legal: false, reason: 'banned' }
  }
  return LEGAL
}

export const isLegal = (speciesId: string, formatId: string) =>
  checkLegality(speciesId, formatId).legal

const pools = new Map<string, Set<string>>()

/**
 * The legal species set for a format, built on first use and cached forever.
 * Draft-time legality is then a set membership test, not a rule-table walk.
 */
export function formatPool(formatId: string): Set<string> {
  const key = toID(formatId)
  const cached = pools.get(key)
  if (cached) return cached

  const genNum = genOfFormat(formatId)
  const set = new Set<string>()
  for (const s of allSpecies(genNum)) {
    if (checkLegality(s.id, formatId).legal) set.add(s.id)
  }
  pools.set(key, set)
  return set
}

export function inPool(speciesId: string, formatId: string): boolean {
  return formatPool(formatId).has(toID(speciesId))
}

/** Legal species for a format as full objects, sorted by dex number. */
export function poolSpecies(formatId: string): Species[] {
  const genNum = genOfFormat(formatId)
  const out: Species[] = []
  for (const id of formatPool(formatId)) {
    const s = getSpecies(id, genNum)
    if (s) out.push(s)
  }
  return out.sort((a, b) => a.num - b.num || a.name.localeCompare(b.name))
}
