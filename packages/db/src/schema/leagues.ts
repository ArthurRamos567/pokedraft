import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { id, timestamps, tsOpts } from './columns'

export const leagueVisibility = pgEnum('league_visibility', ['public', 'private'])
export const leagueStatus = pgEnum('league_status', [
  'setup',
  'drafting',
  'regular_season',
  'playoffs',
  'complete',
  'archived',
])
export const memberRole = pgEnum('member_role', ['host', 'cohost', 'player', 'spectator'])
export const memberStatus = pgEnum('member_status', ['active', 'removed'])
export const draftMode = pgEnum('draft_mode', ['live', 'async'])
export const draftType = pgEnum('draft_type', ['snake', 'linear'])
export const autopickPolicy = pgEnum('autopick_policy', [
  'skip',
  'queue_then_skip',
  'queue_then_best',
])

export const leagues = pgTable(
  'leagues',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    visibility: leagueVisibility().notNull().default('private'),
    status: leagueStatus().notNull().default('setup'),
    /** A dex format id, validated against @pkmn at write time. */
    formatId: text().notNull(),
    hostId: text()
      .notNull()
      .references(() => user.id),
    bannerUrl: text(),
    logoUrl: text(),
    ...timestamps,
  },
  (t) => [
    index('leagues_visibility_idx').on(t.visibility, t.status, t.createdAt),
    index('leagues_host_idx').on(t.hostId),
  ],
)

/** 1:1 with `leagues`, split off so rules can grow without touching the core row. */
export const leagueSettings = pgTable('league_settings', {
  leagueId: uuid()
    .primaryKey()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  draftMode: draftMode().notNull().default('live'),
  draftType: draftType().notNull().default('snake'),
  pickSeconds: integer().notNull().default(90),
  turnHours: integer().notNull().default(24),
  budget: integer().notNull().default(100),
  rosterMin: integer().notNull().default(6),
  rosterMax: integer().notNull().default(10),
  /** May a team finish the draft short of `rosterMax`. */
  allowUndrafted: boolean().notNull().default(false),
  maxMembers: integer().notNull().default(8),
  tradesEnabled: boolean().notNull().default(true),
  tradesRequireHostApproval: boolean().notNull().default(false),
  tradeDeadlineWeek: integer(),
  autopickPolicy: autopickPolicy().notNull().default('queue_then_skip'),
  ...timestamps,
})

export const leagueMembers = pgTable(
  'league_members',
  {
    id: id(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: memberRole().notNull().default('player'),
    teamName: text(),
    teamLogoUrl: text(),
    /** 1-based, set when the order is drawn. */
    draftPosition: integer(),
    status: memberStatus().notNull().default('active'),
    joinedAt: timestamp(tsOpts).notNull().defaultNow(),
  },
  (t) => [
    unique('league_members_unique').on(t.leagueId, t.userId),
    index('league_members_league_idx').on(t.leagueId, t.status),
    index('league_members_user_idx').on(t.userId),
  ],
)

export const leagueInvites = pgTable(
  'league_invites',
  {
    id: id(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    /** Short base32, its own column so the primary key stays a uuid. */
    code: text().notNull().unique(),
    createdBy: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    maxUses: integer(),
    uses: integer().notNull().default(0),
    expiresAt: timestamp(tsOpts),
    revokedAt: timestamp(tsOpts),
    createdAt: timestamp(tsOpts).notNull().defaultNow(),
  },
  (t) => [index('league_invites_league_idx').on(t.leagueId)],
)
