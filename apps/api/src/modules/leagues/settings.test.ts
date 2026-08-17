import { describe, expect, it } from 'bun:test'
import { DEFAULT_SETTINGS } from '@pokedraft/shared'
import { resolveSettings } from './settings'

describe('resolveSettings', () => {
  it('returns the merge when every rule holds', () => {
    expect(resolveSettings(DEFAULT_SETTINGS, { pickSeconds: 45 }).pickSeconds).toBe(45)
  })

  it('throws on a patch that breaks a rule spanning a field it did not touch', () => {
    expect(() => resolveSettings({ ...DEFAULT_SETTINGS, rosterMax: 8 }, { rosterMin: 9 })).toThrow(
      /rosterMin/,
    )
  })

  it('attaches every problem to the error', () => {
    try {
      resolveSettings(DEFAULT_SETTINGS, { rosterMin: 9, rosterMax: 8, tradesEnabled: false })
      throw new Error('expected a throw')
    } catch (err) {
      expect((err as { details: { problems: string[] } }).details.problems).toHaveLength(1)
    }
  })
})
