import { Dex as SimDex } from '@pkmn/sim'
import { genOfFormat } from './gens'

/**
 * The UI dropdown, not a whitelist — any valid Showdown format id is accepted
 * by the API. This list is the handful draft leagues actually run.
 */
export const SUPPORTED_FORMATS = [
  'gen9ou',
  'gen9ubers',
  'gen9uu',
  'gen9ru',
  'gen9nu',
  'gen9pu',
  'gen9lc',
  'gen9monotype',
  'gen9doublesou',
  'gen9nationaldex',
  'gen9nationaldexubers',
  'gen9vgc2025regi',
  'gen8ou',
  'gen8nationaldex',
  'gen7ou',
  'gen6ou',
  'gen5ou',
  'gen4ou',
  'gen3ou',
] as const

export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number]

export type FormatInfo = {
  id: string
  name: string
  gen: number
  /** `Singles` | `Doubles` | … as Showdown labels it. */
  gameType: string
  /** Clause names, for league info text. They gate battles, not draftability. */
  rules: string[]
  supported: boolean
}

export function getSimFormat(id: string) {
  const f = SimDex.formats.get(id)
  return f?.exists ? f : null
}

const ruleTables = new Map<string, ReturnType<typeof SimDex.formats.getRuleTable>>()

/** Resolved bans including everything inherited through the ruleset chain. */
export function getRuleTable(formatId: string) {
  const cached = ruleTables.get(formatId)
  if (cached) return cached
  const format = getSimFormat(formatId)
  if (!format) return null
  const table = SimDex.formats.getRuleTable(format)
  ruleTables.set(formatId, table)
  return table
}

export function getFormatInfo(id: string): FormatInfo | null {
  const f = getSimFormat(id)
  if (!f) return null
  const table = getRuleTable(id)
  const rules = table
    ? [...table.keys()].filter((k) => !k.startsWith('-') && !k.startsWith('+') && !k.includes(':'))
    : []
  return {
    id: f.id,
    name: f.name,
    gen: genOfFormat(f.id),
    gameType: f.gameType ?? 'singles',
    rules,
    supported: (SUPPORTED_FORMATS as readonly string[]).includes(f.id),
  }
}

export function listFormats(opts: { supportedOnly?: boolean; q?: string } = {}): FormatInfo[] {
  const source = opts.supportedOnly ? [...SUPPORTED_FORMATS] : SimDex.formats.all().map((f) => f.id)

  const q = opts.q?.toLowerCase()
  const out: FormatInfo[] = []
  for (const id of source) {
    const info = getFormatInfo(id)
    if (!info) continue
    if (q && !info.name.toLowerCase().includes(q) && !info.id.includes(q)) continue
    out.push(info)
  }
  return out
}
