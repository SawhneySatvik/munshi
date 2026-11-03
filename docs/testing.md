# Testing

Munshi's tests exist to prove the One Guarantee holds, so two rules shape them:

1. **The database is never mocked.** Row-level security, grants and the book guard are the things under test, so every
   test that touches data runs against a real PostgreSQL 17 built from `db/schema`.
2. **Every gate can fail.** Each protection has a sabotage case that removes it, and a harness that requires the
   gate's test to go red under that sabotage and green without it.

- [Running the suites](#running-the-suites)
- [The embedded-PostgreSQL harness](#the-embedded-postgresql-harness)
- [Gate families](#gate-families)
- [Red-proofs: the sabotage registry](#red-proofs-the-sabotage-registry)
- [Adding a gate](#adding-a-gate)
- [Recorded model fixtures](#recorded-model-fixtures)
- [Known flakiness](#known-flakiness)

## Running the suites

Everything uses [Vitest](https://vitest.dev). No Docker and no database install: the harness downloads and starts its
own PostgreSQL 17.

| Command | Runs |
|---|---|
| `pnpm check` | Lint (Biome), typecheck and every package's tests |
| `pnpm test` | Every package's tests |
| `pnpm --filter @munshi/db test` | The database gates, core's database-backed tests, the deploy checks and the harness's own tests ([`db/vitest.v2.config.ts`](../db/vitest.v2.config.ts)) |
| `cd db && npx vitest run -c vitest.v2.config.ts test/v2/gates/02-books-guard.test.ts` | One file |
| `pnpm --filter @munshi/web test` | The app's screens and server actions, rendered from a seeded database |
| `pnpm --filter @munshi/sites test` | The shop sites, against the real API on a seeded database |
| `pnpm --filter @munshi/core test` | Core's unit tests and the source-scanning boundary gates |
| `pnpm --filter @munshi/agent test` | The validator, its precision corpus and the agent flows on recorded fixtures |
| `pnpm --filter @munshi/ai test`, `@munshi/adapters`, `@munshi/config`, `@munshi/contracts`, `@munshi/sdk`, `@munshi/widgets` | Each package's own tests |
| `cd db && npx vitest run -c vitest.perf.config.ts` | Query plans at volume. Slow (it builds a large dataset); not part of `pnpm check` |
| `cd db && node test/redproof.ts <case names>` | Red-prove the named cases |
| `pnpm redproof` | Red-prove every case (slow; run on a quiet machine) |

This page quotes no test counts; run the commands to see current ones.

## The embedded-PostgreSQL harness

[`db/test/v2/global-setup.ts`](../db/test/v2/global-setup.ts) starts one PostgreSQL 17 cluster per Vitest run, using
the `embedded-postgres` package. It bootstraps a template database as the superuser (only for
`00_bootstrap.sql`, as an administrator would), then builds every schema file over a `munshi_migrator` connection, as on
a hosted database, so a file that needs a superuser fails every suite. Each test file then clones the template
([`db/test/v2/db.ts`](../db/test/v2/db.ts)) and connects as the runtime roles it is testing: `munshi_app`,
`munshi_agent`, `munshi_jobs` and the rest.

The app's tests ([`apps/web/vitest.config.ts`](../apps/web/vitest.config.ts)) use the same cluster: each file seeds the
demo kirana through core's real paths into a fresh clone and renders screens from it. They mock only the framework's
request boundary (cookies, revalidation, redirects), never the data.

**A failing run must exit non-zero.** `embedded-postgres` registers an exit hook that calls `process.exit(0)`, which
can turn a failing run into a passing exit code. The harness counts and neutralises those hooks, and
[`db/test/v2/g8-exit-code.test.ts`](../db/test/v2/g8-exit-code.test.ts) (gate G8) runs a deliberately failing suite
and a passing one in child processes and checks their exit codes.

## Gate families

Test names start with a gate id, so a failure names the protection it guards.

| Family | Guards | Where |
|---|---|---|
| **G1–G13** | The database: the agent role's lack of writes (G1), the book guard (G2), commands and tables in step (G3), forced RLS with no context seeing nothing (G4), append-only books (G5), balanced journals (G6), the audit chain (G7), the exit code (G8), function grants (G9), every index declared and present (G10), children only in their parent's transaction (G11), member additions audited (G12), the global tables (G13) | [`db/test/v2/gates`](../db/test/v2/gates), one file per schema area |
| **B0–B6** | Package boundaries, by scanning source: the import scanner itself (B0); the agent reaches no core writer, app pool or database URL (B1); the read entry point writes nothing (B2); only `withTx` names the actor setting (B3); only `mintSnapshot` writes snapshots (B4); the number detector is shared, not copied (B5); `packages/ai` imports no Munshi package or database driver (B6) | [`packages/core/test/boundary.test.ts`](../packages/core/test/boundary.test.ts), [`numbers.test.ts`](../packages/core/test/numbers.test.ts) |
| **C** | Core's domain: errors carry no row values, unknown reads are refused, approvals, watchers' dedupe | [`db/test/v2/core`](../db/test/v2/core) |
| **H** | The hero flows and photo evidence: shelf counts, bills, the hash binding a stored count | [`db/test/v2/core/hero`](../db/test/v2/core/hero), [`apps/web/test`](../apps/web/test) |
| **Feature families** | Named by area: orders, roles, PayPal, the PWA, memory, the router, spend, channels, deploy checks and more | Beside the code they test |
| **Type-level gates** | A hand-built `Session` and a command result carrying a number, each under `@ts-expect-error`, so `tsc` fails if either ever compiles | [`packages/core/test/types.ts`](../packages/core/test/types.ts) |

The agent's validator has a precision corpus ([`packages/agent/test/corpus`](../packages/agent/test/corpus)): clean
sentences that must pass and attacks that must be refused.

## Red-proofs: the sabotage registry

A test that cannot fail proves nothing. Every gate is paired with at least one sabotage case in
[`db/test/v2/sabotage`](../db/test/v2/sabotage), one file per area, joined in
[`index.ts`](../db/test/v2/sabotage/index.ts). A case ([`case.ts`](../db/test/v2/sabotage/case.ts)) names the test file,
the exact test title that must fail, and one way of breaking the protection:

| Kind | How it breaks the protection |
|---|---|
| `sql` | SQL run as the superuser in the test file's fresh database at the end of its setup, such as replacing a guard function's refusal with `return new` |
| `ts` | A source-text mutation applied as Vitest loads the module, through the sabotage plugin in each Vitest config |
| `none` | A harness-level switch the code under test asks for with `sabotageIs(name)` |

For example, `v2-g2-no-command` rewrites `books.write()` so a book write with no decision and no command is admitted;
the test `G2 a book write with no decision and no direct command is refused` must then fail.

[`db/test/redproof.ts`](../db/test/redproof.ts) runs each case and judges it from Vitest's JSON report, not the exit
code alone, so a typo'd filter or a harness crash cannot pass for a red:

1. **Clean run.** Each named test must pass with no sabotage applied.
2. **Sabotaged run.** For each case, only its named test runs, with the sabotage applied. The verdict is **RED** only if
   that test failed, no other test ran, and the process exited non-zero.
3. **Applied, or an error.** Every sabotage path reports whether it applied. One that failed to apply, or never
   applied, is an **ERROR**, never a red.
4. **Self-test.** A full run first runs planted cases that cannot apply and requires an ERROR for each, so the ERROR
   branch is itself proven every run.

Any NOT RED or ERROR makes the run exit 1. Sabotaged runs turn off Vitest's transform cache, which would otherwise serve
the unmutated module.

```
$ cd db && node test/redproof.ts v2-g2-no-command
clean    db (vitest.v2.config.ts) exit 0  … tests passed
RED      v2-g2-no-command             exit 1  G2 a book write with no decision and no direct command is refused: failed

redproof: 1 RED, 0 NOT RED, 0 ERROR of 1 cases (v2 1 RED, 0 NOT RED, 0 ERROR); green when clean
```

## Adding a gate

1. Write the test. Start its title with its gate id, and assert the refusal precisely (the error code, the row count).
2. Add a sabotage case to the area's file in `db/test/v2/sabotage` (or a new file joined in `index.ts`) that breaks
   exactly the protection the test guards.
3. Run `cd db && node test/redproof.ts <your case>` and confirm **RED**. Paste the output in your pull request.
4. Run the test file clean and confirm it passes.

A new or changed gate without a red-proof is not done. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Recorded model fixtures

Tests never call a model provider. In recorded mode (the default) every model call is answered from a committed fixture
keyed by the sha256 of the request's canonical form; a request with no fixture is a model error, which the flow turns
into an abstention. Fixtures live in `packages/agent/fixtures`, `apps/web/fixtures` and `packages/ai/fixtures`.

To re-record after a prompt change, with live keys set, run the owning tests with `MUNSHI_AGENT_FIXTURES=write`
(`packages/agent`) or `MUNSHI_WEB_FIXTURES=write` (`apps/web`), run them again without it, and review the fixture diff
before committing: no key, no header, no real person. The Meta fixtures in the repository are hand-written, not
recordings of Meta's models.

## Known flakiness

- **Setup timeouts under load.** A test file's setup seeds a shop through core's real paths, with a 120-second hook
  timeout. On a busy machine (a full `pnpm check` while other work runs) a setup hook can time out. Re-run that file
  alone; a genuine failure reproduces, a load timeout does not.
- **The full red-proof sweep is slow**, since each case runs Vitest afresh. Run it on a quiet machine; for a change,
  red-prove only the cases you added or changed.
- **Vitest re-runs a file when a worker is lost under load.** The red-proof harness tolerates a test that passed every
  time it ran and notes it.
