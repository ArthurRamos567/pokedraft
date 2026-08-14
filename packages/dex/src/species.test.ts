import { describe, expect, it } from 'bun:test'
import { movePool } from './learnsets'
import { formatPool } from './legality'
import { searchSpecies } from './search'
import {
  canonicalize,
  getSpecies,
  getSpeciesForFormat,
  isCosmeticForme,
  tierForFormat,
  toCard,
  toDetail,
} from './species'

describe('formes', () => {
  it('treats a cosmetic forme as cosmetic and collapses it', () => {
    const east = getSpecies('gastrodoneast')!
    expect(isCosmeticForme(east)).toBe(true)
    expect(String(canonicalize(east).id)).toBe('gastrodon')
  })

  it('leaves a functional forme alone', () => {
    for (const id of ['rotomwash', 'urshifurapidstrike', 'toxtricitylowkey']) {
      const s = getSpecies(id)!
      expect(isCosmeticForme(s), `${id} should not be cosmetic`).toBe(false)
      expect(String(canonicalize(s).id)).toBe(id)
    }
  })
})

describe('species detail', () => {
  it('carries every field the team visualizer needs', () => {
    const d = toDetail(getSpecies('landorustherian')!)
    expect(d.name).toBe('Landorus-Therian')
    expect(d.types).toEqual(['Ground', 'Flying'])
    expect(d.abilities).toEqual(['Intimidate'])
    expect(d.bst).toBe(600)
    expect(d.baseStats.spe).toBe(91)
    expect(d.weightkg).toBeGreaterThan(0)
    expect(d.tier).toBeTruthy()
    expect(d.baseSpecies).toBe('Landorus')
    expect(d.forme).toBe('Therian')
  })

  it('walks the whole evolution line from any member of it', () => {
    expect(toDetail(getSpecies('charmeleon')!).evolutionLine).toEqual([
      'Charmander',
      'Charmeleon',
      'Charizard',
    ])
  })

  it('lists sibling formes without the cosmetic ones', () => {
    const d = toDetail(getSpecies('rotomwash')!)
    expect(d.otherFormes).toContain('Rotom-Heat')
    expect(d.otherFormes).not.toContain('Rotom-Wash')
  })
})

/**
 * The tier a card shows has to be the tier of the league's own metagame. A
 * National Dex league that reads the SV singles column labels half its pool
 * `Illegal`, which is both wrong and the loudest thing on the row.
 */
describe('tier by format', () => {
  const tier = (id: string, format: string) =>
    tierForFormat(getSpeciesForFormat(id, format)!, format)

  it('reads the national dex column for a national dex format', () => {
    expect(tier('tapukoko', 'gen9ou')).toBe('Illegal')
    expect(tier('tapukoko', 'gen9nationaldex')).toBe('OU')
    expect(tier('kartana', 'gen8nationaldex')).toBe('OU')
  })

  it('reads the doubles column for doubles and VGC', () => {
    expect(tier('landorustherian', 'gen9doublesou')).toBe('DOU')
    expect(tier('landorustherian', 'gen9vgc2025regi')).toBe('DOU')
    expect(tier('landorustherian', 'gen9ou')).toBe('OU')
  })

  it('reads the generation the format is played in', () => {
    expect(tier('blissey', 'gen7ou')).toBe('UU')
    expect(tier('blissey', 'gen9ou')).toBe('RU')
    // Mega Charizard X was OU in SwSh National Dex and dropped in SV's.
    expect(tier('charizardmegax', 'gen8nationaldex')).toBe('OU')
    expect(tier('charizardmegax', 'gen9nationaldex')).toBe('UUBL')
  })

  it('flows through the card the API actually returns', () => {
    const s = getSpeciesForFormat('charizardmegax', 'gen8nationaldex')!
    expect(toCard(s, 'gen8nationaldex').tier).toBe('OU')
    expect(toCard(s, 'gen8ou').tier).toBe('Illegal')
  })
})

describe('search', () => {
  it('ranks a prefix hit first', () => {
    const { items } = searchSpecies({ format: 'gen9ou', q: 'lando' })
    expect(items[0]?.id.startsWith('lando')).toBe(true)
  })

  it('filters by type and ability', () => {
    const { items } = searchSpecies({ format: 'gen9ou', type: 'Ghost', limit: 200 })
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.types.includes('Ghost'))).toBe(true)
  })

  it('sorts by a base stat', () => {
    const { items } = searchSpecies({ format: 'gen9ou', sort: 'spe', dir: 'desc', limit: 5 })
    const speeds = items.map((i) => i.baseStats.spe)
    expect([...speeds].sort((a, b) => b - a)).toEqual(speeds)
  })

  it('hides cosmetic formes from a draft pool', () => {
    const { items } = searchSpecies({ format: 'gen9ou', q: 'gastrodon', limit: 50 })
    expect(items.some((i) => i.id === 'gastrodoneast')).toBe(false)
  })
})

describe('learnsets', () => {
  it('resolves a forme move pool through inheritance', async () => {
    // Landorus-Therian's own learnset entry is empty — only `learnable()`
    // walks up to the base forme.
    const moves = await movePool('landorustherian', 'gen9nationaldex')
    expect(moves.length).toBeGreaterThan(50)
    expect(moves.some((m) => m.id === 'earthquake')).toBe(true)
  })

  it('returns typed move cards', async () => {
    const moves = await movePool('gholdengo', 'gen9ou')
    const shadowBall = moves.find((m) => m.id === 'shadowball')
    expect(shadowBall?.category).toBe('Special')
    expect(shadowBall?.type).toBe('Ghost')
  })
})

/**
 * A `bun update @pkmn/*` that silently changes a draft pool must fail here,
 * loudly, rather than in someone's league mid-season. Update the numbers
 * deliberately when a tier shift is real.
 */
describe('pool size snapshot', () => {
  const EXPECTED: Record<string, number> = {
    gen9ou: formatPool('gen9ou').size,
    gen9ubers: formatPool('gen9ubers').size,
    gen9nationaldex: formatPool('gen9nationaldex').size,
    gen8ou: formatPool('gen8ou').size,
  }

  it('records the pool sizes this @pkmn version produces', () => {
    expect(EXPECTED).toMatchSnapshot()
  })

  it('keeps ubers strictly larger than OU', () => {
    expect(formatPool('gen9ubers').size).toBeGreaterThan(formatPool('gen9ou').size)
  })

  it('keeps national dex larger than standard OU', () => {
    expect(formatPool('gen9nationaldex').size).toBeGreaterThan(formatPool('gen9ou').size)
  })
})
