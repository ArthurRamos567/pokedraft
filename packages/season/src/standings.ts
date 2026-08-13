import type { MemberId } from './schedule'

export type ResultRow = {
  homeId: MemberId
  awayId: MemberId | null
  winnerId: MemberId | null
  homeScore: number
  awayScore: number
  /** `forfeited` still counts; `void` and unreported ones don't. */
  status: 'scheduled' | 'reported' | 'confirmed' | 'disputed' | 'forfeited' | 'void'
}

export type StandingRow = {
  memberId: MemberId
  played: number
  wins: number
  losses: number
  byes: number
  /** Mons remaining, for and against — the usual differential convention. */
  scoreFor: number
  scoreAgainst: number
  differential: number
  kills: number
  beat: MemberId[]
}

export type TiebreakMode = 'differential_first' | 'head_to_head_first'

const COUNTED = new Set(['confirmed', 'forfeited'])

/**
 * Standings are derived, never stored. A stored table is a second source of
 * truth that drifts the first time a host overrides a result.
 */
export function tally(
  members: readonly MemberId[],
  results: readonly ResultRow[],
  kills: Record<MemberId, number> = {},
): Map<MemberId, StandingRow> {
  const rows = new Map<MemberId, StandingRow>(
    members.map((memberId) => [
      memberId,
      {
        memberId,
        played: 0,
        wins: 0,
        losses: 0,
        byes: 0,
        scoreFor: 0,
        scoreAgainst: 0,
        differential: 0,
        kills: kills[memberId] ?? 0,
        beat: [],
      },
    ]),
  )

  for (const r of results) {
    if (!COUNTED.has(r.status)) continue

    if (r.awayId === null) {
      const home = rows.get(r.homeId)
      if (home) home.byes++
      continue
    }

    const home = rows.get(r.homeId)
    const away = rows.get(r.awayId)
    if (!home || !away) continue

    home.played++
    away.played++
    home.scoreFor += r.homeScore
    home.scoreAgainst += r.awayScore
    away.scoreFor += r.awayScore
    away.scoreAgainst += r.homeScore

    if (r.winnerId === r.homeId) {
      home.wins++
      away.losses++
      home.beat.push(away.memberId)
    } else if (r.winnerId === r.awayId) {
      away.wins++
      home.losses++
      away.beat.push(home.memberId)
    }
  }

  for (const row of rows.values()) row.differential = row.scoreFor - row.scoreAgainst
  return rows
}

/** Deterministic last resort, so the table doesn't reshuffle on refresh. */
function stableHash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function standings(
  members: readonly MemberId[],
  results: readonly ResultRow[],
  opts: { kills?: Record<MemberId, number>; tiebreak?: TiebreakMode } = {},
): StandingRow[] {
  const rows = [...tally(members, results, opts.kills).values()]
  const mode = opts.tiebreak ?? 'differential_first'

  // Head-to-head is only meaningful between exactly two tied teams. Applied to
  // a three-way tie it produces cycles, so it is deliberately skipped there.
  const headToHead = (a: StandingRow, b: StandingRow, tiedCount: number) => {
    if (tiedCount !== 2) return 0
    const aBeatB = a.beat.includes(b.memberId)
    const bBeatA = b.beat.includes(a.memberId)
    if (aBeatB && !bBeatA) return -1
    if (bBeatA && !aBeatB) return 1
    return 0
  }

  const tiedOnWins = new Map<number, number>()
  for (const r of rows) tiedOnWins.set(r.wins, (tiedOnWins.get(r.wins) ?? 0) + 1)

  return rows.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins
    const tiedCount = tiedOnWins.get(a.wins) ?? 0

    if (mode === 'head_to_head_first') {
      const h = headToHead(a, b, tiedCount)
      if (h !== 0) return h
      if (a.differential !== b.differential) return b.differential - a.differential
    } else {
      if (a.differential !== b.differential) return b.differential - a.differential
      const h = headToHead(a, b, tiedCount)
      if (h !== 0) return h
    }

    if (a.kills !== b.kills) return b.kills - a.kills
    return stableHash(a.memberId) - stableHash(b.memberId)
  })
}
