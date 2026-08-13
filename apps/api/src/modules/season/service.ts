import { and, asc, type Database, desc, eq, inArray, schema, sql } from '@pokedraft/db'
import {
  generateSchedule,
  parseReplayUrl,
  type ResultRow,
  standings,
  type TiebreakMode,
  weekWindows,
} from '@pokedraft/season'
import { ERROR_CODES } from '@pokedraft/shared'
import { badRequest, conflict, forbidden, notFound } from '../../errors'
import { getLeagueOr404 } from '../leagues/service'
import { assertStatus } from '../leagues/status'
import { notify, recordAudit } from '../system/service'

export async function activeSeason(db: Database, leagueId: string) {
  return db.query.seasons.findFirst({
    where: eq(schema.seasons.leagueId, leagueId),
    orderBy: [desc(schema.seasons.number)],
  })
}

async function activeMembers(db: Database, leagueId: string) {
  return db
    .select({ id: schema.leagueMembers.id })
    .from(schema.leagueMembers)
    .where(
      and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.status, 'active')),
    )
    .orderBy(asc(schema.leagueMembers.draftPosition), asc(schema.leagueMembers.joinedAt))
}

export type GenerateInput = {
  weeks?: number
  doubleRoundRobin?: boolean
  startAt?: string
  weekLengthDays?: number
  seed?: string
}

/**
 * Covers the pairings, not the clock. Hashing the generated week windows would
 * fold in `new Date()` and no preview could ever match its own commit.
 */
function hashSchedule(
  input: GenerateInput,
  weeks: { number: number; matchups: { home: string; away: string | null }[] }[],
) {
  const canonical = weeks.map((w) => ({
    number: w.number,
    matchups: w.matchups.map((m) => `${m.home}>${m.away ?? 'bye'}`),
  }))
  return new Bun.CryptoHasher('sha256')
    .update(
      JSON.stringify({
        weeks: canonical,
        doubleRoundRobin: input.doubleRoundRobin ?? false,
        weekCount: input.weeks ?? null,
      }),
    )
    .digest('hex')
}

/** Preview writes nothing; commit carries the preview's hash. Same as points. */
export async function previewSeason(db: Database, leagueId: string, input: GenerateInput) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['regular_season', 'drafting'])

  const members = await activeMembers(db, leagueId)
  const schedule = generateSchedule({
    members: members.map((m) => m.id),
    weeks: input.weeks,
    doubleRoundRobin: input.doubleRoundRobin,
    seed: input.seed,
  })
  if (schedule.weeks.length === 0) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, schedule.warnings[0] ?? 'cannot build a season')
  }

  const startAt = input.startAt ? new Date(input.startAt) : new Date()
  const windows = weekWindows(startAt, schedule.weeks.length, input.weekLengthDays ?? 7)

  const weeks = schedule.weeks.map((w, i) => ({
    number: w.number,
    opensAt: windows[i]!.opensAt,
    closesAt: windows[i]!.closesAt,
    matchups: w.matchups,
  }))

  return { hash: hashSchedule(input, weeks), warnings: schedule.warnings, weeks }
}

export async function commitSeason(
  db: Database,
  leagueId: string,
  actorId: string,
  input: GenerateInput & { hash: string },
) {
  const preview = await previewSeason(db, leagueId, input)
  if (preview.hash !== input.hash) {
    throw conflict(
      ERROR_CODES.PREVIEW_STALE,
      'the league changed since that preview — generate it again',
    )
  }

  const existing = await activeSeason(db, leagueId)
  if (existing) {
    throw conflict(ERROR_CODES.SEASON_EXISTS, 'this league already has a season')
  }

  return db.transaction(async (tx) => {
    const [season] = await tx
      .insert(schema.seasons)
      .values({ leagueId, number: 1, status: 'active' })
      .returning()
    if (!season) throw new Error('season insert returned nothing')

    for (const w of preview.weeks) {
      const [week] = await tx
        .insert(schema.weeks)
        .values({
          seasonId: season.id,
          number: w.number,
          opensAt: w.opensAt,
          closesAt: w.closesAt,
          status: w.number === 1 ? 'open' : 'upcoming',
        })
        .returning()
      if (!week) throw new Error('week insert returned nothing')

      if (w.matchups.length > 0) {
        await tx.insert(schema.matchups).values(
          w.matchups.map((m) => ({
            weekId: week.id,
            homeMemberId: m.home,
            awayMemberId: m.away,
          })),
        )
      }
    }

    if ((await getLeagueOr404(tx, leagueId)).status === 'drafting') {
      await tx
        .update(schema.leagues)
        .set({ status: 'regular_season' })
        .where(eq(schema.leagues.id, leagueId))
    }

    await recordAudit(tx, {
      actorId,
      leagueId,
      action: 'season.generated',
      targetType: 'season',
      targetId: season.id,
      meta: { weeks: preview.weeks.length },
    })

    return { season, weeks: preview.weeks.length }
  })
}

export async function getSchedule(db: Database, leagueId: string, weekNumber?: number) {
  const season = await activeSeason(db, leagueId)
  if (!season) return { season: null, weeks: [] }

  const weekRows = await db
    .select()
    .from(schema.weeks)
    .where(
      weekNumber
        ? and(eq(schema.weeks.seasonId, season.id), eq(schema.weeks.number, weekNumber))
        : eq(schema.weeks.seasonId, season.id),
    )
    .orderBy(asc(schema.weeks.number))

  const ids = weekRows.map((w) => w.id)
  const matchupRows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(schema.matchups)
          .where(inArray(schema.matchups.weekId, ids))
          .orderBy(asc(schema.matchups.createdAt))

  return {
    season: { id: season.id, number: season.number, status: season.status },
    weeks: weekRows.map((w) => ({
      id: w.id,
      number: w.number,
      opensAt: w.opensAt,
      closesAt: w.closesAt,
      status: w.status,
      matchups: matchupRows.filter((m) => m.weekId === w.id),
    })),
  }
}

export async function getMatchupOr404(db: Database, leagueId: string, matchupId: string) {
  const [row] = await db
    .select({
      matchup: schema.matchups,
      weekNumber: schema.weeks.number,
      seasonId: schema.seasons.id,
      leagueId: schema.seasons.leagueId,
    })
    .from(schema.matchups)
    .innerJoin(schema.weeks, eq(schema.weeks.id, schema.matchups.weekId))
    .innerJoin(schema.seasons, eq(schema.seasons.id, schema.weeks.seasonId))
    .where(eq(schema.matchups.id, matchupId))

  if (!row || row.leagueId !== leagueId) {
    throw notFound(ERROR_CODES.MATCHUP_NOT_FOUND, 'matchup not found')
  }
  return row
}

function assertParticipant(matchup: typeof schema.matchups.$inferSelect, memberId: string) {
  if (matchup.homeMemberId !== memberId && matchup.awayMemberId !== memberId) {
    throw forbidden('you are not in this match')
  }
}

export type ReportInput = {
  winnerMemberId: string | null
  homeScore: number
  awayScore: number
  replayUrl?: string
  note?: string
  /** Optional manual per-mon K/D; leaderboards degrade to "no data" without it. */
  stats?: {
    memberId: string
    speciesId: string
    kills: number
    deaths: number
    brought?: boolean
  }[]
}

export async function reportResult(
  db: Database,
  leagueId: string,
  memberId: string,
  matchupId: string,
  input: ReportInput,
) {
  const { matchup } = await getMatchupOr404(db, leagueId, matchupId)
  assertParticipant(matchup, memberId)
  if (matchup.status === 'void' || matchup.status === 'forfeited') {
    throw conflict(ERROR_CODES.LEAGUE_INVALID_STATUS, `this match is ${matchup.status}`)
  }
  if (matchup.status === 'confirmed') {
    throw conflict(ERROR_CODES.REPORT_EXISTS, 'this result is already confirmed')
  }

  let replayId: string | null = null
  if (input.replayUrl) {
    const ref = parseReplayUrl(input.replayUrl)
    if (!ref) {
      throw badRequest(
        ERROR_CODES.INVALID_REPLAY_URL,
        'that does not look like a Showdown replay link',
      )
    }
    replayId = ref.id
  }

  return db.transaction(async (tx) => {
    await tx.insert(schema.matchReports).values({
      matchupId,
      reportedBy: memberId,
      winnerMemberId: input.winnerMemberId,
      homeScore: input.homeScore,
      awayScore: input.awayScore,
      replayUrl: replayId,
      note: input.note ?? null,
    })

    const [updated] = await tx
      .update(schema.matchups)
      .set({
        status: 'reported',
        winnerMemberId: input.winnerMemberId,
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        replayUrl: replayId,
        reportedAt: new Date(),
      })
      .where(eq(schema.matchups.id, matchupId))
      .returning()

    if (input.stats?.length) {
      await tx.delete(schema.matchStats).where(eq(schema.matchStats.matchupId, matchupId))
      await tx.insert(schema.matchStats).values(
        input.stats.map((s) => ({
          matchupId,
          memberId: s.memberId,
          speciesId: s.speciesId,
          kills: s.kills,
          deaths: s.deaths,
          brought: s.brought ?? true,
        })),
      )
    }

    const opponent = matchup.homeMemberId === memberId ? matchup.awayMemberId : matchup.homeMemberId
    if (opponent) {
      const opp = await tx.query.leagueMembers.findFirst({
        where: eq(schema.leagueMembers.id, opponent),
      })
      if (opp) {
        await notify(tx, {
          userId: opp.userId,
          leagueId,
          type: 'match.reported',
          title: 'A result was reported',
          body: 'Confirm it or dispute it.',
          link: `/leagues/${leagueId}/schedule`,
        })
      }
    }

    return updated!
  })
}

export async function respondToReport(
  db: Database,
  leagueId: string,
  memberId: string,
  matchupId: string,
  action: 'confirm' | 'dispute',
) {
  const { matchup } = await getMatchupOr404(db, leagueId, matchupId)
  assertParticipant(matchup, memberId)
  if (matchup.status !== 'reported') {
    throw conflict(ERROR_CODES.LEAGUE_INVALID_STATUS, 'there is no report awaiting a response')
  }

  // The reporter cannot rubber-stamp their own claim.
  const [last] = await db
    .select()
    .from(schema.matchReports)
    .where(eq(schema.matchReports.matchupId, matchupId))
    .orderBy(desc(schema.matchReports.createdAt))
    .limit(1)
  if (last?.reportedBy === memberId) {
    throw forbidden('the other player confirms the result, not the one who reported it')
  }

  const [updated] = await db
    .update(schema.matchups)
    .set({
      status: action === 'confirm' ? 'confirmed' : 'disputed',
      ...(action === 'confirm' ? { confirmedAt: new Date() } : {}),
    })
    .where(eq(schema.matchups.id, matchupId))
    .returning()
  return updated!
}

export type ResolveInput = {
  status: 'confirmed' | 'forfeited' | 'void'
  winnerMemberId?: string | null
  homeScore?: number
  awayScore?: number
}

/** Host override. Always audited — a forced result is exactly what gets argued about later. */
export async function resolveMatchup(
  db: Database,
  leagueId: string,
  actorId: string,
  matchupId: string,
  input: ResolveInput,
) {
  const { matchup } = await getMatchupOr404(db, leagueId, matchupId)

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.matchups)
      .set({
        status: input.status,
        winnerMemberId: input.winnerMemberId ?? matchup.winnerMemberId,
        homeScore: input.homeScore ?? matchup.homeScore,
        awayScore: input.awayScore ?? matchup.awayScore,
        confirmedAt: new Date(),
      })
      .where(eq(schema.matchups.id, matchupId))
      .returning()

    await recordAudit(tx, {
      actorId,
      leagueId,
      action: 'matchup.resolved',
      targetType: 'matchup',
      targetId: matchupId,
      meta: { from: matchup.status, to: input.status, input },
    })
    return updated!
  })
}

export async function rescheduleMatchup(
  db: Database,
  leagueId: string,
  actorId: string,
  matchupId: string,
  patch: { scheduledAt?: string | null; weekId?: string },
) {
  await getMatchupOr404(db, leagueId, matchupId)
  const [updated] = await db
    .update(schema.matchups)
    .set({
      ...(patch.scheduledAt !== undefined
        ? { scheduledAt: patch.scheduledAt ? new Date(patch.scheduledAt) : null }
        : {}),
      ...(patch.weekId ? { weekId: patch.weekId } : {}),
    })
    .where(eq(schema.matchups.id, matchupId))
    .returning()

  await recordAudit(db, {
    actorId,
    leagueId,
    action: 'matchup.rescheduled',
    targetType: 'matchup',
    targetId: matchupId,
    meta: patch,
  })
  return updated!
}

export async function leagueStandings(
  db: Database,
  leagueId: string,
  tiebreak: TiebreakMode = 'differential_first',
) {
  const season = await activeSeason(db, leagueId)
  const members = await activeMembers(db, leagueId)
  if (!season) {
    return standings(
      members.map((m) => m.id),
      [],
      { tiebreak },
    )
  }

  const rows = await db
    .select({
      homeId: schema.matchups.homeMemberId,
      awayId: schema.matchups.awayMemberId,
      winnerId: schema.matchups.winnerMemberId,
      homeScore: schema.matchups.homeScore,
      awayScore: schema.matchups.awayScore,
      status: schema.matchups.status,
    })
    .from(schema.matchups)
    .innerJoin(schema.weeks, eq(schema.weeks.id, schema.matchups.weekId))
    .where(eq(schema.weeks.seasonId, season.id))

  const killRows = await db
    .select({
      memberId: schema.matchStats.memberId,
      kills: sql<number>`sum(${schema.matchStats.kills})::int`,
    })
    .from(schema.matchStats)
    .innerJoin(schema.matchups, eq(schema.matchups.id, schema.matchStats.matchupId))
    .innerJoin(schema.weeks, eq(schema.weeks.id, schema.matchups.weekId))
    .where(eq(schema.weeks.seasonId, season.id))
    .groupBy(schema.matchStats.memberId)

  const kills = Object.fromEntries(killRows.map((k) => [k.memberId, k.kills]))
  return standings(
    members.map((m) => m.id),
    rows as ResultRow[],
    { kills, tiebreak },
  )
}

/** Per-mon leaderboard. Empty rather than broken when nobody entered stats. */
export async function leaderboard(db: Database, leagueId: string, stat: 'kills' | 'kd' | 'usage') {
  const season = await activeSeason(db, leagueId)
  if (!season) return []

  const rows = await db
    .select({
      speciesId: schema.matchStats.speciesId,
      memberId: schema.matchStats.memberId,
      kills: sql<number>`sum(${schema.matchStats.kills})::int`,
      deaths: sql<number>`sum(${schema.matchStats.deaths})::int`,
      games: sql<number>`count(*)::int`,
    })
    .from(schema.matchStats)
    .innerJoin(schema.matchups, eq(schema.matchups.id, schema.matchStats.matchupId))
    .innerJoin(schema.weeks, eq(schema.weeks.id, schema.matchups.weekId))
    .where(eq(schema.weeks.seasonId, season.id))
    .groupBy(schema.matchStats.speciesId, schema.matchStats.memberId)

  const scored = rows.map((r) => ({
    ...r,
    // Deaths of zero would divide by zero; the usual convention is to treat it
    // as one so a flawless mon still ranks rather than becoming Infinity.
    kd: r.kills / Math.max(r.deaths, 1),
  }))

  const key = stat === 'kills' ? 'kills' : stat === 'kd' ? 'kd' : 'games'
  return scored.sort((a, b) => (b[key] as number) - (a[key] as number)).slice(0, 100)
}

/**
 * Leagues stall on unresponsive opponents far more than on disagreements, so
 * silence becomes agreement after a configured age.
 */
export async function autoConfirmStale(db: Database, olderThanHours = 48) {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000)
  const updated = await db
    .update(schema.matchups)
    .set({ status: 'confirmed', confirmedAt: new Date() })
    .where(
      and(eq(schema.matchups.status, 'reported'), sql`${schema.matchups.reportedAt} < ${cutoff}`),
    )
    .returning({ id: schema.matchups.id })
  return updated.length
}
