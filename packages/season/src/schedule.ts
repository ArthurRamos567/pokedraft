export type MemberId = string

export type Matchup = {
  week: number
  home: MemberId
  /** Null is a bye. */
  away: MemberId | null
}

export type ScheduleOptions = {
  members: MemberId[]
  weeks?: number
  doubleRoundRobin?: boolean
  /** Deterministic seeding, so "regenerate" is reproducible. */
  seed?: string
}

export type Schedule = {
  order: MemberId[]
  weeks: { number: number; matchups: Matchup[] }[]
  warnings: string[]
}

/**
 * A tiny deterministic PRNG. `Math.random()` would make a generated schedule
 * impossible to reproduce, which matters the first time a host asks why the
 * regenerated one looks different.
 */
function mulberry(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * Circle method, ported from the MVP: fix the first seed, rotate the rest. For
 * n teams it yields n−1 rounds in which every pair meets exactly once.
 *
 * An odd count gets a `null` opponent — a bye. Because the null sits in the
 * rotating half, it lands on a different team each round, so nobody takes a
 * second bye before everyone has had one.
 */
export function roundRobin(members: readonly MemberId[]): Matchup[][] {
  const ids: (MemberId | null)[] = [...members]
  if (ids.length % 2 === 1) ids.push(null)

  const half = ids.length / 2
  const rotating = ids.slice(1)
  const rounds: Matchup[][] = []

  for (let r = 0; r < ids.length - 1; r++) {
    const line = [ids[0], ...rotating]
    const games: Matchup[] = []
    for (let i = 0; i < half; i++) {
      const a = line[i] ?? null
      const b = line[line.length - 1 - i] ?? null
      if (a === null && b === null) continue
      // Alternate sides by round so home advantage — or just the display
      // order — doesn't always fall the same way.
      const [home, away] = r % 2 === 0 ? [a, b] : [b, a]
      if (home === null) games.push({ week: r + 1, home: away!, away: null })
      else games.push({ week: r + 1, home, away })
    }
    rounds.push(games)
    rotating.unshift(rotating.pop()!)
  }
  return rounds
}

export function generateSchedule(opts: ScheduleOptions): Schedule {
  const warnings: string[] = []
  if (opts.members.length < 2) {
    return { order: [...opts.members], weeks: [], warnings: ['a season needs at least two teams'] }
  }

  const order = opts.seed ? shuffle(opts.members, mulberry(opts.seed)) : [...opts.members]
  let rounds = roundRobin(order)

  if (opts.doubleRoundRobin) {
    const mirrored = rounds.map((round, i) =>
      round.map((m) => ({
        week: rounds.length + i + 1,
        home: m.away ?? m.home,
        away: m.away ? m.home : null,
      })),
    )
    rounds = [...rounds, ...mirrored]
  }

  const full = rounds.length
  if (opts.weeks !== undefined) {
    if (opts.weeks < full) {
      // Truncating silently would hand a host a season where some pairs never
      // meet, discovered in week 6.
      warnings.push(
        `a full round robin needs ${full} weeks; generating ${opts.weeks} means some teams never meet`,
      )
      rounds = rounds.slice(0, opts.weeks)
    } else if (opts.weeks > full) {
      warnings.push(
        `a full round robin only fills ${full} weeks; the remaining ${opts.weeks - full} are empty`,
      )
    }
  }

  const weeks = rounds.map((matchups, i) => ({
    number: i + 1,
    matchups: matchups.map((m) => ({ ...m, week: i + 1 })),
  }))

  return { order, weeks, warnings }
}

/** Week n opens at start + (n−1)·length and closes a length later. */
export function weekWindows(
  startAt: Date,
  weekCount: number,
  lengthDays = 7,
): { number: number; opensAt: Date; closesAt: Date }[] {
  const ms = lengthDays * 24 * 3600_000
  return Array.from({ length: weekCount }, (_, i) => ({
    number: i + 1,
    opensAt: new Date(startAt.getTime() + i * ms),
    closesAt: new Date(startAt.getTime() + (i + 1) * ms),
  }))
}
