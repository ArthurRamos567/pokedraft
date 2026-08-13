import { Value } from '@sinclair/typebox/value'
import { t } from 'elysia'

/**
 * Validated once at import. Reports *every* missing key at once — a restart
 * per typo is a bad way to spend an afternoon.
 */
const EnvSchema = t.Object({
  DATABASE_URL: t.String({ minLength: 1 }),
  BETTER_AUTH_SECRET: t.String({ minLength: 16 }),
  BETTER_AUTH_URL: t.String({ format: 'uri' }),
  WEB_ORIGIN: t.String({ minLength: 1 }),

  PORT: t.Number({ default: 3000 }),
  NODE_ENV: t.Union([t.Literal('development'), t.Literal('test'), t.Literal('production')], {
    default: 'development',
  }),
  LOG_LEVEL: t.String({ default: 'info' }),

  TEST_DATABASE_URL: t.Optional(t.String()),
  DISCORD_CLIENT_ID: t.Optional(t.String()),
  DISCORD_CLIENT_SECRET: t.Optional(t.String()),
  GOOGLE_CLIENT_ID: t.Optional(t.String()),
  GOOGLE_CLIENT_SECRET: t.Optional(t.String()),
})

export type Env = typeof EnvSchema.static

function load(source: Record<string, string | undefined>): Env {
  // Blank strings are "unset" — an empty OAuth var in .env must not register a
  // half-configured provider.
  const raw: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== '') raw[k] = v
  }

  const coerced = Value.Convert(EnvSchema, Value.Default(EnvSchema, raw))
  const errors = [...Value.Errors(EnvSchema, coerced)]
  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.path.slice(1) || '(root)'}: ${e.message}`)
    throw new Error(`invalid environment:\n${lines.join('\n')}\n\nsee .env.example`)
  }
  return coerced as Env
}

export { EnvSchema, load as loadEnv }

export const env = load(process.env as Record<string, string | undefined>)

export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
