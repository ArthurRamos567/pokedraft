import type { GenerationNum } from '@pkmn/dex'
import { gen, genOfFormat, toID } from './gens'

export type MoveCard = {
  id: string
  name: string
  type: string
  category: 'Physical' | 'Special' | 'Status'
  basePower: number
  accuracy: number | true
  pp: number
  priority: number
  target: string
  shortDesc: string
}

export function getMove(id: string, genNum: GenerationNum = 9): MoveCard | null {
  const m = gen(genNum).moves.get(toID(id))
  if (!m?.exists) return null
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    category: m.category,
    basePower: m.basePower,
    accuracy: m.accuracy,
    pp: m.pp,
    priority: m.priority,
    target: m.target,
    shortDesc: m.shortDesc,
  }
}

export type AbilityCard = {
  id: string
  name: string
  shortDesc: string
  desc: string
}

export function getAbility(id: string, genNum: GenerationNum = 9): AbilityCard | null {
  const a = gen(genNum).abilities.get(toID(id))
  if (!a?.exists) return null
  return { id: a.id, name: a.name, shortDesc: a.shortDesc, desc: a.desc }
}

/**
 * `learnable()` walks forme and prevo inheritance, which the raw learnset
 * entry does not — Landorus-Therian's own entry is empty.
 */
export async function movePool(speciesId: string, formatId = 'gen9ou'): Promise<MoveCard[]> {
  const genNum = genOfFormat(formatId)
  const g = gen(genNum)
  const learnable = await g.learnsets.learnable(toID(speciesId))
  if (!learnable) return []

  const out: MoveCard[] = []
  for (const moveId of Object.keys(learnable)) {
    const card = getMove(moveId, genNum)
    if (card) out.push(card)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
