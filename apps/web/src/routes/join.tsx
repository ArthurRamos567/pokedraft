import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { post } from '../lib/api'
import { ErrorBar } from '../ui'

export const Route = createFileRoute('/join')({ component: JoinByCode })

function JoinByCode() {
  return <JoinCard />
}

/** Shared with `/join/$code`, which arrives from an invite link with the code filled in. */
export function JoinCard({
  initialCode = '',
  eyebrow = 'Someone sent you a code',
  initialError = null,
}: {
  initialCode?: string
  eyebrow?: string
  initialError?: unknown
}) {
  const navigate = useNavigate()
  const [code, setCode] = useState(initialCode)
  const [error, setError] = useState<unknown>(initialError)
  const [busy, setBusy] = useState(false)

  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="card card-pad stack reveal" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">{eyebrow}</span>
          <h2>Join a league</h2>
        </div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            post<{ leagueId: string }>(`/leagues/join/${code.trim().toUpperCase()}`, {})
              .then(() => navigate({ to: '/dashboard' }))
              .catch(setError)
              .finally(() => setBusy(false))
          }}
        >
          <label className="field">
            <span className="label">Invite code</span>
            <input
              className="input num"
              style={{ letterSpacing: '0.25em', textTransform: 'uppercase', fontSize: 18 }}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCD2345"
            />
          </label>
          <ErrorBar error={error} />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </form>
      </div>
    </div>
  )
}
