import { describe, expect, it } from 'bun:test'
import { loadEnv } from './env'

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5442/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  WEB_ORIGIN: 'http://localhost:5173',
}

describe('env', () => {
  it('applies defaults for optional keys', () => {
    const env = loadEnv(valid)
    expect(env.PORT).toBe(3000)
    expect(env.NODE_ENV).toBe('development')
  })

  it('coerces PORT from a string', () => {
    expect(loadEnv({ ...valid, PORT: '4000' }).PORT).toBe(4000)
  })

  it('reports every missing key at once, not one per restart', () => {
    let message = ''
    try {
      loadEnv({ BETTER_AUTH_URL: 'http://localhost:3000' })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('BETTER_AUTH_SECRET')
    expect(message).toContain('WEB_ORIGIN')
  })

  it('treats a blank value as unset', () => {
    let threw = false
    try {
      loadEnv({ ...valid, DATABASE_URL: '' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  it('leaves blank oauth vars undefined rather than empty strings', () => {
    const env = loadEnv({ ...valid, DISCORD_CLIENT_ID: '', GOOGLE_CLIENT_ID: '' })
    expect(env.DISCORD_CLIENT_ID).toBeUndefined()
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
  })

  it('rejects a secret that is too short to be a secret', () => {
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: 'short' })).toThrow()
  })
})
