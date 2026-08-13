import { and, eq, schema } from '@pokedraft/db'
import { Elysia } from 'elysia'
import { auth } from '../auth'
import { db } from '../db'
import { unauthorized } from '../errors'
import { leagueNotFound, notHost } from '../modules/leagues/errors'
import type { SessionUser } from './auth'

export type LeagueScope = 'member' | 'host' | 'public'

/**
 * Resolves `:leagueId` (or `:slug`) once per request and enforces scope.
 *
 * A private league answers 404 to anyone who isn't a member — including for
 * the host-only scope. 403 would confirm the league exists, and the slug space
 * is guessable, so it would leak membership.
 */
export const leaguePlugin = new Elysia({ name: 'league' }).macro({
  league: (scope: LeagueScope) => ({
    async resolve({ request, params }) {
      const p = params as Record<string, string | undefined>
      const key = p.leagueId ?? p.id ?? p.slug
      if (!key) throw leagueNotFound()

      const league = await db.query.leagues.findFirst({
        where:
          key.includes('-') && key.length === 36
            ? eq(schema.leagues.id, key)
            : eq(schema.leagues.slug, key),
      })
      if (!league) throw leagueNotFound()

      const session = await auth.api.getSession({ headers: request.headers })
      const user = (session?.user ?? null) as SessionUser | null

      const membership = user
        ? ((await db.query.leagueMembers.findFirst({
            where: and(
              eq(schema.leagueMembers.leagueId, league.id),
              eq(schema.leagueMembers.userId, user.id),
              eq(schema.leagueMembers.status, 'active'),
            ),
          })) ?? null)
        : null

      if (scope === 'public') {
        if (league.visibility === 'private' && !membership) throw leagueNotFound()
      } else {
        if (!user) {
          // A private league must not distinguish "log in" from "no such league".
          if (league.visibility === 'private') throw leagueNotFound()
          throw unauthorized()
        }
        if (!membership) throw leagueNotFound()
        if (scope === 'host' && membership.role !== 'host' && membership.role !== 'cohost') {
          throw notHost()
        }
      }

      return { league, membership, user }
    },
  }),
})

/**
 * `league: 'member' | 'host'` already rejected anonymous and non-member
 * requests, but the macro's return type is shared with the `public` scope.
 * These make the guarantee explicit at the call site instead of littering
 * non-null assertions through the routes.
 */
export function mustUser(user: SessionUser | null): SessionUser {
  if (!user) throw unauthorized()
  return user
}

export function mustMember<T>(membership: T | null): T {
  if (!membership) throw leagueNotFound()
  return membership
}
