/**
 * Release-step migrator. Never runs at container boot — a bad migration must
 * fail the deploy, not crash-loop the API.
 *
 *   bun db:migrate
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './client'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const { db, sql } = createDb(url, { max: 1 })

try {
  await migrate(db, { migrationsFolder: `${import.meta.dir}/../migrations` })
  console.log('migrations applied')
} catch (err) {
  console.error('migration failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
