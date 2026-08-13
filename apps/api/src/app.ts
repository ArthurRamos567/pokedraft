import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { env } from './env'
import { dexModule } from './modules/dex'
import { draftModule } from './modules/draft'
import { healthModule } from './modules/health'
import { leaguesModule } from './modules/leagues'
import { meModule } from './modules/me'
import { pointsModule } from './modules/points'
import { seasonModule } from './modules/season'
import { notificationsModule } from './modules/system'
import { teamsModule } from './modules/teams'
import { authPlugin } from './plugins/auth'
import { errorsPlugin } from './plugins/errors'
import { loggerPlugin } from './plugins/logger'
import { realtimeModule } from './realtime'

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
        tags: [
          { name: 'health', description: 'Liveness and readiness' },
          { name: 'dex', description: 'Pokemon reference data' },
        ],
      },
    }),
  )
  .use(errorsPlugin)
  .use(loggerPlugin)
  .use(authPlugin)
  .use(healthModule)
  .use(dexModule)
  .use(leaguesModule)
  .use(pointsModule)
  .use(draftModule)
  .use(teamsModule)
  .use(seasonModule)
  .use(realtimeModule)
  .use(meModule)
  .use(notificationsModule)

export type App = typeof app
