import type { DraftState, MemberId } from './types'

/**
 * The order a round is walked in, before anyone is skipped.
 *
 * Snake alternates so the last pick of a round also takes the first of the
 * next; linear keeps the same order every round, which is what leagues that
 * price strictly by tier want.
 */
export function roundOrder(
  order: readonly MemberId[],
  round: number,
  type: 'snake' | 'linear',
): MemberId[] {
  if (type === 'linear' || round % 2 === 0) return [...order]
  return [...order].reverse()
}

/**
 * Who picks after the member currently on the clock.
 *
 * Finished teams are stepped over rather than merely passed: a team out of
 * budget must not stall the clock for everyone else. Returns null when every
 * team is finished or the last round is done — the draft is over.
 */
export function nextTurn(state: DraftState): { onClock: MemberId; round: number } | null {
  const { order, config } = state
  if (order.length === 0) return null

  const maxRounds = config.rosterMax
  let round = state.round
  let seq = roundOrder(order, round, config.type)
  let i = state.onClock ? seq.indexOf(state.onClock) : -1

  // At most one full pass per remaining round; the bound is what stops a draft
  // where everyone is finished from spinning.
  const steps = (maxRounds - round + 1) * order.length + order.length
  for (let n = 0; n < steps; n++) {
    i++
    if (i >= seq.length) {
      round++
      if (round >= maxRounds) return null
      seq = roundOrder(order, round, config.type)
      i = 0
    }
    const candidate = seq[i]
    if (candidate && !state.complete.includes(candidate)) return { onClock: candidate, round }
  }
  return null
}

/** The first turn of a fresh draft, before anyone has picked. */
export function firstTurn(state: DraftState): { onClock: MemberId; round: number } | null {
  const seq = roundOrder(state.order, 0, state.config.type)
  for (const memberId of seq) {
    if (!state.complete.includes(memberId)) return { onClock: memberId, round: 0 }
  }
  return null
}
