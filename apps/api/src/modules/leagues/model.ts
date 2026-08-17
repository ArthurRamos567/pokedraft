import { SETTINGS_LIMITS as L } from '@pokedraft/shared'
import { t } from 'elysia'
import { MAX_BYTES } from '../points/parse'

export const Visibility = t.Union([t.Literal('public'), t.Literal('private')])
export const Status = t.Union([
  t.Literal('setup'),
  t.Literal('drafting'),
  t.Literal('regular_season'),
  t.Literal('playoffs'),
  t.Literal('complete'),
  t.Literal('archived'),
])
export const Role = t.Union([
  t.Literal('host'),
  t.Literal('cohost'),
  t.Literal('player'),
  t.Literal('spectator'),
])

export const SettingsSchema = t.Object({
  draftMode: t.Union([t.Literal('live'), t.Literal('async')]),
  draftType: t.Union([t.Literal('snake'), t.Literal('linear')]),
  /** Live drafts: the shot clock per pick. */
  pickSeconds: t.Integer({ minimum: L.pickSeconds.min, maximum: L.pickSeconds.max }),
  /** Async drafts: how long a turn may sit before autopick fires. */
  turnHours: t.Integer({ minimum: L.turnHours.min, maximum: L.turnHours.max }),
  budget: t.Integer({ minimum: L.budget.min, maximum: L.budget.max }),
  rosterMin: t.Integer({ minimum: L.roster.min, maximum: L.roster.max }),
  rosterMax: t.Integer({ minimum: L.roster.min, maximum: L.roster.max }),
  allowUndrafted: t.Boolean(),
  maxMembers: t.Integer({ minimum: L.maxMembers.min, maximum: L.maxMembers.max }),
  tradesEnabled: t.Boolean(),
  tradesRequireHostApproval: t.Boolean(),
  tradeDeadlineWeek: t.Nullable(
    t.Integer({ minimum: L.tradeDeadlineWeek.min, maximum: L.tradeDeadlineWeek.max }),
  ),
  autopickPolicy: t.Union([
    t.Literal('skip'),
    t.Literal('queue_then_skip'),
    t.Literal('queue_then_best'),
  ]),
})

export const SettingsPatch = t.Partial(SettingsSchema)

export const LeagueSchema = t.Object({
  id: t.String(),
  slug: t.String(),
  name: t.String(),
  description: t.Nullable(t.String()),
  visibility: Visibility,
  status: Status,
  formatId: t.String(),
  hostId: t.String(),
  logoUrl: t.Nullable(t.String()),
  bannerUrl: t.Nullable(t.String()),
  createdAt: t.Date(),
  updatedAt: t.Date(),
})

export const MemberSchema = t.Object({
  id: t.String(),
  userId: t.String(),
  role: Role,
  teamName: t.Nullable(t.String()),
  teamLogoUrl: t.Nullable(t.String()),
  draftPosition: t.Nullable(t.Integer()),
  status: t.Union([t.Literal('active'), t.Literal('removed')]),
  joinedAt: t.Date(),
  displayName: t.Nullable(t.String()),
  name: t.String(),
  avatarUrl: t.Nullable(t.String()),
})

/**
 * The pool a league starts with, carrying the hash of the preview the host was
 * shown by `POST /points/preview`. Same preview-then-commit contract as a
 * mid-setup import, just folded into the create call.
 */
export const CreatePoolInput = t.Object({
  source: t.String({ maxLength: MAX_BYTES }),
  hash: t.String({ minLength: 64, maxLength: 64 }),
  allowIllegal: t.Optional(t.Boolean()),
  name: t.Optional(t.String({ maxLength: 120 })),
})

export const CreateLeagueBody = t.Object({
  name: t.String({ minLength: 3, maxLength: 80 }),
  description: t.Optional(t.String({ maxLength: 2000 })),
  visibility: t.Optional(Visibility),
  formatId: t.String({ minLength: 3, maxLength: 64 }),
  teamName: t.Optional(t.String({ maxLength: 60 })),
  settings: t.Optional(SettingsPatch),
  pool: t.Optional(CreatePoolInput),
})

export const UpdateLeagueBody = t.Partial(
  t.Object({
    name: t.String({ minLength: 3, maxLength: 80 }),
    description: t.Nullable(t.String({ maxLength: 2000 })),
    visibility: Visibility,
    formatId: t.String({ minLength: 3, maxLength: 64 }),
    logoUrl: t.Nullable(t.String({ maxLength: 500 })),
    bannerUrl: t.Nullable(t.String({ maxLength: 500 })),
  }),
)

export const InviteSchema = t.Object({
  id: t.String(),
  code: t.String(),
  maxUses: t.Nullable(t.Integer()),
  uses: t.Integer(),
  expiresAt: t.Nullable(t.Date()),
  revokedAt: t.Nullable(t.Date()),
  createdAt: t.Date(),
  url: t.String(),
})

export const DirectoryItem = t.Object({
  id: t.String(),
  slug: t.String(),
  name: t.String(),
  description: t.Nullable(t.String()),
  status: Status,
  formatId: t.String(),
  logoUrl: t.Nullable(t.String()),
  bannerUrl: t.Nullable(t.String()),
  createdAt: t.Date(),
  memberCount: t.Integer(),
  maxMembers: t.Nullable(t.Integer()),
})
