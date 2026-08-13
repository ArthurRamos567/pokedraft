import { and, asc, type Database, eq, schema } from '@pokedraft/db'
import {
  type AutopickPolicy,
  autopick,
  type CommandResult,
  type DraftConfig,
  type DraftEvent,
  type DraftState,
  initialState,
  makePick,
  pauseDraft,
  replay,
  resumeDraft,
  skipTurn,
  startDraft,
} from '@pokedraft/draft'
import { ERROR_CODES, type ErrorCode } from '@pokedraft/shared'
import { badRequest, conflict, DomainError, notFound } from '../../errors'
import { getLeagueOr404 } from '../leagues/service'
import { assertStatus } from '../leagues/status'
import { activeList, listEntries, lockActiveList } from '../points/service'
import { recordAudit } from '../system/service'
import {
  appendEvents,
  deletePicksFrom,
  findDraft,
  insertPickProjections,
  lockDraft,
  readEvents,
  readQueue,
  saveState,
  toDomainEvents,
  truncateFrom,
} from './repo'

export type Settings = typeof schema.leagueSettings.$inferSelect

/** Live drafts run on a per-pick clock; async ones on a per-turn one. */
export function deadlineFrom(settings: Settings, at: number): number {
  return settings.draftMode === 'live'
    ? at + settings.pickSeconds * 1000
    : at + settings.turnHours * 3600_000
}

function hydrate(row: { state: unknown }): DraftState {
  return row.state as DraftState
}

async function loadSettings(db: Database, leagueId: string): Promise<Settings> {
  const s = await db.query.leagueSettings.findFirst({
    where: eq(schema.leagueSettings.leagueId, leagueId),
  })
  if (!s) throw notFound(ERROR_CODES.LEAGUE_NOT_FOUND, 'league settings missing')
  return s
}

async function orderedMembers(db: Database, leagueId: string) {
  return db
    .select({ id: schema.leagueMembers.id, draftPosition: schema.leagueMembers.draftPosition })
    .from(schema.leagueMembers)
    .where(
      and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.status, 'active')),
    )
    .orderBy(asc(schema.leagueMembers.draftPosition), asc(schema.leagueMembers.joinedAt))
}

export async function getDraftOr404(db: Database, leagueId: string) {
  const draft = await findDraft(db, leagueId)
  if (!draft) throw notFound(ERROR_CODES.DRAFT_NOT_FOUND, 'this league has no draft yet')
  return draft
}

/**
 * Freezes the price list, the member order and the rules into a config the
 * engine owns. Nothing here is re-read later: a draft is replayed against the
 * config it started with, whatever the league does afterwards.
 */
export async function startLeagueDraft(db: Database, leagueId: string, actorId: string) {
  const league = await getLeagueOr404(db, leagueId)
  assertStatus(league, ['setup'])

  const settings = await loadSettings(db, leagueId)
  const members = await orderedMembers(db, leagueId)
  if (members.length < 2) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'a draft needs at least two teams')
  }
  if (members.some((m) => m.draftPosition === null)) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'draw the draft order before starting the draft')
  }

  const list = await activeList(db, leagueId)
  if (!list) {
    throw badRequest(ERROR_CODES.POINTS_LIST_NOT_FOUND, 'import a points list before drafting')
  }
  const entries = await listEntries(db, list.id)
  if (entries.length === 0) {
    throw badRequest(ERROR_CODES.POINTS_LIST_NOT_FOUND, 'the points list is empty')
  }

  const config: DraftConfig = {
    type: settings.draftType,
    budget: settings.budget,
    rosterMin: settings.rosterMin,
    rosterMax: settings.rosterMax,
    allowUndrafted: settings.allowUndrafted,
    points: Object.fromEntries(
      entries.map((e) => [e.speciesId, { points: e.points, banned: e.banned }]),
    ),
  }

  const order = members.map((m) => m.id)
  const at = Date.now()
  const result = startDraft(initialState(config, order), {
    order,
    config,
    at,
    deadline: deadlineFrom(settings, at),
  })
  if (!result.ok) throw conflict(ERROR_CODES.DRAFT_NOT_ACTIVE, result.error.message)

  return db.transaction(async (tx) => {
    const existing = await findDraft(tx, leagueId)
    if (existing) {
      throw conflict(ERROR_CODES.DRAFT_ALREADY_STARTED, 'this league already has a draft')
    }

    const [draft] = await tx
      .insert(schema.drafts)
      .values({
        leagueId,
        pointListId: list.id,
        status: result.state.status,
        state: result.state as unknown as Record<string, unknown>,
        seq: result.events.length,
        startedAt: new Date(at),
      })
      .returning()
    if (!draft) throw new Error('draft insert returned nothing')

    await appendEvents(tx, draft.id, 0, result.events, actorId)
    await lockActiveList(tx, leagueId)
    await tx
      .update(schema.leagues)
      .set({ status: 'drafting' })
      .where(eq(schema.leagues.id, leagueId))
    await recordAudit(tx, {
      actorId,
      leagueId,
      action: 'draft.started',
      targetType: 'draft',
      targetId: draft.id,
    })

    return { draft, state: result.state, events: result.events }
  })
}

const CODE_MAP: Record<string, ErrorCode> = {
  DRAFT_NOT_ACTIVE: ERROR_CODES.DRAFT_NOT_ACTIVE,
  NOT_YOUR_TURN: ERROR_CODES.NOT_YOUR_TURN,
  SPECIES_NOT_IN_POOL: ERROR_CODES.SPECIES_NOT_IN_POOL,
  SPECIES_BANNED: ERROR_CODES.SPECIES_BANNED,
  SPECIES_ALREADY_PICKED: ERROR_CODES.SPECIES_ALREADY_PICKED,
  INSUFFICIENT_POINTS: ERROR_CODES.INSUFFICIENT_POINTS,
  ROSTER_FULL: ERROR_CODES.ROSTER_FULL,
  ROSTER_UNREACHABLE: ERROR_CODES.ROSTER_UNREACHABLE,
}

function toDomainError(error: Extract<CommandResult, { ok: false }>['error']): DomainError {
  const code = CODE_MAP[error.code] ?? ERROR_CODES.CONFLICT
  const status = error.code === 'SPECIES_ALREADY_PICKED' ? 409 : 422
  return new DomainError(code, error.message, status, error.details)
}

export type CommitResult = {
  state: DraftState
  events: DraftEvent[]
  seq: number
  warnings: string[]
}

/**
 * The one write path. Everything mutating goes through here so the lock, the
 * append, the projection and the state cache can never drift apart.
 *
 * `decide` runs *inside* the transaction against freshly locked state — a
 * decision made against a stale read would be exactly the race this guards.
 */
export async function commit(
  db: Database,
  leagueId: string,
  actorId: string | null,
  decide: (state: DraftState, settings: Settings) => CommandResult | null,
): Promise<CommitResult | null> {
  const draft = await getDraftOr404(db, leagueId)
  const settings = await loadSettings(db, leagueId)

  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, draft.id)
    if (!locked) throw notFound(ERROR_CODES.DRAFT_NOT_FOUND, 'draft vanished')

    const state = hydrate(locked)
    const result = decide(state, settings)
    if (result === null) return null
    if (!result.ok) throw toDomainError(result.error)

    await appendEvents(tx, draft.id, locked.seq, result.events, actorId)
    await insertPickProjections(tx, draft.id, result.events, result.state)
    const seq = locked.seq + result.events.length
    await saveState(tx, draft.id, result.state, seq)

    if (result.state.status === 'complete') {
      await tx
        .update(schema.leagues)
        .set({ status: 'regular_season' })
        .where(eq(schema.leagues.id, leagueId))
    }

    return { state: result.state, events: result.events, seq, warnings: result.warnings }
  })
}

export function pick(
  db: Database,
  leagueId: string,
  actorId: string,
  input: { memberId: string; speciesId: string; asHost?: boolean },
) {
  return commit(db, leagueId, actorId, (state, settings) => {
    const at = Date.now()
    return makePick(state, {
      memberId: input.memberId,
      speciesId: input.speciesId,
      at,
      deadline: deadlineFrom(settings, at),
      asHost: input.asHost,
    })
  })
}

export function skip(
  db: Database,
  leagueId: string,
  actorId: string,
  input: { memberId: string; reason: 'timeout' | 'manual'; finish?: boolean },
) {
  return commit(db, leagueId, actorId, (state, settings) => {
    const at = Date.now()
    return skipTurn(state, {
      memberId: input.memberId,
      at,
      deadline: deadlineFrom(settings, at),
      reason: input.reason,
      finish: input.finish,
    })
  })
}

export function pause(db: Database, leagueId: string, actorId: string, reason?: string) {
  return commit(db, leagueId, actorId, (state) => pauseDraft(state, Date.now(), reason))
}

export function resume(db: Database, leagueId: string, actorId: string) {
  return commit(db, leagueId, actorId, (state, settings) => {
    const at = Date.now()
    return resumeDraft(state, at, deadlineFrom(settings, at))
  })
}

/**
 * Undo deletes the trailing events and rebuilds by replay. Inverting `apply()`
 * would mean maintaining a second, subtly different implementation of every
 * rule — this way there is only ever one.
 */
export async function undoLastPick(db: Database, leagueId: string, actorId: string) {
  const draft = await getDraftOr404(db, leagueId)

  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, draft.id)
    if (!locked) throw notFound(ERROR_CODES.DRAFT_NOT_FOUND, 'draft vanished')

    const rows = await readEvents(tx, draft.id)
    const lastPick = [...rows].reverse().find((r) => r.type === 'PICK_MADE')
    if (!lastPick) throw conflict(ERROR_CODES.NOTHING_TO_UNDO, 'there is nothing to undo')

    await truncateFrom(tx, draft.id, lastPick.seq)
    await deletePicksFrom(tx, draft.id, (lastPick.payload as { pickNo: number }).pickNo)

    const kept = rows.filter((r) => r.seq < lastPick.seq)
    const state = replay(toDomainEvents(kept))
    await saveState(tx, draft.id, state, kept.length)
    await recordAudit(tx, {
      actorId,
      leagueId,
      action: 'draft.pick_undone',
      targetType: 'draft',
      targetId: draft.id,
      meta: { seq: lastPick.seq, payload: lastPick.payload },
    })

    return { state, events: [], seq: kept.length, warnings: [] }
  })
}

/** Rebuild from `draft_events` alone — the test that the cache is only a cache. */
export async function rebuildFromEvents(db: Database, leagueId: string): Promise<DraftState> {
  const draft = await getDraftOr404(db, leagueId)
  const rows = await readEvents(db, draft.id)
  return replay(toDomainEvents(rows))
}

/**
 * Called by the deadline job. Returns null when the clock has already moved on,
 * which is what makes a timer firing against a real pick harmless.
 */
export async function runDeadline(
  db: Database,
  leagueId: string,
  observed: { pickNo: number; onClock: string | null },
  /**
   * Read outside the lock and re-validated by `canPick` inside it, so a stale
   * queue can only cost a fallback pick — never a wrong one.
   */
  queue: readonly string[],
) {
  return commit(db, leagueId, null, (state, settings) => {
    if (state.status !== 'active') return null
    if (state.pickNo !== observed.pickNo || state.onClock !== observed.onClock) return null
    if (state.deadline === null || state.deadline > Date.now()) return null

    const memberId = state.onClock
    if (!memberId) return null

    const at = Date.now()
    const deadline = deadlineFrom(settings, at)
    const policy = settings.autopickPolicy as AutopickPolicy
    const choice = autopick(state, memberId, queue, policy)
    if (choice.action === 'pick') {
      return makePick(state, {
        memberId,
        speciesId: choice.speciesId,
        at,
        deadline,
        auto: choice.reason,
      })
    }
    return skipTurn(state, { memberId, at, deadline, reason: 'timeout' })
  })
}

export async function loadQueue(db: Database, memberId: string): Promise<string[]> {
  const rows = await readQueue(db, memberId)
  return rows.map((r) => r.speciesId)
}
