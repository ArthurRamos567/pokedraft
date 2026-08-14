import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { signIn } from '../lib/auth'
import { ErrorBar } from '../ui'

export const Route = createFileRoute('/login')({
  component: Login,
  // `join` is an invite code parked here while the visitor signs in.
  validateSearch: (search: Record<string, unknown>): { join?: string } =>
    typeof search.join === 'string' ? { join: search.join } : {},
})

function Login() {
  const navigate = useNavigate()
  const { join } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="card card-pad stack reveal" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Welcome back</span>
          <h2>Sign in</h2>
        </div>

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            void signIn
              .email({ email, password })
              .then((res) => {
                if (res.error) setError(res.error.message ?? 'could not sign in')
                else if (join) void navigate({ to: '/join/$code', params: { code: join } })
                else void navigate({ to: '/dashboard' })
              })
              .finally(() => setBusy(false))
          }}
        >
          <label className="field">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorBar error={error ? { message: error } : null} />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="dim" style={{ margin: 0, fontSize: 13 }}>
          No account yet?{' '}
          <Link to="/signup" search={{ join }} style={{ color: 'var(--live)' }}>
            Create one
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
