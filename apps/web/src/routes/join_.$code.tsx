import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { post } from '../lib/api'
import { useSession } from '../lib/auth'
import { Skeleton } from '../ui'
import { JoinCard } from './join'

export const Route = createFileRoute('/join_/$code')({ component: JoinByLink })

/**
 * The invite URL the API hands out (`WEB_ORIGIN/join/<code>`). A signed-in
 * visitor is joined straight away; anyone else signs in first and comes back
 * here, so the code survives the round trip.
 */
function JoinByLink() {
  const { code } = Route.useParams()
  const navigate = useNavigate()
  const { data: session, isPending } = useSession()
  const [error, setError] = useState<unknown>(null)
  const attempted = useRef(false)

  useEffect(() => {
    if (isPending || !session || attempted.current) return
    attempted.current = true
    post<{ leagueId: string }>(`/leagues/join/${code.trim().toUpperCase()}`, {})
      .then(() => navigate({ to: '/dashboard' }))
      .catch(setError)
  }, [isPending, session, code, navigate])

  if (isPending) {
    return (
      <div className="wrap" style={{ maxWidth: 420 }}>
        <Skeleton h={220} />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="wrap" style={{ maxWidth: 420 }}>
        <div className="card card-pad stack reveal" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Invite {code.toUpperCase()}</span>
            <h2>Sign in to join</h2>
          </div>
          <p className="dim" style={{ margin: 0 }}>
            We will bring you right back to this invite.
          </p>
          <div className="wrap-row">
            <Link to="/login" search={{ join: code }} className="btn btn-primary">
              Sign in
            </Link>
            <Link to="/signup" search={{ join: code }} className="btn btn-ghost">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Joined and redirected, or the code was bad — the form lets them retype it.
  return error ? (
    <JoinCard
      initialCode={code.toUpperCase()}
      eyebrow="That invite did not work"
      initialError={error}
    />
  ) : (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <Skeleton h={220} />
    </div>
  )
}
