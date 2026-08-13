import { Elysia } from 'elysia'
import { auth, enabledProviders } from '../auth'
import { unauthorized } from '../errors'

export type SessionUser = {
  id: string
  email: string
  name: string
  displayName?: string | null
  showdownUsername?: string | null
  avatarUrl?: string | null
  image?: string | null
}

/**
 * Mounts Better Auth at `/api/auth/*` and exposes the `{ auth: true }` macro.
 * Routes declaring it get a typed `user` and never repeat a session check.
 */
export const authPlugin = new Elysia({ name: 'auth' })
  .mount(auth.handler)
  .get('/api/auth/providers', () => ({ providers: enabledProviders }), {
    detail: { summary: 'OAuth providers actually configured on this deployment' },
  })
  .macro({
    auth: {
      async resolve({ request }) {
        const s = await auth.api.getSession({ headers: request.headers })
        if (!s) throw unauthorized()
        return { user: s.user as unknown as SessionUser, session: s.session }
      },
    },
    /** Session if present, no rejection — for endpoints that vary by viewer. */
    optionalAuth: {
      async resolve({ request }) {
        const s = await auth.api.getSession({ headers: request.headers })
        return {
          user: (s?.user as unknown as SessionUser) ?? null,
          session: s?.session ?? null,
        }
      },
    },
  })
