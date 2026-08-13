import { and, eq, schema } from '@pokedraft/db'
import type { DraftState } from '@pokedraft/draft'
import { Elysia, t } from 'elysia'
import { auth } from '../auth'
import { db } from '../db'
import { findDraft } from '../modules/draft/repo'
import { type ClientMessage, hub, type ServerMessage, setPublisher } from './hub'

type SocketData = { leagueId: string; memberId: string | null; topics: Set<string> }

const sockets = new Map<string, { send: (m: ServerMessage) => void; leagueId: string }>()

setPublisher((leagueId, message) => {
  for (const s of sockets.values()) {
    if (s.leagueId === leagueId) s.send(message)
  }
})

/**
 * A single socket per league, multiplexed by topic. Reconnects resume from a
 * `seq`; if the client is further behind than the buffer can serve, it gets a
 * fresh snapshot instead of a silent gap.
 */
export const realtimeModule = new Elysia({ name: 'realtime' }).ws('/leagues/:id/live', {
  params: t.Object({ id: t.String({ format: 'uuid' }) }),

  async open(ws) {
    const leagueId = ws.data.params.id
    const session = await auth.api.getSession({ headers: ws.data.request.headers })

    const league = await db.query.leagues.findFirst({ where: eq(schema.leagues.id, leagueId) })
    if (!league) {
      ws.close()
      return
    }

    const membership = session?.user
      ? await db.query.leagueMembers.findFirst({
          where: and(
            eq(schema.leagueMembers.leagueId, leagueId),
            eq(schema.leagueMembers.userId, session.user.id),
            eq(schema.leagueMembers.status, 'active'),
          ),
        })
      : null

    // Private leagues are invisible to non-members here too, not just over HTTP.
    if (league.visibility === 'private' && !membership) {
      ws.close()
      return
    }

    const data: SocketData = {
      leagueId,
      memberId: membership?.id ?? null,
      topics: new Set(['draft', 'presence']),
    }
    ;(ws.data as { socket?: SocketData }).socket = data

    sockets.set(ws.id, {
      leagueId,
      send: (m) => {
        try {
          ws.send(m)
        } catch {
          // A socket that died between fan-out and write is not an error worth
          // failing a pick over.
        }
      },
    })

    const draft = await findDraft(db, leagueId)
    if (draft) {
      ws.send({
        topic: 'draft',
        type: 'SNAPSHOT',
        seq: draft.seq,
        state: draft.state as unknown as DraftState,
      } satisfies ServerMessage)
    }

    if (data.memberId) {
      const members = hub.join(leagueId, data.memberId)
      for (const s of sockets.values()) {
        if (s.leagueId === leagueId) s.send({ topic: 'presence', type: 'PRESENCE', members })
      }
    }
  },

  async message(ws, raw) {
    const msg = raw as ClientMessage
    const data = (ws.data as { socket?: SocketData }).socket
    if (!data) return

    if (msg.type === 'PING') return
    if (msg.type === 'SUBSCRIBE') {
      data.topics = new Set(msg.topics)
      return
    }
    if (msg.type === 'RESUME') {
      const draft = await findDraft(db, data.leagueId)
      if (!draft) return
      // Cheaper to re-send the fold than to keep a replay buffer per league;
      // the state is a few kilobytes and reconnects are rare.
      ws.send({
        topic: 'draft',
        type: 'SNAPSHOT',
        seq: draft.seq,
        state: draft.state as unknown as DraftState,
      } satisfies ServerMessage)
    }
  },

  close(ws) {
    const data = (ws.data as { socket?: SocketData }).socket
    sockets.delete(ws.id)
    if (!data?.memberId) return
    const members = hub.leave(data.leagueId, data.memberId)
    for (const s of sockets.values()) {
      if (s.leagueId === data.leagueId) s.send({ topic: 'presence', type: 'PRESENCE', members })
    }
  },
})
