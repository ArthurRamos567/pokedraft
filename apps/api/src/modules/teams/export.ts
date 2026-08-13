import { Sets } from '@pkmn/sets'
import { getSpeciesForFormat } from '@pokedraft/dex'
import type { RosterEntry } from './roster'

/**
 * A paste skeleton: species, ability, nothing else. Enough to drop into the
 * teambuilder and fill in. Recommending moves and spreads from usage data is a
 * different product, deliberately not this one.
 */
export function exportShowdown(entries: RosterEntry[], formatId: string): string {
  const blocks: string[] = []
  for (const entry of entries) {
    const s = getSpeciesForFormat(entry.speciesId, formatId)
    if (!s) continue
    blocks.push(
      Sets.exportSet({
        species: s.name,
        ability: Object.values(s.abilities)[0] ?? undefined,
        moves: [],
      }),
    )
  }
  return blocks.join('\n')
}
