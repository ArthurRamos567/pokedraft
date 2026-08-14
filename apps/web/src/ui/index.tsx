import { Sprites } from '@pkmn/img'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

/** The eighteen type colours are the palette; everything else is greyscale. */
export function TypeChip({ type }: { type: string }) {
  return (
    <span className="type" style={{ ['--tc' as string]: `var(--type-${type.toLowerCase()})` }}>
      {type.slice(0, 3)}
    </span>
  )
}

/**
 * Smogon's ladder is a ranking, so the chip is a ramp: the higher the shelf,
 * the hotter the colour. `BL` sits with the tier it is banned from, because
 * that is what the name means. A parenthesised tier — `(OU)`, `(DUU)` — is
 * Showdown saying "legal there, nobody uses it"; same hue, spoken quieter.
 */
const TIER_RAMP: Record<string, string> = {
  AG: 'var(--bad)',
  Uber: 'var(--bad)',
  OU: 'var(--live)',
  OUBL: 'var(--live)',
  DUber: 'var(--bad)',
  DOU: 'var(--live)',
  DBL: 'var(--live)',
  UU: 'var(--pick)',
  UUBL: 'var(--pick)',
  DUU: 'var(--pick)',
  RU: 'var(--good)',
  RUBL: 'var(--good)',
  NU: 'var(--type-grass)',
  NUBL: 'var(--type-grass)',
  PU: 'var(--type-steel)',
  PUBL: 'var(--type-steel)',
  ZU: 'var(--type-steel)',
  NFE: 'var(--text-3)',
  LC: 'var(--type-fairy)',
}

export function TierChip({ tier }: { tier: string }) {
  const bare = tier.replace(/[()]/g, '')
  const unused = bare !== tier
  const colour = TIER_RAMP[bare] ?? 'var(--text-3)'
  return (
    <span
      className={unused ? 'tier tier-unused' : 'tier'}
      style={{ ['--tier-c' as string]: colour }}
      title={unused ? `${bare} — legal, unused` : bare}
    >
      {tier}
    </span>
  )
}

export function Badge({
  children,
  tone = 'default',
  live,
}: {
  children: ReactNode
  tone?: 'default' | 'live' | 'good' | 'bad'
  live?: boolean
}) {
  return (
    <span className={`badge${tone === 'default' ? '' : ` badge-${tone}`}`}>
      {live && <i className="dot" />}
      {children}
    </span>
  )
}

/**
 * Showdown's CDN sprite. The API returns ids; `@pkmn/img` maps an id to the
 * right directory and filename — a hand-built `/sprites/gen5/<id>.png` misses
 * every forme (`latias-mega`) and everything drawn after gen 5.
 */
export function Sprite({ species, size = 'md' }: { species: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'sm' ? 'sprite sprite-sm' : size === 'lg' ? 'sprite sprite-lg' : 'sprite'
  const { url, pixelated } = Sprites.getPokemon(species, { gen: 'ani' })
  return (
    <img
      className={cls}
      alt=""
      loading="lazy"
      src={url}
      style={pixelated ? undefined : { imageRendering: 'auto' }}
      onError={(e) => {
        // A few formes have no art of their own (greninja-bond); Showdown
        // draws the base species for them, so fall back to it once.
        const fallback = baseSpriteUrl(url)
        if (fallback && e.currentTarget.src !== fallback) {
          e.currentTarget.src = fallback
          return
        }
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}

function baseSpriteUrl(url: string): string | null {
  const file = url.slice(url.lastIndexOf('/') + 1)
  const base = file.slice(0, file.lastIndexOf('.')).split('-')[0]
  if (!base || !file.includes('-')) return null
  return Sprites.getPokemon(base, { gen: 'ani' }).url
}

export function Card({
  title,
  actions,
  children,
  pad = true,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  pad?: boolean
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {actions}
        </header>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  )
}

export function StatBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="stack" style={{ gap: 4 }}>
      {label && (
        <div className="row-between">
          <span className="label">{label}</span>
          <span className="num" style={{ fontSize: 12 }}>
            {value}/{max}
          </span>
        </div>
      )}
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>
}

export function ErrorBar({ error }: { error: unknown }) {
  if (!error) return null
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
  return <div className="error-bar">{message}</div>
}

export function Skeleton({ h = 60 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="dialog-backdrop">
      {/* A real button rather than a click handler on a div, so dismissing by
          clicking away is reachable from the keyboard too. */}
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          border: 0,
          background: 'transparent',
          cursor: 'default',
        }}
      />
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ position: 'relative' }}
      >
        <header className="card-head">
          <h3>{title}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Esc
          </button>
        </header>
        <div className="card-pad">{children}</div>
        {footer && (
          <footer className="card-head" style={{ borderBottom: 0 }}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/** Counts down to an epoch-ms deadline, announced politely for screen readers. */
export function Countdown({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [deadline])

  if (!deadline) return <span className="timer faint">--:--</span>
  const left = Math.max(0, deadline - now)
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return (
    <span className={`timer${left < 15000 ? ' urgent' : ''}`} aria-live="polite" aria-atomic="true">
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  )
}

export function Avatar({ name, color }: { name: string; color?: string | null }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      aria-hidden
      style={{
        width: 26,
        height: 26,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'var(--mono)',
        background: color ?? 'var(--ink-500)',
        color: '#0a0d12',
        boxShadow: 'inset 0 0 0 1px var(--line-2)',
      }}
    >
      {initials || '??'}
    </span>
  )
}
