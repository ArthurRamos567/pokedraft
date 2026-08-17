import {
  ERROR_CODES,
  type LeagueSettings,
  mergeSettings,
  settingsProblems,
} from '@pokedraft/shared'
import { badRequest } from '../../errors'

/** The pure rules live in `@pokedraft/shared`; this is only the HTTP mapping. */
export function resolveSettings(
  base: LeagueSettings,
  patch: Partial<LeagueSettings> = {},
): LeagueSettings {
  const merged = mergeSettings(base, patch)
  const problems = settingsProblems(merged)
  if (problems.length > 0) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, problems.join('; '), { problems })
  }
  return merged
}
