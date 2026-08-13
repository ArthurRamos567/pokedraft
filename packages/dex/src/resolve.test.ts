import { describe, expect, it } from 'bun:test'
import { ALIAS_SOURCE } from './aliases'
import { resolveMany, resolveName } from './resolve'

describe('resolveName', () => {
  it('resolves an exact canonical id', () => {
    const r = resolveName('landorustherian')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.id).toBe('landorustherian')
  })

  it('resolves a display name', () => {
    const r = resolveName('Landorus-Therian')
    expect(r.ok && r.id).toBe('landorustherian')
  })

  it('resolves the forme spellings people actually type', () => {
    for (const input of [
      'Landorus Therian',
      'Landorus (Therian)',
      'landorus-therian',
      'LANDORUS THERIAN',
    ]) {
      const r = resolveName(input)
      expect(r.ok, `${input} should resolve`).toBe(true)
      if (r.ok) expect(r.id).toBe('landorustherian')
    }
  })

  it('resolves shorthand through the alias table', () => {
    for (const [alias, expected] of [
      ['lando-t', 'landorustherian'],
      ['ttar', 'tyranitar'],
      ['pex', 'toxapex'],
      ['Rotom-W', 'rotomwash'],
      ['Urshifu-RS', 'urshifurapidstrike'],
    ] as const) {
      const r = resolveName(alias)
      expect(r.ok, `${alias} should resolve`).toBe(true)
      if (r.ok) expect(r.id).toBe(expected)
    }
  })

  it('every seeded alias lands on a real species in some generation', () => {
    // Zygarde-10% is gone from gen 9's dex but alive in national dex leagues,
    // so an alias only has to be real *somewhere*.
    for (const alias of Object.keys(ALIAS_SOURCE)) {
      const hit = ([9, 8, 7] as const).some((g) => resolveName(alias, { gen: g }).ok)
      expect(hit, `alias "${alias}" resolves to nothing in gens 9-7`).toBe(true)
    }
  })

  it('never fuzzy-matches into a wrong-but-plausible mon', () => {
    const mew = resolveName('Mew')
    expect(mew.ok && mew.id).toBe('mew')

    // The dangerous direction: a typo must not silently become a neighbour.
    const typo = resolveName('Mewtoo')
    expect(typo.ok).toBe(false)
    if (!typo.ok) {
      expect(typo.suggestions.length).toBeGreaterThan(0)
      expect(typo.suggestions[0]?.id).toBe('mewtwo')
    }
  })

  it('returns suggestions rather than a match for garbage', () => {
    const r = resolveName('Definitely Not A Pokemon')
    expect(r.ok).toBe(false)
  })

  it('collapses a cosmetic forme onto its base', () => {
    const r = resolveName('Gastrodon-East')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.id).toBe('gastrodon')
      expect(r.method).toBe('cosmetic')
    }
  })

  it('keeps a functional forme distinct', () => {
    for (const [input, expected] of [
      ['Rotom-Wash', 'rotomwash'],
      ['Urshifu-Rapid-Strike', 'urshifurapidstrike'],
      ['Toxtricity-Low-Key', 'toxtricitylowkey'],
    ] as const) {
      const r = resolveName(input)
      expect(r.ok && r.id).toBe(expected)
    }
  })

  it('respects the generation of the requested format', () => {
    expect(resolveName('Miraidon', { format: 'gen9ou' }).ok).toBe(true)
    expect(resolveName('Miraidon', { format: 'gen8ou' }).ok).toBe(false)
  })

  it('resolves a batch in one pass', () => {
    const rs = resolveMany(['Pikachu', 'lando-t', 'nonsense-mon'])
    expect(rs.map((r) => r.ok)).toEqual([true, true, false])
  })
})
