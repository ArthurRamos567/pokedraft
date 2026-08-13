import { and, asc, type Database, desc, eq, inArray, or, schema, sql } from '@pokedraft/db'
import { toID } from '@pokedraft/dex'
import { ERROR_CODES } from '@pokedraft/shared'
import { conflict, DomainError, forbidden, notFound } from '../../errors'
import { getLeagueOr404 } from '../leagues/service'
import { activeSeason } from '../season/service'
import { notify, recordAudit } from '../system/service'
import { leagueRosters } from '../teams/roster'
import { type TradeRules, type TradeValidation, validateTrade } from './validate'

async function rules(db: Database, leagueId: string): Promise<TradeRules> {
  const league = await getLeagueOr404(db, leagueId)
  const settings = await db.query.leagueSettings.findFirst({
    where: eq(schema.leagueSettings.leagueId, leagueId),
  })
  if (!settings) throw notFound(ERROR_CODES.LEAGUE_NOT_FOUND, 'league settings missing')

  const season = await activeSeason(db, leagueId)
  let currentWeek: number | null = null
  if (season) {
    const [open] = await db
      .select({ number: schema.weeks.number })
      .from(schema.weeks)
      .where(and(eq(schema.weeks.seasonId, season.id), eq(schema.weeks.status, 'open')))
      .orderBy(desc(schema.weeks.number))
      .limit(1)
    currentWeek = open?.number ?? null
  }

  return {
    tradesEnabled: settings.tradesEnabled,
    leagueStatus: league.status,
    rosterMin: settings.rosterMin,
    rosterMax: settings.rosterMax,
    budget: settings.budget,
    // Off unless a league opts in: most let value drift after the draft, which
    // is rather the point of trading.
    enforcePostTradeCap: false,
    tradeDeadlineWeek: settings.tradeDeadlineWeek,
    currentWeek,
  }
}

async function sides(
  db: Database,
  leagueId: string,
  proposerId: string,
  counterpartyId: string,
  gives: string[],
  gets: string[],
) {
  const rosters = await leagueRosters(db, leagueId)
  const members = await db
    .select({ id: schema.leagueMembers.id, status: schema.leagueMembers.status })
    .from(schema.leagueMembers)
    .where(inArray(schema.leagueMembers.id, [proposerId, counterpartyId]))

  const statusOf = new Map(members.map((m) => [m.id, m.status]))
  return {
    a: {
      memberId: proposerId,
      active: statusOf.get(proposerId) === 'active',
      roster: rosters.get(proposerId)?.entries ?? [],
      gives: gives.map(toID),
    },
    b: {
      memberId: counterpartyId,
      active: statusOf.get(counterpartyId) === 'active',
      roster: rosters.get(counterpartyId)?.entries ?? [],
      gives: gets.map(toID),
    },
  }
}

export async function checkTrade(
  db: Database,
  leagueId: string,
  input: { proposerId: string; counterpartyId: string; gives: string[]; gets: string[] },
): Promise<TradeValidation> {
  const r = await rules(db, leagueId)
  const { a, b } = await sides(
    db,
    leagueId,
    input.proposerId,
    input.counterpartyId,
    input.gives,
    input.gets,
  )
  return validateTrade(r, a, b)
}

function refuse(validation: Extract<TradeValidation, { ok: false }>): never {
  const first = validation.problems[0]!
  throw new DomainError(ERROR_CODES.TRADE_INVALID, first.message, 422, {
    problems: validation.problems,
  })
}

export async function proposeTrade(
  db: Database,
  leagueId: string,
  proposerId: string,
  input: {
    counterpartyId: string
    gives: string[]
    gets: string[]
    note?: string
    expiresInHours?: number
  },
) {
  const validation = await checkTrade(db, leagueId, { proposerId, ...input })
  if (!validation.ok) refuse(validation)

  const expiresAt = new Date(Date.now() + (input.expiresInHours ?? 72) * 3600_000)

  return db.transaction(async (tx) => {
    const [trade] = await tx
      .insert(schema.transactions)
      .values({
        leagueId,
        proposedBy: proposerId,
        counterparty: input.counterpartyId,
        note: input.note ?? null,
        expiresAt,
      })
      .returning()
    if (!trade) throw new Error('transaction insert returned nothing')

    const items = [
      ...input.gives.map((speciesId) => ({
        transactionId: trade.id,
        fromMemberId: proposerId,
        toMemberId: input.counterpartyId,
        speciesId: toID(speciesId),
      })),
      ...input.gets.map((speciesId) => ({
        transactionId: trade.id,
        fromMemberId: input.counterpartyId,
        toMemberId: proposerId,
        speciesId: toID(speciesId),
      })),
    ]
    if (items.length > 0) await tx.insert(schema.transactionItems).values(items)

    const other = await tx.query.leagueMembers.findFirst({
      where: eq(schema.leagueMembers.id, input.counterpartyId),
    })
    if (other) {
      await notify(tx, {
        userId: other.userId,
        leagueId,
        type: 'trade.proposed',
        title: 'You have a trade offer',
        link: `/leagues/${leagueId}/trades`,
      })
    }
    return trade
  })
}

export async function getTradeOr404(db: Database, leagueId: string, tradeId: string) {
  const trade = await db.query.transactions.findFirst({
    where: and(eq(schema.transactions.id, tradeId), eq(schema.transactions.leagueId, leagueId)),
  })
  if (!trade) throw notFound(ERROR_CODES.TRANSACTION_NOT_FOUND, 'trade not found')

  const items = await db
    .select()
    .from(schema.transactionItems)
    .where(eq(schema.transactionItems.transactionId, tradeId))
  return { trade, items }
}

export async function listTrades(
  db: Database,
  leagueId: string,
  filter: { status?: string; memberId?: string } = {},
) {
  const conditions = [eq(schema.transactions.leagueId, leagueId)]
  if (filter.status) {
    conditions.push(
      eq(
        schema.transactions.status,
        filter.status as (typeof schema.transactionStatus.enumValues)[number],
      ),
    )
  }
  if (filter.memberId) {
    const involved = or(
      eq(schema.transactions.proposedBy, filter.memberId),
      eq(schema.transactions.counterparty, filter.memberId),
    )
    if (involved) conditions.push(involved)
  }

  const trades = await db
    .select()
    .from(schema.transactions)
    .where(and(...conditions))
    .orderBy(desc(schema.transactions.createdAt))
    .limit(100)

  const ids = trades.map((t) => t.id)
  const items =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(schema.transactionItems)
          .where(inArray(schema.transactionItems.transactionId, ids))
          .orderBy(asc(schema.transactionItems.speciesId))

  return trades.map((t) => ({
    ...t,
    items: items.filter((i) => i.transactionId === t.id),
  }))
}

/**
 * The counterparty accepting is what moves a trade forward. Whether that lands
 * on `approved` or waits for the host is a league setting.
 */
export async function respond(
  db: Database,
  leagueId: string,
  memberId: string,
  tradeId: string,
  action: 'accept' | 'reject' | 'cancel',
) {
  const { trade } = await getTradeOr404(db, leagueId, tradeId)
  if (trade.status !== 'pending') {
    throw conflict(ERROR_CODES.TRADE_NOT_PENDING, `this trade is already ${trade.status}`)
  }

  if (action === 'cancel') {
    if (trade.proposedBy !== memberId) throw forbidden('only the proposer can cancel')
    return setStatus(db, leagueId, tradeId, 'cancelled', memberId)
  }

  if (trade.counterparty !== memberId) throw forbidden('only the other side can answer a trade')
  if (action === 'reject') return setStatus(db, leagueId, tradeId, 'rejected', memberId)

  const settings = await db.query.leagueSettings.findFirst({
    where: eq(schema.leagueSettings.leagueId, leagueId),
  })
  if (settings?.tradesRequireHostApproval) {
    return setStatus(db, leagueId, tradeId, 'accepted', memberId)
  }
  return approve(db, leagueId, memberId, tradeId, { asHost: false })
}

async function setStatus(
  db: Database,
  leagueId: string,
  tradeId: string,
  status: (typeof schema.transactionStatus.enumValues)[number],
  actorMemberId: string | null,
) {
  const [updated] = await db
    .update(schema.transactions)
    .set({ status, respondedAt: new Date() })
    .where(eq(schema.transactions.id, tradeId))
    .returning()
  await recordAudit(db, {
    leagueId,
    action: `trade.${status}`,
    targetType: 'transaction',
    targetId: tradeId,
    meta: { actorMemberId },
  })
  return updated!
}

/**
 * The correctness-critical path. Both member rows are locked **in id order**
 * before anything is revalidated: two mirrored trades approved at the same
 * instant would otherwise take the locks in opposite orders and deadlock.
 *
 * Revalidation happens inside the lock because rosters move between propose
 * and approve — that is the whole reason the check runs twice.
 */
export async function approve(
  db: Database,
  leagueId: string,
  actorMemberId: string | null,
  tradeId: string,
  opts: { asHost: boolean },
) {
  return db.transaction(async (tx) => {
    const { trade, items } = await getTradeOr404(tx, leagueId, tradeId)
    if (trade.status !== 'pending' && trade.status !== 'accepted') {
      throw conflict(ERROR_CODES.TRADE_NOT_PENDING, `this trade is already ${trade.status}`)
    }

    const ordered = [trade.proposedBy, trade.counterparty].sort()
    await tx
      .select({ id: schema.leagueMembers.id })
      .from(schema.leagueMembers)
      .where(inArray(schema.leagueMembers.id, ordered))
      .orderBy(asc(schema.leagueMembers.id))
      .for('update')

    const gives = items.filter((i) => i.fromMemberId === trade.proposedBy).map((i) => i.speciesId)
    const gets = items.filter((i) => i.fromMemberId === trade.counterparty).map((i) => i.speciesId)

    const validation = await checkTrade(tx, leagueId, {
      proposerId: trade.proposedBy,
      counterpartyId: trade.counterparty,
      gives,
      gets,
    })
    if (!validation.ok) refuse(validation)

    const [updated] = await tx
      .update(schema.transactions)
      .set({ status: 'approved', resolvedAt: new Date(), respondedAt: new Date() })
      .where(eq(schema.transactions.id, tradeId))
      .returning()

    await recordAudit(tx, {
      leagueId,
      action: 'trade.approved',
      targetType: 'transaction',
      targetId: tradeId,
      meta: { asHost: opts.asHost, actorMemberId, gives, gets },
    })

    for (const memberId of [trade.proposedBy, trade.counterparty]) {
      const member = await tx.query.leagueMembers.findFirst({
        where: eq(schema.leagueMembers.id, memberId),
      })
      if (member) {
        await notify(tx, {
          userId: member.userId,
          leagueId,
          type: 'trade.approved',
          title: 'A trade went through',
          link: `/leagues/${leagueId}/trades`,
        })
      }
    }

    return updated!
  })
}

export async function veto(db: Database, leagueId: string, actorId: string, tradeId: string) {
  const { trade } = await getTradeOr404(db, leagueId, tradeId)
  if (trade.status === 'approved') {
    throw conflict(ERROR_CODES.TRADE_NOT_PENDING, 'an approved trade cannot be vetoed')
  }
  return setStatus(db, leagueId, tradeId, 'vetoed', actorId)
}

export async function castVote(
  db: Database,
  leagueId: string,
  memberId: string,
  tradeId: string,
  vote: 'approve' | 'veto',
) {
  await getTradeOr404(db, leagueId, tradeId)
  await db
    .insert(schema.transactionVotes)
    .values({ transactionId: tradeId, memberId, vote })
    .onConflictDoUpdate({
      target: [schema.transactionVotes.transactionId, schema.transactionVotes.memberId],
      set: { vote },
    })

  const votes = await db
    .select({ vote: schema.transactionVotes.vote })
    .from(schema.transactionVotes)
    .where(eq(schema.transactionVotes.transactionId, tradeId))

  const vetoes = votes.filter((v) => v.vote === 'veto').length
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.leagueMembers)
    .where(
      and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.status, 'active')),
    )

  // A simple majority of the league is what kills a trade in vote mode.
  if (vetoes > n / 2) {
    await setStatus(db, leagueId, tradeId, 'vetoed', null)
  }
  return { vetoes, members: n }
}

/**
 * Expiry is a status change, not a cascade. A pending trade whose mon has since
 * moved is left alone deliberately — it fails its own revalidation at approval
 * with NOT_ON_ROSTER, which is the honest answer and needs no bookkeeping.
 */
export async function expireStale(db: Database) {
  const expired = await db
    .update(schema.transactions)
    .set({ status: 'expired', resolvedAt: new Date() })
    .where(
      and(
        inArray(schema.transactions.status, ['pending', 'accepted']),
        sql`${schema.transactions.expiresAt} < now()`,
      ),
    )
    .returning({ id: schema.transactions.id })
  return expired.length
}
