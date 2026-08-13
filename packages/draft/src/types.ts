export type MemberId = string
export type SpeciesId = string

export type PointEntry = { points: number; banned: boolean }

export type DraftConfig = {
  type: 'snake' | 'linear'
  budget: number
  rosterMin: number
  rosterMax: number
  /** May a team finish short of `rosterMax`. */
  allowUndrafted: boolean
  /** Snapshot of the points list this draft was started with. */
  points: Record<SpeciesId, PointEntry>
}

export type Pick = {
  speciesId: SpeciesId
  cost: number
  round: number
  pickNo: number
  auto: boolean
}

export type TeamState = {
  picks: Pick[]
  spent: number
  skips: number
}

export type DraftStatus = 'pending' | 'active' | 'paused' | 'complete'

export type DraftState = {
  status: DraftStatus
  config: DraftConfig
  /** Draft position order, by member. */
  order: MemberId[]
  round: number
  /** Global monotonic pick counter; the next pick takes this number. */
  pickNo: number
  onClock: MemberId | null
  /** Epoch ms. Always carried on an event, never read from the clock here. */
  deadline: number | null
  taken: Record<SpeciesId, MemberId>
  teams: Record<MemberId, TeamState>
  /** Teams that can't or won't pick again. */
  complete: MemberId[]
}

export type FinishReason = 'roster_full' | 'budget_out' | 'manual'

export type DraftEvent =
  | { type: 'DRAFT_STARTED'; at: number; order: MemberId[]; config: DraftConfig }
  | {
      type: 'PICK_MADE'
      at: number
      memberId: MemberId
      speciesId: SpeciesId
      cost: number
      pickNo: number
      /** `queue` or `best` when a timer made the pick; absent when a human did. */
      auto?: 'queue' | 'best'
    }
  | { type: 'TURN_SKIPPED'; at: number; memberId: MemberId; reason: 'timeout' | 'manual' }
  | { type: 'PICK_UNDONE'; at: number; pickNo: number }
  | {
      type: 'TURN_ADVANCED'
      at: number
      onClock: MemberId | null
      round: number
      deadline: number | null
    }
  | { type: 'DRAFT_PAUSED'; at: number; reason?: string }
  | { type: 'DRAFT_RESUMED'; at: number }
  | { type: 'TEAM_FINISHED'; at: number; memberId: MemberId; reason: FinishReason }
  | { type: 'DRAFT_COMPLETED'; at: number }
  | { type: 'ORDER_CHANGED'; at: number; order: MemberId[] }

export type DraftEventType = DraftEvent['type']

/** Thrown by `apply` when an event cannot be reconciled with the state. */
export class InvalidEvent extends Error {
  readonly event: DraftEvent
  constructor(event: DraftEvent, message: string) {
    super(`${event.type}: ${message}`)
    this.name = 'InvalidEvent'
    this.event = event
  }
}

export type ValidationCode =
  | 'DRAFT_NOT_ACTIVE'
  | 'NOT_YOUR_TURN'
  | 'SPECIES_NOT_IN_POOL'
  | 'SPECIES_BANNED'
  | 'SPECIES_ALREADY_PICKED'
  | 'INSUFFICIENT_POINTS'
  | 'ROSTER_FULL'
  | 'ROSTER_UNREACHABLE'

export type ValidationResult =
  | { ok: true; cost: number }
  | { ok: false; code: ValidationCode; message: string; details?: Record<string, unknown> }
