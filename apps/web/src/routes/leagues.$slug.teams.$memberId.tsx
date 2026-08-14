import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { API_URL, request } from '../lib/api'
import { Card, Empty, Sprite, StatBar, TierChip, TypeChip } from '../ui'
import { useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/teams/$memberId')({ component: TeamPage })

type Mon = {
  id: string
  name: string
  types: string[]
  abilities: string[]
  baseStats: Record<string, number>
  bst: number
  tier: string | null
  cost: number
  acquired: string
  smogonUrl: string
}

type Detail = {
  memberId: string
  teamName: string | null
  roster: Mon[]
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

const STATS = [
  ['hp', 'HP'],
  ['atk', 'Atk'],
  ['def', 'Def'],
  ['spa', 'SpA'],
  ['spd', 'SpD'],
  ['spe', 'Spe'],
] as const

/** Smogon's scale: a bar is read against 255, and the hue carries the verdict. */
function statTone(v: number) {
  const hue = Math.min(v, 160) / 160 // 160 is roughly where a stat stops being notable
  return `hsl(${Math.round(hue * 122)} 62% ${42 + hue * 8}%)`
}

function StatSpread({ mon }: { mon: Mon }) {
  return (
    <div className="statgrid">
      {STATS.map(([key, label]) => {
        const v = mon.baseStats[key] ?? 0
        return (
          <div key={key} className="stat">
            <span className="stat-key">{label}</span>
            <span className="stat-val">{v}</span>
            <span className="stat-track">
              <span
                className="stat-fill"
                style={{ width: `${Math.min(100, (v / 255) * 100)}%`, background: statTone(v) }}
              />
            </span>
          </div>
        )
      })}
      <div className="stat stat-bst">
        <span className="stat-key">BST</span>
        <span className="stat-val">{mon.bst}</span>
        <span className="stat-track">
          <span
            className="stat-fill"
            style={{
              width: `${Math.min(100, (mon.bst / 720) * 100)}%`,
              background: 'var(--text-3)',
            }}
          />
        </span>
      </div>
    </div>
  )
}

function MonRow({ mon }: { mon: Mon }) {
  return (
    <article className="mon-row">
      <div className="mon-id">
        <Sprite species={mon.id} size="lg" />
        <div className="stack" style={{ gap: 5, minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <a className="mon-name" href={mon.smogonUrl} target="_blank" rel="noreferrer">
              {mon.name}
              <span aria-hidden> ↗</span>
            </a>
            {mon.tier && <TierChip tier={mon.tier} />}
            {mon.acquired === 'trade' && <span className="badge">traded</span>}
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {mon.types.map((t) => (
              <TypeChip key={t} type={t} />
            ))}
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {mon.abilities.map((a, i) => (
              <span
                key={a}
                className={i === mon.abilities.length - 1 && i > 0 ? 'abil abil-h' : 'abil'}
              >
                {a}
              </span>
            ))}
          </div>
        </div>
        <span className="cost mon-cost">{mon.cost}</span>
      </div>
      <StatSpread mon={mon} />
    </article>
  )
}

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
          <div className="mon-list">
            {data.roster.map((m) => (
              <MonRow key={m.id} mon={m} />
            ))}
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

          <Card title="Export">
            <div className="stack" style={{ gap: 8 }}>
              <p className="dim" style={{ margin: 0, fontSize: 13 }}>
                A paste skeleton for the teambuilder — species, ability and typing only.
              </p>
              <a className="btn" href={`${API_URL}${base}/export`} target="_blank" rel="noreferrer">
                Open Showdown paste
              </a>
            </div>
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
          </div>
        </Card>
      )}
    </div>
  )
}
