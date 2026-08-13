import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { post, request } from '../lib/api'
import { Badge, Card, Empty, ErrorBar, Sprite } from '../ui'
import { teamName, useLeague } from './leagues.$slug'

export const Route = createFileRoute('/leagues/$slug/trades')({ component: Trades })

type Trade = {
  id: string
  status: string
  proposedBy: string
  counterparty: string
  note: string | null
  createdAt: string
  items: { fromMemberId: string; toMemberId: string; speciesId: string }[]
}

type Team = {
  memberId: string
  teamName: string
  roster: { speciesId: string; cost: number }[]
}

type Validation =
  | { ok: true; result: { memberId: string; roster: string[]; spend: number }[] }
  | { ok: false; problems: { code: string; message: string }[] }

const tone = (s: string) =>
  s === 'approved'
    ? 'good'
    : s === 'pending'
      ? 'live'
      : s === 'vetoed' || s === 'rejected'
        ? 'bad'
        : 'default'

function Trades() {
  const { slug } = Route.useParams()
  const qc = useQueryClient()
  const { data: league } = useLeague(slug)
  const leagueId = league?.league.id
  const myId = league?.me?.memberId ?? null

  const { data: trades } = useQuery({
    queryKey: ['league', slug, 'trades'],
    queryFn: () => request<Trade[]>(`/leagues/${leagueId}/transactions`),
    enabled: !!leagueId,
  })
  const { data: teams } = useQuery({
    queryKey: ['league', slug, 'teams'],
    queryFn: () => request<Team[]>(`/leagues/${leagueId}/teams`),
    enabled: !!leagueId,
  })

  const [error, setError] = useState<unknown>(null)
  const nameOf = useMemo(() => {
    const map = new Map((league?.members ?? []).map((m) => [m.id, teamName(m)]))
    return (id: string) => map.get(id) ?? '—'
  }, [league])

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      post(`/leagues/${leagueId}/transactions/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league', slug] }),
    onError: setError,
  })

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorBar error={error} />

      {myId && teams && leagueId && (
        <TradeBuilder
          leagueId={leagueId}
          myId={myId}
          teams={teams}
          onDone={() => qc.invalidateQueries({ queryKey: ['league', slug, 'trades'] })}
        />
      )}

      <Card title="Trade log" pad={false}>
        {!trades?.length ? (
          <Empty>No trades yet.</Empty>
        ) : (
          <div className="stack" style={{ gap: 0 }}>
            {trades.map((t) => {
              const gives = t.items.filter((i) => i.fromMemberId === t.proposedBy)
              const gets = t.items.filter((i) => i.fromMemberId === t.counterparty)
              const isMine = myId === t.proposedBy
              const isTheirs = myId === t.counterparty
              return (
                <div
                  key={t.id}
                  className="card-pad"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <span className="label">
                      {nameOf(t.proposedBy)} → {nameOf(t.counterparty)}
                    </span>
                    <Badge tone={tone(t.status)} live={t.status === 'pending'}>
                      {t.status}
                    </Badge>
                  </div>

                  <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                    <Side label={nameOf(t.proposedBy)} species={gives.map((i) => i.speciesId)} />
                    <span className="faint" style={{ fontSize: 18 }}>
                      ⇄
                    </span>
                    <Side label={nameOf(t.counterparty)} species={gets.map((i) => i.speciesId)} />
                  </div>

                  {t.note && (
                    <p className="dim" style={{ margin: '8px 0 0', fontSize: 13 }}>
                      “{t.note}”
                    </p>
                  )}

                  {t.status === 'pending' && (isMine || isTheirs) && (
                    <div className="wrap-row" style={{ marginTop: 10 }}>
                      {isTheirs && (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => act.mutate({ id: t.id, action: 'accept' })}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => act.mutate({ id: t.id, action: 'reject' })}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {isMine && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => act.mutate({ id: t.id, action: 'cancel' })}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function Side({ label, species }: { label: string; species: string[] }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="label">{label} gives</span>
      <div className="wrap-row" style={{ gap: 4 }}>
        {species.length === 0 && <span className="faint">nothing</span>}
        {species.map((s) => (
          <span key={s} className="panel row" style={{ padding: '3px 7px', gap: 5 }}>
            <Sprite species={s} size="sm" />
            <span style={{ fontSize: 12 }}>{s}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Validates live against the server so the rules are never guessed at twice. */
function TradeBuilder({
  leagueId,
  myId,
  teams,
  onDone,
}: {
  leagueId: string
  myId: string
  teams: Team[]
  onDone: () => void
}) {
  const mine = teams.find((t) => t.memberId === myId)
  const others = teams.filter((t) => t.memberId !== myId)
  const [counterpartyId, setCounterpartyId] = useState(others[0]?.memberId ?? '')
  const [gives, setGives] = useState<string[]>([])
  const [gets, setGets] = useState<string[]>([])
  const [check, setCheck] = useState<Validation | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const theirs = teams.find((t) => t.memberId === counterpartyId)
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  useEffect(() => {
    if (!counterpartyId || (gives.length === 0 && gets.length === 0)) {
      setCheck(null)
      return
    }
    const timer = setTimeout(() => {
      post<Validation>(`/leagues/${leagueId}/transactions/validate`, {
        counterpartyId,
        gives,
        gets,
      })
        .then(setCheck)
        .catch(() => setCheck(null))
    }, 250)
    return () => clearTimeout(timer)
  }, [leagueId, counterpartyId, gives, gets])

  if (!mine || others.length === 0) return null

  return (
    <Card
      title="Propose a trade"
      actions={
        check &&
        (check.ok ? (
          <Badge tone="good">looks legal</Badge>
        ) : (
          <Badge tone="bad">{check.problems[0]?.code}</Badge>
        ))
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <label className="field" style={{ maxWidth: 280 }}>
          <span className="label">Trade with</span>
          <select
            className="select"
            value={counterpartyId}
            onChange={(e) => {
              setCounterpartyId(e.target.value)
              setGets([])
            }}
          >
            {others.map((t) => (
              <option key={t.memberId} value={t.memberId}>
                {t.teamName}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr 1fr' }}>
          <Picker
            title="You give"
            roster={mine.roster}
            selected={gives}
            onToggle={(id) => toggle(gives, setGives, id)}
          />
          <Picker
            title="You get"
            roster={theirs?.roster ?? []}
            selected={gets}
            onToggle={(id) => toggle(gets, setGets, id)}
          />
        </div>

        {check && !check.ok && (
          <ul className="stack" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>
            {check.problems.map((p) => (
              <li key={p.code + p.message} style={{ color: 'var(--bad)', fontSize: 13 }}>
                {p.message}
              </li>
            ))}
          </ul>
        )}
        <ErrorBar error={error} />

        <button
          type="button"
          className="btn btn-primary"
          style={{ alignSelf: 'flex-start' }}
          disabled={busy || !check?.ok}
          onClick={() => {
            setBusy(true)
            setError(null)
            post(`/leagues/${leagueId}/transactions`, { counterpartyId, gives, gets })
              .then(() => {
                setGives([])
                setGets([])
                onDone()
              })
              .catch(setError)
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Sending…' : 'Send offer'}
        </button>
      </div>
    </Card>
  )
}

function Picker({
  title,
  roster,
  selected,
  onToggle,
}: {
  title: string
  roster: { speciesId: string; cost: number }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">{title}</span>
      <div className="stack" style={{ gap: 4 }}>
        {roster.length === 0 && <span className="faint">Nothing to trade.</span>}
        {roster.map((m) => {
          const on = selected.includes(m.speciesId)
          return (
            <button
              key={m.speciesId}
              type="button"
              className="panel row"
              onClick={() => onToggle(m.speciesId)}
              style={{
                padding: '4px 8px',
                gap: 8,
                cursor: 'pointer',
                textAlign: 'left',
                color: 'inherit',
                font: 'inherit',
                borderColor: on ? 'var(--live)' : undefined,
                background: on ? 'color-mix(in oklab, var(--live) 12%, var(--ink-850))' : undefined,
              }}
            >
              <Sprite species={m.speciesId} size="sm" />
              <span className="grow" style={{ fontSize: 13 }}>
                {m.speciesId}
              </span>
              <span className="cost">{m.cost}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
