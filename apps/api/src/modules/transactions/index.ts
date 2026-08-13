import { Elysia, t } from 'elysia'
import { db } from '../../db'
import { authPlugin } from '../../plugins/auth'
import { leaguePlugin, mustMember, mustUser } from '../../plugins/league'
import { publish } from '../../realtime/hub'
import {
  approve,
  castVote,
  checkTrade,
  getTradeOr404,
  listTrades,
  proposeTrade,
  respond,
  veto,
} from './service'

const TradeSchema = t.Object({
  id: t.String(),
  leagueId: t.String(),
  type: t.String(),
  status: t.String(),
  proposedBy: t.String(),
  counterparty: t.String(),
  note: t.Nullable(t.String()),
  respondedAt: t.Nullable(t.Date()),
  resolvedAt: t.Nullable(t.Date()),
  resolvedBy: t.Nullable(t.String()),
  expiresAt: t.Nullable(t.Date()),
  createdAt: t.Date(),
})

const ItemSchema = t.Object({
  id: t.String(),
  transactionId: t.String(),
  fromMemberId: t.String(),
  toMemberId: t.String(),
  speciesId: t.String(),
})

const touched = (leagueId: string) =>
  publish(leagueId, { topic: 'transactions', type: 'INVALIDATE', key: 'transactions' })

export const transactionsModule = new Elysia({
  prefix: '/leagues/:id/transactions',
  tags: ['transactions'],
})
  .use(authPlugin)
  .use(leaguePlugin)

  .post(
    '/',
    async ({ league, membership, body, status }) => {
      const member = mustMember(membership)
      const trade = await proposeTrade(db, league.id, member.id, body)
      touched(league.id)
      return status(201, trade)
    },
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      body: t.Object({
        counterpartyId: t.String({ format: 'uuid' }),
        gives: t.Array(t.String({ maxLength: 64 }), { maxItems: 12 }),
        gets: t.Array(t.String({ maxLength: 64 }), { maxItems: 12 }),
        note: t.Optional(t.String({ maxLength: 500 })),
        expiresInHours: t.Optional(t.Integer({ minimum: 1, maximum: 24 * 30 })),
      }),
      response: { 201: TradeSchema },
    },
  )

  /** Dry run for the trade builder — same checks, no writes. */
  .post(
    '/validate',
    ({ league, membership, body }) =>
      checkTrade(db, league.id, { proposerId: mustMember(membership).id, ...body }),
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      body: t.Object({
        counterpartyId: t.String({ format: 'uuid' }),
        gives: t.Array(t.String({ maxLength: 64 }), { maxItems: 12 }),
        gets: t.Array(t.String({ maxLength: 64 }), { maxItems: 12 }),
      }),
      response: t.Any(),
    },
  )

  .get('/', ({ league, query }) => listTrades(db, league.id, query), {
    league: 'member',
    params: t.Object({ id: t.String() }),
    query: t.Object({
      status: t.Optional(t.String({ maxLength: 20 })),
      memberId: t.Optional(t.String({ format: 'uuid' })),
    }),
    response: t.Array(t.Composite([TradeSchema, t.Object({ items: t.Array(ItemSchema) })])),
  })

  .get(
    '/:tradeId',
    async ({ league, params }) => {
      const { trade, items } = await getTradeOr404(db, league.id, params.tradeId)
      return { ...trade, items }
    },
    {
      league: 'member',
      params: t.Object({ id: t.String(), tradeId: t.String({ format: 'uuid' }) }),
      response: t.Composite([TradeSchema, t.Object({ items: t.Array(ItemSchema) })]),
    },
  )

  .post(
    '/:tradeId/accept',
    async ({ league, membership, params }) => {
      const trade = await respond(
        db,
        league.id,
        mustMember(membership).id,
        params.tradeId,
        'accept',
      )
      touched(league.id)
      return trade
    },
    {
      league: 'member',
      params: t.Object({ id: t.String(), tradeId: t.String({ format: 'uuid' }) }),
      response: TradeSchema,
      detail: { summary: 'Approves outright unless the league requires host sign-off.' },
    },
  )

  .post(
    '/:tradeId/reject',
    ({ league, membership, params }) =>
      respond(db, league.id, mustMember(membership).id, params.tradeId, 'reject'),
    {
      league: 'member',
      params: t.Object({ id: t.String(), tradeId: t.String({ format: 'uuid' }) }),
      response: TradeSchema,
    },
  )

  .post(
    '/:tradeId/cancel',
    ({ league, membership, params }) =>
      respond(db, league.id, mustMember(membership).id, params.tradeId, 'cancel'),
    {
      league: 'member',
      params: t.Object({ id: t.String(), tradeId: t.String({ format: 'uuid' }) }),
      response: TradeSchema,
    },
  )

  .post(
    '/:tradeId/approve',
    async ({ league, membership, params }) => {
      const trade = await approve(db, league.id, membership?.id ?? null, params.tradeId, {
        asHost: true,
      })
      touched(league.id)
      return trade
    },
    {
      league: 'host',
      params: t.Object({ id: t.String(), tradeId: t.String({ format: 'uuid' }) }),
      response: TradeSchema,
    },
  )

  .post(
    '/:tradeId/veto',
    ({ league, user, params }) => veto(db, league.id, mustUser(user).id, params.tradeId),
    {
      league: 'host',
      params: t.Object({ id: t.String(), tradeId: t.String({ format: 'uuid' }) }),
      response: TradeSchema,
    },
  )

  .post(
    '/:tradeId/vote',
    ({ league, membership, params, body }) =>
      castVote(db, league.id, mustMember(membership).id, params.tradeId, body.vote),
    {
      league: 'member',
      params: t.Object({ id: t.String(), tradeId: t.String({ format: 'uuid' }) }),
      body: t.Object({ vote: t.Union([t.Literal('approve'), t.Literal('veto')]) }),
      response: t.Object({ vetoes: t.Integer(), members: t.Integer() }),
      detail: { summary: 'Optional league-vote veto mode. A majority kills the trade.' },
    },
  )
