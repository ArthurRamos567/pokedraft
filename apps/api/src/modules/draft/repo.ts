import { asc, type Database, eq, schema, sql } from '@pokedraft/db'
import type { DraftEvent, DraftState } from '@pokedraft/draft'

export type DraftRow = typeof schema.drafts.$inferSelect

export function findDraft(db: Database, leagueId: string) {
  return db.query.drafts.findFirst({ where: eq(schema.drafts.leagueId, leagueId) })
}

/**
 * The write lock. Every mutation takes this row first, so two picks landing in
 * the same millisecond serialize instead of both reading a stale `seq`.
 */
export async function lockDraft(db: Database, draftId: string) {
  const [row] = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.id, draftId))
    .for('update')
  return row ?? null
}

export async function readEvents(db: Database, draftId: string, since = -1) {
  const rows = await db
    .select({
      seq: schema.draftEvents.seq,
      type: schema.draftEvents.type,
      payload: schema.draftEvents.payload,
      actorId: schema.draftEvents.actorId,
      createdAt: schema.draftEvents.createdAt,
    })
    .from(schema.draftEvents)
    .where(
      since >= 0
        ? sql`${schema.draftEvents.draftId} = ${draftId} and ${schema.draftEvents.seq} > ${since}`
        : eq(schema.draftEvents.draftId, draftId),
    )
    .orderBy(asc(schema.draftEvents.seq))
  return rows
}

export function toDomainEvents(
  rows: { type: string; payload: Record<string, unknown> }[],
): DraftEvent[] {
  return rows.map((r) => ({ type: r.type, ...r.payload }) as DraftEvent)
}

export async function appendEvents(
  db: Database,
  draftId: string,
  startSeq: number,
  events: DraftEvent[],
  actorId: string | null,
) {
  if (events.length === 0) return []
  const rows = events.map((e, i) => {
    const { type, ...payload } = e
    return {
      draftId,
      seq: startSeq + i + 1,
      type,
      payload: payload as Record<string, unknown>,
      actorId,
    }
  })
  await db.insert(schema.draftEvents).values(rows)
  return rows
}

/** State member ids are `league_members.id`, so the projection is a direct copy. */
export async function insertPickProjections(
  db: Database,
  draftId: string,
  events: DraftEvent[],
  state: DraftState,
) {
  const picks = events.filter(
    (e): e is Extract<DraftEvent, { type: 'PICK_MADE' }> => e.type === 'PICK_MADE',
  )
  if (picks.length === 0) return
  await db.insert(schema.draftPicks).values(
    picks.map((p) => ({
      draftId,
      memberId: p.memberId,
      speciesId: p.speciesId,
      cost: p.cost,
      round: state.teams[p.memberId]?.picks.find((x) => x.pickNo === p.pickNo)?.round ?? 0,
      pickNo: p.pickNo,
    })),
  )
}

export async function saveState(db: Database, draftId: string, state: DraftState, seq: number) {
  await db
    .update(schema.drafts)
    .set({
      state: state as unknown as Record<string, unknown>,
      seq,
      status: state.status,
      ...(state.status === 'complete' ? { completedAt: new Date() } : {}),
    })
    .where(eq(schema.drafts.id, draftId))
}

export async function truncateFrom(db: Database, draftId: string, seq: number) {
  await db
    .delete(schema.draftEvents)
    .where(sql`${schema.draftEvents.draftId} = ${draftId} and ${schema.draftEvents.seq} >= ${seq}`)
}

export async function deletePicksFrom(db: Database, draftId: string, pickNo: number) {
  await db
    .delete(schema.draftPicks)
    .where(
      sql`${schema.draftPicks.draftId} = ${draftId} and ${schema.draftPicks.pickNo} >= ${pickNo}`,
    )
}

export function readQueue(db: Database, memberId: string) {
  return db
    .select({ speciesId: schema.draftQueues.speciesId, rank: schema.draftQueues.rank })
    .from(schema.draftQueues)
    .where(eq(schema.draftQueues.memberId, memberId))
    .orderBy(asc(schema.draftQueues.rank))
}

export async function replaceQueue(db: Database, memberId: string, speciesIds: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(schema.draftQueues).where(eq(schema.draftQueues.memberId, memberId))
    if (speciesIds.length > 0) {
      await tx
        .insert(schema.draftQueues)
        .values(speciesIds.map((speciesId, rank) => ({ memberId, speciesId, rank })))
    }
  })
}

/** Drafts whose clock has run out. Ordered so the job is deterministic. */
export function findExpired(db: Database, now: Date) {
  return db
    .select({ id: schema.drafts.id, leagueId: schema.drafts.leagueId })
    .from(schema.drafts)
    .where(
      sql`${schema.drafts.status} = 'active'
          and (${schema.drafts.state} ->> 'deadline') is not null
          and (${schema.drafts.state} ->> 'deadline')::bigint < ${now.getTime()}`,
    )
    .orderBy(asc(schema.drafts.id))
}
