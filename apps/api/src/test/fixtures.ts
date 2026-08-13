import { call, type signUp } from './client'

export type Actor = Awaited<ReturnType<typeof signUp>>

export const json = (cookie: string, body?: unknown) => ({
  method: body === undefined ? 'GET' : 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

export async function createLeague(
  actor: Actor,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string; formatId: string }> {
  const res = await call('/leagues', {
    method: 'POST',
    headers: { cookie: actor.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `Test League ${crypto.randomUUID().slice(0, 8)}`,
      formatId: 'gen9ou',
      visibility: 'private',
      ...overrides,
    }),
  })
  if (res.status !== 201) throw new Error(`league create failed: ${await res.text()}`)
  return res.json() as Promise<{ id: string; slug: string; formatId: string }>
}

export async function invite(host: Actor, leagueId: string) {
  const res = await call(`/leagues/${leagueId}/invites`, {
    method: 'POST',
    headers: { cookie: host.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  const body = (await res.json()) as { code: string }
  return body.code
}

export async function joinWithCode(actor: Actor, code: string) {
  return call(`/leagues/join/${code}`, {
    method: 'POST',
    headers: { cookie: actor.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}
