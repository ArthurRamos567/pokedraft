import { ERROR_CODES } from '@pokedraft/shared'
import { Elysia } from 'elysia'
import { DomainError } from '../errors'
import { logger } from './logger'

/**
 * The only place HTTP status codes are decided. Every response body on the
 * error path is `{ error: { code, message, details? } }`.
 *
 * Domain errors are matched with `instanceof` rather than Elysia's error code:
 * a service throwing from inside a macro's `resolve` doesn't necessarily carry
 * this plugin's error registry, and a 500 there would be a lie.
 */
export const errorsPlugin = new Elysia({ name: 'errors' }).onError(
  { as: 'global' },
  ({ code, error, set, request }) => {
    if (error instanceof DomainError) {
      set.status = error.status
      return { error: { code: error.code, message: error.message, details: error.details } }
    }

    if (code === 'VALIDATION') {
      set.status = 422
      return {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'request failed validation',
          details: error.all,
        },
      }
    }

    if (code === 'NOT_FOUND') {
      set.status = 404
      return { error: { code: ERROR_CODES.NOT_FOUND, message: 'route not found' } }
    }

    if (code === 'PARSE') {
      set.status = 400
      return { error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'malformed request body' } }
    }

    logger.error({ err: error, path: new URL(request.url).pathname, code }, 'unhandled error')
    set.status = 500
    return { error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'internal server error' } }
  },
)
