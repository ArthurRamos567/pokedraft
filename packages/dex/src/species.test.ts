import { describe, expect, it } from 'bun:test'
import { movePool } from './learnsets'
import { formatPool } from './legality'
import { searchSpecies } from './search'
import { canonicalize, getSpecies, isCosmeticForme, toDetail } from './species'

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
