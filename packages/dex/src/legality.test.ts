import { describe, expect, it } from 'bun:test'
import { getFormatInfo, listFormats, SUPPORTED_FORMATS } from './formats'
import { checkLegality, formatPool, inPool } from './legality'

describe('legality', () => {
  it('excludes an Uber from OU and includes it in Ubers', () => {
    expect(checkLegality('flutter mane', 'gen9ou')).toEqual({ legal: false, reason: 'banned' })
    expect(inPool('fluttermane', 'gen9ubers')).toBe(true)
  })

  it('keeps an OU staple legal in OU', () => {
    expect(checkLegality('landorustherian', 'gen9ou').legal).toBe(true)
    expect(checkLegality('kingambit', 'gen9ou').legal).toBe(true)
  })

  it('rejects a gen-9 mon in a gen-8 format', () => {
    expect(checkLegality('miraidon', 'gen8ou').legal).toBe(false)
  })

  it('rejects an unknown species outright', () => {
    expect(checkLegality('notamon', 'gen9ou')).toEqual({
      legal: false,
      reason: 'unknown_species',
    })
  })

  it('readmits a Past mon in national dex but not in standard OU', () => {
    expect(inPool('clefable', 'gen9nationaldex')).toBe(true)
    // Landorus-Therian is cut from SV proper but present in national dex.
    expect(inPool('landorustherian', 'gen9nationaldex')).toBe(true)
  })

  it('caches the pool — the second build is the same object', () => {
    expect(formatPool('gen9ou')).toBe(formatPool('gen9ou'))
  })
})

describe('formats', () => {
  it('describes a supported format', () => {
    const f = getFormatInfo('gen9ou')
    expect(f?.name).toBe('[Gen 9] OU')
    expect(f?.gen).toBe(9)
    expect(f?.supported).toBe(true)
  })

  it('returns null for a format that does not exist', () => {
    expect(getFormatInfo('gen9definitelynot')).toBeNull()
  })

  it('every curated format actually exists in @pkmn/sim', () => {
    for (const id of SUPPORTED_FORMATS) {
      expect(getFormatInfo(id), `${id} is not a real format`).not.toBeNull()
    }
  })

  it('searches the full format list, not only the curated one', () => {
    const all = listFormats({ q: 'ou' })
    expect(all.length).toBeGreaterThan(SUPPORTED_FORMATS.length / 2)
  })
})
