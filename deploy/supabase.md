# The demo database on Supabase (BP-OPS-2)

One Supabase project, **the demo** (D-045, BLUEPRINT §1.3). The live project follows after 5 Nov and is built from the
frozen migrations, not from this page. Written offline: no Supabase account existed and nothing here has been run
against Supabase. Tags: **FACT** = proved by a test in this repo (named), **UNVERIFIED** = Supabase's behaviour, to be
confirmed on the first real run, in the order below. Stop at the first UNVERIFIED step that does not hold and report it;
a workaround is a decision, not a retry.

Never paste a URL or password into chat, a commit or a log. Every value lives in one git-ignored `.env.production` at
the repo root (`.env.*` is ignored, `.gitignore`). Generate every password with `openssl rand -hex 24`, one per role,
never reused (`deploy-check` refuses two URLs with the same password).

## 1. Create the project, then check four things before anything else

Create it in the dashboard: name `munshi-demo`, region **Mumbai (`ap-south-1`)** (UNVERIFIED that the free plan offers
it; Singapore `ap-southeast-1` is the fallback, and Vercel's region in `apps/web/vercel.json` should then follow it).
Keep the database password the dashboard generates: it is the admin's (`postgres`), for steps 2–3 only.

Connect as the admin through the **session** pooler (port 5432) and check, in this order:

| # | Check | Query / where | Needed because |
|---|---|---|---|
| 1 | PostgreSQL **17** | `show server_version;` | the schema is pinned to 17 (gate PG17); an 18-only function would build locally and fail here, or the reverse |
| 2 | `btree_gist` is available | `select name, default_version from pg_available_extensions where name = 'btree_gist';` | the only extension the schema uses (`00_bootstrap.sql` creates it in schema `extensions`; it backs the booking exclusion in `14_sites_public.sql`). Derived by grepping `db/schema` for `create extension`: nothing else (no pgcrypto: `sha256()` and `gen_random_uuid()` are core) |
| 3 | the region is Mumbai | Settings → General | about 1 ms per round trip from Vercel `bom1` (R1 #11); INV1's chain lock was measured on that assumption |
| 4 | the **transaction** pooler (port 6543) accepts node-postgres | from this machine: `node -e` a `pg.Client` on the 6543 URL running `select $1::int` with a parameter, then `begin; select set_config('munshi.tenant_id', 'x', true); select current_setting('munshi.tenant_id'); commit;` and, in a second transaction, `select nullif(current_setting('munshi.tenant_id', true), '')` (must be NULL) | node-postgres sends parameterised queries as unnamed prepared statements; the shared pooler does not support *named* prepared statements in transaction mode, and whether it accepts unnamed ones is **UNVERIFIED** (BLUEPRINT §2.2). This is the first gate of BP-OPS-2 |

What depends on which pooling mode (read from the code):

- Every runtime pool (app, public, jobs, agent, idp, platform) sets its context only with `set_config(name, value,
  true)` inside one transaction (core's `withTx`, gate B3), and every reader uses `nullif(current_setting(k, true), '')`.
  Nothing holds session state across transactions, so the **transaction pooler (6543)** is safe for all six.
- No runtime code uses `LISTEN/NOTIFY`, advisory locks held across transactions, session `SET`, temp tables (PUBLIC's
  TEMP is revoked) or named prepared statements (node-postgres names none unless a query sets `name`).
- The build runs each schema file in its own transaction but issues `set local role munshi_owner` and DDL: run it as the
  migrator through the **session pooler (5432)**, as BLUEPRINT §2.2 says. The bootstrap, the operator enrolment and the
  seed use the session pooler too.
- TLS: `sslmode=require` on every URL. node-postgres treats `require` as full verification in recent versions; if a
  connection fails with a certificate error, download the project's CA certificate (Settings → Database) and add
  `sslrootcert=<path>` to the URLs on this machine (UNVERIFIED which one Supavisor needs). On Vercel the same URL must
  work without a file: if it does not, that is a finding for BP-OPS-2, not something to switch off.

## 2. Bootstrap, as the admin

```
ADMIN_DATABASE_URL=postgresql://postgres.<ref>:<admin password>@<pooler host>:5432/postgres?sslmode=require
node --env-file=.env.production db/src/bootstrap.ts          # pnpm db:bootstrap
```

`00_bootstrap.sql` creates the eight roles (`munshi_owner` nologin; `munshi_migrator`, `munshi_app`, `munshi_public`,
`munshi_jobs`, `munshi_agent`, `munshi_idp`, `munshi_platform` login, no passwords), lets the migrator and the admin SET
ROLE to the owner without inheriting it, grants the owner CREATE on the database, creates `btree_gist`, and revokes TEMP,
CREATE on `public` and the large-object functions from PUBLIC. On a non-superuser admin the last revoke only warns: the
file prints `bootstrap residual: agent_large_objects=possible` and goes on. That is expected on Supabase (FACT on a
local non-superuser admin: `SUPA1 the bootstrap runs as a non-superuser admin, …`, `db/test/v2/gates/00-bootstrap.test.ts`;
UNVERIFIED that Supabase's `postgres` behaves the same; it is a stated residual, unlinked bytes, never a table row).
The file is idempotent; a second run changes nothing. If it raises on a role "with other attributes", stop.

## 3. Give each login its password, as the admin

The admin created the roles, so it may set their passwords (FACT in the SUPA1 test). In `psql` on the admin URL, one
statement per role, each with its own generated value:

```sql
alter role munshi_migrator password '<generated>';
alter role munshi_app      password '<generated>';
alter role munshi_public   password '<generated>';
alter role munshi_jobs     password '<generated>';
alter role munshi_agent    password '<generated>';
alter role munshi_idp      password '<generated>';
alter role munshi_platform password '<generated>';
```

Then write the URLs into `.env.production`. A custom role logs in through the shared pooler as `<role>.<project-ref>`
(FACT from Supabase's docs, BLUEPRINT §2.2):

```
MIGRATOR_DATABASE_URL=postgresql://munshi_migrator.<ref>:<pw>@<pooler host>:5432/postgres?sslmode=require   # session
DATABASE_URL=postgresql://munshi_app.<ref>:<pw>@<pooler host>:6543/postgres?sslmode=require                  # transaction
PUBLIC_DATABASE_URL=…munshi_public…:6543…    JOBS_DATABASE_URL=…munshi_jobs…:6543…
AGENT_DATABASE_URL=…munshi_agent…:6543…      IDP_DATABASE_URL=…munshi_idp…:6543…
PLATFORM_DATABASE_URL=…munshi_platform…:6543…
MUNSHI_DEPLOYMENT=demo
```

Delete `ADMIN_DATABASE_URL` from the file once step 4 is done; nothing later needs the admin.

## 4. Build, as the migrator, and name the deployment

```
node --env-file=.env.production db/src/build.ts              # pnpm db:build; applies 01–90 as munshi_migrator
```

The build CLI writes no `ops.deployment` row (absent counts as demo locally), but a hosted database must name itself,
and `deploy-check` refuses one with no row. The row can be written only as the owner and only before any tenant
(`ops.build_row`, MS010), so write it now, on the migrator's URL:

```sql
set role munshi_owner;
insert into ops.deployment (one, kind, hosted) values (true, 'demo', true);
reset role;
```

`db:build` refuses to run once the row says `live`; on the demo a rebuild drops every Munshi schema, the row with them,
so repeat the insert after any rebuild. (Gap: `build.ts` already takes a `deployment` option, but its CLI has no flag for
it; a `--deployment demo` flag would replace this manual step. Not in BP-OPS-1's territory.)

## 5. Seed the demo — the gap

`pnpm dev` seeds through `db/src/dev.ts`'s `reseed()`: the kirana as `munshi_app` (`seedKirana`), the watchers as
`munshi_jobs`, the waiting reorder draft (`proposeDemoDraft`), the two showcase tenants (`seedShowcase`, provisioned as
the owner role, with a public-pool cart and a seed-only platform operator that verifies both sites and sets the demo's
AI defaults), then the widget demo's site key. `pnpm reseed` does the same but **refuses any database that is not the
local `.run/pg17` cluster**, by design.

**No hosted seed path exists, and BP-OPS-1 did not write one** (`db/seed` and `db/src/dev.ts` are outside its
territory, and a seed that writes the books of a hosted database needs its own gate). What a hosted seed needs, for
whoever writes it (a `db/seed/hosted.ts` behind a `--hosted` confirmation, refusing unless `deploy-check` passes and
`ops.tenant` is empty):

1. the four pools from `.env.production` (app, jobs, public, platform) and the migrator client as `owner`
   (`provision` only needs `SET ROLE munshi_owner`, which the migrator has);
2. `seedKirana(app, { asOf: '2026-10-27' })` while models are recorded (`seedDate`), `runWatchers(jobs, …)`,
   `proposeDemoDraft(app, tenantId)`;
3. **the operator order matters:** `seedShowcase` seeds its own first operator, and a first operator can be seeded only
   while none exists. On the hosted demo the founder's own operator must come first (step 6), so the hosted seed calls
   `seedShowcase(…, { verify: false })`, and the founder then verifies both sites and sets the demo defaults through the
   platform CLI (step 6). Until then the showcase sites stay hidden and the sample shops have no AI config;
4. print the kirana's tenant id (not a secret) for `MUNSHI_DEMO_TENANT_ID` on Vercel.

## 6. Enrol the platform operator (the founder), then verify the showcase sites

Before the seed's showcase step (see 5.3):

```
# needs MIGRATOR_DATABASE_URL, MUNSHI_IDENTITY_SECRET and MUNSHI_PLATFORM_SECRET (each `openssl rand -hex 32`)
node --env-file=.env.production db/src/platform-operator.ts    # pnpm platform:operator
```

It asks for the email, display name and password on the terminal, writes the identity and the `platform.operator` row
as the owner (the guard's one exception, refused once any operator exists), and prints the authenticator URI **once**:
add it to an authenticator app then, it is never shown again. Keep `MUNSHI_PLATFORM_SECRET` with the other secrets: the
TOTP secret is sealed under it.

Then, with `PLATFORM_DATABASE_URL` and `MUNSHI_PLATFORM_SECRET` (each command takes a fresh 30-second code):

```
pnpm platform:propose default_config ai_enabled=true ai_daily_calls=200 media_daily_calls=40 sandbox_media_daily_calls_total=300 --subject <your subject> --code <totp>   # DEMO_DEFAULTS, db/seed/showcase.ts
pnpm platform:approve <change-id> --subject <your subject> --code <totp>
pnpm platform:propose site_verify --tenant elite verified=true    --subject … --code …   ;  pnpm platform:approve …
pnpm platform:propose site_verify --tenant prabhave verified=true --subject … --code …   ;  pnpm platform:approve …
pnpm platform:list                                                           # exits 1 if the platform chain does not verify
```

(The exact `propose` arguments are `db/src/platform-cli.ts`'s; read its head before running. UNVERIFIED as written here:
this page did not run them.)

## 7. Check, from a clean checkout of the commit being deployed

```
node --env-file=.env.production scripts/deploy-check.ts
```

It must print `deploy-check: ok`. It refuses (FACT, `db/test/v2/deploy/deploy-check.test.ts`): a missing URL or
`MUNSHI_DEPLOYMENT`; two variables sharing a URL or a password; a URL whose login is not its role, or a superuser, an
RLS-bypassing, role- or database-creating, object-owning login, or (but for the migrator) a member of `munshi_owner`;
a database with no `ops.deployment` row, of the other kind, `hosted = false`, live but not built from migrations, or not
built from the checked-out `db/schema`; a demo config naming a WhatsApp or Instagram setting; and (SUPA1) `anon`,
`authenticated`, `service_role` or any other non-superuser BYPASSRLS role that is not the admin holding USAGE on a
Munshi schema or any privilege on a Munshi table, `pgrst.db_schemas` on `authenticator` naming a Munshi schema, or a
Munshi-owned object in `public`. It prints `agent_large_objects=possible` on Supabase (expected, see step 2).

Also check by hand (not covered by the check): Settings → API → **Exposed schemas** lists only `public` and
`graphql_public` (where Supabase keeps that setting is UNVERIFIED, so `deploy-check` reads only the in-database form).

## Not done here

- Supabase Storage as the blob adapter (BP-OPS-2; `packages/adapters` has no blob adapter yet).
- Supabase Auth (after 5 Nov; the password identity adapter stays on the demo, whose real sign-in is 404 anyway).
- The live project (after 5 Nov, from migrations; BOOT1's live half).
