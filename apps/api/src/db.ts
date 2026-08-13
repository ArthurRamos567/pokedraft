import { createDb } from '@pokedraft/db'
import { env } from './env'

export const { db, sql } = createDb(env.DATABASE_URL)
export type { Database } from '@pokedraft/db'
