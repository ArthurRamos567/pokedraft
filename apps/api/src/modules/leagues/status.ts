import { wrongStatus } from './errors'

export const LEAGUE_STATUSES = [
  'setup',
  'drafting',
  'regular_season',
  'playoffs',
  'complete',
  'archived',
] as const

export type LeagueStatus = (typeof LEAGUE_STATUSES)[number]

/**
 * setup ──▶ drafting ──▶ regular_season ──▶ playoffs ──▶ complete ──▶ archived
 *
 * The only legal moves. Anything else is a bug, not a user error, so it is
 * checked in one place rather than re-derived at each call site.
 */
const TRANSITIONS: Record<LeagueStatus, readonly LeagueStatus[]> = {
  setup: ['drafting', 'archived'],
  drafting: ['regular_season', 'setup', 'archived'],
  regular_season: ['playoffs', 'complete', 'archived'],
  playoffs: ['complete', 'archived'],
  complete: ['archived'],
  archived: [],
}

export function canTransition(from: LeagueStatus, to: LeagueStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Throws unless the league is in one of the allowed statuses. */
export function assertStatus(
  league: { status: LeagueStatus },
  allowed: readonly LeagueStatus[],
): void {
  if (!allowed.includes(league.status)) throw wrongStatus(league.status, allowed)
}

export function assertTransition(from: LeagueStatus, to: LeagueStatus): void {
  if (!canTransition(from, to)) throw wrongStatus(from, TRANSITIONS[from])
}
