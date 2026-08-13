import { ERROR_CODES } from '@pokedraft/shared'
import { conflict, DomainError, notFound } from '../../errors'

/**
 * A private league is 404, never 403. A 403 confirms the league exists, which
 * turns the slug space into a membership oracle.
 */
export const leagueNotFound = () => notFound(ERROR_CODES.LEAGUE_NOT_FOUND, 'league not found')

export const notMember = () => leagueNotFound()

export const notHost = () =>
  new DomainError(ERROR_CODES.NOT_LEAGUE_HOST, 'only the league host can do this', 403)

export const leagueFull = () =>
  conflict(ERROR_CODES.LEAGUE_FULL, 'this league is already at capacity')

export const alreadyMember = () =>
  conflict(ERROR_CODES.ALREADY_MEMBER, 'you are already in this league')

export const wrongStatus = (current: string, allowed: readonly string[]) =>
  conflict(
    ERROR_CODES.LEAGUE_INVALID_STATUS,
    `this league is ${current}; that is only allowed while ${allowed.join(' or ')}`,
    { current, allowed },
  )
