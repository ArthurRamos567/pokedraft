import { Elysia, t } from 'elysia'
import { db } from '../../db'
import { env } from '../../env'
import { authPlugin } from '../../plugins/auth'
import { leaguePlugin, mustUser } from '../../plugins/league'
import {
  CreateLeagueBody,
  DirectoryItem,
  InviteSchema,
  LeagueSchema,
  MemberSchema,
  SettingsPatch,
  SettingsSchema,
  Status,
  UpdateLeagueBody,
} from './model'
import { findSettings, listMembers, listMyLeagues, listPublicLeagues } from './repo'
import {
  createInvite,
  createLeague,
  joinByCode,
  joinPublicLeague,
  leaveLeague,
  removeMember,
  revokeInvite,
  setDraftOrder,
  updateLeague,
  updateMember,
  updateOwnMembership,
  updateSettings,
} from './service'

const inviteUrl = (code: string) => `${env.WEB_ORIGIN}/join/${code}`

const memberRow = (m: Awaited<ReturnType<typeof listMembers>>[number]) => ({
  ...m,
  avatarUrl: m.avatarUrl ?? m.image ?? null,
})

export const leaguesModule = new Elysia({ prefix: '/leagues', tags: ['leagues'] })
  .use(authPlugin)
  .use(leaguePlugin)

  // ── discovery ─────────────────────────────────────────────────────────────
  .get(
    '/',
    async ({ query }) => {
      const { items, total } = await listPublicLeagues(db, {
        status: query.status,
        q: query.q,
        limit: query.limit ?? 25,
        offset: query.offset ?? 0,
      })
      return { items, total, limit: query.limit ?? 25, offset: query.offset ?? 0 }
    },
    {
      query: t.Object({
        status: t.Optional(Status),
        q: t.Optional(t.String({ maxLength: 64 })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
        offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
      }),
      response: t.Object({
        items: t.Array(DirectoryItem),
        total: t.Integer(),
        limit: t.Integer(),
        offset: t.Integer(),
      }),
      detail: { summary: 'Public directory. Private leagues never appear here.' },
    },
  )
  .get('/mine', ({ user }) => listMyLeagues(db, user.id), {
    auth: true,
    response: t.Array(
      t.Object({
        id: t.String(),
        slug: t.String(),
        name: t.String(),
        description: t.Nullable(t.String()),
        status: Status,
        formatId: t.String(),
        visibility: t.Union([t.Literal('public'), t.Literal('private')]),
        logoUrl: t.Nullable(t.String()),
        bannerUrl: t.Nullable(t.String()),
        createdAt: t.Date(),
        role: t.String(),
        teamName: t.Nullable(t.String()),
      }),
    ),
  })
  .post(
    '/',
    async ({ user, body, status }) => {
      const league = await createLeague(db, user.id, body)
      return status(201, league)
    },
    {
      auth: true,
      body: CreateLeagueBody,
      response: { 201: LeagueSchema },
      detail: { summary: 'Creator becomes host and a playing member.' },
    },
  )
  .post(
    '/join/:code',
    async ({ params, body, user }) => {
      const { member, leagueId } = await joinByCode(db, params.code, user.id, body?.teamName)
      return { leagueId, memberId: member.id }
    },
    {
      auth: true,
      params: t.Object({ code: t.String({ minLength: 4, maxLength: 16 }) }),
      body: t.Optional(t.Object({ teamName: t.Optional(t.String({ maxLength: 60 })) })),
      response: t.Object({ leagueId: t.String(), memberId: t.String() }),
    },
  )

  // ── one league ────────────────────────────────────────────────────────────
  .get(
    '/:id',
    async ({ league, membership }) => {
      const settings = await findSettings(db, league.id)
      const members = await listMembers(db, league.id)
      return {
        league,
        settings: settings ?? null,
        members: members.map(memberRow),
        me: membership ? { memberId: membership.id, role: membership.role } : null,
      }
    },
    {
      league: 'public',
      params: t.Object({ id: t.String() }),
      response: t.Object({
        league: LeagueSchema,
        settings: t.Nullable(t.Composite([SettingsSchema, t.Object({ leagueId: t.String() })])),
        members: t.Array(MemberSchema),
        me: t.Nullable(t.Object({ memberId: t.String(), role: t.String() })),
      }),
      detail: { summary: 'Accepts a slug or an id. Private + non-member is a 404.' },
    },
  )
  .patch('/:id', ({ league, body }) => updateLeague(db, league.id, body), {
    league: 'host',
    params: t.Object({ id: t.String() }),
    body: UpdateLeagueBody,
    response: LeagueSchema,
  })
  .patch('/:id/settings', ({ league, body }) => updateSettings(db, league.id, body), {
    league: 'host',
    params: t.Object({ id: t.String() }),
    body: SettingsPatch,
    response: t.Composite([SettingsSchema, t.Object({ leagueId: t.String() })]),
  })

  // ── invites ───────────────────────────────────────────────────────────────
  .post(
    '/:id/invites',
    async ({ league, user, body, status }) => {
      const invite = await createInvite(db, league.id, mustUser(user).id, body ?? {})
      return status(201, {
        id: invite.id,
        code: invite.code,
        maxUses: invite.maxUses,
        uses: invite.uses,
        expiresAt: invite.expiresAt,
        revokedAt: invite.revokedAt,
        createdAt: invite.createdAt,
        url: inviteUrl(invite.code),
      })
    },
    {
      league: 'host',
      auth: true,
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object({
          maxUses: t.Optional(t.Integer({ minimum: 1, maximum: 1000 })),
          expiresInHours: t.Optional(t.Integer({ minimum: 1, maximum: 24 * 90 })),
        }),
      ),
      response: { 201: InviteSchema },
    },
  )
  .delete(
    '/:id/invites/:code',
    async ({ league, params }) => {
      await revokeInvite(db, league.id, params.code)
      return { ok: true as const }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String(), code: t.String() }),
      response: t.Object({ ok: t.Literal(true) }),
    },
  )

  // ── membership ────────────────────────────────────────────────────────────
  .post(
    '/:id/join',
    async ({ league, user, body }) => {
      const member = await joinPublicLeague(db, league.id, mustUser(user).id, body?.teamName)
      return { memberId: member.id }
    },
    {
      league: 'public',
      auth: true,
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ teamName: t.Optional(t.String({ maxLength: 60 })) })),
      response: t.Object({ memberId: t.String() }),
    },
  )
  .post(
    '/:id/leave',
    async ({ league, user }) => {
      await leaveLeague(db, league.id, mustUser(user).id)
      return { ok: true as const }
    },
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      response: t.Object({ ok: t.Literal(true) }),
    },
  )
  .patch(
    '/:id/me',
    ({ league, user, body }) => updateOwnMembership(db, league.id, mustUser(user).id, body),
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      body: t.Object({
        teamName: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
        teamLogoUrl: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
      response: t.Omit(MemberSchema, ['displayName', 'name', 'avatarUrl']),
    },
  )
  .delete(
    '/:id/members/:memberId',
    async ({ league, params, user }) => {
      await removeMember(db, league.id, params.memberId, mustUser(user).id)
      return { ok: true as const }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String(), memberId: t.String({ format: 'uuid' }) }),
      response: t.Object({ ok: t.Literal(true) }),
    },
  )
  .patch(
    '/:id/members/:memberId',
    ({ league, params, body, user }) =>
      updateMember(db, league.id, params.memberId, body, mustUser(user).id),
    {
      league: 'host',
      params: t.Object({ id: t.String(), memberId: t.String({ format: 'uuid' }) }),
      body: t.Object({
        role: t.Optional(
          t.Union([
            t.Literal('host'),
            t.Literal('cohost'),
            t.Literal('player'),
            t.Literal('spectator'),
          ]),
        ),
        teamName: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
      }),
      response: t.Omit(MemberSchema, ['displayName', 'name', 'avatarUrl']),
      detail: { summary: 'Promoting to host transfers it — a league has exactly one.' },
    },
  )
  .post(
    '/:id/draft-order',
    ({ league, body, user }) => setDraftOrder(db, league.id, body, mustUser(user).id),
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      body: t.Object({
        mode: t.Union([t.Literal('random'), t.Literal('manual')]),
        order: t.Optional(t.Array(t.String({ format: 'uuid' }))),
      }),
      response: t.Array(t.Object({ memberId: t.String(), draftPosition: t.Integer() })),
    },
  )
