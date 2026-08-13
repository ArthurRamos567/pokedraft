import { ERROR_CODES } from '@pokedraft/shared'
import { parse as parseYaml } from 'yaml'
import { badRequest, tooLarge } from '../../errors'

export const MAX_BYTES = 256 * 1024
export const MAX_ENTRIES = 2000

export type ParsedRow = {
  /** Exactly what the file said, kept for the preview table. */
  input: string
  points: number
  banned: boolean
}

/**
 * Two shapes, because both are what people actually keep their sheets in:
 *
 *   A)  Landorus-Therian: 20        (name → points)
 *   B)  20: [Landorus-Therian, …]   (points → names, plus a `banned:` key)
 *
 * Anything else is rejected rather than guessed at.
 */
export function parsePointsYml(source: string): ParsedRow[] {
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) {
    throw tooLarge(ERROR_CODES.POINTS_TOO_LARGE, `points file exceeds ${MAX_BYTES} bytes`)
  }

  let doc: unknown
  try {
    // Default schema only — no custom tags, no code execution surface.
    doc = parseYaml(source, { schema: 'core' })
  } catch (err) {
    throw badRequest(
      ERROR_CODES.POINTS_PARSE_ERROR,
      `could not parse YAML: ${(err as Error).message}`,
    )
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw badRequest(
      ERROR_CODES.POINTS_PARSE_ERROR,
      'expected a mapping of names to points, or of points to name lists',
    )
  }

  const rows: ParsedRow[] = []
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    const trimmed = key.trim()

    // Shape B's `banned:` bucket. It is a list of names, not a price.
    if (trimmed.toLowerCase() === 'banned') {
      for (const name of asNameList(value, trimmed)) {
        rows.push({ input: name, points: 0, banned: true })
      }
      continue
    }

    if (Array.isArray(value)) {
      const points = Number(trimmed)
      if (!Number.isFinite(points)) {
        throw badRequest(
          ERROR_CODES.POINTS_PARSE_ERROR,
          `"${trimmed}" maps to a list, so it must be a point value or "banned"`,
        )
      }
      for (const name of asNameList(value, trimmed)) {
        rows.push({ input: name, points, banned: false })
      }
      continue
    }

    const points = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(points)) {
      throw badRequest(
        ERROR_CODES.POINTS_PARSE_ERROR,
        `"${trimmed}" has a non-numeric value: ${JSON.stringify(value)}`,
      )
    }
    rows.push({ input: trimmed, points, banned: false })
  }

  if (rows.length > MAX_ENTRIES) {
    throw tooLarge(ERROR_CODES.POINTS_TOO_LARGE, `points file has more than ${MAX_ENTRIES} entries`)
  }
  return rows
}

function asNameList(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    throw badRequest(ERROR_CODES.POINTS_PARSE_ERROR, `"${key}" must map to a list of names`)
  }
  return value.map((v) => {
    if (typeof v !== 'string') {
      throw badRequest(
        ERROR_CODES.POINTS_PARSE_ERROR,
        `"${key}" contains a non-string entry: ${JSON.stringify(v)}`,
      )
    }
    return v.trim()
  })
}
