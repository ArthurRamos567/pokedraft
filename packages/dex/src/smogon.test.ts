import { describe, expect, it } from 'bun:test'
import { smogonSlug, smogonUrl } from './smogon'

describe('smogonSlug', () => {
  it('hyphenates formes and drops punctuation', () => {
    expect(smogonSlug('Landorus-Therian')).toBe('landorus-therian')
    expect(smogonSlug('Diancie-Mega')).toBe('diancie-mega')
    expect(smogonSlug('Farfetch’d')).toBe('farfetchd')
    expect(smogonSlug('Mr. Mime')).toBe('mr-mime')
    expect(smogonSlug('Type: Null')).toBe('type-null')
  })
})

describe('smogonUrl', () => {
  it('maps the generation to Smogon’s game slug', () => {
    expect(smogonUrl('Dragapult', 'gen8ou')).toBe(
      'https://www.smogon.com/dex/ss/pokemon/dragapult/ou/',
    )
    expect(smogonUrl('Garchomp', 'gen4ou')).toBe(
      'https://www.smogon.com/dex/dp/pokemon/garchomp/ou/',
    )
  })

  it('maps the tier, including the ones Smogon spells differently', () => {
    expect(smogonUrl('Koraidon', 'gen9ubers')).toBe(
      'https://www.smogon.com/dex/sv/pokemon/koraidon/uber/',
    )
    expect(smogonUrl('Gliscor', 'gen9nationaldex')).toBe(
      'https://www.smogon.com/dex/sv/pokemon/gliscor/national-dex/',
    )
    expect(smogonUrl('Flutter Mane', 'gen9doublesou')).toBe(
      'https://www.smogon.com/dex/sv/pokemon/flutter-mane/doubles/',
    )
  })

  it('falls back to the species page for formats with no analysis section', () => {
    expect(smogonUrl('Miraidon', 'gen9vgc2025regi')).toBe(
      'https://www.smogon.com/dex/sv/pokemon/miraidon/',
    )
  })
})
