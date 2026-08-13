import {
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
import { user } from './auth'
import { createdAt, id, tsOpts } from './columns'
import { leagueMembers, leagues } from './leagues'
import { pointLists } from './points'

export const draftStatus = pgEnum('draft_status', ['pending', 'active', 'paused', 'complete'])

export const drafts = pgTable('drafts', {
  id: id(),
  leagueId: uuid()
    .notNull()
    .unique()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  /** Which price list this draft ran on — locked at start, never re-read. */
  pointListId: uuid().references(() => pointLists.id),
  status: draftStatus().notNull().default('pending'),
  /** A cache of the fold over `draft_events`, which is the actual truth. */
  state: jsonb().$type<Record<string, unknown>>().notNull(),
  seq: integer().notNull().default(0),
  startedAt: timestamp(tsOpts),
  completedAt: timestamp(tsOpts),
  createdAt: createdAt(),
})

/**
 * Append-only, and the source of truth. `drafts.state` can be dropped and
 * rebuilt from this table alone — there is a test that does exactly that.
 */
export const draftEvents = pgTable(
  'draft_events',
  {
    id: id(),
    draftId: uuid()
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    actorId: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('draft_events_seq_unique').on(t.draftId, t.seq),
    index('draft_events_draft_idx').on(t.draftId, t.seq),
  ],
)

/**
 * A projection of `PICK_MADE`, stored because every other phase joins against
 * it — and because `UNIQUE (draft_id, species_id)` is the real guarantee that
 * two simultaneous picks cannot take the same mon. The application check is
 * only there to produce a decent error message.
 */
export const draftPicks = pgTable(
  'draft_picks',
  {
    id: id(),
    draftId: uuid()
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    memberId: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    speciesId: text().notNull(),
    cost: integer().notNull(),
    round: integer().notNull(),
    pickNo: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('draft_picks_species_unique').on(t.draftId, t.speciesId),
    unique('draft_picks_pickno_unique').on(t.draftId, t.pickNo),
    index('draft_picks_member_idx').on(t.memberId),
  ],
)

export const draftQueues = pgTable(
  'draft_queues',
  {
    id: id(),
    memberId: uuid()
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    speciesId: text().notNull(),
    rank: integer().notNull(),
  },
  (t) => [
    unique('draft_queues_species_unique').on(t.memberId, t.speciesId),
    index('draft_queues_member_idx').on(t.memberId, t.rank),
  ],
)
