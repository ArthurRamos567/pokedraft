import { describe, expect, it } from 'bun:test'
import { db } from '../../db'
import { call } from '../../test/client'
import { draftedLeague } from '../../test/fixtures'
import { rosterFor } from '../teams/roster'
import { validateTrade } from './validate'

const post = (cookie: string, path: string, body?: unknown) =>
  call(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** A drafted league moved into regular_season, which is when trading opens. */
async function tradingLeague(memberCount = 4) {
  const ctx = await draftedLeague(memberCount)
  const preview = await post(ctx.host.cookie, `/leagues/${ctx.league.id}/season/preview`, {
    seed: 't',
  })
  const { hash } = (await preview.json()) as { hash: string }
  await post(ctx.host.cookie, `/leagues/${ctx.league.id}/season/commit`, { seed: 't', hash })
  return ctx
}

const entry = (speciesId: string, cost: number) => ({
  speciesId,
  cost,
  pickNo: 0,
  acquired: 'draft' as const,
})

const RULES = {
  tradesEnabled: true,
  leagueStatus: 'regular_season',
  rosterMin: 1,
  rosterMax: 3,
  budget: 30,
  enforcePostTradeCap: false,
  tradeDeadlineWeek: null,
  currentWeek: 1,
}

describe('trade validation', () => {
  const a = {
    memberId: 'a',
    active: true,
    roster: [entry('gholdengo', 19), entry('blissey', 1)],
    gives: [] as string[],
  }
  const b = {
    memberId: 'b',
    active: true,
    roster: [entry('kingambit', 18), entry('skarmory', 2)],
    gives: [] as string[],
  }

  it('accepts a straight one-for-one', () => {
    const v = validateTrade(RULES, { ...a, gives: ['gholdengo'] }, { ...b, gives: ['kingambit'] })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.result[0]?.roster.sort()).toEqual(['blissey', 'kingambit'])
      expect(v.result[1]?.roster.sort()).toEqual(['gholdengo', 'skarmory'])
    }
  })

  it('refuses to trade away something not on the roster', () => {
    const v = validateTrade(RULES, { ...a, gives: ['dragapult'] }, { ...b, gives: ['kingambit'] })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.problems[0]?.code).toBe('NOT_ON_ROSTER')
  })

  it('refuses a trade that would break a roster limit', () => {
    const v = validateTrade(
      { ...RULES, rosterMax: 2 },
      { ...a, gives: [] },
      { ...b, gives: ['kingambit'] },
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.problems.some((p) => p.code === 'ROSTER_LIMIT')).toBe(true)
  })

  it('refuses a trade with itself, and an empty one', () => {
    const same = validateTrade(RULES, { ...a, gives: ['blissey'] }, { ...a, gives: ['gholdengo'] })
    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.problems.some((p) => p.code === 'SAME_MEMBER')).toBe(true)

    const empty = validateTrade(RULES, a, b)
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.problems.some((p) => p.code === 'EMPTY_TRADE')).toBe(true)
  })

  it('refuses trading while the league is not in season', () => {
    const v = validateTrade(
      { ...RULES, leagueStatus: 'drafting' },
      { ...a, gives: ['gholdengo'] },
      { ...b, gives: ['kingambit'] },
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.problems.some((p) => p.code === 'TRADE_WINDOW_CLOSED')).toBe(true)
  })

  it('refuses after the trade deadline', () => {
    const v = validateTrade(
      { ...RULES, tradeDeadlineWeek: 3, currentWeek: 4 },
      { ...a, gives: ['gholdengo'] },
      { ...b, gives: ['kingambit'] },
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.problems.some((p) => p.code === 'TRADE_WINDOW_CLOSED')).toBe(true)
  })

  it('lets value drift unless the league enforces a post-trade cap', () => {
    const lopsided = { ...RULES, budget: 20 }
    const drift = validateTrade(
      lopsided,
      { ...a, gives: ['blissey'] },
      { ...b, gives: ['kingambit'] },
    )
    expect(drift.ok).toBe(true)

    const capped = validateTrade(
      { ...lopsided, enforcePostTradeCap: true },
      { ...a, gives: ['blissey'] },
      { ...b, gives: ['kingambit'] },
    )
    expect(capped.ok).toBe(false)
    if (!capped.ok) expect(capped.problems.some((p) => p.code === 'OVER_CAP')).toBe(true)
  })

  it('refuses a trade that would duplicate a species', () => {
    const v = validateTrade(
      RULES,
      { ...a, roster: [entry('kingambit', 18), entry('blissey', 1)], gives: ['blissey'] },
      { ...b, gives: ['kingambit'] },
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.problems.some((p) => p.code === 'DUPLICATE_SPECIES')).toBe(true)
  })
})

describe('trade flow', () => {
  it('proposes, accepts, and the roster fold reflects it for both sides', async () => {
    const { league, members, cookieOf } = await tradingLeague(2)
    const [a, b] = members
    const rosterA = await rosterFor(db, a!.id)
    const rosterB = await rosterFor(db, b!.id)
    const gives = rosterA.entries[0]!.speciesId
    const gets = rosterB.entries[0]!.speciesId

    const proposed = await post(cookieOf.get(a!.id)!, `/leagues/${league.id}/transactions`, {
      counterpartyId: b!.id,
      gives: [gives],
      gets: [gets],
    })
    expect(proposed.status).toBe(201)
    const trade = (await proposed.json()) as { id: string; status: string }
    expect(trade.status).toBe('pending')

    const accepted = await post(
      cookieOf.get(b!.id)!,
      `/leagues/${league.id}/transactions/${trade.id}/accept`,
    )
    expect(accepted.status).toBe(200)
    expect(((await accepted.json()) as { status: string }).status).toBe('approved')

    const afterA = await rosterFor(db, a!.id)
    const afterB = await rosterFor(db, b!.id)
    expect(afterA.entries.map((e) => e.speciesId)).toContain(gets)
    expect(afterA.entries.map((e) => e.speciesId)).not.toContain(gives)
    expect(afterB.entries.map((e) => e.speciesId)).toContain(gives)
    expect(afterB.entries.map((e) => e.speciesId)).not.toContain(gets)
  })

  it('refuses anyone but the counterparty accepting', async () => {
    const { league, members, cookieOf } = await tradingLeague(3)
    const [a, b, c] = members
    const rosterA = await rosterFor(db, a!.id)
    const rosterB = await rosterFor(db, b!.id)

    const proposed = await post(cookieOf.get(a!.id)!, `/leagues/${league.id}/transactions`, {
      counterpartyId: b!.id,
      gives: [rosterA.entries[0]!.speciesId],
      gets: [rosterB.entries[0]!.speciesId],
    })
    const trade = (await proposed.json()) as { id: string }

    const wrong = await post(
      cookieOf.get(c!.id)!,
      `/leagues/${league.id}/transactions/${trade.id}/accept`,
    )
    expect(wrong.status).toBe(403)

    const alsoWrong = await post(
      cookieOf.get(a!.id)!,
      `/leagues/${league.id}/transactions/${trade.id}/accept`,
    )
    expect(alsoWrong.status).toBe(403)
  })

  it('lets only the proposer cancel', async () => {
    const { league, members, cookieOf } = await tradingLeague(2)
    const [a, b] = members
    const rosterA = await rosterFor(db, a!.id)
    const rosterB = await rosterFor(db, b!.id)

    const proposed = await post(cookieOf.get(a!.id)!, `/leagues/${league.id}/transactions`, {
      counterpartyId: b!.id,
      gives: [rosterA.entries[0]!.speciesId],
      gets: [rosterB.entries[0]!.speciesId],
    })
    const trade = (await proposed.json()) as { id: string }

    const notMine = await post(
      cookieOf.get(b!.id)!,
      `/leagues/${league.id}/transactions/${trade.id}/cancel`,
    )
    expect(notMine.status).toBe(403)

    const mine = await post(
      cookieOf.get(a!.id)!,
      `/leagues/${league.id}/transactions/${trade.id}/cancel`,
    )
    expect(((await mine.json()) as { status: string }).status).toBe('cancelled')
  })

  it('validates as a dry run without writing anything', async () => {
    const { league, members, cookieOf } = await tradingLeague(2)
    const [a, b] = members
    const rosterA = await rosterFor(db, a!.id)

    const res = await post(cookieOf.get(a!.id)!, `/leagues/${league.id}/transactions/validate`, {
      counterpartyId: b!.id,
      gives: [rosterA.entries[0]!.speciesId],
      gets: ['dragapult'],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; problems: { code: string }[] }
    expect(body.ok).toBe(false)
    expect(body.problems[0]?.code).toBe('NOT_ON_ROSTER')

    const log = await call(`/leagues/${league.id}/transactions`, {
      headers: { cookie: cookieOf.get(a!.id)! },
    })
    expect(await log.json()).toEqual([])
  })
})

describe('concurrency', () => {
  it('lets only one of two trades that share a mon go through', async () => {
    const { league, members, cookieOf } = await tradingLeague(3)
    const [a, b, c] = members
    const rosterA = await rosterFor(db, a!.id)
    const rosterB = await rosterFor(db, b!.id)
    const rosterC = await rosterFor(db, c!.id)
    const contested = rosterA.entries[0]!.speciesId

    const first = await post(cookieOf.get(a!.id)!, `/leagues/${league.id}/transactions`, {
      counterpartyId: b!.id,
      gives: [contested],
      gets: [rosterB.entries[0]!.speciesId],
    })
    const second = await post(cookieOf.get(a!.id)!, `/leagues/${league.id}/transactions`, {
      counterpartyId: c!.id,
      gives: [contested],
      gets: [rosterC.entries[0]!.speciesId],
    })
    const t1 = (await first.json()) as { id: string }
    const t2 = (await second.json()) as { id: string }

    // Both counterparties accept at the same instant.
    const [r1, r2] = await Promise.all([
      post(cookieOf.get(b!.id)!, `/leagues/${league.id}/transactions/${t1.id}/accept`),
      post(cookieOf.get(c!.id)!, `/leagues/${league.id}/transactions/${t2.id}/accept`),
    ])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses[0]).toBe(200)
    expect(statuses[1]).toBeGreaterThanOrEqual(400)

    // The mon ended up in exactly one place.
    const rosters = await Promise.all([a!.id, b!.id, c!.id].map((id) => rosterFor(db, id)))
    const holders = rosters.filter((r) => r.entries.some((e) => e.speciesId === contested))
    expect(holders).toHaveLength(1)
  })

  it('does not deadlock on two mirrored trades', async () => {
    const { league, members, cookieOf } = await tradingLeague(2)
    const [a, b] = members
    const rosterA = await rosterFor(db, a!.id)
    const rosterB = await rosterFor(db, b!.id)

    const one = await post(cookieOf.get(a!.id)!, `/leagues/${league.id}/transactions`, {
      counterpartyId: b!.id,
      gives: [rosterA.entries[0]!.speciesId],
      gets: [rosterB.entries[0]!.speciesId],
    })
    const other = await post(cookieOf.get(b!.id)!, `/leagues/${league.id}/transactions`, {
      counterpartyId: a!.id,
      gives: [rosterB.entries.at(-1)!.speciesId],
      gets: [rosterA.entries.at(-1)!.speciesId],
    })
    const t1 = (await one.json()) as { id: string }
    const t2 = (await other.json()) as { id: string }

    const results = await Promise.all([
      post(cookieOf.get(b!.id)!, `/leagues/${league.id}/transactions/${t1.id}/accept`),
      post(cookieOf.get(a!.id)!, `/leagues/${league.id}/transactions/${t2.id}/accept`),
    ])
    // Whatever the outcome, neither request may hang or 500 on a deadlock.
    expect(results.every((r) => r.status < 500)).toBe(true)
  })
})
