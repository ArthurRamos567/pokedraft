import { db } from '../db'
import { autoConfirmStale } from '../modules/season/service'
import { logger } from '../plugins/logger'
import { type Job, withLeaderLock } from './index'

const LOCK_KEY = 0x0c0f1a

/**
 * Silence becomes agreement after 48h. Leagues stall on unresponsive opponents
 * far more often than on genuine disagreements, and a stalled week blocks the
 * standings for everyone.
 */
export const autoConfirmJob: Job = {
  name: 'auto-confirm-reports',
  intervalMs: 10 * 60_000,
  key: LOCK_KEY,
  run: async () => {
    await withLeaderLock(db, LOCK_KEY, async () => {
      const n = await autoConfirmStale(db, 48)
      if (n > 0) logger.info({ count: n }, 'auto-confirmed stale reports')
    })
  },
}
