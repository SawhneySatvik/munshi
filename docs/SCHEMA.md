# Munshi schema

Commentary on `db/migrations/*.sql`, which is the contract: read the SQL when in doubt. Applied in name order by
`db/src/migrate.ts` (each file in one transaction; an applied file that changes is refused — fix forward with a new file).
`db/migrations/manifest.json` lists every table, view and function (35 tables, of which 2 are global, 5 views, 14 functions);
the gates count against it. Migrations 0001 to 0009 exist; 0008 (the hero chain's evidence) and 0009 (draft checks) are
below. From 28 Oct 2026 migrations are append-only: the runner refuses one edited after it was applied.

## Conventions (every table)

- `tenant_id uuid not null references ops.tenant` is the first column and leads the primary key, every index and every
  foreign key (gate G10). Keys are `(tenant_id, id)`; foreign keys are composite, so a row can never point at another
  tenant's row. Exceptions: `ops.command_authority` and `ops.command_table`, global and read-only.
- RLS enabled **and forced**, one policy `tenant_isolation`:
  `tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid)` for USING and WITH CHECK.
- An explicit `revoke all … from public, munshi_app, munshi_agent` then the exact grants. Functions:
  `revoke execute … from public` per function (gate G9).
- Money: `<name>_minor bigint` + `currency char(3)`. Quantities: `qty_milli bigint` (milli-units of the item's unit).
  Time: `timestamptz`; business dates `date`.
- Indexes are declared one per statement as `create [unique] index <name> on <schema>.<table> (<cols>) [where …];`
  — the form gate G10 parses and checks against `pg_index`.

## Roles

| Role | Login | Holds |
|---|---|---|
| `munshi_owner` | no | owns every schema, table, view, function |
| `munshi_migrator` | yes | member of `munshi_owner` (NOINHERIT), meant for running 0002+ (each file does `set local role munshi_owner`) |
| `munshi_app` | yes | USAGE on ops, books, approval, snap, audit; the grants below; EXECUTE on `audit.entry_hash`, `audit.verify_chain` |
| `munshi_agent` | yes | USAGE on snap, agent_view; SELECT on `snap.*` and `agent_view.*`; nothing else |

No role is a superuser or has BYPASSRLS. `0001` needs a superuser: it creates the roles, and revokes from PUBLIC the
database's TEMP, CREATE on schema `public` and EXECUTE on the `pg_catalog` large-object functions (no munshi role gets
them back), then raises if any is still granted, because a REVOKE by a non-owner only warns. `CREATE DATABASE …
TEMPLATE` does not copy a database's ACL, so the test harness copies the template's onto each clone. The runner's user
must be able to `SET ROLE munshi_owner`; so far every file has been applied only by a superuser (the test harness). The bookkeeping
table `public.munshi_migration` belongs to whoever ran the first migration. Test passwords are set by the harness;
production sets its own.

## Tables

`S` = SELECT, `I` = INSERT, `U(cols)` = column-pinned UPDATE, all for `munshi_app`.

**ops** (operational; the app writes directly)

| Table | Key columns | App grants |
|---|---|---|
| `tenant` | `tenant_id`, name, currency (default INR), time_zone (default Asia/Kolkata), count_max_age (default 6 hours, 0009) | S I |
| `shop` | name, address | S I |
| `member` | name, phone, role (`owner`, `manager`, `staff`), active | S I |
| `command_authority` | (command, role) — global, seeded by `0002` | S |
| `command_table` | (command, rel) — global, seeded by `0002`: the book tables each command writes (rel `books.<table>`) | S |
| `document` | kind (`photo`, `bill`, `other`), storage_key, sha256 (unique per tenant), mime, bytes, uploaded_by | S I |
| `run` | trigger (`question`, `watcher`, `brief`, `photo`; `photo` from 0008), started_by, started_at, ended_at | S I U(ended_at) |
| `run_trace` | run_id, seq (unique per run), kind, label, refs (ids only) | S I |
| `finding` | kind, dedupe_key (unique per tenant), status (`open`, `dismissed`, `resolved`), snapshot_id + snapshot_row (the watcher snapshot's row holding its numbers), run_id | S I U(status, updated_at) |
| `shelf_count` (0008) | run_id, item_id, photo_sha256, phrase, model, raw (the segment model's response as it arrived), raw_sha256, matches. Checks `shelf_count_hashed` (raw_sha256 is the sha256 of raw) and `shelf_count_matches` (matches is the number of box records in raw) | S I |
| `bill_read` (0008) | run_id, supplier_id, photo_sha256, model, bill_no and bill_date as printed (untrusted text), created_txid | S I |
| `bill_line` (0008) | bill_read_id, line_no, item_text as printed, item_id (matched by exact name or alias in core, null if none), qty_milli, unit_cost_minor, qty_box and cost_box (each figure's place on the page, 0 to 1000 grid; check `bill_line_placed` refuses a figure with no place) | S I |

`ops.bill_read_txn` (before insert on `bill_read` and `bill_line`, trigger `txn`) stamps a bill's `created_txid`; a line is
accepted only in the transaction that read its bill, else `MS006`. The agent has no grant on `shelf_count`, `bill_read` or
`bill_line`: their figures reach a screen or a draft only as cells of the named reads `count.shelf` and `bill.lines`.

`ops.member_guard` (before insert, trigger `guard`; ruling (b)) refuses (`MS007`) a member row for another tenant than the
current one; the tenant's first member unless it is an active owner whose id is the acting member (sign-up); after that an
owner or manager unless the acting member is an active owner, and staff unless an active owner or manager. Additions are
serialised per tenant (advisory lock). `ops.member_audit` (after insert, trigger `guard_audit`) appends `member.add` to the
audit chain under the acting member.

**approval**

| Table | Key columns | App grants |
|---|---|---|
| `draft` | command_type, payload, based_on (snapshot refs), payload_refs (path of each payload number to its cell, 0007), run_id / proposed_by, finding_id, status (`proposed`, `executed`, `rejected`, `stale`, `failed`), created_txid | S I U(status, updated_at) |
| `decision` | draft_id (unique: one decision per draft), verdict (`approved`, `rejected`), decided_by, reason, created_txid | S I |

A partial unique index `draft_open_per_finding` (0009; it moved here from 0007, which had been edited after it was applied)
allows one `proposed` draft per finding. Triggers (each refusal `MS002`): `approval.stamp_draft` refuses a new draft that is not `proposed` and stamps
`created_txid`. `approval.stamp_decision` sets `created_txid := txid_current()` and `created_at`, and refuses unless
`decided_by` is the acting member, the draft is `proposed`, and the draft was created in an earlier transaction.
`approval.draft_status` refuses any update of a draft that is no longer `proposed`, and a status its decision does not
allow: `executed` needs an `approved` decision made in this transaction, `rejected` a `rejected` decision, `stale` and
`failed` no decision.

**snap**

| Table | Key columns | App / agent |
|---|---|---|
| `snapshot` | query_name, params, actor_id, run_id, row_count, created_txid | S I / S |
| `snapshot_cell` | (snapshot_id, row_no, col), kind (`integer`, `money`, `quantity`, `text`, `date`, `timestamp`, `null`), num, currency, unit, txt, day, at — exactly the columns of the kind are set | S I / S |

`snap.snapshot_txn` (before insert on both): stamps the snapshot's `created_txid` and `actor_id` (the acting member, NULL
when none — a watcher), so a caller can choose neither; a cell is accepted only in the transaction that created its
snapshot, else `MS006`. Only core's mintSnapshot writes these tables (gate B4).

**audit**

| Table | Key columns | App grants |
|---|---|---|
| `audit_log` | (tenant_id, seq) gapless, actor_id, decision_id, command, action, entity (`schema.table`, lower case), entity_id, payload, created_at, prev_hash, hash | S I |

`audit.chain` (insert trigger) refuses (`MS005`) an entry whose actor_id is not `munshi.actor_id`, and an entry for a
`books.*` entity unless that row exists, created by actor_id under decision_id; the unique index `audit_book_row` keeps one
entry per book row (`23505` for a second). It assigns seq, prev_hash, hash, created_at under a per-tenant advisory lock;
`audit.entry_hash(prev, entry)` is the one canonical hash; `audit.verify_chain(tenant)` returns the first broken seq or
NULL, and raises `MS003` for a tenant other than the current one.

**books** (every table: S I only; the guard trigger; stamped `created_by`, `decision_id`, `created_at`)

| Table | Key columns |
|---|---|
| `item` | name, unit (`piece`, `pack`, `kg`, `g`, `l`, `ml`), barcode, category |
| `item_alias` (0008) | item_id, alias (stored NFKC, trimmed, lower case; unique per tenant): another spelling a supplier's bill prints. Written only by `item.alias` |
| `price` | item_id, amount_minor, currency, effective_from (latest in effect wins) |
| `supplier` | name, phone, is_simulated (default true) |
| `customer` | name, phone, credit_limit_minor + currency |
| `staff` | name, phone, member_id, daily_wage_minor + currency, joined_on |
| `purchase` | supplier_id, bill_no (unique per supplier among non-reversals), bill_date, document_id, total_minor, currency |
| `purchase_line` | purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency, expires_on |
| `sale` | shop_id, sold_at, customer_id, total_minor, currency |
| `sale_line` | sale_id, line_no, item_id, qty_milli, unit_price_minor, currency |
| `stock_move` | item_id, signed qty_milli, kind (`opening`, `purchase`, `sale`, `count_adjust`, `waste`, `return`), source_table + source_id, expires_on, at |
| `payment` | direction (`in`, `out`), method (`cash`, `upi`, `card`, `bank`), amount_minor, currency, customer/supplier/sale/purchase ids, reference, paid_at |
| `credit_entry` | customer_id, signed amount_minor (+ given, − repaid), currency, sale_id, payment_id, due_on, at |
| `journal_entry` | entry_date, memo, source_table + source_id, created_txid |
| `journal_line` | entry_id, account (code), signed amount_minor (debit +, credit −), currency |
| `attendance` | staff_id, day, status (`present`, `absent`, `half_day`, `leave`) |
| `outbound_message` | channel (`whatsapp`, `sms`), recipient_kind, recipient_id, body |
| `settlement` | channel (`upi`, `card`), business_date (the day of takings it settles; one per channel and day among non-reversals), amount_minor > 0, currency, reference, received_on |

Reversible tables (`purchase`, `sale`, `stock_move`, `payment`, `credit_entry`, `journal_entry`, `attendance`, `settlement`) carry
`reverses_id` + `reason` (both or neither; a row is reversed at most once).

`books.guard()` (before insert/update/delete, every books table): UPDATE and DELETE always raise `MS001`; an INSERT is
admitted under an approved decision of this transaction or an authorised direct command (see `docs/ARCHITECTURE.md`),
and only into a table the admitting command writes (`ops.command_table`), otherwise `MS001`; it stamps the row.
`books.audit_row()` (after insert, every books table, trigger `guard_audit`) writes the row's audit entry.
`books.entry_txn()` (before insert, trigger `txn`, after `guard`): stamps the entry's `created_txid`; a line is accepted
only in the transaction that created its entry, else `MS006`. `books.check_balanced()` (deferred constraint trigger on
`journal_entry` and `journal_line`): each entry has a line and sums to zero per currency at commit, else `MS004`.

**agent_view** (owned by `munshi_owner`; base tables force RLS, so each view is tenant-scoped; no numeric columns)

`item` (id, name, unit, category) · `supplier` (id, name, is_simulated) · `customer` (id, name) · `staff` (id, name) ·
`finding` (id, kind, status, snapshot_id, snapshot_row; the row column from 0007). The agent reads these and `snap.*`, nothing else.

## Direct-command authority (seeded)

| Role | Commands |
|---|---|
| owner | item.create, item.alias, price.set, supplier.create, customer.create, staff.create, sale.record, purchase.record, stock.count, stock.waste, reorder.place, credit.record, payment.record, settlement.record, attendance.record, journal.post, message.send |
| manager | the owner's list without price.set, staff.create, journal.post (so it holds item.alias) |
| staff | sale.record, payment.record, stock.waste |

And the book tables each command writes (`ops.command_table`; core's commands in `packages/core/src/commands.ts` write only
these — attendance.record, journal.post and message.send have no core command yet):

| Command | Tables (`books.`) |
|---|---|
| item.alias | item_alias |
| item.create · price.set · supplier.create · customer.create · staff.create | item · price · supplier · customer · staff (one each) |
| sale.record | sale, sale_line, stock_move, payment, credit_entry, journal_entry, journal_line |
| purchase.record | purchase, purchase_line, stock_move, journal_entry, journal_line |
| stock.count, stock.waste | stock_move |
| credit.record | credit_entry, journal_entry, journal_line |
| payment.record | payment, credit_entry, journal_entry, journal_line |
| settlement.record | settlement, journal_entry, journal_line |
| journal.post | journal_entry, journal_line |
| attendance.record | attendance |
| reorder.place, message.send | outbound_message |

## Error codes

`MS001` book write refused · `MS002` decision or draft refused · `MS003` verify_chain for another tenant ·
`MS004` journal entry does not balance · `MS005` audit entry refused · `MS006` a line or cell after its parent's
transaction · `MS007` member refused · `23505` a second audit entry for a book row · `42501` no privilege, or a row outside
the current tenant (RLS). Core maps every one of these (and any other SQLSTATE) to a `CoreError` code before it reaches a
caller; the database's message and DETAIL never leave core.

## Gates (db/test, `pnpm check`; red-proofs in `pnpm redproof`)

Test counts and the date they were measured are in the README.

| Gate | Holds |
|---|---|
| G1 | the manifest equals the catalog (tables, views); the agent holds no write privilege on any of them and every INSERT/UPDATE/DELETE it tries is refused `42501`; it can create no temporary table, no object in any schema, no large object; it can read snapshots and its views |
| G2 | no context → refused on every books table; another tenant's, an earlier transaction's, a rejected, or an unauthorised approver's decision → refused; an approved `price.set` decision cannot write `books.sale`; decider must be the actor; a decision on a draft of its own transaction → refused; a forged created_txid is overwritten; context does not survive the transaction; an approved decision of this transaction → accepted, stamped, audited; a draft's status follows its decision; a new draft is `proposed` |
| G3 | direct command: authorised member accepted; member without the authority, member of another tenant, inactive member refused; staff holding `sale.record` cannot write `books.price`; every held command maps to book tables and every book table to a command; `ops.command_authority` and `ops.command_table` are SELECT-only for the app and invisible to the agent |
| G4 | no superuser/BYPASSRLS role; munshi_owner owns everything; RLS enabled + forced + a policy on every tenant table; tenant A reads none and writes none of B's rows on every tenant table; no context sees nothing; the agent's views are tenant-scoped |
| G5 | no UPDATE/DELETE/TRUNCATE for the app on the books, audit log, snapshots, decisions; each refused `42501` |
| G6 | unbalanced, empty and per-currency-unbalanced entries fail at commit; a balanced two-currency entry commits |
| G7 | verify_chain finds a tampered and a deleted row (made as owner); refuses another tenant; caller-supplied seq/hash are replaced; an entry must name the acting member; an entry for a book row that was not written by that member is refused, a second one (however spelled) too; an insert skipped by `ON CONFLICT DO NOTHING` leaves no entry |
| G8 | a failing test run exits non-zero and a passing one exits 0, despite embedded-postgres's exit hook |
| G9 | functions equal the manifest; none executable by PUBLIC or the agent; the app executes only its two |
| G10 | every declared index exists in `pg_index` with its columns, uniqueness and predicate; tenant_id leads every index and FK |
| G11 | a journal line or a snapshot cell is refused after its parent's transaction; accepted within it; a caller-supplied created_txid on either parent is overwritten |
| G12 | the first member is an owner adding themself; only an active owner adds an owner or manager, an owner or manager adds staff (inactive, other-tenant and absent actors refused); every addition is audited under its adder |

Core's and the AI layer's gates (`db/test/*.test.ts` on embedded Postgres; `packages/core/test`, no database). The agent package's own suite (`packages/agent/test`, recorded model turns, no database) holds the cite-or-abstain validator, the 199-sentence clean and 157-attack corpus, and the adapters:

| Gate | Holds |
|---|---|
| C1 | commands price from the books, refuse over-payment, re-derive a count from the books, balance, audit under the actor; a member without the authority writes nothing |
| C2 | a planted unique violation reaches the caller as `conflict` with no row value in message, stack, JSON or cause |
| C3 | only registered named reads, read-only even when registered; typed cells; the actor stamped by the database; a ref of another tenant is "Cannot verify" |
| C4 | an owner-approved draft executes under the owner and the chain verifies; changed evidence → `stale`, nothing written; rejection, re-decision, an approver without the authority, an unresolvable ref |
| C5 | the watchers find 5 of 5 planted kinds (8 of 8 situations, values from the answer key) and nothing else; re-running raises nothing; no actor, no audited write |
| C6 | the agent's named reads (items, sales by day and item, purchase prices, reorder, credit balances, recent bills) against figures worked out in the test from raw rows or the answer key; windows are bounded |
| C7 | a write-off or a count cannot take on-hand below zero, a count waits for a stock move in flight, and a credit draft cites `credit.balance` and goes stale when it moves |
| MS-10 | `sale.quote` prices each line from `books.price` and equals the sale then recorded, to the paisa; `sale.receipt`, `bill.lines_for`, `sales.week_total` against raw rows |
| H1 | a shelf count (one product per request) is stored with its response hash and box count; a forged count is refused; a gap becomes a `stock.count` draft citing both cells, executed only on approval; stills only; the vision call is quarantined; a count older than `count_max_age` backs no draft; only `shelf.ts` stores a count (source scan) |
| H2 | a bill photo becomes a `purchase.record` draft whose every number is a bill cell placed on the page; unmatched lines never become book lines; a figure with no place is refused; one bill read backs one executed purchase |
| H3 | a spoken question is transcribed and answered from cells; the transcript never appears in a trace; audio the voice model cannot take is not sent |
| A1 | the agent layer over the real database: numbers from this run's cells, a free digit abstains, a forged, cross-tenant or other-run ref is refused, drafts wait for a person, traces hold ids and fixed labels only, one open draft per finding |
| B0–B4 | the import scanner sees every import form; packages/agent's boundary; `@munshi/core/read`'s import closure; the actor setting named only in withTx; snap.* written only in mintIn |
| money, time | half-away-from-zero line rounding, Indian grouping; Asia/Kolkata business dates; both Melbourne DST changes |

## Adding a table

Add it to `manifest.json`; `tenant_id` first and leading every key; enable + force RLS with the policy; revoke-then-grant;
in `books`: the stamp columns (`created_by`, `decision_id`, `created_at`), the `guard` and `guard_audit` triggers, S I
grants only, and the commands that write it in `ops.command_table`; indexes in the declared form. Then `pnpm check` and `pnpm redproof`.
