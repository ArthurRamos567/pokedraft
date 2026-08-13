import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { signUp } from '../lib/auth'
import { ErrorBar } from '../ui'

export const Route = createFileRoute('/signup')({ component: SignUp })

function SignUp() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="card card-pad stack reveal" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Draft night awaits</span>
          <h2>Create an account</h2>
        </div>

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            void signUp
              .email({ email, password, name })
              .then((res) => {
                if (res.error) setError(res.error.message ?? 'could not sign up')
                else void navigate({ to: '/dashboard' })
              })
              .finally(() => setBusy(false))
          }}
        >
          <label className="field">
            <span className="label">Display name</span>
            <input
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
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
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="faint" style={{ fontSize: 12 }}>
              At least 8 characters.
            </span>
          </label>
          <ErrorBar error={error ? { message: error } : null} />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="dim" style={{ margin: 0, fontSize: 13 }}>
          Already have one?{' '}
          <Link to="/login" style={{ color: 'var(--live)' }}>
            Sign in
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
