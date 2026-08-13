import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { request } from '../lib/api'
import { Card, Empty, Sprite, StatBar } from '../ui'
import { useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/teams')({ component: Teams })

type Team = {
  memberId: string
  teamName: string
  color: string | null
  spent: number
  remaining: number
  roster: { speciesId: string; cost: number; acquired: string }[]
}

function Teams() {
  const { slug } = Route.useParams()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id

  const { data } = useQuery({
    queryKey: ['league', slug, 'teams'],
    queryFn: () => request<Team[]>(`/leagues/${leagueId}/teams`),
    enabled: !!leagueId,
  })

  if (data && data.length === 0) return <Empty>No teams yet.</Empty>

  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
      {(data ?? []).map((t) => (
        <Card
          key={t.memberId}
          title={
            <Link
              to="/leagues/$slug/teams/$memberId"
              params={{ slug, memberId: t.memberId }}
              style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              <span className="label">{t.roster.length} mons</span>
              <h3>{t.teamName}</h3>
            </Link>
          }
          actions={
            <span className="cost" style={{ fontSize: 15 }}>
              {t.remaining}
            </span>
          }
        >
          <div className="stack" style={{ gap: 10 }}>
            <StatBar value={t.spent} max={t.spent + t.remaining} />
            <div className="wrap-row" style={{ gap: 4 }}>
              {t.roster.map((m) => (
                <span
                  key={m.speciesId}
                  className="panel row"
                  style={{ padding: '3px 6px', gap: 4 }}
                  title={`${m.speciesId} · ${m.cost}pts · via ${m.acquired}`}
                >
                  <Sprite species={m.speciesId} size="sm" />
                  <span className="cost">{m.cost}</span>
                </span>
              ))}
              {t.roster.length === 0 && <span className="faint">Empty roster.</span>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
