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
        ├── packages/core   framework-free domain: money, time (Asia/Kolkata, one module), session (withTx),
        │                   commands, members, approvals, snapshots (named reads), watchers, errors. Holds the APP
        │                   pool (role munshi_app, createAppPool).
        │
        └── packages/agent  model adapters by role (router, reason, vision, segment, voice, narrate), tools,
                            cite-or-abstain. Holds only the AGENT pool (role munshi_agent, read-only); imports
                            only '@munshi/core/read' (refs, cells, resolveRef, rendering).
        ▼
Postgres   schemas ops, books, approval, snap, audit, agent_view (db/migrations). Embedded Postgres in every test.
```

The diagram is in [architecture-diagram.md](architecture-diagram.md).

**The web app** (`apps/web`) has screens for the owner's home, the counter (`/counter`), Ask (`/ask`), stock (`/stock`,
with the shelf photo), credit (`/credit`), bills (`/bills`, with the bill photo) with their detail and new-bill pages,
suppliers (`/suppliers`), the day report (`/reports`) and a demo sign-in (`/sign-in`). The demo sign-in lists the demo
shop's members; the server signs their ids into an HMAC cookie (`munshi_session`, secret under `.run/`), and
`sessionFrom()` (`apps/web/lib/server/session.ts`) is the one place the app turns a cookie into a core `Session` (it checks
the signature timing-safely, the expiry, and that the member is active). Server actions and routes call `packages/core`;
approving a draft calls `decide()` with that session. Screens show "Simulated supplier" and "Synthetic data" stickers,
and "Recorded response" when model answers are replayed.

One server process. There is no separate API service and no run token: the agent runs inside the same server, so the
tenant and the member come from the authenticated session, never from a model argument. A tool closes over the request's
context; no tool schema has a tenant field.

## The trust boundary

| | `munshi_app` (packages/core) | `munshi_agent` (packages/agent) |
|---|---|---|
| Reads | every table, under RLS | `snap.*` and the `agent_view.*` views (names and ids, no numbers), under RLS |
| Writes | ops/approval/snap/audit rows; books **only through the book guard** | **nothing** — no INSERT/UPDATE/DELETE/TRUNCATE on any table, no TEMP, no CREATE on any schema, no large-object functions (gate G1); two caveats below |
| Proposes a change | — | by calling core's `proposeDraft`, which writes an `approval.draft` row on the app pool |

The agent never holds the app pool. Its only path to a book row is a draft that a person approves. It mints snapshots
and proposes drafts through functions the app hands it, already bound to the request (a run of a `system` scope: a tenant
and no actor); it imports nothing of core but `@munshi/core/read`, never `DATABASE_URL` (gate B1), and that entry point
reaches no writer (gate B2). B1 follows every import of every agent file (its sources, tests, fixtures and any built
output; `.ts`, `.mts`, `.cjs`, …) to the file it names, and fails on any file reached outside `packages/agent` but the
read side (`read.ts`, `money.ts`, `errors.ts`: a directory import of core or a path into `apps/` fails), on a relative
import that resolves to nothing, on a computed `import()`/`require()` (a template literal, a variable, a concatenation),
on `createRequire` or `node:module`, and on a URL specifier.

The app builds the agent's port (`apps/web/lib/server/agent-port.ts`) for each run: a question or a photo starts an
`ops.run` for the signed-in member's shop and the port is bound to that one tenant and run. Its `resolve` and `finding`
run on a pool connected as `munshi_agent`, which refuses to serve as any other role; `read`, `propose`, `recordCount` and
`recordBill` call core. Its `trace` stores kind, a fixed label, ids and timings: a label outside the agent's fixed lists
is stored as `unlisted` and a non-uuid id is dropped.

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
`munshi.decision_id` (an approved decision being executed). Core runs every transaction through `withTx(pool, scope,
fn)`, the one place tenant, actor and command are set: a `member` scope carries the signed-in `Session`; a `system` scope
(a watcher, an agent run) carries a tenant and **no actor**. A `Session` is branded: only core makes one —
`openSession(pool, tenantId, memberId)` (the ids from the app's authenticated sign-in, if that member is active in that
tenant; else null) and `signUpSession()` (fresh random ids for a new owner) — so a hand-built `{tenantId, memberId}` does
not typecheck (`packages/core/test/types.ts`). No other shipped source names the actor setting (gate B3). Policies and the guard read
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

**Members** (ruling (b), `ops.member_guard`): a tenant's first member is its owner adding themself (sign-up:
`createTenant` runs in the new owner's own session); after that only an active owner adds an owner or a manager, and an
active owner or manager adds staff; each addition is audited under the adding member (gate G12). No role is ever raised:
members have no UPDATE grant.

## Drafts and decisions (nothing auto-applies)

1. **Propose.** `proposeDraft(pool, by, {command, payload, basedOn, payloadRefs})`, by a member (`proposed_by`) or a run
   (`run_id`). The command must be one core implements and the payload must parse against its input schema (stored
   normalised). `basedOn` is never empty, and every ref in it must resolve to a stored cell of this tenant.
   `payloadRefs` maps the path of **every** number in the payload (`qtyMilli`, `lines[0].qtyMilli`; keys joined by `.`,
   array items as `[n]`) to a cell holding exactly that number in the kind its name says (`…Minor` money, `…Milli` a
   quantity, otherwise an integer); a missing path, a path that is not a number, or a cell that does not hold it is
   refused. It is stored on the draft (`payload_refs`), so a screen renders each draft number beside its own source.
   A command that **moves stock or money** (in `ops.command_table` it writes `books.stock_move` or `books.journal_line`)
   must also cite, for every item the payload names, the `on_hand` cell of a `stock.on_hand` snapshot of exactly that
   item — an undated read of the current state. The `watch.*` reads stop at their `as_of`, so a write-off recorded after
   it would never stale a draft cited from them alone (the MS-5 review: on-hand 32 → 12 → −8). No undated per-customer
   read exists yet, so such a draft naming a customer is refused, and so is one naming no item or customer (a
   settlement, a supplier payment). Status `proposed`.
2. **Decide**, `decide(pool, session, draftId, verdict, reason?)` — the approver is the session's member; there is no
   other parameter for it. One transaction: lock the draft (`FOR UPDATE`, must be `proposed`); for an approval, re-run
   the named read behind each cited snapshot (`based_on` and `payload_refs`) with its stored params and match the row by
   the read's key — if a row is gone or a cell's value differs, mark the draft `stale`, audit `draft.stale`, and commit
   only that; otherwise insert
   the decision (one per draft, ever; `decided_by` must be the acting member; the draft must come from an earlier
   transaction), set `munshi.decision_id`, execute the command as the approver (the guard admits and audits each row,
   and refuses an approver whose role lacks the command), mark the draft `executed`, audit `draft.executed`, commit. A
   rejection inserts a `rejected` decision and marks and audits the draft; nothing executes (gate C4). Rejecting a draft
   and marking it stale take the authority approving it takes — an active member whose role holds the draft's command
   (`approval.stamp_decision`, `approval.draft_status`) — so staff cannot turn down a reorder they could not place.
   A command returns only the ids of the rows it wrote (`CommandResult`, checked again at run time): a number to show
   is minted as a snapshot cell from the books, never taken from a result.

A decision admits writes only in the transaction that made it, so it cannot be replayed later or by another tenant. A
draft's status follows its decision: `executed` only under an approved decision of this transaction, `rejected` only
under a rejected one, `stale`/`failed` only while undecided; a new draft is always `proposed` (gate G2).

## Numbers: snapshot cells

Every number on screen renders from a stored snapshot cell. `mintSnapshot(pool, scope, name, params)` (core) looks the
name up in the registry of named reads (`packages/core/src/queries.ts`; nothing registers one at runtime), validates the
params, runs the read under the tenant's RLS inside a savepoint set `READ ONLY` (so even a registered read cannot write),
and stores at most 500 rows in `snap.snapshot` + `snap.snapshot_cell` (one typed value per declared row × column:
integer, money in minor units + currency, quantity in milli-units + unit, text, date, timestamp). The database stamps the
snapshot's tenant, `created_txid` and actor (the acting member, none for a system scope). mintSnapshot is the only code
that writes `snap.*` (gate B4); an unknown name is refused (gate C3). A reference
`⟨snap:ID·row·col⟩` resolves to one cell. Model prose carries refs, never free digits; a reply with a number that is not
a ref renders as "Cannot verify". The agent reads snapshots; it never writes them. A cell is accepted only in the
transaction that created its snapshot, so a stored snapshot cannot gain cells later (gate G11).

**Errors.** Every error leaving core is a `CoreError`: a code (`refused`, `conflict`, `invalid`, `not_found`,
`not_proposed`, `unbalanced`, `unknown_query`, `internal`), a fixed message, and at most the SQLSTATE, a constraint name
and the failing input paths — never the database's message, DETAIL or `cause`, which carry row values (gate C2).

## Watchers

`runWatchers(pool, tenantId, asOf?)` runs in a `system` scope (no actor) and writes no book row: one `ops.run`, then per
detector a snapshot of its `watch.*` named read (deterministic SQL, thresholds in the read: shrinkage, price creep, expiry
within 7 days, overdue credit, short UPI settlement) and one `ops.finding` per returned row, pointing at that row
(`snapshot_id`, `snapshot_row`). The dedupe key is the kind plus the read's key columns (`on conflict do nothing`), so a
situation is raised once however often the watchers run (gate C5).

**The demo shop.** `db/seed/kirana.ts` builds "Sharma General Store (synthetic)" through core's real paths, with five
planted situations and near-miss controls; `db/seed/kirana.answers.json` is the answer key, worked out by hand.
`pnpm reseed` (a superuser `DATABASE_URL` to a dev database; it refuses to wipe a non-synthetic tenant) migrates,
truncates, seeds as `munshi_app` and runs the watchers in about 11 s.

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

## Photo evidence (MS-8)

A shelf count (`ops.shelf_count`) and a read bill (`ops.bill_read`, `ops.bill_line`) are ops rows only core writes; they
reach a screen or a draft only as cells of `count.shelf` and `bill.lines`. Core holds the drafts made from them to their
evidence (`approvals.ts`): a `stock.count` cites the count's `counted` cell and the item's current `on_hand`, and a count
older than the shop's `ops.tenant.count_max_age` (6 hours by default) backs no draft, at proposal or at approval; a
`purchase.record` is one bill as read — its supplier, number and date are that bill's cells, a line's quantity and cost
come from one bill line of one bill read, and no bill line backs two payload lines. One bill read backs one executed `purchase.record`: a second draft of the same bill
goes stale at approval and a third is refused at proposal (MS-12, gate H2).

**Known limit: the shelf-count hash binds the stored response to itself, not to Meta's.** `shelf_count_hashed` proves
the stored `raw` is the text that was hashed, and `shelf_count_matches` that the count is that text's number of boxes;
neither proves the text is what the segment model returned, since whoever calls `recordShelfCount` supplies both. What
holds it is the caller: the segment adapter (`meta-sam.ts`) hashes the response where it arrives, the port's
`recordCount` is called only in `shelf.ts` with that response, and core's `recordShelfCount` is reached only through a
port binding that passes the count through (gate H1, a source scan; an alias through a variable is not seen). A response
signed by the provider would close it.

## The AI layer (`packages/agent`)

**Roles and editions.** `config.ts` maps six roles to a provider and model per edition (`MUNSHI_EDITION` = `meta` |
`paytm`, default `meta`). In `meta`: router, reason and vision are Muse Spark (`muse-spark-1.3`), segment is SAM 3.1
(`sam-3.1`), voice is Muse Voice Transcribe (`muse-voice-transcribe-1.0`), narrate is Muse Spark Open on Baseten
(`meta-models/muse-spark-open-1026`). The `paytm` map is a placeholder (`TODO-…` ids, no Sarvam adapter); only the switch is
tested. Nothing in the database names a provider; no provider-specific code lives outside its adapter. Keys come from the
environment names in `.env.example` and are redacted from errors (`providers/redact.ts`). Model ids have not been checked
against a live call (TO-MEASURE).

**Model modes.** `MUNSHI_MODEL_MODE` = `recorded` (default) | `live` | `record`. In `recorded` a request is looked up by the
sha256 of its canonical form under the flow's fixture directory; a missing or malformed fixture is a `ModelError`, which the
flows turn into an abstention or a refusal, never an error screen. The committed fixtures are hand-written turns replayed
through the real adapter path (`packages/agent/test/script.ts`), not recordings of Meta's models.

**A question** (`run.ts` `ask`). The router (schema-constrained JSON) picks one desk: stock, sales, credit or none. The desk
runs a tool loop with the `reason` role over named reads only (one tool per read in `queries-agent.ts`; at most 8 calls; a
45 s budget, two thirds for routing and reading, and every model call carries the time left as an abort signal). The model
never sees a uuid: an id is shown as a handle (`item:3`) numbered in order of appearance, and a tool takes back only a
handle this run showed. Reads and notes reach a model only inside `<data>` blocks with control, format and bracket
characters escaped. The `narrate` role then writes at most six short segments, each with refs (read, row, column) that the
run turns into snapshot refs. A ref the run cannot place points nowhere and is reported.

**The validator** (`answer.ts`, word lists in `words.ts`). Rules: `free_digit`, `number_word`, `other_script`,
`handle_glue`, `scale_word`, `unit_or_currency`, `unknown_handle`, `id_ref`, `not_this_run`, `unresolved`, `not_a_name`.
Text is checked in one folded form (NFKC, format characters removed) and rendered in that same form. Cited cells are
re-resolved under the tenant's RLS. Any failure fails the whole answer, which is shown as "Cannot verify" plus the names of
the rules, never model text. Ambiguous homographs (do, teen, tin, char, sat, bees, tees, couple, score, trio, lone letters,
एक, दो) count as numbers only in a quantity context (MS-12); the precision corpus in `packages/agent/test/corpus/` holds
199 clean sentences (none may abstain) and 157 attacks (all must be refused). Residuals are in `LIMITATIONS.md`.

**A finding** (`explainFinding`, `draftFix`). A watcher's finding is admitted as read 0 (its own row) and explained from the
desk's reads. `draftFix` has a fixed recipe and no model: a shelf short of the books (`shrinkage`) becomes a `reorder.place`
draft for the item's usual quantity (its latest bill line) from that bill's supplier, with every payload number mapped to a
cell and the current `stock.on_hand` cited. A finding that is closed, no longer seen by the latest watcher run, or already
has a draft awaiting a decision gets none. No other kind has a recipe.

**Photos and voice** (`shelf.ts`, `bill.ts`, `voice.ts`, `photo.ts`). Only PNG and JPEG stills are sent (checked by the
first bytes). The vision call is offered no tools and an answer that attempts one is discarded whole. Shelf: vision names the
distinct products against the catalogue (shown as quoted handles), SAM 3.1 returns boxes for one noun phrase per request
(no lists), the count is the number of matches, core stores the raw response with its hash, and plain code compares the
`count.shelf` cell with the `stock.on_hand` cell. Loose goods are not counted. Bill: vision copies the number, date and
each line's text, quantity and rate with their places on a 0 to 1000 grid; code converts printed figures to milli-units and
paise (`printed()`), core matches line text to items by exact name or alias, and the draft is a `purchase.record` whose
numbers are bill cells (at most 24 matched items). Voice: the WAV (mono 16-bit PCM at 16 or 24 kHz) is transcribed and the
transcript is asked like a typed question. The transcript, a phrase or any bill text never goes into a trace.

**Traces.** Kinds: route, model, read, budget, validate, answer, abstain, propose, evidence. Labels come from the fixed lists
`TRACE_LABELS` and `FLOW_LABELS`, and a test holds every event to them.

## Editions

`MUNSHI_EDITION` = `meta` | `paytm` also selects the web app's token overrides (`apps/web/lib/edition.ts`). The paytm
edition shows placeholder surfaces with no Paytm branding.

## Gates

`pnpm check` = lint + typecheck + tests: G1–G12 and core's C1–C7, MS-10, the hero gates H1–H3 and the agent-layer gate A1 on
embedded Postgres (`db/test`, a fresh database per test file); money, time and the source-scanning gates B0–B4 in
`packages/core/test`; the validator, corpus and adapters in `packages/agent/test`; the screens in `apps/web/test`. Counts
and the date they were measured are in the README (27 Oct 2026: agent 78, core 11, db 144 tests; the web suite was not
counted). `pnpm redproof` breaks each
protection in turn (`db/test/sabotage.ts`: SQL in the test database, a source mutation applied as vitest loads the module,
or a harness-level switch) and proves its gate goes red, then green when clean. Every sabotage reports whether it
applied; one that failed to apply or never applied is an **ERROR** (exit 1), never a red, and each full run first proves
that on planted unappliable cases. Sabotage runs turn off vitest's transform cache (`fsModuleCache`), which would
otherwise serve the unmutated module. G8 proves a failing test run exits non-zero despite embedded-postgres's exit hook.
Two gates live in the type checker, outside redproof: `packages/core/test/types.ts` holds a hand-built `Session` and a
command result with a number, each under `@ts-expect-error`, so `tsc` fails if either ever compiles.

What each gate holds: `docs/SCHEMA.md` § Gates.
