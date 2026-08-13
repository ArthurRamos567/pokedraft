import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { env } from './env'
import { healthModule } from './modules/health'
import { meModule } from './modules/me'
import { notificationsModule } from './modules/system'
import { authPlugin } from './plugins/auth'
import { errorsPlugin } from './plugins/errors'
import { loggerPlugin } from './plugins/logger'

/**
 * Exported without listening so tests can call `app.handle(new Request(…))`
 * with no port binding, and `apps/web` can import `typeof app` for Eden.
 */
export const app = new Elysia()
  .use(
    cors({
      origin: [env.WEB_ORIGIN],
      credentials: true,
      allowedHeaders: ['content-type', 'authorization', 'x-request-id'],
    }),
  )
  .use(
    openapi({
      path: '/openapi',
      documentation: {
        info: { title: 'PokeDraft API', version: '0.1.0' },
        tags: [{ name: 'health', description: 'Liveness and readiness' }],
      },
    }),
  )
  .use(errorsPlugin)
  .use(loggerPlugin)
  .use(authPlugin)
  .use(healthModule)
  .use(meModule)
  .use(notificationsModule)

export type App = typeof app
