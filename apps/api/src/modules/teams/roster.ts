import { and, type Database, eq, schema } from '@pokedraft/db'

export type RosterEntry = {
  speciesId: string
  /** What it cost at the draft. Trades move a mon; they don't reprice it. */
  cost: number
  /** Null when the mon arrived by trade rather than by draft. */
  pickNo: number | null
  acquired: 'draft' | 'trade'
}

export type Roster = {
  memberId: string
  entries: RosterEntry[]
  spent: number
}

/**
 * THE roster definition:
 *
 *     roster = picks − traded away + traded for
 *
 * Every consumer — draft validation, trade validation, standings, the
 * visualizer — calls this. A second implementation is a bug, not an
 * optimisation.
 *
 * Scoped by league rather than by member on purpose: a mon traded *to* you was
 * drafted by somebody else, so resolving ownership needs the whole league's
 * picks. Narrowing the pick query to one member silently loses everything they
 * acquired by trade.
 */
export async function leagueRosters(db: Database, leagueId: string): Promise<Map<string, Roster>> {
  const members = await db
    .select({ id: schema.leagueMembers.id })
    .from(schema.leagueMembers)
    .where(eq(schema.leagueMembers.leagueId, leagueId))

  const rosters = new Map<string, Roster>(
    members.map((m) => [m.id, { memberId: m.id, entries: [], spent: 0 }]),
  )
  if (members.length === 0) return rosters

  const picks = await db
    .select({
      memberId: schema.draftPicks.memberId,
      speciesId: schema.draftPicks.speciesId,
      cost: schema.draftPicks.cost,
      pickNo: schema.draftPicks.pickNo,
    })
    .from(schema.draftPicks)
    .innerJoin(schema.leagueMembers, eq(schema.leagueMembers.id, schema.draftPicks.memberId))
    .where(eq(schema.leagueMembers.leagueId, leagueId))

  // Only approved trades move anything. A pending or vetoed trade is a
  // proposal, and proposals do not own Pokémon.
  const moves = await db
    .select({
      speciesId: schema.transactionItems.speciesId,
      fromMemberId: schema.transactionItems.fromMemberId,
      toMemberId: schema.transactionItems.toMemberId,
      at: schema.transactions.resolvedAt,
    })
    .from(schema.transactionItems)
    .innerJoin(
      schema.transactions,
      eq(schema.transactions.id, schema.transactionItems.transactionId),
    )
    .where(
      and(eq(schema.transactions.leagueId, leagueId), eq(schema.transactions.status, 'approved')),
    )

  const costOf = new Map<string, number>()
  const owner = new Map<
    string,
    { memberId: string; pickNo: number | null; acquired: 'draft' | 'trade' }
  >()
  for (const p of picks) {
    costOf.set(p.speciesId, p.cost)
    owner.set(p.speciesId, { memberId: p.memberId, pickNo: p.pickNo, acquired: 'draft' })
  }

  // Chains matter: A→B→C must land on C, so moves are applied in resolution
  // order rather than treated as one simultaneous swap.
  const ordered = [...moves].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
  for (const m of ordered) {
    if (!owner.has(m.speciesId)) continue
    owner.set(m.speciesId, { memberId: m.toMemberId, pickNo: null, acquired: 'trade' })
  }

  for (const [speciesId, info] of owner) {
    const roster = rosters.get(info.memberId)
    if (!roster) continue
    const cost = costOf.get(speciesId) ?? 0
    roster.entries.push({ speciesId, cost, pickNo: info.pickNo, acquired: info.acquired })
    roster.spent += cost
  }

  for (const roster of rosters.values()) {
    roster.entries.sort((a, b) => b.cost - a.cost || a.speciesId.localeCompare(b.speciesId))
  }
  return rosters
}

async function leagueOf(db: Database, memberId: string): Promise<string | null> {
  const member = await db.query.leagueMembers.findFirst({
    where: eq(schema.leagueMembers.id, memberId),
  })
  return member?.leagueId ?? null
}

export async function rosterFor(db: Database, memberId: string): Promise<Roster> {
  const leagueId = await leagueOf(db, memberId)
  const empty = { memberId, entries: [], spent: 0 }
  if (!leagueId) return empty
  const rosters = await leagueRosters(db, leagueId)
  return rosters.get(memberId) ?? empty
}

export async function rostersFor(
  db: Database,
  leagueId: string,
  memberIds: string[],
): Promise<Map<string, Roster>> {
  const all = await leagueRosters(db, leagueId)
  return new Map(
    memberIds.map((id) => [id, all.get(id) ?? { memberId: id, entries: [], spent: 0 }]),
  )
}
