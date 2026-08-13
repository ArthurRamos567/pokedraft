import { and, asc, count, type Database, desc, eq, schema, sql } from '@pokedraft/db'

export type League = typeof schema.leagues.$inferSelect
export type LeagueSettings = typeof schema.leagueSettings.$inferSelect
export type LeagueMember = typeof schema.leagueMembers.$inferSelect
export type LeagueInvite = typeof schema.leagueInvites.$inferSelect

export function findLeagueById(db: Database, leagueId: string) {
  return db.query.leagues.findFirst({ where: eq(schema.leagues.id, leagueId) })
}

export function findLeagueBySlug(db: Database, slug: string) {
  return db.query.leagues.findFirst({ where: eq(schema.leagues.slug, slug) })
}

export function findSettings(db: Database, leagueId: string) {
  return db.query.leagueSettings.findFirst({
    where: eq(schema.leagueSettings.leagueId, leagueId),
  })
}

export function findMembership(db: Database, leagueId: string, userId: string) {
  return db.query.leagueMembers.findFirst({
    where: and(
      eq(schema.leagueMembers.leagueId, leagueId),
      eq(schema.leagueMembers.userId, userId),
      eq(schema.leagueMembers.status, 'active'),
    ),
  })
}

export function listMembers(db: Database, leagueId: string) {
  return db
    .select({
      id: schema.leagueMembers.id,
      userId: schema.leagueMembers.userId,
      role: schema.leagueMembers.role,
      teamName: schema.leagueMembers.teamName,
      teamLogoUrl: schema.leagueMembers.teamLogoUrl,
      draftPosition: schema.leagueMembers.draftPosition,
      status: schema.leagueMembers.status,
      joinedAt: schema.leagueMembers.joinedAt,
      displayName: schema.user.displayName,
      name: schema.user.name,
      avatarUrl: schema.user.avatarUrl,
      image: schema.user.image,
    })
    .from(schema.leagueMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.leagueMembers.userId))
    .where(eq(schema.leagueMembers.leagueId, leagueId))
    .orderBy(asc(schema.leagueMembers.joinedAt))
}

export async function countActiveMembers(db: Database, leagueId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.leagueMembers)
    .where(
      and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.status, 'active')),
    )
  return row?.n ?? 0
}

export function findInviteByCode(db: Database, code: string) {
  return db.query.leagueInvites.findFirst({ where: eq(schema.leagueInvites.code, code) })
}

export async function slugExists(db: Database, slug: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.leagues)
    .where(eq(schema.leagues.slug, slug))
  return (row?.n ?? 0) > 0
}

export type DirectoryQuery = {
  status?: (typeof schema.leagueStatus.enumValues)[number]
  q?: string
  limit: number
  offset: number
}

export async function listPublicLeagues(db: Database, query: DirectoryQuery) {
  const filters = [eq(schema.leagues.visibility, 'public')]
  if (query.status) filters.push(eq(schema.leagues.status, query.status))
  if (query.q) filters.push(sql`${schema.leagues.name} ilike ${`%${query.q}%`}`)
  const where = and(...filters)

  // One grouped join rather than a count query per league.
  const items = await db
    .select({
      id: schema.leagues.id,
      slug: schema.leagues.slug,
      name: schema.leagues.name,
      description: schema.leagues.description,
      status: schema.leagues.status,
      formatId: schema.leagues.formatId,
      logoUrl: schema.leagues.logoUrl,
      bannerUrl: schema.leagues.bannerUrl,
      createdAt: schema.leagues.createdAt,
      memberCount: count(schema.leagueMembers.id),
      maxMembers: schema.leagueSettings.maxMembers,
    })
    .from(schema.leagues)
    .leftJoin(
      schema.leagueMembers,
      and(
        eq(schema.leagueMembers.leagueId, schema.leagues.id),
        eq(schema.leagueMembers.status, 'active'),
      ),
    )
    .leftJoin(schema.leagueSettings, eq(schema.leagueSettings.leagueId, schema.leagues.id))
    .where(where)
    .groupBy(schema.leagues.id, schema.leagueSettings.maxMembers)
    .orderBy(desc(schema.leagues.createdAt))
    .limit(query.limit)
    .offset(query.offset)

  const [total] = await db.select({ n: count() }).from(schema.leagues).where(where)
  return { items, total: total?.n ?? 0 }
}

export async function listMyLeagues(db: Database, userId: string) {
  return db
    .select({
      id: schema.leagues.id,
      slug: schema.leagues.slug,
      name: schema.leagues.name,
      description: schema.leagues.description,
      status: schema.leagues.status,
      formatId: schema.leagues.formatId,
      visibility: schema.leagues.visibility,
      logoUrl: schema.leagues.logoUrl,
      bannerUrl: schema.leagues.bannerUrl,
      createdAt: schema.leagues.createdAt,
      role: schema.leagueMembers.role,
      teamName: schema.leagueMembers.teamName,
    })
    .from(schema.leagueMembers)
    .innerJoin(schema.leagues, eq(schema.leagues.id, schema.leagueMembers.leagueId))
    .where(and(eq(schema.leagueMembers.userId, userId), eq(schema.leagueMembers.status, 'active')))
    .orderBy(desc(schema.leagues.createdAt))
}
