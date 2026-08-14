import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useState } from 'react'
import { request } from '../lib/api'
import { Card, Empty, Sprite } from '../ui'
import { useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/speed')({ component: SpeedPage })

type SpeedRow = {
  speciesId: string
  name: string
  base: number
  neutral: number
  positive: number
  negative: number
  scarf: number
  minimum: number
  memberId: string
  teamName: string
}

/**
 * Enough accents to tell four or five compared teams apart at a glance, drawn
 * from tokens already in the palette. Assigned by position in the roster list,
 * not by click order, so a team keeps its colour across deselections.
 */
const TEAM_ACCENTS = [
  'var(--live)',
  'var(--pick)',
  'var(--good)',
  'var(--type-fairy)',
  'var(--type-ice)',
  'var(--bad)',
  'var(--type-grass)',
  'var(--type-flying)',
]

/**
 * Base-speed clusters. The gaps matter more than the numbers — what people
 * actually ask is "who outspeeds this", and the answer is a band, not a row.
 */
const BANDS = [
  { from: 120, label: 'Scarf-proof / 120+' },
  { from: 100, label: '100 – 119' },
  { from: 85, label: '85 – 99' },
  { from: 70, label: '70 – 84' },
  { from: 0, label: 'Under 70' },
] as const

const bandOf = (base: number) => BANDS.find((b) => base >= b.from) ?? BANDS[BANDS.length - 1]!

function SpeedPage() {
  const { slug } = Route.useParams()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const { data } = useQuery({
    queryKey: ['league', slug, 'speed'],
    queryFn: () => request<SpeedRow[]>(`/leagues/${leagueId}/speed`),
    enabled: !!leagueId,
  })

  if (!data) return <Empty>Loading speed tiers…</Empty>
  if (data.length === 0) return <Empty>Nothing has been drafted yet.</Empty>

  const teams = [...new Map(data.map((r) => [r.memberId, r.teamName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  )
  const accentOf = new Map(teams.map(([id], i) => [id, TEAM_ACCENTS[i % TEAM_ACCENTS.length]!]))

  const toggle = (id: string) => {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
  }

  const top = data[0]?.base ?? 1
  // Rank is always league-wide — a filtered ladder that renumbers from 1 would
  // answer the wrong question.
  const rankOf = new Map(data.map((r, i) => [`${r.memberId}-${r.speciesId}`, i + 1]))
  const shown = picked.size === 0 ? data : data.filter((r) => picked.has(r.memberId))

  const title =
    picked.size === 0
      ? 'The whole cup'
      : picked.size === 1
        ? (teams.find(([id]) => picked.has(id))?.[1] ?? 'One team')
        : `${picked.size} teams, side by side`

  return (
    <div className="stack reveal" style={{ gap: 14 }}>
      <Card title="Speed tiers" actions={<span className="label">{data.length} mons drafted</span>}>
        <div className="stack" style={{ gap: 10 }}>
          <p className="dim" style={{ margin: 0, fontSize: 13 }}>
            Level 100, 31 IVs / 252 EVs unless the column says otherwise. Pick any number of teams
            to read their ladders against each other; each keeps its own colour.
          </p>
          <div className="wrap-row" style={{ gap: 6 }}>
            <button
              type="button"
              className={picked.size === 0 ? 'chip chip-on' : 'chip'}
              onClick={() => setPicked(new Set())}
            >
              every team
            </button>
            {teams.map(([id, name]) => (
              <button
                key={id}
                type="button"
                aria-pressed={picked.has(id)}
                className={picked.has(id) ? 'chip chip-on' : 'chip'}
                style={{ ['--chip-c' as string]: accentOf.get(id) }}
                onClick={() => toggle(id)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title={title} pad={false}>
        <div className="scroll-x">
          <table className="table speed-table">
            <thead>
              <tr>
                <th className="r" style={{ width: 44 }}>
                  #
                </th>
                <th>Pokémon</th>
                <th className="hide-sm">Team</th>
                <th style={{ width: '22%' }}>Base</th>
                {/* Slowest to fastest, so the row reads as one continuous ramp. */}
                <th className="r" title="0 IVs, 0 EVs, hindering nature">
                  Min
                </th>
                <th className="r">−Nature</th>
                <th className="r">Neutral</th>
                <th className="r">+Nature</th>
                <th className="r">Scarf</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const key = `${r.memberId}-${r.speciesId}`
                const band = bandOf(r.base)
                const first = i === 0 || bandOf(shown[i - 1]!.base) !== band
                return (
                  <Fragment key={key}>
                    {first && (
                      <tr className="band-row">
                        <td colSpan={9}>{band.label}</td>
                      </tr>
                    )}
                    <tr
                      className={picked.has(r.memberId) ? 'speed-mine' : undefined}
                      style={{ ['--team-c' as string]: accentOf.get(r.memberId) }}
                    >
                      <td className="r faint">{rankOf.get(key)}</td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <Sprite species={r.speciesId} size="sm" />
                          <strong style={{ fontSize: 13 }}>{r.name}</strong>
                        </span>
                      </td>
                      <td className="hide-sm faint" style={{ fontSize: 12 }}>
                        {r.teamName}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <span className="speed-track">
                            <span
                              className="speed-fill"
                              style={{ width: `${(r.base / top) * 100}%` }}
                            />
                          </span>
                          <span style={{ fontSize: 13, minWidth: 28 }}>{r.base}</span>
                        </span>
                      </td>
                      {/* The Trick Room floor and the Scarf ceiling bracket the row. */}
                      <td className="r" style={{ color: 'var(--type-psychic)' }}>
                        {r.minimum}
                      </td>
                      <td className="r faint">{r.negative}</td>
                      <td className="r faint">{r.neutral}</td>
                      <td className="r">{r.positive}</td>
                      <td className="r" style={{ color: 'var(--pick)' }}>
                        {r.scarf}
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
