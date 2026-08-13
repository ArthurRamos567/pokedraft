import { app } from './app'
import { env } from './env'
import { logger } from './plugins/logger'

app.listen(env.PORT, ({ hostname, port }) => {
  logger.info(`pokedraft api on http://${hostname}:${port}  ·  docs at /openapi`)
})

const shutdown = async (signal: string) => {
  logger.info(`${signal} — shutting down`)
  await app.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
