import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { request } from '../lib/api'
import { Card, Empty } from '../ui'
import { teamName, useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/bracket')({ component: Bracket })

type Tree = {
  type: string
  size: number
  status: string
  championMemberId: string | null
  rounds: {
    round: number
    matches: {
      slot: string
      side: string
      homeMemberId: string | null
      awayMemberId: string | null
      homeSeed: number | null
      awaySeed: number | null
      winnerMemberId: string | null
    }[]
  }[]
}

function Bracket() {
  const { slug } = Route.useParams()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id

  const { data, error } = useQuery({
    queryKey: ['league', slug, 'playoffs'],
    queryFn: () => request<Tree>(`/leagues/${leagueId}/playoffs`),
    enabled: !!leagueId,
    retry: false,
  })

  const nameOf = useMemo(() => {
    const map = new Map((league?.members ?? []).map((m) => [m.id, teamName(m)]))
    return (id: string | null) => (id ? (map.get(id) ?? '—') : null)
  }, [league])

  if (error || !data) return <Empty>No bracket yet. The host cuts one when the season ends.</Empty>

  return (
    <Card
      title={`Playoffs · ${data.type.replace('_', ' ')}`}
      pad={false}
      actions={
        data.championMemberId ? (
          <span className="badge badge-good">champion: {nameOf(data.championMemberId)}</span>
        ) : (
          <span className="label">{data.status}</span>
        )
      }
    >
      <div className="bracket" style={{ padding: '14px 16px' }}>
        {data.rounds.map((r) => (
          <div key={r.round} className="bracket-round">
            <span className="label" style={{ textAlign: 'center' }}>
              Round {r.round}
            </span>
            {r.matches.map((m) => (
              <div key={m.slot} className="bracket-match">
                {(
                  [
                    ['home', m.homeMemberId, m.homeSeed],
                    ['away', m.awayMemberId, m.awaySeed],
                  ] as const
                ).map(([side, id, seed]) => {
                  const decided = !!m.winnerMemberId
                  const won = decided && m.winnerMemberId === id
                  return (
                    <div
                      key={`${m.slot}-${side}`}
                      className={`bracket-slot${won ? ' won' : decided ? ' lost' : ''}`}
                    >
                      <span className="bracket-seed">{seed ?? '·'}</span>
                      <span className="grow">
                        {nameOf(id) ?? <span className="faint">TBD</span>}
                      </span>
                      {won && (
                        <span className="label" style={{ color: 'var(--good)' }}>
                          W
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  )
}
