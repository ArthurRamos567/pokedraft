import { describe, expect, it } from 'bun:test'
import type { DraftState } from '@pokedraft/draft'
import { call, signUp } from '../../test/client'
import { type Actor, createLeague, invite, joinWithCode } from '../../test/fixtures'

const POOL = [
  ['landorustherian', 20],
  ['gholdengo', 19],
  ['kingambit', 18],
  ['dragapult', 17],
  ['ironvaliant', 16],
  ['toxapex', 15],
  ['corviknight', 14],
  ['ironmoth', 13],
  ['slowkinggalar', 12],
  ['garganacl', 11],
  ['greattusk', 10],
  ['cinderace', 9],
  ['clefable', 8],
  ['ironhands', 7],
  ['tyranitar', 6],
  ['weavile', 5],
  ['scizor', 4],
  ['rotomwash', 3],
  ['skarmory', 2],
  ['blissey', 1],
] as const

const yml = POOL.map(([id, cost]) => `${id}: ${cost}`).join('\n')

const post = (cookie: string, path: string, body?: unknown) =>
  call(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** A league with N members, an order drawn, points imported and a draft started. */
async function readyLeague(memberCount: number, settings: Record<string, unknown> = {}) {
  const host = await signUp()
  const league = await createLeague(host, { visibility: 'private' })

  await call(`/leagues/${league.id}/settings`, {
    method: 'PATCH',
    headers: { cookie: host.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      budget: 40,
      rosterMin: 2,
      rosterMax: 3,
      maxMembers: 12,
      pickSeconds: 90,
      ...settings,
    }),
  })

  const code = await invite(host, league.id)
  const players: Actor[] = [host]
  for (let i = 1; i < memberCount; i++) {
    const p = await signUp()
    await joinWithCode(p, code)
    players.push(p)
  }

  const preview = await post(host.cookie, `/leagues/${league.id}/points/preview`, { source: yml })
  const { hash } = (await preview.json()) as { hash: string }
  await post(host.cookie, `/leagues/${league.id}/points/commit`, { source: yml, hash })

  await post(host.cookie, `/leagues/${league.id}/draft-order`, { mode: 'random' })
  const start = await post(host.cookie, `/leagues/${league.id}/draft/start`)
  expect(start.status).toBe(201)

  const view = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
  const { members } = (await view.json()) as {
    members: { id: string; userId: string; draftPosition: number }[]
  }
  const byUser = new Map(members.map((m) => [m.userId, m.id]))
  const cookieOf = new Map(players.map((p) => [byUser.get(p.body.user.id)!, p.cookie]))

  return { host, league, players, members, cookieOf }
}

async function draftState(cookie: string, leagueId: string): Promise<DraftState> {
  const res = await call(`/leagues/${leagueId}/draft`, { headers: { cookie } })
  const body = (await res.json()) as { state: DraftState }
  return body.state
}

describe('draft start', () => {
  it('refuses to start without a drawn order', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    const code = await invite(host, league.id)
    await joinWithCode(await signUp(), code)

    const preview = await post(host.cookie, `/leagues/${league.id}/points/preview`, { source: yml })
    const { hash } = (await preview.json()) as { hash: string }
    await post(host.cookie, `/leagues/${league.id}/points/commit`, { source: yml, hash })

    const res = await post(host.cookie, `/leagues/${league.id}/draft/start`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('order')
  })

  it('refuses to start without a points list', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    const code = await invite(host, league.id)
    await joinWithCode(await signUp(), code)
    await post(host.cookie, `/leagues/${league.id}/draft-order`, { mode: 'random' })

    const res = await post(host.cookie, `/leagues/${league.id}/draft/start`)
    expect(res.status).toBe(400)
  })

  it('locks the points list and moves the league to drafting', async () => {
    const { host, league } = await readyLeague(2)

    const res = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
    const body = (await res.json()) as { league: { status: string } }
    expect(body.league.status).toBe('drafting')

    const edit = await call(`/leagues/${league.id}/points/entries/blissey`, {
      method: 'PATCH',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ points: 2 }),
    })
    expect(edit.status).toBe(409)
  })

  it('refuses a second draft in the same league', async () => {
    const { host, league } = await readyLeague(2)
    const res = await post(host.cookie, `/leagues/${league.id}/draft/start`)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('picking through the API', () => {
  it('accepts the on-clock team and rejects everyone else', async () => {
    const { league, cookieOf } = await readyLeague(2)
    const state = await draftState([...cookieOf.values()][0]!, league.id)
    const onClock = state.onClock!
    const other = state.order.find((m) => m !== onClock)!

    const wrong = await post(cookieOf.get(other)!, `/leagues/${league.id}/draft/pick`, {
      speciesId: 'gholdengo',
    })
    expect(wrong.status).toBe(422)
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe('NOT_YOUR_TURN')

    const right = await post(cookieOf.get(onClock)!, `/leagues/${league.id}/draft/pick`, {
      speciesId: 'gholdengo',
    })
    expect(right.status).toBe(200)
  })

  it('lets exactly one of two racing picks take the species', async () => {
    const { league, cookieOf } = await readyLeague(2)
    const state = await draftState([...cookieOf.values()][0]!, league.id)
    const onClock = state.onClock!
    const cookie = cookieOf.get(onClock)!

    // Both requests are in flight before either transaction commits.
    const [a, b] = await Promise.all([
      post(cookie, `/leagues/${league.id}/draft/pick`, { speciesId: 'kingambit' }),
      post(cookie, `/leagues/${league.id}/draft/pick`, { speciesId: 'kingambit' }),
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses[0]).toBe(200)
    expect(statuses[1]).toBeGreaterThanOrEqual(400)

    const after = await draftState(cookie, league.id)
    expect(after.pickNo).toBe(1)
    expect(Object.keys(after.taken)).toEqual(['kingambit'])
  })

  it('rejects a species the team cannot afford', async () => {
    const { league, cookieOf } = await readyLeague(2, { budget: 10, rosterMin: 1, rosterMax: 3 })
    const state = await draftState([...cookieOf.values()][0]!, league.id)
    const cookie = cookieOf.get(state.onClock!)!

    const res = await post(cookie, `/leagues/${league.id}/draft/pick`, {
      speciesId: 'landorustherian',
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'INSUFFICIENT_POINTS',
    )
  })

  it('serves an available pool already filtered by budget', async () => {
    const { league, cookieOf } = await readyLeague(2, { budget: 12, rosterMin: 1, rosterMax: 3 })
    const cookie = [...cookieOf.values()][0]!
    const res = await call(`/leagues/${league.id}/draft`, { headers: { cookie } })
    const body = (await res.json()) as { me: { available: { points: number }[] } }
    expect(body.me.available.every((s) => s.points <= 12)).toBe(true)
  })
})

describe('host controls', () => {
  it('pauses, refuses picks, then resumes with a fresh deadline', async () => {
    const { host, league, cookieOf } = await readyLeague(2)
    const state = await draftState(host.cookie, league.id)
    const cookie = cookieOf.get(state.onClock!)!

    await post(host.cookie, `/leagues/${league.id}/draft/pause`, { reason: 'dinner' })
    const blocked = await post(cookie, `/leagues/${league.id}/draft/pick`, {
      speciesId: 'gholdengo',
    })
    expect(blocked.status).toBe(422)
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      'DRAFT_NOT_ACTIVE',
    )

    const resumed = await post(host.cookie, `/leagues/${league.id}/draft/resume`)
    expect(resumed.status).toBe(200)
    const after = await draftState(host.cookie, league.id)
    expect(after.status).toBe('active')
    expect(after.deadline).toBeGreaterThan(Date.now())
    expect(after.onClock).toBe(state.onClock)
  })

  it('undoes the last pick by replay: budget back, species free, clock rewound', async () => {
    const { host, league, cookieOf } = await readyLeague(2)
    const before = await draftState(host.cookie, league.id)
    const picker = before.onClock!
    await post(cookieOf.get(picker)!, `/leagues/${league.id}/draft/pick`, {
      speciesId: 'landorustherian',
    })

    const undone = await post(host.cookie, `/leagues/${league.id}/draft/undo`)
    expect(undone.status).toBe(200)

    const after = await draftState(host.cookie, league.id)
    expect(after.pickNo).toBe(0)
    expect(after.taken.landorustherian).toBeUndefined()
    expect(after.teams[picker]?.spent).toBe(0)
    expect(after.onClock).toBe(picker)
  })

  it('refuses an undo with nothing to undo', async () => {
    const { host, league } = await readyLeague(2)
    const res = await post(host.cookie, `/leagues/${league.id}/draft/undo`)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOTHING_TO_UNDO')
  })

  it('refuses a non-host pausing', async () => {
    const { league, cookieOf, members, host } = await readyLeague(2)
    const other = members.find((m) => m.userId !== host.body.user.id)!
    const res = await post(cookieOf.get(other.id)!, `/leagues/${league.id}/draft/pause`)
    expect(res.status).toBe(403)
  })
})

describe('queue', () => {
  it('stores a wishlist in priority order and rejects duplicates', async () => {
    const { host, league } = await readyLeague(2)

    const ok = await call(`/leagues/${league.id}/draft/queue`, {
      method: 'PUT',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ speciesIds: ['gholdengo', 'kingambit'] }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual([
      { speciesId: 'gholdengo', rank: 0 },
      { speciesId: 'kingambit', rank: 1 },
    ])

    const dupe = await call(`/leagues/${league.id}/draft/queue`, {
      method: 'PUT',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ speciesIds: ['gholdengo', 'gholdengo'] }),
    })
    expect(dupe.status).toBe(400)
  })
})

describe('full draft', () => {
  it('runs 4 teams to completion and rebuilds exactly from events', async () => {
    const { host, league, cookieOf } = await readyLeague(4, {
      budget: 40,
      rosterMin: 2,
      rosterMax: 3,
    })

    let state = await draftState(host.cookie, league.id)
    let guard = 0
    while (state.status !== 'complete' && guard++ < 60) {
      const onClock = state.onClock!
      const cookie = cookieOf.get(onClock)!

      const view = await call(`/leagues/${league.id}/draft`, { headers: { cookie } })
      const body = (await view.json()) as { me: { available: { speciesId: string }[] } }
      const candidate = body.me.available.at(-1)

      const res = candidate
        ? await post(cookie, `/leagues/${league.id}/draft/pick`, {
            speciesId: candidate.speciesId,
          })
        : await post(cookie, `/leagues/${league.id}/draft/skip`, { finish: true })
      expect(res.status).toBe(200)
      state = ((await res.json()) as { state: DraftState }).state
    }

    expect(state.status).toBe('complete')
    expect(Object.keys(state.taken).length).toBeGreaterThanOrEqual(8)

    // The cache is only a cache: folding draft_events from scratch must land on
    // the same state. Compared by value, not by serialization — jsonb does not
    // preserve key order, and that is not a difference anyone can observe.
    const rebuilt = await call(`/leagues/${league.id}/draft/rebuild`, {
      headers: { cookie: host.cookie },
    })
    const { state: fromEvents } = (await rebuilt.json()) as { state: DraftState }
    expect(fromEvents).toEqual(state)

    const league_ = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
    expect(((await league_.json()) as { league: { status: string } }).league.status).toBe(
      'regular_season',
    )
  }, 30_000)

  it('exposes a gapless event log', async () => {
    const { host, league, cookieOf } = await readyLeague(2)
    const state = await draftState(host.cookie, league.id)
    await post(cookieOf.get(state.onClock!)!, `/leagues/${league.id}/draft/pick`, {
      speciesId: 'blissey',
    })

    const res = await call(`/leagues/${league.id}/draft/events`, {
      headers: { cookie: host.cookie },
    })
    const events = (await res.json()) as { seq: number; type: string }[]
    expect(events[0]?.type).toBe('DRAFT_STARTED')
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
  })
})
