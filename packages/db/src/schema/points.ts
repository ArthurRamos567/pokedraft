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
import { createdAt, id, tsOpts } from './columns'
import { leagues } from './leagues'

export const pointListSource = pgEnum('point_list_source', ['yml_upload', 'manual', 'cloned'])

/**
 * Versioned and immutable once a draft starts, so a mid-draft price edit can't
 * retroactively change what a pick cost. The active list is the highest
 * version for the league.
 */
export const pointLists = pgTable(
  'point_lists',
  {
    id: id(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    name: text(),
    source: pointListSource().notNull().default('yml_upload'),
    /** The original upload, kept verbatim so a bad import can be re-read. */
    rawSource: text(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    lockedAt: timestamp(tsOpts),
    createdAt: createdAt(),
  },
  (t) => [
    unique('point_lists_version_unique').on(t.leagueId, t.version),
    index('point_lists_league_idx').on(t.leagueId, t.version),
  ],
)

export const pointEntries = pgTable(
  'point_entries',
  {
    id: id(),
    pointListId: uuid()
      .notNull()
      .references(() => pointLists.id, { onDelete: 'cascade' }),
    /** Canonical dex id — never a display name. */
    speciesId: text().notNull(),
    points: integer().notNull(),
    /** Explicitly undraftable, as opposed to merely absent from the list. */
    banned: boolean().notNull().default(false),
    notes: text(),
  },
  (t) => [
    unique('point_entries_species_unique').on(t.pointListId, t.speciesId),
    index('point_entries_list_idx').on(t.pointListId),
  ],
)
