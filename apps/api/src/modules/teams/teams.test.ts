import { describe, expect, it } from 'bun:test'
import { Teams } from '@pkmn/sets'
import { createDb, schema, sql } from '@pokedraft/db'
import { db } from '../../db'
import { env } from '../../env'
import { call, signUp } from '../../test/client'
import { createLeague, invite, joinWithCode } from '../../test/fixtures'
import { coverageFor, hydrateRoster, speedTiers } from './analytics'
import { leagueRosters, rosterFor } from './roster'

const YML = `
landorustherian: 20
gholdengo: 19
kingambit: 18
toxapex: 15
corviknight: 14
blissey: 1
skarmory: 2
rotomwash: 3
`

const post = (cookie: string, path: string, body?: unknown) =>
  call(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function draftedLeague() {
  const host = await signUp()
  const league = await createLeague(host)
  await call(`/leagues/${league.id}/settings`, {
    method: 'PATCH',
    headers: { cookie: host.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ budget: 40, rosterMin: 1, rosterMax: 2 }),
  })

  const code = await invite(host, league.id)
  const other = await signUp()
  await joinWithCode(other, code)

  const preview = await post(host.cookie, `/leagues/${league.id}/points/preview`, { source: YML })
  const { hash } = (await preview.json()) as { hash: string }
  await post(host.cookie, `/leagues/${league.id}/points/commit`, { source: YML, hash })
  await post(host.cookie, `/leagues/${league.id}/draft-order`, { mode: 'random' })
  await post(host.cookie, `/leagues/${league.id}/draft/start`)

  const view = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
  const { members } = (await view.json()) as { members: { id: string; userId: string }[] }
  const cookieOf = new Map([
    [members.find((m) => m.userId === host.body.user.id)!.id, host.cookie],
    [members.find((m) => m.userId === other.body.user.id)!.id, other.cookie],
  ])

  // Two rounds so both teams own something.
  for (let i = 0; i < 4; i++) {
    const res = await call(`/leagues/${league.id}/draft`, { headers: { cookie: host.cookie } })
    const { state } = (await res.json()) as { state: { onClock: string | null } }
    if (!state.onClock) break
    const cookie = cookieOf.get(state.onClock)!
    const mine = await call(`/leagues/${league.id}/draft`, { headers: { cookie } })
    const body = (await mine.json()) as { me: { available: { speciesId: string }[] } }
    const choice = body.me.available[0]
    if (!choice) break
    await post(cookie, `/leagues/${league.id}/draft/pick`, { speciesId: choice.speciesId })
  }

  return { host, other, league, members, cookieOf }
}

describe('roster derivation', () => {
  it('reflects an approved trade on both sides while leaving picks untouched', async () => {
    const { league, members } = await draftedLeague()
    const [a, b] = members
    const beforeA = await rosterFor(db, a!.id)
    const beforeB = await rosterFor(db, b!.id)
    expect(beforeA.entries.length).toBeGreaterThan(0)
    expect(beforeB.entries.length).toBeGreaterThan(0)

    const givenByA = beforeA.entries[0]!.speciesId
    const givenByB = beforeB.entries[0]!.speciesId

    const [tx] = await db
      .insert(schema.transactions)
      .values({
        leagueId: league.id,
        proposedBy: a!.id,
        counterparty: b!.id,
        status: 'approved',
        resolvedAt: new Date(),
      })
      .returning()
    await db.insert(schema.transactionItems).values([
      { transactionId: tx!.id, fromMemberId: a!.id, toMemberId: b!.id, speciesId: givenByA },
      { transactionId: tx!.id, fromMemberId: b!.id, toMemberId: a!.id, speciesId: givenByB },
    ])

    const afterA = await rosterFor(db, a!.id)
    const afterB = await rosterFor(db, b!.id)

    expect(afterA.entries.map((e) => e.speciesId)).toContain(givenByB)
    expect(afterA.entries.map((e) => e.speciesId)).not.toContain(givenByA)
    expect(afterB.entries.map((e) => e.speciesId)).toContain(givenByA)
    expect(afterB.entries.find((e) => e.speciesId === givenByB)).toBeUndefined()

    // The draft record is history and must not have moved. Scoped to this
    // league's members — other test leagues draft the same species.
    const picks = await db
      .select()
      .from(schema.draftPicks)
      .where(
        sql`${schema.draftPicks.speciesId} = ${givenByA}
            and ${schema.draftPicks.memberId} in (${a!.id}::uuid, ${b!.id}::uuid)`,
      )
    expect(picks).toHaveLength(1)
    expect(picks[0]?.memberId).toBe(a!.id)
  })

  it('ignores a trade that was never approved', async () => {
    const { league, members } = await draftedLeague()
    const [a, b] = members
    const before = await rosterFor(db, a!.id)
    const given = before.entries[0]!.speciesId

    const [tx] = await db
      .insert(schema.transactions)
      .values({ leagueId: league.id, proposedBy: a!.id, counterparty: b!.id, status: 'pending' })
      .returning()
    await db
      .insert(schema.transactionItems)
      .values({ transactionId: tx!.id, fromMemberId: a!.id, toMemberId: b!.id, speciesId: given })

    const after = await rosterFor(db, a!.id)
    expect(after.entries.map((e) => e.speciesId)).toContain(given)
  })
})

describe('team endpoints', () => {
  it('derives every roster in a fixed number of queries, whatever the team count', async () => {
    const { host, league } = await draftedLeague()

    const res = await call(`/leagues/${league.id}/teams`, { headers: { cookie: host.cookie } })
    expect(res.status).toBe(200)
    const teams = (await res.json()) as { roster: unknown[]; spent: number }[]
    expect(teams).toHaveLength(2)

    // Counted at the driver, not with a stopwatch or a global counter: roster
    // derivation is where an N+1 would live, and it must be flat in team count.
    const { db: counted, sql: raw, statements } = countingDb()
    try {
      await leagueRosters(counted, league.id)
      // postgres.js introspects array types once per fresh connection; that
      // one is the driver's, not ours.
      const ours = statements.filter((q) => !q.includes('pg_catalog'))
      expect(ours).toHaveLength(3)
    } finally {
      await raw.end()
    }
  })

  it('returns coverage, speed tiers and an export paste', async () => {
    const { host, league, members } = await draftedLeague()
    const memberId = members[0]!.id

    const coverage = await call(`/leagues/${league.id}/teams/${memberId}/coverage`, {
      headers: { cookie: host.cookie },
    })
    const cov = (await coverage.json()) as { defense: Record<string, unknown>; holes: string[] }
    expect(Object.keys(cov.defense)).toContain('Fire')
    expect(Array.isArray(cov.holes)).toBe(true)

    const speed = await call(`/leagues/${league.id}/teams/${memberId}/speed`, {
      headers: { cookie: host.cookie },
    })
    const rows = (await speed.json()) as { base: number; leaguePercentile: number }[]
    expect(rows.length).toBeGreaterThan(0)
    expect([...rows].sort((a, b) => b.base - a.base)).toEqual(rows)

    const paste = await call(`/leagues/${league.id}/teams/${memberId}/export`, {
      headers: { cookie: host.cookie },
    })
    const text = await paste.text()
    expect(text.length).toBeGreaterThan(0)
    // Round-trips through @pkmn/sets, which is the only thing that matters.
    const team = Teams.importTeam(text)
    expect(team?.team.length).toBe(rows.length)
  })

  it('separates drafted from undrafted in the pool view', async () => {
    const { host, league } = await draftedLeague()
    const res = await call(`/leagues/${league.id}/pool?status=undrafted`, {
      headers: { cookie: host.cookie },
    })
    const pool = (await res.json()) as { takenBy: string | null }[]
    expect(pool.every((p) => p.takenBy === null)).toBe(true)
  })
})

describe('analytics', () => {
  const mons = (ids: string[], formatId = 'gen9ou') =>
    hydrateRoster(
      ids.map((speciesId) => ({ speciesId, cost: 1, pickNo: 0, acquired: 'draft' as const })),
      formatId,
    )

  it('counts defensive matchups against a hand-checked team', () => {
    // Landorus-T (Ground/Flying), Toxapex (Water/Poison), Corviknight (Steel/Flying)
    const team = mons(['landorustherian', 'toxapex', 'corviknight'], 'gen9nationaldex')
    const { defense } = coverageFor(team, 'gen9nationaldex')
    expect(defense.Electric).toEqual({ weak: 2, neutral: 0, resist: 0, immune: 1 })
    expect(defense.Ground?.immune).toBe(2)
  })

  it('is generation-aware, not gen-9-hardcoded', () => {
    const modern = coverageFor(mons(['skarmory'], 'gen9ou'), 'gen9ou')
    const old = coverageFor(mons(['skarmory'], 'gen5ou'), 'gen5ou')
    expect(modern.types).toContain('Fairy')
    expect(old.types).not.toContain('Fairy')
    // Skarmory is Steel/Flying: it resisted Dark before gen 6 and doesn't now.
    expect(old.perMon[0]?.matchups.Dark).toBe(0.5)
    expect(modern.perMon[0]?.matchups.Dark).toBe(1)
  })

  it('orders speed tiers deterministically on a tie', () => {
    const rows = speedTiers(mons(['blissey', 'skarmory', 'rotomwash'], 'gen9nationaldex'))
    expect(rows.map((r) => r.base)).toEqual([...rows.map((r) => r.base)].sort((a, b) => b - a))
    expect(rows.at(-1)?.name).toBe('Blissey')
  })
})

/** A throwaway connection that records every statement it issues. */
function countingDb() {
  const statements: string[] = []
  const { db: counted, sql: raw } = createDb(env.DATABASE_URL, { max: 1 })
  const original = raw.options.debug
  raw.options.debug = (_conn: number, query: string) => {
    statements.push(query)
    if (typeof original === 'function') original(_conn, query, [], undefined as never)
  }
  return { db: counted, sql: raw, statements }
}
