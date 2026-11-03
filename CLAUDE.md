# Munshi

An AI back office for any small shop that sells, stocks and buys (a kirana in the demo; restaurants too). It runs the
counter, stock, purchasing, books, customer credit and staff; its agents explain what happened, find money leaks and draft
the fix. Built for the Meta Global AI Developer Hackathon (Indie track, due Thu 5 Nov 2026, 07:30 IST). The same codebase
carries a Paytm edition (a config switch).

**Start here:** `docs/HANDOFF-CLOUD.md` (where the build stands, what is left, how to work, including in Claude Code cloud
sessions). The design is `docs/BLUEPRINT.md`; the plans are `docs/superpowers/plans/`; binding decisions are
`docs/DECISIONS.md`. `docs/BOARD.md` is history.

## The One Guarantee — outranks every feature

> **Nothing changes the books without a named person's approval, and every number shown traces to a ledger row.**

- *The books* = ledgers, stock, prices, catalogue, customer credit, staff records, and messages to customers or suppliers.
- A book row is written only by (a) a person's own direct command (a counter sale, a manual entry), or (b) an approved
  draft, executed under the approver's identity in ONE transaction with its audit entry. Nothing auto-applies.
- The agent's database role has **no write grant**. Agents propose drafts through the core API only.
- Every number on screen renders from a stored snapshot cell (a row the server read and stored), never from model text.
  Model prose never carries free digits. If a number cannot be traced: "Cannot verify".

## Fresh code (event rule — breaking it can disqualify)

Meta's Indie rules: "What you present at this Hackathon must have been built during the event." Everything in this repo is
written from 27 Oct 2026 on.
- Munim (`../foodops-os`, `../foodops-intel`) is the **design reference**: read its docs first (`docs/plan/*.md`), and
  open its source only when stuck on how something was solved.
- **Never copy a file, never paste a block of code** from Munim or any other repo. Write it new. Patterns and judgment
  carry over; files do not.
- Third-party npm packages are fine. No third-party art or copy text; synthetic data only.

## Hard rules

1. **Never read, print, copy or log `.env`.** Keys load through one config module that redacts secrets. Variable names
   are those in `.env.example`.
2. **Nothing proprietary from Juspay** (the founder's employer). Public knowledge and synthetic data only.
3. **Simulated means labelled.** Suppliers are simulated; data is synthetic; payments are recorded, never processed. A
   screen with simulated parts says so on the screen.
4. **No AI attribution** in commits or files (no Co-Authored-By, no "Generated with").
5. **Model-agnostic:** roles (router, reason, vision, segment, voice, narrate) map to a provider and model in config. No
   provider name in the database schema, no provider-specific code outside its adapter.
6. **Every gate can fail.** Red-prove each new test (show it fails when the thing it guards is broken) and that a failing
   run exits non-zero.

## Database rules (lessons measured on Munim; follow them exactly)

- `tenant_id` leads every key; RLS is enabled **and forced** on every tenant table; the app role never owns tables.
- Tenant and actor context only via `SET LOCAL` inside the transaction; read it with `nullif(current_setting(k, true), '')`
  (a pooled connection returns `''`, not NULL, after a `SET LOCAL` transaction ends).
- Any role can set a custom setting, so the book guard does not trust `munshi.decision_id` alone: it checks that the
  decision row exists, is approved, belongs to the same tenant, was created in this transaction (`txid_current()`) by a
  member allowed to approve it, and that the command admits the table being written. The acting member
  (`munshi.actor_id`) IS trusted from the app: it is set in ONE place from the signed-in session, `decide()` runs only
  from the approver's own request (actor = decided_by), watchers never set an actor, and `packages/agent` never imports
  the app's pool.
- Functions get EXECUTE granted to PUBLIC by default: revoke it per function (`REVOKE EXECUTE ON FUNCTION … FROM PUBLIC`);
  the `ALTER DEFAULT PRIVILEGES … IN SCHEMA` form does nothing.
- Never trust `create index if not exists`: assert the index in `pg_index`.
- **The schema is the ordered files `db/schema/00–90` (PostgreSQL 17), rebuilt from scratch on every build until the
  live freeze after 5 Nov (D-045).**
  - Fix forward by editing the file in place.
  - Keep every prefix buildable: a key to a later file's table is added by that later file, with `alter table`.
  - Keep `90_seal.sql` and each file's `.manifest.json` in step.
  - Schema files have **one owner at a time** (the migrator); no other session edits them.
  - `db/migrations` and the v1 harness (`db/test/*.test.ts`, `db/test/sabotage.ts`) are legacy, deleted by BP-FLIP.
  - `pnpm dev` builds the local database in `.run/pg17`.
- Every table has an explicit revoke-then-grant block. Books are append-only: no UPDATE/DELETE grant; corrections are
  reversals with a reason and an actor. Journal entries balance per currency at commit.
- Money in minor units plus currency. Time as `timestamptz`; one time-zone module.
- Never mock the database in tests: RLS and the guard are the things under test.
- The `embedded-postgres` package registers an exit hook that calls `process.exit(0)`: a failing test run can exit 0.
  The test harness must make failures exit non-zero, and that must be red-proved.

## How to work

Write the simplest thing that works; no abstraction for a single use. Read a file before editing it; match its style.
Comments only for the non-obvious. Say what you did and what you did not do. Show output; never claim a test passes
without running it.

**Lanes:** stay inside your ticket's file territory; a conflict means skip and report. Lanes never `git add`, `commit`,
`stash`, `reset`, `checkout --` or `clean`: the orchestrator commits. Stop on the second identical failure and report it.

**More rules:**
- **Red-proofing (D-056):** a lane red-proves only its own new or changed cases, once: `cd db && node test/redproof.ts
  --only=v2 <names>`. The full sweep runs at a wave close and before submission.
- **Never kill processes by pattern** (`pkill -f`, `pgrep | xargs kill`): kill only a PID you started. Lanes share
  machines.
- **Before every `git rebase --continue`,** check for conflict markers (`git grep -n '^<<<<<<< '`).
- **Under load,** a test file's setup hook can time out (kirana seed, 120 s). Re-run that file alone and report both runs.
- **Cloud sessions** follow `docs/HANDOFF-CLOUD.md` §6. In short: one ticket per session, on its own branch; only the
  integrator session pushes `main`.

## Layout

```
apps/web            Next.js 16 app (owner app, counter, demo sign-in, /api/v1 to come); proxy.ts sets headers and boot
apps/sites          the hosted shop sites (waits for the API and the founder's look)
packages/core       framework-free domain: commands, approvals, snapshots, reads, views, jobs, platform, sign-in
packages/ai         the provider layer (D-081): adapters, model catalogue, editions and fallback, recorded fixtures;
                    no database, no agent logic (gate B6)
packages/agent      the agent flows: ask, photos, bills, voice, read-aloud, tools, cite-or-abstain, recipes
packages/adapters   channels (WhatsApp, Instagram, recorded) and identity (password)
packages/config     the one config module (boot checks, redaction)
packages/contracts  API v1 zod schemas → openapi.json and the SDK's types (pnpm contracts)
packages/sdk        the dependency-free API client
db                  db/schema (v2 files), db/test/v2 (harness, gates, core tests, red-proofs), db/seed, db/src
design              visual-direction mock-ups for the founder's approval
docs                BLUEPRINT.md, DECISIONS.md, HANDOFF-CLOUD.md, superpowers/{specs,plans}
```
