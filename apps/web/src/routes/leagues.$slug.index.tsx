import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { post } from '../lib/api'
import { Avatar, Badge, Card, Dialog, ErrorBar } from '../ui'
import { teamName, useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/')({ component: Overview })

function Overview() {
  const { slug } = Route.useParams()
  const qc = useQueryClient()
  const { data } = useLeague(slug)
  const [invite, setInvite] = useState<{ code: string; url: string } | null>(null)
  const [error, setError] = useState<unknown>(null)

  const isHost = data?.me?.role === 'host' || data?.me?.role === 'cohost'
  const leagueId = data?.league.id

  const makeInvite = useMutation({
    mutationFn: () => post<{ code: string; url: string }>(`/leagues/${leagueId}/invites`, {}),
    onSuccess: setInvite,
    onError: setError,
  })

  const drawOrder = useMutation({
    mutationFn: () => post(`/leagues/${leagueId}/draft-order`, { mode: 'random' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league', slug] }),
    onError: setError,
  })

  const startDraft = useMutation({
    mutationFn: () => post(`/leagues/${leagueId}/draft/start`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league', slug] }),
    onError: setError,
  })

  if (!data) return null
  const { league, settings, members } = data
  const active = members.filter((m) => m.status === 'active')
  const ordered = [...active].sort((a, b) => (a.draftPosition ?? 99) - (b.draftPosition ?? 99))

  return (
    <div className="stack reveal" style={{ gap: 16 }}>
      <ErrorBar error={error} />

      <div
        style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}
      >
        <Card
          title="Teams"
          actions={
            <span className="label">
              {active.length} of {settings?.maxMembers ?? '∞'}
            </span>
          }
        >
          <div className="stack" style={{ gap: 6 }}>
            {ordered.map((m) => (
              <div key={m.id} className="panel row" style={{ padding: '8px 10px', gap: 10 }}>
                <span className="num faint" style={{ width: 22, fontSize: 12 }}>
                  {m.draftPosition ? String(m.draftPosition).padStart(2, '0') : '--'}
                </span>
                <Avatar name={teamName(m)} />
                <div className="stack grow" style={{ gap: 0 }}>
                  <strong style={{ fontSize: 13 }}>{teamName(m)}</strong>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {m.name}
                  </span>
                </div>
                {m.role !== 'player' && <Badge>{m.role}</Badge>}
              </div>
            ))}
          </div>
        </Card>

        <div className="stack" style={{ gap: 16 }}>
          <Card title="Rules">
            {settings ? (
              <dl className="stack" style={{ gap: 8, margin: 0 }}>
                {[
                  ['Budget', `${settings.budget} pts`],
                  ['Roster', `${settings.rosterMin}–${settings.rosterMax}`],
                  ['Draft', `${settings.draftType} · ${settings.draftMode}`],
                  [
                    'Clock',
                    settings.draftMode === 'live'
                      ? `${settings.pickSeconds}s per pick`
                      : `${settings.turnHours}h per turn`,
                  ],
                  ['Trades', settings.tradesEnabled ? 'enabled' : 'off'],
                ].map(([k, v]) => (
                  <div key={k} className="row-between">
                    <dt className="label">{k}</dt>
                    <dd className="num" style={{ margin: 0, fontSize: 13 }}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="dim">No settings.</p>
            )}
          </Card>

          {isHost && (
            <Card title="Host controls">
              <div className="stack" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => makeInvite.mutate()}
                  disabled={makeInvite.isPending}
                >
                  Create invite code
                </button>
                {league.status === 'setup' && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => drawOrder.mutate()}
                      disabled={drawOrder.isPending}
                    >
                      Draw draft order
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => startDraft.mutate()}
                      disabled={startDraft.isPending}
                    >
                      Start the draft
                    </button>
                    <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                      Needs two teams, a drawn order and an imported points list. Starting locks the
                      prices for good.
                    </p>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={!!invite} onClose={() => setInvite(null)} title="Invite code">
        <div className="stack" style={{ gap: 12 }}>
          <p className="dim" style={{ margin: 0 }}>
            Anyone with this code can join while the league is in setup.
          </p>
          <div
            className="panel num"
            style={{ padding: 16, fontSize: 28, letterSpacing: '0.3em', textAlign: 'center' }}
          >
            {invite?.code}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => invite && void navigator.clipboard?.writeText(invite.url)}
          >
            Copy join link
          </button>
        </div>
      </Dialog>
    </div>
  )
}
