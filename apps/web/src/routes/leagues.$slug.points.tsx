import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { post } from '../lib/api'
import { Badge, Card, ErrorBar } from '../ui'
import { useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/points')({ component: PointsImport })

type Row = {
  input: string
  speciesId: string | null
  name: string | null
  points: number
  status: 'ok' | 'illegal' | 'unknown' | 'duplicate'
  reason?: string
  suggestions?: { id: string; name: string }[]
}

type Preview = {
  hash: string
  nextVersion: number
  summary: { ok: number; illegal: number; unknown: number; duplicates: number }
  diff: {
    added: { speciesId: string; points: number }[]
    removed: { speciesId: string; points: number }[]
    repriced: { speciesId: string; from: number; to: number }[]
  }
  rows: Row[]
}

const SAMPLE = `# name: points — or points: [names], with an optional banned: list
Landorus-Therian: 20
Gholdengo: 19
Toxapex: 15
`

const tone = (s: Row['status']) =>
  s === 'ok' ? 'good' : s === 'unknown' ? 'bad' : s === 'illegal' ? 'live' : 'default'

function PointsImport() {
  const { slug } = Route.useParams()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id

  const [source, setSource] = useState(SAMPLE)
  const [allowIllegal, setAllowIllegal] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [committed, setCommitted] = useState<{ version: number; entryCount: number } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const run = (path: 'preview' | 'commit') => {
    setBusy(true)
    setError(null)
    post<Preview & { version: number; entryCount: number }>(
      `/leagues/${leagueId}/points/${path}`,
      path === 'preview' ? { source, allowIllegal } : { source, allowIllegal, hash: preview?.hash },
    )
      .then((res) => {
        if (path === 'preview') {
          setPreview(res)
          setCommitted(null)
        } else {
          setCommitted({ version: res.version, entryCount: res.entryCount })
          setPreview(null)
        }
      })
      .catch(setError)
      .finally(() => setBusy(false))
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Card title="Import points">
        <div className="stack" style={{ gap: 12 }}>
          <p className="dim" style={{ margin: 0 }}>
            Paste your YAML, or drop the file. Nothing is written until you commit the preview you
            were shown.
          </p>
          <textarea
            className="textarea"
            value={source}
            spellCheck={false}
            onChange={(e) => {
              setSource(e.target.value)
              setPreview(null)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) void file.text().then(setSource)
            }}
          />
          <div className="row-between">
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={allowIllegal}
                onChange={(e) => {
                  setAllowIllegal(e.target.checked)
                  setPreview(null)
                }}
              />
              Keep mons the format bans (some leagues unban on purpose)
            </label>
            <div className="wrap-row">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => run('preview')}
              >
                Preview
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !preview}
                onClick={() => run('commit')}
              >
                Commit v{preview?.nextVersion ?? '?'}
              </button>
            </div>
          </div>
          <ErrorBar error={error} />
          {committed && (
            <div className="badge badge-good" style={{ alignSelf: 'flex-start' }}>
              committed v{committed.version} · {committed.entryCount} entries
            </div>
          )}
        </div>
      </Card>

      {preview && (
        <>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
          >
            {(
              [
                ['Resolved', preview.summary.ok, 'var(--good)'],
                ['Illegal', preview.summary.illegal, 'var(--live)'],
                ['Unknown', preview.summary.unknown, 'var(--bad)'],
                ['Duplicates', preview.summary.duplicates, 'var(--text-2)'],
              ] as const
            ).map(([k, v, c]) => (
              <div key={k} className="card card-pad stack" style={{ gap: 2 }}>
                <span className="label">{k}</span>
                <strong className="num" style={{ fontSize: 26, color: c }}>
                  {v}
                </strong>
              </div>
            ))}
          </div>

          <Card title="Diff">
            <div className="wrap-row" style={{ gap: 16 }}>
              <span className="badge badge-good">+{preview.diff.added.length} added</span>
              <span className="badge badge-bad">−{preview.diff.removed.length} removed</span>
              <span className="badge badge-live">{preview.diff.repriced.length} repriced</span>
            </div>
            {preview.diff.repriced.length > 0 && (
              <table className="table" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Pokémon</th>
                    <th className="r">Was</th>
                    <th className="r">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.diff.repriced.map((r) => (
                    <tr key={r.speciesId}>
                      <td>{r.speciesId}</td>
                      <td className="r faint">{r.from}</td>
                      <td className="r">
                        <span className="cost">{r.to}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Rows" pad={false}>
            <div style={{ maxHeight: 460, overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>From your file</th>
                    <th>Resolved to</th>
                    <th className="r">Points</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={`${r.input}-${r.speciesId ?? 'x'}-${r.points}`}>
                      <td className="num" style={{ fontSize: 12 }}>
                        {r.input}
                      </td>
                      <td>
                        {r.name ?? (
                          <span className="faint">
                            unresolved
                            {r.suggestions?.length ? (
                              <>
                                {' '}
                                — did you mean{' '}
                                <strong style={{ color: 'var(--live)' }}>
                                  {r.suggestions[0]?.name}
                                </strong>
                                ?
                              </>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="r">
                        <span className="cost">{r.points}</span>
                      </td>
                      <td>
                        <Badge tone={tone(r.status)}>{r.status}</Badge>
                        {r.reason && (
                          <span className="faint" style={{ marginLeft: 6, fontSize: 12 }}>
                            {r.reason}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
