import { timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Postgres 17 has no `uuidv7()`, so ids are generated in the application.
 * They stay time-ordered, which keeps index locality sane.
 */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => Bun.randomUUIDv7())

export const tsOpts = { withTimezone: true, mode: 'date' } as const

export const createdAt = () => timestamp(tsOpts).notNull().defaultNow()
export const updatedAt = () =>
  timestamp(tsOpts)
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}
