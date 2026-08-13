import { checkLegality, resolveName } from '@pokedraft/dex'
import type { ParsedRow } from './parse'

export type RowStatus = 'ok' | 'illegal' | 'unknown' | 'duplicate'

export type ClassifiedRow = {
  input: string
  speciesId: string | null
  name: string | null
  points: number
  banned: boolean
  status: RowStatus
  /** Only for `illegal` — why the format's rule table rejects it. */
  reason?: string
  /** Only for `unknown` — for the user to pick from. Never auto-applied. */
  suggestions?: { id: string; name: string; score: number }[]
}

export type Classification = {
  rows: ClassifiedRow[]
  summary: { ok: number; illegal: number; unknown: number; duplicates: number }
}

/**
 * Resolve → check legality → flag duplicates. Later rows win a duplicate, which
 * matches how a person reads a file top to bottom, but both rows stay visible.
 */
export function classifyRows(rows: ParsedRow[], formatId: string): Classification {
  const classified: ClassifiedRow[] = rows.map((row) => {
    const resolved = resolveName(row.input, { format: formatId })
    if (!resolved.ok) {
      return {
        input: row.input,
        speciesId: null,
        name: null,
        points: row.points,
        banned: row.banned,
        status: 'unknown' as const,
        suggestions: resolved.suggestions,
      }
    }

    const legality = checkLegality(resolved.id, formatId)
    return {
      input: row.input,
      speciesId: resolved.id,
      name: resolved.name,
      points: row.points,
      banned: row.banned,
      status: legality.legal ? ('ok' as const) : ('illegal' as const),
      ...(legality.legal ? {} : { reason: legality.reason }),
    }
  })

  // Only the last occurrence of a species survives; earlier ones are marked.
  const lastIndex = new Map<string, number>()
  classified.forEach((r, i) => {
    if (r.speciesId) lastIndex.set(r.speciesId, i)
  })
  let duplicates = 0
  classified.forEach((r, i) => {
    if (r.speciesId && lastIndex.get(r.speciesId) !== i) {
      r.status = 'duplicate'
      duplicates++
    }
  })

  return {
    rows: classified,
    summary: {
      ok: classified.filter((r) => r.status === 'ok').length,
      illegal: classified.filter((r) => r.status === 'illegal').length,
      unknown: classified.filter((r) => r.status === 'unknown').length,
      duplicates,
    },
  }
}

/**
 * The rows that will actually become entries. `illegal` rows are kept when the
 * host says so — leagues do unban things on purpose — but never silently.
 */
export function committableRows(
  rows: ClassifiedRow[],
  opts: { allowIllegal?: boolean } = {},
): { speciesId: string; points: number; banned: boolean }[] {
  return rows
    .filter((r) => r.speciesId !== null && r.status !== 'duplicate')
    .filter((r) => r.status === 'ok' || (opts.allowIllegal && r.status === 'illegal'))
    .map((r) => ({ speciesId: r.speciesId!, points: r.points, banned: r.banned }))
}

export type Diff = {
  added: { speciesId: string; points: number }[]
  removed: { speciesId: string; points: number }[]
  repriced: { speciesId: string; from: number; to: number }[]
}

export function diffAgainst(
  next: { speciesId: string; points: number }[],
  current: { speciesId: string; points: number }[],
): Diff {
  const currentBy = new Map(current.map((e) => [e.speciesId, e.points]))
  const nextBy = new Map(next.map((e) => [e.speciesId, e.points]))

  const added: Diff['added'] = []
  const repriced: Diff['repriced'] = []
  for (const [speciesId, points] of nextBy) {
    const before = currentBy.get(speciesId)
    if (before === undefined) added.push({ speciesId, points })
    else if (before !== points) repriced.push({ speciesId, from: before, to: points })
  }

  const removed: Diff['removed'] = []
  for (const [speciesId, points] of currentBy) {
    if (!nextBy.has(speciesId)) removed.push({ speciesId, points })
  }

  return { added, removed, repriced }
}
