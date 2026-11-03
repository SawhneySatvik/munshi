# Deploying the demo (Supabase + Vercel) — the runbook

For BP-OPS-2 (the founder and an Opus session) and W6's Meta-key steps. The detail lives in `deploy/supabase.md` (the
database: checks, bootstrap, roles, build, seed, operator, deploy-check) and `deploy/vercel.md` (the project and its
services, the variables, the cron, Redis). BP-OPS-1 was written and tested **offline**. Since then, Vercel previews have
run (the probe result in `deploy/vercel.md`); no hosted Supabase run is recorded here. Tick each box in order; stop and
report at the first one that does not hold.

## 0 · Before anything: what the founder brings

- [ ] **A Supabase account**, and permission to create **one** project (the demo) in Mumbai.
- [ ] **A Vercel account** (Hobby is enough for the demo; its non-commercial-use term is a founder risk, MERCHANTS-DESIGN
      §8.1) able to create the project from the private GitHub repository (HANDOFF-CLOUD §10 steps 1–3 done).
- [ ] **The Meta key** (`META_MODEL_API_KEY`), and Baseten's (`BASETEN_API_KEY`) for the narrator, for W6. Kept on this
      machine or as a cloud network secret (HANDOFF-CLOUD §10), never in a file that is committed. Until then, in live
      mode, text and images run on Gemini (`GEMINI_API_KEY`) and voice, read-aloud and PDF bills on Sarvam
      (`SARVAM_API_KEY`); the shelf count needs Meta's key on either edition.
- [ ] **The merchants' written permission** for their names, branding and photos on public pages (CLAUDE.md, HANDOFF §5
      item 5), before the shop sites (`/s/elite`, `/s/prabhave`) are public.
- [ ] **Decisions:** the region fallback if Mumbai is not offered (Singapore); whether the demo goes out with the memory
      cache (no hosted Redis yet, `deploy/vercel.md`); the edition (`MUNSHI_EDITION`) for the Meta submission's demo.
- [ ] **A Redis account: not needed yet** (our adapter has no TLS).
- [ ] For the cloud environment only: a Custom network entry for `*.supabase.co` (HANDOFF-CLOUD §10 step 4).

## 1 · The Meta key (W6) — before or after the deploy, on the machine that holds the key

- [ ] `pnpm --filter @munshi/ai smoke` (`scripts/meta-smoke.ts`): one real call per model (Muse Spark 1.3 with a
      tool and a JSON schema, SAM 3.1, Voice Transcribe, Spark Open on Baseten). It reads keys from the repo's `.env` or
      the shell and never prints them. Every line must say ok; access is granted per model, so listing models proves
      nothing.
- [ ] `pnpm --filter @munshi/agent hero-smoke` (`scripts/hero-smoke.ts`) for the hero flows.
- [ ] Re-record the fixtures: run the tests that own them with `MUNSHI_AGENT_FIXTURES=write` (packages/agent) and
      `MUNSHI_WEB_FIXTURES=write` (apps/web), then run the same suites again without the variable; they must pass on the
      new recordings. Review the diff of the fixture files before committing: no key, no header, no real person.
- [ ] Decide `MUNSHI_MODEL_MODE` for the demo (`recorded` stays the safe default; the recorded seed date is 27 Oct,
      `db/src/dev.ts` `seedDate`).

## 2 · The database (`deploy/supabase.md`)

- [ ] Project created in Mumbai; the four first checks hold: PostgreSQL 17; `btree_gist` available; the region; the
      transaction pooler accepts node-postgres parameterised queries and `set_config(…, true)` (§1, step 4).
- [ ] `db/src/bootstrap.ts` as the admin (session pooler); it prints `agent_large_objects=possible` (expected).
- [ ] A generated password for each of the seven logins, set as the admin; the URLs in `.env.production` (runtime pools
      on 6543, the migrator on 5432); `ADMIN_DATABASE_URL` deleted afterwards.
- [ ] `db/src/build.ts --deployment demo` as the migrator: the build writes the `ops.deployment` row (`demo`,
      `hosted = true`) before any tenant.
- [ ] `node --env-file=.env.production db/seed/hosted.ts --confirm=<project ref>`: refuses unless the ref matches
      `DATABASE_URL`, the row says hosted demo and no tenant exists. It seeds the kirana, Bansal and both showcases,
      runs the watchers, and enrols the first operator ("Demo operator"; its sign-in and identity subject in
      `.run/hosted-operator.json`, 0600), who approves the demo defaults, the edition's model allow-list and both
      sites. It prints `MUNSHI_DEMO_TENANT_ID`. (`db/seed/hosted-copy.ts`, same flag, does the same far faster.)
- [ ] The founder's own operator (`deploy/supabase.md` §6; `pnpm platform:operator` is refused once one exists), on
      the machine holding `.run/hosted-operator.json`, each as `node --env-file=.env.production …`:
      1. `db/src/platform-identity.ts`: the founder's password identity; its subject to `.run/platform-identity.json`
         (0600). A subject is an identifier, not a credential: it appears in the CLI's diff, on its command line and
         on the console's Operators page.
      2. `db/src/platform-cli.ts propose operator subject=<founder subject> display_name=<name> --subject <Demo
         operator's subject> --code <code>`: the subjects are in those two files; the code from the authenticator app
         holding `.run/hosted-operator.json`'s `otpauth`.
      3. `db/src/platform-cli.ts approve <change id> --subject <Demo operator's subject> --code <next code>`, answer
         `yes`: the founder's authenticator URI goes to `.run/operator-<change id>.json` (0600, never printed). Add it
         to an authenticator app, delete the file, and sign in at `/platform/sign-in`.
      Proved offline by `ENROL1` (`db/test/v2/core/platform/founder.test.ts`); not yet run against the hosted project.
- [ ] Storage: the blob adapter switched to Supabase Storage (no blob adapter exists yet; BP-OPS-2).
- [ ] Real sign-up: Supabase Auth's email set up (`deploy/supabase.md` §8), or the hosted site offers no real sign-up.
- [ ] From a clean checkout of the commit to deploy: `node --env-file=.env.production scripts/deploy-check.ts` prints
      `deploy-check: ok`.

## 3 · Vercel (`deploy/vercel.md`)

- [ ] One project, `munshi`, from the root `vercel.json` (services `web`, `elite`, `prabhave`); if Vercel's packaging
      still fails, the fallback is one project per app (`deploy/vercel.md`). Variables by `deploy/vercel-env.ts` (names
      only in the repo; values in the dashboard). No migrator or admin secret; channel settings only on a deployment
      meant to send (`deploy/vercel.md`).
- [ ] The superadmin console on the hosted deployment, **by the founder's ruling** (3 Nov; `deploy/vercel.md`, "The
      superadmin console"): on the same site as the app, behind TOTP, and linked from nowhere on the site (UNLINKED1;
      every `/platform` response says `X-Robots-Tag: noindex, nofollow`, ROBOTS1; `robots.txt` does not name it). Run
      `vercel-env.ts` with `--with-console` (it sends the seed's `MUNSHI_PLATFORM_SECRET`, and refuses without it or
      without the identity and rate secrets) and redeploy. That exposes `/platform/sign-in` (email, password and a code)
      and nothing else without an operator session. A deployment run without the flag has no console (every `/platform`
      page 404); `vercel env rm MUNSHI_PLATFORM_SECRET production` removes a key set before. A live deployment requires
      it: boot refuses a live config without the key, and `vercel-env.ts` refuses live without the flag.
- [ ] Deployed from a clean checkout of the same commit `deploy-check` passed on.
- [ ] `GET https://<munshi>/api/health` answers `{ok: true, deployment: "demo", …}`; a 503 names its code.
- [ ] The cron is listed under the project's Cron Jobs; its first run logs a 200 from `/api/internal/tick` (a 404
      means `CRON_SECRET` is unset or different).
- [ ] The real origins written into `deploy/capture-guard.json` (`appOrigins`: both app deploys' URLs, demo and the
      future live one) and committed.

## 4 · Before the film and the screenshots (W7)

- [ ] `node scripts/capture-guard.ts --mode app <app page URLs…>` and `--mode site <site page URLs…>` exit 0 for the
      pages about to be captured. **Today they cannot:** the guard requires `<html data-class data-tenant>` on app pages
      and `<meta name="munshi-surface" content="public-site">` on site pages, and neither app renders them yet (an
      `apps/web` and an `apps/sites` change, outside BP-OPS-1).

## What is proved offline, and by which test

| Claim | Test (file) | Red-proofs (`db/test/v2/sabotage/deploy.ts`) |
|---|---|---|
| The bootstrap runs on a non-superuser admin (as Supabase's `postgres` is), prints the large-object residual, and the whole build then runs as `munshi_migrator` | `SUPA1 the bootstrap runs as a non-superuser admin, …` (`db/test/v2/gates/00-bootstrap.test.ts`, its own PostgreSQL 17) | `v2-boot-as-superuser` (`sabotage/bootstrap.ts`) |
| deploy-check passes a hosted demo database whose URLs are each its own role | `DEPLOY1 deploy-check passes a hosted demo database …` (`db/test/v2/deploy/deploy-check.test.ts`) | (the refusals below) |
| …refuses a missing URL or `MUNSHI_DEPLOYMENT` | `DEPLOY1 deploy-check refuses a missing URL or MUNSHI_DEPLOYMENT, naming each` | `v2-deploy-missing-url`, `v2-deploy-missing-deployment` |
| …refuses a shared URL or password | `DEPLOY1 deploy-check refuses two variables sharing a URL or a password` | `v2-deploy-shared-url`, `v2-deploy-shared-password` |
| …refuses a superuser, a wrong login, a member of the owner; prints only error codes | `DEPLOY1 deploy-check refuses a superuser, the migrator or another role behind a pool URL, …` | `v2-deploy-wrong-login`, `v2-deploy-superuser`, `v2-deploy-member-of-owner`, `v2-deploy-prints-url` |
| …passes a demo config holding complete channel settings, noting them by name; refuses a partial or invalid set | `DEPLOY1 deploy-check passes a demo config holding complete channel settings, …` | `v2-deploy-channel-partial`, `v2-deploy-demo-channel` (the note printing values) |
| …refuses no deployment row, the other kind, `hosted = false`, live from the schema (BOOT1's check), another build | `DEPLOY1 deploy-check refuses a database whose deployment row is missing, …` | `v2-deploy-no-row`, `v2-deploy-kind`, `v2-deploy-hosted`, `v2-deploy-live-source`, `v2-deploy-stale` |
| SUPA1: Supabase's API roles and other BYPASSRLS roles reach no Munshi schema or table; the Data API exposes none; nothing of ours in `public` | `SUPA1 deploy-check refuses anon, authenticated, service_role …` (roles of Supabase's names planted in a scratch clone) | `v2-deploy-supa-roles`, `v2-deploy-supa-bypass`, `v2-deploy-data-api`, `v2-deploy-public-object` |
| SUPA2: Supabase's two platform read roles are a named note only while `pg_read_all_data` is how they reach us | `SUPA2 Supabase's two platform read roles are a named note only …` | `v2-supa2-unconfirmed` |
| The CLI exits 1 on a refusal, 0 when clean, and prints no URL, password or server message | `DEPLOY1 the CLI exits 1 on a refusal and 0 when clean, …` | (covered by `v2-deploy-prints-url` in-process) |
| Any deployment may hold channel settings; an error names a setting, never its value (a send still needs live mode, an accepted real shop, its grant and a listed recipient) | `CONFIG1 any deployment may hold channel settings: …` (`packages/config/test/config.test.ts`) | `v2-config-demo-channel` (the old demo refusal put back) |
| The capture guard's two modes and MERCHANTS-DESIGN §8.3's four red-proofs | `CAPTURE1 …` (`db/test/v2/deploy/capture-guard.test.ts`, three local HTTP servers) | `v2-capture-site-app-page`, `v2-capture-site-live-marker`, `v2-capture-app-no-health`, `v2-capture-app-live-class`, `v2-capture-site-state`, `v2-capture-cli-exit` |
| Only `apps/sites` may render the public-site marker | `CAPTURE1 only apps/sites may render the public-site marker: …` | `v2-capture-scan-web-marker` |
| Both `vercel.json` files: own app only, `bom1`, no values; one daily cron on a GET route | `VERCEL1 …` (`db/test/v2/deploy/vercel.test.ts`) | `v2-vercel-cron-path`, `v2-vercel-cron-hourly` |
| The root services file: both sites before the web catch-all, no values | `VERCEL2 the services layout routes both sites …` | `v2-vercel-services-catchall-order`, `v2-vercel-services-env-value` |
| The founder's operator: identity, proposal and approval by the seed's "Demo operator" through the CLI, each secret only in a 0600 file, then sign-in with password and code; refused for a shop member, a code outside the window, a code used twice | `ENROL1 …` (`db/test/v2/core/platform/founder.test.ts`) | `v2-enrol-identity-stdout`, `v2-enrol-identity-mode`, `v2-enrol-approve-stdout`, `v2-enrol-approve-mode`, `v2-enrol-seed-subject`, `v2-enrol-hosted-name`, `v2-enrol-member`, `v2-enrol-stale-code`, `v2-enrol-code-twice` (`sabotage/operator.ts`) |
| The console proposes an operator, refuses to approve an addition itself, and the CLI-enrolled operator signs in to it | `ENROL1 the console proposes an operator …` (`apps/web/test/console.test.tsx`) | `v2-enrol-console-approves`, `v2-enrol-console-no-form` |
| The console's key: optional on demo, required on live; `vercel-env.ts` sends it only with `--with-console`, and refuses live without it | `CONFIG1 the console’s platform key is optional on demo, required on live, …` (`packages/config`); `VERCEL-ENV1 …` (`db/test/v2/deploy/vercel-env.test.ts`) | `v2-config-live-console-key`, `v2-vercel-env-console-always`, `v2-vercel-env-live-without`, `v2-vercel-env-console-signin` |
| The console is linked from nowhere on the site (product site, /app, /demo, /developers, the shop sites, the public files) and links back to the site; every /platform response says `X-Robots-Tag: noindex, nofollow`, served or refused | `UNLINKED1 …` (`apps/web/test/unlinked.test.ts`); `ROBOTS1 …` (`db/test/v2/core/boot/robots.test.ts`) | `v2-unlinked-planted`, `v2-unlinked-no-way-out`, `v2-robots-untagged` |

Run them: `cd db && npx vitest run -c vitest.v2.config.ts test/v2/deploy/` and `cd packages/config && npx vitest run`;
red-prove: `cd db && node test/redproof.ts --only=v2 <case names>`.

## UNVERIFIED until the accounts exist

Supabase: PostgreSQL 17, `btree_gist`, Mumbai on the free plan, node-postgres through the transaction pooler, the
`<role>.<ref>` login form, the admin's behaviour on `00_bootstrap.sql`, TLS verification, where the Data API's exposed
schemas live. Vercel: packaging the three services from one root (previews built them but failed to package,
`deploy/vercel.md`), the cron's header and hour, function duration. All of `deploy/supabase.md` steps 2–8 as run
commands.

## Not done

- The boot half of BOOT1 (a hosted app refusing a `hosted = false` database, a live one not from migrations):
  `apps/web/lib/server/db.ts`; `deploy-check` covers the same before the deploy.
- The markers the capture guard reads, in `apps/web` (`<html data-class data-tenant>`) and `apps/sites` (the meta).
- TLS (`rediss://`) in the cache adapter and config.
- Supabase Storage as the blob adapter.
