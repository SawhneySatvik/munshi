# db

The database: the schema as ordered SQL files, the synthetic seeds, the tools that build and check a database, and
the test harness for everything that touches data.

## Layout

| Path | What |
|---|---|
| [`schema/`](schema) | `00_bootstrap.sql` to `90_seal.sql` (PostgreSQL 17), applied in order, each with a `.manifest.json` of its tables, grants, policies and indexes |
| [`src/dev.ts`](src/dev.ts) | `pnpm dev`: an embedded PostgreSQL 17 in `.run/pg17`, built, seeded, then the app |
| [`src/bootstrap.ts`](src/bootstrap.ts), [`src/build.ts`](src/build.ts), [`src/reset.ts`](src/reset.ts) | `pnpm db:bootstrap` (roles, as the admin), `pnpm db:build` (every schema file, as the migrator), `pnpm db:reset` |
| [`src/deploy-check.ts`](src/deploy-check.ts) | The checks a hosted database must pass before a deploy |
| [`src/supabase-roles.ts`](src/supabase-roles.ts) | Bootstrap and per-role passwords on a Supabase project |
| [`src/platform-cli.ts`](src/platform-cli.ts), [`src/platform-identity.ts`](src/platform-identity.ts), [`src/platform-operator.ts`](src/platform-operator.ts) | Operators and platform changes from the command line (`pnpm platform:list`, `platform:propose`, `platform:approve`, `platform:reject`) |
| [`seed/`](seed) | The synthetic shops, seeded through core's real paths. [`kirana.answers.json`](seed/kirana.answers.json) is the hand-worked answer key for the demo kirana's planted problems |
| [`test/v2/`](test/v2) | The harness, the gates, core's database tests, deploy checks, and the sabotage cases |
| [`test/redproof.ts`](test/redproof.ts) | Proves each gate fails when its protection is removed |

## The schema's rules

- `tenant_id` leads every key; row-level security is enabled and forced on every tenant table; runtime roles own
  nothing.
- Every table has an explicit revoke-then-grant block. Books are append-only, with no UPDATE or DELETE grant;
  corrections are reversals.
- Every function's `search_path` is pinned and its PUBLIC EXECUTE revoked by name. Three functions are
  `SECURITY DEFINER`, each listed in the seal ([docs/security.md](../docs/security.md#security-definer-functions)).
- A file is fixed in place. Every prefix of the files must build on its own: a key to a later file's table is added
  by that later file. Each file's manifest and `90_seal.sql` change with it.
- Indexes are asserted in `pg_index` by the gates, never trusted to `create index if not exists`.
- Money is integer minor units with a currency; time is `timestamptz`.

## Testing

```bash
pnpm --filter @munshi/db test                     # gates, core's tests, deploy checks (embedded PostgreSQL 17)
cd db && node test/redproof.ts <case names>       # red-prove named cases
cd db && npx vitest run -c vitest.perf.config.ts  # query plans at volume (slow)
```

See [docs/testing.md](../docs/testing.md).
