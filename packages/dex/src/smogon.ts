import { genOfFormat } from './gens'

/** Smogon's dex is keyed by game abbreviation, not generation number. */
const GEN_SLUG: Record<number, string> = {
  1: 'rb',
  2: 'gs',
  3: 'rs',
  4: 'dp',
  5: 'bw',
  6: 'xy',
  7: 'sm',
  8: 'ss',
  9: 'sv',
}

/**
 * The format's own page on Smogon, where one exists. A format with no analysis
 * section (VGC, LC) drops the suffix and lands on the generation's page, which
 * is still the right place to read about the species.
 */
const TIER_SLUG: Record<string, string> = {
  ou: 'ou',
  ubers: 'uber',
  uu: 'uu',
  ru: 'ru',
  nu: 'nu',
  pu: 'pu',
  lc: 'lc',
  monotype: 'monotype',
  doublesou: 'doubles',
  nationaldex: 'national-dex',
  anythinggoes: 'anything-goes',
}

/** `gen9nationaldex` → `nationaldex`; the tier is whatever follows the gen. */
function tierOf(formatId: string): string {
  return formatId.replace(/^gen\d+/, '').toLowerCase()
}

/**
 * Smogon slugs a species by its display name, lowercased and hyphenated —
 * `Landorus-Therian` → `landorus-therian`, `Farfetch’d` → `farfetchd`.
 */
export function smogonSlug(speciesName: string): string {
  return speciesName
    .toLowerCase()
    .replace(/[’'.:]/g, '')
    .replace(/[\s_]+/g, '-')
}

/**
 * A link to the species' analysis for the league's own format. Not every
 * species has an analysis written; Smogon still renders the dex entry, so a
 * link is never a dead end.
 */
export function smogonUrl(speciesName: string, formatId: string): string {
  const gen = GEN_SLUG[genOfFormat(formatId)] ?? 'sv'
  const tier = TIER_SLUG[tierOf(formatId)]
  const base = `https://www.smogon.com/dex/${gen}/pokemon/${smogonSlug(speciesName)}/`
  return tier ? `${base}${tier}/` : base
}
