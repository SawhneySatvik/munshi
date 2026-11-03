# Contributing to Munshi

Thank you for helping. Munshi keeps one promise above every feature, and review holds every change to it:

> **Nothing changes the books without a named person's approval, and every number shown traces to a ledger row.**

## Setup

Needs Node 22 or later and pnpm 11. No Docker, no database to install, no API key.

```bash
pnpm install
pnpm dev        # embedded PostgreSQL 17, the schema, the sample shops, then the app at http://localhost:3000
pnpm check      # lint, typecheck and every test
```

Settings are environment variables; the names are in [`.env.example`](.env.example). Never commit a `.env` file, and
never print or log a secret.

## The review bar: the One Guarantee

A change is ready only when the answer to each of these is yes.

1. **Does any new write to the books go through a person's direct command or an approved draft?** Agents propose
   drafts through core; they never write. The agent's database role has no write grant, and that stays true.
2. **Does every number on screen, in an answer, in a draft or through the API come from a stored snapshot cell?**
   Model text never carries free digits. If a number cannot be traced, the screen says "Cannot verify".
3. **Is context set only by `withTx`?** Shop, actor and command are transaction-local (`SET LOCAL`), set in one place
   from the signed-in session.
4. **Does every new table have row-level security enabled and forced, `tenant_id` leading its keys, and an explicit
   revoke-then-grant block in its schema file and manifest?**
5. **Is anything simulated labelled as simulated on the screen that shows it?**
6. **Does every new gate have a red-proof?** (below)

## Tests

- **Never mock the database.** Row-level security, grants and the book guard are what is under test. Use the
  embedded-PostgreSQL harness in [`db/test/v2`](db/test/v2).
- **A new gate needs a red-proof.** Add a sabotage case that breaks exactly the protection your test guards, then run
  `cd db && node test/redproof.ts <your case>` and paste its **RED** output in the pull request. A test that has never
  failed proves nothing. See [docs/testing.md](docs/testing.md#adding-a-gate).
- **Never call a model in a test.** Use recorded fixtures.
- Run only the files and cases you touched while working; run `pnpm check` before you open the pull request. If a
  setup hook times out under load, re-run that file alone and report both runs.

## Conventions

- **TypeScript, ES modules, Node 22.** Biome lints (`pnpm lint`). Match the style of the file you are in.
- **The simplest thing that works.** No abstraction for a single use. Domain rules live in `packages/core`, not in
  components or route handlers. Provider-specific code lives only in its adapter in `packages/ai`, and no provider name
  reaches the database.
- **Comments only for the non-obvious:** why, not what.
- **Money** in integer minor units with a currency; **time** as `timestamptz`, through the one time module.
- **The schema** is the ordered files in [`db/schema`](db/schema). Fix a file in place, keep every prefix buildable,
  and keep its manifest and `90_seal.sql` in step. Revoke EXECUTE from PUBLIC on every new function, by name.
- **Data** in the repository is synthetic. No real person, shop or customer; no third-party art or copy text.
- **Commits** are plain sentences in the imperative that say what changed and why, readable by someone new to the
  project. No internal ticket names.

## Pull requests

Say what you changed, what you verified (with the command output), and what you did not do. If the change touches the
books, approvals, snapshots, roles or grants, say which gates cover it and include their red-proofs.

## Licence

By contributing, you agree that your contributions are licensed under the [Apache License, Version 2.0](LICENSE).
