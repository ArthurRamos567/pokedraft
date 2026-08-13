import type { MemberId } from './schedule'

export type SlotSource =
  | { kind: 'seed'; n: number }
  | { kind: 'winner_of'; slot: string }
  | { kind: 'loser_of'; slot: string }

export type BracketSide = 'winners' | 'losers' | 'final'

export type BracketMatch = {
  slot: string
  round: number
  side: BracketSide
  homeSource: SlotSource
  awaySource: SlotSource
  homeMemberId: MemberId | null
  awayMemberId: MemberId | null
  winnerMemberId: MemberId | null
}

export type Bracket = {
  type: 'single_elim' | 'double_elim'
  size: number
  thirdPlace: boolean
  /** Frozen at generation: a later result correction must not reseed a running bracket. */
  seeds: MemberId[]
  bracketReset: boolean
  matches: BracketMatch[]
  championMemberId: MemberId | null
}

const nextPowerOfTwo = (n: number) => {
  let p = 1
  while (p < n) p *= 2
  return p
}

/**
 * Standard 1v8 / 2v7 pairing, built by repeated mirroring. Byes therefore land
 * on the top seeds, which is the point of earning one.
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2]
  while (order.length < size) {
    const round = order.length * 2 + 1
    const next: number[] = []
    for (const s of order) {
      next.push(s, round - s)
    }
    order = next
  }
  return order
}

const slotName = (side: 'W' | 'L' | 'F', round: number, index: number) =>
  side === 'F' ? (index === 0 ? 'F' : 'F2') : `${side}${round}-${index + 1}`

/**
 * Slots and their *sources* are laid out up front, so a bracket renders before
 * anybody plays and progression is a pure function rather than ad-hoc pointer
 * chasing.
 */
export function generateBracket(input: {
  type?: 'single_elim' | 'double_elim'
  seeds: MemberId[]
  size?: number
  thirdPlace?: boolean
  bracketReset?: boolean
}): Bracket {
  const type = input.type ?? 'single_elim'
  const size = nextPowerOfTwo(Math.max(input.size ?? input.seeds.length, 2))
  const thirdPlace = input.thirdPlace ?? false
  const matches: BracketMatch[] = []

  const empty = (
    slot: string,
    round: number,
    side: BracketSide,
    homeSource: SlotSource,
    awaySource: SlotSource,
  ): BracketMatch => ({
    slot,
    round,
    side,
    homeSource,
    awaySource,
    homeMemberId: null,
    awayMemberId: null,
    winnerMemberId: null,
  })

  // Winners bracket round 1 from the seed pairing.
  const order = seedOrder(size)
  for (let i = 0; i < size / 2; i++) {
    matches.push(
      empty(
        slotName('W', 1, i),
        1,
        'winners',
        { kind: 'seed', n: order[i * 2]! },
        { kind: 'seed', n: order[i * 2 + 1]! },
      ),
    )
  }

  let roundSize = size / 2
  let round = 2
  while (roundSize > 1) {
    for (let i = 0; i < roundSize / 2; i++) {
      matches.push(
        empty(
          slotName('W', round, i),
          round,
          'winners',
          {
            kind: 'winner_of',
            slot: slotName('W', round - 1, i * 2),
          },
          {
            kind: 'winner_of',
            slot: slotName('W', round - 1, i * 2 + 1),
          },
        ),
      )
    }
    roundSize /= 2
    round++
  }

  const finalWinnersRound = round - 1
  const winnersFinalSlot = slotName('W', finalWinnersRound, 0)

  if (thirdPlace && size >= 4) {
    // The two semifinal losers, which is exactly what a third-place match is.
    const semiRound = finalWinnersRound - 1
    matches.push(
      empty(
        '3P',
        finalWinnersRound,
        'final',
        {
          kind: 'loser_of',
          slot: slotName('W', semiRound, 0),
        },
        {
          kind: 'loser_of',
          slot: slotName('W', semiRound, 1),
        },
      ),
    )
  }

  if (type === 'double_elim') {
    // Standard drop pattern: losers round 2k pairs survivors, 2k+1 absorbs the
    // fresh drop-downs from winners round k+1.
    let losersRound = 1
    let feedRound = 1
    let count = size / 4

    if (count >= 1) {
      for (let i = 0; i < count; i++) {
        matches.push(
          empty(
            slotName('L', losersRound, i),
            losersRound,
            'losers',
            {
              kind: 'loser_of',
              slot: slotName('W', 1, i * 2),
            },
            {
              kind: 'loser_of',
              slot: slotName('W', 1, i * 2 + 1),
            },
          ),
        )
      }
      losersRound++
      feedRound = 2
    }

    while (count > 1 || (count === 1 && feedRound <= finalWinnersRound)) {
      const previous = count
      for (let i = 0; i < previous; i++) {
        matches.push(
          empty(
            slotName('L', losersRound, i),
            losersRound,
            'losers',
            {
              kind: 'winner_of',
              slot: slotName('L', losersRound - 1, i),
            },
            {
              kind: 'loser_of',
              slot: slotName('W', feedRound, i),
            },
          ),
        )
      }
      losersRound++
      feedRound++
      if (feedRound > finalWinnersRound) break

      count = Math.max(Math.floor(previous / 2), 1)
      if (previous > 1) {
        for (let i = 0; i < count; i++) {
          matches.push(
            empty(
              slotName('L', losersRound, i),
              losersRound,
              'losers',
              {
                kind: 'winner_of',
                slot: slotName('L', losersRound - 1, i * 2),
              },
              {
                kind: 'winner_of',
                slot: slotName('L', losersRound - 1, i * 2 + 1),
              },
            ),
          )
        }
        losersRound++
      }
    }

    const losersFinalSlot = slotName('L', losersRound - 1, 0)
    matches.push(
      empty(
        'F',
        losersRound,
        'final',
        { kind: 'winner_of', slot: winnersFinalSlot },
        {
          kind: 'winner_of',
          slot: losersFinalSlot,
        },
      ),
    )
    if (input.bracketReset) {
      // Only played if the loser's-bracket team wins F — the winners' side has
      // not lost yet, and one loss should not end them.
      matches.push(
        empty(
          'F2',
          losersRound + 1,
          'final',
          { kind: 'winner_of', slot: 'F' },
          {
            kind: 'loser_of',
            slot: 'F',
          },
        ),
      )
    }
  }

  const bracket: Bracket = {
    type,
    size,
    thirdPlace,
    seeds: [...input.seeds],
    bracketReset: input.bracketReset ?? false,
    matches,
    championMemberId: null,
  }
  return resolveSources(bracket)
}

const loserOf = (m: BracketMatch): MemberId | null => {
  if (!m.winnerMemberId) return null
  if (m.homeMemberId && m.winnerMemberId !== m.homeMemberId) return m.homeMemberId
  if (m.awayMemberId && m.winnerMemberId !== m.awayMemberId) return m.awayMemberId
  return null
}

function resolveOne(bracket: Bracket, source: SlotSource): MemberId | null {
  if (source.kind === 'seed') return bracket.seeds[source.n - 1] ?? null
  const from = bracket.matches.find((m) => m.slot === source.slot)
  if (!from) return null
  return source.kind === 'winner_of' ? from.winnerMemberId : loserOf(from)
}

/**
 * Pours members into every slot whose sources are decided, and walks a bye
 * through automatically: a match with one member and an empty seed slot has
 * already been won.
 */
export function resolveSources(input: Bracket): Bracket {
  const bracket: Bracket = { ...input, matches: input.matches.map((m) => ({ ...m })) }

  // Repeat until stable: filling one slot can decide a bye that fills the next.
  for (let pass = 0; pass < bracket.matches.length + 2; pass++) {
    let changed = false

    for (const match of bracket.matches) {
      const home = match.homeMemberId ?? resolveOne(bracket, match.homeSource)
      const away = match.awayMemberId ?? resolveOne(bracket, match.awaySource)
      if (home !== match.homeMemberId) {
        match.homeMemberId = home
        changed = true
      }
      if (away !== match.awayMemberId) {
        match.awayMemberId = away
        changed = true
      }

      if (!match.winnerMemberId) {
        const homeIsBye = match.homeSource.kind === 'seed' && home === null
        const awayIsBye = match.awaySource.kind === 'seed' && away === null
        if (away && homeIsBye) {
          match.winnerMemberId = away
          changed = true
        } else if (home && awayIsBye) {
          match.winnerMemberId = home
          changed = true
        }
      }
    }
    if (!changed) break
  }

  const final =
    bracket.matches.find((m) => m.slot === 'F2') ?? bracket.matches.find((m) => m.slot === 'F')
  const championSlot =
    final ??
    [...bracket.matches].filter((m) => m.side === 'winners').sort((a, b) => b.round - a.round)[0]
  bracket.championMemberId = championSlot?.winnerMemberId ?? null
  return bracket
}

/**
 * Idempotent by construction: setting the same winner twice produces the same
 * bracket, so replaying a confirmation cannot double-advance anyone.
 */
export function advance(bracket: Bracket, slot: string, winnerMemberId: MemberId): Bracket {
  const next: Bracket = { ...bracket, matches: bracket.matches.map((m) => ({ ...m })) }
  const match = next.matches.find((m) => m.slot === slot)
  if (!match) return bracket
  if (match.homeMemberId !== winnerMemberId && match.awayMemberId !== winnerMemberId) {
    return bracket
  }
  match.winnerMemberId = winnerMemberId
  return resolveSources(next)
}

/** Every slot that reads, directly or transitively, from this one. */
export function dependents(bracket: Bracket, slot: string): string[] {
  const out = new Set<string>()
  const queue = [slot]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const m of bracket.matches) {
      const reads =
        (m.homeSource.kind !== 'seed' && m.homeSource.slot === current) ||
        (m.awaySource.kind !== 'seed' && m.awaySource.slot === current)
      if (reads && !out.has(m.slot)) {
        out.add(m.slot)
        queue.push(m.slot)
      }
    }
  }
  return [...out]
}

/**
 * A host correction clears exactly the dependent subtree — everything
 * downstream was decided by a result that no longer stands.
 */
export function override(bracket: Bracket, slot: string, winnerMemberId: MemberId | null): Bracket {
  const affected = new Set(dependents(bracket, slot))
  const next: Bracket = {
    ...bracket,
    matches: bracket.matches.map((m) => {
      if (m.slot === slot) return { ...m, winnerMemberId }
      if (!affected.has(m.slot)) return { ...m }
      return { ...m, homeMemberId: null, awayMemberId: null, winnerMemberId: null }
    }),
  }
  return resolveSources(next)
}
