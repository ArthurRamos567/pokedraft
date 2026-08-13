import { t } from 'elysia'

/**
 * `t` comes from Elysia rather than `@sinclair/typebox` directly: TypeBox
 * identifies schemas with symbols, so two copies of the library silently fail
 * to validate each other's schemas. One instance, borrowed from the framework.
 */
export { t }

export const ErrorResponse = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    details: t.Optional(t.Unknown()),
  }),
})
export type ErrorResponse = typeof ErrorResponse.static

export const UuidParam = t.String({ format: 'uuid' })

export const Slug = t.String({ minLength: 3, maxLength: 64, pattern: '^[a-z0-9-]+$' })

/** Canonical dex id: `landorustherian`. Never a display name. */
export const SpeciesId = t.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9]+$' })

export const InviteCode = t.String({ minLength: 6, maxLength: 12, pattern: '^[A-Z2-7]+$' })

export const PaginationQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
})

export function Paginated<T extends Parameters<typeof t.Array>[0]>(item: T) {
  return t.Object({
    items: t.Array(item),
    total: t.Integer(),
    limit: t.Integer(),
    offset: t.Integer(),
  })
}

export const Timestamps = {
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
}
