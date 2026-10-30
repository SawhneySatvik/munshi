# Deploying the demo (Supabase + Vercel) — the runbook

For BP-OPS-2 (the founder and an Opus session) and W6's Meta-key steps. The detail lives in `deploy/supabase.md` (the
database: checks, bootstrap, roles, build, seed, operator, deploy-check) and `deploy/vercel.md` (the two projects, their
variables, the cron, Redis). Everything in BP-OPS-1 was written and tested **offline**: no Supabase, Vercel or Redis
account existed, and no network call was made to any of them. Tick each box in order; stop and report at the first one
that does not hold.

## 0 · Before anything: what the founder brings

- [ ] **A Supabase account**, and permission to create **one** project (the demo) in Mumbai.
- [ ] **A Vercel account** (Hobby is enough for the demo; its non-commercial-use term is a founder risk, MERCHANTS-DESIGN
      §8.1) able to create two projects from the private GitHub repository (HANDOFF-CLOUD §10 steps 1–3 done).
- [ ] **The Meta key** (`META_MODEL_API_KEY`), and Baseten's (`BASETEN_API_KEY`) for the narrator, for W6. Kept on this
      machine or as a cloud network secret (HANDOFF-CLOUD §10), never in a file that is committed.
- [ ] **The merchants' written permission** for their names, branding and photos on public pages (CLAUDE.md, HANDOFF §5
      item 5), before `munshi-shops-demo` is public; and which business that project builds (`MUNSHI_SITE`).
- [ ] **Decisions:** the region fallback if Mumbai is not offered (Singapore); whether the demo goes out with the memory
      cache (no hosted Redis yet, `deploy/vercel.md`); the operator's email for `platform:operator`.
- [ ] **A Redis account: not needed yet** (our adapter has no TLS).
- [ ] For the cloud environment only: a Custom network entry for `*.supabase.co` (HANDOFF-CLOUD §10 step 4).

## 1 · The Meta key (W6) — before or after the deploy, on the machine that holds the key

- [ ] `pnpm --filter @munshi/agent smoke` (`scripts/meta-smoke.ts`): one real call per model (Muse Spark 1.3 with a
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
- [ ] `db/src/build.ts` as the migrator; then the `ops.deployment` row (`demo`, `hosted = true`) as the owner, before
      any tenant.
- [ ] `pnpm platform:operator` (the founder's operator), before any showcase seeding.
- [ ] The seed: **no hosted seed script exists yet** (`deploy/supabase.md` §5 says what it must do). Until one is
      written and gated, the hosted demo has no shops.
- [ ] The demo defaults and both showcase sites verified through `pnpm platform:propose` / `platform:approve`.
- [ ] Storage: the blob adapter switched to Supabase Storage (no blob adapter exists yet; BP-OPS-2).
- [ ] From a clean checkout of the commit to deploy: `node --env-file=.env.production scripts/deploy-check.ts` prints
      `deploy-check: ok`.

## 3 · Vercel (`deploy/vercel.md`)

- [ ] `munshi-demo`: root `apps/web`, the settings in `apps/web/vercel.json`, the variables listed there (names only in
      the repo; values in the dashboard). No `WHATSAPP_*`, `INSTAGRAM_*`, migrator, admin or platform secret.
- [ ] `munshi-shops-demo`: root `apps/sites`, `MUNSHI_SITE` set, `MUNSHI_LIVE` unset.
- [ ] Deployed from a clean checkout of the same commit `deploy-check` passed on.
- [ ] `GET https://<munshi-demo>/api/health` answers `{ok: true, deployment: "demo", …}`; a 503 names its code.
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
| …refuses a demo config naming a channel credential | `DEPLOY1 deploy-check refuses a demo config that names a channel credential, …` | `v2-deploy-demo-channel` |
| …refuses no deployment row, the other kind, `hosted = false`, live from the schema (BOOT1's check), another build | `DEPLOY1 deploy-check refuses a database whose deployment row is missing, …` | `v2-deploy-no-row`, `v2-deploy-kind`, `v2-deploy-hosted`, `v2-deploy-live-source`, `v2-deploy-stale` |
| SUPA1: Supabase's API roles and other BYPASSRLS roles reach no Munshi schema or table; the Data API exposes none; nothing of ours in `public` | `SUPA1 deploy-check refuses anon, authenticated, service_role …` (roles of Supabase's names planted in a scratch clone) | `v2-deploy-supa-roles`, `v2-deploy-supa-bypass`, `v2-deploy-data-api`, `v2-deploy-public-object` |
| The CLI exits 1 on a refusal, 0 when clean, and prints no URL, password or server message | `DEPLOY1 the CLI exits 1 on a refusal and 0 when clean, …` | (covered by `v2-deploy-prints-url` in-process) |
| Boot refuses a demo deployment naming a channel credential | `CONFIG1 a demo deployment names no channel credential: …` (`packages/config/test/config.test.ts`) | `v2-config-demo-channel` |
| The capture guard's two modes and MERCHANTS-DESIGN §8.3's four red-proofs | `CAPTURE1 …` (`db/test/v2/deploy/capture-guard.test.ts`, three local HTTP servers) | `v2-capture-site-app-page`, `v2-capture-site-live-marker`, `v2-capture-app-no-health`, `v2-capture-app-live-class`, `v2-capture-site-state`, `v2-capture-cli-exit` |
| Only `apps/sites` may render the public-site marker | `CAPTURE1 only apps/sites may render the public-site marker: …` | `v2-capture-scan-web-marker` |
| Both `vercel.json` files: own app only, `bom1`, no values; one daily cron on a GET route | `VERCEL1 …` (`db/test/v2/deploy/vercel.test.ts`) | `v2-vercel-cron-path`, `v2-vercel-cron-hourly` |

Run them: `cd db && npx vitest run -c vitest.v2.config.ts test/v2/deploy/` and `cd packages/config && npx vitest run`;
red-prove: `cd db && node test/redproof.ts --only=v2 <case names>`.

## UNVERIFIED until the accounts exist

Supabase: PostgreSQL 17, `btree_gist`, Mumbai on the free plan, node-postgres through the transaction pooler, the
`<role>.<ref>` login form, the admin's behaviour on `00_bootstrap.sql`, TLS verification, where the Data API's exposed
schemas live. Vercel: pnpm 11, the filtered install, `apps/sites`' `distDir`, the cron's header and hour, function
duration. All of `deploy/supabase.md` steps 2–7 as run commands.

## Not done (BP-OPS-1)

- A hosted seed script (`db/seed`), and a `--deployment` flag on `db/src/build.ts`'s CLI.
- The boot half of BOOT1 (a hosted app refusing a `hosted = false` database, a live one not from migrations):
  `apps/web/lib/server/db.ts`; `deploy-check` covers the same before the deploy.
- The markers the capture guard reads, in `apps/web` (`<html data-class data-tenant>`) and `apps/sites` (the meta).
- TLS (`rediss://`) in the cache adapter and config.
- `.env.example` still points at `deploy/neon.md` (removed); the founder edits `.env.example` (BLUEPRINT §4.3).
