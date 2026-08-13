import { Icons, Sprites } from '@pkmn/img'

/**
 * URL builders only — no local asset directory, and no CDN path baked into an
 * API response. The API returns species ids; the client picks a sprite style.
 */
export type SpriteStyle = 'gen5ani' | 'gen5' | 'ani'

export function spriteUrl(
  speciesName: string,
  opts: { style?: SpriteStyle; shiny?: boolean; side?: 'p1' | 'p2' } = {},
) {
  const s = Sprites.getPokemon(speciesName, {
    gen: opts.style ?? 'gen5ani',
    shiny: opts.shiny,
    side: opts.side ?? 'p2',
  })
  return { url: s.url, w: s.w, h: s.h, pixelated: s.pixelated }
}

/** CSS background shorthand for the Showdown icon sheet. */
export function iconCss(speciesName: string) {
  return Icons.getPokemon(speciesName).css
}

export function itemIconCss(itemName: string) {
  return Icons.getItem(itemName).css
}
