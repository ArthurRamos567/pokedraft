import { toID } from './gens'

/**
 * Viability-thread shorthand that `toID()` alone will never resolve. Seeded
 * from the MVP's scraper alias table; extend freely — every entry is covered
 * by a test that asserts it lands on a real species.
 */
const RAW_ALIASES: Record<string, string> = {
  'landorus t': 'Landorus-Therian',
  'landorus-t': 'Landorus-Therian',
  'lando-t': 'Landorus-Therian',
  landot: 'Landorus-Therian',
  'lando-i': 'Landorus',
  'thundurus-t': 'Thundurus-Therian',
  'thundy-t': 'Thundurus-Therian',
  'tornadus-t': 'Tornadus-Therian',
  'torn-t': 'Tornadus-Therian',
  'rotom-w': 'Rotom-Wash',
  'rotom-h': 'Rotom-Heat',
  'rotom-c': 'Rotom-Mow',
  'rotom-s': 'Rotom-Fan',
  'rotom-f': 'Rotom-Frost',
  'urshifu-rs': 'Urshifu-Rapid-Strike',
  'urshifu-r': 'Urshifu-Rapid-Strike',
  'urshifu-ss': 'Urshifu',
  'deoxys-d': 'Deoxys-Defense',
  'deoxys-s': 'Deoxys-Speed',
  'deoxys-a': 'Deoxys-Attack',
  'hoopa-u': 'Hoopa-Unbound',
  raichualola: 'Raichu-Alola',
  'necrozma-dm': 'Necrozma-Dusk-Mane',
  'necrozma-dw': 'Necrozma-Dawn-Wings',
  'zygarde-10': 'Zygarde-10%',
  ttar: 'Tyranitar',
  pex: 'Toxapex',
  ferro: 'Ferrothorn',
  zam: 'Alakazam',
  bliss: 'Blissey',
  chomp: 'Garchomp',
  gambit: 'Kingambit',
  gholden: 'Gholdengo',
  glowbro: 'Slowbro-Galar',
  gking: 'Slowking-Galar',
  'great tusk': 'Great Tusk',
  ogerpon_w: 'Ogerpon-Wellspring',
  'ogerpon-w': 'Ogerpon-Wellspring',
  'ogerpon-h': 'Ogerpon-Hearthflame',
  'ogerpon-c': 'Ogerpon-Cornerstone',
  'ting-lu': 'Ting-Lu',
  'chien-pao': 'Chien-Pao',
  'wo-chien': 'Wo-Chien',
  'chi-yu': 'Chi-Yu',
  'ho-oh': 'Ho-Oh',
  'porygon-z': 'Porygon-Z',
  pz: 'Porygon-Z',
  'mr mime': 'Mr. Mime',
  'mime jr': 'Mime Jr.',
  'type null': 'Type: Null',
  ape: 'Annihilape',
  ironval: 'Iron Valiant',
  'iron val': 'Iron Valiant',
  flutter: 'Flutter Mane',
}

/** Normalized alias id → canonical species id. */
export const ALIASES: Map<string, string> = new Map(
  Object.entries(RAW_ALIASES).map(([k, v]) => [toID(k), toID(v)]),
)

/** Raw table, for the test that proves every alias points at a real species. */
export const ALIAS_SOURCE = RAW_ALIASES
