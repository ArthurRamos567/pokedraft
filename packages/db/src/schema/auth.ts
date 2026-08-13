import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Better Auth's core schema, hand-committed here so it lives under normal
 * migrations instead of a second source of truth. Regenerate deliberately with
 * the Better Auth CLI when the pinned version changes — never automatically.
 *
 * Auth ids are text (Better Auth generates them); application tables use
 * uuidv7 and reference `user.id` as text.
 */

const ts = { withTimezone: true, mode: 'date' } as const

export const user = pgTable('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp(ts).notNull().defaultNow(),
  updatedAt: timestamp(ts).notNull().defaultNow(),

  // additionalFields — see plans/phase-01-scaffold.md
  displayName: text(),
  /** Matched against replay participants in phase 6. */
  showdownUsername: text(),
  avatarUrl: text(),
})

export const session = pgTable('session', {
  id: text().primaryKey(),
  expiresAt: timestamp(ts).notNull(),
  token: text().notNull().unique(),
  createdAt: timestamp(ts).notNull().defaultNow(),
  updatedAt: timestamp(ts).notNull().defaultNow(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp(ts),
  refreshTokenExpiresAt: timestamp(ts),
  scope: text(),
  password: text(),
  createdAt: timestamp(ts).notNull().defaultNow(),
  updatedAt: timestamp(ts).notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp(ts).notNull(),
  createdAt: timestamp(ts).notNull().defaultNow(),
  updatedAt: timestamp(ts).notNull().defaultNow(),
})
