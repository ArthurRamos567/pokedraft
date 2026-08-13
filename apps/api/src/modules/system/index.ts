import { Elysia, t } from 'elysia'
import { db } from '../../db'
import { authPlugin } from '../../plugins/auth'
import { listNotifications, markRead } from './service'

const Notification = t.Object({
  id: t.String(),
  leagueId: t.Nullable(t.String()),
  type: t.String(),
  title: t.String(),
  body: t.Nullable(t.String()),
  link: t.Nullable(t.String()),
  readAt: t.Nullable(t.Date()),
  createdAt: t.Date(),
})

export const notificationsModule = new Elysia({ prefix: '/notifications', tags: ['notifications'] })
  .use(authPlugin)
  .get(
    '/',
    async ({ user, query }) => {
      const { items, unread, limit, offset } = await listNotifications(db, user.id, {
        unreadOnly: query.unreadOnly === true,
        limit: query.limit,
        offset: query.offset,
      })
      return {
        items: items.map(({ userId: _userId, ...rest }) => rest),
        unread,
        limit,
        offset,
      }
    },
    {
      auth: true,
      query: t.Object({
        unreadOnly: t.Optional(t.Boolean()),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
        offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
      }),
      response: t.Object({
        items: t.Array(Notification),
        unread: t.Integer(),
        limit: t.Integer(),
        offset: t.Integer(),
      }),
    },
  )
  .post(
    '/read',
    async ({ user, body }) => {
      await markRead(db, user.id, body.all ? 'all' : (body.ids ?? []))
      return { ok: true as const }
    },
    {
      auth: true,
      body: t.Object({
        all: t.Optional(t.Boolean()),
        ids: t.Optional(t.Array(t.String({ format: 'uuid' }))),
      }),
      response: t.Object({ ok: t.Literal(true) }),
    },
  )
