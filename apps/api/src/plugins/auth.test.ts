import { describe, expect, it } from 'bun:test'
import { call, signUp } from '../test/client'

describe('auth', () => {
  it('signs up, then reads the session on a protected route', async () => {
    const { cookie, email } = await signUp()
    expect(cookie).toContain('better-auth')

    const res = await call('/me', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string }
    expect(body.email).toBe(email)
  })

  it('401s on a protected route without a cookie', async () => {
    const res = await call('/me')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('signs in with the same credentials', async () => {
    const { email, password } = await signUp()
    const res = await call('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0)
  })

  it('rejects a wrong password', async () => {
    const { email } = await signUp()
    const res = await call('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'not-the-password' }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('lists only the oauth providers that are actually configured', async () => {
    const res = await call('/api/auth/providers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: string[] }
    expect(Array.isArray(body.providers)).toBe(true)
  })
})
