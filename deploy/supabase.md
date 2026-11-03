# The demo database on Supabase (BP-OPS-2)

One Supabase project, **the demo** (D-045, BLUEPRINT §1.3). The live project follows after 5 Nov and is built from the
frozen migrations, not from this page. First written offline. The scripts it names have since been written against a
Supabase project (`db/seed/hosted-copy.ts` records a seeding measurement on 31 Oct), but no complete run of this page is
recorded in the repository, so the UNVERIFIED tags stand. Tags: **FACT** = proved by a test in this repo (named),
**UNVERIFIED** = Supabase's behaviour, to be confirmed on the first real run, in the order below. Stop at the first UNVERIFIED step that does not hold and report it;
a workaround is a decision, not a retry.

Never paste a URL or password into chat, a commit or a log. Every value lives in one git-ignored `.env.production` at
the repo root (`.env.*` is ignored, `.gitignore`). Generate every password with `openssl rand -hex 24`, one per role,
never reused (`deploy-check` refuses two URLs with the same password).

## 1. Create the project, then check four things before anything else

Create it in the dashboard: name `munshi-demo`, region **Mumbai (`ap-south-1`)** (UNVERIFIED that the free plan offers
it; Singapore `ap-southeast-1` is the fallback, and Vercel's region in `vercel.json` and `apps/web/vercel.json` should
then follow it).
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
  migrator through the **session pooler (5432)**, as BLUEPRINT §2.2 says. The bootstrap and the operator enrolment use the
  session pooler too; the seed runs its owner steps on the migrator's session URL and writes through the app, jobs,
  public and platform URLs on the transaction pooler (6543).
- TLS: the URLs carry no `sslmode`. Every Munshi process (the app's pools, the bootstrap, the build, the seeds, the
  platform CLI, `deploy-check`) verifies the server against `MUNSHI_DB_CA`: Supabase's root,
  `deploy/supabase-root-2021.crt`, as the PEM or its base64 (`packages/core/src/pool.ts`, `databaseTls`). Verification
  is never turned off. `db/src/supabase-roles.ts` writes the setting into `.env.production` (step 2), and
  `deploy/vercel-env.ts` sends it to Vercel, so a deployed function needs no file.

## 2. Bootstrap, as the admin

Steps 2 and 3 run in one command, `db/src/supabase-roles.ts`. It reads the project's own connection settings from a
separate env file (`SESSION_POOL_CONNECTION_STRING`, user `postgres.<ref>` on 5432, and
`TRANSACTION_POOL_CONNECTION_STRING` on 6543, the names in `.env.example`), refuses unless `--confirm` equals the ref in
the session pooler URL, applies `00_bootstrap.sql` as the admin, sets a fresh password for each of the seven logins, and
writes `.env.production` (mode 0600): each login's URL through the right pooler, `MUNSHI_DEPLOYMENT=demo`,
`MUNSHI_DB_CA`, and the deploy's secrets (`MUNSHI_SESSION_SECRET`, `MUNSHI_IDENTITY_SECRET`, `MUNSHI_RATE_SECRET`,
`MUNSHI_PLATFORM_SECRET`, `CRON_SECRET`; secrets already in the file are kept). It prints role names and the ref,
never a value. Re-running it rotates every login password.

```
node db/src/supabase-roles.ts --env=<.env with the project's settings> --out=.env.production --confirm=<project ref>
```

The manual route, step by step, does the same:

```
ADMIN_DATABASE_URL=postgresql://postgres.<ref>:<admin password>@<pooler host>:5432/postgres
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
MIGRATOR_DATABASE_URL=postgresql://munshi_migrator.<ref>:<pw>@<pooler host>:5432/postgres   # session
DATABASE_URL=postgresql://munshi_app.<ref>:<pw>@<pooler host>:6543/postgres                  # transaction
PUBLIC_DATABASE_URL=…munshi_public…:6543…    JOBS_DATABASE_URL=…munshi_jobs…:6543…
AGENT_DATABASE_URL=…munshi_agent…:6543…      IDP_DATABASE_URL=…munshi_idp…:6543…
PLATFORM_DATABASE_URL=…munshi_platform…:6543…
MUNSHI_DEPLOYMENT=demo
MUNSHI_DB_CA=<deploy/supabase-root-2021.crt as base64>
```

Delete `ADMIN_DATABASE_URL` from the file once step 4 is done; nothing later needs the admin.

## 4. Build, as the migrator, and name the deployment

```
node --env-file=.env.production db/src/build.ts --deployment demo   # applies 01–90 as munshi_migrator, then writes
                                                                     # ops.deployment (kind demo, hosted) as the owner
```

A hosted database must name itself, and `deploy-check` refuses one with no row. The flag writes the row in the build,
before any tenant exists (`ops.build_row`, MS010); the CLI refuses any other argument (BUILD-ARGS,
`db/test/v2/deploy/build-args.test.ts`). `db:build` refuses to run once the row says `live`. On the demo, a rebuild
drops every Munshi schema, the row with them, and the flag writes it again.

## 5. Seed the demo, and with it the first operator

```
node --env-file=.env.production db/seed/hosted.ts --confirm=<project ref>
```

`db/seed/hosted.ts` seeds the hosted demo exactly as `pnpm dev` does (`db/src/dev.ts`'s `reseed()`): the kirana and
Bansal as `munshi_app`, the watchers as `munshi_jobs`, a waiting reorder draft in each, and the two showcase tenants
(provisioned as the owner role, on the migrator's connection). It needs `DATABASE_URL`, `JOBS_DATABASE_URL`,
`PUBLIC_DATABASE_URL`, `PLATFORM_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `MUNSHI_IDENTITY_SECRET` and
`MUNSHI_PLATFORM_SECRET`. It refuses unless `--confirm` names the project in `DATABASE_URL`, `ops.deployment` says a
hosted demo, and no tenant exists yet.

**The first operator comes from the seed.** It enrols the first platform operator, named "Demo operator" (`pnpm dev`'s
is "Dev operator"); its sign-in, with the email, password, authenticator URI and the identity's subject (what the
platform CLI's `--subject` takes, §6), goes to `.run/hosted-operator.json`, mode 0600; the seed prints none of it. That operator
approves the demo defaults, the edition's model allow-list and both showcase sites, so the sites are verified and the
sample shops have their AI config when the seed ends. It prints `MUNSHI_DEMO_TENANT_ID` (the kirana's id, not a secret)
for Vercel. `MUNSHI_MODEL_MODE` sets the seed date as in dev: recorded seeds as of 27 Oct, live as of today. The
model allow-list the seed approves is that of the edition in `MUNSHI_EDITION` when the seed runs (`demoAllowList`,
`db/seed/showcase.ts`), so set the edition first. The edition for the Meta submission's hosted demo is the founder's
open choice; this page does not make it.

Seeding over the network is slow (measured on 31 Oct: about 4.5 s a sale to Mumbai, about 3 hours for the demo).
`db/seed/hosted-copy.ts`, with the same `--confirm`, seeds the same shops into a throwaway local PostgreSQL 17 built
from the same `db/schema`, then copies them into the hosted database in one transaction. It has the same refusals, and
also refuses a target whose schema sha differs.

`pnpm reseed` refuses any database that is not the local `.run/pg17` cluster, by design.

## 6. The founder's own operator, and later changes

`pnpm platform:operator` (`db/src/platform-operator.ts`) enrols a first operator only while none exists, as the
platform guard's one exception. After the seed it is refused. The founder's own operator therefore comes through an
approved `operator` change, which names a password identity (`idp.identity`) by its subject: first the identity, then
the Demo operator proposes and approves it. No route creates an operator; the console can propose one but not approve
an addition (below).

The `pnpm platform:*` scripts load no env file, so each command here runs as `node --env-file=.env.production …`.
`.env.production` must hold the same `MUNSHI_IDENTITY_SECRET` and `MUNSHI_PLATFORM_SECRET` the seed used (the first
keys the email, the second seals every operator's TOTP secret), and `MUNSHI_DB_CA`. Run it on the machine that holds
`.run/hosted-operator.json`.

```
# 1. The founder's identity, as the owner role (MIGRATOR_DATABASE_URL). Asks for the email, a display name and a
#    password (10 to 128 characters, not the email; asked twice, never shown). Writes the email, display name and the
#    identity's subject to .run/platform-identity.json (0600; refuses if the file exists). A subject is an
#    identifier, not a credential: it appears in the diffs below, on the command line and on the Operators page.
#    The password and the authenticator URIs are what stay secret.
node --env-file=.env.production db/src/platform-identity.ts

# 2. The two subjects: the founder's, and the Demo operator's (the seed wrote it beside its sign-in).
FOUNDER=$(node -p "require('./.run/platform-identity.json').subject")
DEMO=$(node -p "require('./.run/hosted-operator.json').subject")
#    Add the `otpauth` URI in .run/hosted-operator.json to an authenticator app: the Demo operator's codes come from it.

# 3. The Demo operator proposes the founder, with a code from that app. Prints "proposed <change id>" and the diff.
node --env-file=.env.production db/src/platform-cli.ts propose operator subject=$FOUNDER display_name="<founder's name>" \
  --subject $DEMO --code <code>

# 4. In a later 30-second step (a code counts once), the Demo operator approves it with the next code. It prints the
#    diff and asks; only "yes" approves. The approval mints the founder's TOTP secret and writes its authenticator URI to
#    .run/operator-<change id>.json (0600), inside the approval's transaction, and prints only the file's path.
node --env-file=.env.production db/src/platform-cli.ts approve <change id> --subject $DEMO --code <next code>

# 5. The founder adds that URI to their authenticator app, then deletes the file; it cannot be shown again.
node --env-file=.env.production db/src/platform-cli.ts list   # exits 1 if the platform chain does not verify
```

The founder then signs in at `/platform/sign-in` with the email, the password and a code, wherever the console runs: on
a laptop against this database, or on the hosted deployment, which runs it by the founder's ruling (`deploy/vercel.md`, "The
superadmin console"). Once the founder's operator works, the Demo operator can be deactivated the same way
(`propose operator id=<its operatorId, in .run/hosted-operator.json> active=false`, then `approve`, from the founder's own subject and codes; core
refuses to deactivate the last active operator), and `.run/hosted-operator.json` deleted.

**FACT, offline** (`ENROL1`, `db/test/v2/core/platform/founder.test.ts`, on a local PostgreSQL 17 built from
`db/schema`): this sequence through these commands' own code, from a seed-style "Demo operator" to the founder's
sign-in with password and code; each file 0600, and the new authenticator URI never printed (only written to its
file); and the refusals (a subject with a
shop membership, refused at the approval with MS007; a code from outside the window; a code used twice), each leaving no
operator and no file. **UNVERIFIED:** the same commands against the hosted project.

**In the console** (`/platform/operators`): an operator lists every operator beside the change that added it, the
operator changes waiting, and proposes an addition (an identity's subject and a display name) or a deactivation. The
console refuses to approve an addition: its approval mints a TOTP secret that must reach only the approver, once, and a
page has nowhere safe to show it, so its change page names the `platform:approve` command instead. A deactivation is
approved on its change page with a fresh code.

Later platform changes (defaults, a site's verification, a shop's models, features or budget) go the same way, through
the console or the CLI: `pnpm platform:propose <kind> [--tenant <slug>] key=value …`, then `platform:approve`. The
exact arguments are `db/src/platform-cli.ts`'s and `packages/core/src/platform.ts`'s; read their heads before running.

## 7. Check, from a clean checkout of the commit being deployed

```
node --env-file=.env.production scripts/deploy-check.ts
```

It must print `deploy-check: ok`. It refuses (FACT, `db/test/v2/deploy/deploy-check.test.ts`): a missing URL or
`MUNSHI_DEPLOYMENT`; two variables sharing a URL or a password; a URL whose login is not its role, or a superuser, an
RLS-bypassing, role- or database-creating, object-owning login, or (but for the migrator) a member of `munshi_owner`;
a database with no `ops.deployment` row, of the other kind, `hosted = false`, live but not built from migrations, or not
built from the checked-out `db/schema`; a partial or invalid WhatsApp or Instagram set (a complete set passes and is
noted by name only: any deployment may hold them); and (SUPA1) `anon`,
`authenticated`, `service_role` or any other non-superuser BYPASSRLS role that is not the admin holding USAGE on a
Munshi schema or any privilege on a Munshi table, `pgrst.db_schemas` on `authenticator` naming a Munshi schema, or a
Munshi-owned object in `public`. It prints `agent_large_objects=possible` on Supabase (expected, see step 2).

Also check by hand (not covered by the check): Settings → API → **Exposed schemas** lists only `public` and
`graphql_public` (where Supabase keeps that setting is UNVERIFIED, so `deploy-check` reads only the in-database form).

## 8. Real shops' email (Supabase Auth, D-080)

A real shop's sign-up verifies the owner's email through Supabase Auth's link before the shop is made. Supabase only
sends the link and vouches for the address; the identity stays Munshi's password identity (`idp.identity`,
`verified_via = 'email'`, only the email's HMAC kept). On a hosted or live database without these settings the site
offers no real sign-up at all ("Real shops open here soon"): an unverified email signs up only on a laptop or a test
database.

1. **Vercel env, all three or none** (`packages/config`; one without the others is a boot refusal, 503):
   - `SUPABASE_URL`: the project's `https://<ref>.supabase.co`.
   - `SUPABASE_PUBLISHABLE_KEY`: Settings → API → the publishable key.
   - `MUNSHI_APP_URL`: the app's public origin, e.g. `https://<host>` with no trailing slash. The email link returns
     here, never to a request's own Host or Origin.
2. **Authentication → URL Configuration:** Site URL is the app's origin (`MUNSHI_APP_URL`); add
   `https://<host>/sign-up/confirm` to **Redirect URLs**.
3. **Authentication → Email Templates:** in **both** "Confirm signup" and "Magic Link", make the link
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`. The app spends the token hash on the person's own post
   (POST `/auth/v1/verify`, type `email`), never on the link's GET, so a mail scanner that opens the link spends nothing.
   Which template a new address receives is UNVERIFIED from here: edit both, then send yourself one test sign-up.
4. **Authentication → Providers → Email:** keep **Confirm email** on.
5. **Authentication → SMTP Settings:** set a custom SMTP sender. Supabase's built-in sender is heavily rate-limited
   and meant for testing only.
6. The link works only in the browser that signed up, within the hour (the shop's details wait in a signed cookie
   there); the confirm page says so in English and Hindi.

What it leaves behind: `/auth/v1/otp` with `create_user` keeps the address in Supabase's own `auth.users`. The purge
of a lapsed sign-up erases Munshi's identity, not that row (the admin API with the secret key would; not wired).

## Not done here

- Supabase Storage as the blob adapter (BP-OPS-2; `packages/adapters` has no blob adapter yet).
- Supabase Auth as the identity itself: it only verifies a real shop's email (§8); sign-in stays the password identity.
- The live project (after 5 Nov, from migrations; BOOT1's live half).
