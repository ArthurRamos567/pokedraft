import { describe, expect, it } from 'bun:test'
import { call } from '../../test/client'
import { draftedLeague } from '../../test/fixtures'

const post = (cookie: string, path: string, body?: unknown) =>
  call(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

type Tree = {
  size: number
  status: string
  championMemberId: string | null
  seeds: { memberId: string; seed: number }[]
  rounds: {
    round: number
    matches: {
      slot: string
      homeMemberId: string | null
      awayMemberId: string | null
      homeSeed: number | null
      winnerMemberId: string | null
    }[]
  }[]
}

/** A league with a played-out season, ready for a cut. */
async function seasonPlayed(memberCount = 4) {
  const ctx = await draftedLeague(memberCount)
  const { host, league, cookieOf } = ctx

  const preview = await post(host.cookie, `/leagues/${league.id}/season/preview`, { seed: 'p' })
  const { hash } = (await preview.json()) as { hash: string }
  await post(host.cookie, `/leagues/${league.id}/season/commit`, { seed: 'p', hash })

  const schedule = await call(`/leagues/${league.id}/schedule`, {
    headers: { cookie: host.cookie },
  })
  const { weeks } = (await schedule.json()) as {
    weeks: { matchups: { id: string; homeMemberId: string; awayMemberId: string | null }[] }[]
  }

  // Home always wins, so the standings are decisive rather than a coin flip.
  for (const week of weeks) {
    for (const m of week.matchups) {
      if (!m.awayMemberId) continue
      await post(cookieOf.get(m.homeMemberId)!, `/leagues/${league.id}/matchups/${m.id}/report`, {
        winnerMemberId: m.homeMemberId,
        homeScore: 3,
        awayScore: 0,
      })
      await post(cookieOf.get(m.awayMemberId)!, `/leagues/${league.id}/matchups/${m.id}/confirm`)
    }
  }

  return ctx
}

async function generate(host: { cookie: string }, leagueId: string, body: Record<string, unknown>) {
  const preview = await post(host.cookie, `/leagues/${leagueId}/playoffs/preview`, body)
  expect(preview.status).toBe(200)
  const { hash } = (await preview.json()) as { hash: string }
  const commit = await post(host.cookie, `/leagues/${leagueId}/playoffs/commit`, { ...body, hash })
  return { commit, hash }
}

async function tree(cookie: string, leagueId: string): Promise<Tree> {
  const res = await call(`/leagues/${leagueId}/playoffs`, { headers: { cookie } })
  return (await res.json()) as Tree
}

describe('playoff generation', () => {
  it('cuts the top four and renders the tree before anything is played', async () => {
    const { host, league } = await seasonPlayed(4)
    const { commit } = await generate(host, league.id, { size: 4, thirdPlace: true })
    expect(commit.status).toBe(201)

    const bracket = await tree(host.cookie, league.id)
    expect(bracket.size).toBe(4)
    expect(bracket.seeds).toHaveLength(4)
    expect(bracket.championMemberId).toBeNull()

    // Semifinals already know who is in them: 1v4 and 2v3.
    const first = bracket.rounds[0]!.matches
    expect(first).toHaveLength(2)
    expect(first.every((m) => m.homeMemberId && m.awayMemberId)).toBe(true)
    expect(first[0]?.homeSeed).toBe(1)

    // Third place exists and is empty until the semifinals resolve.
    const third = bracket.rounds.flatMap((r) => r.matches).find((m) => m.slot === '3P')
    expect(third).toBeDefined()
    expect(third?.homeMemberId).toBeNull()
  })

  it('moves the league into playoffs and refuses a second bracket', async () => {
    const { host, league } = await seasonPlayed(4)
    await generate(host, league.id, { size: 4 })

    const view = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
    expect(((await view.json()) as { league: { status: string } }).league.status).toBe('playoffs')

    const again = await post(host.cookie, `/leagues/${league.id}/playoffs/preview`, { size: 4 })
    // The league is no longer in regular_season, so a second cut needs force.
    expect(again.status).toBe(409)
  })

  it('409s a commit whose seeds moved since the preview', async () => {
    const { host, league } = await seasonPlayed(4)
    const res = await post(host.cookie, `/leagues/${league.id}/playoffs/commit`, {
      size: 4,
      hash: 'stale',
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PREVIEW_STALE')
  })
})

describe('progression', () => {
  it('runs a bracket to a champion and completes the league', async () => {
    const { host, league } = await seasonPlayed(4)
    await generate(host, league.id, { size: 4, thirdPlace: true })

    for (let i = 0; i < 10; i++) {
      const bracket = await tree(host.cookie, league.id)
      const playable = bracket.rounds
        .flatMap((r) => r.matches)
        .find((m) => m.homeMemberId && m.awayMemberId && !m.winnerMemberId)
      if (!playable) break
      const res = await post(
        host.cookie,
        `/leagues/${league.id}/playoffs/matches/${playable.slot}/result`,
        { winnerMemberId: playable.homeMemberId },
      )
      expect(res.status).toBe(200)
    }

    const done = await tree(host.cookie, league.id)
    expect(done.championMemberId).toBeTruthy()
    expect(done.status).toBe('complete')

    const view = await call(`/leagues/${league.id}`, { headers: { cookie: host.cookie } })
    expect(((await view.json()) as { league: { status: string } }).league.status).toBe('complete')
  }, 30_000)

  it('cascades a host override over exactly the dependent subtree', async () => {
    const { host, league } = await seasonPlayed(4)
    await generate(host, league.id, { size: 4 })

    let bracket = await tree(host.cookie, league.id)
    const semis = bracket.rounds[0]!.matches
    await post(host.cookie, `/leagues/${league.id}/playoffs/matches/${semis[0]!.slot}/result`, {
      winnerMemberId: semis[0]!.homeMemberId,
    })
    await post(host.cookie, `/leagues/${league.id}/playoffs/matches/${semis[1]!.slot}/result`, {
      winnerMemberId: semis[1]!.homeMemberId,
    })

    bracket = await tree(host.cookie, league.id)
    const finalSlot = bracket.rounds.flatMap((r) => r.matches).find((m) => m.slot.startsWith('W2'))!
    expect(finalSlot.homeMemberId).toBe(semis[0]!.homeMemberId)

    const res = await call(`/leagues/${league.id}/playoffs/matches/${semis[0]!.slot}`, {
      method: 'PATCH',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ winnerMemberId: semis[0]!.awayMemberId }),
    })
    expect(res.status).toBe(200)

    bracket = await tree(host.cookie, league.id)
    const after = bracket.rounds.flatMap((r) => r.matches).find((m) => m.slot === finalSlot.slot)!
    // The corrected winner flows in; the untouched half keeps its result.
    expect(after.homeMemberId).toBe(semis[0]!.awayMemberId)
    expect(after.awayMemberId).toBe(semis[1]!.homeMemberId)
  })

  it('refuses a non-host touching the bracket', async () => {
    const { host, league, cookieOf, members } = await seasonPlayed(4)
    await generate(host, league.id, { size: 4 })
    const other = members.find((m) => m.userId !== host.body.user.id)!

    const res = await post(
      cookieOf.get(other.id)!,
      `/leagues/${league.id}/playoffs/matches/W1-1/result`,
      {
        winnerMemberId: other.id,
      },
    )
    expect(res.status).toBe(403)
  })
})
