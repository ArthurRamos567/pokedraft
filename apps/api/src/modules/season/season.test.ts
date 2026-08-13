import { describe, expect, it } from 'bun:test'
import { call } from '../../test/client'
import { draftedLeague } from '../../test/fixtures'

const post = (cookie: string, path: string, body?: unknown) =>
  call(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

type Week = {
  id: string
  number: number
  matchups: { id: string; homeMemberId: string; awayMemberId: string | null }[]
}

/** A league past its draft, with a committed season. */
async function seasonLeague(memberCount = 4) {
  const { host, league, members, cookieOf } = await draftedLeague(memberCount)

  const preview = await post(host.cookie, `/leagues/${league.id}/season/preview`, {
    seed: 'test-seed',
  })
  const body = (await preview.json()) as { hash: string; weeks: unknown[] }
  const committed = await post(host.cookie, `/leagues/${league.id}/season/commit`, {
    seed: 'test-seed',
    hash: body.hash,
  })
  expect(committed.status).toBe(201)

  const schedule = await call(`/leagues/${league.id}/schedule`, {
    headers: { cookie: host.cookie },
  })
  const { weeks } = (await schedule.json()) as { weeks: Week[] }

  return { host, league, members, cookieOf, weeks }
}

describe('season generation', () => {
  it('previews without writing and commits with the hash', async () => {
    const { host, league } = await draftedLeague(4)

    const preview = await post(host.cookie, `/leagues/${league.id}/season/preview`, {
      seed: 's',
    })
    const body = (await preview.json()) as { hash: string; weeks: { number: number }[] }
    expect(body.weeks).toHaveLength(3)

    const before = await call(`/leagues/${league.id}/schedule`, {
      headers: { cookie: host.cookie },
    })
    expect(((await before.json()) as { season: unknown }).season).toBeNull()

    const commit = await post(host.cookie, `/leagues/${league.id}/season/commit`, {
      seed: 's',
      hash: body.hash,
    })
    expect(commit.status).toBe(201)
    expect((await commit.json()).weeks).toBe(3)
  })

  it('409s a commit whose hash no longer matches', async () => {
    const { host, league } = await draftedLeague(2)

    const res = await post(host.cookie, `/leagues/${league.id}/season/commit`, {
      seed: 's',
      hash: 'not-the-hash',
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PREVIEW_STALE')
  })

  it('refuses a second season', async () => {
    const { host, league } = await seasonLeague(4)
    const preview = await post(host.cookie, `/leagues/${league.id}/season/preview`, { seed: 'x' })
    const { hash } = (await preview.json()) as { hash: string }
    const res = await post(host.cookie, `/leagues/${league.id}/season/commit`, {
      seed: 'x',
      hash,
    })
    expect(res.status).toBe(409)
  })
})

describe('reporting flow', () => {
  it('reports, then the opponent confirms', async () => {
    const { league, cookieOf, weeks } = await seasonLeague(4)
    const match = weeks[0]!.matchups.find((m) => m.awayMemberId !== null)!

    const reported = await post(
      cookieOf.get(match.homeMemberId)!,
      `/leagues/${league.id}/matchups/${match.id}/report`,
      {
        winnerMemberId: match.homeMemberId,
        homeScore: 3,
        awayScore: 0,
        replayUrl: 'https://replay.pokemonshowdown.com/gen9ou-2314159265',
      },
    )
    expect(reported.status).toBe(200)
    const body = (await reported.json()) as { status: string; replayUrl: string }
    expect(body.status).toBe('reported')
    // Normalized to the bare id, so the deferred parser needs no migration.
    expect(body.replayUrl).toBe('gen9ou-2314159265')

    const confirmed = await post(
      cookieOf.get(match.awayMemberId!)!,
      `/leagues/${league.id}/matchups/${match.id}/confirm`,
    )
    expect(confirmed.status).toBe(200)
    expect(((await confirmed.json()) as { status: string }).status).toBe('confirmed')
  })

  it('refuses to let the reporter confirm their own result', async () => {
    const { league, cookieOf, weeks } = await seasonLeague(4)
    const match = weeks[0]!.matchups.find((m) => m.awayMemberId !== null)!
    const cookie = cookieOf.get(match.homeMemberId)!

    await post(cookie, `/leagues/${league.id}/matchups/${match.id}/report`, {
      winnerMemberId: match.homeMemberId,
      homeScore: 3,
      awayScore: 0,
    })
    const res = await post(cookie, `/leagues/${league.id}/matchups/${match.id}/confirm`)
    expect(res.status).toBe(403)
  })

  it('refuses a report from someone not in the match', async () => {
    const { league, cookieOf, weeks } = await seasonLeague(4)
    const match = weeks[0]!.matchups.find((m) => m.awayMemberId !== null)!
    const outsider = [...cookieOf.entries()].find(
      ([id]) => id !== match.homeMemberId && id !== match.awayMemberId,
    )!

    const res = await post(outsider[1], `/leagues/${league.id}/matchups/${match.id}/report`, {
      winnerMemberId: match.homeMemberId,
      homeScore: 3,
      awayScore: 0,
    })
    expect(res.status).toBe(403)
  })

  it('rejects a replay link that is not a replay', async () => {
    const { league, cookieOf, weeks } = await seasonLeague(4)
    const match = weeks[0]!.matchups.find((m) => m.awayMemberId !== null)!

    const res = await post(
      cookieOf.get(match.homeMemberId)!,
      `/leagues/${league.id}/matchups/${match.id}/report`,
      {
        winnerMemberId: match.homeMemberId,
        homeScore: 3,
        awayScore: 0,
        replayUrl: 'https://example.com/x',
      },
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'INVALID_REPLAY_URL',
    )
  })

  it('lets a dispute be settled by the host', async () => {
    const { host, league, cookieOf, weeks } = await seasonLeague(4)
    const match = weeks[0]!.matchups.find((m) => m.awayMemberId !== null)!

    await post(
      cookieOf.get(match.homeMemberId)!,
      `/leagues/${league.id}/matchups/${match.id}/report`,
      {
        winnerMemberId: match.homeMemberId,
        homeScore: 3,
        awayScore: 0,
      },
    )
    const disputed = await post(
      cookieOf.get(match.awayMemberId!)!,
      `/leagues/${league.id}/matchups/${match.id}/dispute`,
    )
    expect(((await disputed.json()) as { status: string }).status).toBe('disputed')

    const resolved = await post(host.cookie, `/leagues/${league.id}/matchups/${match.id}/resolve`, {
      status: 'confirmed',
      winnerMemberId: match.awayMemberId,
      homeScore: 0,
      awayScore: 2,
    })
    expect(resolved.status).toBe(200)
    const body = (await resolved.json()) as { status: string; winnerMemberId: string }
    expect(body.status).toBe('confirmed')
    expect(body.winnerMemberId).toBe(match.awayMemberId!)
  })
})

describe('standings', () => {
  it('counts only confirmed results and orders by wins', async () => {
    const { league, cookieOf, weeks, host } = await seasonLeague(4)
    const match = weeks[0]!.matchups.find((m) => m.awayMemberId !== null)!

    const empty = await call(`/leagues/${league.id}/standings`, {
      headers: { cookie: host.cookie },
    })
    const before = (await empty.json()) as { played: number }[]
    expect(before).toHaveLength(4)
    expect(before.every((r) => r.played === 0)).toBe(true)

    await post(
      cookieOf.get(match.homeMemberId)!,
      `/leagues/${league.id}/matchups/${match.id}/report`,
      {
        winnerMemberId: match.homeMemberId,
        homeScore: 4,
        awayScore: 0,
        stats: [
          {
            memberId: match.homeMemberId,
            speciesId: 'gholdengo',
            kills: 3,
            deaths: 0,
          },
        ],
      },
    )

    const midway = await call(`/leagues/${league.id}/standings`, {
      headers: { cookie: host.cookie },
    })
    // Reported is not confirmed; it must not move the table yet.
    expect(((await midway.json()) as { played: number }[]).every((r) => r.played === 0)).toBe(true)

    await post(
      cookieOf.get(match.awayMemberId!)!,
      `/leagues/${league.id}/matchups/${match.id}/confirm`,
    )

    const after = await call(`/leagues/${league.id}/standings`, {
      headers: { cookie: host.cookie },
    })
    const table = (await after.json()) as {
      memberId: string
      wins: number
      differential: number
      kills: number
    }[]
    expect(table[0]?.memberId).toBe(match.homeMemberId)
    expect(table[0]?.wins).toBe(1)
    expect(table[0]?.differential).toBe(4)
    expect(table[0]?.kills).toBe(3)
  })

  it('serves an empty leaderboard rather than failing when nobody logged stats', async () => {
    const { host, league } = await seasonLeague(4)
    const res = await call(`/leagues/${league.id}/leaderboard?stat=kd`, {
      headers: { cookie: host.cookie },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
