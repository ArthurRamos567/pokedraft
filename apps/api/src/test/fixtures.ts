import { call, signUp } from './client'

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

const POOL_YML = [
  'landorustherian: 20',
  'gholdengo: 19',
  'kingambit: 18',
  'dragapult: 17',
  'ironvaliant: 16',
  'toxapex: 15',
  'corviknight: 14',
  'ironmoth: 13',
  'garganacl: 11',
  'greattusk: 10',
  'cinderace: 9',
  'clefable: 8',
  'tyranitar: 6',
  'weavile: 5',
  'scizor: 4',
  'rotomwash: 3',
  'skarmory: 2',
  'blissey: 1',
].join('\n')

const send = (cookie: string, path: string, body?: unknown) =>
  call(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/**
 * A league whose draft has run to completion, which is what leaves it in
 * `regular_season` — the only status a season can be generated from.
 */
export async function draftedLeague(memberCount: number, settings: Record<string, unknown> = {}) {
  const host = await signUp()
  const league = await createLeague(host)
  await call(`/leagues/${league.id}/settings`, {
    method: 'PATCH',
    headers: { cookie: host.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ budget: 30, rosterMin: 1, rosterMax: 2, maxMembers: 12, ...settings }),
  })

  const code = await invite(host, league.id)
  const players: Actor[] = [host]
  for (let i = 1; i < memberCount; i++) {
    const p = await signUp()
    await joinWithCode(p, code)
    players.push(p)
  }

  const preview = await send(host.cookie, `/leagues/${league.id}/points/preview`, {
    source: POOL_YML,
  })
  const { hash } = (await preview.json()) as { hash: string }
  await send(host.cookie, `/leagues/${league.id}/points/commit`, { source: POOL_YML, hash })
  await send(host.cookie, `/leagues/${league.id}/draft-order`, { mode: 'random' })
  await send(host.cookie, `/leagues/${league.id}/draft/start`)

  const view = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
  const { members } = (await view.json()) as { members: { id: string; userId: string }[] }
  const cookieOf = new Map(
    players.map((p) => [members.find((m) => m.userId === p.body.user.id)!.id, p.cookie]),
  )

  for (let i = 0; i < memberCount * 4 + 4; i++) {
    const res = await call(`/leagues/${league.id}/draft`, { headers: { cookie: host.cookie } })
    const { state } = (await res.json()) as { state: { status: string; onClock: string | null } }
    if (state.status === 'complete' || !state.onClock) break

    const cookie = cookieOf.get(state.onClock)!
    const mine = await call(`/leagues/${league.id}/draft`, { headers: { cookie } })
    const body = (await mine.json()) as { me: { available: { speciesId: string }[] } }
    const choice = body.me.available.at(-1)
    if (choice) {
      await send(cookie, `/leagues/${league.id}/draft/pick`, { speciesId: choice.speciesId })
    } else {
      await send(cookie, `/leagues/${league.id}/draft/skip`, { finish: true })
    }
  }

  return { host, league, players, members, cookieOf }
}
