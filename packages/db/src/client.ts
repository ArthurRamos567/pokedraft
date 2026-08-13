import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof createDb>['db']

export function createDb(url: string, opts: { max?: number } = {}) {
  const sql = postgres(url, {
    max: opts.max ?? 10,
    // Prepared statements break under connection poolers; harmless to keep on
    // for a direct connection, so this stays default-on and flips in deploy.
    prepare: process.env.PG_PREPARE !== 'false',
    onnotice: () => {},
  })
  const db = drizzle(sql, { schema, casing: 'snake_case' })
  return { db, sql }
}
