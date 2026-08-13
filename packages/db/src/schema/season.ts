import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id, tsOpts } from './columns'
import { leagueMembers, leagues } from './leagues'

export const seasonStatus = pgEnum('season_status', ['scheduled', 'active', 'complete'])
export const weekStatus = pgEnum('week_status', ['upcoming', 'open', 'closed'])
export const matchupStatus = pgEnum('matchup_status', [
  'scheduled',
  'reported',
  'confirmed',
  'disputed',
  'forfeited',
  'void',
])

export const seasons = pgTable(
  'seasons',
  {
    id: id(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    number: integer().notNull().default(1),
    status: seasonStatus().notNull().default('scheduled'),
    createdAt: createdAt(),
  },
  (t) => [unique('seasons_number_unique').on(t.leagueId, t.number)],
)

export const weeks = pgTable(
  'weeks',
  {
    id: id(),
    seasonId: uuid()
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    opensAt: timestamp(tsOpts),
    closesAt: timestamp(tsOpts),
    status: weekStatus().notNull().default('upcoming'),
  },
  (t) => [unique('weeks_number_unique').on(t.seasonId, t.number)],
)

export const matchups = pgTable(
  'matchups',
  {
    id: id(),
    weekId: uuid()
      .notNull()
      .references(() => weeks.id, { onDelete: 'cascade' }),
    homeMemberId: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    /** Null is a bye. */
    awayMemberId: uuid().references(() => leagueMembers.id, { onDelete: 'cascade' }),
    status: matchupStatus().notNull().default('scheduled'),
    winnerMemberId: uuid().references(() => leagueMembers.id, { onDelete: 'set null' }),
    /** Mons remaining — the same convention a replay parser would compute. */
    homeScore: integer().notNull().default(0),
    awayScore: integer().notNull().default(0),
    /** Stored as the bare showdown replay id, not the pasted URL. */
    replayUrl: text(),
    scheduledAt: timestamp(tsOpts),
    reportedAt: timestamp(tsOpts),
    confirmedAt: timestamp(tsOpts),
    createdAt: createdAt(),
  },
  (t) => [
    unique('matchups_home_unique').on(t.weekId, t.homeMemberId),
    index('matchups_week_idx').on(t.weekId),
    index('matchups_member_idx').on(t.homeMemberId, t.awayMemberId),
  ],
)

/** Who claimed what. Kept even after a host override, as the paper trail. */
export const matchReports = pgTable('match_reports', {
  id: id(),
  matchupId: uuid()
    .notNull()
    .references(() => matchups.id, { onDelete: 'cascade' }),
  reportedBy: uuid()
    .notNull()
    .references(() => leagueMembers.id, { onDelete: 'cascade' }),
  winnerMemberId: uuid().references(() => leagueMembers.id, { onDelete: 'set null' }),
  homeScore: integer().notNull().default(0),
  awayScore: integer().notNull().default(0),
  replayUrl: text(),
  note: text(),
  createdAt: createdAt(),
})

/**
 * Populated by optional manual entry in v1. The deferred replay parser will
 * later write exactly these rows, which is why the table exists now.
 */
export const matchStats = pgTable(
  'match_stats',
  {
    id: id(),
    matchupId: uuid()
      .notNull()
      .references(() => matchups.id, { onDelete: 'cascade' }),
    memberId: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    speciesId: text().notNull(),
    brought: boolean().notNull().default(true),
    kills: integer().notNull().default(0),
    deaths: integer().notNull().default(0),
  },
  (t) => [
    unique('match_stats_unique').on(t.matchupId, t.memberId, t.speciesId),
    index('match_stats_member_idx').on(t.memberId),
  ],
)

/** Unused in v1; here so the deferred parser needs no migration. */
export const replayCache = pgTable('replay_cache', {
  replayId: text().primaryKey(),
  fetchedAt: timestamp(tsOpts).notNull().defaultNow(),
  rawLog: text(),
  parsed: jsonb().$type<Record<string, unknown>>(),
})
