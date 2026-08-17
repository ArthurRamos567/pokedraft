import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS as L,
  type LeagueSettings,
  settingsProblems,
} from '@pokedraft/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useId, useMemo, useState } from 'react'
import { post, request } from '../lib/api'
import { Card, ErrorBar } from '../ui'

export const Route = createFileRoute('/leagues/new')({ component: NewLeague })

type Format = { id: string; name: string; gen: number }

type PreviewRow = {
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
  summary: { ok: number; illegal: number; unknown: number; duplicates: number }
  diff: { added: { speciesId: string; points: number }[] }
  rows: PreviewRow[]
}

const STARTER = `# name: points — or points: [names], with an optional banned: list
Landorus-Therian: 20
Gholdengo: 19
Kingambit: 18
Dragapult: 17
Iron Valiant: 16
Toxapex: 15
Corviknight: 14
Garganacl: 11
Great Tusk: 10
Clefable: 8
Tyranitar: 6
banned: [Miraidon, Koraidon]
`

const STEPS = ['League', 'Pool', 'Draft', 'Review'] as const

function NewLeague() {
  const navigate = useNavigate()
  const { data: formats } = useQuery({
    queryKey: ['dex', 'formats'],
    queryFn: () => request<Format[]>('/dex/formats'),
    staleTime: Number.POSITIVE_INFINITY,
  })

  const [step, setStepRaw] = useState(0)
  // A step only reads as complete once it has been visited: the rule defaults
  // are valid on arrival, and a tick against a page nobody opened is a lie.
  const [seen, setSeen] = useState(0)
  const setStep = (next: number) => {
    setStepRaw(next)
    setSeen((s) => Math.max(s, next))
  }
  const [name, setName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [formatId, setFormatId] = useState('gen9ou')
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')
  const [description, setDescription] = useState('')
  const [settings, setSettings] = useState<LeagueSettings>(DEFAULT_SETTINGS)
  const [source, setSource] = useState('')
  const [allowIllegal, setAllowIllegal] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof LeagueSettings>(key: K, value: LeagueSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))

  /** A preview describes one file against one format. Change either and it lapses. */
  const invalidatePreview = () => setPreview(null)

  const poolCount = preview?.diff.added.length ?? 0
  const flagged = useMemo(() => flagRows(preview), [preview])
  const problems = useMemo(() => settingsProblems(settings), [settings])
  const clockOk =
    settings.draftMode === 'live'
      ? inRange(settings.pickSeconds, L.pickSeconds)
      : inRange(settings.turnHours, L.turnHours)

  const done = [
    name.trim().length >= 3,
    preview !== null && poolCount > 0,
    problems.length === 0 &&
      clockOk &&
      inRange(settings.budget, L.budget) &&
      inRange(settings.rosterMin, L.roster) &&
      inRange(settings.rosterMax, L.roster) &&
      inRange(settings.maxMembers, L.maxMembers),
    problems.length === 0,
  ]

  const runPreview = () => {
    setBusy(true)
    setError(null)
    post<Preview>('/points/preview', { source, formatId, allowIllegal })
      .then(setPreview)
      .catch(setError)
      .finally(() => setBusy(false))
  }

  const create = () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    post<{ slug: string }>('/leagues', {
      name,
      formatId,
      visibility,
      ...(description ? { description } : {}),
      ...(teamName ? { teamName } : {}),
      settings,
      // The hash the preview handed back: the server re-derives it and refuses
      // to write a pool the host never saw.
      pool: { source, hash: preview.hash, allowIllegal, name: `${name} — v1` },
    })
      .then((league) => navigate({ to: '/leagues/$slug', params: { slug: league.slug } }))
      .catch(setError)
      .finally(() => setBusy(false))
  }

  const formatName = formats?.find((f) => f.id === formatId)?.name ?? formatId

  return (
    <div className="wrap" style={{ maxWidth: 1000, paddingBottom: 48 }}>
      <div className="stack reveal" style={{ gap: 18 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">
            Step {step + 1} of {STEPS.length} · everything the draft needs
          </span>
          <h1>Start a league</h1>
          <p className="dim" style={{ margin: 0, maxWidth: 620 }}>
            Format, prices, clocks and roster rules are all set here. You will be the host and a
            player. Nothing is written until the last step.
          </p>
        </div>

        <div className="wiz">
          <nav className="wiz-rail" aria-label="Setup steps">
            {STEPS.map((label, i) => {
              const reachable = i === 0 || done.slice(0, i).every(Boolean)
              const complete = i < seen && done[i]
              const state = i === step ? 'on' : complete ? 'done' : ''
              return (
                <button
                  key={label}
                  type="button"
                  className={`wiz-step${state ? ` wiz-step-${state}` : ''}`}
                  disabled={!reachable}
                  onClick={() => setStep(i)}
                >
                  <i>{complete && i !== step ? '✓' : String(i + 1).padStart(2, '0')}</i>
                  <b>{label}</b>
                </button>
              )
            })}
          </nav>

          <div className="stack" style={{ gap: 14 }}>
            {step === 0 && (
              <Card title="The league">
                <div className="stack">
                  <Field label="League name" hint="Shown everywhere. Three characters or more.">
                    {(id) => (
                      <input
                        id={id}
                        className="input"
                        value={name}
                        minLength={3}
                        placeholder="Sunday Night Draft"
                        onChange={(e) => setName(e.target.value)}
                      />
                    )}
                  </Field>

                  <Field
                    label="Format"
                    hint="Decides what is legal, and therefore which prices survive an import. It cannot change once a pool exists."
                  >
                    {(id) => (
                      <select
                        id={id}
                        className="select"
                        value={formatId}
                        onChange={(e) => {
                          setFormatId(e.target.value)
                          invalidatePreview()
                        }}
                      >
                        {byGen(formats ?? []).map(([gen, list]) => (
                          <optgroup key={gen} label={`Gen ${gen}`}>
                            {list.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </Field>

                  <Seg
                    label="Visibility"
                    value={visibility}
                    onChange={setVisibility}
                    options={[
                      { value: 'private', label: 'Private · invite only' },
                      { value: 'public', label: 'Public · in the directory' },
                    ]}
                  />

                  <Field label="Your team name" hint="Optional. You can rename it later.">
                    {(id) => (
                      <input
                        id={id}
                        className="input"
                        value={teamName}
                        placeholder="Route 1 Rattatas"
                        onChange={(e) => setTeamName(e.target.value)}
                      />
                    )}
                  </Field>

                  <Field label="Description">
                    {(id) => (
                      <textarea
                        id={id}
                        className="textarea"
                        style={{ minHeight: 80, fontFamily: 'var(--body)', fontSize: 14 }}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
              </Card>
            )}

            {step === 1 && (
              <>
                <Card
                  title="The pool"
                  actions={<span className="label">{formatName}</span>}
                  pad={false}
                >
                  <div className="card-pad stack">
                    <p className="dim" style={{ margin: 0 }}>
                      Paste your price list or drop the file in. Every name is resolved against{' '}
                      {formatName} and priced — this becomes version 1, and you can revise it any
                      time before the draft starts.
                    </p>
                    <textarea
                      className="textarea"
                      value={source}
                      spellCheck={false}
                      placeholder={'Landorus-Therian: 20\nGholdengo: 19\n…'}
                      onChange={(e) => {
                        setSource(e.target.value)
                        invalidatePreview()
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const file = e.dataTransfer.files[0]
                        if (file)
                          void file.text().then((text) => {
                            setSource(text)
                            invalidatePreview()
                          })
                      }}
                    />
                    <div className="row-between">
                      <label className="row" style={{ gap: 8, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={allowIllegal}
                          onChange={(e) => {
                            setAllowIllegal(e.target.checked)
                            invalidatePreview()
                          }}
                        />
                        Keep mons {formatName} bans — some leagues unban on purpose
                      </label>
                      <div className="wrap-row">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setSource(STARTER)
                            invalidatePreview()
                          }}
                        >
                          Load a starter list
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || source.trim().length === 0}
                          onClick={runPreview}
                        >
                          {busy ? 'Reading…' : 'Preview'}
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>

                {preview && (
                  <>
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}
                    >
                      <Tile label="Priced" value={preview.summary.ok} tone="var(--good)" />
                      <Tile label="Illegal" value={preview.summary.illegal} tone="var(--live)" />
                      <Tile label="Unknown" value={preview.summary.unknown} tone="var(--bad)" />
                      <Tile
                        label="Duplicates"
                        value={preview.summary.duplicates}
                        tone="var(--text-2)"
                      />
                    </div>

                    {flagged.length > 0 && (
                      <Card
                        title="Needs a look"
                        actions={<span className="label">{flagged.length} rows</span>}
                        pad={false}
                      >
                        <div style={{ maxHeight: 300, overflow: 'auto' }}>
                          <table className="table">
                            <tbody>
                              {flagged.map((r) => (
                                <tr key={r.key}>
                                  <td>{r.input}</td>
                                  <td className="faint" style={{ fontSize: 12.5 }}>
                                    {r.note}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="card-pad faint" style={{ fontSize: 12 }}>
                          These rows are simply left out. Fix the names above and preview again, or
                          carry on without them.
                        </div>
                      </Card>
                    )}
                  </>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <Card title="Draft">
                  <div className="stack">
                    <Seg
                      live
                      label="Mode"
                      hint={
                        settings.draftMode === 'live'
                          ? 'Everyone drafts at once against a shot clock.'
                          : 'Picks happen whenever people are around, with a per-turn deadline.'
                      }
                      value={settings.draftMode}
                      onChange={(v) => set('draftMode', v)}
                      options={[
                        { value: 'live', label: 'Live' },
                        { value: 'async', label: 'Async' },
                      ]}
                    />

                    {settings.draftMode === 'live' ? (
                      <Clock
                        label="Seconds per pick"
                        hint="When it hits zero the autopick policy below decides what happens."
                        value={settings.pickSeconds}
                        limits={L.pickSeconds}
                        presets={[45, 60, 90, 120, 180]}
                        unit="s"
                        onChange={(v) => set('pickSeconds', v)}
                      />
                    ) : (
                      <Clock
                        label="Hours per turn"
                        hint="How long a turn may sit before the clock runs out on it."
                        value={settings.turnHours}
                        limits={L.turnHours}
                        presets={[8, 12, 24, 48, 72]}
                        unit="h"
                        onChange={(v) => set('turnHours', v)}
                      />
                    )}

                    <Seg
                      label="Order"
                      hint={
                        settings.draftType === 'snake'
                          ? `Rounds reverse: 1→${settings.maxMembers}, then ${settings.maxMembers}→1. Late picks compensate.`
                          : 'Every round runs in the same order. First pick every time.'
                      }
                      value={settings.draftType}
                      onChange={(v) => set('draftType', v)}
                      options={[
                        { value: 'snake', label: 'Snake' },
                        { value: 'linear', label: 'Linear' },
                      ]}
                    />

                    <Seg
                      label="When the clock runs out"
                      hint="Queues are the wishlist each player keeps during the draft."
                      value={settings.autopickPolicy}
                      onChange={(v) => set('autopickPolicy', v)}
                      options={[
                        { value: 'skip', label: 'Skip the turn' },
                        { value: 'queue_then_skip', label: 'Queue, else skip' },
                        { value: 'queue_then_best', label: 'Queue, else best left' },
                      ]}
                    />
                  </div>
                </Card>

                <Card title="Money and roster">
                  <div className="stack">
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
                    >
                      <Num
                        label="Budget"
                        hint="Points each team spends."
                        value={settings.budget}
                        limits={L.budget}
                        onChange={(v) => set('budget', v)}
                      />
                      <Num
                        label="Teams"
                        hint="Seats, host included."
                        value={settings.maxMembers}
                        limits={L.maxMembers}
                        onChange={(v) => set('maxMembers', v)}
                      />
                      <Num
                        label="Roster min"
                        hint="Fewest mons a team may end with."
                        value={settings.rosterMin}
                        limits={L.roster}
                        onChange={(v) => set('rosterMin', v)}
                      />
                      <Num
                        label="Roster max"
                        hint="Rounds in the draft."
                        value={settings.rosterMax}
                        limits={L.roster}
                        onChange={(v) => set('rosterMax', v)}
                      />
                    </div>

                    <Toggle
                      checked={settings.allowUndrafted}
                      onChange={(v) => set('allowUndrafted', v)}
                      label="Let a team finish short of the roster maximum"
                      hint="Off means every team drafts every round, budget permitting."
                    />

                    {poolCount > 0 && (
                      <p className="faint" style={{ margin: 0, fontSize: 12 }}>
                        {poolCount} priced mons for {settings.maxMembers} teams ·{' '}
                        {settings.maxMembers * settings.rosterMax} picks at most, leaving{' '}
                        {Math.max(0, poolCount - settings.maxMembers * settings.rosterMax)} on the
                        board.
                      </p>
                    )}

                    {problems.length > 0 && <div className="error-bar">{problems.join(' · ')}</div>}
                  </div>
                </Card>
              </>
            )}

            {step === 3 && (
              <>
                <Card title="Trades">
                  <div className="stack">
                    <Toggle
                      checked={settings.tradesEnabled}
                      onChange={(v) => {
                        set('tradesEnabled', v)
                        if (!v) set('tradeDeadlineWeek', null)
                      }}
                      label="Allow trades"
                      hint="Rosters are derived from picks and trades, so this can be turned off later too."
                    />
                    {settings.tradesEnabled && (
                      <>
                        <Toggle
                          checked={settings.tradesRequireHostApproval}
                          onChange={(v) => set('tradesRequireHostApproval', v)}
                          label="Trades need host approval"
                          hint="Both sides accept, then you sign it off."
                        />
                        <Field
                          label="Trade deadline"
                          hint="The last week trades may be made. Leave empty for none."
                        >
                          {(id) => (
                            <input
                              id={id}
                              className="input num"
                              type="number"
                              style={{ maxWidth: 160 }}
                              min={L.tradeDeadlineWeek.min}
                              max={L.tradeDeadlineWeek.max}
                              value={settings.tradeDeadlineWeek ?? ''}
                              placeholder="no deadline"
                              onChange={(e) =>
                                set(
                                  'tradeDeadlineWeek',
                                  e.target.value === '' ? null : Number(e.target.value),
                                )
                              }
                            />
                          )}
                        </Field>
                      </>
                    )}
                  </div>
                </Card>

                <Card title="Ready" actions={<span className="label">Review and create</span>}>
                  <dl className="ticket">
                    <dt>League</dt>
                    <dd>
                      {name || '—'} · {visibility}
                    </dd>
                    <dt>Format</dt>
                    <dd>{formatName}</dd>
                    <dt>Pool</dt>
                    <dd>
                      {poolCount} priced{' '}
                      {preview && preview.summary.illegal > 0 && allowIllegal
                        ? `· ${preview.summary.illegal} unbanned`
                        : ''}
                    </dd>
                    <dt>Draft</dt>
                    <dd>
                      {settings.draftType} · {settings.draftMode} ·{' '}
                      {settings.draftMode === 'live'
                        ? `${settings.pickSeconds}s per pick`
                        : `${settings.turnHours}h per turn`}
                    </dd>
                    <dt>Autopick</dt>
                    <dd>{settings.autopickPolicy.replaceAll('_', ' ')}</dd>
                    <dt>Budget</dt>
                    <dd>{settings.budget} points</dd>
                    <dt>Roster</dt>
                    <dd>
                      {settings.rosterMin}–{settings.rosterMax}
                      {settings.allowUndrafted ? ' · may finish short' : ''}
                    </dd>
                    <dt>Teams</dt>
                    <dd>up to {settings.maxMembers}</dd>
                    <dt>Trades</dt>
                    <dd>
                      {settings.tradesEnabled
                        ? [
                            'on',
                            settings.tradesRequireHostApproval ? 'host approves' : null,
                            settings.tradeDeadlineWeek
                              ? `deadline week ${settings.tradeDeadlineWeek}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : 'off'}
                    </dd>
                  </dl>
                  <p className="faint" style={{ margin: '12px 0 0', fontSize: 12 }}>
                    Draft order and invites come next, on the league page. Prices, clocks and trade
                    rules stay editable until the draft starts.
                  </p>
                </Card>
              </>
            )}

            <ErrorBar error={error} />

            <div className="row-between">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={step === 0}
                onClick={() => setStep(Math.max(0, step - 1))}
              >
                Back
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!done[step]}
                  onClick={() => setStep(step + 1)}
                >
                  {step === 1 && !preview ? 'Preview the pool to continue' : 'Next'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  disabled={busy || done.some((d) => !d)}
                  onClick={create}
                >
                  {busy ? 'Creating…' : 'Create league'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── pieces ──────────────────────────────────────────────────────────────────

function Hint({ children }: { children: string }) {
  return (
    <span className="faint" style={{ fontSize: 12 }}>
      {children}
    </span>
  )
}

/** The id is handed to the child so the visible label actually binds to it. */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}

/** Two or three options are a choice, not a list: show them all. */
function Seg<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  live = false,
}: {
  label: string
  hint?: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  live?: boolean
}) {
  return (
    <fieldset className="field-set">
      <legend className="label">{label}</legend>
      <div className={`seg${live ? ' seg-live' : ''}`}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <Hint>{hint}</Hint>}
    </fieldset>
  )
}

type Limits = { min: number; max: number }

function Num({
  label,
  hint,
  value,
  limits,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  limits: Limits
  onChange: (v: number) => void
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          className="input num"
          type="number"
          min={limits.min}
          max={limits.max}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        />
      )}
    </Field>
  )
}

/** A clock is a number people pick from habit, so the habits are one tap away. */
function Clock({
  label,
  hint,
  value,
  limits,
  presets,
  unit,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  limits: Limits
  presets: number[]
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Num label={label} hint={hint} value={value} limits={limits} onChange={onChange} />
      <div className="wrap-row">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={`chip${value === p ? ' chip-on' : ''}`}
            onClick={() => onChange(p)}
          >
            {p}
            {unit}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="panel row" style={{ gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="stack" style={{ gap: 2 }}>
        <span style={{ fontSize: 14 }}>{label}</span>
        {hint && <Hint>{hint}</Hint>}
      </span>
    </label>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="card card-pad stack" style={{ gap: 2 }}>
      <span className="label">{label}</span>
      <strong className="num" style={{ fontSize: 26, color: tone }}>
        {value}
      </strong>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

const inRange = (n: number, { min, max }: Limits) =>
  Number.isFinite(n) && Number.isInteger(n) && n >= min && n <= max

/** The rows an import would drop, each with a reason the host can act on. */
function flagRows(preview: Preview | null) {
  return (preview?.rows ?? [])
    .filter((r) => r.status !== 'ok')
    .map((r, i) => ({ key: `${i}:${r.input}`, input: r.input, note: noteFor(r) }))
}

function noteFor(row: PreviewRow): string {
  if (row.status !== 'unknown') return row.reason ?? row.status
  const names = row.suggestions?.slice(0, 3).map((s) => s.name) ?? []
  return names.length > 0 ? `unrecognised — did you mean ${names.join(', ')}?` : 'unrecognised'
}

/** Newest generation first — that is what all but one league wants. */
function byGen(formats: Format[]): [number, Format[]][] {
  const groups = new Map<number, Format[]>()
  for (const f of formats) {
    const list = groups.get(f.gen)
    if (list) list.push(f)
    else groups.set(f.gen, [f])
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0])
}
