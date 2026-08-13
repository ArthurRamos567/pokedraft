import { apply, type DraftEvent, type DraftState } from '@pokedraft/draft'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { API_URL } from './api'

type ServerMessage =
  | { topic: 'draft'; type: 'SNAPSHOT'; seq: number; state: DraftState }
  | { topic: 'draft'; type: 'EVENT'; seq: number; event: DraftEvent }
  | { topic: 'presence'; type: 'PRESENCE'; members: string[] }
  | { topic: string; type: 'INVALIDATE'; key: string }

export type LiveState = {
  state: DraftState | null
  seq: number
  presence: string[]
  connected: boolean
}

/**
 * One socket per league, multiplexed by topic.
 *
 * Draft events are folded with `apply` from `@pokedraft/draft` — the very
 * reducer the server runs. The client therefore cannot drift from the server
 * by reimplementing a rule, because it doesn't implement any.
 */
export function useLeagueSocket(leagueId: string | undefined): LiveState {
  const qc = useQueryClient()
  const [live, setLive] = useState<LiveState>({
    state: null,
    seq: 0,
    presence: [],
    connected: false,
  })
  const seqRef = useRef(0)

  useEffect(() => {
    if (!leagueId) return
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let closed = false

    const connect = () => {
      const url = `${API_URL.replace(/^http/, 'ws')}/leagues/${leagueId}/live`
      socket = new WebSocket(url)

      socket.onopen = () => {
        attempts = 0
        setLive((s) => ({ ...s, connected: true }))
        // Ask for anything missed while we were away; the server answers with
        // a snapshot rather than a partial replay, which cannot leave a gap.
        socket?.send(JSON.stringify({ type: 'RESUME', topic: 'draft', seq: seqRef.current }))
      }

      socket.onmessage = (raw) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(String(raw.data))
        } catch {
          return
        }

        if (msg.type === 'SNAPSHOT') {
          seqRef.current = msg.seq
          setLive((s) => ({ ...s, state: msg.state, seq: msg.seq }))
          return
        }

        if (msg.type === 'EVENT') {
          setLive((s) => {
            if (!s.state) return s
            // A gap means we missed something; a snapshot is the honest repair.
            if (msg.seq !== s.seq + 1) {
              socket?.send(JSON.stringify({ type: 'RESUME', topic: 'draft', seq: s.seq }))
              return s
            }
            try {
              const next = apply(s.state, msg.event)
              seqRef.current = msg.seq
              return { ...s, state: next, seq: msg.seq }
            } catch {
              socket?.send(JSON.stringify({ type: 'RESUME', topic: 'draft', seq: s.seq }))
              return s
            }
          })
          // Rosters, pools and points all move when a pick lands.
          qc.invalidateQueries({ queryKey: ['league', leagueId] })
          return
        }

        if (msg.type === 'PRESENCE') {
          setLive((s) => ({ ...s, presence: msg.members }))
          return
        }

        if (msg.type === 'INVALIDATE') {
          qc.invalidateQueries({ queryKey: ['league', leagueId] })
        }
      }

      socket.onclose = () => {
        setLive((s) => ({ ...s, connected: false }))
        if (closed) return
        // Backs off to 10s so a server restart doesn't get hammered.
        const delay = Math.min(10_000, 500 * 2 ** attempts++)
        retry = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [leagueId, qc])

  return live
}
