import { ERROR_CODES, type ErrorCode } from '@pokedraft/shared'

/**
 * Services throw these. They never set status codes and never throw strings —
 * the global `onError` in `plugins/errors.ts` is the only place that maps a
 * domain error onto HTTP.
 */
export class DomainError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export const badRequest = (code: ErrorCode, message: string, details?: unknown) =>
  new DomainError(code, message, 400, details)

export const unauthorized = (message = 'authentication required') =>
  new DomainError(ERROR_CODES.UNAUTHORIZED, message, 401)

export const forbidden = (message = 'not allowed') =>
  new DomainError(ERROR_CODES.FORBIDDEN, message, 403)

export const notFound = (code: ErrorCode = ERROR_CODES.NOT_FOUND, message = 'not found') =>
  new DomainError(code, message, 404)

export const conflict = (code: ErrorCode, message: string, details?: unknown) =>
  new DomainError(code, message, 409, details)

export const unprocessable = (code: ErrorCode, message: string, details?: unknown) =>
  new DomainError(code, message, 422, details)

export const tooLarge = (code: ErrorCode, message: string, details?: unknown) =>
  new DomainError(code, message, 413, details)

export const rateLimited = (message = 'too many requests') =>
  new DomainError(ERROR_CODES.RATE_LIMITED, message, 429)
