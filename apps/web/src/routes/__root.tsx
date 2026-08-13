import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouterState,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { signOut, useSession } from '../lib/auth'
import appCss from '../styles/app.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#06080b' },
      { title: 'PokéDraft' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function Topbar() {
  const { data: session } = useSession()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const inLeague = /^\/leagues\/[^/]+/.exec(pathname)

  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <Link to="/" className="brand">
          <span className="brand-mark" />
          PokéDraft
        </Link>

        <nav className="nav">
          <Link to="/leagues" className={pathname === '/leagues' ? 'active' : ''}>
            Browse
          </Link>
          {session && (
            <Link to="/dashboard" className={pathname === '/dashboard' ? 'active' : ''}>
              My leagues
            </Link>
          )}
          {inLeague && (
            <span className="label hide-sm" style={{ paddingLeft: 8 }}>
              in league
            </span>
          )}
        </nav>

        <div className="spacer" />

        {session ? (
          <div className="row">
            <span className="label hide-sm">{session.user.name}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void signOut().then(() => {
                  window.location.href = '/'
                })
              }}
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="row">
            <Link to="/login" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm">
              Create account
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  const { queryClient } = Route.useRouteContext()
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <div className="shell">
            <Topbar />
            <main className="grow" style={{ padding: '24px 0 64px' }}>
              {children}
            </main>
          </div>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
