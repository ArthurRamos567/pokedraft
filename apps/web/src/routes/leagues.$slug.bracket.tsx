import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { post, request } from '../lib/api'
import { Card, Empty, ErrorBar } from '../ui'
import { teamName, useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/bracket')({ component: Bracket })

type Tree = {
  type: string
  size: number
  status: string
  championMemberId: string | null
  rounds: {
    round: number
    matches: {
      slot: string
      side: string
      homeMemberId: string | null
      awayMemberId: string | null
      homeSeed: number | null
      awaySeed: number | null
      winnerMemberId: string | null
    }[]
  }[]
}

type GenerateInput = {
  type: 'single_elim' | 'double_elim'
  size: number
  thirdPlace: boolean
  bracketReset: boolean
  force: boolean
}

type PlayoffPreview = {
  hash: string
  bracket: { type: string; size: number; matches: { slot: string }[] }
  standings: { memberId: string; wins: number; losses: number }[]
}

function Bracket() {
  const { slug } = Route.useParams()
  const qc = useQueryClient()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id
  const isHost = league?.me?.role === 'host' || league?.me?.role === 'cohost'

  const { data, error } = useQuery({
    queryKey: ['league', slug, 'playoffs'],
    queryFn: () => request<Tree>(`/leagues/${leagueId}/playoffs`),
    enabled: !!leagueId,
    retry: false,
  })

  const nameOf = useMemo(() => {
    const map = new Map((league?.members ?? []).map((m) => [m.id, teamName(m)]))
    return (id: string | null) => (id ? (map.get(id) ?? '—') : null)
  }, [league])

  const [actionError, setActionError] = useState<unknown>(null)

  const setWinner = useMutation({
    mutationFn: ({ slot, winnerMemberId }: { slot: string; winnerMemberId: string }) =>
      post(`/leagues/${leagueId}/playoffs/matches/${slot}/result`, { winnerMemberId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league', slug, 'playoffs'] }),
    onError: setActionError,
  })

  if (error || !data) {
    return isHost ? (
      <CutPlayoffs slug={slug} leagueId={leagueId} leagueStatus={league?.league.status} />
    ) : (
      <Empty>No bracket yet. The host cuts one when the season ends.</Empty>
    )
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorBar error={actionError} />
      <Card
        title={`Playoffs · ${data.type.replace('_', ' ')}`}
        pad={false}
        actions={
          data.championMemberId ? (
            <span className="badge badge-good">champion: {nameOf(data.championMemberId)}</span>
          ) : (
            <span className="label">{data.status}</span>
          )
        }
      >
        <div className="bracket" style={{ padding: '14px 16px' }}>
          {data.rounds.map((r) => (
            <div key={r.round} className="bracket-round">
              <span className="label" style={{ textAlign: 'center' }}>
                Round {r.round}
              </span>
              {r.matches.map((m) => {
                // Both sides known and nothing decided yet — the host can call it.
                const callable = isHost && !m.winnerMemberId && !!m.homeMemberId && !!m.awayMemberId
                return (
                  <div key={m.slot} className="bracket-match">
                    {(
                      [
                        ['home', m.homeMemberId, m.homeSeed],
                        ['away', m.awayMemberId, m.awaySeed],
                      ] as const
                    ).map(([side, id, seed]) => {
                      const decided = !!m.winnerMemberId
                      const won = decided && m.winnerMemberId === id
                      const slotBody = (
                        <>
                          <span className="bracket-seed">{seed ?? '·'}</span>
                          <span className="grow">
                            {nameOf(id) ?? <span className="faint">TBD</span>}
                          </span>
                          {won && (
                            <span className="label" style={{ color: 'var(--good)' }}>
                              W
                            </span>
                          )}
                        </>
                      )
                      const className = `bracket-slot${won ? ' won' : decided ? ' lost' : ''}`
                      return callable && id ? (
                        <button
                          key={`${m.slot}-${side}`}
                          type="button"
                          className={className}
                          style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                          title="Advance this team"
                          disabled={setWinner.isPending}
                          onClick={() => setWinner.mutate({ slot: m.slot, winnerMemberId: id })}
                        >
                          {slotBody}
                        </button>
                      ) : (
                        <div key={`${m.slot}-${side}`} className={className}>
                          {slotBody}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </Card>
      {isHost && !data.championMemberId && (
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          Click a team to advance it. Results cascade — clearing one later replays everything
          downstream.
        </p>
      )}
    </div>
  )
}

/** Preview then commit, same contract as points and the schedule. */
function CutPlayoffs({
  slug,
  leagueId,
  leagueStatus,
}: {
  slug: string
  leagueId?: string
  leagueStatus?: string
}) {
  const qc = useQueryClient()
  const [input, setInput] = useState<GenerateInput>({
    type: 'single_elim',
    size: 4,
    thirdPlace: false,
    bracketReset: false,
    force: false,
  })
  const [preview, setPreview] = useState<PlayoffPreview | null>(null)
  const [error, setError] = useState<unknown>(null)

  const edit = (patch: Partial<GenerateInput>) => {
    setInput((prev) => ({ ...prev, ...patch }))
    setPreview(null)
  }

  const run = useMutation({
    mutationFn: (path: 'preview' | 'commit') =>
      post<PlayoffPreview>(`/leagues/${leagueId}/playoffs/${path}`, {
        ...input,
        ...(path === 'commit' ? { hash: preview?.hash } : {}),
      }).then((res) => ({ path, res })),
    onMutate: () => setError(null),
    onSuccess: ({ path, res }) => {
      if (path === 'preview') setPreview(res)
      else void qc.invalidateQueries({ queryKey: ['league', slug] })
    },
    onError: setError,
  })

  const nameOf = useNames(slug)

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Card title="Cut the playoffs">
        <div className="stack" style={{ gap: 12 }}>
          <p className="dim" style={{ margin: 0 }}>
            Seeds come from the standings and freeze the moment you commit. Nothing is written until
            then.
          </p>

          <div className="wrap-row" style={{ gap: 16 }}>
            <label className="field" style={{ maxWidth: 160 }}>
              <span className="label">Teams</span>
              <select
                className="select"
                value={input.size}
                onChange={(e) => edit({ size: Number(e.target.value) })}
              >
                {[2, 4, 8, 16].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ maxWidth: 200 }}>
              <span className="label">Format</span>
              <select
                className="select"
                value={input.type}
                onChange={(e) => edit({ type: e.target.value as GenerateInput['type'] })}
              >
                <option value="single_elim">Single elimination</option>
                <option value="double_elim">Double elimination</option>
              </select>
            </label>
          </div>

          <div className="wrap-row" style={{ gap: 16 }}>
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={input.thirdPlace}
                onChange={(e) => edit({ thirdPlace: e.target.checked })}
              />
              Third-place match
            </label>
            {input.type === 'double_elim' && (
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={input.bracketReset}
                  onChange={(e) => edit({ bracketReset: e.target.checked })}
                />
                Bracket reset in the final
              </label>
            )}
            {leagueStatus !== 'regular_season' && (
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={input.force}
                  onChange={(e) => edit({ force: e.target.checked })}
                />
                Cut anyway (league is {leagueStatus})
              </label>
            )}
          </div>

          <ErrorBar error={error} />

          <div className="wrap-row">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={run.isPending}
              onClick={() => run.mutate('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={run.isPending || !preview}
              onClick={() => run.mutate('commit')}
            >
              Cut the bracket
            </button>
          </div>
        </div>
      </Card>

      {preview && (
        <Card
          title={`Seeds · ${preview.bracket.size}-team ${preview.bracket.type.replace('_', ' ')}`}
        >
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Seed</th>
                <th>Team</th>
                <th className="r">W–L</th>
              </tr>
            </thead>
            <tbody>
              {preview.standings.map((s, i) => (
                <tr key={s.memberId}>
                  <td className="num">{i + 1}</td>
                  <td>{nameOf(s.memberId)}</td>
                  <td className="r num">
                    {s.wins}–{s.losses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function useNames(slug: string) {
  const { data: league } = useLeague(slug)
  return useMemo(() => {
    const map = new Map((league?.members ?? []).map((m) => [m.id, teamName(m)]))
    return (id: string) => map.get(id) ?? '—'
  }, [league])
}
