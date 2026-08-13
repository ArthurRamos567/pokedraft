import { getSpeciesForFormat, toCard } from '@pokedraft/dex'
import { ERROR_CODES } from '@pokedraft/shared'
import { Elysia, t } from 'elysia'
import { db } from '../../db'
import { notFound } from '../../errors'
import { authPlugin } from '../../plugins/auth'
import { leaguePlugin, mustUser } from '../../plugins/league'
import { MAX_BYTES } from './parse'
import {
  activeList,
  commitImport,
  editEntry,
  listEntries,
  listVersions,
  previewImport,
} from './service'

const ClassifiedRow = t.Object({
  input: t.String(),
  speciesId: t.Nullable(t.String()),
  name: t.Nullable(t.String()),
  points: t.Number(),
  banned: t.Boolean(),
  status: t.Union([
    t.Literal('ok'),
    t.Literal('illegal'),
    t.Literal('unknown'),
    t.Literal('duplicate'),
  ]),
  reason: t.Optional(t.String()),
  suggestions: t.Optional(
    t.Array(t.Object({ id: t.String(), name: t.String(), score: t.Number() })),
  ),
})

const PreviewResponse = t.Object({
  hash: t.String(),
  nextVersion: t.Integer(),
  summary: t.Object({
    ok: t.Integer(),
    illegal: t.Integer(),
    unknown: t.Integer(),
    duplicates: t.Integer(),
  }),
  diff: t.Object({
    added: t.Array(t.Object({ speciesId: t.String(), points: t.Number() })),
    removed: t.Array(t.Object({ speciesId: t.String(), points: t.Number() })),
    repriced: t.Array(t.Object({ speciesId: t.String(), from: t.Number(), to: t.Number() })),
  }),
  rows: t.Array(ClassifiedRow),
})

const SourceBody = t.Object({
  source: t.String({ maxLength: MAX_BYTES }),
  allowIllegal: t.Optional(t.Boolean()),
})

export const pointsModule = new Elysia({ prefix: '/leagues/:id/points', tags: ['points'] })
  .use(authPlugin)
  .use(leaguePlugin)
  .post(
    '/preview',
    ({ league, body }) =>
      previewImport(db, league.id, body.source, { allowIllegal: body.allowIllegal }),
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      body: SourceBody,
      response: PreviewResponse,
      detail: { summary: 'Writes nothing. Returns the hash that /commit must carry.' },
    },
  )
  .post(
    '/commit',
    async ({ league, user, body, status }) => {
      const { list, entryCount } = await commitImport(db, league.id, mustUser(user).id, body)
      return status(201, { id: list.id, version: list.version, entryCount })
    },
    {
      league: 'host',
      params: t.Object({ id: t.String() }),
      body: t.Composite([
        SourceBody,
        t.Object({ hash: t.String(), name: t.Optional(t.String({ maxLength: 120 })) }),
      ]),
      response: {
        201: t.Object({ id: t.String(), version: t.Integer(), entryCount: t.Integer() }),
      },
      detail: { summary: 'A stale hash is a 409 — nobody commits a diff they did not see.' },
    },
  )
  .get(
    '/',
    async ({ league }) => {
      const list = await activeList(db, league.id)
      if (!list) return { list: null, entries: [] }
      const entries = await listEntries(db, list.id)
      return {
        list: {
          id: list.id,
          version: list.version,
          name: list.name,
          lockedAt: list.lockedAt,
          createdAt: list.createdAt,
        },
        // Joined with dex data here so no other module needs to know how
        // points are stored.
        entries: entries.map((e) => {
          const s = getSpeciesForFormat(e.speciesId, league.formatId)
          return { ...e, species: s ? toCard(s) : null }
        }),
      }
    },
    {
      league: 'public',
      params: t.Object({ id: t.String() }),
      response: t.Object({
        list: t.Nullable(
          t.Object({
            id: t.String(),
            version: t.Integer(),
            name: t.Nullable(t.String()),
            lockedAt: t.Nullable(t.Date()),
            createdAt: t.Date(),
          }),
        ),
        entries: t.Array(
          t.Object({
            speciesId: t.String(),
            points: t.Integer(),
            banned: t.Boolean(),
            notes: t.Nullable(t.String()),
            species: t.Nullable(t.Any()),
          }),
        ),
      }),
    },
  )
  .get('/versions', ({ league }) => listVersions(db, league.id), {
    league: 'member',
    params: t.Object({ id: t.String() }),
    response: t.Array(
      t.Object({
        id: t.String(),
        version: t.Integer(),
        name: t.Nullable(t.String()),
        source: t.String(),
        lockedAt: t.Nullable(t.Date()),
        createdAt: t.Date(),
        createdBy: t.Nullable(t.String()),
        entryCount: t.Integer(),
      }),
    ),
  })
  .patch(
    '/entries/:speciesId',
    async ({ league, user, params, body }) => {
      const s = getSpeciesForFormat(params.speciesId, league.formatId)
      if (!s) throw notFound(ERROR_CODES.SPECIES_NOT_FOUND, `unknown species: ${params.speciesId}`)
      const { list, entryCount } = await editEntry(db, league.id, mustUser(user).id, s.id, body)
      return { id: list.id, version: list.version, entryCount }
    },
    {
      league: 'host',
      params: t.Object({ id: t.String(), speciesId: t.String() }),
      body: t.Object({
        points: t.Optional(t.Integer({ minimum: 0, maximum: 1000 })),
        banned: t.Optional(t.Boolean()),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        remove: t.Optional(t.Boolean()),
      }),
      response: t.Object({ id: t.String(), version: t.Integer(), entryCount: t.Integer() }),
      detail: { summary: 'Creates a new version — prices are never edited in place.' },
    },
  )
