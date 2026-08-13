import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { request } from '../lib/api'
import { Card, Empty, Sprite, StatBar, TypeChip } from '../ui'
import { useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/teams/$memberId')({ component: TeamPage })

type Detail = {
  memberId: string
  teamName: string | null
  roster: {
    id: string
    name: string
    types: string[]
    abilities: string[]
    baseStats: Record<string, number>
    bst: number
    cost: number
    acquired: string
  }[]
  spend: { spent: number; remaining: number; budget: number; brackets: Record<string, number> }
  stats: {
    bstAverage: number
    physical: number
    special: number
    mixed: number
    fastest: { name: string } | null
    bulkiest: { name: string } | null
  }
}

type Coverage = {
  types: string[]
  defense: Record<string, { weak: number; neutral: number; resist: number; immune: number }>
  offense: Record<string, { best: number; from: string[] }>
  perMon: { speciesId: string; name: string; types: string[]; matchups: Record<string, number> }[]
  holes: string[]
}

type Speed = {
  speciesId: string
  name: string
  base: number
  neutral: number
  positive: number
  scarf: number
  leaguePercentile: number
}[]

/** The multiplier decides the colour; the number is only confirmation. */
const heatClass = (m: number) =>
  m === 0
    ? 'heat-0'
    : m >= 4
      ? 'heat-4'
      : m > 1
        ? 'heat-2'
        : m === 1
          ? 'heat-1'
          : m > 0.25
            ? 'heat-half'
            : 'heat-quarter'

const fmt = (m: number) => (m === 1 ? '—' : m === 0.5 ? '½' : m === 0.25 ? '¼' : `${m}×`)

function TeamPage() {
  const { slug, memberId } = Route.useParams()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id
  const base = `/leagues/${leagueId}/teams/${memberId}`

  const { data } = useQuery({
    queryKey: ['league', slug, 'team', memberId],
    queryFn: () => request<Detail>(base),
    enabled: !!leagueId,
  })
  const { data: coverage } = useQuery({
    queryKey: ['league', slug, 'team', memberId, 'coverage'],
    queryFn: () => request<Coverage>(`${base}/coverage`),
    enabled: !!leagueId,
  })
  const { data: speed } = useQuery({
    queryKey: ['league', slug, 'team', memberId, 'speed'],
    queryFn: () => request<Speed>(`${base}/speed`),
    enabled: !!leagueId,
  })

  if (!data) return <Empty>Loading team…</Empty>
  if (data.roster.length === 0) return <Empty>This team has not drafted anything yet.</Empty>

  return (
    <div className="stack reveal" style={{ gap: 14 }}>
      <div
        style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}
      >
        <Card
          title={data.teamName ?? 'Team'}
          actions={<span className="label">{data.roster.length} mons</span>}
          pad={false}
        >
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 60 }} />
                  <th>Pokémon</th>
                  <th>Types</th>
                  <th className="hide-sm">Ability</th>
                  <th className="r">Spe</th>
                  <th className="r">BST</th>
                  <th className="r">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.roster.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Sprite species={m.id} />
                    </td>
                    <td>
                      <strong style={{ fontSize: 13 }}>{m.name}</strong>
                      {m.acquired === 'trade' && (
                        <span className="badge" style={{ marginLeft: 6 }}>
                          traded
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 4 }}>
                        {m.types.map((t) => (
                          <TypeChip key={t} type={t} />
                        ))}
                      </span>
                    </td>
                    <td className="hide-sm faint" style={{ fontSize: 12 }}>
                      {m.abilities[0] ?? '—'}
                    </td>
                    <td className="r">{m.baseStats.spe}</td>
                    <td className="r faint">{m.bst}</td>
                    <td className="r">
                      <span className="cost">{m.cost}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="stack" style={{ gap: 14 }}>
          <Card title="Spend">
            <div className="stack" style={{ gap: 10 }}>
              <StatBar label="Used" value={data.spend.spent} max={data.spend.budget} />
              <div className="row-between">
                <span className="label">Remaining</span>
                <span className="cost" style={{ fontSize: 16 }}>
                  {data.spend.remaining}
                </span>
              </div>
              <div className="wrap-row">
                {Object.entries(data.spend.brackets).map(([k, v]) => (
                  <span key={k} className="badge">
                    {k}: {v}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Profile">
            <dl className="stack" style={{ gap: 8, margin: 0 }}>
              {[
                ['Average BST', String(data.stats.bstAverage)],
                ['Physical / special', `${data.stats.physical} / ${data.stats.special}`],
                ['Fastest', data.stats.fastest?.name ?? '—'],
                ['Bulkiest', data.stats.bulkiest?.name ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="row-between">
                  <dt className="label">{k}</dt>
                  <dd style={{ margin: 0, fontSize: 13 }}>{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      {coverage && (
        <Card
          title="Defensive matrix"
          actions={
            coverage.holes.length > 0 ? (
              <span className="badge badge-bad">{coverage.holes.length} unresisted</span>
            ) : (
              <span className="badge badge-good">every type answered</span>
            )
          }
        >
          <div className="stack" style={{ gap: 10 }}>
            <div className="scroll-x">
              <table className="table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Pokémon</th>
                    {coverage.types.map((t) => (
                      <th key={t} className="r" style={{ padding: '8px 5px' }}>
                        {t.slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverage.perMon.map((m) => (
                    <tr key={m.speciesId}>
                      <td style={{ whiteSpace: 'nowrap' }}>{m.name}</td>
                      {coverage.types.map((t) => {
                        const v = m.matchups[t] ?? 1
                        return (
                          <td key={t} style={{ padding: 2 }}>
                            <div className={`heat-cell ${heatClass(v)}`}>{fmt(v)}</div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {coverage.holes.length > 0 && (
              <p className="dim" style={{ margin: 0, fontSize: 13 }}>
                Nothing on this team resists{' '}
                <strong style={{ color: 'var(--bad)' }}>{coverage.holes.join(', ')}</strong>.
              </p>
            )}
          </div>
        </Card>
      )}

      {speed && speed.length > 0 && (
        <Card title="Speed tiers" pad={false}>
          <table className="table">
            <thead>
              <tr>
                <th>Pokémon</th>
                <th className="r">Base</th>
                <th className="r">Neutral</th>
                <th className="r">+Nature</th>
                <th className="r">Scarf</th>
                <th className="r">League %ile</th>
              </tr>
            </thead>
            <tbody>
              {speed.map((s) => (
                <tr key={s.speciesId}>
                  <td>{s.name}</td>
                  <td className="r">{s.base}</td>
                  <td className="r faint">{s.neutral}</td>
                  <td className="r">{s.positive}</td>
                  <td className="r" style={{ color: 'var(--pick)' }}>
                    {s.scarf}
                  </td>
                  <td className="r">{s.leaguePercentile}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
