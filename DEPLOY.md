# Deploying PokeDraft on Dokploy

One Dokploy **Compose** application runs the whole stack from
`docker-compose.dokploy.yml`: Postgres, a one-shot migration job, the Elysia
API, and the TanStack Start web server — all behind **a single domain**.

```
                             ┌── /api/auth/*  ──► api :3000   (unstripped: OAuth callbacks)
https://draft.example.com ───┼── /api/*       ──► api :3000   (prefix stripped)
        Traefik / LE         └── everything   ──► web :5173   (SSR)
                                                   │
                                             migrate (runs once, then exits)
                                                   │
                                                  db  :5432   (never exposed)
```

Same origin for both halves, so session cookies are first-party and CORS never
enters the picture. Nothing publishes a host port: the database is reachable
only from the other containers, the apps only through Traefik.

The routing lives in Traefik labels inside the compose file, so **do not add a
domain in Dokploy's Domains tab** — that would create a second, competing
router for the same host.

## Before you start

- A VPS with Dokploy installed (`curl -sSL https://dokploy.com/install.sh | sh`).
  Give it **at least 4 GB RAM** — the web image builds Vite and React from
  source, and a 2 GB box gets OOM-killed mid-build.
- One DNS `A` record: `draft.example.com` → the VPS IP. That's all; there is no
  API subdomain.
- The repo reachable by Dokploy: GitHub App (private repos), a deploy key, or a
  public URL.

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
APP_DOMAIN=draft.example.com

POSTGRES_USER=pokedraft
POSTGRES_DB=pokedraft
POSTGRES_PASSWORD=<openssl rand -base64 24>
# Host is the compose service name; this URL never leaves the stack.
DATABASE_URL=postgres://pokedraft:<same password>@db:5432/pokedraft

BETTER_AUTH_SECRET=<openssl rand -base64 32>

LOG_LEVEL=info
```

`APP_DOMAIN` is the only URL you set. The compose file derives the rest from it:

| Derived | Value | Why |
| --- | --- | --- |
| `WEB_ORIGIN` | `https://$APP_DOMAIN` | the one origin allowed to send credentials |
| `BETTER_AUTH_URL` | `https://$APP_DOMAIN` | origin **without** a path — Better Auth appends its own `/api/auth` |
| `VITE_API_URL` (build arg) | `https://$APP_DOMAIN/api` | baked into the client bundle; the websocket URL derives from it |

OAuth is optional — leave the variables out and email/password carries the app;
a provider registers only when both of its variables are set. Callback URLs are
`https://draft.example.com/api/auth/callback/{discord,google}`, which is why the
`/api/auth` router exists.

## 3. Deploy

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
curl https://draft.example.com/api/health     # {"ok":true,"uptime":...}
curl -I https://draft.example.com             # 200
```

Then open the site, sign up, and create a league — the first account is a normal
user; hosting is per-league, so there is no admin bootstrap step. API docs live
at `https://draft.example.com/api/openapi`.

Websockets need no configuration: Traefik upgrades them and the client derives
`wss://draft.example.com/api/leagues/:id/live` from `VITE_API_URL`.

### Why auth URLs look doubled

The browser calls `/api/api/auth/sign-in/email`. That is intentional and
correct: the outer `/api` selects the API service and is stripped by Traefik,
the inner `/api/auth` is Better Auth's own base path. OAuth callbacks are the
exception — they arrive at `/api/auth/...` from an external redirect and are
routed through unstripped by a higher-priority router.

## Updating

Push to `main` and press **Deploy** (Trigger Type `On Push` does it for you).
Migrations run on every deploy and are idempotent.

Rebuild-not-restart cases:

- Changing `APP_DOMAIN` — it is compiled into the client bundle through
  `VITE_API_URL`. Redeploy so the web image rebuilds.
- Changing `BETTER_AUTH_SECRET` invalidates every existing session.

## Backups

Data lives in the compose volume `pgdata`. Dokploy's scheduled backups target
its own managed databases, not a Postgres inside your compose stack, so either:

- add a cron in Dokploy running
  `docker exec $(docker ps -qf name=db) pg_dump -U pokedraft pokedraft | gzip > /backup/$(date +%F).sql.gz`, or
- move the database out: create a Dokploy **Postgres** service, delete the `db`
  service from the compose file, and point `DATABASE_URL` at the managed
  instance. You then get Dokploy's S3 backups and restores for free.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Build fails: `lockfile had changes, but lockfile is frozen` | `bun.lock` is stale in git. Run `bun install` locally, commit the lockfile. |
| Build killed around the Vite step | Out of memory. 4 GB minimum, or add swap. |
| `required variable APP_DOMAIN is missing a value` | Environment tab is empty or was saved after the deploy started. |
| 404 on everything, from Traefik | A domain was also added in the Domains tab, so two routers claim the host. Remove it — the compose labels are the routing. |
| 502 | Container unhealthy, or not on `dokploy-network`. Read the service logs. |
| Auth calls 404 while `/api/health` works | `BETTER_AUTH_URL` has a path. It must be the bare origin. |
| Login succeeds, next request is anonymous | Site is not on HTTPS. The cookie is issued `Secure`, and browsers drop it over plain HTTP. |
| Draft board never goes live | The socket URL comes from `VITE_API_URL`. Rebuild after any domain change. |
| API exits at boot with `invalid environment` | A required variable is missing; the log names all of them at once. |

## Local rehearsal

The stack runs anywhere Docker does, which is the cheapest way to catch a deploy
problem before pushing. Traefik with TLS is the one piece that can't be
reproduced locally, so point a test router at the same containers over plain
http:

```bash
docker network create dokploy-network        # Dokploy creates this for you
docker compose -f docker-compose.dokploy.yml --env-file .env.deploy up -d --build
```

For day-to-day development keep using `docker compose up -d` + `bun dev` — see
`CLAUDE.md`.

## Two subdomains instead

If you'd rather split `app.` and `api.`, drop the Traefik labels from the
compose file, set `BETTER_AUTH_URL`/`WEB_ORIGIN`/`VITE_API_URL` to the two
origins explicitly, and add both domains in Dokploy's Domains tab (`web` → 5173,
`api` → 3000). Nothing in the code assumes one shape or the other — but the
single-domain setup keeps cookies first-party, which is one less thing to get
wrong.
