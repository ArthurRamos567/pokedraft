import { defineConfig } from 'drizzle-kit'

// Run from the repo root (`bun db:generate`) so Bun picks up the root `.env`.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set — run drizzle-kit from the repo root')

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/db/src/schema/index.ts',
  out: './packages/db/migrations',
  dbCredentials: { url },
  casing: 'snake_case',
  strict: true,
  verbose: true,
})
