import { describe, expect, it } from 'bun:test'
import { call, signUp } from '../../test/client'
import { createLeague, invite, joinWithCode } from '../../test/fixtures'
import { slugify } from './service'
import { assertStatus, canTransition } from './status'

describe('slug', () => {
  it('makes a url-safe slug', () => {
    expect(slugify('Ubers Draft League 2026!')).toBe('ubers-draft-league-2026')
    expect(slugify('  ---  ')).toBe('')
  })
})

describe('lifecycle gate', () => {
  it('allows only the legal transitions', () => {
    expect(canTransition('setup', 'drafting')).toBe(true)
    expect(canTransition('setup', 'playoffs')).toBe(false)
    expect(canTransition('complete', 'regular_season')).toBe(false)
    expect(canTransition('archived', 'setup')).toBe(false)
  })

  it('throws with the current status attached', () => {
    expect(() => assertStatus({ status: 'drafting' }, ['setup'])).toThrow(/drafting/)
  })
})

describe('leagues', () => {
  it('makes the creator host and a member in one step', async () => {
    const host = await signUp()
    const league = await createLeague(host)

    const res = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
    const body = (await res.json()) as {
      members: { role: string }[]
      me: { role: string }
      settings: { budget: number }
    }
    expect(body.members).toHaveLength(1)
    expect(body.me.role).toBe('host')
    expect(body.settings.budget).toBeGreaterThan(0)
  })

  it('is 404, not 403, to a non-member of a private league', async () => {
    const host = await signUp()
    const stranger = await signUp()
    const league = await createLeague(host, { visibility: 'private' })

    const res = await call(`/leagues/${league.id}`, { headers: { cookie: stranger.cookie } })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('LEAGUE_NOT_FOUND')
  })

  it('keeps private leagues out of the public directory', async () => {
    const host = await signUp()
    const league = await createLeague(host, { visibility: 'private' })
    const res = await call('/leagues?limit=100')
    const body = (await res.json()) as { items: { id: string }[] }
    expect(body.items.some((l) => l.id === league.id)).toBe(false)
  })

  it('resolves a league by slug as well as by id', async () => {
    const host = await signUp()
    const league = await createLeague(host, { visibility: 'public' })
    const res = await call(`/leagues/${league.slug}`)
    expect(res.status).toBe(200)
  })

  it('rejects an unknown format at creation', async () => {
    const host = await signUp()
    const res = await call('/leagues', {
      method: 'POST',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Format League', formatId: 'gen9nope' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORMAT_NOT_FOUND')
  })

  it('lets a stranger join with an invite code', async () => {
    const host = await signUp()
    const player = await signUp()
    const league = await createLeague(host)
    const code = await invite(host, league.id)

    const res = await joinWithCode(player, code)
    expect(res.status).toBe(200)

    const view = await call(`/leagues/${league.id}`, { headers: { cookie: player.cookie } })
    const body = (await view.json()) as { members: unknown[] }
    expect(body.members).toHaveLength(2)
  })

  it('refuses a revoked code', async () => {
    const host = await signUp()
    const player = await signUp()
    const league = await createLeague(host)
    const code = await invite(host, league.id)

    await call(`/leagues/${league.id}/invites/${code}`, {
      method: 'DELETE',
      headers: { cookie: host.cookie },
    })
    const res = await joinWithCode(player, code)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVITE_INVALID')
  })

  it('refuses to exceed capacity', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    await call(`/leagues/${league.id}/settings`, {
      method: 'PATCH',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ maxMembers: 1 }),
    })

    const code = await invite(host, league.id)
    const player = await signUp()
    const res = await joinWithCode(player, code)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('LEAGUE_FULL')
  })

  it('refuses a non-host trying to invite', async () => {
    const host = await signUp()
    const player = await signUp()
    const league = await createLeague(host, { visibility: 'public' })
    await call(`/leagues/${league.id}/join`, {
      method: 'POST',
      headers: { cookie: player.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await call(`/leagues/${league.id}/invites`, {
      method: 'POST',
      headers: { cookie: player.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('leaves exactly one host after a transfer', async () => {
    const host = await signUp()
    const player = await signUp()
    const league = await createLeague(host)
    const code = await invite(host, league.id)
    await joinWithCode(player, code)

    const view = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
    const { members } = (await view.json()) as { members: { id: string; userId: string }[] }
    const target = members.find((m) => m.userId !== host.body.user.id)!

    const res = await call(`/leagues/${league.id}/members/${target.id}`, {
      method: 'PATCH',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'host' }),
    })
    expect(res.status).toBe(200)

    const after = await call(`/leagues/${league.id}`, { headers: { cookie: player.cookie } })
    const body = (await after.json()) as {
      league: { hostId: string }
      members: { role: string }[]
    }
    expect(body.members.filter((m) => m.role === 'host')).toHaveLength(1)
    expect(body.league.hostId).toBe(target.userId)
  })

  it('draws a draft order covering every active member exactly once', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    const code = await invite(host, league.id)
    for (let i = 0; i < 3; i++) await joinWithCode(await signUp(), code)

    const res = await call(`/leagues/${league.id}/draft-order`, {
      method: 'POST',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'random' }),
    })
    expect(res.status).toBe(200)
    const order = (await res.json()) as { memberId: string; draftPosition: number }[]
    expect(order).toHaveLength(4)
    expect(order.map((o) => o.draftPosition)).toEqual([1, 2, 3, 4])
    expect(new Set(order.map((o) => o.memberId)).size).toBe(4)
  })

  it('rejects a manual order that misses someone', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    const code = await invite(host, league.id)
    await joinWithCode(await signUp(), code)

    const view = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
    const { members } = (await view.json()) as { members: { id: string }[] }

    const res = await call(`/leagues/${league.id}/draft-order`, {
      method: 'POST',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', order: [members[0]!.id] }),
    })
    expect(res.status).toBe(400)
  })
})
