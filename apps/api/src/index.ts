import { app } from './app'
import { env } from './env'
import { startJobs, stopJobs } from './jobs'
import { draftDeadlinesJob } from './jobs/draft-deadlines'
import { logger } from './plugins/logger'

app.listen(env.PORT, ({ hostname, port }) => {
  logger.info(`pokedraft api on http://${hostname}:${port}  ·  docs at /openapi`)
})

startJobs([draftDeadlinesJob])

const shutdown = async (signal: string) => {
  logger.info(`${signal} — shutting down`)
  stopJobs()
  await app.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
