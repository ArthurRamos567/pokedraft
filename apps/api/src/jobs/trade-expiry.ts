import { db } from '../db'
import { expireStale } from '../modules/transactions/service'
import { logger } from '../plugins/logger'
import { type Job, withLeaderLock } from './index'

const LOCK_KEY = 0x71a4e5

/**
 * Expires stale offers. Deliberately not a cascade: a pending trade whose mon
 * has since moved is left alone and fails its own revalidation at approval
 * with NOT_ON_ROSTER, which is the honest outcome.
 */
export const tradeExpiryJob: Job = {
  name: 'trade-expiry',
  intervalMs: 5 * 60_000,
  key: LOCK_KEY,
  run: async () => {
    await withLeaderLock(db, LOCK_KEY, async () => {
      const n = await expireStale(db)
      if (n > 0) logger.info({ count: n }, 'expired stale trades')
    })
  },
}
