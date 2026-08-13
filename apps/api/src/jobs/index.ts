import type { Database } from '@pokedraft/db'
import { sql } from '@pokedraft/db'
import { logger } from '../plugins/logger'

/**
 * Postgres advisory locks elect one runner per job across every process, so
 * scaling the API to two instances doesn't double-fire every timer.
 */
export async function withLeaderLock<T>(
  db: Database,
  key: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const [row] = await db.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${key}) as locked`,
  )
  if (!row?.locked) return null
  try {
    return await fn()
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${key})`)
  }
}

export type Job = {
  name: string
  intervalMs: number
  key: number
  run: () => Promise<void>
}

const timers: Timer[] = []

export function startJobs(jobs: Job[]) {
  for (const job of jobs) {
    const tick = async () => {
      try {
        await job.run()
      } catch (err) {
        logger.error({ err, job: job.name }, 'job failed')
      }
    }
    timers.push(setInterval(tick, job.intervalMs))
    logger.info(`job ${job.name} every ${job.intervalMs}ms`)
  }
}

export function stopJobs() {
  for (const t of timers) clearInterval(t)
  timers.length = 0
}
