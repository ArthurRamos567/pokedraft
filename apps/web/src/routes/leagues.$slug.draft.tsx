import { remainingBudget, rosterOf, roundOrder } from '@pokedraft/draft'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { post, request } from '../lib/api'
import { useLeagueSocket } from '../lib/socket'
import { Badge, Card, Countdown, Empty, ErrorBar, Sprite, StatBar } from '../ui'
import { teamName, useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/draft')({ component: DraftRoom })

type DraftPayload = {
  id: string
  seq: number
  state: import('@pokedraft/draft').DraftState
  me: {
    memberId: string
    budget: number
    onClock: boolean
    available: { speciesId: string; points: number }[]
  } | null
  pool: { speciesId: string; points: number }[]
}

type PoolRow = {
  speciesId: string
  points: number
  takenBy: string | null
  species: { name: string; types: string[]; bst: number } | null
}

function DraftRoom() {
  const { slug } = Route.useParams()
  const qc = useQueryClient()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id

  const { data, error, isLoading } = useQuery({
    queryKey: ['league', slug, 'draft'],
    queryFn: () => request<DraftPayload>(`/leagues/${leagueId}/draft`),
    enabled: !!leagueId,
  })

  // The socket carries the authoritative state; the fetch is only the seed.
  const live = useLeagueSocket(leagueId)
  const state = live.state ?? data?.state ?? null

  const { data: pool } = useQuery({
    queryKey: ['league', slug, 'pool'],
    queryFn: () => request<PoolRow[]>(`/leagues/${leagueId}/pool`),
    enabled: !!leagueId,
  })

  const [q, setQ] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)

  const pick = useMutation({
    mutationFn: (speciesId: string) => post(`/leagues/${leagueId}/draft/pick`, { speciesId }),
    onMutate: (speciesId) => {
      setActionError(null)
      setPending(speciesId)
    },
    onError: setActionError,
    onSettled: () => {
      setPending(null)
      void qc.invalidateQueries({ queryKey: ['league', slug] })
    },
  })

  const myMemberId = league?.me?.memberId ?? null
  const onClock = state?.onClock ?? null
  const isMyTurn = !!myMemberId && onClock === myMemberId

  const nameOf = useMemo(() => {
    const map = new Map((league?.members ?? []).map((m) => [m.id, teamName(m)]))
    return (id: string | null) => (id ? (map.get(id) ?? '—') : '—')
  }, [league])

  const speciesOf = useMemo(() => {
    const map = new Map((pool ?? []).map((p) => [p.speciesId, p]))
    return (id: string) => map.get(id) ?? null
  }, [pool])

  const affordable = useMemo(() => {
    if (!state || !myMemberId) return new Set<string>()
    const budget = remainingBudget(state, myMemberId)
    return new Set(
      (pool ?? [])
        .filter((p) => !p.takenBy && !(p.speciesId in state.taken) && p.points <= budget)
        .map((p) => p.speciesId),
    )
  }, [state, myMemberId, pool])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (pool ?? [])
      .filter((p) => !state || !(p.speciesId in state.taken))
      .filter((p) => !needle || p.speciesId.includes(needle))
      .sort((a, b) => b.points - a.points || a.speciesId.localeCompare(b.speciesId))
      .slice(0, 120)
  }, [pool, q, state])

  if (isLoading) return <Empty>Loading the room…</Empty>
  if (error || !state) {
    return (
      <div className="stack">
        <ErrorBar error={error ?? { message: 'no draft yet' }} />
        <Empty>The host has not started the draft.</Empty>
      </div>
    )
  }

  const budget = myMemberId ? remainingBudget(state, myMemberId) : 0
  const myRoster = myMemberId ? rosterOf(state, myMemberId) : []
  const totalRounds = state.config.rosterMax

  return (
    <div className="stack" style={{ gap: 14 }}>
      {/* ── the strip: who is up, how long they have ────────────────────── */}
      <div className="card card-pad row-between" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 14 }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="label">On the clock</span>
            <strong style={{ fontSize: 20, fontFamily: 'var(--display)' }}>
              {state.status === 'complete' ? 'Draft complete' : nameOf(onClock)}
            </strong>
          </div>
          {isMyTurn && state.status === 'active' && (
            <Badge tone="live" live>
              your pick
            </Badge>
          )}
          {state.status === 'paused' && <Badge tone="bad">paused</Badge>}
        </div>

        <div className="row" style={{ gap: 20 }}>
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            <span className="label">Round</span>
            <span className="num" style={{ fontSize: 15 }}>
              {Math.min(state.round + 1, totalRounds)} / {totalRounds}
            </span>
          </div>
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            <span className="label">Pick</span>
            <span className="num" style={{ fontSize: 15 }}>
              {state.pickNo + 1}
            </span>
          </div>
          <Countdown deadline={state.deadline} />
          <span className={`badge${live.connected ? ' badge-good' : ' badge-bad'}`}>
            <i className="dot" />
            {live.connected ? 'live' : 'reconnecting'}
          </span>
        </div>
      </div>

      <ErrorBar error={actionError} />

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr) 300px' }}>
        {/* ── the pool ─────────────────────────────────────────────────── */}
        <Card
          title="Available"
          actions={
            <input
              className="input"
              style={{ width: 180, padding: '5px 9px', fontSize: 13 }}
              placeholder="Filter…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          }
          pad={false}
        >
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 52 }} />
                  <th>Pokémon</th>
                  <th className="hide-sm">Types</th>
                  <th className="r">BST</th>
                  <th className="r">Cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const can = isMyTurn && state.status === 'active' && affordable.has(p.speciesId)
                  return (
                    <tr key={p.speciesId}>
                      <td>
                        <Sprite species={p.speciesId} size="sm" />
                      </td>
                      <td>
                        <strong style={{ fontSize: 13 }}>{p.species?.name ?? p.speciesId}</strong>
                      </td>
                      <td className="hide-sm">
                        <span className="row" style={{ gap: 4 }}>
                          {(p.species?.types ?? []).map((t) => (
                            <span
                              key={t}
                              className="type"
                              style={{ ['--tc' as string]: `var(--type-${t.toLowerCase()})` }}
                            >
                              {t.slice(0, 3)}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="r faint">{p.species?.bst ?? '—'}</td>
                      <td className="r">
                        <span className="cost">{p.points}</span>
                      </td>
                      <td className="r">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={!can || pick.isPending}
                          onClick={() => pick.mutate(p.speciesId)}
                        >
                          {pending === p.speciesId ? '…' : 'Draft'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {visible.length === 0 && <Empty>Nothing matches that filter.</Empty>}
          </div>
        </Card>

        {/* ── my team ──────────────────────────────────────────────────── */}
        <div className="stack" style={{ gap: 14 }}>
          <Card title="My team">
            <div className="stack" style={{ gap: 12 }}>
              <StatBar
                label="Budget spent"
                value={state.config.budget - budget}
                max={state.config.budget}
              />
              <div className="row-between">
                <span className="label">Remaining</span>
                <span className="cost" style={{ fontSize: 16 }}>
                  {budget}
                </span>
              </div>
              <div className="stack" style={{ gap: 5 }}>
                {myRoster.length === 0 && <span className="faint">No picks yet.</span>}
                {myRoster.map((id) => {
                  const s = speciesOf(id)
                  return (
                    <div key={id} className="panel row" style={{ padding: '5px 8px', gap: 8 }}>
                      <Sprite species={id} size="sm" />
                      <span className="grow" style={{ fontSize: 13 }}>
                        {s?.species?.name ?? id}
                      </span>
                      <span className="cost">{s?.points ?? ''}</span>
                    </div>
                  )
                })}
              </div>
              {isMyTurn && state.status === 'active' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setActionError(null)
                    post(`/leagues/${leagueId}/draft/skip`, {}).catch(setActionError)
                  }}
                >
                  Skip my turn
                </button>
              )}
            </div>
          </Card>

          <Card title="Room">
            <div className="stack" style={{ gap: 5 }}>
              {(league?.members ?? [])
                .filter((m) => m.status === 'active')
                .map((m) => (
                  <div key={m.id} className="row" style={{ gap: 8 }}>
                    <i
                      className="dot"
                      style={{
                        animation: 'none',
                        color: live.presence.includes(m.id) ? 'var(--good)' : 'var(--text-3)',
                      }}
                    />
                    <span style={{ fontSize: 13 }} className={m.id === onClock ? '' : 'dim'}>
                      {teamName(m)}
                    </span>
                    {m.id === onClock && (
                      <span className="label" style={{ color: 'var(--live)' }}>
                        up
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ── the board ────────────────────────────────────────────────────── */}
      <Card title="Board" pad={false}>
        <div className="scroll-x" style={{ padding: 12 }}>
          <div
            className="board"
            style={{ gridTemplateColumns: `repeat(${state.order.length}, minmax(130px, 1fr))` }}
          >
            {Array.from({ length: totalRounds }, (_, i) => i).flatMap((round) =>
              roundOrder(state.order, round, state.config.type).map((memberId) => {
                const entry = state.teams[memberId]?.picks.find((p) => p.round === round)
                const isNow = state.onClock === memberId && state.round === round && !entry
                const species = entry ? speciesOf(entry.speciesId) : null
                return (
                  <div
                    key={`${round}-${memberId}`}
                    className={`board-cell${entry ? ' filled' : isNow ? ' onclock' : ' empty'}`}
                  >
                    <div className="row-between">
                      <span className="label">
                        {round + 1}.{String(state.order.indexOf(memberId) + 1).padStart(2, '0')}
                      </span>
                      {entry && <span className="cost">{entry.cost}</span>}
                    </div>
                    {entry ? (
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {species?.species?.name ?? entry.speciesId}
                      </span>
                    ) : (
                      <span className="faint" style={{ fontSize: 11 }}>
                        {nameOf(memberId)}
                      </span>
                    )}
                  </div>
                )
              }),
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
