/**
 * The league rule set, its bounds, and the checks that span two fields. Lives
 * here because both sides need the same answer: the API rejects a bad
 * combination, and the create form has to grey out `Next` for the same reason.
 */
export type LeagueSettings = {
  draftMode: 'live' | 'async'
  draftType: 'snake' | 'linear'
  /** Live drafts: the shot clock per pick. */
  pickSeconds: number
  /** Async drafts: how long a turn may sit before autopick fires. */
  turnHours: number
  budget: number
  rosterMin: number
  rosterMax: number
  allowUndrafted: boolean
  maxMembers: number
  tradesEnabled: boolean
  tradesRequireHostApproval: boolean
  tradeDeadlineWeek: number | null
  autopickPolicy: 'skip' | 'queue_then_skip' | 'queue_then_best'
}

export const SETTINGS_LIMITS = {
  pickSeconds: { min: 15, max: 3600 },
  turnHours: { min: 1, max: 336 },
  budget: { min: 1, max: 10_000 },
  roster: { min: 1, max: 24 },
  maxMembers: { min: 2, max: 64 },
  tradeDeadlineWeek: { min: 1, max: 52 },
} as const

/** The same values the columns default to, so creation can write them all. */
export const DEFAULT_SETTINGS: LeagueSettings = {
  draftMode: 'live',
  draftType: 'snake',
  pickSeconds: 90,
  turnHours: 24,
  budget: 100,
  rosterMin: 6,
  rosterMax: 10,
  allowUndrafted: false,
  maxMembers: 8,
  tradesEnabled: true,
  tradesRequireHostApproval: false,
  tradeDeadlineWeek: null,
  autopickPolicy: 'queue_then_skip',
}

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof LeagueSettings)[]

/**
 * The rules a per-field schema cannot state, because each one spans two
 * fields. Every problem is returned at once — a host fixing a form wants the
 * whole list, not the first item of it.
 */
export function settingsProblems(s: LeagueSettings): string[] {
  const problems: string[] = []

  if (s.rosterMin > s.rosterMax) {
    problems.push('rosterMin cannot be greater than rosterMax')
  }
  if (s.tradeDeadlineWeek !== null && !s.tradesEnabled) {
    problems.push('tradeDeadlineWeek makes no sense while trades are disabled')
  }

  return problems
}

/**
 * Merges a patch over a base. Only rule fields come back, so a settings row
 * read from a database can be the base without its id and timestamps riding
 * along into the next write.
 */
export function mergeSettings(
  base: LeagueSettings,
  patch: Partial<LeagueSettings> = {},
): LeagueSettings {
  const merged = {} as LeagueSettings
  for (const key of KEYS) {
    const next = patch[key]
    Object.assign(merged, { [key]: next === undefined ? base[key] : next })
  }
  return merged
}
