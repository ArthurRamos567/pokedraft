import { describe, expect, it } from 'bun:test'
import { api, call } from '../../test/client'

describe('dex routes', () => {
  it('serves the curated format list', async () => {
    const { data } = await api.dex.formats.get({ query: {} })
    expect(data?.some((f) => f.id === 'gen9ou')).toBe(true)
    expect(data?.every((f) => f.supported)).toBe(true)
  })

  it('404s an unknown format with a stable code', async () => {
    const res = await call('/dex/formats/gen9nope')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORMAT_NOT_FOUND')
  })

  it('puts Landorus-Therian first for "lando"', async () => {
    const { data } = await api.dex.species.get({ query: { format: 'gen9ou', q: 'lando' } })
    expect(data?.items[0]?.id).toBe('landorustherian')
  })

  it('returns full species detail with format legality attached', async () => {
    const res = await call('/dex/species/landorustherian?format=gen9ou')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      bst: number
      evolutionLine: string[]
      legal: { legal: boolean }
    }
    expect(body.bst).toBe(600)
    expect(body.legal.legal).toBe(true)
  })

  it('reports why a banned mon is illegal instead of hiding it', async () => {
    const res = await call('/dex/species/fluttermane?format=gen9ou')
    const body = (await res.json()) as { legal: { legal: boolean; reason?: string } }
    expect(body.legal.legal).toBe(false)
    expect(body.legal.reason).toBe('banned')
  })

  it('serves a learnset', async () => {
    const res = await call('/dex/species/gholdengo/learnset?format=gen9ou')
    const body = (await res.json()) as { moves: { id: string }[] }
    expect(body.moves.length).toBeGreaterThan(20)
  })

  it('resolves a batch of names and suggests for the rest', async () => {
    const res = await call('/dex/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ names: ['lando-t', 'Toxapex', 'Mewtoo'], format: 'gen9ou' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      resolved: { input: string; id: string }[]
      unmatched: { input: string; suggestions: { id: string }[] }[]
    }
    expect(body.resolved.map((r) => r.id)).toEqual(['landorustherian', 'toxapex'])
    expect(body.unmatched[0]?.input).toBe('Mewtoo')
    expect(body.unmatched[0]?.suggestions[0]?.id).toBe('mewtwo')
  })

  it('marks reference data cacheable', async () => {
    const res = await call('/dex/formats')
    expect(res.headers.get('cache-control')).toContain('max-age=3600')
  })

  it('never caches a resolve response', async () => {
    const res = await call('/dex/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ names: ['Pikachu'] }),
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
