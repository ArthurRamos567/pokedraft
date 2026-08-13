import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { post, request } from '../lib/api'
import { Badge, Card, Dialog, Empty, ErrorBar } from '../ui'
import { teamName, useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/schedule')({ component: Schedule })

type Matchup = {
  id: string
  homeMemberId: string
  awayMemberId: string | null
  status: string
  winnerMemberId: string | null
  homeScore: number
  awayScore: number
  replayUrl: string | null
}
type Sched = {
  season: { id: string; status: string } | null
  weeks: { id: string; number: number; status: string; matchups: Matchup[] }[]
}

const tone = (s: string) =>
  s === 'confirmed' ? 'good' : s === 'disputed' ? 'bad' : s === 'reported' ? 'live' : 'default'

function Schedule() {
  const { slug } = Route.useParams()
  const qc = useQueryClient()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id
  const myId = league?.me?.memberId ?? null

  const { data } = useQuery({
    queryKey: ['league', slug, 'schedule'],
    queryFn: () => request<Sched>(`/leagues/${leagueId}/schedule`),
    enabled: !!leagueId,
  })

  const [reporting, setReporting] = useState<Matchup | null>(null)
  const [error, setError] = useState<unknown>(null)

  const nameOf = useMemo(() => {
    const map = new Map((league?.members ?? []).map((m) => [m.id, teamName(m)]))
    return (id: string | null) => (id ? (map.get(id) ?? '—') : 'bye')
  }, [league])

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'confirm' | 'dispute' }) =>
      post(`/leagues/${leagueId}/matchups/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league', slug, 'schedule'] }),
    onError: setError,
  })

  if (!data?.season) return <Empty>No season generated yet.</Empty>

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorBar error={error} />
      {data.weeks.map((w) => (
        <Card
          key={w.id}
          title={`Week ${w.number}`}
          actions={<span className="label">{w.status}</span>}
          pad={false}
        >
          <table className="table">
            <tbody>
              {w.matchups.map((m) => {
                const mine = myId === m.homeMemberId || myId === m.awayMemberId
                const canReport = mine && m.awayMemberId && m.status !== 'confirmed'
                return (
                  <tr key={m.id}>
                    <td style={{ width: '38%' }}>
                      <strong
                        style={{
                          fontSize: 13,
                          color: m.winnerMemberId === m.homeMemberId ? 'var(--good)' : undefined,
                        }}
                      >
                        {nameOf(m.homeMemberId)}
                      </strong>
                    </td>
                    <td className="r num" style={{ width: 60 }}>
                      {m.status === 'confirmed' || m.status === 'reported'
                        ? `${m.homeScore}–${m.awayScore}`
                        : 'vs'}
                    </td>
                    <td style={{ width: '38%' }}>
                      <strong
                        style={{
                          fontSize: 13,
                          color: m.winnerMemberId === m.awayMemberId ? 'var(--good)' : undefined,
                        }}
                      >
                        {nameOf(m.awayMemberId)}
                      </strong>
                    </td>
                    <td className="r">
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {m.replayUrl && (
                          <a
                            className="label"
                            style={{ color: 'var(--pick)' }}
                            href={`https://replay.pokemonshowdown.com/${m.replayUrl}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            replay
                          </a>
                        )}
                        <Badge tone={tone(m.status)}>{m.status}</Badge>
                        {canReport && m.status === 'scheduled' && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setReporting(m)}
                          >
                            Report
                          </button>
                        )}
                        {mine && m.status === 'reported' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => respond.mutate({ id: m.id, action: 'confirm' })}
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => respond.mutate({ id: m.id, action: 'dispute' })}
                            >
                              Dispute
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      ))}

      {reporting && (
        <ReportDialog
          matchup={reporting}
          leagueId={leagueId!}
          nameOf={nameOf}
          onClose={() => setReporting(null)}
          onDone={() => {
            setReporting(null)
            void qc.invalidateQueries({ queryKey: ['league', slug, 'schedule'] })
          }}
        />
      )}
    </div>
  )
}

function ReportDialog({
  matchup,
  leagueId,
  nameOf,
  onClose,
  onDone,
}: {
  matchup: Matchup
  leagueId: string
  nameOf: (id: string | null) => string
  onClose: () => void
  onDone: () => void
}) {
  const [winner, setWinner] = useState(matchup.homeMemberId)
  const [homeScore, setHomeScore] = useState(0)
  const [awayScore, setAwayScore] = useState(0)
  const [replay, setReplay] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open onClose={onClose} title="Report result">
      <div className="stack" style={{ gap: 12 }}>
        <label className="field">
          <span className="label">Winner</span>
          <select className="select" value={winner} onChange={(e) => setWinner(e.target.value)}>
            <option value={matchup.homeMemberId}>{nameOf(matchup.homeMemberId)}</option>
            <option value={matchup.awayMemberId ?? ''}>{nameOf(matchup.awayMemberId)}</option>
          </select>
        </label>
        <div className="row" style={{ gap: 10 }}>
          <label className="field grow">
            <span className="label">{nameOf(matchup.homeMemberId)} mons left</span>
            <input
              className="input num"
              type="number"
              min={0}
              max={12}
              value={homeScore}
              onChange={(e) => setHomeScore(Number(e.target.value))}
            />
          </label>
          <label className="field grow">
            <span className="label">{nameOf(matchup.awayMemberId)} mons left</span>
            <input
              className="input num"
              type="number"
              min={0}
              max={12}
              value={awayScore}
              onChange={(e) => setAwayScore(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="field">
          <span className="label">Replay link (optional)</span>
          <input
            className="input"
            placeholder="https://replay.pokemonshowdown.com/…"
            value={replay}
            onChange={(e) => setReplay(e.target.value)}
          />
          <span className="faint" style={{ fontSize: 12 }}>
            Stored as evidence for a dispute. Not parsed.
          </span>
        </label>
        <ErrorBar error={error} />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            post(`/leagues/${leagueId}/matchups/${matchup.id}/report`, {
              winnerMemberId: winner,
              homeScore,
              awayScore,
              ...(replay ? { replayUrl: replay } : {}),
            })
              .then(onDone)
              .catch(setError)
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Reporting…' : 'Submit — your opponent confirms'}
        </button>
      </div>
    </Dialog>
  )
}
