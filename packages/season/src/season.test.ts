import { describe, expect, it } from 'bun:test'
import { parseReplayUrl } from './replay'
import { generateSchedule, roundRobin } from './schedule'
import { type ResultRow, standings } from './standings'

const ids = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i))

describe('round robin', () => {
  it.each([2, 4, 6, 8, 12])('has every pair meet exactly once for %i teams', (n) => {
    const members = ids(n)
    const rounds = roundRobin(members)
    expect(rounds).toHaveLength(n - 1)

    const seen = new Map<string, number>()
    for (const round of rounds) {
      expect(round).toHaveLength(n / 2)
      const inRound = new Set<string>()
      for (const m of round) {
        const key = [m.home, m.away].sort().join('|')
        seen.set(key, (seen.get(key) ?? 0) + 1)
        // Nobody plays twice in a week.
        expect(inRound.has(m.home)).toBe(false)
        inRound.add(m.home)
        if (m.away) {
          expect(inRound.has(m.away)).toBe(false)
          inRound.add(m.away)
        }
      }
    }
    expect(seen.size).toBe((n * (n - 1)) / 2)
    expect([...seen.values()].every((c) => c === 1)).toBe(true)
  })

  it.each([3, 5, 7, 9])('gives everybody exactly one bye for %i teams', (n) => {
    const members = ids(n)
    const rounds = roundRobin(members)
    expect(rounds).toHaveLength(n)

    const byes = new Map<string, number>()
    for (const round of rounds) {
      const resting = round.filter((m) => m.away === null)
      expect(resting).toHaveLength(1)
      const id = resting[0]!.home
      byes.set(id, (byes.get(id) ?? 0) + 1)
    }
    expect(byes.size).toBe(n)
    expect([...byes.values()].every((c) => c === 1)).toBe(true)
  })
})

describe('generateSchedule', () => {
  it('is deterministic for a given seed and different across seeds', () => {
    const members = ids(6)
    const a = generateSchedule({ members, seed: 'alpha' })
    const b = generateSchedule({ members, seed: 'alpha' })
    const c = generateSchedule({ members, seed: 'beta' })
    expect(a).toEqual(b)
    expect(a.order).not.toEqual(c.order)
  })

  it('mirrors home and away in a double round robin', () => {
    const members = ids(4)
    const single = generateSchedule({ members })
    const double = generateSchedule({ members, doubleRoundRobin: true })
    expect(double.weeks).toHaveLength(single.weeks.length * 2)

    const first = double.weeks[0]!.matchups[0]!
    const mirror = double.weeks[single.weeks.length]!.matchups.find(
      (m) => m.home === first.away && m.away === first.home,
    )
    expect(mirror).toBeDefined()
  })

  it('warns rather than silently truncating a short season', () => {
    const s = generateSchedule({ members: ids(8), weeks: 4 })
    expect(s.weeks).toHaveLength(4)
    expect(s.warnings.join(' ')).toContain('never meet')
  })

  it('warns when the requested season is longer than a full rotation', () => {
    const s = generateSchedule({ members: ids(4), weeks: 10 })
    expect(s.warnings.join(' ')).toContain('empty')
  })

  it('refuses a one-team season', () => {
    const s = generateSchedule({ members: ids(1) })
    expect(s.weeks).toHaveLength(0)
    expect(s.warnings.length).toBeGreaterThan(0)
  })
})

describe('standings', () => {
  const result = (
    home: string,
    away: string | null,
    winner: string | null,
    hs = 0,
    as = 0,
    status: ResultRow['status'] = 'confirmed',
  ): ResultRow => ({
    homeId: home,
    awayId: away,
    winnerId: winner,
    homeScore: hs,
    awayScore: as,
    status,
  })

  it('ranks by wins first', () => {
    const table = standings(
      ['a', 'b', 'c'],
      [result('a', 'b', 'a', 3, 0), result('a', 'c', 'a', 2, 0), result('b', 'c', 'b', 1, 0)],
    )
    expect(table.map((r) => r.memberId)).toEqual(['a', 'b', 'c'])
    expect(table[0]?.wins).toBe(2)
  })

  it('breaks a two-way tie on differential by default', () => {
    const table = standings(['a', 'b'], [result('a', 'b', 'b', 0, 1), result('b', 'a', 'a', 0, 5)])
    // Both 1-1; a won by five and lost by one.
    expect(table[0]?.memberId).toBe('a')
  })

  it('breaks the same tie on head-to-head when the league asks for it', () => {
    const results = [result('a', 'b', 'b', 0, 1), result('b', 'a', 'a', 0, 5)]
    const h2h = standings(['a', 'b'], results, { tiebreak: 'head_to_head_first' })
    // They split, so head-to-head says nothing and differential decides anyway.
    expect(h2h[0]?.memberId).toBe('a')

    const single = [
      result('a', 'b', 'b', 0, 1),
      result('a', 'c', 'a', 9, 0),
      result('b', 'c', 'b', 1, 0),
    ]
    const table = standings(['a', 'b', 'c'], single, { tiebreak: 'head_to_head_first' })
    // a and b are both 1-1... b beat a, so head-to-head puts b first.
    expect(table.slice(0, 2).map((r) => r.memberId)).toEqual(['b', 'a'])
  })

  it('ignores unreported, disputed and void matches', () => {
    const table = standings(
      ['a', 'b'],
      [
        result('a', 'b', 'a', 3, 0, 'reported'),
        result('a', 'b', 'a', 3, 0, 'disputed'),
        result('a', 'b', 'a', 3, 0, 'void'),
      ],
    )
    expect(table.every((r) => r.played === 0)).toBe(true)
  })

  it('counts a forfeit', () => {
    const table = standings(['a', 'b'], [result('a', 'b', 'a', 6, 0, 'forfeited')])
    expect(table[0]?.wins).toBe(1)
  })

  it('records a bye without counting it as a game', () => {
    const table = standings(['a'], [result('a', null, null)])
    expect(table[0]).toMatchObject({ byes: 1, played: 0, wins: 0 })
  })

  it('is stable across calls when everything else ties', () => {
    const members = ['zeta', 'alpha', 'mid']
    const once = standings(members, []).map((r) => r.memberId)
    const twice = standings([...members].reverse(), []).map((r) => r.memberId)
    expect(once).toEqual(twice)
  })

  it('survives a league with no results at all', () => {
    const table = standings(['a', 'b', 'c'], [])
    expect(table).toHaveLength(3)
    expect(table.every((r) => r.played === 0 && r.differential === 0)).toBe(true)
  })
})

describe('replay urls', () => {
  it('normalizes every shape people paste', () => {
    for (const input of [
      'https://replay.pokemonshowdown.com/gen9ou-2314159265',
      'http://replay.pokemonshowdown.com/gen9ou-2314159265',
      'https://replay.pokemonshowdown.com/gen9ou-2314159265.json',
      'https://replay.pokemonshowdown.com/gen9ou-2314159265?p2=foo',
      'gen9ou-2314159265',
    ]) {
      expect(parseReplayUrl(input)?.id, input).toBe('gen9ou-2314159265')
    }
  })

  it('rejects anything that is not a replay', () => {
    for (const input of ['', 'https://example.com/gen9ou-1', 'not a url']) {
      expect(parseReplayUrl(input)).toBeNull()
    }
  })
})
