import { describe, expect, it } from 'bun:test'
import { advance, type Bracket, dependents, generateBracket, override, seedOrder } from './bracket'

const seeds = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`)

/** Plays a bracket to completion, always letting the higher seed win. */
function runToChampion(start: Bracket): Bracket {
  let bracket = start
  for (let guard = 0; guard < 100; guard++) {
    const playable = bracket.matches.find(
      (m) => m.homeMemberId && m.awayMemberId && !m.winnerMemberId,
    )
    if (!playable) break
    const rank = (id: string) => bracket.seeds.indexOf(id)
    const winner =
      rank(playable.homeMemberId!) <= rank(playable.awayMemberId!)
        ? playable.homeMemberId!
        : playable.awayMemberId!
    bracket = advance(bracket, playable.slot, winner)
  }
  return bracket
}

describe('seed pairing', () => {
  it('pairs 1v8, 2v7 so a bye rewards seeding', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })
})

describe('single elimination', () => {
  it.each([4, 8, 16])('produces exactly one champion for %i teams', (size) => {
    const bracket = runToChampion(generateBracket({ seeds: seeds(size), size }))
    expect(bracket.championMemberId).toBe('s1')
    expect(bracket.matches.every((m) => m.winnerMemberId !== null)).toBe(true)
  })

  it('renders a full empty tree before anything is played', () => {
    const bracket = generateBracket({ seeds: seeds(8), size: 8 })
    expect(bracket.matches).toHaveLength(7)
    expect(bracket.matches.filter((m) => m.round === 1)).toHaveLength(4)
    // Seeds are already resolved into round one, so the bracket draws.
    const first = bracket.matches.find((m) => m.slot === 'W1-1')
    expect(first?.homeMemberId).toBe('s1')
    expect(first?.awayMemberId).toBe('s8')
    expect(bracket.championMemberId).toBeNull()
  })

  it('walks byes through for a non-power-of-two field', () => {
    // Six teams into a size-8 bracket: seeds 1 and 2 get the byes.
    const bracket = generateBracket({ seeds: seeds(6), size: 8 })
    const byes = bracket.matches.filter((m) => m.round === 1 && m.winnerMemberId)
    expect(byes.map((m) => m.winnerMemberId).sort()).toEqual(['s1', 's2'])

    const played = runToChampion(bracket)
    expect(played.championMemberId).toBe('s1')
  })

  it('sources the third-place match from the two semifinal losers', () => {
    const bracket = runToChampion(generateBracket({ seeds: seeds(4), size: 4, thirdPlace: true }))
    const third = bracket.matches.find((m) => m.slot === '3P')
    expect(third).toBeDefined()
    // Seeds 3 and 4 lose their semifinals, so they meet for third.
    expect([third!.homeMemberId, third!.awayMemberId].sort()).toEqual(['s3', 's4'])
    expect(third!.winnerMemberId).toBe('s3')
  })
})

describe('double elimination', () => {
  it('lets a team that loses once still reach the grand final', () => {
    const start = generateBracket({ type: 'double_elim', seeds: seeds(4), size: 4 })
    // s1 loses its opening match, then runs the losers bracket.
    let bracket = advance(start, 'W1-1', 's4')
    bracket = advance(bracket, 'W1-2', 's2')

    const final = bracket.matches.find((m) => m.slot === 'F')
    expect(final).toBeDefined()

    bracket = runToChampion(bracket)
    const decided = bracket.matches.find((m) => m.slot === 'F')!
    expect([decided.homeMemberId, decided.awayMemberId]).toContain('s1')
  })

  it('eliminates a team that loses twice', () => {
    let bracket = generateBracket({ type: 'double_elim', seeds: seeds(4), size: 4 })
    bracket = advance(bracket, 'W1-1', 's1') // s4 loses once
    bracket = advance(bracket, 'W1-2', 's2') // s3 loses once
    bracket = advance(bracket, 'L1-1', 's3') // s4 loses twice — done

    const remaining = bracket.matches.filter((m) => !m.winnerMemberId)
    const stillIn = new Set(
      remaining.flatMap((m) => [m.homeMemberId, m.awayMemberId]).filter(Boolean),
    )
    expect(stillIn.has('s4')).toBe(false)
  })

  it('adds a bracket reset only when the league asks for one', () => {
    const without = generateBracket({ type: 'double_elim', seeds: seeds(4), size: 4 })
    expect(without.matches.some((m) => m.slot === 'F2')).toBe(false)

    const with_ = generateBracket({
      type: 'double_elim',
      seeds: seeds(4),
      size: 4,
      bracketReset: true,
    })
    const reset = with_.matches.find((m) => m.slot === 'F2')
    expect(reset).toBeDefined()
    expect(reset?.homeSource).toEqual({ kind: 'winner_of', slot: 'F' })
  })
})

describe('progression', () => {
  it('is idempotent — replaying a confirmation does not double-advance', () => {
    const start = generateBracket({ seeds: seeds(4), size: 4 })
    const once = advance(start, 'W1-1', 's1')
    const twice = advance(once, 'W1-1', 's1')
    expect(twice).toEqual(once)
  })

  it('ignores a winner who is not in the match', () => {
    const start = generateBracket({ seeds: seeds(4), size: 4 })
    expect(advance(start, 'W1-1', 's2')).toEqual(start)
  })

  it('ignores an unknown slot', () => {
    const start = generateBracket({ seeds: seeds(4), size: 4 })
    expect(advance(start, 'nope', 's1')).toEqual(start)
  })
})

describe('host override', () => {
  it('clears exactly the dependent subtree and nothing else', () => {
    const bracket = runToChampion(generateBracket({ seeds: seeds(8), size: 8 }))
    expect(bracket.championMemberId).toBe('s1')

    const subtree = dependents(bracket, 'W1-1')
    expect(subtree).toEqual(['W2-1', 'W3-1'])

    const corrected = override(bracket, 'W1-1', 's8')
    // The other half of the draw is untouched.
    expect(corrected.matches.find((m) => m.slot === 'W1-2')?.winnerMemberId).toBe(
      bracket.matches.find((m) => m.slot === 'W1-2')?.winnerMemberId,
    )
    expect(corrected.matches.find((m) => m.slot === 'W2-2')?.winnerMemberId).toBe(
      bracket.matches.find((m) => m.slot === 'W2-2')?.winnerMemberId,
    )

    // The dependent path is emptied, and the champion with it.
    expect(corrected.matches.find((m) => m.slot === 'W2-1')?.winnerMemberId).toBeNull()
    expect(corrected.matches.find((m) => m.slot === 'W2-1')?.homeMemberId).toBe('s8')
    expect(corrected.championMemberId).toBeNull()

    const replayed = runToChampion(corrected)
    expect(replayed.championMemberId).toBeTruthy()
  })
})
