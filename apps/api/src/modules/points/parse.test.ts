import { describe, expect, it } from 'bun:test'
import { classifyRows, committableRows, diffAgainst } from './classify'
import { parsePointsYml } from './parse'

const SHAPE_A = `
Landorus-Therian: 20
Weavile: 19
Heatran: 18
`

const SHAPE_B = `
20:
  - Landorus-Therian
19:
  - Weavile
18:
  - Heatran
`

describe('yml parsing', () => {
  it('produces the same rows from both shapes', () => {
    const a = parsePointsYml(SHAPE_A)
    const b = parsePointsYml(SHAPE_B)
    const key = (rows: ReturnType<typeof parsePointsYml>) =>
      [...rows].sort((x, y) => x.input.localeCompare(y.input)).map((r) => `${r.input}=${r.points}`)
    expect(key(a)).toEqual(key(b))
  })

  it('treats `banned:` as a name list, not a price bucket', () => {
    const rows = parsePointsYml(`
20:
  - Landorus-Therian
banned:
  - Zacian-Crowned
  - Miraidon
`)
    const banned = rows.filter((r) => r.banned)
    expect(banned.map((r) => r.input)).toEqual(['Zacian-Crowned', 'Miraidon'])
    expect(rows.find((r) => r.input === 'Landorus-Therian')?.banned).toBe(false)
  })

  it('rejects a non-numeric price rather than guessing', () => {
    expect(() => parsePointsYml('Landorus-Therian: cheap')).toThrow()
  })

  it('rejects a top-level list', () => {
    expect(() => parsePointsYml('- Landorus-Therian')).toThrow()
  })

  it('rejects a file over the size limit', () => {
    const huge = `${'x'.repeat(300 * 1024)}: 1`
    expect(() => parsePointsYml(huge)).toThrow()
  })
})

describe('classification', () => {
  it('marks a legal mon ok and a banned one illegal', () => {
    const { rows, summary } = classifyRows(
      [
        { input: 'Landorus-Therian', points: 20, banned: false },
        { input: 'Flutter Mane', points: 22, banned: false },
      ],
      'gen9ou',
    )
    expect(rows[0]?.status).toBe('ok')
    expect(rows[1]?.status).toBe('illegal')
    expect(rows[1]?.reason).toBe('banned')
    expect(summary).toEqual({ ok: 1, illegal: 1, unknown: 0, duplicates: 0 })
  })

  it('suggests for an unknown name and never resolves it', () => {
    const { rows } = classifyRows([{ input: 'Mewtoo', points: 5, banned: false }], 'gen9ou')
    expect(rows[0]?.status).toBe('unknown')
    expect(rows[0]?.speciesId).toBeNull()
    expect(rows[0]?.suggestions?.[0]?.id).toBe('mewtwo')
  })

  it('lets the last duplicate win but keeps the earlier row visible', () => {
    const { rows, summary } = classifyRows(
      [
        { input: 'Lando-T', points: 20, banned: false },
        { input: 'Landorus-Therian', points: 18, banned: false },
      ],
      'gen9ou',
    )
    expect(summary.duplicates).toBe(1)
    expect(rows[0]?.status).toBe('duplicate')
    expect(committableRows(rows)).toEqual([
      { speciesId: 'landorustherian', points: 18, banned: false },
    ])
  })

  it('drops illegal rows unless the host opts in', () => {
    const { rows } = classifyRows(
      [
        { input: 'Landorus-Therian', points: 20, banned: false },
        { input: 'Flutter Mane', points: 22, banned: false },
      ],
      'gen9ou',
    )
    expect(committableRows(rows)).toHaveLength(1)
    expect(committableRows(rows, { allowIllegal: true })).toHaveLength(2)
  })
})

describe('diff', () => {
  it('splits into added, removed and repriced', () => {
    const diff = diffAgainst(
      [
        { speciesId: 'landorustherian', points: 20 },
        { speciesId: 'gholdengo', points: 19 },
      ],
      [
        { speciesId: 'landorustherian', points: 18 },
        { speciesId: 'weavile', points: 17 },
      ],
    )
    expect(diff.added).toEqual([{ speciesId: 'gholdengo', points: 19 }])
    expect(diff.removed).toEqual([{ speciesId: 'weavile', points: 17 }])
    expect(diff.repriced).toEqual([{ speciesId: 'landorustherian', from: 18, to: 20 }])
  })
})
