import { and, count, type Database, desc, eq, schema, sql } from '@pokedraft/db'
import { ERROR_CODES } from '@pokedraft/shared'
import { conflict, notFound } from '../../errors'
import { getLeagueOr404 } from '../leagues/service'
import { assertStatus } from '../leagues/status'
import { recordAudit } from '../system/service'
import { type ClassifiedRow, classifyRows, committableRows, diffAgainst } from './classify'
import { parsePointsYml } from './parse'

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

  const parsed = parsePointsYml(source)
  const { rows, summary } = classifyRows(parsed, league.formatId)
  const next = committableRows(rows, opts)

  const current = await activeList(db, leagueId)
  const currentEntries = current ? await listEntries(db, current.id) : []
  const diff = diffAgainst(next, currentEntries)

  return {
    hash: hashRows(next, opts.allowIllegal ?? false),
    summary,
    diff,
    rows,
    nextVersion: (current?.version ?? 0) + 1,
  }
}

function hashRows(
  rows: { speciesId: string; points: number; banned: boolean }[],
  allowIllegal: boolean,
): string {
  const canonical = [...rows]
    .sort((a, b) => a.speciesId.localeCompare(b.speciesId))
    .map((r) => `${r.speciesId}:${r.points}:${r.banned ? 1 : 0}`)
    .join('\n')
  return new Bun.CryptoHasher('sha256')
    .update(`${allowIllegal ? 'illegal-ok' : 'strict'}\n${canonical}`)
    .digest('hex')
}

export async function commitImport(
  db: Database,
  leagueId: string,
  userId: string,
  input: { source: string; hash: string; name?: string; allowIllegal?: boolean },
) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup'])

  const parsed = parsePointsYml(input.source)
  const { rows } = classifyRows(parsed, league.formatId)
  const next = committableRows(rows, { allowIllegal: input.allowIllegal })

  const hash = hashRows(next, input.allowIllegal ?? false)
  if (hash !== input.hash) {
    throw conflict(
      ERROR_CODES.PREVIEW_STALE,
      'this file no longer matches the preview you were shown — preview it again',
      { expected: hash, received: input.hash },
    )
  }

  const current = await activeList(db, leagueId)
  if (current?.lockedAt) {
    throw conflict(
      ERROR_CODES.LEAGUE_INVALID_STATUS,
      'the points list is locked because the draft has started',
    )
  }

  return db.transaction(async (tx) => {
    const [list] = await tx
      .insert(schema.pointLists)
      .values({
        leagueId,
        version: (current?.version ?? 0) + 1,
        name: input.name ?? null,
        source: 'yml_upload',
        rawSource: input.source,
        createdBy: userId,
      })
      .returning()
    if (!list) throw new Error('point list insert returned nothing')

    if (next.length > 0) {
      await tx.insert(schema.pointEntries).values(next.map((r) => ({ pointListId: list.id, ...r })))
    }

    await recordAudit(tx, {
      actorId: userId,
      leagueId,
      action: 'points.imported',
      targetType: 'point_list',
      targetId: list.id,
      meta: { version: list.version, entries: next.length },
    })

    return { list, entryCount: next.length }
  })
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

  return db.transaction(async (tx) => {
    const [list] = await tx
      .insert(schema.pointLists)
      .values({
        leagueId,
        version: current.version + 1,
        name: current.name,
        source: 'manual',
        rawSource: current.rawSource,
        createdBy: userId,
      })
      .returning()
    if (!list) throw new Error('point list insert returned nothing')

    if (nextEntries.length > 0) {
      await tx
        .insert(schema.pointEntries)
        .values(nextEntries.map((e) => ({ pointListId: list.id, ...e })))
    }
    await recordAudit(tx, {
      actorId: userId,
      leagueId,
      action: 'points.entry_edited',
      targetType: 'point_list',
      targetId: list.id,
      meta: { speciesId, patch },
    })
    return { list, entryCount: nextEntries.length }
  })
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
