import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { request } from '../lib/api'
import { Card, Empty, Sprite, TierChip, TypeChip } from '../ui'
import { teamName, useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/pool')({ component: Pool })

type PoolRow = {
  speciesId: string
  points: number
  banned: boolean
  takenBy: string | null
  species: { name: string; types: string[]; bst: number; tier: string | null } | null
}

function Pool() {
  const { slug } = Route.useParams()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id

  const { data } = useQuery({
    queryKey: ['league', slug, 'pool', 'all'],
    queryFn: () => request<PoolRow[]>(`/leagues/${leagueId}/pool?status=all`),
    enabled: !!leagueId,
  })

  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'undrafted'>('all')

  const nameOf = useMemo(() => {
    const map = new Map((league?.members ?? []).map((m) => [m.id, teamName(m)]))
    return (id: string | null) => (id ? (map.get(id) ?? 'taken') : null)
  }, [league])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? [])
      .filter((r) => (only === 'undrafted' ? !r.takenBy : true))
      .filter((r) => !needle || r.speciesId.includes(needle))
      .sort((a, b) => b.points - a.points || a.speciesId.localeCompare(b.speciesId))
  }, [data, q, only])

  if (data && data.length === 0) {
    return <Empty>No points list imported yet. The host imports one before the draft.</Empty>
  }

  return (
    <Card
      title={`Points list · ${rows.length}`}
      pad={false}
      actions={
        <div className="row" style={{ gap: 8 }}>
          <select
            className="select"
            style={{ width: 150, padding: '5px 9px', fontSize: 13 }}
            value={only}
            onChange={(e) => setOnly(e.target.value as 'all' | 'undrafted')}
          >
            <option value="all">Everyone</option>
            <option value="undrafted">Undrafted only</option>
          </select>
          <input
            className="input"
            style={{ width: 180, padding: '5px 9px', fontSize: 13 }}
            placeholder="Filter…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      }
    >
      <div className="scroll-x" style={{ maxHeight: 640, overflowY: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 52 }} />
              <th>Pokémon</th>
              <th>Types</th>
              <th className="hide-sm">Tier</th>
              <th className="r">BST</th>
              <th className="r">Cost</th>
              <th>Drafted by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.speciesId} style={r.takenBy ? { opacity: 0.55 } : undefined}>
                <td>
                  <Sprite species={r.speciesId} size="sm" />
                </td>
                <td>
                  <strong style={{ fontSize: 13 }}>{r.species?.name ?? r.speciesId}</strong>
                  {r.banned && (
                    <span className="badge badge-bad" style={{ marginLeft: 6 }}>
                      banned
                    </span>
                  )}
                </td>
                <td>
                  <span className="row" style={{ gap: 4 }}>
                    {(r.species?.types ?? []).map((t) => (
                      <TypeChip key={t} type={t} />
                    ))}
                  </span>
                </td>
                <td className="hide-sm">
                  {r.species?.tier ? (
                    <TierChip tier={r.species.tier} />
                  ) : (
                    <span className="faint">—</span>
                  )}
                </td>
                <td className="r faint">{r.species?.bst ?? '—'}</td>
                <td className="r">
                  <span className="cost">{r.points}</span>
                </td>
                <td className="dim" style={{ fontSize: 12 }}>
                  {nameOf(r.takenBy) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
