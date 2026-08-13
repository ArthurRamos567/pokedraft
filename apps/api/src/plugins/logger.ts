import { Elysia } from 'elysia'
import { pino } from 'pino'
import { env, isProd, isTest } from '../env'

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
})

export type Logger = typeof logger

export const loggerPlugin = new Elysia({ name: 'logger' })
  .decorate('logger', logger)
  .derive({ as: 'global' }, ({ request, server }) => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
    return {
      requestId,
      log: logger.child({ requestId, ip: server?.requestIP(request)?.address }),
    }
  })
  .onAfterResponse({ as: 'global' }, ({ request, set, log }) => {
    log.debug({ method: request.method, path: new URL(request.url).pathname, status: set.status })
  })
