import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { post, request } from '../lib/api'
import { ErrorBar } from '../ui'

export const Route = createFileRoute('/leagues/new')({ component: NewLeague })

type Format = { id: string; name: string; gen: number }

function NewLeague() {
  const navigate = useNavigate()
  const { data: formats } = useQuery({
    queryKey: ['dex', 'formats'],
    queryFn: () => request<Format[]>('/dex/formats'),
    staleTime: Number.POSITIVE_INFINITY,
  })

  const [name, setName] = useState('')
  const [formatId, setFormatId] = useState('gen9ou')
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  return (
    <div className="wrap" style={{ maxWidth: 620 }}>
      <div className="card card-pad stack reveal" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Step one of many</span>
          <h2>Start a league</h2>
          <p className="dim" style={{ margin: 0 }}>
            You will be the host and a player. Rules, points and the draft order come next.
          </p>
        </div>

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            post<{ slug: string }>('/leagues', {
              name,
              formatId,
              visibility,
              ...(description ? { description } : {}),
            })
              .then((league) => navigate({ to: '/leagues/$slug', params: { slug: league.slug } }))
              .catch(setError)
              .finally(() => setBusy(false))
          }}
        >
          <label className="field">
            <span className="label">League name</span>
            <input
              className="input"
              required
              minLength={3}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="label">Format</span>
            <select
              className="select"
              value={formatId}
              onChange={(e) => setFormatId(e.target.value)}
            >
              {(formats ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <span className="faint" style={{ fontSize: 12 }}>
              Sets the legal pool. It cannot change once points are imported.
            </span>
          </label>

          <label className="field">
            <span className="label">Visibility</span>
            <select
              className="select"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
            >
              <option value="private">Private — invite only, invisible to everyone else</option>
              <option value="public">Public — listed in the directory</option>
            </select>
          </label>

          <label className="field">
            <span className="label">Description</span>
            <textarea
              className="textarea"
              style={{ minHeight: 80, fontFamily: 'var(--body)', fontSize: 14 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <ErrorBar error={error} />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create league'}
          </button>
        </form>
      </div>
    </div>
  )
}
