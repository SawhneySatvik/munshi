# Munshi schema

Commentary on `db/migrations/*.sql`, which is the contract: read the SQL when in doubt. Applied in name order by
`db/src/migrate.ts` (each file in one transaction; an applied file that changes is refused — fix forward with a new file).
`db/migrations/manifest.json` lists every table, view and function; the gates count against it.

## Conventions (every table)

- `tenant_id uuid not null references ops.tenant` is the first column and leads the primary key, every index and every
  foreign key (gate G10). Keys are `(tenant_id, id)`; foreign keys are composite, so a row can never point at another
  tenant's row. Exception: `ops.command_authority`, global and read-only.
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

No role is a superuser or has BYPASSRLS. `0001` needs an admin that can create roles, and the runner's user must be able
to `SET ROLE munshi_owner`; so far every file has been applied only by a superuser (the test harness). The bookkeeping
table `public.munshi_migration` belongs to whoever ran the first migration. Test passwords are set by the harness;
production sets its own.

## Tables

`S` = SELECT, `I` = INSERT, `U(cols)` = column-pinned UPDATE, all for `munshi_app`.

**ops** (operational; the app writes directly)

| Table | Key columns | App grants |
|---|---|---|
| `tenant` | `tenant_id`, name, currency (default INR), time_zone (default Asia/Kolkata) | S I |
| `shop` | name, address | S I |
| `member` | name, phone, role (`owner`, `manager`, `staff`), active | S I |
| `command_authority` | (command, role) — global, seeded by `0002` | S |
| `document` | kind (`photo`, `bill`, `other`), storage_key, sha256 (unique per tenant), mime, bytes, uploaded_by | S I |
| `run` | trigger (`question`, `watcher`, `brief`), started_by, started_at, ended_at | S I U(ended_at) |
| `run_trace` | run_id, seq (unique per run), kind, label, refs (ids only) | S I |
| `finding` | kind, dedupe_key (unique per tenant), status (`open`, `dismissed`, `resolved`), snapshot_id, run_id | S I U(status, updated_at) |

**approval**

| Table | Key columns | App grants |
|---|---|---|
| `draft` | command_type, payload, based_on (snapshot refs), run_id / proposed_by, finding_id, status (`proposed`, `executed`, `rejected`, `stale`, `failed`) | S I U(status, updated_at) |
| `decision` | draft_id (unique: one decision per draft), verdict (`approved`, `rejected`), decided_by, reason, created_txid | S I |

Triggers: `approval.stamp_decision` sets `created_txid := txid_current()` and `created_at`, and refuses (`MS002`) unless
`decided_by` is the acting member and the draft is `proposed`. `approval.draft_status` refuses any update of a draft that
is no longer `proposed`.

**snap**

| Table | Key columns | App / agent |
|---|---|---|
| `snapshot` | query_name, params, actor_id, run_id, row_count | S I / S |
| `snapshot_cell` | (snapshot_id, row_no, col), kind (`integer`, `money`, `quantity`, `text`, `date`, `timestamp`, `null`), num, currency, unit, txt, day, at — exactly the columns of the kind are set | S I / S |

**audit**

| Table | Key columns | App grants |
|---|---|---|
| `audit_log` | (tenant_id, seq) gapless, actor_id, decision_id, command, action, entity, entity_id, payload, created_at, prev_hash, hash | S I |

`audit.chain` (insert trigger) assigns seq, prev_hash, hash, created_at under a per-tenant advisory lock;
`audit.entry_hash(prev, entry)` is the one canonical hash; `audit.verify_chain(tenant)` returns the first broken seq or
NULL, and raises `MS003` for a tenant other than the current one.

**books** (every table: S I only; the guard trigger; stamped `created_by`, `decision_id`, `created_at`)

| Table | Key columns |
|---|---|
| `item` | name, unit (`piece`, `pack`, `kg`, `g`, `l`, `ml`), barcode, category |
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
| `journal_entry` | entry_date, memo, source_table + source_id |
| `journal_line` | entry_id, account (code), signed amount_minor (debit +, credit −), currency |
| `attendance` | staff_id, day, status (`present`, `absent`, `half_day`, `leave`) |
| `outbound_message` | channel (`whatsapp`, `sms`), recipient_kind, recipient_id, body |

Reversible tables (`purchase`, `sale`, `stock_move`, `payment`, `credit_entry`, `journal_entry`, `attendance`) carry
`reverses_id` + `reason` (both or neither; a row is reversed at most once).

`books.guard()` (before insert/update/delete, every books table): UPDATE and DELETE always raise `MS001`; an INSERT is
admitted under an approved decision of this transaction or an authorised direct command (see `docs/ARCHITECTURE.md`),
otherwise `MS001`; it stamps the row and writes its audit entry. `books.check_balanced()` (deferred constraint trigger on
`journal_entry` and `journal_line`): each entry has a line and sums to zero per currency at commit, else `MS004`.

**agent_view** (owned by `munshi_owner`; base tables force RLS, so each view is tenant-scoped; no numeric columns)

`item` (id, name, unit, category) · `supplier` (id, name, is_simulated) · `customer` (id, name) · `staff` (id, name) ·
`finding` (id, kind, status, snapshot_id).

## Direct-command authority (seeded)

| Role | Commands |
|---|---|
| owner | item.create, price.set, supplier.create, customer.create, staff.create, sale.record, purchase.record, stock.count, stock.waste, reorder.place, credit.record, payment.record, attendance.record, journal.post, message.send |
| manager | the owner's list without price.set, staff.create, journal.post |
| staff | sale.record, payment.record, stock.waste |

## Error codes

`MS001` book write refused · `MS002` decision or draft refused · `MS003` verify_chain for another tenant ·
`MS004` journal entry does not balance · `42501` no privilege, or a row outside the current tenant (RLS).

## Gates (db/test, `pnpm check`; red-proofs in `pnpm redproof`)

| Gate | Holds |
|---|---|
| G1 | the manifest equals the catalog (tables, views); the agent holds no write privilege on any of them and every INSERT/UPDATE/DELETE it tries is refused `42501`; it can read snapshots and its views |
| G2 | no context → refused on every books table; another tenant's, an earlier transaction's, a rejected, or an unauthorised approver's decision → refused; decider must be the actor; a forged created_txid is overwritten; context does not survive the transaction; an approved decision of this transaction → accepted, stamped, audited |
| G3 | direct command: authorised member accepted; member without the authority, member of another tenant, inactive member refused; `ops.command_authority` is SELECT-only for the app and invisible to the agent |
| G4 | no superuser/BYPASSRLS role; munshi_owner owns everything; RLS enabled + forced + a policy on every tenant table; tenant A reads none and writes none of B's rows on every tenant table; no context sees nothing; the agent's views are tenant-scoped |
| G5 | no UPDATE/DELETE/TRUNCATE for the app on the books, audit log, snapshots, decisions; each refused `42501` |
| G6 | unbalanced, empty and per-currency-unbalanced entries fail at commit; a balanced two-currency entry commits |
| G7 | verify_chain finds a tampered and a deleted row (made as owner); refuses another tenant; caller-supplied seq/hash are replaced |
| G8 | a failing test run exits non-zero and a passing one exits 0, despite embedded-postgres's exit hook |
| G9 | functions equal the manifest; none executable by PUBLIC or the agent; the app executes only its two |
| G10 | every declared index exists in `pg_index` with its columns, uniqueness and predicate; tenant_id leads every index and FK |

## Adding a table

Add it to `manifest.json`; `tenant_id` first and leading every key; enable + force RLS with the policy; revoke-then-grant;
in `books`: the stamp columns (`created_by`, `decision_id`, `created_at`), the `guard` trigger and S I grants only; indexes
in the declared form. Then `pnpm check` and `pnpm redproof`.
