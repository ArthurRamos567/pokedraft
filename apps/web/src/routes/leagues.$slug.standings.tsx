import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { request } from '../lib/api'
import { Card, Empty } from '../ui'
import { teamName, useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/standings')({ component: Standings })

type Row = {
  memberId: string
  played: number
  wins: number
  losses: number
  scoreFor: number
  scoreAgainst: number
  differential: number
  kills: number
}

function Standings() {
  const { slug } = Route.useParams()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id

  const { data } = useQuery({
    queryKey: ['league', slug, 'standings'],
    queryFn: () => request<Row[]>(`/leagues/${leagueId}/standings`),
    enabled: !!leagueId,
  })

  const nameOf = useMemo(() => {
    const map = new Map((league?.members ?? []).map((m) => [m.id, teamName(m)]))
    return (id: string) => map.get(id) ?? '—'
  }, [league])

  if (!data?.length) return <Empty>No season yet.</Empty>
  const played = data.some((r) => r.played > 0)

  return (
    <Card
      title="Standings"
      pad={false}
      actions={<span className="label">{played ? 'live' : 'not started'}</span>}
    >
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>#</th>
            <th>Team</th>
            <th className="r">W</th>
            <th className="r">L</th>
            <th className="r hide-sm">GP</th>
            <th className="r hide-sm">For</th>
            <th className="r hide-sm">Agst</th>
            <th className="r">Diff</th>
            <th className="r hide-sm">KOs</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={r.memberId}>
              <td className="num faint">{i + 1}</td>
              <td>
                <strong style={{ fontSize: 13 }}>{nameOf(r.memberId)}</strong>
              </td>
              <td className="r" style={{ color: 'var(--good)' }}>
                {r.wins}
              </td>
              <td className="r" style={{ color: 'var(--bad)' }}>
                {r.losses}
              </td>
              <td className="r hide-sm faint">{r.played}</td>
              <td className="r hide-sm faint">{r.scoreFor}</td>
              <td className="r hide-sm faint">{r.scoreAgainst}</td>
              <td
                className="r"
                style={{ color: r.differential >= 0 ? 'var(--good)' : 'var(--bad)' }}
              >
                {r.differential > 0 ? '+' : ''}
                {r.differential}
              </td>
              <td className="r hide-sm">{r.kills || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
