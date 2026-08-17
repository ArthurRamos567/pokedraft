import { type Database, schema } from '@pokedraft/db'
import { recordAudit } from '../system/service'

export type WritableEntry = {
  speciesId: string
  points: number
  banned: boolean
  notes?: string | null
}

export type WritePointListInput = {
  leagueId: string
  version: number
  entries: WritableEntry[]
  createdBy: string | null
  name?: string | null
  source?: 'yml_upload' | 'manual' | 'cloned'
  rawSource?: string | null
  /** Audit action; a fresh import and a single-entry edit read differently. */
  action?: string
  meta?: Record<string, unknown>
}

/**
 * Inserts one version of a price list. Takes whatever `Database` it is handed
 * so a caller that is already inside a transaction stays inside it — a league
 * created with its pool is one commit, not two.
 */
export async function writePointList(db: Database, input: WritePointListInput) {
  const [list] = await db
    .insert(schema.pointLists)
    .values({
      leagueId: input.leagueId,
      version: input.version,
      name: input.name ?? null,
      source: input.source ?? 'yml_upload',
      rawSource: input.rawSource ?? null,
      createdBy: input.createdBy,
    })
    .returning()
  if (!list) throw new Error('point list insert returned nothing')

  if (input.entries.length > 0) {
    await db
      .insert(schema.pointEntries)
      .values(input.entries.map((e) => ({ pointListId: list.id, ...e })))
  }

  await recordAudit(db, {
    actorId: input.createdBy,
    leagueId: input.leagueId,
    action: input.action ?? 'points.imported',
    targetType: 'point_list',
    targetId: list.id,
    meta: { version: list.version, entries: input.entries.length, ...input.meta },
  })

  return { list, entryCount: input.entries.length }
}
