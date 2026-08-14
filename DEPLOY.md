# Deploying PokeDraft on Dokploy

One Dokploy **Compose** application runs the whole stack from
`docker-compose.dokploy.yml`: Postgres, a one-shot migration job, the Elysia
API, and the TanStack Start web server. Traefik (installed with Dokploy)
terminates TLS and routes two domains at it.

```
                 ┌── app.example.com  ──► web  :5173  (SSR, React)
Traefik / LE ────┤
                 └── api.example.com  ──► api  :3000  (Elysia + WS + /api/auth)
                                           │
                                     migrate (runs once, then exits)
                                           │
                                          db   :5432  (never exposed)
```

Nothing publishes a host port. The database is reachable only from the other
containers, and both apps are reachable only through Traefik.

## Before you start

- A VPS with Dokploy installed (`curl -sSL https://dokploy.com/install.sh | sh`).
  Give it **at least 4 GB RAM** — the web image builds Vite and React from
  source, and a 2 GB box gets OOM-killed mid-build.
- Two DNS `A` records pointing at the VPS:
  - `app.example.com` → web
  - `api.example.com` → api
- The repo reachable by Dokploy: GitHub App (private repos), a deploy key, or a
  public URL.

Pick the domains before the first deploy. `VITE_API_URL` is compiled into the
client bundle, so changing the API domain later requires a rebuild, not a
restart.

## 1. Create the application

Dokploy UI → **Project** → *Create Project* → inside it, *Create Service* →
**Compose**.

| Field | Value |
| --- | --- |
| Source | Git provider / repository, branch `main` |
| Compose Path | `./docker-compose.dokploy.yml` |
| Compose Type | `docker-compose` |

## 2. Set the environment

**Environment** tab. Dokploy writes this to `.env` beside the compose file, so
both `${VAR}` interpolation and the build arg pick it up.

```env
# ── database ────────────────────────────────────────────────────────────────
POSTGRES_USER=pokedraft
POSTGRES_DB=pokedraft
POSTGRES_PASSWORD=<openssl rand -base64 24>
# Host is the compose service name; this URL is internal to the stack.
DATABASE_URL=postgres://pokedraft:<same password>@db:5432/pokedraft

# ── auth ────────────────────────────────────────────────────────────────────
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://api.example.com
WEB_ORIGIN=https://app.example.com

# ── frontend (build arg — baked into the bundle) ─────────────────────────────
VITE_API_URL=https://api.example.com

LOG_LEVEL=info
```

`BETTER_AUTH_URL` and `VITE_API_URL` are the same value: the public API origin.
`WEB_ORIGIN` is the only origin the API accepts cross-site requests and cookies
from — one value, no list.

OAuth is optional. Leave the variables out entirely and email/password carries
the app; a provider registers only when both of its variables are set. Callback
URLs are `https://api.example.com/api/auth/callback/{discord,google}`.

## 3. Attach the domains

**Domains** tab → *Add Domain*, twice. Service names come from the compose file.

| Host | Service | Container Port | HTTPS |
| --- | --- | --- | --- |
| `app.example.com` | `web` | `5173` | on, Let's Encrypt |
| `api.example.com` | `api` | `3000` | on, Let's Encrypt |

HTTPS on **both** is mandatory, not cosmetic: in production the session cookie
is issued `SameSite=None; Secure`, which browsers drop over plain HTTP. Login
would appear to succeed and then every request would come back unauthenticated.

Both services already join `dokploy-network` in the compose file — that is the
network Traefik lives on, and without it a domain resolves to a 502. `db` stays
off it deliberately.

## 4. Deploy

Hit **Deploy** and watch the logs. Expected order:

1. `db` starts, becomes healthy
2. `migrate` applies `packages/db/migrations/*.sql`, prints `migrations applied`,
   exits 0
3. `api` starts, `/health` goes green
4. `web` starts

The API only starts after `migrate` exits successfully, so a broken migration
fails the deploy instead of leaving a crash-looping server behind.

Verify:

```bash
curl https://api.example.com/health        # {"ok":true,"uptime":...}
curl -I https://app.example.com            # 200
```

Then open `https://app.example.com`, sign up, and create a league — the first
account is a normal user; hosting is per-league, so no admin bootstrap step
exists. `https://api.example.com/openapi` serves the API docs.

Websockets need no configuration; Traefik upgrades them, and the client derives
`wss://` from `VITE_API_URL`.

## Updating

Push to `main` and press **Deploy** (or enable Dokploy's webhook for
auto-deploy). Migrations run again as part of every deploy and are idempotent.

Rebuild-not-restart cases:

- Changing the API domain, i.e. `VITE_API_URL` — the value is compiled into the
  client bundle. Update the env and redeploy so the web image rebuilds.
- Changing `BETTER_AUTH_SECRET` invalidates every existing session.

## Backups

The data lives in the compose volume `pgdata`. Dokploy's scheduled backups
target its own managed databases, not a Postgres inside your compose stack, so
either:

- add a cron in Dokploy running
  `docker exec $(docker ps -qf name=db) pg_dump -U pokedraft pokedraft | gzip > /backup/$(date +%F).sql.gz`, or
- move the database out: create a Dokploy **Postgres** service, delete the `db`
  service from the compose file, and point `DATABASE_URL` at the managed
  instance's internal host. You then get Dokploy's S3 backups and restores for
  free.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Build fails: `lockfile had changes, but lockfile is frozen` | `bun.lock` is stale in git. Run `bun install` locally, commit the lockfile. |
| Build killed around the Vite step | Out of memory. 4 GB minimum, or add swap. |
| Domain returns 502 | Container is unhealthy, or the service is not on `dokploy-network`. Check the service logs first. |
| Login succeeds, next request is anonymous | One of the two domains is not on HTTPS, or `WEB_ORIGIN` doesn't exactly match the browser's origin (scheme + host, no trailing slash). |
| Browser console shows a CORS failure | Same cause: `WEB_ORIGIN` mismatch. It is compared exactly. |
| Draft board never goes live | The socket URL comes from `VITE_API_URL`. If it still points at `localhost`, the web image was built before the env was set — redeploy. |
| API exits at boot with `invalid environment` | A required variable is missing; the log names every one of them at once. |

## Local rehearsal

The compose file runs anywhere Docker does, which is the cheapest way to catch a
deploy problem before pushing:

```bash
docker network create dokploy-network        # Dokploy creates this for you
docker compose -f docker-compose.dokploy.yml --env-file .env.deploy up -d --build
```

Use `http://localhost:5173` / `http://localhost:3000` for the three URL
variables and add a `ports:` mapping, or exec into the network to curl the
services. For day-to-day development keep using `docker compose up -d` +
`bun dev` — see `CLAUDE.md`.
