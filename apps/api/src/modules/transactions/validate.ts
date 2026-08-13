import type { RosterEntry } from '../teams/roster'

export type TradeCheckCode =
  | 'TRADES_DISABLED'
  | 'TRADE_WINDOW_CLOSED'
  | 'SAME_MEMBER'
  | 'MEMBER_INACTIVE'
  | 'NOT_ON_ROSTER'
  | 'ROSTER_LIMIT'
  | 'OVER_CAP'
  | 'DUPLICATE_SPECIES'
  | 'EMPTY_TRADE'

export type TradeSide = {
  memberId: string
  active: boolean
  roster: RosterEntry[]
  /** Species this side is giving away. */
  gives: string[]
}

export type TradeRules = {
  tradesEnabled: boolean
  leagueStatus: string
  rosterMin: number
  rosterMax: number
  budget: number
  /** Many leagues let value drift after the draft — that's the point of trading. */
  enforcePostTradeCap: boolean
  tradeDeadlineWeek: number | null
  currentWeek: number | null
}

export type TradeProblem = { code: TradeCheckCode; message: string; details?: unknown }

export type TradeValidation =
  | { ok: true; result: { memberId: string; roster: string[]; spend: number }[] }
  | { ok: false; problems: TradeProblem[] }

/**
 * The same eight checks run at propose time (fail fast, decent UX) and again
 * inside the approve transaction (correctness — rosters move between the two).
 * Sharing one function is what keeps those two answers identical.
 */
export function validateTrade(rules: TradeRules, a: TradeSide, b: TradeSide): TradeValidation {
  const problems: TradeProblem[] = []
  const add = (code: TradeCheckCode, message: string, details?: unknown) =>
    problems.push({ code, message, details })

  if (!rules.tradesEnabled) add('TRADES_DISABLED', 'this league has trading turned off')

  if (rules.leagueStatus !== 'regular_season' && rules.leagueStatus !== 'playoffs') {
    add('TRADE_WINDOW_CLOSED', `trading is closed while the league is ${rules.leagueStatus}`)
  }
  if (
    rules.tradeDeadlineWeek !== null &&
    rules.currentWeek !== null &&
    rules.currentWeek > rules.tradeDeadlineWeek
  ) {
    add('TRADE_WINDOW_CLOSED', `the trade deadline was week ${rules.tradeDeadlineWeek}`)
  }

  if (a.memberId === b.memberId) add('SAME_MEMBER', 'a team cannot trade with itself')
  if (!a.active || !b.active) add('MEMBER_INACTIVE', 'both teams must be active in the league')
  if (a.gives.length === 0 && b.gives.length === 0) {
    add('EMPTY_TRADE', 'a trade has to move at least one Pokémon')
  }

  const costOf = new Map<string, number>()
  for (const entry of [...a.roster, ...b.roster]) costOf.set(entry.speciesId, entry.cost)

  for (const side of [a, b]) {
    const owned = new Set(side.roster.map((e) => e.speciesId))
    for (const speciesId of side.gives) {
      if (!owned.has(speciesId)) {
        add('NOT_ON_ROSTER', `${speciesId} is not on that team's roster`, {
          memberId: side.memberId,
          speciesId,
        })
      }
    }
    if (new Set(side.gives).size !== side.gives.length) {
      add('DUPLICATE_SPECIES', 'the same Pokémon is offered twice', { memberId: side.memberId })
    }
  }

  // Post-trade rosters, computed once and reused by the remaining checks.
  const result = [a, b].map((side, i) => {
    const other = i === 0 ? b : a
    const kept = side.roster.filter((e) => !side.gives.includes(e.speciesId))
    const received = other.gives
    const roster = [...kept.map((e) => e.speciesId), ...received]
    const spend =
      kept.reduce((sum, e) => sum + e.cost, 0) +
      received.reduce((sum, s) => sum + (costOf.get(s) ?? 0), 0)
    return { memberId: side.memberId, roster, spend }
  })

  for (const side of result) {
    if (new Set(side.roster).size !== side.roster.length) {
      add('DUPLICATE_SPECIES', 'that trade would leave a team with the same Pokémon twice', {
        memberId: side.memberId,
      })
    }
    if (side.roster.length > rules.rosterMax) {
      add('ROSTER_LIMIT', `that would put a roster over ${rules.rosterMax}`, {
        memberId: side.memberId,
        size: side.roster.length,
      })
    }
    if (side.roster.length < rules.rosterMin) {
      add('ROSTER_LIMIT', `that would drop a roster under ${rules.rosterMin}`, {
        memberId: side.memberId,
        size: side.roster.length,
      })
    }
    if (rules.enforcePostTradeCap && side.spend > rules.budget) {
      add('OVER_CAP', `that would put a team ${side.spend - rules.budget} over the cap`, {
        memberId: side.memberId,
        spend: side.spend,
      })
    }
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, result }
}
