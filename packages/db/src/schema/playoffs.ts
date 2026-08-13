import { boolean, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createdAt, id } from './columns'
import { leagueMembers } from './leagues'
import { matchups, seasons } from './season'

export const bracketType = pgEnum('bracket_type', ['single_elim', 'double_elim'])
export const bracketStatus = pgEnum('bracket_status', ['pending', 'active', 'complete'])
export const bracketSide = pgEnum('bracket_side', ['winners', 'losers', 'final'])

export const brackets = pgTable('brackets', {
  id: id(),
  seasonId: uuid()
    .notNull()
    .unique()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  type: bracketType().notNull().default('single_elim'),
  size: integer().notNull(),
  thirdPlace: boolean().notNull().default(false),
  bracketReset: boolean().notNull().default(false),
  /** Frozen at generation — a later result correction must not reseed a running bracket. */
  seeds: jsonb().$type<string[]>().notNull(),
  status: bracketStatus().notNull().default('pending'),
  championMemberId: uuid().references(() => leagueMembers.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})

/**
 * Slots and their sources are stored, not just the resolved members: that is
 * what lets the bracket render before it is played, and makes progression a
 * pure function instead of pointer surgery.
 */
export const bracketMatches = pgTable(
  'bracket_matches',
  {
    id: id(),
    bracketId: uuid()
      .notNull()
      .references(() => brackets.id, { onDelete: 'cascade' }),
    /** Created once both slots are filled; reuses phase 6's reporting flow. */
    matchupId: uuid().references(() => matchups.id, { onDelete: 'set null' }),
    slot: text().notNull(),
    round: integer().notNull(),
    side: bracketSide().notNull(),
    homeSource: jsonb().$type<Record<string, unknown>>().notNull(),
    awaySource: jsonb().$type<Record<string, unknown>>().notNull(),
    homeMemberId: uuid().references(() => leagueMembers.id, { onDelete: 'set null' }),
    awayMemberId: uuid().references(() => leagueMembers.id, { onDelete: 'set null' }),
    winnerMemberId: uuid().references(() => leagueMembers.id, { onDelete: 'set null' }),
  },
  (t) => [unique('bracket_matches_slot_unique').on(t.bracketId, t.slot)],
)
