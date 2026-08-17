import { and, count, type Database, desc, eq, schema, sql } from '@pokedraft/db'
import { ERROR_CODES } from '@pokedraft/shared'
import { conflict, notFound } from '../../errors'
import { getLeagueOr404 } from '../leagues/service'
import { assertStatus } from '../leagues/status'
import { assertFreshHash, buildPool } from './build'
import { type ClassifiedRow, diffAgainst } from './classify'
import { writePointList } from './repo'

export async function activeList(db: Database, leagueId: string) {
  return db.query.pointLists.findFirst({
    where: eq(schema.pointLists.leagueId, leagueId),
    orderBy: [desc(schema.pointLists.version)],
  })
}

export async function listEntries(db: Database, pointListId: string) {
  return db
    .select({
      speciesId: schema.pointEntries.speciesId,
      points: schema.pointEntries.points,
      banned: schema.pointEntries.banned,
      notes: schema.pointEntries.notes,
    })
    .from(schema.pointEntries)
    .where(eq(schema.pointEntries.pointListId, pointListId))
    .orderBy(desc(schema.pointEntries.points))
}

export async function listVersions(db: Database, leagueId: string) {
  return db
    .select({
      id: schema.pointLists.id,
      version: schema.pointLists.version,
      name: schema.pointLists.name,
      source: schema.pointLists.source,
      lockedAt: schema.pointLists.lockedAt,
      createdAt: schema.pointLists.createdAt,
      createdBy: schema.pointLists.createdBy,
      entryCount: count(schema.pointEntries.id),
    })
    .from(schema.pointLists)
    .leftJoin(schema.pointEntries, eq(schema.pointEntries.pointListId, schema.pointLists.id))
    .where(eq(schema.pointLists.leagueId, leagueId))
    .groupBy(schema.pointLists.id)
    .orderBy(desc(schema.pointLists.version))
}

export type Preview = {
  hash: string
  summary: { ok: number; illegal: number; unknown: number; duplicates: number }
  diff: ReturnType<typeof diffAgainst>
  rows: ClassifiedRow[]
  nextVersion: number
}

/**
 * The preview writes nothing. Its hash covers exactly the rows that would be
 * committed, so a commit carrying a stale hash is rejected rather than
 * applying a diff nobody looked at.
 */
export async function previewImport(
  db: Database,
  leagueId: string,
  source: string,
  opts: { allowIllegal?: boolean } = {},
): Promise<Preview> {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup'])

  const built = buildPool(source, league.formatId, opts)

  const current = await activeList(db, leagueId)
  const currentEntries = current ? await listEntries(db, current.id) : []

  return {
    hash: built.hash,
    summary: built.summary,
    diff: diffAgainst(built.entries, currentEntries),
    rows: built.rows,
    nextVersion: (current?.version ?? 0) + 1,
  }
}

export async function commitImport(
  db: Database,
  leagueId: string,
  userId: string,
  input: { source: string; hash: string; name?: string; allowIllegal?: boolean },
) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup'])

  const built = buildPool(input.source, league.formatId, { allowIllegal: input.allowIllegal })
  assertFreshHash(built, input.hash)

  const current = await activeList(db, leagueId)
  if (current?.lockedAt) {
    throw conflict(
      ERROR_CODES.LEAGUE_INVALID_STATUS,
      'the points list is locked because the draft has started',
    )
  }

  return db.transaction(async (tx) =>
    writePointList(tx, {
      leagueId,
      version: (current?.version ?? 0) + 1,
      entries: built.entries,
      createdBy: userId,
      name: input.name ?? null,
      rawSource: input.source,
    }),
  )
}

/**
 * A single-mon tweak still creates a version. Prices are what a pick cost, and
 * rewriting history in place would make an old draft unauditable.
 */
export async function editEntry(
  db: Database,
  leagueId: string,
  userId: string,
  speciesId: string,
  patch: { points?: number; banned?: boolean; notes?: string | null; remove?: boolean },
) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup'])

  const current = await activeList(db, leagueId)
  if (!current) throw notFound(ERROR_CODES.POINTS_LIST_NOT_FOUND, 'no points list to edit')
  if (current.lockedAt) {
    throw conflict(ERROR_CODES.LEAGUE_INVALID_STATUS, 'the points list is locked')
  }

  const entries = await listEntries(db, current.id)
  const nextEntries = entries.filter((e) => !(patch.remove && e.speciesId === speciesId))
  const target = nextEntries.find((e) => e.speciesId === speciesId)

  if (!patch.remove) {
    if (target) {
      if (patch.points !== undefined) target.points = patch.points
      if (patch.banned !== undefined) target.banned = patch.banned
      if (patch.notes !== undefined) target.notes = patch.notes
    } else {
      nextEntries.push({
        speciesId,
        points: patch.points ?? 0,
        banned: patch.banned ?? false,
        notes: patch.notes ?? null,
      })
    }
  }

  return db.transaction(async (tx) =>
    writePointList(tx, {
      leagueId,
      version: current.version + 1,
      entries: nextEntries,
      createdBy: userId,
      name: current.name,
      source: 'manual',
      rawSource: current.rawSource,
      action: 'points.entry_edited',
      meta: { speciesId, patch },
    }),
  )
}

/** Called when the draft starts — after this the prices are history. */
export async function lockActiveList(db: Database, leagueId: string) {
  const current = await activeList(db, leagueId)
  if (!current) return null
  const [locked] = await db
    .update(schema.pointLists)
    .set({ lockedAt: new Date() })
    .where(and(eq(schema.pointLists.id, current.id), sql`${schema.pointLists.lockedAt} is null`))
    .returning()
  return locked ?? current
}
