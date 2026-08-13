import { Elysia, t } from 'elysia'
import { db } from '../../db'
import { authPlugin } from '../../plugins/auth'
import { leaguePlugin, mustMember, mustUser } from '../../plugins/league'
import {
  commitSeason,
  getMatchupOr404,
  getSchedule,
  leaderboard,
  leagueStandings,
  previewSeason,
  reportResult,
  rescheduleMatchup,
  resolveMatchup,
  respondToReport,
} from './service'

const GenerateBody = t.Object({
  weeks: t.Optional(t.Integer({ minimum: 1, maximum: 30 })),
  doubleRoundRobin: t.Optional(t.Boolean()),
  startAt: t.Optional(t.String()),
  weekLengthDays: t.Optional(t.Integer({ minimum: 1, maximum: 28 })),
  seed: t.Optional(t.String({ maxLength: 64 })),
})

const MatchupSchema = t.Object({
  id: t.String(),
  weekId: t.String(),
  homeMemberId: t.String(),
  awayMemberId: t.Nullable(t.String()),
  status: t.String(),
  winnerMemberId: t.Nullable(t.String()),
  homeScore: t.Integer(),
  awayScore: t.Integer(),
  replayUrl: t.Nullable(t.String()),
  scheduledAt: t.Nullable(t.Date()),
  reportedAt: t.Nullable(t.Date()),
  confirmedAt: t.Nullable(t.Date()),
  createdAt: t.Date(),
})

export const seasonModule = new Elysia({ prefix: '/leagues/:id', tags: ['season'] })
  .use(authPlugin)
  .use(leaguePlugin)

  .post('/season/preview', ({ league, body }) => previewSeason(db, league.id, body), {
    league: 'host',
    params: t.Object({ id: t.String() }),
    body: GenerateBody,
    response: t.Object({
      hash: t.String(),
      warnings: t.Array(t.String()),
      weeks: t.Array(
        t.Object({
          number: t.Integer(),
          opensAt: t.Date(),
          closesAt: t.Date(),
          matchups: t.Array(
            t.Object({ week: t.Integer(), home: t.String(), away: t.Nullable(t.String()) }),
          ),
        }),
      ),
    }),
    detail: { summary: 'Writes nothing. Hosts are never surprised by a schedule.' },
  })

  .post(
    '/season/commit',
    async ({ league, user, body, status }) => {
      const { season, weeks } = await commitSeason(db, league.id, mustUser(user).id, body)
      return status(201, { id: season.id, number: season.number, weeks })
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      body: t.Composite([GenerateBody, t.Object({ hash: t.String() })]),
      response: {
        201: t.Object({ id: t.String(), number: t.Integer(), weeks: t.Integer() }),
      },
    },
  )

  .get('/schedule', ({ league, query }) => getSchedule(db, league.id, query.week), {
    league: 'public',
    params: t.Object({ id: t.String() }),
    query: t.Object({ week: t.Optional(t.Integer({ minimum: 1 })) }),
    response: t.Object({
      season: t.Nullable(t.Object({ id: t.String(), number: t.Integer(), status: t.String() })),
      weeks: t.Array(
        t.Object({
          id: t.String(),
          number: t.Integer(),
          opensAt: t.Nullable(t.Date()),
          closesAt: t.Nullable(t.Date()),
          status: t.String(),
          matchups: t.Array(MatchupSchema),
        }),
      ),
    }),
  })

  .get(
    '/matchups/:matchupId',
    async ({ league, params }) => {
      const { matchup, weekNumber } = await getMatchupOr404(db, league.id, params.matchupId)
      return { ...matchup, weekNumber }
    },
    {
      league: 'public',
      params: t.Object({ id: t.String(), matchupId: t.String({ format: 'uuid' }) }),
      response: t.Composite([MatchupSchema, t.Object({ weekNumber: t.Integer() })]),
    },
  )

  .post(
    '/matchups/:matchupId/report',
    async ({ league, membership, params, body }) => {
      const member = mustMember(membership)
      return reportResult(db, league.id, member.id, params.matchupId, body)
    },
    {
      league: 'member',
      params: t.Object({ id: t.String(), matchupId: t.String({ format: 'uuid' }) }),
      body: t.Object({
        winnerMemberId: t.Nullable(t.String({ format: 'uuid' })),
        homeScore: t.Integer({ minimum: 0, maximum: 12 }),
        awayScore: t.Integer({ minimum: 0, maximum: 12 }),
        replayUrl: t.Optional(t.String({ maxLength: 300 })),
        note: t.Optional(t.String({ maxLength: 500 })),
        stats: t.Optional(
          t.Array(
            t.Object({
              memberId: t.String({ format: 'uuid' }),
              speciesId: t.String({ maxLength: 64 }),
              kills: t.Integer({ minimum: 0, maximum: 12 }),
              deaths: t.Integer({ minimum: 0, maximum: 12 }),
              brought: t.Optional(t.Boolean()),
            }),
            { maxItems: 24 },
          ),
        ),
      }),
      response: MatchupSchema,
      detail: { summary: 'Either participant reports; the other confirms.' },
    },
  )

  .post(
    '/matchups/:matchupId/confirm',
    ({ league, membership, params }) =>
      respondToReport(db, league.id, mustMember(membership).id, params.matchupId, 'confirm'),
    {
      league: 'member',
      params: t.Object({ id: t.String(), matchupId: t.String({ format: 'uuid' }) }),
      response: MatchupSchema,
    },
  )

  .post(
    '/matchups/:matchupId/dispute',
    ({ league, membership, params }) =>
      respondToReport(db, league.id, mustMember(membership).id, params.matchupId, 'dispute'),
    {
      league: 'member',
      params: t.Object({ id: t.String(), matchupId: t.String({ format: 'uuid' }) }),
      response: MatchupSchema,
    },
  )

  .post(
    '/matchups/:matchupId/resolve',
    ({ league, user, params, body }) =>
      resolveMatchup(db, league.id, mustUser(user).id, params.matchupId, body),
    {
      league: 'host',
      params: t.Object({ id: t.String(), matchupId: t.String({ format: 'uuid' }) }),
      body: t.Object({
        status: t.Union([t.Literal('confirmed'), t.Literal('forfeited'), t.Literal('void')]),
        winnerMemberId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
        homeScore: t.Optional(t.Integer({ minimum: 0, maximum: 12 })),
        awayScore: t.Optional(t.Integer({ minimum: 0, maximum: 12 })),
      }),
      response: MatchupSchema,
    },
  )

  .patch(
    '/matchups/:matchupId',
    ({ league, user, params, body }) =>
      rescheduleMatchup(db, league.id, mustUser(user).id, params.matchupId, body),
    {
      league: 'host',
      params: t.Object({ id: t.String(), matchupId: t.String({ format: 'uuid' }) }),
      body: t.Object({
        scheduledAt: t.Optional(t.Nullable(t.String())),
        weekId: t.Optional(t.String({ format: 'uuid' })),
      }),
      response: MatchupSchema,
    },
  )

  .get('/standings', async ({ league, query }) => leagueStandings(db, league.id, query.tiebreak), {
    league: 'public',
    params: t.Object({ id: t.String() }),
    query: t.Object({
      tiebreak: t.Optional(
        t.Union([t.Literal('differential_first'), t.Literal('head_to_head_first')]),
      ),
    }),
    response: t.Array(
      t.Object({
        memberId: t.String(),
        played: t.Integer(),
        wins: t.Integer(),
        losses: t.Integer(),
        byes: t.Integer(),
        scoreFor: t.Integer(),
        scoreAgainst: t.Integer(),
        differential: t.Integer(),
        kills: t.Integer(),
        beat: t.Array(t.String()),
      }),
    ),
  })

  .get('/leaderboard', ({ league, query }) => leaderboard(db, league.id, query.stat ?? 'kills'), {
    league: 'public',
    params: t.Object({ id: t.String() }),
    query: t.Object({
      stat: t.Optional(t.Union([t.Literal('kills'), t.Literal('kd'), t.Literal('usage')])),
    }),
    response: t.Array(
      t.Object({
        speciesId: t.String(),
        memberId: t.String(),
        kills: t.Integer(),
        deaths: t.Integer(),
        games: t.Integer(),
        kd: t.Number(),
      }),
    ),
    detail: { summary: 'Empty rather than broken when nobody entered per-mon stats.' },
  })
