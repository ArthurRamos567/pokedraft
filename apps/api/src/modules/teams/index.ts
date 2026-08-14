import { and, eq, schema } from '@pokedraft/db'
import { getSpeciesForFormat, toCard } from '@pokedraft/dex'
import { ERROR_CODES } from '@pokedraft/shared'
import { Elysia, t } from 'elysia'
import { db } from '../../db'
import { notFound } from '../../errors'
import { authPlugin } from '../../plugins/auth'
import { leaguePlugin, mustMember } from '../../plugins/league'
import { activeList, listEntries } from '../points/service'
import {
  coverageFor,
  hydrateRoster,
  speedTiers,
  spendProfile,
  statProfile,
  threatList,
} from './analytics'
import { exportShowdown } from './export'
import { leagueRosters, rosterFor } from './roster'

const MonSchema = t.Object({
  id: t.String(),
  name: t.String(),
  num: t.Integer(),
  types: t.Array(t.String()),
  abilities: t.Array(t.String()),
  baseStats: t.Object({
    hp: t.Integer(),
    atk: t.Integer(),
    def: t.Integer(),
    spa: t.Integer(),
    spd: t.Integer(),
    spe: t.Integer(),
  }),
  bst: t.Integer(),
  tier: t.Nullable(t.String()),
  baseSpecies: t.Nullable(t.String()),
  forme: t.Nullable(t.String()),
  cost: t.Integer(),
  acquired: t.Union([t.Literal('draft'), t.Literal('trade')]),
  smogonUrl: t.String(),
})

async function membersOf(leagueId: string) {
  return db
    .select({
      id: schema.leagueMembers.id,
      userId: schema.leagueMembers.userId,
      role: schema.leagueMembers.role,
      teamName: schema.leagueMembers.teamName,
      draftPosition: schema.leagueMembers.draftPosition,
      name: schema.user.name,
      displayName: schema.user.displayName,
      profileName: schema.teamProfiles.teamName,
      logoUrl: schema.teamProfiles.logoUrl,
      color: schema.teamProfiles.color,
      motto: schema.teamProfiles.motto,
    })
    .from(schema.leagueMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.leagueMembers.userId))
    .leftJoin(schema.teamProfiles, eq(schema.teamProfiles.memberId, schema.leagueMembers.id))
    .where(
      and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.status, 'active')),
    )
}

async function budgetOf(leagueId: string) {
  const s = await db.query.leagueSettings.findFirst({
    where: eq(schema.leagueSettings.leagueId, leagueId),
  })
  return s?.budget ?? 0
}

async function requireMember(leagueId: string, memberId: string) {
  const member = await db.query.leagueMembers.findFirst({
    where: and(eq(schema.leagueMembers.id, memberId), eq(schema.leagueMembers.leagueId, leagueId)),
  })
  if (!member) throw notFound(ERROR_CODES.NOT_FOUND, 'team not found')
  return member
}

export const teamsModule = new Elysia({ prefix: '/leagues/:id', tags: ['teams'] })
  .use(authPlugin)
  .use(leaguePlugin)

  /** The one call the league-wide view makes: three queries, no N+1. */
  .get(
    '/teams',
    async ({ league }) => {
      const [members, rosters, budget] = await Promise.all([
        membersOf(league.id),
        leagueRosters(db, league.id),
        budgetOf(league.id),
      ])

      return members.map((m) => {
        const roster = rosters.get(m.id) ?? { entries: [], spent: 0 }
        return {
          memberId: m.id,
          userId: m.userId,
          teamName: m.profileName ?? m.teamName ?? m.displayName ?? m.name,
          logoUrl: m.logoUrl,
          color: m.color,
          draftPosition: m.draftPosition,
          spent: roster.spent,
          remaining: budget - roster.spent,
          roster: roster.entries,
        }
      })
    },
    {
      league: 'public',
      params: t.Object({ id: t.String() }),
      response: t.Array(
        t.Object({
          memberId: t.String(),
          userId: t.String(),
          teamName: t.String(),
          logoUrl: t.Nullable(t.String()),
          color: t.Nullable(t.String()),
          draftPosition: t.Nullable(t.Integer()),
          spent: t.Integer(),
          remaining: t.Integer(),
          roster: t.Array(
            t.Object({
              speciesId: t.String(),
              cost: t.Integer(),
              pickNo: t.Nullable(t.Integer()),
              acquired: t.Union([t.Literal('draft'), t.Literal('trade')]),
            }),
          ),
        }),
      ),
    },
  )

  .get(
    '/teams/:memberId',
    async ({ league, params }) => {
      const member = await requireMember(league.id, params.memberId)
      const [roster, budget] = await Promise.all([rosterFor(db, member.id), budgetOf(league.id)])
      const mons = hydrateRoster(roster.entries, league.formatId)

      return {
        memberId: member.id,
        teamName: member.teamName,
        roster: mons,
        spend: spendProfile(mons, budget),
        stats: statProfile(mons),
      }
    },
    {
      league: 'public',
      params: t.Object({ id: t.String(), memberId: t.String({ format: 'uuid' }) }),
      response: t.Object({
        memberId: t.String(),
        teamName: t.Nullable(t.String()),
        roster: t.Array(MonSchema),
        spend: t.Object({
          spent: t.Integer(),
          remaining: t.Integer(),
          budget: t.Integer(),
          brackets: t.Record(t.String(), t.Integer()),
        }),
        stats: t.Object({
          bstAverage: t.Integer(),
          physical: t.Integer(),
          special: t.Integer(),
          mixed: t.Integer(),
          bulkiest: t.Nullable(t.Object({ speciesId: t.String(), name: t.String() })),
          fastest: t.Nullable(t.Object({ speciesId: t.String(), name: t.String() })),
        }),
      }),
    },
  )

  .get(
    '/teams/:memberId/coverage',
    async ({ league, params }) => {
      const member = await requireMember(league.id, params.memberId)
      const rosters = await leagueRosters(db, league.id)
      const mine = hydrateRoster(rosters.get(member.id)?.entries ?? [], league.formatId)

      const theirs = [...rosters.entries()]
        .filter(([id]) => id !== member.id)
        .flatMap(([, r]) => hydrateRoster(r.entries, league.formatId))

      return {
        ...coverageFor(mine, league.formatId),
        threats: threatList(mine, theirs, league.formatId),
      }
    },
    {
      league: 'public',
      params: t.Object({ id: t.String(), memberId: t.String({ format: 'uuid' }) }),
      response: t.Any(),
    },
  )

  .get(
    '/teams/:memberId/speed',
    async ({ league, params }) => {
      const member = await requireMember(league.id, params.memberId)
      const rosters = await leagueRosters(db, league.id)
      const mine = hydrateRoster(rosters.get(member.id)?.entries ?? [], league.formatId)

      // League-wide base speeds are what make a tier list mean anything.
      const all = [...rosters.values()].flatMap((r) =>
        hydrateRoster(r.entries, league.formatId).map((m) => m.baseStats.spe),
      )
      const sorted = [...all].sort((a, b) => a - b)
      const percentile = (base: number) =>
        sorted.length === 0
          ? 0
          : Math.round((sorted.filter((s) => s < base).length / sorted.length) * 100)

      return speedTiers(mine).map((row) => ({ ...row, leaguePercentile: percentile(row.base) }))
    },
    {
      league: 'public',
      params: t.Object({ id: t.String(), memberId: t.String({ format: 'uuid' }) }),
      response: t.Array(
        t.Object({
          speciesId: t.String(),
          name: t.String(),
          base: t.Integer(),
          neutral: t.Integer(),
          positive: t.Integer(),
          negative: t.Integer(),
          scarf: t.Integer(),
          minimum: t.Integer(),
          leaguePercentile: t.Integer(),
        }),
      ),
    },
  )

  /**
   * One speed list for the whole league. Speed only means anything relative to
   * what everyone else drafted, so the comparison belongs at league scope
   * rather than repeated per team.
   */
  .get(
    '/speed',
    async ({ league }) => {
      const [members, rosters] = await Promise.all([
        membersOf(league.id),
        leagueRosters(db, league.id),
      ])
      const nameOf = new Map(
        members.map((m) => [m.id, m.profileName ?? m.teamName ?? m.displayName ?? m.name]),
      )

      const rows = [...rosters.entries()].flatMap(([memberId, roster]) =>
        speedTiers(hydrateRoster(roster.entries, league.formatId)).map((row) => ({
          ...row,
          memberId,
          teamName: nameOf.get(memberId) ?? 'Unknown',
        })),
      )

      return rows.sort((a, b) => b.base - a.base || a.name.localeCompare(b.name))
    },
    {
      league: 'public',
      params: t.Object({ id: t.String() }),
      response: t.Array(
        t.Object({
          speciesId: t.String(),
          name: t.String(),
          base: t.Integer(),
          neutral: t.Integer(),
          positive: t.Integer(),
          negative: t.Integer(),
          scarf: t.Integer(),
          minimum: t.Integer(),
          memberId: t.String(),
          teamName: t.String(),
        }),
      ),
      detail: { summary: 'Every drafted mon in the league, fastest first.' },
    },
  )

  .get(
    '/teams/:memberId/export',
    async ({ league, params, set }) => {
      const member = await requireMember(league.id, params.memberId)
      const roster = await rosterFor(db, member.id)
      set.headers['content-type'] = 'text/plain; charset=utf-8'
      return exportShowdown(roster.entries, league.formatId)
    },
    {
      league: 'public',
      params: t.Object({ id: t.String(), memberId: t.String({ format: 'uuid' }) }),
      query: t.Object({ format: t.Optional(t.Literal('showdown')) }),
      response: t.String(),
      detail: { summary: 'A paste skeleton for the teambuilder — no set recommendations.' },
    },
  )

  .patch(
    '/teams/me',
    async ({ membership, body }) => {
      const member = mustMember(membership)
      const [row] = await db
        .insert(schema.teamProfiles)
        .values({ memberId: member.id, ...body })
        .onConflictDoUpdate({ target: schema.teamProfiles.memberId, set: body })
        .returning()
      return row!
    },
    {
      league: 'member',
      params: t.Object({ id: t.String() }),
      body: t.Object({
        teamName: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
        logoUrl: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        color: t.Optional(t.Nullable(t.String({ maxLength: 16 }))),
        motto: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
      }),
      response: t.Object({
        memberId: t.String(),
        teamName: t.Nullable(t.String()),
        logoUrl: t.Nullable(t.String()),
        color: t.Nullable(t.String()),
        motto: t.Nullable(t.String()),
      }),
    },
  )

  .get(
    '/pool',
    async ({ league, query }) => {
      const list = await activeList(db, league.id)
      if (!list) return []
      const entries = await listEntries(db, list.id)
      const rosters = await leagueRosters(db, league.id)

      const takenBy = new Map<string, string>()
      for (const [memberId, roster] of rosters) {
        for (const e of roster.entries) takenBy.set(e.speciesId, memberId)
      }

      return entries
        .filter((e) => {
          if (query.status === 'undrafted') return !takenBy.has(e.speciesId)
          if (query.status === 'drafted') return takenBy.has(e.speciesId)
          return true
        })
        .map((e) => {
          const s = getSpeciesForFormat(e.speciesId, league.formatId)
          return {
            speciesId: e.speciesId,
            points: e.points,
            banned: e.banned,
            takenBy: takenBy.get(e.speciesId) ?? null,
            species: s ? toCard(s, league.formatId) : null,
          }
        })
    },
    {
      league: 'public',
      params: t.Object({ id: t.String() }),
      query: t.Object({
        status: t.Optional(
          t.Union([t.Literal('undrafted'), t.Literal('drafted'), t.Literal('all')]),
        ),
      }),
      response: t.Array(
        t.Object({
          speciesId: t.String(),
          points: t.Integer(),
          banned: t.Boolean(),
          takenBy: t.Nullable(t.String()),
          species: t.Nullable(t.Any()),
        }),
      ),
    },
  )
