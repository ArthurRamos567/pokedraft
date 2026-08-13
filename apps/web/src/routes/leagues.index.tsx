import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { request } from '../lib/api'
import { Badge, Empty, ErrorBar, Skeleton } from '../ui'

export const Route = createFileRoute('/leagues/')({ component: Directory })

type Row = {
  id: string
  slug: string
  name: string
  description: string | null
  status: string
  formatId: string
  memberCount: number
  maxMembers: number | null
}

function Directory() {
  const [q, setQ] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['leagues', 'public', q],
    queryFn: () =>
      request<{ items: Row[]; total: number }>(
        `/leagues?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
  })

  return (
    <div className="wrap stack reveal" style={{ gap: 20 }}>
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Open to join</span>
          <h1 style={{ fontSize: 32 }}>Public leagues</h1>
        </div>
        <Link to="/leagues/new" className="btn btn-primary">
          Start a league
        </Link>
      </div>

      <input
        className="input"
        placeholder="Search by name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ maxWidth: 320 }}
      />

      <ErrorBar error={error} />

      {isLoading ? (
        <div className="grid">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={130} />
          ))}
        </div>
      ) : !data?.items.length ? (
        <Empty>
          No public leagues yet.{' '}
          <Link to="/leagues/new" style={{ color: 'var(--live)' }}>
            Start the first one.
          </Link>
        </Empty>
      ) : (
        <div className="grid">
          {data.items.map((l) => (
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
                <span className="label">{l.formatId}</span>
              </div>
              <h3>{l.name}</h3>
              <p className="dim" style={{ margin: 0, fontSize: 13, minHeight: 20 }}>
                {l.description ?? 'No description.'}
              </p>
              <div className="row-between">
                <span className="num faint" style={{ fontSize: 12 }}>
                  {l.memberCount}/{l.maxMembers ?? '∞'} teams
                </span>
                <span className="label" style={{ color: 'var(--live)' }}>
                  view →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
