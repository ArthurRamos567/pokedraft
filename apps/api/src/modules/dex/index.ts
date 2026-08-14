import {
  checkLegality,
  getAbility,
  getFormatInfo,
  getMove,
  getSpeciesForFormat,
  listFormats,
  movePool,
  resolveMany,
  searchSpecies,
  toDetail,
} from '@pokedraft/dex'
import { ERROR_CODES } from '@pokedraft/shared'
import { Elysia, t } from 'elysia'
import { notFound } from '../../errors'
import {
  AbilitySchema,
  FormatSchema,
  MoveSchema,
  ResolveBody,
  ResolveResponse,
  SpeciesCardSchema,
  SpeciesDetailSchema,
  SpeciesQuerySchema,
} from './model'

/** Reference data, identical for everyone — cache it hard, require no auth. */
const CACHE = 'public, max-age=3600'

export const dexModule = new Elysia({ prefix: '/dex', tags: ['dex'] })
  .onAfterHandle(({ set }) => {
    // A handler that set its own policy (POST /resolve) keeps it.
    set.headers['cache-control'] ??= CACHE
  })
  .get('/formats', ({ query }) => listFormats({ supportedOnly: query.all !== true, q: query.q }), {
    query: t.Object({ all: t.Optional(t.Boolean()), q: t.Optional(t.String({ maxLength: 64 })) }),
    response: t.Array(FormatSchema),
    detail: { summary: 'Curated format list; `all=true` searches every Showdown format.' },
  })
  .get(
    '/formats/:id',
    ({ params }) => {
      const info = getFormatInfo(params.id)
      if (!info) throw notFound(ERROR_CODES.FORMAT_NOT_FOUND, `unknown format: ${params.id}`)
      return info
    },
    { params: t.Object({ id: t.String() }), response: FormatSchema },
  )
  .get('/species', ({ query }) => searchSpecies(query), {
    query: SpeciesQuerySchema,
    response: t.Object({
      items: t.Array(SpeciesCardSchema),
      total: t.Integer(),
      limit: t.Integer(),
      offset: t.Integer(),
    }),
  })
  .get(
    '/species/:id',
    ({ params, query }) => {
      const format = query.format ?? 'gen9ou'
      const s = getSpeciesForFormat(params.id, format)
      if (!s) throw notFound(ERROR_CODES.SPECIES_NOT_FOUND, `unknown species: ${params.id}`)

      const legality = checkLegality(s.id, format)
      return {
        ...toDetail(s, format),
        legal: {
          format,
          legal: legality.legal,
          ...(legality.legal ? {} : { reason: legality.reason }),
        },
      }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ format: t.Optional(t.String({ maxLength: 64 })) }),
      response: SpeciesDetailSchema,
    },
  )
  .get(
    '/species/:id/learnset',
    async ({ params, query }) => {
      const format = query.format ?? 'gen9ou'
      const s = getSpeciesForFormat(params.id, format)
      if (!s) throw notFound(ERROR_CODES.SPECIES_NOT_FOUND, `unknown species: ${params.id}`)
      return { species: s.id, format, moves: await movePool(s.id, format) }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ format: t.Optional(t.String({ maxLength: 64 })) }),
      response: t.Object({
        species: t.String(),
        format: t.String(),
        moves: t.Array(MoveSchema),
      }),
    },
  )
  .get(
    '/moves/:id',
    ({ params }) => {
      const m = getMove(params.id)
      if (!m) throw notFound(ERROR_CODES.MOVE_NOT_FOUND, `unknown move: ${params.id}`)
      return m
    },
    { params: t.Object({ id: t.String() }), response: MoveSchema },
  )
  .get(
    '/abilities/:id',
    ({ params }) => {
      const a = getAbility(params.id)
      if (!a) throw notFound(ERROR_CODES.ABILITY_NOT_FOUND, `unknown ability: ${params.id}`)
      return a
    },
    { params: t.Object({ id: t.String() }), response: AbilitySchema },
  )
  /**
   * The one place human-typed names become dex ids — used by the points import
   * and, later, by match reporting. Unmatched names come back with suggestions
   * the *user* confirms; nothing is auto-corrected.
   */
  .post(
    '/resolve',
    ({ body, set }) => {
      set.headers['cache-control'] = 'no-store'
      const results = resolveMany(body.names, { format: body.format })
      const resolved: { input: string; id: string; name: string; method: string }[] = []
      const unmatched: {
        input: string
        suggestions: { id: string; name: string; score: number }[]
      }[] = []
      for (const r of results) {
        if (r.ok) resolved.push({ input: r.input, id: r.id, name: r.name, method: r.method })
        else unmatched.push({ input: r.input, suggestions: r.suggestions })
      }
      return { resolved, unmatched }
    },
    { body: ResolveBody, response: ResolveResponse },
  )
