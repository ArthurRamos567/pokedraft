import { and, asc, type Database, desc, eq, schema } from '@pokedraft/db'
import {
  advance,
  type Bracket,
  type BracketMatch,
  generateBracket,
  override,
  resolveSources,
  type SlotSource,
} from '@pokedraft/season'
import { ERROR_CODES } from '@pokedraft/shared'
import { badRequest, conflict, notFound } from '../../errors'
import { getLeagueOr404 } from '../leagues/service'
import { activeSeason, leagueStandings } from '../season/service'
import { recordAudit } from '../system/service'

export type GenerateInput = {
  type?: 'single_elim' | 'double_elim'
  size?: number
  thirdPlace?: boolean
  bracketReset?: boolean
  /** Hosts sometimes cut early on purpose. */
  force?: boolean
}

async function seasonOr404(db: Database, leagueId: string) {
  const season = await activeSeason(db, leagueId)
  if (!season) throw notFound(ERROR_CODES.SEASON_NOT_FOUND, 'generate a season first')
  return season
}

export async function previewPlayoffs(db: Database, leagueId: string, input: GenerateInput) {
  const league = await getLeagueOr404(db, leagueId)
  await seasonOr404(db, leagueId)

  if (league.status !== 'regular_season' && !input.force) {
    throw conflict(
      ERROR_CODES.LEAGUE_INVALID_STATUS,
      `this league is ${league.status}; pass force to cut playoffs anyway`,
    )
  }

  const table = await leagueStandings(db, leagueId)
  const size = input.size ?? 4
  if (table.length < 2) {
    throw badRequest(ERROR_CODES.NOT_ENOUGH_TEAMS, 'a bracket needs at least two teams')
  }

  const seeds = table.slice(0, size).map((r) => r.memberId)
  const bracket = generateBracket({
    type: input.type,
    seeds,
    size,
    thirdPlace: input.thirdPlace,
    bracketReset: input.bracketReset,
  })

  return {
    hash: new Bun.CryptoHasher('sha256')
      .update(JSON.stringify({ seeds, size: bracket.size, type: bracket.type }))
      .digest('hex'),
    bracket,
    standings: table.slice(0, size),
  }
}

export async function commitPlayoffs(
  db: Database,
  leagueId: string,
  actorId: string,
  input: GenerateInput & { hash: string },
) {
  const preview = await previewPlayoffs(db, leagueId, input)
  if (preview.hash !== input.hash) {
    throw conflict(
      ERROR_CODES.PREVIEW_STALE,
      'the standings changed since that preview — generate it again',
    )
  }

  const season = await seasonOr404(db, leagueId)
  const existing = await db.query.brackets.findFirst({
    where: eq(schema.brackets.seasonId, season.id),
  })
  if (existing) throw conflict(ERROR_CODES.BRACKET_EXISTS, 'this season already has a bracket')

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.brackets)
      .values({
        seasonId: season.id,
        type: preview.bracket.type,
        size: preview.bracket.size,
        thirdPlace: preview.bracket.thirdPlace,
        bracketReset: preview.bracket.bracketReset,
        seeds: preview.bracket.seeds,
        status: 'active',
      })
      .returning()
    if (!row) throw new Error('bracket insert returned nothing')

    await tx.insert(schema.bracketMatches).values(
      preview.bracket.matches.map((m) => ({
        bracketId: row.id,
        slot: m.slot,
        round: m.round,
        side: m.side,
        homeSource: m.homeSource as unknown as Record<string, unknown>,
        awaySource: m.awaySource as unknown as Record<string, unknown>,
        homeMemberId: m.homeMemberId,
        awayMemberId: m.awayMemberId,
        winnerMemberId: m.winnerMemberId,
      })),
    )

    await tx
      .update(schema.leagues)
      .set({ status: 'playoffs' })
      .where(eq(schema.leagues.id, leagueId))
    await recordAudit(tx, {
      actorId,
      leagueId,
      action: 'playoffs.generated',
      targetType: 'bracket',
      targetId: row.id,
      meta: { seeds: preview.bracket.seeds, size: preview.bracket.size },
    })

    return { bracket: row, matches: preview.bracket.matches.length }
  })
}

async function loadBracket(db: Database, leagueId: string) {
  const season = await seasonOr404(db, leagueId)
  const row = await db.query.brackets.findFirst({
    where: eq(schema.brackets.seasonId, season.id),
  })
  if (!row) throw notFound(ERROR_CODES.BRACKET_NOT_FOUND, 'this season has no bracket')

  const matchRows = await db
    .select()
    .from(schema.bracketMatches)
    .where(eq(schema.bracketMatches.bracketId, row.id))
    .orderBy(asc(schema.bracketMatches.round), asc(schema.bracketMatches.slot))

  const bracket: Bracket = {
    type: row.type,
    size: row.size,
    thirdPlace: row.thirdPlace,
    bracketReset: row.bracketReset,
    seeds: row.seeds,
    championMemberId: row.championMemberId,
    matches: matchRows.map((m) => ({
      slot: m.slot,
      round: m.round,
      side: m.side,
      homeSource: m.homeSource as unknown as SlotSource,
      awaySource: m.awaySource as unknown as SlotSource,
      homeMemberId: m.homeMemberId,
      awayMemberId: m.awayMemberId,
      winnerMemberId: m.winnerMemberId,
    })),
  }
  return { row, bracket, matchupIds: new Map(matchRows.map((m) => [m.slot, m.matchupId])) }
}

async function persist(db: Database, bracketId: string, leagueId: string, bracket: Bracket) {
  await db.transaction(async (tx) => {
    for (const m of bracket.matches) {
      await tx
        .update(schema.bracketMatches)
        .set({
          homeMemberId: m.homeMemberId,
          awayMemberId: m.awayMemberId,
          winnerMemberId: m.winnerMemberId,
        })
        .where(
          and(
            eq(schema.bracketMatches.bracketId, bracketId),
            eq(schema.bracketMatches.slot, m.slot),
          ),
        )
    }
    await tx
      .update(schema.brackets)
      .set({
        championMemberId: bracket.championMemberId,
        status: bracket.championMemberId ? 'complete' : 'active',
      })
      .where(eq(schema.brackets.id, bracketId))

    if (bracket.championMemberId) {
      await tx
        .update(schema.leagues)
        .set({ status: 'complete' })
        .where(eq(schema.leagues.id, leagueId))
    }
  })
}

/** Render-ready: rounds → matches with members resolved. The client never rebuilds topology. */
export async function getPlayoffs(db: Database, leagueId: string) {
  const { row, bracket, matchupIds } = await loadBracket(db, leagueId)
  const seedOf = new Map(bracket.seeds.map((id, i) => [id, i + 1]))

  const rounds = new Map<number, BracketMatch[]>()
  for (const m of bracket.matches) {
    rounds.set(m.round, [...(rounds.get(m.round) ?? []), m])
  }

  return {
    id: row.id,
    type: bracket.type,
    size: bracket.size,
    status: row.status,
    thirdPlace: bracket.thirdPlace,
    seeds: bracket.seeds.map((memberId, i) => ({ memberId, seed: i + 1 })),
    championMemberId: bracket.championMemberId,
    rounds: [...rounds.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, matches]) => ({
        round,
        matches: matches.map((m) => ({
          slot: m.slot,
          side: m.side,
          matchupId: matchupIds.get(m.slot) ?? null,
          homeSource: m.homeSource,
          awaySource: m.awaySource,
          homeMemberId: m.homeMemberId,
          awayMemberId: m.awayMemberId,
          homeSeed: m.homeMemberId ? (seedOf.get(m.homeMemberId) ?? null) : null,
          awaySeed: m.awayMemberId ? (seedOf.get(m.awayMemberId) ?? null) : null,
          winnerMemberId: m.winnerMemberId,
        })),
      })),
  }
}

/** Called when a bracket match's result lands. Idempotent, like `advance`. */
export async function recordResult(
  db: Database,
  leagueId: string,
  slot: string,
  winnerMemberId: string,
) {
  const { row, bracket } = await loadBracket(db, leagueId)
  const next = advance(bracket, slot, winnerMemberId)
  await persist(db, row.id, leagueId, next)
  return next
}

/**
 * Host correction. Destructive by design: everything downstream was decided by
 * a result that no longer stands, so the dependent subtree is cleared.
 */
export async function overrideResult(
  db: Database,
  leagueId: string,
  actorId: string,
  slot: string,
  winnerMemberId: string | null,
) {
  const { row, bracket } = await loadBracket(db, leagueId)
  const match = bracket.matches.find((m) => m.slot === slot)
  if (!match) throw notFound(ERROR_CODES.BRACKET_MATCH_NOT_READY, `no slot ${slot}`)

  const next = override(bracket, slot, winnerMemberId)
  await persist(db, row.id, leagueId, next)
  await recordAudit(db, {
    actorId,
    leagueId,
    action: 'playoffs.override',
    targetType: 'bracket_match',
    targetId: slot,
    meta: { from: match.winnerMemberId, to: winnerMemberId },
  })
  return next
}

export async function scrapBracket(db: Database, leagueId: string, actorId: string) {
  const { row } = await loadBracket(db, leagueId)
  const played = await db
    .select()
    .from(schema.bracketMatches)
    .where(eq(schema.bracketMatches.bracketId, row.id))
    .orderBy(desc(schema.bracketMatches.round))

  if (played.some((m) => m.winnerMemberId && m.round > 1)) {
    throw conflict(
      ERROR_CODES.LEAGUE_INVALID_STATUS,
      'this bracket is already under way; override a result instead of scrapping it',
    )
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.brackets).where(eq(schema.brackets.id, row.id))
    await tx
      .update(schema.leagues)
      .set({ status: 'regular_season' })
      .where(eq(schema.leagues.id, leagueId))
    await recordAudit(tx, {
      actorId,
      leagueId,
      action: 'playoffs.scrapped',
      targetType: 'bracket',
      targetId: row.id,
    })
  })
}

export { resolveSources }
