import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { request } from '../lib/api'
import { Badge, ErrorBar, Skeleton } from '../ui'

export const Route = createFileRoute('/leagues/$slug')({ component: LeagueShell })

export type LeagueView = {
  league: {
    id: string
    slug: string
    name: string
    description: string | null
    status: string
    formatId: string
    hostId: string
    visibility: string
  }
  settings: {
    budget: number
    rosterMin: number
    rosterMax: number
    maxMembers: number
    draftMode: string
    draftType: string
    pickSeconds: number
    turnHours: number
    tradesEnabled: boolean
  } | null
  members: {
    id: string
    userId: string
    role: string
    teamName: string | null
    name: string
    displayName: string | null
    draftPosition: number | null
    status: string
  }[]
  me: { memberId: string; role: string } | null
}

export function useLeague(slug: string) {
  return useQuery({
    queryKey: ['league', slug],
    queryFn: () => request<LeagueView>(`/leagues/${slug}`),
  })
}

export const teamName = (m: LeagueView['members'][number]) => m.teamName ?? m.displayName ?? m.name

const TABS = [
  { to: '.', label: 'Overview', exact: true },
  { to: 'pool', label: 'Pool' },
  { to: 'draft', label: 'Draft' },
  { to: 'teams', label: 'Teams' },
  { to: 'schedule', label: 'Schedule' },
  { to: 'standings', label: 'Standings' },
  { to: 'bracket', label: 'Bracket' },
  { to: 'trades', label: 'Trades' },
] as const

function LeagueShell() {
  const { slug } = Route.useParams()
  const { data, isLoading, error } = useLeague(slug)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  if (isLoading) {
    return (
      <div className="wrap stack">
        <Skeleton h={90} />
        <Skeleton h={320} />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="wrap stack">
        <ErrorBar error={error ?? { message: 'league not found' }} />
        <p className="dim">
          Private leagues are invisible to non-members — if you were invited, use the code.
        </p>
        <Link to="/join" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
          Join with a code
        </Link>
      </div>
    )
  }

  const { league, me } = data
  const base = `/leagues/${slug}`

  return (
    <div className="wrap stack" style={{ gap: 18 }}>
      <header className="stack" style={{ gap: 10 }}>
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <Badge
                tone={league.status === 'drafting' ? 'live' : 'default'}
                live={league.status === 'drafting'}
              >
                {league.status.replace('_', ' ')}
              </Badge>
              <span className="label">{league.formatId}</span>
              {league.visibility === 'private' && <span className="label">private</span>}
            </div>
            <h1 style={{ fontSize: 34 }}>{league.name}</h1>
          </div>
          {me && <span className="label">you are {me.role}</span>}
        </div>

        <nav className="nav" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
          {TABS.map((t) => {
            const href = t.to === '.' ? base : `${base}/${t.to}`
            const active = t.to === '.' ? pathname === base : pathname.startsWith(href)
            return (
              <Link key={t.label} to={href} className={active ? 'active' : ''}>
                {t.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <Outlet />
    </div>
  )
}
