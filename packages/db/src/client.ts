import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

function build(url: string, opts: { max?: number } = {}) {
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

export const createDb = build

type Root = ReturnType<typeof build>['db']
type Tx = Parameters<Parameters<Root['transaction']>[0]>[0]

/**
 * Everything a repo or service needs. Deliberately covers a transaction as
 * well as the root client, so a service can be called inside someone else's
 * transaction without a second overload.
 */
export type Database = Root | Tx
export type RootDatabase = Root
