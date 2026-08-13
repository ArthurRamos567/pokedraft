import type { DraftState } from '@pokedraft/draft'
import { db } from '../db'
import { findExpired } from '../modules/draft/repo'
import { loadQueue, runDeadline } from '../modules/draft/service'
import { logger } from '../plugins/logger'
import { publishDraftEvents } from '../realtime/hub'
import { type Job, withLeaderLock } from './index'

const LOCK_KEY = 0x0d1a17

/**
 * Fires autopicks and skips for drafts whose clock ran out.
 *
 * The important part is what it does *not* do: `runDeadline` re-reads the
 * state under the row lock and returns null unless the draft is still exactly
 * where this pass observed it. A player picking in the same instant therefore
 * wins, and the timer quietly does nothing rather than producing a second
 * event for the same turn.
 */
export const draftDeadlinesJob: Job = {
  name: 'draft-deadlines',
  intervalMs: 15_000,
  key: LOCK_KEY,
  run: async () => {
    await withLeaderLock(db, LOCK_KEY, async () => {
      const expired = await findExpired(db, new Date())
      for (const row of expired) {
        const draft = await db.query.drafts.findFirst({
          where: (d, { eq }) => eq(d.id, row.id),
        })
        if (!draft) continue

        const state = draft.state as unknown as DraftState
        if (!state.onClock) continue

        const queue = await loadQueue(db, state.onClock)
        const result = await runDeadline(
          db,
          row.leagueId,
          { pickNo: state.pickNo, onClock: state.onClock },
          queue,
        )
        if (!result) continue

        publishDraftEvents(row.leagueId, result.events, result.seq - result.events.length)
        logger.info(
          { leagueId: row.leagueId, events: result.events.map((e) => e.type) },
          'draft deadline fired',
        )
      }
    })
  },
}
