import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { createdAt, id, tsOpts } from './columns'

/**
 * Append-only. Every host action that changes league state writes one row so a
 * dispute can be reconstructed months later. Not a replacement for
 * `draft_events` — that one is the truth, this one is the paper trail.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    /** Nullable: system jobs act without a user. */
    actorId: text().references(() => user.id, { onDelete: 'set null' }),
    leagueId: uuid(),
    action: text().notNull(),
    /** `league` | `draft` | `season` | `transaction` | … */
    targetType: text().notNull(),
    targetId: text(),
    meta: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_league_idx').on(t.leagueId, t.createdAt),
    index('audit_log_actor_idx').on(t.actorId, t.createdAt),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    leagueId: uuid(),
    /** `draft.your_turn` | `trade.proposed` | `match.reported` | … */
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    /** Relative path into the web app. */
    link: text(),
    readAt: timestamp(tsOpts),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)],
)
