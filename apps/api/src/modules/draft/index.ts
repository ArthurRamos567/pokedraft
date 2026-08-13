import { toID } from '@pokedraft/dex'
import type { DraftState } from '@pokedraft/draft'
import { affordableSpecies, availableSpecies, remainingBudget } from '@pokedraft/draft'
import { ERROR_CODES } from '@pokedraft/shared'
import { Elysia, t } from 'elysia'
import { db } from '../../db'
import { badRequest, forbidden } from '../../errors'
import { authPlugin } from '../../plugins/auth'
import { leaguePlugin, mustMember, mustUser } from '../../plugins/league'
import { publishDraftEvents } from '../../realtime/hub'
import { readEvents, readQueue, replaceQueue } from './repo'
import {
  type CommitResult,
  getDraftOr404,
  pause,
  pick,
  rebuildFromEvents,
  resume,
  skip,
  startLeagueDraft,
  undoLastPick,
} from './service'

const StateSchema = t.Any()

const CommitResponse = t.Object({
  seq: t.Integer(),
  state: StateSchema,
  warnings: t.Array(t.String()),
})

/** Broadcast happens after the transaction commits, never inside it. */
function broadcast(leagueId: string, result: CommitResult | null) {
  if (!result) return
  publishDraftEvents(leagueId, result.events, result.seq - result.events.length)
}

export const draftModule = new Elysia({ prefix: '/leagues/:id/draft', tags: ['draft'] })
  .use(authPlugin)
  .use(leaguePlugin)

  .post(
    '/start',
    async ({ league, user, status }) => {
      const { draft, state, events } = await startLeagueDraft(db, league.id, mustUser(user).id)
      publishDraftEvents(league.id, events, 0)
      return status(201, { id: draft.id, seq: events.length, state, warnings: [] })
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      response: {
        201: t.Object({
          id: t.String(),
          seq: t.Integer(),
          state: StateSchema,
          warnings: t.Array(t.String()),
        }),
      },
      detail: { summary: 'Freezes order, rules and prices into the draft config.' },
    },
  )

  .get(
    '/',
    async ({ league, membership }) => {
      const draft = await getDraftOr404(db, league.id)
      const state = draft.state as unknown as DraftState
      const memberId = membership?.id ?? null

      return {
        id: draft.id,
        seq: draft.seq,
        state,
        me: memberId
          ? {
              memberId,
              budget: remainingBudget(state, memberId),
              onClock: state.onClock === memberId,
              // Already filtered by affordability and every other rule, so the
              // client never reimplements what it may take.
              available: affordableSpecies(state, memberId),
            }
          : null,
        pool: availableSpecies(state),
      }
    },
    {
      league: 'public',
      params: t.Object({ id: t.String() }),
      response: t.Object({
        id: t.String(),
        seq: t.Integer(),
        state: StateSchema,
        me: t.Nullable(
          t.Object({
            memberId: t.String(),
            budget: t.Integer(),
            onClock: t.Boolean(),
            available: t.Array(t.Object({ speciesId: t.String(), points: t.Integer() })),
          }),
        ),
        pool: t.Array(t.Object({ speciesId: t.String(), points: t.Integer() })),
      }),
    },
  )

  .post(
    '/pick',
    async ({ league, membership, user, body }) => {
      const member = mustMember(membership)
      const result = await pick(db, league.id, mustUser(user).id, {
        memberId: member.id,
        speciesId: toID(body.speciesId),
      })
      broadcast(league.id, result)
      return { seq: result?.seq ?? 0, state: result?.state, warnings: result?.warnings ?? [] }
    },
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      body: t.Object({ speciesId: t.String({ minLength: 1, maxLength: 64 }) }),
      response: CommitResponse,
    },
  )

  .post(
    '/force-pick',
    async ({ league, user, body }) => {
      const result = await pick(db, league.id, mustUser(user).id, {
        memberId: body.memberId,
        speciesId: toID(body.speciesId),
        asHost: true,
      })
      broadcast(league.id, result)
      return { seq: result?.seq ?? 0, state: result?.state, warnings: result?.warnings ?? [] }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      body: t.Object({
        memberId: t.String({ format: 'uuid' }),
        speciesId: t.String({ minLength: 1, maxLength: 64 }),
      }),
      response: CommitResponse,
      detail: { summary: 'Host picks for whoever is on the clock. Still obeys every rule.' },
    },
  )

  .post(
    '/skip',
    async ({ league, membership, user, body }) => {
      const member = mustMember(membership)
      const result = await skip(db, league.id, mustUser(user).id, {
        memberId: member.id,
        reason: 'manual',
        finish: body?.finish,
      })
      broadcast(league.id, result)
      return { seq: result?.seq ?? 0, state: result?.state, warnings: result?.warnings ?? [] }
    },
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ finish: t.Optional(t.Boolean()) })),
      response: CommitResponse,
    },
  )

  .post(
    '/pause',
    async ({ league, user, body }) => {
      const result = await pause(db, league.id, mustUser(user).id, body?.reason)
      broadcast(league.id, result)
      return { seq: result?.seq ?? 0, state: result?.state, warnings: [] }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 200 })) })),
      response: CommitResponse,
    },
  )

  .post(
    '/resume',
    async ({ league, user }) => {
      const result = await resume(db, league.id, mustUser(user).id)
      broadcast(league.id, result)
      return { seq: result?.seq ?? 0, state: result?.state, warnings: [] }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      response: CommitResponse,
    },
  )

  .post(
    '/undo',
    async ({ league, user }) => {
      const result = await undoLastPick(db, league.id, mustUser(user).id)
      // Undo rewrites history, so listeners get the rebuilt fold rather than a
      // compensating event they would have to interpret.
      publishDraftEvents(league.id, [], result.seq)
      return { seq: result.seq, state: result.state, warnings: [] }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      response: CommitResponse,
      detail: { summary: 'Truncates the trailing events and replays. Never inverts a fold.' },
    },
  )

  .get(
    '/events',
    async ({ league, query }) => {
      const draft = await getDraftOr404(db, league.id)
      const rows = await readEvents(db, draft.id, query.since ?? -1)
      return rows.map((r) => ({
        seq: r.seq,
        type: r.type,
        payload: r.payload,
        actorId: r.actorId,
        createdAt: r.createdAt,
      }))
    },
    {
      league: 'public',
      params: t.Object({ id: t.String() }),
      query: t.Object({ since: t.Optional(t.Integer({ minimum: -1 })) }),
      response: t.Array(
        t.Object({
          seq: t.Integer(),
          type: t.String(),
          payload: t.Any(),
          actorId: t.Nullable(t.String()),
          createdAt: t.Date(),
        }),
      ),
    },
  )

  .get(
    '/rebuild',
    async ({ league, membership }) => {
      if (membership?.role !== 'host' && membership?.role !== 'cohost') throw forbidden()
      return { state: await rebuildFromEvents(db, league.id) }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      response: t.Object({ state: StateSchema }),
      detail: { summary: 'Folds draft_events from scratch — proof the cache is only a cache.' },
    },
  )

  .get(
    '/queue',
    async ({ membership }) => {
      const member = mustMember(membership)
      return readQueue(db, member.id)
    },
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      response: t.Array(t.Object({ speciesId: t.String(), rank: t.Integer() })),
    },
  )

  .put(
    '/queue',
    async ({ membership, body }) => {
      const member = mustMember(membership)
      const ids = body.speciesIds.map(toID)
      if (new Set(ids).size !== ids.length) {
        throw badRequest(
          ERROR_CODES.VALIDATION_ERROR,
          'the same species appears twice in the queue',
        )
      }
      await replaceQueue(db, member.id, ids)
      return readQueue(db, member.id)
    },
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      body: t.Object({
        speciesIds: t.Array(t.String({ maxLength: 64 }), { maxItems: 100 }),
      }),
      response: t.Array(t.Object({ speciesId: t.String(), rank: t.Integer() })),
      detail: { summary: 'Replaces the whole wishlist; order is the priority.' },
    },
  )
