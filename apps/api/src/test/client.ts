import { treaty } from '@elysiajs/eden'
import { app } from '../app'

/** Eden Treaty over `app.handle()` — typed, in-process, no port bound. */
export const api = treaty(app)

export async function call(path: string, init?: RequestInit) {
  return app.handle(new Request(`http://localhost${path}`, init))
}

let n = 0
export const uniqueEmail = () => `test-${Date.now()}-${n++}@example.test`

/**
 * Signs up a throwaway user and returns the session cookie header.
 * Tests run against the dev database, so every fixture is uniquely named.
 */
export async function signUp(
  overrides: Partial<{ email: string; password: string; name: string }> = {},
) {
  const email = overrides.email ?? uniqueEmail()
  const password = overrides.password ?? 'correct-horse-battery'
  const name = overrides.name ?? 'Test User'

  const res = await call('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })
  if (!res.ok) throw new Error(`sign-up failed (${res.status}): ${await res.text()}`)

  const setCookie = res.headers.getSetCookie().map((c) => c.split(';')[0])
  return { email, password, name, cookie: setCookie.join('; '), body: await res.json() }
}
