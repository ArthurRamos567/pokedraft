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
    const patched = await call(`/leagues/${league.id}/settings`, {
      method: 'PATCH',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ maxMembers: 2 }),
    })
    expect(patched.status).toBe(200)

    const code = await invite(host, league.id)
    // The host already fills one of the two seats.
    expect((await joinWithCode(await signUp(), code)).status).toBe(200)

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

describe('setup at creation', () => {
  const YML = 'Landorus-Therian: 20\nGholdengo: 19\nToxapex: 17\n'

  const previewPool = async (cookie: string, formatId = 'gen9ou', source = YML) => {
    const res = await call('/points/preview', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ source, formatId }),
    })
    return {
      status: res.status,
      body: (await res.json()) as { hash: string; summary: { ok: number }; diff: { added: [] } },
    }
  }

  it('previews a pool before any league exists', async () => {
    const host = await signUp()
    const { status, body } = await previewPool(host.cookie)
    expect(status).toBe(200)
    expect(body.summary.ok).toBe(3)
    expect(body.diff.added).toHaveLength(3)
    expect(body.hash).toHaveLength(64)
  })

  it('rejects a preview for a format that does not exist', async () => {
    const host = await signUp()
    const { status } = await previewPool(host.cookie, 'gen9nonsense')
    expect(status).toBe(400)
  })

  it('writes rules and the pool in the same create call', async () => {
    const host = await signUp()
    const { body: preview } = await previewPool(host.cookie)

    const league = await createLeague(host, {
      settings: {
        draftMode: 'async',
        draftType: 'linear',
        pickSeconds: 45,
        turnHours: 12,
        budget: 120,
        rosterMin: 4,
        rosterMax: 8,
        maxMembers: 12,
        allowUndrafted: true,
        tradesEnabled: true,
        tradesRequireHostApproval: true,
        tradeDeadlineWeek: 7,
        autopickPolicy: 'queue_then_best',
      },
      pool: { source: YML, hash: preview.hash, name: 'Season 1 prices' },
    })

    const view = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
    const { settings } = (await view.json()) as {
      settings: {
        draftMode: string
        draftType: string
        pickSeconds: number
        turnHours: number
        budget: number
        rosterMax: number
        maxMembers: number
        tradeDeadlineWeek: number
        autopickPolicy: string
      }
    }
    expect(settings.draftMode).toBe('async')
    expect(settings.draftType).toBe('linear')
    expect(settings.pickSeconds).toBe(45)
    expect(settings.turnHours).toBe(12)
    expect(settings.budget).toBe(120)
    expect(settings.rosterMax).toBe(8)
    expect(settings.maxMembers).toBe(12)
    expect(settings.tradeDeadlineWeek).toBe(7)
    expect(settings.autopickPolicy).toBe('queue_then_best')

    const pool = await call(`/leagues/${league.id}/points`, { headers: { cookie: host.cookie } })
    const body = (await pool.json()) as {
      list: { version: number; name: string } | null
      entries: unknown[]
    }
    expect(body.list?.version).toBe(1)
    expect(body.list?.name).toBe('Season 1 prices')
    expect(body.entries).toHaveLength(3)
  })

  it('refuses a stale pool hash and writes no league at all', async () => {
    const host = await signUp()
    const { body: preview } = await previewPool(host.cookie)

    const res = await call('/leagues', {
      method: 'POST',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Stale Hash League',
        formatId: 'gen9ou',
        pool: { source: `${YML}Kingambit: 18\n`, hash: preview.hash },
      }),
    })
    expect(res.status).toBe(409)

    const mine = await call('/leagues/mine', { headers: { cookie: host.cookie } })
    expect((await mine.json()) as unknown[]).toHaveLength(0)
  })

  it('rejects a roster floor above its ceiling', async () => {
    const host = await signUp()
    const res = await call('/leagues', {
      method: 'POST',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Impossible Roster',
        formatId: 'gen9ou',
        settings: { rosterMin: 10, rosterMax: 6 },
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a pick clock below the floor', async () => {
    const host = await signUp()
    const res = await call('/leagues', {
      method: 'POST',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Instant Clock',
        formatId: 'gen9ou',
        settings: { pickSeconds: 3 },
      }),
    })
    expect(res.status).toBe(422)
  })
})
