import { ERROR_CODES } from '@pokedraft/shared'
import { conflict } from '../../errors'
import { type Classification, type ClassifiedRow, classifyRows, committableRows } from './classify'
import { parsePointsYml } from './parse'

export type PoolEntry = { speciesId: string; points: number; banned: boolean }

export type BuiltPool = {
  rows: ClassifiedRow[]
  summary: Classification['summary']
  /** The rows that would become entries, in commit order. */
  entries: PoolEntry[]
  hash: string
}

/**
 * Parse → classify → hash, with no IO at all. Preview and commit both go
 * through here, so the hash a host was shown is the hash a commit recomputes.
 */
export function buildPool(
  source: string,
  formatId: string,
  opts: { allowIllegal?: boolean } = {},
): BuiltPool {
  const { rows, summary } = classifyRows(parsePointsYml(source), formatId)
  const entries = committableRows(rows, opts)
  return { rows, summary, entries, hash: hashEntries(entries, opts.allowIllegal ?? false) }
}

export function hashEntries(entries: PoolEntry[], allowIllegal: boolean): string {
  const canonical = [...entries]
    .sort((a, b) => a.speciesId.localeCompare(b.speciesId))
    .map((r) => `${r.speciesId}:${r.points}:${r.banned ? 1 : 0}`)
    .join('\n')
  return new Bun.CryptoHasher('sha256')
    .update(`${allowIllegal ? 'illegal-ok' : 'strict'}\n${canonical}`)
    .digest('hex')
}

/** Nobody commits a diff they did not see. */
export function assertFreshHash(built: BuiltPool, given: string) {
  if (built.hash !== given) {
    throw conflict(
      ERROR_CODES.PREVIEW_STALE,
      'this file no longer matches the preview you were shown — preview it again',
      { expected: built.hash, received: given },
    )
  }
}
