import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { createdAt, id, tsOpts } from './columns'
import { leagueMembers, leagues } from './leagues'

export const transactionType = pgEnum('transaction_type', ['trade'])
export const transactionStatus = pgEnum('transaction_status', [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
  'approved',
  'vetoed',
  'expired',
])
export const voteKind = pgEnum('vote_kind', ['approve', 'veto'])

/**
 * The schema lands here, in phase 5, because roster derivation is
 * `picks − traded away + traded for` and that must exist exactly once. The
 * services and routes that drive these tables are phase 8.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    type: transactionType().notNull().default('trade'),
    status: transactionStatus().notNull().default('pending'),
    proposedBy: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    /** The counterparty; a trade always has exactly two sides in v1. */
    counterparty: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    note: text(),
    respondedAt: timestamp(tsOpts),
    resolvedAt: timestamp(tsOpts),
    resolvedBy: text().references(() => user.id, { onDelete: 'set null' }),
    expiresAt: timestamp(tsOpts),
    createdAt: createdAt(),
  },
  (t) => [
    index('transactions_league_idx').on(t.leagueId, t.status, t.createdAt),
    index('transactions_member_idx').on(t.proposedBy, t.counterparty),
  ],
)

/** One row per species moving, with the member it moves *from*. */
export const transactionItems = pgTable(
  'transaction_items',
  {
    id: id(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    fromMemberId: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    toMemberId: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    speciesId: text().notNull(),
  },
  (t) => [
    unique('transaction_items_species_unique').on(t.transactionId, t.speciesId),
    index('transaction_items_from_idx').on(t.fromMemberId),
    index('transaction_items_to_idx').on(t.toMemberId),
  ],
)

export const transactionVotes = pgTable(
  'transaction_votes',
  {
    id: id(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    memberId: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    vote: voteKind().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('transaction_votes_unique').on(t.transactionId, t.memberId)],
)

export const teamProfiles = pgTable('team_profiles', {
  memberId: uuid()
    .primaryKey()
    .references(() => leagueMembers.id, { onDelete: 'cascade' }),
  teamName: text(),
  logoUrl: text(),
  color: text(),
  motto: text(),
})
