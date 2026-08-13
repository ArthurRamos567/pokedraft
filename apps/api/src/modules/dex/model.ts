import { t } from 'elysia'

export const SpeciesCardSchema = t.Object({
  id: t.String(),
  name: t.String(),
  num: t.Integer(),
  types: t.Array(t.String()),
  abilities: t.Array(t.String()),
  baseStats: t.Object({
    hp: t.Integer(),
    atk: t.Integer(),
    def: t.Integer(),
    spa: t.Integer(),
    spd: t.Integer(),
    spe: t.Integer(),
  }),
  bst: t.Integer(),
  tier: t.Nullable(t.String()),
  baseSpecies: t.Nullable(t.String()),
  forme: t.Nullable(t.String()),
})

export const SpeciesDetailSchema = t.Composite([
  SpeciesCardSchema,
  t.Object({
    weightkg: t.Number(),
    eggGroups: t.Array(t.String()),
    prevo: t.Nullable(t.String()),
    evos: t.Array(t.String()),
    evolutionLine: t.Array(t.String()),
    isCosmeticForme: t.Boolean(),
    otherFormes: t.Array(t.String()),
    genIntroduced: t.Integer(),
    nonstandard: t.Nullable(t.String()),
    legal: t.Optional(
      t.Object({
        format: t.String(),
        legal: t.Boolean(),
        reason: t.Optional(t.String()),
      }),
    ),
  }),
])

export const FormatSchema = t.Object({
  id: t.String(),
  name: t.String(),
  gen: t.Integer(),
  gameType: t.String(),
  rules: t.Array(t.String()),
  supported: t.Boolean(),
})

export const MoveSchema = t.Object({
  id: t.String(),
  name: t.String(),
  type: t.String(),
  category: t.Union([t.Literal('Physical'), t.Literal('Special'), t.Literal('Status')]),
  basePower: t.Integer(),
  accuracy: t.Union([t.Integer(), t.Literal(true)]),
  pp: t.Integer(),
  priority: t.Integer(),
  target: t.String(),
  shortDesc: t.String(),
})

export const AbilitySchema = t.Object({
  id: t.String(),
  name: t.String(),
  shortDesc: t.String(),
  desc: t.String(),
})

export const ResolveBody = t.Object({
  names: t.Array(t.String({ maxLength: 64 }), { minItems: 1, maxItems: 2000 }),
  format: t.Optional(t.String({ maxLength: 64 })),
})

export const ResolveResponse = t.Object({
  resolved: t.Array(
    t.Object({
      input: t.String(),
      id: t.String(),
      name: t.String(),
      method: t.String(),
    }),
  ),
  unmatched: t.Array(
    t.Object({
      input: t.String(),
      suggestions: t.Array(t.Object({ id: t.String(), name: t.String(), score: t.Number() })),
    }),
  ),
})

export const SpeciesQuerySchema = t.Object({
  format: t.Optional(t.String({ maxLength: 64 })),
  q: t.Optional(t.String({ maxLength: 64 })),
  type: t.Optional(t.String({ maxLength: 16 })),
  ability: t.Optional(t.String({ maxLength: 32 })),
  minBst: t.Optional(t.Integer({ minimum: 0, maximum: 1000 })),
  maxBst: t.Optional(t.Integer({ minimum: 0, maximum: 1000 })),
  sort: t.Optional(
    t.Union([
      t.Literal('num'),
      t.Literal('name'),
      t.Literal('bst'),
      t.Literal('hp'),
      t.Literal('atk'),
      t.Literal('def'),
      t.Literal('spa'),
      t.Literal('spd'),
      t.Literal('spe'),
    ]),
  ),
  dir: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
  includeCosmetic: t.Optional(t.Boolean()),
})
