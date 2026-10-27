# Deploying Munshi (Vercel + Neon)

Runbook. The detail lives in `deploy/neon.md` (database, logins, order of operations) and `deploy/vercel.md` (project
settings). Everything here was written offline: no network call, no `vercel` CLI, no external database.

1. Create the Neon project and the logins: `deploy/neon.md`.
2. Fill the git-ignored `.env.production` with the names listed there.
3. Migrate: `node --env-file=.env.production db/src/migrate.ts` (bootstrap `0001` as admin, the rest as `munshi_migrator`).
4. `node --env-file=.env.production scripts/deploy-check.ts` must print `deploy-check: ok`.
5. Create the Vercel project and set its variables: `deploy/vercel.md`.

## What is proved, and where

| Claim | Test |
|---|---|
| All migrations apply as `munshi_migrator` (not a superuser) after `0001`, and every `g*` guarantee gate then passes against that database | `db/test/ms13-migrator.test.ts` (child runs under `db/test/migrator.vitest.config.ts`) |
| A superuser migrator is refused | same file, red run (`MS13_SUPERUSER_MIGRATOR=1`) |
| `deploy-check` refuses a superuser or wrong app login, a shared URL, a missing URL, and never prints a URL | `db/test/ms13-deploy-check.test.ts` |

## Not done

- Never run against Neon or Vercel: Neon's behaviour on `0001` is UNVERIFIED (`deploy/neon.md`, Risks).
- No hosted seed step: `pnpm reseed` refuses anything but the local dev cluster.
- No migration was needed for the migrator path: every file after `0001` applies as `munshi_migrator` as written.
