import { treaty } from '@elysiajs/eden'
import type { App } from '@pokedraft/api'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/**
 * Eden Treaty over `typeof app`, so a route rename on the server is a
 * type error here rather than a 404 in production.
 */
export const api = treaty<App>(API_URL, {
  fetch: { credentials: 'include' },
})

export type ApiError = { code: string; message: string; details?: unknown }

/** Every failure on the wire is `{ error: { code, message } }` — one shape. */
export function toError(value: unknown): ApiError {
  const body = (value as { value?: { error?: ApiError }; error?: ApiError } | null) ?? null
  const err = body?.value?.error ?? body?.error
  if (err?.code) return err
  return { code: 'INTERNAL_ERROR', message: 'something went wrong' }
}

/** Bare fetch for the handful of routes Eden's types can't reach (auth mount). */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (body as { error?: ApiError } | null)?.error
    throw Object.assign(new Error(err?.message ?? `request failed (${res.status})`), {
      code: err?.code ?? 'INTERNAL_ERROR',
      status: res.status,
      details: err?.details,
    })
  }
  return body as T
}

export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

export const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

export const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })
