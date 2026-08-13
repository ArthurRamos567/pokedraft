import { describe, expect, it } from 'bun:test'
import { autopick } from './autopick'
import { makePick, pauseDraft, resumeDraft, skipTurn, startDraft } from './commands'
import { apply, initialState, replay } from './reduce'
import { remainingBudget, rosterOf } from './select'
import type { DraftConfig, DraftEvent, DraftState } from './types'
import { canPick } from './validate'

const POINTS: DraftConfig['points'] = {
  expensive: { points: 20, banned: false },
  pricey: { points: 18, banned: false },
  midrange: { points: 10, banned: false },
  cheap: { points: 5, banned: false },
  cheaper: { points: 3, banned: false },
  cheapest: { points: 1, banned: false },
  forbidden: { points: 4, banned: true },
}

const config = (over: Partial<DraftConfig> = {}): DraftConfig => ({
  type: 'snake',
  budget: 30,
  rosterMin: 3,
  rosterMax: 4,
  allowUndrafted: true,
  points: POINTS,
  ...over,
})

function started(order = ['a', 'b'], over: Partial<DraftConfig> = {}): DraftState {
  const r = startDraft(initialState(config(over), order), {
    order,
    config: config(over),
    at: 1000,
    deadline: 2000,
  })
  if (!r.ok) throw new Error('start failed')
  return r.state
}

const pick = (state: DraftState, memberId: string, speciesId: string, at = 1) =>
  makePick(state, { memberId, speciesId, at, deadline: at + 90 })

describe('startDraft', () => {
  it('puts the first team on the clock with a deadline', () => {
    const state = started(['a', 'b', 'c'])
    expect(state.status).toBe('active')
    expect(state.onClock).toBe('a')
    expect(state.round).toBe(0)
    expect(state.deadline).toBe(2000)
  })

  it('refuses to start twice', () => {
    const state = started()
    expect(() =>
      apply(state, { type: 'DRAFT_STARTED', at: 1, order: ['a'], config: config() }),
    ).toThrow(/already started/)
  })
})

describe('picking', () => {
  it('records the pick, charges the budget, and moves the clock', () => {
    const r = pick(started(['a', 'b']), 'a', 'midrange')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(rosterOf(r.state, 'a')).toEqual(['midrange'])
    expect(remainingBudget(r.state, 'a')).toBe(20)
    expect(r.state.onClock).toBe('b')
    expect(r.state.taken.midrange).toBe('a')
    expect(r.state.pickNo).toBe(1)
  })

  it('rejects a pick from the team not on the clock', () => {
    const r = pick(started(['a', 'b']), 'b', 'midrange')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_YOUR_TURN')
  })

  it('rejects a species already taken', () => {
    const first = pick(started(['a', 'b']), 'a', 'midrange')
    if (!first.ok) throw new Error('setup')
    const second = pick(first.state, 'b', 'midrange')
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('SPECIES_ALREADY_PICKED')
  })

  it('rejects a species that is not on the list, and one that is banned', () => {
    const state = started(['a', 'b'])
    const missing = pick(state, 'a', 'notamon')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('SPECIES_NOT_IN_POOL')

    const banned = pick(state, 'a', 'forbidden')
    expect(banned.ok).toBe(false)
    if (!banned.ok) expect(banned.error.code).toBe('SPECIES_BANNED')
  })

  it('rejects a pick over the remaining budget', () => {
    // budget 21, rosterMin 1 so reachability never fires first
    const state = started(['a', 'b'], { budget: 15, rosterMin: 1 })
    const r = pick(state, 'a', 'expensive')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INSUFFICIENT_POINTS')
  })

  it('rejects a pick that fills a roster already at max', () => {
    let state = started(['a'], { rosterMax: 1, rosterMin: 1, budget: 100 })
    const first = pick(state, 'a', 'cheap')
    if (!first.ok) throw new Error('setup')
    state = { ...first.state, status: 'active', onClock: 'a', complete: [] }
    const r = pick(state, 'a', 'cheaper')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ROSTER_FULL')
  })
})

describe('reachability', () => {
  /**
   * budget 30, rosterMin 3. After one pick the team needs two more, and the
   * two cheapest left cost 1 + 3 = 4. So the first pick may cost at most 26 —
   * `pricey` (18) is fine, `expensive` (20) is fine, but with a tighter budget
   * the boundary has to bite exactly, not one pick early.
   */
  it('allows the last pick that still leaves a legal roster', () => {
    const state = started(['a'], { budget: 24, rosterMin: 3, rosterMax: 3 })
    // 24 - 20 = 4, and the two cheapest remaining are 1 + 3 = 4. Exactly enough.
    const r = pick(state, 'a', 'expensive')
    expect(r.ok).toBe(true)
  })

  it('rejects the pick one point past the boundary', () => {
    const state = started(['a'], { budget: 23, rosterMin: 3, rosterMax: 3 })
    // 23 - 20 = 3, one short of the 4 the two cheapest cost.
    const r = pick(state, 'a', 'expensive')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ROSTER_UNREACHABLE')
  })

  it('does not fire once the roster minimum is already met', () => {
    const state = started(['a'], { budget: 100, rosterMin: 1, rosterMax: 4 })
    expect(canPick(state, 'a', 'expensive').ok).toBe(true)
  })

  it('rejects when too few species remain to fill a roster at all', () => {
    const tiny: DraftConfig['points'] = {
      one: { points: 1, banned: false },
      two: { points: 1, banned: false },
    }
    const state = started(['a'], { points: tiny, budget: 100, rosterMin: 3, rosterMax: 3 })
    const r = pick(state, 'a', 'one')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ROSTER_UNREACHABLE')
  })
})

describe('completion', () => {
  it('finishes a team when its roster is full', () => {
    let state = started(['a', 'b'], { rosterMax: 1, rosterMin: 1, budget: 100 })
    const r1 = pick(state, 'a', 'cheap')
    if (!r1.ok) throw new Error('setup')
    state = r1.state
    expect(state.complete).toContain('a')
    expect(state.onClock).toBe('b')
  })

  it('finishes a team that can no longer afford anything', () => {
    // budget 5, cheapest is 1: after spending 5 there is nothing left to buy.
    const state = started(['a', 'b'], { budget: 5, rosterMin: 1, rosterMax: 4 })
    const r = pick(state, 'a', 'cheap')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.complete).toContain('a')
  })

  it('completes the draft when every team is finished', () => {
    let state = started(['a', 'b'], { rosterMax: 1, rosterMin: 1, budget: 100 })
    const r1 = pick(state, 'a', 'cheap')
    if (!r1.ok) throw new Error('setup')
    const r2 = pick(r1.state, 'b', 'cheaper')
    if (!r2.ok) throw new Error('setup')
    state = r2.state
    expect(state.status).toBe('complete')
    expect(state.onClock).toBeNull()
  })

  it('warns rather than stalling when the pool runs out under a team', () => {
    // Three mons, two teams, two slots each. Snake gives b the turn of the
    // round, so b fills up and a is left with an empty board. Reachability
    // cannot prevent this — the pool drains from under them.
    const tiny: DraftConfig['points'] = {
      m1: { points: 1, banned: false },
      m2: { points: 1, banned: false },
      m3: { points: 1, banned: false },
    }
    const opts = {
      points: tiny,
      budget: 10,
      rosterMin: 2,
      rosterMax: 2,
      allowUndrafted: false,
    }
    let state = started(['a', 'b'], opts)
    for (const [member, species] of [
      ['a', 'm1'],
      ['b', 'm2'],
      ['b', 'm3'],
    ] as const) {
      const r = pick(state, member, species)
      expect(r.ok, `${member} should be able to take ${species}`).toBe(true)
      if (!r.ok) return
      state = r.state
      if (r.warnings.length > 0) {
        expect(r.warnings.join(' ')).toContain('minimum')
      }
    }

    expect(state.status).toBe('complete')
    expect(rosterOf(state, 'b')).toHaveLength(2)
    expect(rosterOf(state, 'a')).toHaveLength(1)
  })
})

describe('skip', () => {
  it('counts the skip and moves the clock on', () => {
    const state = started(['a', 'b'])
    const r = skipTurn(state, { memberId: 'a', at: 5, deadline: 95, reason: 'timeout' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.teams.a?.skips).toBe(1)
    expect(r.state.onClock).toBe('b')
  })

  it('can end a team’s draft outright', () => {
    const state = started(['a', 'b'])
    const r = skipTurn(state, {
      memberId: 'a',
      at: 5,
      deadline: 95,
      reason: 'manual',
      finish: true,
    })
    if (!r.ok) throw new Error('skip failed')
    expect(r.state.complete).toContain('a')
  })
})

describe('pause', () => {
  it('drops the deadline and restores it from the resume moment', () => {
    const state = started(['a', 'b'])
    const paused = pauseDraft(state, 3000)
    if (!paused.ok) throw new Error('pause failed')
    expect(paused.state.status).toBe('paused')
    expect(paused.state.deadline).toBeNull()

    const resumed = resumeDraft(paused.state, 9000, 9090)
    if (!resumed.ok) throw new Error('resume failed')
    expect(resumed.state.status).toBe('active')
    expect(resumed.state.deadline).toBe(9090)
    expect(resumed.state.onClock).toBe('a')
  })

  it('refuses a pick while paused', () => {
    const paused = pauseDraft(started(['a', 'b']), 3000)
    if (!paused.ok) throw new Error('pause failed')
    const r = pick(paused.state, 'a', 'cheap')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('DRAFT_NOT_ACTIVE')
  })
})

describe('autopick', () => {
  it('prefers the queue', () => {
    const state = started(['a', 'b'])
    expect(autopick(state, 'a', ['cheap', 'expensive'], 'queue_then_best')).toEqual({
      action: 'pick',
      speciesId: 'cheap',
      reason: 'queue',
    })
  })

  it('skips a queued species that is already gone and takes the next', () => {
    const first = pick(started(['a', 'b']), 'a', 'cheap')
    if (!first.ok) throw new Error('setup')
    expect(autopick(first.state, 'b', ['cheap', 'cheaper'], 'queue_then_skip')).toEqual({
      action: 'pick',
      speciesId: 'cheaper',
      reason: 'queue',
    })
  })

  it('falls back to the most expensive legal mon', () => {
    const state = started(['a', 'b'], { budget: 100, rosterMin: 1 })
    expect(autopick(state, 'a', [], 'queue_then_best')).toEqual({
      action: 'pick',
      speciesId: 'expensive',
      reason: 'best',
    })
  })

  it('never buys anything under the skip policy', () => {
    const state = started(['a', 'b'])
    expect(autopick(state, 'a', ['cheap'], 'skip')).toEqual({ action: 'skip' })
  })

  it('skips when the queue is dead and the policy forbids guessing', () => {
    const state = started(['a', 'b'])
    expect(autopick(state, 'a', ['notamon'], 'queue_then_skip')).toEqual({ action: 'skip' })
  })
})

describe('replay determinism', () => {
  it('rebuilds the same state from the event log alone', () => {
    const order = ['a', 'b', 'c', 'd']
    const cfg = config({ budget: 60, rosterMin: 2, rosterMax: 4 })
    const points: DraftConfig['points'] = {}
    for (let i = 0; i < 60; i++) points[`mon${i}`] = { points: (i % 12) + 1, banned: false }
    const full = { ...cfg, points }

    let state = initialState(full, order)
    const log: DraftEvent[] = []
    const push = (events: DraftEvent[]) => log.push(...events)

    const start = startDraft(state, { order, config: full, at: 0, deadline: 90 })
    if (!start.ok) throw new Error('start failed')
    state = start.state
    push(start.events)

    let at = 1
    let guard = 0
    while (state.status === 'active' && guard++ < 500) {
      const me = state.onClock!
      const choice = autopick(state, me, [], 'queue_then_best')
      const result =
        choice.action === 'pick'
          ? makePick(state, {
              memberId: me,
              speciesId: choice.speciesId,
              at,
              deadline: at + 90,
              auto: choice.reason,
            })
          : skipTurn(state, { memberId: me, at, deadline: at + 90, reason: 'timeout' })
      if (!result.ok) throw new Error(`engine refused its own autopick: ${result.error.code}`)
      state = result.state
      push(result.events)
      at++
    }

    expect(state.status).toBe('complete')
    expect(log.length).toBeGreaterThan(30)

    const rebuilt = replay(log, initialState(full, order))
    expect(rebuilt).toEqual(state)
  })

  it('is byte-identical when replayed twice', () => {
    const events: DraftEvent[] = []
    const cfg = config()
    const start = startDraft(initialState(cfg, ['a', 'b']), {
      order: ['a', 'b'],
      config: cfg,
      at: 0,
      deadline: 90,
    })
    if (!start.ok) throw new Error('start failed')
    events.push(...start.events)

    const once = replay(events, initialState(cfg, ['a', 'b']))
    const twice = replay(events, initialState(cfg, ['a', 'b']))
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice))
  })
})
