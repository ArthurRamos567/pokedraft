import { and, type Database, eq, schema, sql } from '@pokedraft/db'
import { getFormatInfo } from '@pokedraft/dex'
import { ERROR_CODES } from '@pokedraft/shared'
import { badRequest, conflict, notFound } from '../../errors'
import { recordAudit } from '../system/service'
import { alreadyMember, leagueFull, leagueNotFound } from './errors'
import {
  countActiveMembers,
  findInviteByCode,
  findLeagueById,
  findMembership,
  findSettings,
  slugExists,
} from './repo'
import { assertStatus, assertTransition, type LeagueStatus } from './status'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Short, unambiguous, shareable out loud. Its own column, not the id. */
export function generateInviteCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const b of bytes) out += BASE32[b % BASE32.length]
  return out
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

async function uniqueSlug(db: Database, name: string): Promise<string> {
  const base = slugify(name) || 'league'
  if (!(await slugExists(db, base))) return base
  // Collisions are rare and the suffix is short; a loop beats a sequence table.
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}-${generateInviteCode(4).toLowerCase()}`
    if (!(await slugExists(db, candidate))) return candidate
  }
  throw conflict(ERROR_CODES.SLUG_TAKEN, 'could not allocate a unique slug')
}

function assertFormat(formatId: string) {
  if (!getFormatInfo(formatId)) {
    throw badRequest(ERROR_CODES.FORMAT_NOT_FOUND, `unknown format: ${formatId}`)
  }
}

export type CreateLeagueInput = {
  name: string
  description?: string
  visibility?: 'public' | 'private'
  formatId: string
  settings?: Partial<typeof schema.leagueSettings.$inferInsert>
  teamName?: string
}

/** The creator becomes host *and* a playing member — hosts play in these leagues. */
export async function createLeague(db: Database, userId: string, input: CreateLeagueInput) {
  assertFormat(input.formatId)
  const slug = await uniqueSlug(db, input.name)

  return db.transaction(async (tx) => {
    const [league] = await tx
      .insert(schema.leagues)
      .values({
        slug,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility ?? 'private',
        formatId: input.formatId,
        hostId: userId,
      })
      .returning()
    if (!league) throw new Error('league insert returned nothing')

    const { leagueId: _ignored, ...settings } = input.settings ?? {}
    await tx.insert(schema.leagueSettings).values({ leagueId: league.id, ...settings })
    await tx.insert(schema.leagueMembers).values({
      leagueId: league.id,
      userId,
      role: 'host',
      teamName: input.teamName ?? null,
    })

    return league
  })
}

export async function getLeagueOr404(db: Database, leagueId: string) {
  const league = await findLeagueById(db, leagueId)
  if (!league) throw leagueNotFound()
  return league
}

export async function updateLeague(
  db: Database,
  leagueId: string,
  patch: {
    name?: string
    description?: string | null
    visibility?: 'public' | 'private'
    formatId?: string
    logoUrl?: string | null
    bannerUrl?: string | null
  },
) {
  const league = await getLeagueOr404(db, leagueId)

  if (patch.formatId && patch.formatId !== league.formatId) {
    assertStatus(league, ['setup'])
    assertFormat(patch.formatId)
    // Legality was classified against the old format, so every price in the
    // list is now unverified. Re-import rather than silently mismatch.
    const [existing] = await db
      .select({ id: schema.pointLists.id })
      .from(schema.pointLists)
      .where(eq(schema.pointLists.leagueId, leagueId))
      .limit(1)
    if (existing) {
      throw conflict(
        ERROR_CODES.LEAGUE_INVALID_STATUS,
        'a points list already exists for this format; delete it or start a new league before changing format',
      )
    }
  }

  const [updated] = await db
    .update(schema.leagues)
    .set(patch)
    .where(eq(schema.leagues.id, leagueId))
    .returning()
  return updated!
}

/** Most rules freeze once the draft starts; the rest stay editable all season. */
const SETTINGS_LOCKED_AFTER_SETUP = [
  'draftMode',
  'draftType',
  'budget',
  'rosterMin',
  'rosterMax',
  'maxMembers',
  'allowUndrafted',
] as const

export async function updateSettings(
  db: Database,
  leagueId: string,
  patch: Partial<typeof schema.leagueSettings.$inferInsert>,
) {
  const league = await getLeagueOr404(db, leagueId)
  const { leagueId: _ignored, ...clean } = patch

  if (league.status !== 'setup') {
    const locked = SETTINGS_LOCKED_AFTER_SETUP.filter((k) => k in clean)
    if (locked.length > 0) {
      throw conflict(
        ERROR_CODES.LEAGUE_INVALID_STATUS,
        `these settings are frozen once the draft starts: ${locked.join(', ')}`,
        { locked },
      )
    }
  }

  const [updated] = await db
    .update(schema.leagueSettings)
    .set(clean)
    .where(eq(schema.leagueSettings.leagueId, leagueId))
    .returning()
  if (!updated) throw leagueNotFound()
  return updated
}

export async function setStatus(db: Database, leagueId: string, to: LeagueStatus) {
  const league = await getLeagueOr404(db, leagueId)
  assertTransition(league.status, to)
  const [updated] = await db
    .update(schema.leagues)
    .set({ status: to })
    .where(eq(schema.leagues.id, leagueId))
    .returning()
  return updated!
}

// ── invites ─────────────────────────────────────────────────────────────────

export async function createInvite(
  db: Database,
  leagueId: string,
  userId: string,
  opts: { maxUses?: number; expiresInHours?: number } = {},
) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup', 'drafting', 'regular_season'])

  const expiresAt = opts.expiresInHours
    ? new Date(Date.now() + opts.expiresInHours * 3600_000)
    : null

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [invite] = await db
        .insert(schema.leagueInvites)
        .values({
          leagueId,
          code: generateInviteCode(),
          createdBy: userId,
          maxUses: opts.maxUses ?? null,
          expiresAt,
        })
        .returning()
      return invite!
    } catch (err) {
      // Unique violation on `code` — a fresh code, not a failure.
      if (attempt === 4) throw err
    }
  }
  throw conflict(ERROR_CODES.CONFLICT, 'could not allocate an invite code')
}

export async function revokeInvite(db: Database, leagueId: string, code: string) {
  const [updated] = await db
    .update(schema.leagueInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.leagueInvites.leagueId, leagueId), eq(schema.leagueInvites.code, code)))
    .returning()
  if (!updated) throw notFound(ERROR_CODES.INVITE_INVALID, 'invite not found')
  return updated
}

// ── membership ──────────────────────────────────────────────────────────────

async function assertCanJoin(db: Database, leagueId: string, userId: string) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup'])

  const existing = await db.query.leagueMembers.findFirst({
    where: and(
      eq(schema.leagueMembers.leagueId, leagueId),
      eq(schema.leagueMembers.userId, userId),
    ),
  })
  if (existing?.status === 'active') throw alreadyMember()

  const settings = await findSettings(db, leagueId)
  const members = await countActiveMembers(db, leagueId)
  if (settings && members >= settings.maxMembers) throw leagueFull()

  return { league, existing }
}

export async function joinPublicLeague(
  db: Database,
  leagueId: string,
  userId: string,
  teamName?: string,
) {
  const { league, existing } = await assertCanJoin(db, leagueId, userId)
  if (league.visibility !== 'public') throw leagueNotFound()
  return upsertMember(db, leagueId, userId, existing?.id, teamName)
}

export async function joinByCode(db: Database, code: string, userId: string, teamName?: string) {
  const invite = await findInviteByCode(db, code)
  if (!invite || invite.revokedAt) {
    throw notFound(ERROR_CODES.INVITE_INVALID, 'this invite is not valid')
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    throw conflict(ERROR_CODES.INVITE_EXPIRED, 'this invite has expired')
  }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    throw conflict(ERROR_CODES.INVITE_EXHAUSTED, 'this invite has been used up')
  }

  const { existing } = await assertCanJoin(db, invite.leagueId, userId)
  const member = await upsertMember(db, invite.leagueId, userId, existing?.id, teamName)

  await db
    .update(schema.leagueInvites)
    .set({ uses: sql`${schema.leagueInvites.uses} + 1` })
    .where(eq(schema.leagueInvites.id, invite.id))

  return { member, leagueId: invite.leagueId }
}

async function upsertMember(
  db: Database,
  leagueId: string,
  userId: string,
  existingId: string | undefined,
  teamName?: string,
) {
  if (existingId) {
    const [revived] = await db
      .update(schema.leagueMembers)
      .set({ status: 'active', role: 'player', teamName: teamName ?? null })
      .where(eq(schema.leagueMembers.id, existingId))
      .returning()
    return revived!
  }
  const [member] = await db
    .insert(schema.leagueMembers)
    .values({ leagueId, userId, role: 'player', teamName: teamName ?? null })
    .returning()
  return member!
}

export async function leaveLeague(db: Database, leagueId: string, userId: string) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup'])
  if (league.hostId === userId) {
    throw conflict(
      ERROR_CODES.CANNOT_REMOVE_HOST,
      'transfer the host role before leaving your own league',
    )
  }
  await db
    .update(schema.leagueMembers)
    .set({ status: 'removed' })
    .where(
      and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.userId, userId)),
    )
}

export async function removeMember(
  db: Database,
  leagueId: string,
  memberId: string,
  actorId: string,
) {
  const league = await getLeagueOr404(db, leagueId)
  const member = await db.query.leagueMembers.findFirst({
    where: and(eq(schema.leagueMembers.id, memberId), eq(schema.leagueMembers.leagueId, leagueId)),
  })
  if (!member) throw notFound(ERROR_CODES.NOT_FOUND, 'member not found')
  if (member.userId === league.hostId) {
    throw conflict(ERROR_CODES.CANNOT_REMOVE_HOST, 'the host cannot be removed')
  }

  // Before the draft a member can be deleted outright; afterwards their picks
  // are woven into the draft's history, so they are only marked inactive.
  if (league.status === 'setup') {
    await db.delete(schema.leagueMembers).where(eq(schema.leagueMembers.id, memberId))
  } else {
    await db
      .update(schema.leagueMembers)
      .set({ status: 'removed' })
      .where(eq(schema.leagueMembers.id, memberId))
  }

  await recordAudit(db, {
    actorId,
    leagueId,
    action: 'member.removed',
    targetType: 'member',
    targetId: memberId,
  })
}

export async function updateMember(
  db: Database,
  leagueId: string,
  memberId: string,
  patch: { role?: 'host' | 'cohost' | 'player' | 'spectator'; teamName?: string | null },
  actorId: string,
) {
  const league = await getLeagueOr404(db, leagueId)
  const member = await db.query.leagueMembers.findFirst({
    where: and(eq(schema.leagueMembers.id, memberId), eq(schema.leagueMembers.leagueId, leagueId)),
  })
  if (!member) throw notFound(ERROR_CODES.NOT_FOUND, 'member not found')

  // Promoting someone to host is a transfer, not a second host: the old host
  // becomes a cohost in the same transaction so the league always has exactly one.
  if (patch.role === 'host') {
    return db.transaction(async (tx) => {
      await tx
        .update(schema.leagueMembers)
        .set({ role: 'cohost' })
        .where(
          and(
            eq(schema.leagueMembers.leagueId, leagueId),
            eq(schema.leagueMembers.userId, league.hostId),
          ),
        )
      const [updated] = await tx
        .update(schema.leagueMembers)
        .set({ role: 'host', ...(patch.teamName !== undefined && { teamName: patch.teamName }) })
        .where(eq(schema.leagueMembers.id, memberId))
        .returning()
      await tx
        .update(schema.leagues)
        .set({ hostId: member.userId })
        .where(eq(schema.leagues.id, leagueId))
      await recordAudit(tx, {
        actorId,
        leagueId,
        action: 'league.host_transferred',
        targetType: 'member',
        targetId: memberId,
      })
      return updated!
    })
  }

  if (member.userId === league.hostId && patch.role) {
    throw conflict(
      ERROR_CODES.CANNOT_REMOVE_HOST,
      'transfer the host role to someone else instead of demoting yourself',
    )
  }

  const [updated] = await db
    .update(schema.leagueMembers)
    .set(patch)
    .where(eq(schema.leagueMembers.id, memberId))
    .returning()
  return updated!
}

export async function updateOwnMembership(
  db: Database,
  leagueId: string,
  userId: string,
  patch: { teamName?: string | null; teamLogoUrl?: string | null },
) {
  const member = await findMembership(db, leagueId, userId)
  if (!member) throw leagueNotFound()
  const [updated] = await db
    .update(schema.leagueMembers)
    .set(patch)
    .where(eq(schema.leagueMembers.id, member.id))
    .returning()
  return updated!
}

// ── draft order ─────────────────────────────────────────────────────────────

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export async function setDraftOrder(
  db: Database,
  leagueId: string,
  input: { mode: 'random' | 'manual'; order?: string[] },
  actorId: string,
) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup'])

  const members = await db
    .select({ id: schema.leagueMembers.id })
    .from(schema.leagueMembers)
    .where(
      and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.status, 'active')),
    )
  const ids = members.map((m) => m.id)

  let ordered: string[]
  if (input.mode === 'random') {
    ordered = shuffle(ids)
  } else {
    const given = input.order ?? []
    const sameSet =
      given.length === ids.length &&
      new Set(given).size === ids.length &&
      given.every((id) => ids.includes(id))
    if (!sameSet) {
      throw badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'a manual order must list every active member exactly once',
        { expected: ids.length, received: given.length },
      )
    }
    ordered = given
  }

  await db.transaction(async (tx) => {
    for (const [i, memberId] of ordered.entries()) {
      await tx
        .update(schema.leagueMembers)
        .set({ draftPosition: i + 1 })
        .where(eq(schema.leagueMembers.id, memberId))
    }
    await recordAudit(tx, {
      actorId,
      leagueId,
      action: 'league.draft_order_set',
      targetType: 'league',
      targetId: leagueId,
      meta: { mode: input.mode, order: ordered },
    })
  })

  return ordered.map((memberId, i) => ({ memberId, draftPosition: i + 1 }))
}
