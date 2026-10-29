> **Superseded (BP-FLIP, 30 Oct):** this was the v1 hosted path over `db/migrations`, which is deleted. The v2 schema is built with `pnpm db:bootstrap` and `pnpm db:build` (db/schema); BP-OPS-1 rewrites the deploy kit.

# Neon Postgres (free tier) for Munshi

Status: written offline, nothing here has been run against Neon. Tags: FACT = proved by a test in this repo, UNVERIFIED =
depends on Neon's behaviour and must be confirmed on the first real run.

## What the founder creates

1. A Neon project (region closest to Vercel `bom1`; Singapore `aws-ap-southeast-1` if Mumbai is not offered), Postgres 17
   or newer, one database (call it `munshi`).
2. Two connection strings from the Neon console, both with `sslmode=require`:
   - **admin**: the project owner role (the console's default). Used once, for the bootstrap file `0001`.
   - **direct (unpooled)** host for migrations; the **pooled** host (`-pooler`) for the running app.

## Logins (FACT, `db/test/ms13-migrator.test.ts`)

| Login | Made by | Holds | Used for |
|---|---|---|---|
| owner/admin (console) | Neon | everything | `0001` only, then keep it out of Vercel |
| `munshi_migrator` | `0001` | member of `munshi_owner`, which owns every object; no superuser, no role/db creation, no RLS bypass | `pnpm migrate`, later migrations |
| `munshi_app` | `0001` | table grants by the migrations; owns nothing | the web app (`DATABASE_URL`) |
| `munshi_agent` | `0001` | read on `snap` and `agent_view` only | `AGENT_DATABASE_URL` |

`0001` creates the three roles without passwords. Set them out of band, once, as the admin (generate each with
`openssl rand -hex 24`; never reuse one):

```sql
alter role munshi_migrator password '<generated>';
alter role munshi_app      password '<generated>';
alter role munshi_agent    password '<generated>';
```

## Where the strings go

A git-ignored `.env.production` at the repo root, with the names from `.env.example` plus the three below. Never commit
it, never paste it into chat, never print it.

```
DATABASE_URL=            # munshi_app, POOLED host
AGENT_DATABASE_URL=      # munshi_agent, POOLED host
MIGRATOR_DATABASE_URL=   # munshi_migrator, DIRECT host
ADMIN_DATABASE_URL=      # owner/admin, DIRECT host; only for the first migration, delete the line afterwards
MUNSHI_MODEL_MODE=recorded
MUNSHI_EDITION=meta
```
(`MIGRATOR_DATABASE_URL`, `ADMIN_DATABASE_URL` and `AGENT_DATABASE_URL` are not yet in `.env.example`.)

## Order of operations

The migrator cannot log in until its password exists, and the roles exist only after `0001`. So the first time:

1. `node --env-file=.env.production db/src/migrate.ts`: applies `0001` as the admin, then fails at the migrator's login
   (password authentication). That is expected; `0001` is committed.
2. As the admin, set the three passwords (above) and put them in `.env.production`.
3. `node --env-file=.env.production db/src/migrate.ts` again: applies `0002` onwards as `munshi_migrator`. Delete
   `ADMIN_DATABASE_URL` from `.env.production` afterwards; later migrations need only the migrator.
4. `node --env-file=.env.production scripts/deploy-check.ts` must print `deploy-check: ok`.

`deploy-check` refuses unless `DATABASE_URL` connects as `munshi_app` (no superuser, no RLS bypass, owns nothing, not a
member of `munshi_owner`), `MIGRATOR_DATABASE_URL` is a different URL and connects as `munshi_migrator` (not a
superuser), and `AGENT_DATABASE_URL`, if set, connects as `munshi_agent`. It prints variable names only, never a URL.

The demo shop is seeded by `pnpm reseed`, which is a local-dev tool: it refuses any database that is not the `.run/pg`
cluster. A hosted demo database needs its own seed step (not written; see "Not done" in `docs/DEPLOY.md`).

## Risks (UNVERIFIED)

- `0001` revokes `EXECUTE` on the large-object functions in `pg_catalog` and asserts the result. On a real superuser
  that works (FACT, tested). Neon's owner role is `neon_superuser`, not a true superuser, so the revoke may only warn and
  the assertion then raises. `0001` cannot be edited (append-only). If it raises on Neon, stop and tell the founder: the
  fix is a decision about the bootstrap, not a retry.
- Pooled connections run in transaction mode; the app only uses `set_config(..., true)` (transaction-local), which is
  safe there. Migrations must use the direct host.
