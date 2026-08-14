import {
  defensiveProfile,
  genOfFormat,
  getSpeciesForFormat,
  offensiveCoverage,
  type SpeciesCard,
  smogonUrl,
  teamDefense,
  toCard,
  typeNames,
} from '@pokedraft/dex'
import type { RosterEntry } from './roster'

export type TeamMon = SpeciesCard & {
  cost: number
  acquired: 'draft' | 'trade'
  /** The analysis for *this league's* format, not a generic dex entry. */
  smogonUrl: string
}

export function hydrateRoster(entries: RosterEntry[], formatId: string): TeamMon[] {
  const out: TeamMon[] = []
  for (const e of entries) {
    const s = getSpeciesForFormat(e.speciesId, formatId)
    if (!s) continue
    const card = toCard(s, formatId)
    out.push({
      ...card,
      cost: e.cost,
      acquired: e.acquired,
      smogonUrl: smogonUrl(card.name, formatId),
    })
  }
  return out
}

export function coverageFor(mons: TeamMon[], formatId: string) {
  const gen = genOfFormat(formatId)
  const defense = teamDefense(
    mons.map((m) => m.types),
    gen,
  )

  // STAB only. Coverage moves are a set-building decision, not a roster one,
  // and guessing at them would make this number fiction.
  const stab = [...new Set(mons.flatMap((m) => m.types))]
  const offense = offensiveCoverage(stab, gen)

  const perMon = mons.map((m) => ({
    speciesId: m.id,
    name: m.name,
    types: m.types,
    matchups: defensiveProfile(m.types, gen),
  }))

  const holes = Object.entries(defense)
    .filter(([, b]) => b.resist === 0 && b.immune === 0)
    .map(([type]) => type)

  return { types: typeNames(gen), defense, offense, perMon, holes, stab }
}

export type SpeedRow = {
  speciesId: string
  name: string
  base: number
  /** The numbers people actually compare at level 100, all at 31 IVs / 252 EVs… */
  neutral: number
  positive: number
  negative: number
  scarf: number
  /** …except this one: 0 IVs, 0 EVs, hindering nature — the Trick Room floor. */
  minimum: number
}

/** floor((2·base + IV + EV/4) · level/100 + 5), then the nature multiplier. */
const atLevel100 = (base: number, nature: number, iv = 31, ev = 252) =>
  Math.floor(Math.floor(((2 * base + iv + Math.floor(ev / 4)) * 100) / 100 + 5) * nature)

export function speedTiers(mons: TeamMon[]): SpeedRow[] {
  return mons
    .map((m) => {
      const base = m.baseStats.spe
      const positive = atLevel100(base, 1.1)
      return {
        speciesId: m.id,
        name: m.name,
        base,
        neutral: atLevel100(base, 1),
        positive,
        negative: atLevel100(base, 0.9),
        scarf: Math.floor(positive * 1.5),
        minimum: atLevel100(base, 0.9, 0, 0),
      }
    })
    .sort((a, b) => b.base - a.base || a.name.localeCompare(b.name))
}

export function statProfile(mons: TeamMon[]) {
  if (mons.length === 0) {
    return { bstAverage: 0, physical: 0, special: 0, mixed: 0, bulkiest: null, fastest: null }
  }
  const sum = mons.reduce((a, m) => a + m.bst, 0)
  let physical = 0
  let special = 0
  let mixed = 0
  for (const m of mons) {
    const diff = m.baseStats.atk - m.baseStats.spa
    if (diff > 15) physical++
    else if (diff < -15) special++
    else mixed++
  }
  const bulkiest = [...mons].sort(
    (a, b) =>
      b.baseStats.hp +
      b.baseStats.def +
      b.baseStats.spd -
      (a.baseStats.hp + a.baseStats.def + a.baseStats.spd),
  )[0]
  const fastest = [...mons].sort((a, b) => b.baseStats.spe - a.baseStats.spe)[0]

  return {
    bstAverage: Math.round(sum / mons.length),
    physical,
    special,
    mixed,
    bulkiest: bulkiest ? { speciesId: bulkiest.id, name: bulkiest.name } : null,
    fastest: fastest ? { speciesId: fastest.id, name: fastest.name } : null,
  }
}

export function spendProfile(mons: TeamMon[], budget: number) {
  const spent = mons.reduce((a, m) => a + m.cost, 0)
  const brackets: Record<string, number> = {}
  for (const m of mons) {
    const key = m.cost >= 18 ? '18+' : m.cost >= 12 ? '12-17' : m.cost >= 6 ? '6-11' : '0-5'
    brackets[key] = (brackets[key] ?? 0) + 1
  }
  return { spent, remaining: budget - spent, budget, brackets }
}

/**
 * Which opposing mons this team has no resist to. Only drafted mons count —
 * a threat nobody owns isn't a threat.
 */
export function threatList(mine: TeamMon[], theirs: TeamMon[], formatId: string) {
  const gen = genOfFormat(formatId)
  const out: { speciesId: string; name: string; types: string[]; unresisted: string[] }[] = []

  for (const threat of theirs) {
    const unresisted = threat.types.filter((atk) => {
      const anyResist = mine.some((m) => {
        const profile = defensiveProfile(m.types, gen)
        return (profile[atk] ?? 1) < 1
      })
      return !anyResist
    })
    if (unresisted.length > 0) {
      out.push({
        speciesId: threat.id,
        name: threat.name,
        types: threat.types,
        unresisted,
      })
    }
  }
  return out
}
