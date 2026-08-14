import type { Species } from '@pkmn/dex'
import { genOfFormat, toID } from './gens'
import { formatPool } from './legality'
import { allSpecies, type SpeciesCard, toCard } from './species'

export type SpeciesQuery = {
  format?: string
  q?: string
  type?: string
  ability?: string
  minBst?: number
  maxBst?: number
  sort?: 'num' | 'name' | 'bst' | 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
  /** Cosmetic formes are noise in a draft pool; drop them unless asked. */
  includeCosmetic?: boolean
}

const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const
type StatKey = (typeof statKeys)[number]

function sortValue(card: SpeciesCard, key: NonNullable<SpeciesQuery['sort']>): number | string {
  if (key === 'num') return card.num
  if (key === 'name') return card.name
  if (key === 'bst') return card.bst
  return card.baseStats[key as StatKey]
}

export function searchSpecies(query: SpeciesQuery = {}): {
  items: SpeciesCard[]
  total: number
  limit: number
  offset: number
} {
  const genNum = genOfFormat(query.format ?? 'gen9ou')
  const pool = query.format ? formatPool(query.format) : null

  const q = query.q ? toID(query.q) : null
  const type = query.type?.toLowerCase()
  const ability = query.ability ? toID(query.ability) : null

  const matches = (s: Species): boolean => {
    if (pool && !pool.has(s.id)) return false
    if (!query.includeCosmetic && s.isCosmeticForme) return false
    if (q && !s.id.includes(q)) return false
    if (type && !s.types.some((t) => t.toLowerCase() === type)) return false
    if (ability && !Object.values(s.abilities).some((a) => toID(a ?? '') === ability)) return false
    return true
  }

  const cards: SpeciesCard[] = []
  for (const s of allSpecies(genNum)) {
    if (!matches(s)) continue
    const card = toCard(s, query.format)
    if (query.minBst !== undefined && card.bst < query.minBst) continue
    if (query.maxBst !== undefined && card.bst > query.maxBst) continue
    cards.push(card)
  }

  const sort = query.sort ?? 'num'
  const dir = query.dir ?? (sort === 'num' || sort === 'name' ? 'asc' : 'desc')
  cards.sort((a, b) => {
    const va = sortValue(a, sort)
    const vb = sortValue(b, sort)
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
    return dir === 'asc' ? cmp : -cmp
  })

  // A prefix hit is what someone typing "lando" means; rank those first.
  if (q) {
    cards.sort((a, b) => Number(b.id.startsWith(q)) - Number(a.id.startsWith(q)))
  }

  const limit = Math.min(query.limit ?? 50, 200)
  const offset = query.offset ?? 0
  return { items: cards.slice(offset, offset + limit), total: cards.length, limit, offset }
}
