import { resolve, sep } from 'node:path'
import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

const handler = createStartHandler(defaultStreamHandler)

/**
 * The build emits `dist/server/server.js` and `dist/client/**`, and the server
 * it emits serves only the former — every hosting preset assumes a CDN or a
 * reverse proxy in front for the assets. We run one container, so the SSR
 * handler answers for the assets too.
 *
 * In dev this file is loaded from `src/`, where no sibling `client/` exists;
 * every lookup misses and Vite's own middleware has already served the file.
 */
const clientDir = resolve(import.meta.dirname, '../client')

async function staticFile(pathname: string): Promise<Response | null> {
  const decoded = decodeURIComponent(pathname)
  const path = resolve(clientDir, `.${decoded}`)
  // resolve() collapses `..`, so this is what stops a traversal out of the
  // client directory — not a check on the raw pathname.
  if (path !== clientDir && !path.startsWith(clientDir + sep)) return null

  const file = Bun.file(path)
  if (!(await file.exists())) return null

  return new Response(file, {
    headers: {
      // Everything under /assets carries a content hash in its name.
      'cache-control': decoded.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    },
  })
}

export default {
  async fetch(request: Request, ...rest: Array<unknown>) {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = await staticFile(pathname)
      if (file) return file
    }
    return handler(request, ...(rest as []))
  },
}
