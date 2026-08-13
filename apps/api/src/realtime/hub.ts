import type { DraftEvent, DraftState } from '@pokedraft/draft'

export type Topic = 'draft' | 'season' | 'transactions' | 'presence'

export type ServerMessage =
  | { topic: 'draft'; type: 'SNAPSHOT'; seq: number; state: DraftState }
  | { topic: 'draft'; type: 'EVENT'; seq: number; event: DraftEvent }
  | { topic: 'presence'; type: 'PRESENCE'; members: string[] }
  | { topic: Topic; type: 'INVALIDATE'; key: string }

export type ClientMessage =
  | { type: 'SUBSCRIBE'; topics: Topic[] }
  | { type: 'RESUME'; topic: 'draft'; seq: number }
  | { type: 'PING' }

/**
 * One socket per league, multiplexed by topic. Elysia's pub/sub does the
 * fan-out; this keeps the presence roster, which is the part a room actually
 * needs — a host wants to know who is AFK before the timer tells them.
 */
class LeagueHub {
  private presence = new Map<string, Set<string>>()

  key(leagueId: string) {
    return `league:${leagueId}`
  }

  join(leagueId: string, memberId: string) {
    const set = this.presence.get(leagueId) ?? new Set()
    set.add(memberId)
    this.presence.set(leagueId, set)
    return [...set]
  }

  leave(leagueId: string, memberId: string) {
    const set = this.presence.get(leagueId)
    if (!set) return []
    set.delete(memberId)
    if (set.size === 0) this.presence.delete(leagueId)
    return [...set]
  }

  online(leagueId: string): string[] {
    return [...(this.presence.get(leagueId) ?? [])]
  }
}

export const hub = new LeagueHub()

/**
 * Set by the WS module at boot. The draft service publishes through this
 * rather than importing Elysia, so services stay free of transport concerns.
 */
let publisher: ((leagueId: string, message: ServerMessage) => void) | null = null

export function setPublisher(fn: typeof publisher) {
  publisher = fn
}

export function publish(leagueId: string, message: ServerMessage) {
  publisher?.(leagueId, message)
}

export function publishDraftEvents(leagueId: string, events: DraftEvent[], startSeq: number) {
  events.forEach((event, i) => {
    publish(leagueId, { topic: 'draft', type: 'EVENT', seq: startSeq + i + 1, event })
  })
}
