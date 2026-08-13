import { schema } from '@pokedraft/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db'
import { env, isProd } from './env'

/**
 * A provider registers only when *both* of its variables are set. Blank OAuth
 * vars therefore mean the provider does not exist — email/password still works
 * and nothing throws. `GET /auth/providers` reports what's actually on so the
 * login screen never renders a dead button.
 */
const socialProviders = {
  ...(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
    ? {
        discord: {
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
        },
      }
    : {}),
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
}

export const enabledProviders = Object.keys(socialProviders)

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  basePath: '/api/auth',
  trustedOrigins: [env.WEB_ORIGIN],

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // No mail transport yet. Turn on with one, not before.
    requireEmailVerification: false,
    minPasswordLength: 8,
  },

  socialProviders,

  user: {
    additionalFields: {
      displayName: { type: 'string', required: false, input: true },
      /** Used in phase 6 to match replay participants. */
      showdownUsername: { type: 'string', required: false, input: true },
      avatarUrl: { type: 'string', required: false, input: true },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  advanced: {
    defaultCookieAttributes: {
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/forget-password': { window: 60, max: 3 },
    },
  },
})

export type AuthSession = typeof auth.$Infer.Session
