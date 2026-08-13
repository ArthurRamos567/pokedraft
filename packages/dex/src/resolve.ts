import type { GenerationNum } from '@pkmn/dex'
import { ALIASES } from './aliases'
import { genOfFormat, toID } from './gens'
import { allSpecies, canonicalize, getSpecies } from './species'

export type ResolveMethod = 'exact' | 'alias' | 'forme' | 'cosmetic'

export type Resolved =
  | { input: string; ok: true; id: string; name: string; method: ResolveMethod }
  | { input: string; ok: false; suggestions: { id: string; name: string; score: number }[] }

/**
 * Forme spellings people actually type: "Landorus (Therian)", "Landorus T",
 * "Rotom Wash". Each candidate is a plain id attempt — nothing here guesses.
 */
function formeCandidates(input: string): string[] {
  const out = new Set<string>()
  const cleaned = input
    .replace(/[()[\]]/g, ' ')
    .replace(/[’']/g, '')
    .trim()

  out.add(toID(cleaned))
  out.add(toID(cleaned.replace(/\s+/g, '-')))
  out.add(toID(cleaned.replace(/-/g, ' ')))

  // "Landorus Therian" → "landorus-therian" → also try dropping the separator
  const parts = cleaned.split(/[\s-]+/).filter(Boolean)
  if (parts.length > 1) {
    out.add(toID(parts.join('')))
    out.add(toID(`${parts[0]}-${parts.slice(1).join('')}`))
  }
  return [...out].filter(Boolean)
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `
  const out = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
  return out
}

function similarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared)
}

const FUZZY_THRESHOLD = 0.35
const MAX_SUGGESTIONS = 3

type Index = { ids: string[]; names: string[] }
const indices = new Map<number, Index>()

function index(genNum: GenerationNum): Index {
  const cached = indices.get(genNum)
  if (cached) return cached
  const list = allSpecies(genNum)
  const built = { ids: list.map((s) => s.id), names: list.map((s) => s.name) }
  indices.set(genNum, built)
  return built
}

/**
 * Turns a human-typed name into a canonical dex id.
 *
 * Fuzzy matches are returned as **suggestions and never applied**. A points
 * list that silently turned "Mew" into "Mewtwo" would misprice a mon for a
 * whole season, and nobody would notice until the draft.
 */
export function resolveName(
  input: string,
  opts: { gen?: GenerationNum; format?: string; collapseCosmetic?: boolean } = {},
): Resolved {
  const genNum = opts.format ? genOfFormat(opts.format) : (opts.gen ?? 9)
  const raw = input.trim()
  if (!raw) return { input, ok: false, suggestions: [] }

  const hit = (id: string, method: ResolveMethod): Resolved | null => {
    let s = getSpecies(id, genNum)
    if (!s?.exists) return null
    let m = method
    if (opts.collapseCosmetic !== false) {
      const canon = canonicalize(s, genNum)
      if (canon.id !== s.id) {
        s = canon
        m = 'cosmetic'
      }
    }
    return { input, ok: true, id: s.id, name: s.name, method: m }
  }

  const exact = hit(toID(raw), 'exact')
  if (exact) return exact

  const alias = ALIASES.get(toID(raw))
  if (alias) {
    const viaAlias = hit(alias, 'alias')
    if (viaAlias) return viaAlias
  }

  for (const candidate of formeCandidates(raw)) {
    const viaForme = hit(candidate, 'forme')
    if (viaForme) return viaForme
  }

  const { ids, names } = index(genNum)
  const needle = toID(raw)
  const scored: { id: string; name: string; score: number }[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    const score = similarity(needle, id)
    if (score >= FUZZY_THRESHOLD) scored.push({ id, name: names[i]!, score })
  }
  scored.sort((a, b) => b.score - a.score)

  return { input, ok: false, suggestions: scored.slice(0, MAX_SUGGESTIONS) }
}

export function resolveMany(
  names: string[],
  opts: Parameters<typeof resolveName>[1] = {},
): Resolved[] {
  return names.map((n) => resolveName(n, opts))
}
