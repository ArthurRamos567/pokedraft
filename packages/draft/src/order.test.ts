import { describe, expect, it } from 'bun:test'
import { nextTurn, roundOrder } from './order'
import { initialState } from './reduce'
import type { DraftConfig, DraftState } from './types'

const config = (over: Partial<DraftConfig> = {}): DraftConfig => ({
  type: 'snake',
  budget: 100,
  rosterMin: 2,
  rosterMax: 4,
  allowUndrafted: true,
  points: {},
  ...over,
})

const stateWith = (order: string[], over: Partial<DraftState> = {}): DraftState => ({
  ...initialState(config(), order),
  status: 'active',
  ...over,
})

describe('roundOrder', () => {
  it('snakes on odd rounds', () => {
    const order = ['a', 'b', 'c', 'd']
    expect(roundOrder(order, 0, 'snake')).toEqual(['a', 'b', 'c', 'd'])
    expect(roundOrder(order, 1, 'snake')).toEqual(['d', 'c', 'b', 'a'])
    expect(roundOrder(order, 2, 'snake')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps linear order every round', () => {
    const order = ['a', 'b', 'c']
    for (const round of [0, 1, 2, 3]) {
      expect(roundOrder(order, round, 'linear')).toEqual(order)
    }
  })
})

describe('nextTurn', () => {
  it.each([
    [['a', 'b', 'c', 'd']],
    [['a', 'b', 'c', 'd', 'e', 'f']],
    [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']],
    [['a', 'b', 'c']],
    [['a', 'b', 'c', 'd', 'e']],
  ])('walks a full snake for %p', (order) => {
    let state = stateWith(order as string[], { onClock: (order as string[])[0]!, round: 0 })
    const seen: string[] = [state.onClock!]

    for (let i = 1; i < order.length * 4; i++) {
      const turn = nextTurn(state)
      expect(turn).not.toBeNull()
      state = { ...state, onClock: turn!.onClock, round: turn!.round }
      seen.push(turn!.onClock)
    }

    // Every round contains every member exactly once, and consecutive rounds
    // mirror each other.
    for (let r = 0; r < 4; r++) {
      const slice = seen.slice(r * order.length, (r + 1) * order.length)
      expect(new Set(slice).size).toBe(order.length)
      expect(slice).toEqual(roundOrder(order as string[], r, 'snake'))
    }
  })

  it('ends after the last round', () => {
    const order = ['a', 'b']
    const state = stateWith(order, {
      config: config({ rosterMax: 2 }),
      onClock: 'a',
      round: 1,
    })
    // Round 1 order is [b, a]; a is last, so there is nowhere left to go.
    expect(nextTurn(state)).toBeNull()
  })

  it('steps over a finished team without corrupting the sequence', () => {
    const order = ['a', 'b', 'c', 'd']
    const state = stateWith(order, { onClock: 'a', round: 0, complete: ['b'] })
    expect(nextTurn(state)?.onClock).toBe('c')
  })

  it('gives the turn-of-the-round pair to the same team, skipping finished ones', () => {
    const order = ['a', 'b', 'c']
    let state = stateWith(order, { onClock: 'c', round: 0, complete: ['b'] })
    // Snake: c closes round 0 and opens round 1, so it picks back to back.
    state = { ...state, ...nextTurn(state)! }
    expect(state.onClock).toBe('c')
    expect(state.round).toBe(1)

    // b is finished, so the next turn jumps straight to a.
    state = { ...state, ...nextTurn(state)! }
    expect(state.onClock).toBe('a')
    expect(state.round).toBe(1)
  })

  it('returns null when every team is finished', () => {
    const order = ['a', 'b']
    const state = stateWith(order, { onClock: 'a', round: 0, complete: ['a', 'b'] })
    expect(nextTurn(state)).toBeNull()
  })
})
