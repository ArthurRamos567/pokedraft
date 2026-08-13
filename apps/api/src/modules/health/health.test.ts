import { describe, expect, it } from 'bun:test'
import { api } from '../../test/client'

describe('health', () => {
  it('returns a typed ok from /health', async () => {
    const { data, status } = await api.health.get()
    expect(status).toBe(200)
    expect(data?.ok).toBe(true)
    expect(typeof data?.uptime).toBe('number')
  })

  it('reports the database as up from /ready', async () => {
    const { data, status } = await api.ready.get()
    expect(status).toBe(200)
    expect(data?.db).toBe('up')
  })
})
