import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { request } from '../lib/api'
import { Badge, Empty, ErrorBar, Skeleton } from '../ui'

export const Route = createFileRoute('/dashboard')({ component: Dashboard })

type Mine = {
  id: string
  slug: string
  name: string
  status: string
  formatId: string
  visibility: string
  role: string
  teamName: string | null
}

function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['leagues', 'mine'],
    queryFn: () => request<Mine[]>('/leagues/mine'),
  })

  return (
    <div className="wrap stack reveal" style={{ gap: 20 }}>
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Signed in</span>
          <h1 style={{ fontSize: 32 }}>My leagues</h1>
        </div>
        <div className="wrap-row">
          <Link to="/join" className="btn btn-ghost">
            Join with a code
          </Link>
          <Link to="/leagues/new" className="btn btn-primary">
            Start a league
          </Link>
        </div>
      </div>

      <ErrorBar error={error} />

      {isLoading ? (
        <div className="grid">
          {[0, 1].map((i) => (
            <Skeleton key={i} h={120} />
          ))}
        </div>
      ) : !data?.length ? (
        <Empty>
          You are not in a league yet.{' '}
          <Link to="/leagues" style={{ color: 'var(--live)' }}>
            Browse the public ones
          </Link>{' '}
          or start your own.
        </Empty>
      ) : (
        <div className="grid">
          {data.map((l) => (
            <Link
              key={l.id}
              to="/leagues/$slug"
              params={{ slug: l.slug }}
              className="card card-pad stack"
              style={{ gap: 10 }}
            >
              <div className="row-between">
                <Badge
                  tone={l.status === 'drafting' ? 'live' : 'default'}
                  live={l.status === 'drafting'}
                >
                  {l.status.replace('_', ' ')}
                </Badge>
                <span className="label">{l.role}</span>
              </div>
              <h3>{l.name}</h3>
              <div className="row-between">
                <span className="dim" style={{ fontSize: 13 }}>
                  {l.teamName ?? 'Unnamed team'}
                </span>
                <span className="label">{l.formatId}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
