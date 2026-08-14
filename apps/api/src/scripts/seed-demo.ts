/**
 * Dev-only seed. Drops every public league, then builds one that is halfway
 * through a live draft so the UI has real data to render.
 *
 *   bun run seed
 *
 * Everything goes through the same services the routes call, so the draft it
 * leaves behind is a real event-sourced draft, not hand-written rows.
 */
import { readFile } from 'node:fs/promises'
import { eq, schema } from '@pokedraft/db'
import { availableSpecies, canPick, type DraftState } from '@pokedraft/draft'
import { auth } from '../auth'
import { db, sql } from '../db'
import { pick, startLeagueDraft } from '../modules/draft/service'
import { createLeague, joinPublicLeague, setDraftOrder } from '../modules/leagues/service'
import { commitImport, previewImport } from '../modules/points/service'

const PASSWORD = 'demo-password-1'
/**
 * The demo is a Sun/Moon OU league: Megas, Tapus, Ash-Greninja, Z-moves. The
 * pool file is a National Dex list, so the import drops the 65 entries that
 * SM cannot field — 60 Galar-era species, Meltan and Melmetal, and the three
 * SM banned to Ubers (Aegislash, Blaziken, Deoxys-Defense). 648 remain, and
 * every tier the UI shows is read off the SM ladder rather than a later one.
 */
const FORMAT = 'gen7ou'
const TEAMS = [
  { handle: 'demo', name: 'Arthur', team: 'Volt Absol' },
  { handle: 'demo2', name: 'Mika', team: 'Sableye Syndicate' },
  { handle: 'demo3', name: 'Rui', team: 'Tera Blast Radio' },
  { handle: 'demo4', name: 'Nadia', team: 'Sandstorm Social' },
  { handle: 'demo5', name: 'Ives', team: 'Regenerator Core' },
  { handle: 'demo6', name: 'Bea', team: 'Choice Locked' },
  { handle: 'demo7', name: 'Tomas', team: 'Hazard Pay' },
  { handle: 'demo8', name: 'Yuki', team: 'Sleep Talkers' },
]
/** Enough picks that rosters, the board and the pool all look lived-in. */
const TARGET_PICKS = 34

/** Deterministic PRNG so a re-seed produces a comparable board. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

async function ensureUser(handle: string, name: string): Promise<string> {
  const email = `${handle}@pokedraft.test`
  const existing = await db.query.user.findFirst({ where: eq(schema.user.email, email) })
  if (existing) return existing.id
  const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } })
  return res.user.id
}

async function poolYml(): Promise<string> {
  const raw = await readFile(
    new URL('../../../../DraftMVP/data/pool.json', import.meta.url),
    'utf8',
  )
  const mons = JSON.parse(raw) as { name: string; cost: number }[]
  return mons.map((m) => `"${m.name.replace(/"/g, '')}": ${m.cost}`).join('\n')
}

async function main() {
  const cleared = await sql`delete from leagues where visibility = 'public' returning id`
  console.log(`cleared ${cleared.length} public league(s)`)

  const userIds: string[] = []
  for (const t of TEAMS) userIds.push(await ensureUser(t.handle, t.name))
  console.log(`${userIds.length} demo users ready (password: ${PASSWORD})`)

  const league = await createLeague(db, userIds[0]!, {
    name: 'Genesis Cup',
    description: 'Eight teams, Sun/Moon OU, snake draft. Seeded demo league.',
    visibility: 'public',
    formatId: FORMAT,
    teamName: TEAMS[0]!.team,
    settings: {
      draftMode: 'live',
      draftType: 'snake',
      pickSeconds: 600,
      budget: 100,
      rosterMin: 6,
      rosterMax: 10,
      maxMembers: TEAMS.length,
      tradesEnabled: true,
    },
  })
  for (const [i, userId] of userIds.slice(1).entries()) {
    await joinPublicLeague(db, league.id, userId, TEAMS[i + 1]!.team)
  }
  console.log(`league ${league.slug} created with ${TEAMS.length} members`)

  const source = await poolYml()
  const preview = await previewImport(db, league.id, source)
  await commitImport(db, league.id, userIds[0]!, {
    source,
    hash: preview.hash,
    name: 'Genesis Cup pool',
  })
  console.log(
    `points: ${preview.summary.ok} ok, ${preview.summary.illegal} illegal (dropped), ` +
      `${preview.summary.unknown} unknown`,
  )

  // Join order is the draft order — reproducible, unlike a random draw.
  const members = await db
    .select({ id: schema.leagueMembers.id, userId: schema.leagueMembers.userId })
    .from(schema.leagueMembers)
    .where(eq(schema.leagueMembers.leagueId, league.id))
  const byUser = new Map(members.map((m) => [m.userId, m.id]))
  const order = userIds.map((u) => byUser.get(u)!)
  await setDraftOrder(db, league.id, { mode: 'manual', order }, userIds[0]!)

  const started = await startLeagueDraft(db, league.id, userIds[0]!)
  const hostMemberId = order[0]!
  const actorOf = new Map(members.map((m) => [m.id, m.userId]))

  const rand = rng(20260814)
  let state: DraftState = started.state
  let made = 0
  while (state.status === 'active' && state.onClock) {
    // Stop on the host's turn so the room opens with "your pick".
    if (made >= TARGET_PICKS && state.onClock === hostMemberId) break

    const onClock = state.onClock
    const candidates = availableSpecies(state).filter(
      (s) => canPick(state, onClock, s.speciesId).ok,
    )
    if (candidates.length === 0) break
    // Bias to the top of the board without making all eight teams identical.
    const choice = candidates[Math.floor(rand() ** 2 * Math.min(12, candidates.length))]!

    const result = await pick(db, league.id, actorOf.get(onClock)!, {
      memberId: onClock,
      speciesId: choice.speciesId,
    })
    if (!result) break
    state = result.state
    made++
  }
  console.log(`draft: ${made} picks made, round ${state.round}, on clock ${state.onClock}`)

  // A few queued mons so the draft room's queue pane isn't empty.
  const queue = availableSpecies(state)
    .filter((s) => state.config.points[s.speciesId]!.points <= 12)
    .slice(0, 5)
  if (queue.length > 0) {
    await db
      .insert(schema.draftQueues)
      .values(queue.map((s, i) => ({ memberId: hostMemberId, speciesId: s.speciesId, rank: i })))
  }

  console.log(`\nready → http://localhost:5173/leagues/${league.slug}`)
  console.log(`log in as demo@pokedraft.test / ${PASSWORD}`)
  await sql.end()
}

await main()
