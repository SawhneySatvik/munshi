# Munshi

An AI back office for any small shop that sells, stocks and buys (a kirana in the demo; restaurants too). It runs the
counter, stock, purchasing, books, customer credit and staff; its agents explain what happened, find money leaks and draft
the fix. Built for the Meta Global AI Developer Hackathon (Indie track, due Thu 5 Nov 2026, 07:30 IST). The same codebase
carries a Paytm edition (a config switch). Plan: `docs/BOARD.md`.

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

## Layout

```
apps/web          Next.js app (owner phone app, counter, storefront)   — UI waits for the founder's approved look
packages/core     framework-free domain: money, time, ledger, stock, approvals, snapshots, audit
packages/agent    model adapters (providers by role), tools, cite-or-abstain
db                SQL migrations, roles, the test harness (embedded Postgres)
design            visual-direction mock-ups for the founder's approval
docs              BOARD.md (tickets), ARCHITECTURE.md, SCHEMA.md
```
