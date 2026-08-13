import { Elysia, t } from 'elysia'
import { db } from '../../db'
import { authPlugin } from '../../plugins/auth'
import { leaguePlugin, mustUser } from '../../plugins/league'
import {
  commitPlayoffs,
  getPlayoffs,
  overrideResult,
  previewPlayoffs,
  recordResult,
  scrapBracket,
} from './service'

const GenerateBody = t.Object({
  type: t.Optional(t.Union([t.Literal('single_elim'), t.Literal('double_elim')])),
  size: t.Optional(t.Integer({ minimum: 2, maximum: 16 })),
  thirdPlace: t.Optional(t.Boolean()),
  bracketReset: t.Optional(t.Boolean()),
  force: t.Optional(t.Boolean()),
})

export const playoffsModule = new Elysia({ prefix: '/leagues/:id/playoffs', tags: ['playoffs'] })
  .use(authPlugin)
  .use(leaguePlugin)

  .post('/preview', ({ league, body }) => previewPlayoffs(db, league.id, body), {
    league: 'host',
    params: t.Object({ id: t.String() }),
    body: GenerateBody,
    response: t.Any(),
    detail: { summary: 'Seeds come from the standings and freeze at commit.' },
  })

  .post(
    '/commit',
    async ({ league, user, body, status }) => {
      const { bracket, matches } = await commitPlayoffs(db, league.id, mustUser(user).id, body)
      return status(201, { id: bracket.id, size: bracket.size, matches })
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      body: t.Composite([GenerateBody, t.Object({ hash: t.String() })]),
      response: {
        201: t.Object({ id: t.String(), size: t.Integer(), matches: t.Integer() }),
      },
    },
  )

  .get('/', ({ league }) => getPlayoffs(db, league.id), {
    league: 'public',
    params: t.Object({ id: t.String() }),
    response: t.Any(),
    detail: { summary: 'Render-ready tree. Renders before anything is played.' },
  })

  .post(
    '/matches/:slot/result',
    ({ league, params, body }) => recordResult(db, league.id, params.slot, body.winnerMemberId),
    {
      league: 'host',
      params: t.Object({ id: t.String(), slot: t.String({ maxLength: 12 }) }),
      body: t.Object({ winnerMemberId: t.String({ format: 'uuid' }) }),
      response: t.Any(),
    },
  )

  .patch(
    '/matches/:slot',
    ({ league, user, params, body }) =>
      overrideResult(db, league.id, mustUser(user).id, params.slot, body.winnerMemberId),
    {
      league: 'host',
      params: t.Object({ id: t.String(), slot: t.String({ maxLength: 12 }) }),
      body: t.Object({ winnerMemberId: t.Nullable(t.String({ format: 'uuid' })) }),
      response: t.Any(),
      detail: { summary: 'Cascades: the dependent subtree is cleared and replayed.' },
    },
  )

  .delete(
    '/',
    async ({ league, user }) => {
      await scrapBracket(db, league.id, mustUser(user).id)
      return { ok: true as const }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      response: t.Object({ ok: t.Literal(true) }),
      detail: { summary: 'Only before the bracket is under way.' },
    },
  )
