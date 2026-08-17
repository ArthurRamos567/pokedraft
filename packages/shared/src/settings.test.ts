import { describe, expect, it } from 'bun:test'
import { DEFAULT_SETTINGS, mergeSettings, settingsProblems } from './settings'

describe('settings rules', () => {
  it('accepts the defaults', () => {
    expect(settingsProblems(DEFAULT_SETTINGS)).toEqual([])
  })

  it('rejects a roster floor above its ceiling', () => {
    const problems = settingsProblems({ ...DEFAULT_SETTINGS, rosterMin: 11, rosterMax: 10 })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/rosterMin/)
  })

  it('rejects a trade deadline with trades off', () => {
    const problems = settingsProblems({
      ...DEFAULT_SETTINGS,
      tradesEnabled: false,
      tradeDeadlineWeek: 6,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/tradeDeadlineWeek/)
  })

  it('reports every problem at once', () => {
    expect(
      settingsProblems({
        ...DEFAULT_SETTINGS,
        rosterMin: 12,
        rosterMax: 4,
        tradesEnabled: false,
        tradeDeadlineWeek: 3,
      }),
    ).toHaveLength(2)
  })
})

describe('mergeSettings', () => {
  it('fills the untouched fields from the base', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { pickSeconds: 45 })
    expect(merged.pickSeconds).toBe(45)
    expect(merged.budget).toBe(DEFAULT_SETTINGS.budget)
  })

  it('drops anything that is not a rule field', () => {
    const base = { ...DEFAULT_SETTINGS, leagueId: 'abc', updatedAt: new Date() }
    expect(mergeSettings(base)).not.toHaveProperty('leagueId')
  })

  it('keeps an explicit null over the base value', () => {
    const base = { ...DEFAULT_SETTINGS, tradeDeadlineWeek: 8 }
    expect(mergeSettings(base, { tradeDeadlineWeek: null }).tradeDeadlineWeek).toBeNull()
  })
})
