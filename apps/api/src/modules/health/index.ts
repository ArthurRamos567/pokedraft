import { Elysia, t } from 'elysia'
import { sql } from '../../db'

export const healthModule = new Elysia({ name: 'health', tags: ['health'] })
  .get('/health', () => ({ ok: true as const, uptime: process.uptime() }), {
    response: t.Object({ ok: t.Literal(true), uptime: t.Number() }),
    detail: { summary: 'Liveness — process is up. No dependencies touched.' },
  })
  .get(
    '/ready',
    async ({ status }) => {
      try {
        await sql`select 1`
        return { ok: true as const, db: 'up' as const }
      } catch {
        return status(503, { ok: false as const, db: 'down' as const })
      }
    },
    {
      response: {
        200: t.Object({ ok: t.Literal(true), db: t.Literal('up') }),
        503: t.Object({ ok: t.Literal(false), db: t.Literal('down') }),
      },
      detail: { summary: 'Readiness — database reachable.' },
    },
  )
