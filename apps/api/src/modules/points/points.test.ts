import { describe, expect, it } from 'bun:test'
import { call, signUp } from '../../test/client'
import { createLeague } from '../../test/fixtures'

const YML = `
Landorus-Therian: 20
Gholdengo: 19
Toxapex: 17
Corviknight: 16
`

type Preview = {
  hash: string
  nextVersion: number
  summary: { ok: number; illegal: number; unknown: number; duplicates: number }
  diff: {
    added: unknown[]
    removed: unknown[]
    repriced: { speciesId: string; from: number; to: number }[]
  }
}

async function preview(cookie: string, leagueId: string, source: string, allowIllegal = false) {
  const res = await call(`/leagues/${leagueId}/points/preview`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ source, allowIllegal }),
  })
  return { status: res.status, body: (await res.json()) as Preview }
}

async function commit(
  cookie: string,
  leagueId: string,
  source: string,
  hash: string,
  allowIllegal = false,
) {
  const res = await call(`/leagues/${leagueId}/points/commit`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ source, hash, allowIllegal }),
  })
  return { status: res.status, body: (await res.json()) as { version: number; entryCount: number } }
}

describe('points import', () => {
  it('previews without writing anything', async () => {
    const host = await signUp()
    const league = await createLeague(host)

    const { body } = await preview(host.cookie, league.id, YML)
    expect(body.summary.ok).toBe(4)
    expect(body.diff.added).toHaveLength(4)
    expect(body.nextVersion).toBe(1)

    const after = await call(`/leagues/${league.id}/points`, {
      headers: { cookie: host.cookie },
    })
    const list = (await after.json()) as { list: unknown | null }
    expect(list.list).toBeNull()
  })

  it('commits with the preview hash and joins dex data on read', async () => {
    const host = await signUp()
    const league = await createLeague(host)

    const { body: p } = await preview(host.cookie, league.id, YML)
    const { status, body } = await commit(host.cookie, league.id, YML, p.hash)
    expect(status).toBe(201)
    expect(body.version).toBe(1)
    expect(body.entryCount).toBe(4)

    const res = await call(`/leagues/${league.id}/points`, { headers: { cookie: host.cookie } })
    const read = (await res.json()) as {
      entries: { speciesId: string; points: number; species: { name: string } | null }[]
    }
    const lando = read.entries.find((e) => e.speciesId === 'landorustherian')
    expect(lando?.points).toBe(20)
    expect(lando?.species?.name).toBe('Landorus-Therian')
  })

  it('409s a commit carrying a stale hash', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    const { body: p } = await preview(host.cookie, league.id, YML)

    const { status, body } = await commit(host.cookie, league.id, `${YML}\nWeavile: 15\n`, p.hash)
    expect(status).toBe(409)
    expect((body as unknown as { error: { code: string } }).error.code).toBe('PREVIEW_STALE')
  })

  it('increments the version and leaves the previous list untouched', async () => {
    const host = await signUp()
    const league = await createLeague(host)

    const first = await preview(host.cookie, league.id, YML)
    await commit(host.cookie, league.id, YML, first.body.hash)

    const changed = YML.replace('Landorus-Therian: 20', 'Landorus-Therian: 22')
    const second = await preview(host.cookie, league.id, changed)
    expect(second.body.nextVersion).toBe(2)
    expect(second.body.diff.repriced).toEqual([{ speciesId: 'landorustherian', from: 20, to: 22 }])
    await commit(host.cookie, league.id, changed, second.body.hash)

    const res = await call(`/leagues/${league.id}/points/versions`, {
      headers: { cookie: host.cookie },
    })
    const versions = (await res.json()) as { version: number; entryCount: number }[]
    expect(versions.map((v) => v.version)).toEqual([2, 1])
    expect(versions.every((v) => v.entryCount === 4)).toBe(true)
  })

  it('drops illegal rows unless the host opts in, and says so either way', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    const withUber = `${YML}\nFlutter Mane: 25\n`

    const strict = await preview(host.cookie, league.id, withUber)
    expect(strict.body.summary.illegal).toBe(1)
    const strictCommit = await commit(host.cookie, league.id, withUber, strict.body.hash)
    expect(strictCommit.body.entryCount).toBe(4)

    const loose = await preview(host.cookie, league.id, withUber, true)
    const looseCommit = await commit(host.cookie, league.id, withUber, loose.body.hash, true)
    expect(looseCommit.body.entryCount).toBe(5)
  })

  it('keeps unknown rows visible instead of silently dropping them', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    const { body } = await preview(host.cookie, league.id, `${YML}\nMewtoo: 12\n`)
    expect(body.summary.unknown).toBe(1)
  })

  it('creates a new version for a single-entry edit', async () => {
    const host = await signUp()
    const league = await createLeague(host)
    const { body: p } = await preview(host.cookie, league.id, YML)
    await commit(host.cookie, league.id, YML, p.hash)

    const res = await call(`/leagues/${league.id}/points/entries/toxapex`, {
      method: 'PATCH',
      headers: { cookie: host.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ points: 21 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { version: number }
    expect(body.version).toBe(2)

    const read = await call(`/leagues/${league.id}/points`, { headers: { cookie: host.cookie } })
    const { entries } = (await read.json()) as { entries: { speciesId: string; points: number }[] }
    expect(entries.find((e) => e.speciesId === 'toxapex')?.points).toBe(21)
  })

  it('refuses a non-host importing points', async () => {
    const host = await signUp()
    const stranger = await signUp()
    const league = await createLeague(host)
    const { status } = await preview(stranger.cookie, league.id, YML)
    expect(status).toBe(404)
  })
})

/**
 * The MVP's real 400-mon list. If a rename or a tier shift breaks resolution,
 * this is where it shows up — a points list with unknown rows is how a draft
 * breaks at 2am.
 */
describe('pool.json regression corpus', () => {
  it('imports the MVP pool with no unresolved names', async () => {
    const pool = (await Bun.file(
      `${import.meta.dir}/../../../../../DraftMVP/data/pool.json`,
    ).json()) as { name: string; cost: number }[]

    const yml = pool.map((p) => `${JSON.stringify(p.name)}: ${p.cost}`).join('\n')

    const host = await signUp()
    const league = await createLeague(host, { formatId: 'gen9nationaldex' })
    const { body } = await preview(host.cookie, league.id, yml)

    const unknown = body.summary.unknown
    expect(pool.length).toBeGreaterThan(300)
    expect(unknown).toBe(0)
  })
})
