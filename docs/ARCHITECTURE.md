# Munshi architecture

The parts, the trust boundary, and how the One Guarantee is held: *nothing changes the books without a named person's
approval, and every number shown traces to a ledger row.* Where this page and the code disagree, the code wins
(`db/migrations/*.sql` is the database contract; `docs/SCHEMA.md` describes it).

## Parts

```
phone / counter / storefront
        │  HTTPS (session cookie → member, tenant)
        ▼
apps/web   Next.js app. Route handlers authenticate the member and call packages/core. No domain logic in components.
        │
        ├── packages/core   framework-free domain: money, time (Asia/Kolkata, one module), commands, approvals,
        │                   snapshots, audit. Holds the APP pool (role munshi_app).
        │
        └── packages/agent  model adapters by role (router, reason, vision, segment, voice, narrate), tools,
                            cite-or-abstain. Holds only the AGENT pool (role munshi_agent, read-only).
        ▼
Postgres   schemas ops, books, approval, snap, audit, agent_view (db/migrations). Embedded Postgres in every test.
```

One server process. There is no separate API service and no run token: the agent runs inside the same server, so the
tenant and the member come from the authenticated session, never from a model argument. A tool closes over the request's
context; no tool schema has a tenant field.

## The trust boundary

| | `munshi_app` (packages/core) | `munshi_agent` (packages/agent) |
|---|---|---|
| Reads | every table, under RLS | `snap.*` and the `agent_view.*` views (names and ids, no numbers), under RLS |
| Writes | ops/approval/snap/audit rows; books **only through the book guard** | **nothing** — no INSERT/UPDATE/DELETE/TRUNCATE on any table, no TEMP, no CREATE on any schema, no large-object functions (gate G1); two caveats below |
| Proposes a change | — | by calling core's `proposeDraft`, which writes an `approval.draft` row on the app pool |

The agent never holds the app pool. Its only path to a book row is a draft that a person approves.

Caveats no grant closes: any role can take advisory locks (the audit chain needs `pg_advisory_xact_lock` as the app), so
the agent could hold a tenant's audit lock and stall its appends — a stall, not a write; and any role can `NOTIFY`, so a
notification is only a hint to re-read rows, never data. 0001 runs as a superuser: it revokes TEMP and the large-object
functions from PUBLIC and fails if they are still granted (a non-owner's REVOKE only warns).

Roles: `munshi_owner` (NOLOGIN) owns every schema, table, view and function; `munshi_migrator` (LOGIN, member of
`munshi_owner`) is meant to run migrations (so far applied only by a superuser); `munshi_app` and `munshi_agent` own nothing. None is a superuser or has BYPASSRLS
(gate G4). RLS is enabled **and forced** on every tenant table, so even the owner (and therefore every view) sees only the
current tenant.

**Context.** Every transaction sets its context with `SET LOCAL` (in code: `set_config(name, value, true)`):
`munshi.tenant_id`, `munshi.actor_id` (the member), `munshi.command` (a direct command such as `sale.record`) or
`munshi.decision_id` (an approved decision being executed). Policies and the guard read
`nullif(current_setting(k, true), '')`, because a pooled connection returns `''` after a `SET LOCAL` transaction ends.
No context → no rows and no book writes (gates G2, G4).

## The books and the book guard

The books are the `books` schema: items, prices, stock moves, suppliers, purchases, sales, payments (recorded, never
processed), customers, credit (udhaar), journal entries, staff, attendance and outbound messages. They are append-only:
`munshi_app` holds SELECT and INSERT only; a correction is a reversal row with `reverses_id` and a reason (gate G5). Core
writes the opposite amounts; the database does not check them.

Any role can set any custom setting. The guard checks the decision and the command against rows, but **the actor
setting is trusted from the app**: the database cannot see who is at the keyboard, so the app sets `munshi.actor_id` in
one place, from the authenticated session, and `decide()` runs only on the approver's own request (the agent's role
cannot write, so it cannot act as anyone). A trigger on every books table admits an INSERT only if one holds:

- **(a) an approved decision of this transaction:** `munshi.decision_id` names a decision that exists, is `approved`,
  belongs to this tenant, was created in this transaction (`created_txid = txid_current()`, stamped by a trigger, so a
  caller cannot forge it) and was made by an active member whose role holds the draft's command; or
- **(b) a direct command:** `munshi.command` is a command the acting member's role (active, same tenant) holds in
  `ops.command_authority` (global, read-only, changed only by a migration);

and, in both cases, the admitting command (the draft's, or the direct one) writes this table in `ops.command_table`
(global, read-only): holding `sale.record` admits a sale, not a price. Anything else raises `MS001`. The guard stamps
`created_by` (the commanding or approving member), `decision_id` and `created_at`; an AFTER ROW trigger then appends the
written row to the tenant's audit chain in the same statement (after, so an insert that `ON CONFLICT DO NOTHING` skips
is not logged): **no book row exists without an audit entry naming its person** (gates G2, G3, G7). Journal entries must
balance per currency at commit (deferred constraint trigger, gate G6), and a line is accepted only in the transaction
that created its entry, so a committed entry cannot grow (gate G11).

## Drafts and decisions (nothing auto-applies)

1. **Propose.** The agent, a watcher or a member calls `proposeDraft(command, payload, basedOn)`. `based_on` lists the
   snapshot cells the proposal relied on. Status `proposed`.
2. **Decide**, in one transaction on the approver's own request: lock the draft (`proposed`); re-read each `based_on`
   cell — if any changed, mark the draft `stale` and commit only that; otherwise insert the decision (one per draft,
   ever; `decided_by` must be the acting member; the draft must come from an earlier transaction), set
   `munshi.decision_id`, execute the command under the approver's identity (the guard admits and audits each row), mark
   the draft `executed`, commit. A rejection inserts a `rejected` decision and marks the draft `rejected`.

A decision admits writes only in the transaction that made it, so it cannot be replayed later or by another tenant. A
draft's status follows its decision: `executed` only under an approved decision of this transaction, `rejected` only
under a rejected one, `stale`/`failed` only while undecided; a new draft is always `proposed` (gate G2).

## Numbers: snapshot cells

Every number on screen renders from a stored snapshot cell. `mintSnapshot(name, params)` (core) runs a named read under
the tenant's RLS and stores the result in `snap.snapshot` + `snap.snapshot_cell` (one typed value per row × column:
integer, money in minor units + currency, quantity in milli-units + unit, text, date, timestamp). A reference
`⟨snap:ID·row·col⟩` resolves to one cell. Model prose carries refs, never free digits; a reply with a number that is not
a ref renders as "Cannot verify". The agent reads snapshots; it never writes them. A cell is accepted only in the
transaction that created its snapshot, so a stored snapshot cannot gain cells later (gate G11).

## The audit chain

`audit.audit_log` is append-only and hash-chained per tenant: `hash(n) = sha256(hash(n-1) ‖ canonical(entry n))`; the
insert trigger assigns `seq`, `prev_hash`, `hash` and `created_at`, so callers cannot choose them. An entry must name the
acting member; an entry for a book row needs that row, written by that member under that decision, and each book row has
exactly one entry (a partial unique index). Appends are serialised per tenant by a transaction-level advisory lock (fine
for one shop; a hot tenant would queue). `audit.verify_chain(tenant)` recomputes the chain and returns the first broken
`seq` (a tampered or deleted row) or NULL; it refuses a tenant other than the current one rather than "verifying" an
RLS-empty chain (gate G7). It cannot detect removal of the newest rows.

**The chain is unkeyed.** It catches an edit by anyone who cannot rewrite the table, but `munshi_owner` (or a superuser)
can rewrite rows and re-hash the chain from that point, and it will verify. The chain head (latest `seq` and `hash` per
tenant) will be published outside the database at deploy, so a rewrite shows as a head that no longer matches.

## Editions

`MUNSHI_EDITION` = `meta` | `paytm` selects the role → provider/model map in `packages/agent` config. Nothing in the
database names a provider; no provider-specific code lives outside its adapter.

## Gates

`pnpm check` = lint + typecheck + tests (G1–G11 on embedded Postgres, a fresh database per test file).
`pnpm redproof` breaks each protection in turn (`db/test/sabotage.ts`) and proves its gate goes red, then green when
clean. G8 proves a failing test run exits non-zero despite embedded-postgres's exit hook.
