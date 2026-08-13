import { and, type Database, desc, eq, isNull, schema, sql } from '@pokedraft/db'

export type AuditEntry = {
  actorId?: string | null
  leagueId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  meta?: Record<string, unknown>
}

/**
 * Fire-and-forget on purpose: a failed audit write must never fail the action
 * it was describing. Losing a trail row is bad; losing the trade is worse.
 */
export async function recordAudit(db: Database, entry: AuditEntry) {
  try {
    await db.insert(schema.auditLog).values({
      actorId: entry.actorId ?? null,
      leagueId: entry.leagueId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      meta: entry.meta ?? null,
    })
  } catch {
    // swallowed deliberately — see above
  }
}

export type NotificationInput = {
  userId: string
  leagueId?: string | null
  type: string
  title: string
  body?: string
  link?: string
}

export async function notify(db: Database, input: NotificationInput | NotificationInput[]) {
  const rows = (Array.isArray(input) ? input : [input]).map((n) => ({
    userId: n.userId,
    leagueId: n.leagueId ?? null,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
  }))
  if (rows.length === 0) return
  await db.insert(schema.notifications).values(rows)
}

export async function listNotifications(
  db: Database,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 25
  const offset = opts.offset ?? 0
  const where = opts.unreadOnly
    ? and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt))
    : eq(schema.notifications.userId, userId)

  const items = await db
    .select()
    .from(schema.notifications)
    .where(where)
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)
    .offset(offset)

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))

  return { items, unread: counted?.n ?? 0, limit, offset }
}

export async function markRead(db: Database, userId: string, ids: string[] | 'all') {
  const now = new Date()
  if (ids === 'all') {
    await db
      .update(schema.notifications)
      .set({ readAt: now })
      .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
    return
  }
  if (ids.length === 0) return
  await db
    .update(schema.notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        sql`${schema.notifications.id} = any(${ids}::uuid[])`,
      ),
    )
}
