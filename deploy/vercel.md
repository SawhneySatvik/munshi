# The two demo projects on Vercel (BP-OPS-2)

Written offline: no `vercel` CLI was run and nothing was linked. If the founder links a project, `vercel link` writes a
`.env.local` holding an OIDC token (Munim gotcha 39): find where `.vercel/project.json` landed and delete that
`.env.local` unread. Tags as in `deploy/supabase.md` (FACT = a named test here; UNVERIFIED = Vercel's behaviour).

## The projects

| | `munshi-demo` | `munshi-shops-demo` |
|---|---|---|
| App | `apps/web` (the owner app, counter, demo sign-in, `/api/v1`, the tick) | `apps/sites` (a shop's public site) |
| Root directory | `apps/web` | `apps/sites` |
| Framework preset | Next.js (`framework` in `vercel.json`) | Next.js |
| Install command | `pnpm install --frozen-lockfile --filter @munshi/web...` (`apps/web/vercel.json`) | `pnpm install --frozen-lockfile --filter @munshi/sites...` |
| Build command | `pnpm --filter @munshi/web build` | `pnpm --filter @munshi/sites build` |
| Node.js | 22.x (`engines`) | 22.x |
| Function region | `bom1` (`regions` in `vercel.json`) | `bom1` |
| Include files outside the root directory | on (the app imports `packages/*`, and `next.config.ts` reads `db/schema` at build time to compile in the schema sha) | on |
| Cron | `/api/internal/tick` daily at 00:41 UTC (06:11 IST) | none |

Both `vercel.json` files are committed and checked by `db/test/v2/deploy/vercel.test.ts` (VERCEL1: own app only, `bom1`,
no environment value in the file, one daily cron on a route that answers GET). That Vercel reads them as intended is
UNVERIFIED until BP-OPS-2.

UNVERIFIED and checked on the first build:
- **pnpm 11.** The repo pins `packageManager: pnpm@11.9.0`. Vercel picks pnpm from the lockfile version or, with
  `ENABLE_EXPERIMENTAL_COREPACK=1` set on the project, from `packageManager`. Set that variable if the build log shows
  another pnpm.
- **The filtered install.** `--filter @munshi/web...` installs the app and the workspace packages it depends on, which
  keeps `db`'s embedded-postgres binaries off the build machine. If the build misses a package, drop the filter.
- **`apps/sites` builds one business per build** (`MUNSHI_SITE`, `apps/sites/next.config.ts`) into `.next/<slug>`.
  So `munshi-shops-demo` serves exactly one business, and that `distDir` must be accepted by Vercel's Next builder
  (UNVERIFIED). A second business needs its own project (`<slug>-demo`, MERCHANTS-DESIGN §1); which business the
  submission links is the founder's call (today's folders: `elite`, `suit-shop`).

## Environment variables (names only; values in the dashboard, never in a file)

### `munshi-demo` (Production)

| Name | Value / note |
|---|---|
| `DATABASE_URL` | `munshi_app`, transaction pooler (6543) |
| `PUBLIC_DATABASE_URL` | `munshi_public`, 6543 |
| `JOBS_DATABASE_URL` | `munshi_jobs`, 6543 |
| `AGENT_DATABASE_URL` | `munshi_agent`, 6543 |
| `IDP_DATABASE_URL` | `munshi_idp`, 6543 |
| `PLATFORM_DATABASE_URL` | `munshi_platform`, 6543 |
| `MUNSHI_DEPLOYMENT` | `demo` (boot refuses anything but the database's `ops.deployment`) |
| `MUNSHI_SESSION_SECRET` | 64 lowercase hex (`openssl rand -hex 32`) |
| `MUNSHI_DEMO_TENANT_ID` | the kirana's tenant id, printed by the seed |
| `MUNSHI_RATE_SECRET` | 32+ characters: the sample-shop sign-up's per-IP limit hashes IPs with it |
| `MUNSHI_IDENTITY_SECRET` | 32+ characters (optional on demo: real sign-in is 404 there; required on live) |
| `CRON_SECRET` | 32+ random characters. Vercel's cron sends `Authorization: Bearer <CRON_SECRET>` when this is set (FACT from Vercel's docs, as read for BLUEPRINT §4.4); unset, the tick admits no one (404) |
| `MUNSHI_MODEL_MODE` | `recorded` until W6 (the default), then as decided |
| `MUNSHI_EDITION` | `meta` |
| `MUNSHI_AI` | empty (on) or `off` |
| `MUNSHI_SEND_MODE` | empty (recorded) |
| `MUNSHI_CACHE_URL` | see Redis below; empty is the in-process memory cache |
| `META_MODEL_API_KEY`, `BASETEN_API_KEY` | only once models go live (W6); none while recorded |

**Never on the demo:** any `WHATSAPP_*` or `INSTAGRAM_*` name, `MUNSHI_PHONE_ROUTE_SECRET`. Boot refuses a demo
deployment that names a channel credential (FACT, `CONFIG1 a demo deployment names no channel credential: …`,
`packages/config/test/config.test.ts`), and so does `deploy-check` (FACT, `DEPLOY1 deploy-check refuses a demo config
that names a channel credential, …`). **Never on Vercel at all:** `MIGRATOR_DATABASE_URL`, `ADMIN_DATABASE_URL`,
`MUNSHI_PLATFORM_SECRET` (the app never builds, bootstraps or enrols operators). `VERCEL_REGION` is set by Vercel.

### `munshi-shops-demo` (Production)

| Name | Value |
|---|---|
| `MUNSHI_SITE` | the one business this project builds (`elite` or `suit-shop`) |
| `MUNSHI_LIVE` | unset: the "Sample data" ribbon stays (only a live site sets `1`) |

`apps/sites` reads nothing else today: it does not call the API yet (it waits for it), so no key or URL is needed.

## The daily tick

`apps/web/app/api/internal/tick/route.ts` answers GET and POST with `Authorization: Bearer <CRON_SECRET>` and is a 404
otherwise; it runs `runDueJobs` and the back office (watchers, the morning brief) on the jobs pool. Hobby allows a cron
at most once a day and fires it somewhere inside the named hour (UNVERIFIED wording, from Vercel's docs as read at
design time), and only on the production deployment. Between ticks, jobs also run after writes and on owner page loads
(BLUEPRINT §4.4). How long the tick may run before the function times out is UNVERIFIED (set `maxDuration` if the log
shows a timeout).

## Hosted Redis — not usable yet

The cache adapter (`packages/adapters/cache/index.ts`) speaks RESP2 over `node:net`: a Unix socket or a **plain TCP**
address. It has **no TLS**, and the config refuses anything but `redis://host:port[/db]`, `unix:///path` or `off`
(`packages/config/src/index.ts`). Every hosted Redis worth using (Upstash, Redis Cloud) requires `rediss://` (TLS), so:

- **for the demo, leave `MUNSHI_CACHE_URL` empty**: each function instance keeps its own memory cache, and every miss
  reads Postgres (correct, slower);
- a hosted cache needs a TLS branch in the adapter (`node:tls`'s `connect` with SNI) and `rediss://` in the config's
  pattern, each with a red-proof; that is its own ticket, not BP-OPS-1's.

## Before the URL is shared

- The demo has no real sign-in by design (BLUEPRINT §6.6): the picker opens synthetic and showcase shops only, every
  screen with simulated parts says so, and the database refuses live tenants.
- Deploy from a clean checkout of one commit (Munim gotcha 42), e.g. `git worktree add ../munshi-deploy <sha>`, and
  run `scripts/deploy-check.ts` from there first (`docs/DEPLOY.md`).
