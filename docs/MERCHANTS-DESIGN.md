# Merchants design: the schema from 0010, the developer kit, real sign-in (MS-17)

Status: **PROPOSED, design only (28 Oct 2026).** Nothing here is built. The orchestrator and the founder review it before
any migration. Once built, the code wins over this page (`db/migrations/*.sql` is the contract). Tags: FACT (read in this
repo or in research lanes A–E, `../hackathon/meta-ai-developer-hackathon/research-2026-10-28/`), INFERENCE, UNVERIFIED.

§1, §5 and the sign-in and fence parts of §6 were drafted "pending the Munim tenancy report", then revised against it
(`research-2026-10-28/F-munim-tenancy.md`, lane F). Munim is a design reference only. Nothing here copies its text or code.

## Where each ticket item is

| MS-17 item | Section |
|---|---|
| 1 Business type, multi-tenant seed, tenant picker, reseed | §1 |
| 2 Schema from 0010, one migration per concern | §2 |
| 3 Commands, draft types, the named reads that mint their numbers, `grid.apply` | §3 |
| 4 Campaigns, WhatsApp, the webhook, voice note → draft, Instagram | §4 |
| 5 The developer kit | §5 |
| Scope change (28 Oct): real sign-in; real personal data; real data out of the submission; abuse protection | §6, §7, §8, §9 |
| 6 Environment names | §10 |
| 7 Ticket split for W5-B and W5-C | §11 |
| Open questions for the founder | §12 |

## Decisions to check first

1. **Two deploys on two databases** (§8). The demo deploy holds synthetic and showcase tenants. The live deploy holds the
   merchants' real tenants. A one-row `ops.deployment` table makes each database refuse a tenant of the other kind. The
   film, screenshots and judges only ever see the demo database. *One deploy with fencing* was rejected: one bug or one
   wrong env var would put real customers on a public demo with a passwordless sign-in.
2. **`ops.tenant.data_class` = `synthetic | showcase | live`** (§1). It is immutable and set only by the operator
   provisioning command. It drives the on-screen label, the demo sign-in, the demo deny-list and the reseed refusal. It
   replaces today's `name.endsWith('(synthetic)')` check, which a showcase tenant's real name would fail.
3. **A global `ops.tenant_directory` (slug → tenant)** and a global `ops.member_login` (Google subject → memberships)
   (§1, §6). Forced RLS hides every other tenant, so these two global, read-mostly tables are how a sign-in, a site key
   and the webhook find their tenant before any tenant context exists.
4. **Real people's names and phones never enter the books** (§7). They live in an erasable `ops.contact` vault.
   `books.customer` points at it by id, and a trigger enforces this for live tenants. Reason: `books.audit_row` hashes
   `to_jsonb(new)` into the chain (FACT, 0005), so a phone written to a book row could never be erased.
5. **No personal data in any snapshot cell** (§7). The agent role can SELECT every cell of its tenant (FACT, 0003). So
   named reads carry customer ids only, and screens fetch names through a plain core read.
6. **Real sign-in = Google (OIDC code flow + PKCE) bound by single-use, email-matched invites** (§6). After sign-in a
   memberships lookup returns id, name and role only, and a tenant picker follows. The session cookie records how it was
   minted, and a demo-minted cookie is refused for a live tenant on every request, not only at sign-in.
7. **Publishable site key `mpk_<slug>_<secret>`** (§5). The slug finds the tenant, and only a sha256 of the key is
   stored. Hashes are compared timing-safe under that tenant's RLS. A bad, revoked or wrong-origin key returns 404.
   Origins and rate limits are enforced (Munim stored origins and never enforced them, F).
8. **Public reads serve a release** (§5). A person taps *Publish*, which mints snapshots, and the API serves those cells.
   So every figure is a cell of a books read, and anonymous traffic writes nothing but request rows and rate counters.
9. **Merchant sites: one `apps/sites` app built once per business** (`MUNSHI_SITE=<slug>`, one deploy project per
   business and environment), importing only `@munshi/sdk`. A red-proved bundle-isolation gate runs before the second
   business is built (F: Munim's first build bundled every business). *One slug-routed app* was rejected because it puts
   every merchant's brand, and the synthetic kirana, in one bundle.
10. **Balances computed by the database** (§2): package and loyalty `balance_after` is set by a trigger under a
    per-holding or per-customer lock and is never negative. The caller cannot choose it.
11. **Offers are judged inside `sale.record`** from the books at the time of sale. Discounts are `books.sale_discount`
    rows and a `sales_discount` journal debit. GST stays unmodelled, as today (§12).
12. **Campaign copy holds no free digits** (§3, §4). Its figures are refs to the offer and audience cells, rendered at
    execution. Code, never the model, appends a fixed AI-disclosure line. Sends go only to consenting recipients with an
    open 24-hour window. On the test number no template path exists until a verified number does.
13. **The webhook only stores** (§4). It checks the signature, writes an ops inbox row, makes no model call and writes no
    book row. A person taps *Transcribe* to start Voice Transcribe → Spark.
14. **No blob vendor** (§2, 0016). Voice notes and campaign cards are small and live in Postgres (`bytea`, capped,
    purged). Instagram fetches a card from a public app route.
15. **Ops-only actions** (erase, publish, keys, invites, deactivation, booking decline) stay out of
    `ops.command_authority`. Gate G3 requires every held command to write a book table. Their role checks live in core,
    plus a DB trigger where the action is irreversible.
16. **A small pre-step, MS-22a** (§11), makes the command and named-read registries composable, one file per lane, so
    the W5-B lanes never share a file.
17. **Capacity does not fit** (§11). W5-B and W5-C come to about 26 lane-days before review overhead (~34 with it), against the ~14
    the synthesis called safe. The cut order is in §11.

## 1 · Business type and tenancy (revised with the Munim tenancy report)

### 1.1 What a business is

- **Tenant** is the only isolation unit. That holds today: `tenant_id` leads every key and RLS is forced (FACT, 0002).
  New live tenants get a **UUIDv7** id, which is time-ordered (Munim's choice, F). Core generates it, rather than
  assuming Postgres 18's `uuidv7()` on Neon (`deploy/neon.md` asks only for 17 or newer). Seeded tenants get a **deterministic
  id derived from their slug**, so a reseed keeps the id and the recorded fixtures stay valid. Existing v4 ids remain
  valid, since a `uuid` column takes any version.
- **Slug** is a unique human name (`sharma-kirana`, `suit-shop`, `salon`) held in the global `ops.tenant_directory`
  (0010). It is immutable. Munim had none, and it hurt (F).
- **Shop** is the outlet. It already exists as `ops.shop`, and a one-shop business has one row. A site, a booking
  request and a sale each name their shop.
- **Site** is the tenant's own-website channel, `ops.site` (0017), bound to the tenant by a hashed publishable key (§5).

### 1.2 Three columns on `ops.tenant` (0010), all immutable

The app already holds no UPDATE on `ops.tenant` (FACT, 0002 and the 0009 comment). Each column is written once, by
provisioning.

- `business_type`: `kirana | apparel | salon`, default `kirana`. It is per tenant, unlike `MUNSHI_EDITION`, which is per
  process.
- `data_class`: `synthetic | showcase | live`, default `synthetic`, so the existing kirana rows stay correct.

| data_class | What it holds | Label (from the row, never hard-coded) | Demo sign-in | Reseed / reset | Database | Personal data |
|---|---|---|---|---|---|---|
| synthetic | everything invented (the kirana) | "Synthetic data" | yes | yes | demo only | invented people may sit in books, as today |
| showcase | the merchant's real shop and catalogue under signed permission; invented customers and history | "Real shop and catalogue · synthetic customers" | yes | yes (rebuilt from committed seed files) | demo only | invented customers in books; a real person (a test phone on WhatsApp) only through `ops.contact` |
| live | the merchant's real customers | none | **never** | **never** (hard refusal) | live only | `ops.contact` only, enforced by a trigger (`books.customer_pii`, 0012) |

Three values rather than Munim's single `is_demo` flag, because the two demo labels differ (D-037) and a showcase tenant
must stay reseedable while it carries a real brand. Munim's shop label was hard-coded (F); here every label reads the row.

### 1.3 The business registry: code entries, not branches

`packages/core/src/business.ts` exports `BUSINESS_TYPES` and core's entry per type. It is re-exported through
`@munshi/core/read`, the only entry point gate B1 lets the agent import. Each package keeps its own part, keyed by type:

| Part | File | kirana | apparel (suit shop) | salon |
|---|---|---|---|---|
| Item kinds | core `business.ts` | good | good + variants (attrs `size`, `colour`) | good, service, package |
| Watchers | core `business.ts` (`watchers.ts` reads it) | today's five | shrinkage, price_creep, overdue_credit, short_settlement | overdue_credit, short_settlement, package_expiry |
| Agent desks | agent `desks.ts` | stock, sales, credit | stock, sales, credit | sales, credit, packages |
| Nav sections | web `lib/business.ts` (replaces the role-only `SECTIONS`) | today's | today's + offers, campaigns, requests | home, counter, credit, packages, requests, offers, campaigns |
| Copy overrides | web i18n, one override file per type | none | "Item" → "Style" where a variant parent is shown | "Item" → "Service" on service screens |
| Seed | `db/seed/<slug>.ts` | `kirana.ts` (unchanged) | `suit-shop.ts` | `salon.ts` |

Rules:
- The kirana entry equals today's behaviour exactly, so no kirana test, fixture or corpus line changes.
- A totality test fails if any registry lacks a type.
- A source scan fails on a type literal (`'kirana'`, `'apparel'`, `'salon'`) outside the registry files and seeds.

*Branches* (`if (type === 'salon')`) were rejected: a fourth business would then touch every file ("per-business edits to
shared files were an ongoing cost", F).

Campaigns, offers, the inbox, sites and booking requests are **general features**, on for every type. Packages are on
for the salon, and variants for apparel.

### 1.4 Provisioning: one operator-only command

`db/src/provision.ts` is a CLI with no HTTP route, so nobody but the operator can reach it. Munim's operator route
answers 404 to non-operators (F). Two merchants need no operator UI.

```
node --env-file=.env.production db/src/provision.ts --slug suit-shop --name "…" --type apparel --class live \
  --owner-name "…" --owner-email "…@gmail.com"
```

- **Logins.** It uses `MIGRATOR_DATABASE_URL` (as `munshi_owner`) for the directory and deployment rows. It uses
  `DATABASE_URL` for everything else, through core's real paths as `munshi_app`.
- **Idempotent.** An existing slug with the same type and class prints `exists` and changes nothing. A mismatch refuses.
- **Ids.** `live` gets UUIDv7; `synthetic` and `showcase` get the deterministic id.
- **Country.** `IN` only (currency INR, time zone Asia/Kolkata, today's defaults); anything else refuses.
- **What it writes.** The tenant, its directory row, one shop, and the owner member (core's sign-up path: the first
  member is an active owner adding themself, `ops.member_guard`). Then, for `live`, one owner invite, printed once (§6).
  For `synthetic` and `showcase`, it runs the business's seed.

**Reseed and reset refuse anything real.** Two paths exist: `pnpm reseed` (dev) and a new `db/src/reset-demo.ts` (the
hosted demo, which today has no seed path at all, FACT `docs/DEPLOY.md`). Both refuse unless `ops.deployment` is not
`live` and every tenant they touch is `synthetic` or `showcase`. A red-proof plants a `live` row and shows both refuse.
Munim had no such guard (F); Munshi's reseed refuses today, and this keeps that refusal and extends it to the new class.

**How "refuses non-synthetic tenants" (the ticket) is read here.** By default reseed rebuilds `synthetic` tenants only.
A `showcase` tenant is rebuilt only when named explicitly (`--showcase <slug>`), because its data is reproducible from
committed seed files. A `live` tenant is refused always, with or without a flag. The orchestrator should confirm this
reading.

### 1.5 The multi-tenant dev seed, the demo picker, the demo deny-list

- **Seed.** `pnpm dev` and `pnpm reseed` provision three tenants: the kirana (synthetic), the suit shop (showcase) and
  the salon (showcase). The directory replaces `.run/demo-tenant`.
- **Demo sign-in** (`/sign-in`, demo deploy only, while `MUNSHI_DEPLOYMENT=demo`):
  - On the live deploy the route returns 404.
  - The screen shows shop cards (name and label), then the chosen shop's active members. It lists directory rows and,
    per tenant, reads `data_class` under that tenant (system scope). Anything not synthetic or showcase is dropped.
  - The cookie records `via=demo`, and `sessionFrom` refuses that cookie for a live tenant (§6.4).
- **Demo deny-list** (Munim's demo guard pattern, F). On a public demo deploy anyone can sign in as the owner. So, on
  synthetic and showcase tenants, core refuses these with `demo_protected`:
  - adding or deactivating a member, and invites;
  - creating or revoking a site key, and changing origins;
  - erasing a contact.
  
  Drafts, approvals, sales, campaigns and publishing stay allowed, because they are the demo.

### 1.6 Add-a-business checklist

1. A signed one-page permission (`../hackathon/meta-ai-developer-hackathon/merchants/PERMISSION-AND-INTAKE.md`).
2. Choose the slug and the business type; the type's registry entries exist (totality test green).
3. Showcase data: catalogue, services, packages and the merchant's own photos go in `db/seed/merchants/<slug>/`. Photos
   need the signed photo-rights line. Add a seed script and its tests.
4. `provision.ts --class showcase` against the demo database, and `--class live` against the live database.
5. Live: the owner accepts the invite with Google (§6). In *Settings → Developer kit* the owner creates the site and a
   key and sets the allowed origins (§5).
6. The site folder `apps/sites/businesses/<slug>/` (profile, theme.css, fonts, art), plus the slug in the
   bundle-isolation gate's list (§5.6).
7. Two site deploy projects: `<slug>-demo` (demo API, demo key, "Sample data" ribbon) and `<slug>` (live API, live key).
8. The owner taps *Publish* (a release, §5.3); the site shows "Prices from the shop's books".
9. The privacy notice names the merchant as the business the data belongs to (§7.1).
10. The capture guard's allow-list (§8.3) and the README list the tenant and its class.

## 2 · Schema from 0010: one migration per concern

### 2.0 Rules every new table follows (from `docs/SCHEMA.md` § Adding a table)

- **Keys.** `tenant_id uuid not null references ops.tenant` comes first and leads the primary key `(tenant_id, id)`,
  every index and every foreign key, and foreign keys are composite. The exceptions are the global tables, which are
  listed in `manifest.json` `globalTables`. The gates exclude them from `TENANT_TABLES` (FACT, `db/test/db.ts` L116),
  and G10 checks only `TENANT_TABLES` (FACT, `g10-indexes.test.ts` L59). So `ops.member_login` (keyed by provider) and
  `ops.rate_counter` (no tenant column at all) pass G10 once they are listed as global.
- **Isolation.** RLS is enabled **and forced**, with the one `tenant_isolation` policy. Each table has an explicit
  `revoke all … from public, munshi_app, munshi_agent` followed by its exact grants.
- **The agent gets nothing on any new table and no new view.** It sees new data only as snapshot cells, and those never
  hold personal data (§7.4).
- **Books.** Every books table carries the stamp columns (`created_by`, `decision_id`, `created_at`) and the `guard` and
  `guard_audit` triggers. It grants SELECT and INSERT only, and its `ops.command_table` rows land in the same migration
  (G3 totality). Corrections are reversals carrying `reverses_id` and a `reason`.
- **Ops.** UPDATE is granted on named columns only, and only where a status or an erasure needs it.
- **Indexes** are declared one per statement in the form G10 parses and asserts in `pg_index`.
- **Functions** each get `revoke execute … from public` (G9).
- **Manifest.** Tables, global tables and functions are all added to `manifest.json`. G1, G4 and G9 count against it, an
  independent source.
- **New error codes.** `MS008` personal data refused in the books; `MS009` a balance would go negative; `MS010` a tenant
  class that does not match the deployment; `MS011` an erase-only column changed other than to NULL. Core maps each to a
  `CoreError` code; the database's message never leaves core.
- **One shared trigger function, `ops.only_erase()`.** `TG_ARGV` lists a table's personal columns. An UPDATE may change
  a listed column only to NULL, and `erased_at`, once set, never clears; otherwise it raises `MS011`. It is used by
  `ops.contact`, `ops.site_request`, `ops.inbound_message`, `ops.delivery` and `ops.document_blob`. One function rather
  than one per table, so the rule is red-proved once.

| # | File | Concern | New tables | Size |
|---|---|---|---|---|
| 0010 | `tenancy.sql` | business type, data class, deployment, slug directory | `ops.deployment`ᵍ, `ops.tenant_directory`ᵍ | S |
| 0011 | `items.sql` | services, packages as items, variants | (columns on `books.item`) | S |
| 0012 | `people.sql` | the contact vault, customers without personal data, consent | `ops.contact`, `books.customer_consent` | M |
| 0013 | `sign_in.sql` | logins, invites, sessions, deactivation | `ops.member_login`ᵍ, `ops.member_invite`, `ops.login_session` | M |
| 0014 | `offers_loyalty.sql` | offers, sale discounts, loyalty | `books.offer`, `books.offer_item`, `books.offer_end`, `books.sale_discount`, `books.loyalty_rule`, `books.loyalty_entry` | M |
| 0015 | `packages.sql` | prepaid packages and their liability ledger | `books.package_plan`, `books.package_plan_line`, `books.package_holding`, `books.package_entry` | M |
| 0016 | `messaging.sql` | campaigns, outbox, inbox, media, channel `instagram` | `ops.campaign`, `ops.delivery`, `ops.inbound_message`, `ops.inbound_extract`, `ops.document_blob` | M |
| 0017 | `sites.sql` | sites, keys, releases, public requests, rate counters | `ops.site`, `ops.site_key`, `ops.site_release`, `ops.site_request`, `ops.rate_counter`ᵍ | M |
| 0018 | `grid.sql` | a person's grid edits as evidence | `ops.grid_batch`, `ops.grid_change` | S |

ᵍ = global (in `globalTables`). The total is 29 new tables (4 global), 11 of them books. The migrator lane writes them in
order, serially. *Lane E's appointment, staff-hours, stitching, payables and commission files* are not here: they are
Won't for 5 Nov (SYNTHESIS, Won't list).

### 0010 · tenancy

- **`ops.tenant`** gains two columns:
  - `business_type text not null default 'kirana'`, check `kirana | apparel | salon`;
  - `data_class text not null default 'synthetic'`, check `synthetic | showcase | live`.
  
  Grants are unchanged (S I; no UPDATE, so both are immutable).
- **Trigger `ops.tenant_class`** (before insert on `ops.tenant`) raises `MS010` unless `(data_class = 'live')` equals
  `(the deployment kind = 'live')`. No deployment row counts as `demo`, which is what dev and the tests are.
- **`ops.deployment`ᵍ**, one row: `one boolean primary key default true check (one)`, `kind text check demo | live`,
  `created_at`.
  - App: S. Agent: none.
  - Inserted only by `provision.ts` or `reset-demo.ts` as `munshi_owner`, before any tenant.
- **`ops.tenant_directory`ᵍ**: `slug text primary key check (slug ~ '^[a-z][a-z0-9-]{2,39}$')`,
  `tenant_id uuid not null unique references ops.tenant`, `created_at`.
  - App: S. Agent: none.
  - Inserted only by provisioning as `munshi_owner`. FK checks bypass RLS, so the global row can reference a tenant row
    (FACT, PostgreSQL docs on row security; confirm in the gate).
  - *A slug column on `ops.tenant`* was rejected: a lookup by slug under RLS is impossible, and a slug-led index breaks
    G10.
- **Gates.**
  - **T1:** a live tenant is refused in a demo database and a showcase tenant in a live one; both are accepted the right
    way round. Red-proof: drop the trigger.
  - **T2:** the app cannot write either global table, nor UPDATE `data_class` or `business_type` (`42501`).
  - **T3:** reseed and reset refuse a live tenant and a live deployment.
  - G1, G4 and G9 counts come from the manifest.

### 0011 · items: services, packages, variants

- **`books.item`** gains:
  - `kind text not null default 'good'`, check `good | service | package`;
  - `duration_min integer`, check `5..600`;
  - `parent_item_id uuid`, FK `(tenant_id, parent_item_id) → books.item`, check `parent_item_id <> id`;
  - `attrs jsonb not null default '{}'`, check `jsonb_typeof = 'object'`.
- **Checks.** `(kind = 'service') = (duration_min is not null)`. The unit check is dropped and re-added with `session`,
  plus `(kind = 'service') = (unit = 'session')`. The same drop-and-re-add pattern was used for `run_trigger_check` in
  0008 (FACT). Existing rows are `good` with no duration, no parent and `{}`, so every check holds on them.
- **Variants are child items.**
  - A child has a parent, the parent has none (one level), and only a `good` has variants. Core enforces these in
    `item.create`, since the DB FK already pins the tenant.
  - Attribute keys come from the business registry (apparel: `size`, `colour`); values are ≤ 30 characters.
  - Stock, price and the counter work per child, unchanged. A parent that has children cannot be sold (core).
  - Lane E judged this the cheapest variant model: counter, stock and bills stay unchanged.
- **Index:** `item_parent (tenant_id, parent_item_id)`.
- **Commands.** `item.create` already writes `books.item` (`ops.command_table`, FACT); it gains the new fields. There are
  no new authority rows.
- **Gates.**
  - **I1:** a service line makes no stock move, while a good does.
  - **I2:** a parent with variants cannot be sold, and a variant's stock is its own.
  - **I3:** the kirana suite passes unchanged.

### 0012 · people: the contact vault, customers without personal data, consent

**`ops.contact`** (ops; the erasable vault)

| Column | Type / check |
|---|---|
| `id` | uuid |
| `name` | text ≤ 80, nullable (NULL once erased) |
| `phone_e164` | text, check `'^\+[1-9][0-9]{7,14}$'`, nullable (NULL once erased) |
| `language` | text, check `hi \| en`, default `hi` |
| `created_by` | uuid, FK member, not null: always a person; a public request is not a contact until a person confirms it |
| `created_at` | timestamptz |
| `erased_at`, `erased_by`, `erase_reason` | `erase_reason` check `request \| retention` |

- **Grants.** App: S I, plus U(`name`, `phone_e164`, `erased_at`, `erased_by`, `erase_reason`). Agent: none.
- **Triggers.**
  - `ops.only_erase('name', 'phone_e164')`.
  - `ops.contact_erase`, before update: the actor must be an active owner, and `erased_by` must equal the actor.
- **Index:** unique `contact_phone (tenant_id, phone_e164) where erased_at is null`, one live contact per phone.
- **Audit.** Every insert and erasure is audited under the actor with payload `{contact_id}` only: never a name or a
  phone, because the chain is permanent.

**`books.customer`** changes:
- It gains `contact_id uuid` (FK `ops.contact`).
- `name` drops NOT NULL. This relaxes a constraint on a book table, so the orchestrator should check it.
- Check `customer_identity`: `(contact_id is null) = (name is not null)`.
- Check `customer_no_phone`: `contact_id is null or phone is null`.
- Trigger `books.customer_pii` (before insert, after `guard`, so it is named `pii`): for a `live` tenant it raises
  `MS008` unless `contact_id` is set.

Existing rows have a name and no contact, so both checks hold. The kirana keeps writing names (invented people), and its
tests do not change. `agent_view.customer (id, name)` needs no change: for a vault-backed customer `name` is NULL, so the
agent sees an id only.

**`books.customer_consent`** (books)

| Column | Type / check |
|---|---|
| `customer_id` | uuid, FK |
| `channel` | `whatsapp \| sms` |
| `purpose` | `marketing \| service` |
| `granted` | boolean |
| `source` | `site_form \| in_person \| whatsapp \| import` |
| `evidence_table`, `evidence_id` | e.g. `ops.site_request` + id; both or neither |
| `notice_version` | text (the privacy notice the person saw) |
| `at` | timestamptz |

- **Append-only.** The latest row per (customer, channel, purpose) wins, and a withdrawal is a new row with
  `granted = false`, never an update.
- **Written by** `consent.record` (owner, manager, staff: what the customer says at the counter) and `booking.confirm`
  (owner, manager: the box the customer ticked on the form).
- **Grants:** S I. **Index:** `consent_latest (tenant_id, customer_id, channel, purpose, at)`.
- **`ops.command_table`:** `consent.record → customer_consent`; `booking.confirm → customer, customer_consent,
  outbound_message`; `customer.create` is unchanged (`customer`).
- **Gates.**
  - **PII1:** a live tenant's customer with a name or phone is refused (`MS008`; red-proof: drop the trigger).
  - **PII2:** after a scripted live-tenant run, no `audit.audit_log.payload` and no `snap.snapshot_cell.txt` contains the
    contact's phone or name. The positive control is a planted synthetic customer whose name *is* found.
  - **E1:** erasure (§7.3).
  - **K1:** the latest consent row wins.
  - G1, G3 and G4 over the new tables.

### 0013 · sign-in: logins, invites, sessions, deactivation

- **`ops.member_login`ᵍ** (global, because a Google subject names no tenant)
  - **Columns:** `provider text check google`, `subject text`, `email text`, `tenant_id`, `member_id`, `created_at`.
    The primary key is `(provider, subject, tenant_id)`, the FK `(tenant_id, member_id) → ops.member`, with
    `unique (tenant_id, member_id, provider)`.
  - **Grants.** App: S I. Agent: none.
  - **Trigger `ops.login_bind`:** `tenant_id` must be the current tenant and `member_id` the acting member. An
    `ops.member_invite` row for that member must have been consumed in this transaction (`used_txid = txid_current()`).
    So no login is ever bound without an invite.
  - **Audit:** `member.login_bound`, with payload `{member_id, provider}`.
- **`ops.member_invite`**
  - **Columns:** `member_id`, `email` (the Google address the owner typed; must match the verified email at
    acceptance), `token_sha256 bytea unique`, `expires_at` (24 hours), `created_by`, `created_at`, `used_at`,
    `used_txid`.
  - **Grants.** App: S I, plus U(`used_at`, `used_txid`), once only (a trigger refuses a second use or use after
    expiry). Agent: none.
- **`ops.login_session`**
  - **Columns:** `member_id`, `via text check demo | google`, `created_at`, `expires_at`, `revoked_at`.
  - **Grants.** App: S I U(`revoked_at`), one way. Agent: none.
  - **Index:** `login_session_member (tenant_id, member_id)`.
- **`ops.member`** gains U(`active`). Trigger `ops.member_deactivate`: only true → false, by an active owner, never the
  last active owner. It is audited as `member.deactivate`. Today there is no way to remove a person who has left (no
  UPDATE grant, FACT 0002). Re-activation means a new member row.
- **Gates:** F1–F6 (§6.6).

### 0014 · offers, sale discounts, loyalty

| Table (books) | Columns | Written by | Authority |
|---|---|---|---|
| `books.offer` | `name`; `kind` (`percent_off`, `amount_off`); `percent_bp` (1..9000, integer basis points: 2000 = 20%); `amount_off_minor` + `currency`; `scope` (`all`, `category`, `items`); `category`; `min_spend_minor`; `starts_at`; `ends_at`; `published` (shown by the public API). Checks: the kind's amount and only it set; `ends_at > starts_at` | `offer.create` | owner |
| `books.offer_item` | `offer_id`, `item_id` (scope `items`) | `offer.create` | owner |
| `books.offer_end` | `offer_id` (unique), `ended_at`, `reason` not null: ending an offer early, append-only | `offer.end` | owner |
| `books.sale_discount` | `sale_id`, `line_no` (NULL = whole sale), `source` (`offer`, `loyalty`), `offer_id`, `loyalty_entry_id` (exactly the source's id set), `amount_minor > 0`, `currency` | `sale.record` | (as sale.record) |
| `books.loyalty_rule` | `earn_per_100` (points per ₹100 of net spend, integer ≥ 0), `point_value_minor` (≥ 1), `min_redeem` (points), `effective_from`: the latest in effect wins, like price | `loyalty.rule.set` | owner |
| `books.loyalty_entry` | `customer_id`; `kind` (`earned`, `redeemed`, `reversal`); `points` (signed, ≠ 0); `seq`; `balance_after` (check ≥ 0); `sale_id`; `reverses_id` + `reason`; `at` | `sale.record` | (as sale.record) |

- **Trigger `books.loyalty_tally`.** It fires before insert, named `tally` so it runs after `guard` (same-timing triggers
  fire in name order, FACT 0005 comment). It takes `pg_advisory_xact_lock('munshi.loyalty:' || tenant || customer)` and
  sets `seq` and `balance_after` from the customer's last row. Below zero raises `MS009`. The caller's values are
  overwritten, as `audit.chain` does with `seq` and `hash`.
- **`ops.command_table`:** `sale.record` gains `sale_discount` and `loyalty_entry`; `offer.create → offer, offer_item`;
  `offer.end → offer_end`; `loyalty.rule.set → loyalty_rule`.
- **Indexes:** `offer_window (tenant_id, starts_at, ends_at)`; `offer_item_item (tenant_id, item_id)`;
  `sale_discount_sale (tenant_id, sale_id)`; `loyalty_rule_from (tenant_id, effective_from)`; unique
  `loyalty_entry_seq (tenant_id, customer_id, seq)`.
- **Why offers are books.** They change what a customer pays, so they are prices. Munim kept deals and coupons as books
  too (D), and no AI draft creates an offer (D: Munim's AI only drafts *ending* one).
- **Gates.**
  - **O1:** `sale.quote_offers` equals the recorded sale to the paisa, and the journal balances
    (`sales_discount` debit).
  - **O2:** an ended, expired, not-yet-started or out-of-scope offer is refused at `sale.record`; a client-sent total or
    discount is ignored.
  - **L1:** concurrent redemptions of the last points: one commits and the other gets `MS009`. Red-proof: drop the lock
    from the trigger.
  - **L2:** a forged `balance_after` is overwritten.

### 0015 · packages: prepaid packs and their liability ledger

| Table (books) | Columns | Written by | Authority |
|---|---|---|---|
| `books.package_plan` | `item_id` (unique; the item of kind `package` that is sold at the counter, priced by `books.price`); `kind` (`sessions`, `value`); `value_minor` + `currency` (`value` plans: the stored value given); `validity_days` (1..1095) | `package.plan.create` | owner |
| `books.package_plan_line` | `plan_id`, `line_no`, `item_id` (a service), `sessions` (1..100) | `package.plan.create` | owner |
| `books.package_holding` | `customer_id`, `plan_id`, `sale_id`, `starts_on`, `expires_on`, `liability_minor` + `currency` (the line's net amount, the money owed back as service) | `sale.record` | (as sale.record) |
| `books.package_entry` | `holding_id`; `item_id` (NULL for value plans); `kind` (`sold`, `redeemed`, `expired`, `reversal`); `sessions` (signed; NULL for value plans); `value_minor` (signed: the liability this row moves); `currency`; `seq`; `sessions_after` and `value_after` (checks ≥ 0); `at`; `reverses_id` + `reason` | `sale.record` (sold), `package.redeem`, `package.expire` | owner, manager and staff (redeem); owner (expire) |

- **Trigger `books.package_tally`.** It fires before insert, named `tally`, and locks
  `'munshi.package:' || tenant || holding`. It sets `seq`, `sessions_after` (per holding and item) and `value_after`
  (per holding). Below zero raises `MS009`.
- **Journal** (core; accounts are constants in `commands.ts`, as today):
  - A sale: tenders debit, `package_liability` credit.
  - A redemption: `package_liability` debit, `sales` credit. The amount is the holding's remaining value divided by its
    remaining sessions, in integer minor units, with the last session taking the remainder.
  - An expiry: `package_liability` debit, `package_breakage` credit.
- **`ops.command_table`:** `package.plan.create → item, price, package_plan, package_plan_line`; `sale.record` gains
  `package_holding` and `package_entry`; `package.redeem → package_entry, journal_entry, journal_line`;
  `package.expire → package_entry, journal_entry, journal_line`.
- **Indexes:** `package_holding_customer (tenant_id, customer_id)`; `package_holding_expiry (tenant_id, expires_on)`;
  unique `package_entry_seq (tenant_id, holding_id, seq)`.
- **Gates.**
  - **P1:** sell, redeem everything, expire: the liability nets to zero and the journal balances.
  - **P2:** two concurrent redemptions of the last session: one gets `MS009`. Red-proof: drop the lock.
  - **P3:** a package line needs a customer.
  - **P4:** a `package.expire` draft goes stale when a redemption lands first.

### 0016 · messaging: campaigns, outbox, inbox, media

- **`books.outbound_message`** changes:
  - `channel` adds `instagram`; `recipient_kind` adds `public` (drop and re-add both checks).
  - New check: `(channel = 'instagram') = (recipient_kind = 'public')`.
  - New columns: `campaign_id uuid` (FK `ops.campaign`); `reply_to_id uuid` (FK `ops.inbound_message`, a reply in a
    customer's 24-hour window).
  - An Instagram post's `recipient_id` is its campaign's id, because the column is NOT NULL and polymorphic with no FK
    (FACT 0005).
- **`ops.campaign`**
  - **Columns:** `name`; `channel` (`whatsapp`, `instagram`); `offer_id` (FK `books.offer`, nullable); `card_document_id`
    (FK `ops.document`); `segment` (`bought_within_days`, the one v1 segment); `segment_days` (1..365); `status`
    (`composing`, `proposed`, `approved`, `rejected`, `sent`); `created_by`; `created_at`; `updated_at`.
  - **Grants.** App: S I U(`status`, `updated_at`).
  - It is the composer's working object; the send itself is the draft (§3).
- **`ops.delivery`**, the outbox
  - **Columns:** `message_id` (unique, FK `books.outbound_message`); `channel`; `to_address` (E.164, or the Instagram
    account id; nullable once purged); `mode` (`cloud_api`, `manual_link`, `recorded`); `status` (`queued`, `sent`,
    `delivered`, `read`, `failed`, `needs_window`, `handed_off`); `attempts`; `provider_message_id` (unique per tenant
    where not null); `error_code` (the provider's code, never its text); `next_attempt_at`; `sent_at`; `final_at`;
    `created_at`; `updated_at`; `erased_at`.
  - **Grants.** App: S I U(status columns, `to_address`, `erased_at`). Trigger `ops.only_erase('to_address')`.
- **`ops.inbound_message`**, the inbox. It is written with **no actor**, by the webhook in a system scope.
  - **Columns:** `channel` (`whatsapp`); `provider_message_id` (unique per tenant, so Meta's retries are idempotent);
    `from_address`; `kind` (`text`, `audio`, `image`, `other`); `text` (≤ 4,096); `media_document_id`; `transcript`
    (set when a person taps *Transcribe*); `opt_out` (set by plain code on a stop word: STOP, UNSUBSCRIBE, "band karo",
    "बंद करो"); `received_at`; `status` (`new`, `handled`, `ignored`); `handled_by`; `handled_at`; `erased_at`.
  - **Grants.** App: S I U(`status`, `handled_by`, `handled_at`, `transcript`, `media_document_id`, `text`,
    `from_address`, `erased_at`). Trigger `ops.only_erase('text', 'from_address', 'transcript')`.
- **`ops.inbound_extract`**, a figure Spark pulled from a transcript, the voice note's equivalent of `ops.bill_line`
  - **Columns:** `message_id`; `run_id`; `field` (`amount`, `date`, `service`, `quantity`); `num` or `day` or `item_id`;
    `quote`; `quote_start`; `quote_end`.
  - **Trigger:** `quote` must equal `substring(transcript from quote_start for quote_end - quote_start)` of its message,
    or `MS006`.
  - **Grants.** App: S I.
- **`ops.document`** changes:
  - `kind` adds `voice` and `card`; `uploaded_by` drops NOT NULL.
  - New column `source text not null default 'upload'`, check `upload | inbound`, with check
    `(source = 'upload') = (uploaded_by is not null)`.
  - Inbound media has no member. The existing rows are uploads, so every check holds.
- **`ops.document_blob`**
  - **Columns:** `document_id` (unique); `bytes bytea`, check `octet_length ≤ 2,097,152`; `purge_after`; `erased_at`.
  - **Grants.** App: S I U(`bytes`, `erased_at`). Trigger `ops.only_erase('bytes')`.
  - **Why `bytea` and no blob store.** No store exists today: no code reads `ops.document.storage_key` (FACT, grep). A
    voice note is about 100 KB and a card about 300 KB (INFERENCE). Storage keys stay as `db:<id>`, so a blob store can
    replace this later behind the same column.
- **`ops.run.trigger`** adds `inbox` and `campaign`.
- **`ops.command_table`:** `campaign.send → outbound_message`; `campaign.post → outbound_message`;
  `message.reply → outbound_message`. **Authority:** `campaign.send` and `campaign.post` owner; `message.reply` owner and
  manager.
- **Indexes:** `delivery_due (tenant_id, status, next_attempt_at)`; `inbound_from (tenant_id, from_address, received_at)`;
  `inbound_status (tenant_id, status, received_at)`; `outbound_campaign (tenant_id, campaign_id)`;
  `extract_message (tenant_id, message_id)`.
- **Gates:** W1–W5 and K2–K4 (§4.7).

### 0017 · sites: sites, keys, releases, public requests, rate counters

- **`ops.site`**
  - **Columns:** `shop_id`; `name`; `origins text[]` (each `https://host[:port]`; `http://localhost:<port>` only while
    the deployment is `demo`, by trigger); `intake` (`open`, `paused`: the owner's kill switch for the public forms);
    `privacy_version`; `created_by`; `created_at`; `updated_at`.
  - **Grants.** App: S I U(`origins`, `intake`, `privacy_version`, `updated_at`).
  - **Rules.** One site per tenant in v1 (unique on tenant). The slug is the tenant's directory slug.
- **`ops.site_key`**
  - **Columns:** `site_id`; `key_sha256 bytea` (unique per tenant); `prefix text` (`mpk_<slug>_` plus four characters,
    for display); `created_by`; `created_at`; `revoked_at`; `revoked_by`.
  - **Grants.** App: S I U(`revoked_at`, `revoked_by`). A trigger allows revocation once, by an active owner.
- **`ops.site_release`**: `site_id`, `snapshots jsonb` (read name → snapshot id), `published_by`, `published_at`.
  - **Grants.** App: S I.
  - The API serves the newest release.
- **`ops.site_request`**: a booking request or an enquiry. It is written with **no actor**, by the public route in a
  system scope. It is never a book.

| Column | Type / check |
|---|---|
| `site_id`, `shop_id` | uuid |
| `kind` | `booking \| enquiry` |
| `source` | `site \| whatsapp` (a voice-note booking, §4.5) |
| `name` | ≤ 80 |
| `phone_e164` | E.164, India `+91[6-9]` + 9 digits |
| `item_ids` | uuid[], ≤ 3 (services asked for, or the product enquired about) |
| `preferred_on` | date, booking only, today..+60 days |
| `time_window` | `morning \| afternoon \| evening`, booking only |
| `note` | ≤ 500 |
| `wa_updates` | boolean, the unticked box |
| `notice_version`, `consent_version` | text |
| `idempotency_key` | text, unique per site |
| `ip_hash` | bytea, keyed hash, §9 |
| `status` | `new \| confirmed \| declined \| spam \| closed` |
| `handled_by`, `handled_at`, `customer_id`, `created_at`, `erased_at` | |

- **`ops.site_request` checks:** `(kind = 'booking') = (preferred_on is not null and time_window is not null)`.
- **`ops.site_request` grants.** App: S I U(`status`, `handled_by`, `handled_at`, `customer_id`, `name`, `phone_e164`,
  `note`, `erased_at`). Trigger `ops.only_erase('name', 'phone_e164', 'note')`.
- **`ops.rate_counter`ᵍ**
  - **Columns:** `bucket bytea` (a keyed hash of the IP, the key or the phone, plus the route class); `window_start`;
    `hits`. The primary key is `(bucket, window_start)`.
  - **Grants.** App: S I U(`hits`), plus DELETE.
  - This is **the only DELETE grant in the schema**. It holds hashes only, no tenant, and an hourly sweep drops windows
    older than a day. *An unlogged table* was rejected because it would vanish on a crash. *An external KV store* was
    rejected as a new vendor and key for a counter.
- **Indexes:** unique `site_one (tenant_id)` on `ops.site`; `site_key_site (tenant_id, site_id)`;
  `site_release_latest (tenant_id, site_id, published_at)`; `site_request_status (tenant_id, status, created_at)`;
  `site_request_phone (tenant_id, phone_e164) where erased_at is null`; unique
  `site_request_idem (tenant_id, site_id, idempotency_key)`.
- **Gates:** S1–S8 (§5.7).

### 0018 · grid: a person's edits as evidence

- **`ops.grid_batch`**
  - **Columns:** `base_snapshot_id` (the `grid.catalogue` snapshot the person edited); `source` (`typed`, `pasted`,
    `file`); `document_id` (the imported file's sha256 record); `created_by`; `created_txid`; `created_at`.
  - **Trigger:** `created_by` must be the acting member, and `created_txid` is stamped.
- **`ops.grid_change`**
  - **Columns:** `batch_id`, `line_no`, `item_id` (NULL for a new row), `add_key`, `column` (`price` or `new_item`),
    `amount_minor` + `currency`, `txt` (a new item's name, unit and category as JSON text).
  - **Rule:** a line is accepted only in its batch's transaction (the `ops.bill_read_txn` pattern, FACT 0008).
- **Grants.** App: S I on both. Agent: none.
- **Why:** a typed or pasted price is a person's input, not a book cell. Storing it as an actor-stamped ops row lets
  the `grid.batch` read mint it as a cell, so `grid.apply` passes `proposeDraft`'s every-number-is-a-cell rule without
  loosening it (§3.4).
- **`ops.command_table`:** `grid.apply → item, price`. **Authority:** owner.
- **Gates:** GR1–GR4 (§3.4).

## 3 · Commands, draft types, and the named reads that mint their numbers

### 3.1 Direct commands (a person's own; the guard checks the role through `ops.command_authority`)

| Command | Input (payload field names set the cell kind: `…Minor` money, `…Milli` quantity, others integer) | Writes (`books.`) | Roles |
|---|---|---|---|
| `item.create` (changed) | + `kind`, `durationMin`, `parentItemId`, `attrs` | item | owner, manager |
| `package.plan.create` | `name`, `kind`, `priceMinor`, `valueMinor?`, `validityDays`, `lines[{itemId, sessions}]` | item, price, package_plan, package_plan_line | owner |
| `offer.create` | `name`, `kind`, `percentBp?`, `amountOffMinor?`, `scope`, `category?`, `itemIds?`, `minSpendMinor?`, `startsAt`, `endsAt`, `published` | offer, offer_item | owner |
| `offer.end` | `offerId`, `reason` | offer_end | owner |
| `loyalty.rule.set` | `earnPer100`, `pointValueMinor`, `minRedeem`, `effectiveFrom?` | loyalty_rule | owner |
| `sale.record` (changed, 3.3) | + `offerIds?` (≤ 3), `redeemPoints?` | + sale_discount, loyalty_entry, package_holding, package_entry | owner, manager, staff |
| `package.redeem` | `holdingId`, `itemId?`, `at?` | package_entry, journal_entry, journal_line | owner, manager, staff |
| `customer.create` (changed) | the old shape `{name, phone?, creditLimitMinor?}`, or `{contact: {name, phone, language?}, creditLimitMinor?}`, which writes `ops.contact` first. The old shape is refused for a live tenant (`MS008`), and core always uses the contact shape for a person who came from a public request or the inbox, on any tenant | customer | owner, manager |
| `consent.record` | `customerId`, `channel`, `purpose`, `granted` (source `in_person`) | customer_consent | owner, manager, staff |
| `booking.confirm` | `requestId`, `customerId?` or `newCustomer: true`, `reply` | customer (+ `ops.contact`), customer_consent (if the box was ticked), outbound_message (a fixed template); sets the request's status | owner, manager |

**Ops-only actions** have no `ops.command_authority` row, because G3 requires every held command to write a book table.
Core checks the role; a DB trigger checks it too where marked †.
- `booking.decline`, `enquiry.close`: owner, manager, staff.
- `contact.erase`†: owner.
- `site.create`, `site.update` (origins, intake): owner.
- `site.key.create`, `site.key.revoke`†: owner.
- `site.publish`: owner, manager.
- `member.invite`: owner invites a manager; owner or manager invites staff, mirroring `ops.member_guard`.
- `member.deactivate`†: owner.
- Composing a campaign and handling an inbox item: owner, manager.

### 3.2 Draft types (the agent or a member proposes; a person whose role holds the command approves)

| Draft | Payload | Every number and the cell it must cite | Checked at proposal and again at approval |
|---|---|---|---|
| `campaign.send` | `campaignId`, `copy`, `offerId?`, `cardDocumentId?`, `audienceCount` | `audienceCount` → `campaign.audience` row 0 `audience`. The figures *inside* `copy` are ref tokens to `offer.detail` cells (`percent_bp`, `amount_off`, `ends_at`) | no ASCII or Devanagari digit outside a ref token; every token is in `basedOn`; the offer is still in effect; the audience count is unchanged. A changed count or an ended offer → `stale` |
| `campaign.post` | `campaignId`, `caption`, `cardDocumentId` | the caption's figures are ref tokens, as above | the same digit rule; the card is a `card` document of this tenant |
| `message.reply` | `inboundMessageId`, `customerId`, `body` | the body's figures are ref tokens | the 24-hour window is open at proposal (shown) and checked again at send (§4.3). On a live tenant the body must be a fixed template (§7.3) |
| `package.expire` | `holdingId`, `valueMinor`, `lines[{itemId, sessions}]` | `valueMinor` → `package.balance.value_left`; `lines[n].sessions` → `package.balance.sessions_left`, same item | the new current-state rule `holdingId → package.balance`: a redemption after the draft makes it stale |
| `grid.apply` | `batchId`, `lines[{itemId, oldAmountMinor, amountMinor}]`, `adds[{addKey, name, unit, category?, kind?, parentItemId?, amountMinor}]` | `oldAmountMinor` → `grid.catalogue.price`, same item; `amountMinor` → `grid.batch.new_amount`, same item or add key | ≤ 500 lines; every old cell re-checked at approval (3.4) |
| `booking.confirm` (from a voice note) | as the direct command, plus `messageId`, `serviceItemIds`, `preferredOn`, `timeWindow` | `preferredOn` → an `inbox.extract` date cell; the service ids → `inbox.extract` item cells | the extract belongs to that message |
| `credit.record` (from a voice note, kirana; Should) | the existing payload | `amountMinor` → an `inbox.extract` amount cell; `customerId` → `credit.balance` (the existing rule, FACT approvals.ts) | as today |

**Core changes this needs** (pre-step MS-22a, §11):
1. `Def` gains an optional `checks(c, payload, refs, basedOn) → bad paths`. `proposeDraft` calls it after its generic
   checks and refuses on any bad path; `decide()` calls it before executing and marks the draft stale on any. Each
   command's rules then live with the command, not in `approvals.ts`.
2. `CURRENT` and `named()` gain `holdingId → package.balance (holding_id, value_left)`. Without it a `package.expire`
   draft, which writes a journal line, names neither an item nor a customer and is refused (FACT approvals.ts
   `citesCurrent`).
3. `COMMANDS` and `QUERIES` spread per-area files (`commands-<area>.ts`, `queries-<area>.ts`), so each lane owns its own
   file.
4. **Draft-only commands.** `Def` gains `draftOnly: true` for `campaign.send`, `campaign.post`, `message.reply`,
   `package.expire` and `grid.apply`, and `runCommand` refuses them. Their `ops.command_authority` rows exist so the
   guard admits them under an approved decision. Without this flag, a direct `runCommand` would execute them and skip
   `checks`: the copy digit rule and the grid evidence. Gate: each draft-only command refused by `runCommand`
   (red-proof: drop the flag). The database could enforce it too, with a `direct` column on `ops.command_authority` read
   by the guard's branch (b), but that changes `books.guard()`, so it is left for review.

`proposeDraft`'s every-number-is-a-cell rule (FACT approvals.ts L168–170) is unchanged. Nothing here loosens it.

### 3.3 `sale.record` and the counter's quote

- **Lines by kind.** A `good` moves stock as today. A `service` moves none. A `package` moves none: it creates the holding
  and its `sold` entries, and it needs `customerId`. A parent with variants is refused.
- **Prices** come from `books.price` in effect at `soldAt`, as today. The input still carries no total and no discount
  field: amounts are re-derived, and anything a client computed is ignored.
- **Offers.** Each named offer is re-judged at `soldAt`:
  - in effect means `starts_at ≤ soldAt < ends_at` and no `offer_end` at or before `soldAt`;
  - its scope must match the line, and its minimum spend is measured on the eligible gross.
  
  For each line, the best eligible percentage offer wins; a tie goes to the lower offer id, and offers never stack. An
  `amount_off` offer applies once per sale, capped at the eligible gross. Package lines take no offer in v1. Rounding is
  `lineAmount`'s half away from zero.
- **Loyalty.** `redeemPoints` must be at least `min_redeem`, and its value (`points × point_value_minor`) must not exceed
  the net after offers. It writes a `redeemed` entry and a `sale_discount` with `source = 'loyalty'`; the trigger refuses
  any overdraw. Earning: when the customer is named and a rule is in effect, the sale writes `earned` =
  `floor(net_minor × earn_per_100 / 10000)` (₹100 is 10,000 paise) when it is above zero.
- **Totals and journal.** `sale.total_minor` = gross − discounts. Debits: tenders and receivable (the net), plus
  `sales_discount` (the discounts). Credits: `sales` (the gross of the non-package lines) and `package_liability` (the
  net of the package lines). New account constants: `sales_discount`, `package_liability`, `package_breakage`.
- **The counter's preview.** A new read, `sale.quote_offers`, previews the bill with its offers. `sale.quote` stays as it
  is, so the MS-10 gate is untouched. Gate O1: the quote equals the recorded sale to the paisa.

### 3.4 `grid.apply`, end to end

1. **Base.** `/stock/table` loads the `grid.catalogue` read (≤ 500 rows). Each price cell is the `old.ref` in MS-18's diff
   `{snapshotId, changes:[{rowKey, column, old:{value, ref}, new}], adds, removes}` (FACT, BOARD MS-18).
2. **Submit** (core `submitGrid(session, diff)`, a person's own action):
   - It refuses removes (no retire command exists in v1) and any column but `price` and new rows.
   - It writes `ops.grid_batch` and its `ops.grid_change` lines, stamped with the actor.
   - It mints `grid.batch` and proposes the `grid.apply` draft. `basedOn` holds two refs, and `payloadRefs` carries every
     number. `basedOn` caps at 50; `payloadRefs` takes up to `[999]` per path (FACT approvals.ts).
3. **Approve** (owner). `decide()` re-runs `grid.catalogue` with its stored parameters. Any cited old price that changed
   marks the draft `stale` with the changed refs, which the review panel shows as "changed since you opened this". The
   batch's cells never change, because ops rows are append-only.
4. **Execute.** One transaction under the owner's decision writes one `books.price` per changed line (effective now) and
   one `books.item` plus `books.price` per added row.

**Why prices and new items only.** Books are append-only, and no rename or category command exists. A stock edit would
be a count, and the "moves stock" rule wants one `stock.on_hand` snapshot per item with exactly `{item_id}`: 500
snapshots against a 50-ref `basedOn` will not fit (FACT approvals.ts `citesCurrent`).

**Gates.**
- **GR1:** a price whose base changed after the grid opened goes stale. Red-proof: drop the old-value refs.
- **GR2:** a value in a read-only column is refused at submission.
- **GR3:** another tenant's or another member's batch is refused.
- **GR4:** 501 changes are refused.

### 3.5 New named reads (each ≤ 500 rows, read-only, registered in its lane's `queries-<area>.ts`)

| Read | Params | Key | Columns (kind) | Used by |
|---|---|---|---|---|
| `offer.detail` | `offer_id` | offer_id | offer_id, name, kind (text); percent_bp (int); amount_off, min_spend (money); starts_at, ends_at (timestamp); in_effect (int 0/1) | campaign draft, composer |
| `offers.in_effect` | — | offer_id | as `offer.detail` | counter |
| `sale.quote_offers` | item_ids, qty_milli, offer_ids, customer_id?, redeem_points? | line_no | line cells as `sale.quote` + offer_id, discount, net; total_gross, total_discount, total_net (money); points_earned (int) | counter |
| `campaign.audience` | segment `bought_within_days`, days (≤ 365), channel `whatsapp` | customer_id | customer_id (text), last_bought_on (date), audience (int, `count(*) over ()`) | campaign draft |
| `package.balance` | holding_id | holding_id, item_id | holding_id, customer_id, item_id (text); sessions_left (int); value_left (money); expires_on (date) | redeem screen, expiry draft |
| `watch.package_expiry` | as_of | holding_id | holding_id, customer_id (text); expires_on (date); value_left (money) | salon watcher |
| `loyalty.balance` | customer_id | customer_id | customer_id (text); points (int) | counter, customer page |
| `requests.pending` | — | (one row) | bookings, enquiries (int) | home card, agent desk |
| `site.catalogue` | category? | item_id | item_id, parent_id, name, category, attrs (text); price (money); price_id (text: the `books.price` row) | release |
| `site.services` | — | item_id | item_id, name, category (text); duration (int); price (money); price_id | release |
| `site.packages` | — | plan_id, line_no | plan_id, name, kind, line_item (text); price, value (money); validity_days, sessions (int); price_id | release |
| `site.offers` | — | offer_id | published offers in effect: as `offer.detail` | release |
| `grid.catalogue` | category? | item_id | item_id, name, unit, category, kind (text); price (money); price_id | grid base |
| `grid.batch` | batch_id | line_no | line_no (int); item_id, add_key, column (text); new_amount (money) | `grid.apply` |
| `inbox.extract` | message_id | extract_id | extract_id, field, item_id (text); amount (money); quantity (int); day (date). **No quote**: the customer's words stay in the ops row (§7.4) | voice-note drafts |
| `site_request.detail` | request_id | request_id | preferred_on (date); time_window, service names (text). No name, no phone | the confirmation template |

The campaign audience filter, in SQL inside the read:
- the latest `customer_consent` row for (`whatsapp`, `marketing`) is granted;
- no `ops.inbound_message` from that phone with `opt_out` newer than that row;
- the contact is not erased, and a phone exists.

So a STOP takes effect at once, before any person records the withdrawal (fail closed), and only a person writes the
consent book row.

**A STOP must outlive the retention purge.** An `opt_out` inbox row can be marked handled only in the same transaction
as the person's `consent.record(granted = false)`. The purge skips any `opt_out` row that has no later withdrawal row, so
the phone it excludes is never nulled while it is the only record of the STOP. Gate K2 gains a case: STOP, the purge runs
30 days later with nobody having acted, and the customer is still excluded.

## 4 · Campaigns, WhatsApp, the webhook, Instagram

### 4.1 A campaign, step by step

1. **Segment.** The owner opens *Campaigns → New* and picks the segment "customers who agreed to WhatsApp and bought in
   the last 90 days". Core mints `campaign.audience`, and the count shows with its source chip. An `ops.campaign` row is
   created with status `composing`.
2. **Offer.** The owner picks a published offer (one they made with `offer.create`), and core mints `offer.detail`. An
   AI draft never creates an offer (D).
3. **Copy (Spark).** An agent run (trigger `campaign`) writes Hinglish copy.
   - The model sees the offer and audience cells as handles, never ids, and puts figures in as refs.
   - The copy goes through the existing validator. On a failure the composer says "Cannot verify", and the owner writes
     the copy with "insert figure" chips; typed digits are refused there as well (§3.2).
   - **The AI-output disclosure line** is appended by code from i18n, never by the model, for example "AI की मदद से
     लिखा · <shop> ने भेजा". The composer labels the copy "Written with AI". Both come from Meta's Model API terms
     (FACT, lane A).
4. **Card.** The owner picks a photo of their own product.
   - SAM 3.1 returns a mask for one noun phrase, and code cuts the product out and composes the branded card. The offer
     figure is rendered from its cell, and demo tenants get a "Sample data" corner.
   - The card is stored as a JPEG of about 300 KB: `ops.document` (kind `card`) plus its blob.
   - **No generated image**, because Muse Image is barred in India (FACT).
   - The mask format is UNVERIFIED. If M0 finds masks unusable, the card uses the box crop; with no photo, the campaign
     is text only.
5. **Propose.** The run proposes `campaign.send`, or the owner does. The draft card shows:
   - the audience count with its source;
   - each offer figure beside its source, and the copy rendered with them;
   - the disclosure line, and the channel line "WhatsApp · sent to consenting test phones";
   - Approve and Reject.
6. **Approve** (owner). `decide()` re-checks the cells: the offer must still be in effect and the audience count
   unchanged. Then, in one transaction:
   - it re-runs `campaign.audience`;
   - for each recipient it writes one `books.outbound_message` (the rendered copy plus the disclosure line, with
     `campaign_id`) and one `ops.delivery` (`queued`);
   - it marks the campaign `approved`.
7. **Send.** The outbox flushes after commit, inside the approver's own request (Next's `after()`). Stragglers are swept
   on the owner's next page load and by a daily cron (Vercel Hobby crons run daily at most: UNVERIFIED). A gap of a few
   minutes is fine at five recipients.

### 4.2 Sender adapters (`packages/channels`, new: no provider code outside its adapter, CLAUDE.md rule 5)

| Adapter | Does | Used |
|---|---|---|
| `recorded` | stores the request and returns a fixed provider id; nothing leaves the machine | every gate (`MUNSHI_SEND_MODE=recorded`, the default) |
| `whatsapp-cloud` | `POST /{phone-number-id}/messages`: a `text` message, or an `image` message with a caption (the card's public URL) | the demo deploy, on the test number |
| `instagram` | creates a media container from the card's public JPEG URL and the caption, then publishes it | the demo deploy, to the founder's own professional account |
| `manual-link` | no network: builds a `https://wa.me/<phone>?text=…` link, which the person opens on their own phone. The delivery becomes `handed_off` | live tenants before a verified number; the booking confirmations |

Only the provider's numeric error code is stored, never its text. For example, 131049 is the per-user marketing cap: the
delivery is `failed`, with no retry for 24 hours (FACT, lane A).

### 4.3 The 24-hour window: decided at send time, not at approval

| Condition at send | Mode | Status |
|---|---|---|
| the customer's last inbound message is < 24 h old, the Cloud API is configured, and the recipient is a test phone mapped to this tenant in `WHATSAPP_TEST_PHONES` | `cloud_api`, free-form | `sent` → `delivered` / `read` / `failed` (status webhooks) |
| the window is closed | none | `needs_window`: listed in the composer ("ask them to message you first") |
| a booking confirmation, or any message on a live tenant | `manual_link` | `handed_off` |

- **No template fallback in v1.** Custom templates on the test account are UNVERIFIED (only `hello_world` is known, lane
  A), and a template's text would differ from what the owner approved.
- **For the film,** the five verified phones message the test number first, which opens their windows, and the Diwali
  campaign then goes out inside the window. The screen says so.
- **Pacing.** One message per user every six seconds (FACT, lane A). It does not bind here: a campaign sends one message
  per user.

### 4.4 The webhook: its own route

The route is `apps/web/app/api/webhooks/whatsapp/route.ts`. It reads no session cookie and makes no model call.

- **GET** (verification). It needs `hub.mode = subscribe` and a `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN`
  (timing-safe), then echoes `hub.challenge`. Anything else gets 404.
- **POST** (events):
  1. Read the raw body, capped at 256 KB.
  2. Compute HMAC-SHA256 over it with `WHATSAPP_APP_SECRET` and compare it to `X-Hub-Signature-256` (`sha256=<hex>`),
     timing-safe, **before parsing**. A missing or bad signature gets 401, and nothing is stored; only a fixed label is
     logged.
  3. **The tenant comes from the sender's phone.** `WHATSAPP_TEST_PHONES` maps each verified test phone to one tenant
     slug (`+91…=suit-shop,+91…=salon`), resolved through the directory. One number can then carry both film beats: the
     suit shop's Diwali campaign and the salon's voice note → booking. *Binding the whole number to one tenant* was
     rejected: the 24-hour window is read from one tenant's inbox, so the other shop's sends would always end
     `needs_window`. A phone belongs to one tenant at a time. `metadata.phone_number_id` must equal
     `WHATSAPP_PHONE_NUMBER_ID`, or the event is ignored.
  4. **`messages[]`.** A sender not in `WHATSAPP_TEST_PHONES` is dropped and only counted. Whether strangers can message
     a test number is UNVERIFIED; this way a stranger writes nothing either way. Otherwise:
     - insert `ops.inbound_message` in a system scope with no actor, on conflict `(provider_message_id)` do nothing;
     - set `opt_out` by stop-word match;
     - fetch audio or an image in `after()`: media id → URL → download with the token (≤ 2 MB) → `ops.document`
       (`source = 'inbound'`) plus its blob.
  5. **`statuses[]`.** Update `ops.delivery` by `provider_message_id`.
  6. Answer 200.
- **It never writes a book row and never logs a body.**

### 4.5 A voice note becomes a draft, and only a person starts it

1. The inbox shows the item: the sender (masked by role, §7.5), the time, "voice note" and its status.
2. **A person taps *Transcribe*** (an agent run, trigger `inbox`).
   - The ogg/opus file goes to Voice Transcribe. Hindi and ogg support are UNVERIFIED (lane A), and M0 decides. The
     fallback converts the file to the WAV that `voice.ts` takes today (FACT, ARCHITECTURE).
   - The transcript is stored on the inbox row (ops, erasable), and it never enters a trace (gate H3, existing).
3. **Spark extracts.** It runs the `reason` role with schema-constrained JSON, the transcript inside a `<data>` block,
   and returns the intent (booking, reply, credit or none) and each figure with its exact quote span.
   - Plain code converts the figures: rupees to paise; dates in Asia/Kolkata through the one time module.
   - The `ops.inbound_extract` trigger refuses a quote that is not in the transcript at that span.
   - `inbox.extract` then mints the figures as cells.
4. **The run proposes** one of:
   - for the salon, a `booking.confirm` draft (the services, date and window as extract cells);
   - for the kirana, a `credit.record` draft (the amount cell plus the customer's `credit.balance`; Should);
   - on any tenant, a `message.reply` draft.
5. **The approver sees** the transcript, the figures with their quotes as source chips, Approve and Reject. The English
   gloss is model text, so it passes the same validator, with figures as refs; if it fails it is hidden, never shown with
   free digits.
6. **Approval** executes under the approver.

The model is called only on a person's tap. That bounds its cost, and it keeps Meta's "no consequential actions without
human oversight" (FACT, lane A).

### 4.6 Instagram: an approved card on the founder's own professional account

- **Access.** The account has the tester role. Standard Access covers accounts with a role on the app (FACT); the
  dev-mode specifics are UNVERIFIED (lane A).
- **The draft.** `campaign.post` carries the caption (the digit rule plus the disclosure line) and the card. Approval
  writes `books.outbound_message` (`instagram`, `public`, `recipient_id` = the campaign) and an `ops.delivery` addressed
  to `INSTAGRAM_ACCOUNT_ID`.
- **The sender.** It creates the container from `image_url` = `/api/v1/media/<document id>.jpg`, which serves `card`
  documents only, as JPEG, the one format the API takes (FACT, lane A). Then it publishes, and stores the media id and
  permalink on the delivery.

### 4.7 Labels and gates

- **Labels.**
  - The channel line on every send screen, from the deployment and the mode: "WhatsApp · sent to consenting test phones"
    on the demo; "Opens your WhatsApp" for a manual link.
  - "Written with AI" on AI copy.
  - The disclosure line inside the message.
  - The tenant label from `data_class`.
- **K2:** planted recipients: one consenting, one who never consented, one who withdrew, one who sent STOP after
  consenting, one erased. Exactly one outbound row results. A consent change between proposal and approval makes the
  draft `stale`.
- **K3:** copy with a free digit is refused by the core backstop and by the agent's validator. A ref token that is not in
  `basedOn` is refused.
- **K4:** every AI-drafted body carries the disclosure line, and a source scan shows that only the i18n key writes it.
- **W1:** a missing or forged signature gets 401 and stores zero rows. Red-proof: skip the check, and the gate fails.
- **W2:** a replayed event inserts once.
- **W3:** the webhook writes no book row: row counts of every books table are unchanged across a scripted run, and a
  source scan shows it imports no command runner.
- **W4:** a stranger's number stores nothing. A stop word sets `opt_out` and drops that customer from the next audience
  read.
- **W5:** a message approved while the window was open, whose window closed before sending, ends `needs_window`, unsent.

## 5 · The developer kit (revised with the Munim tenancy report)

### 5.1 Scope for 5 Nov: what the two sites need

**Built:**
- public read routes and request routes;
- publishable site keys;
- a TypeScript SDK with no runtime dependencies;
- a docs page;
- the *Developer kit* settings page.

**Deferred,** as Munim deferred them (F):
- scoped secret keys for server-to-server developers;
- OAuth apps;
- signed webhooks out to developers;
- dated versions;
- a mock API.

The demo deploy's showcase tenant is the sandbox: real responses from synthetic data.

### 5.2 Routes (`apps/web/app/api/v1/…`, in the app's own deploy; each also answers OPTIONS)

| Route | Body or result | Writes |
|---|---|---|
| `GET /api/v1/site` | name, business type, the privacy notice URL and version, the consent text and version, intake open or paused, the release id and `publishedAt` | nothing |
| `GET /api/v1/catalogue?category=` | goods: parents with their variants (`attrs`); each price as a Figure | nothing |
| `GET /api/v1/services` | services, with duration and price as Figures | nothing |
| `GET /api/v1/packages` | plans with their lines, sessions, validity and price | nothing |
| `GET /api/v1/offers` | published offers still in effect (the release's offers, filtered by `ends_at` against the clock) | nothing |
| `POST /api/v1/booking-requests` | `{name, phone, serviceIds (≤ 3), preferredOn, timeWindow, note?, whatsappUpdates, consentVersion, noticeVersion, botToken, website}` (`website` is the honeypot) + header `Idempotency-Key` | one `ops.site_request`, plus rate counters |
| `POST /api/v1/enquiries` | `{name, phone, itemId?, message, whatsappUpdates, consentVersion, noticeVersion, botToken, website}` + `Idempotency-Key` | the same |
| `GET /api/v1/media/:id.jpg` | a card image (kind `card` only) | nothing |

- **A Figure** is `{"minor": 249900, "currency": "INR", "ref": "⟨snap:…·12·price⟩", "source": "books.price:<id>"}` for
  money and `{"value": 45, "ref": "…"}` for an integer. Every Figure is a cell of the latest release's snapshot of a
  read over the books (gate S3), so **every figure the API returns is a book row**.
- **A POST** answers `202 {"id": "<request id>", "received": true}` and never echoes a name or a phone. A filled
  honeypot gets the same 202 and stores nothing, so a bot learns nothing.

### 5.3 Releases: the public sees what a person published

- **Publishing.** `site.publish` (owner or manager) mints `site.catalogue` (one snapshot per category beyond 500 rows),
  `site.services`, `site.packages` and `site.offers` under the member's session, and writes an `ops.site_release` row.
- **Serving.** The GET routes read the latest release's cells, so anonymous traffic mints nothing. *Minting per request*
  was rejected: it lets anyone write `snap.*` rows. *Minting on every `price.set`* was rejected: it publishes without a
  person.
- **Staleness.** The app shows "Site prices are older than the books · Publish" when any price, offer or plan row is
  newer than the release.
- **Caching.** Responses carry `ETag` = the release id and `Cache-Control: public, max-age=60`.

### 5.4 The publishable key: a site bound to its tenant

- **Format.** `mpk_<slug>_<43 base64url characters from 32 random bytes>`. It is shown once, in *Settings → Developer
  kit*. Only its sha256 and a display prefix (`mpk_suit-shop_Ab3x…`) are stored: hash, prefix, revocation timestamp
  and 404, as Munim does (F).
- **Resolution.**
  1. Parse the slug and look it up in `ops.tenant_directory`.
  2. In a system scope for that tenant, select the site's unrevoked keys and compare the sha256 against each with
     `timingSafeEqual` (a tenant holds few keys).
  
  Anything unresolved returns 404 with the same body and headers as an unknown route: a malformed key, an unknown slug,
  no match, or a revoked key. The tenant is never taken from the payload.
- **Transport.** The key travels as `Authorization: Bearer mpk_…`, never in a URL, so request logs do not hold it. It is
  never logged or echoed.
- **Origins are enforced** (Munim stored them and never enforced them, F).
  - Any request with an `Origin` header must match the site's allow-list.
  - A POST must carry an allowed `Origin`; browsers always send one on a cross-origin POST.
  - A GET with no `Origin` (the site's own server render) is allowed.
  - A disallowed origin gets 404.
- **CORS.**
  - OPTIONS answers permissively: `Allow-Origin` = the request's origin; `Allow-Headers` authorization, content-type
    and idempotency-key; `Allow-Methods` GET and POST; `Max-Age` 600. It has to, because a preflight carries no key.
  - The real request is the one checked, and its response carries `Allow-Origin` only for an allowed origin.
  - Credentials are never allowed.
- **Rate limits are enforced** per IP, per key and per phone (§9).
- **Why the slug is in the key.** It names the tenant without a cross-tenant search for the secret. Munim used a
  security-definer lookup (F). Here every table forces RLS on its owner too (FACT, 0002), so that route is closed.
- **Why publishable, not secret.** The key lives in the merchant's web page. It grants only what that page can do anyway:
  read the published release and leave a request.

### 5.5 Versioning

- The version is in the path: `/api/v1`. Within v1 only additive changes are allowed (new fields, new routes).
- A breaking change becomes `/api/v2`, and the SDK's major version follows. Every response carries
  `Munshi-Api-Version: 1`.
- A retired route sends a `Sunset` header first, then answers 410.
- *Dated versions* were rejected for now: there are two consumers, and Munim deferred them too (F).

### 5.6 The SDK, the docs, the sites

**The SDK: `packages/sdk` (`@munshi/sdk`).**
- It is ESM with **no runtime dependencies** (gate: `dependencies` is empty) and uses the platform's `fetch`.
- `createClient({ baseUrl, key })` exposes `site()`, `catalogue({category})`, `services()`, `packages()`, `offers()`,
  `requestBooking(input, {idempotencyKey})` and `sendEnquiry(…)`.
- `formatMoney(figure, locale)` works in integers only, with Indian grouping.
- Errors are `MunshiError {status, code}`, with no server text.

**The contract.**
- Validation is server-side, with zod, in `packages/core/src/site-api.ts`.
- The SDK's types are written by hand. Route handlers `satisfies` the SDK's response types through a type-only import,
  and a type-level test asserts that the zod-inferred request types equal the SDK's, both ways.
- *Munim's zod → OpenAPI → openapi-fetch chain* (F) was rejected: openapi-fetch is a runtime dependency, and two
  consumers do not need generation. An `openapi.json` from `z.toJSONSchema` for the docs page is a Should.

**The docs page: `apps/web/app/developers/page.tsx`** (public, static). It covers:
- the quickstart (key, install, first call), and the routes with example responses from the demo showcase tenant;
- Figures and refs ("every figure is a book row");
- errors, rate limits, origins and CORS, and versioning;
- **what a form must show:** the privacy-notice link, a separate unticked WhatsApp box, and the version fields.

**The settings page: *Settings → Developer kit*** (MS-16b screen 6): create a key (shown once, with a copy button),
revoke it, set allowed origins, *Publish*, the snippet, and a link to the docs.

**The sites: one `apps/sites` app, built once per business.** This was the open choice, and the isolation requirement
decides it (F).
- **The build.** `MUNSHI_SITE=<slug>` at build time selects `apps/sites/businesses/<slug>/` (`profile.ts`, `theme.css`
  on `html[data-site]`, fonts, art) through a build-time alias, so a bundle holds one business.
- **Deploy projects.** One per business and environment: `suit-shop`, `suit-shop-demo`, `salon`, `salon-demo`. Each is
  bound to its tenant by the key in its env, as Munim binds a build to its tenant (F).
- **Pages.** The look is MS-16a's approved direction.
  - Catalogue pages render on the server through the SDK (revalidated every 60 s).
  - The forms post from the browser straight to the API through the SDK. That way the API sees the customer's IP for
    per-IP limits.
- **Rejected options.**
  - *Munim's same-origin rewrite proxy* (F): every customer would share the site server's IP.
  - *One slug-routed app*: every brand, and the synthetic kirana, would sit in one bundle (F, Munim's lane C fatal F1).
- **The kirana has no site.** If it ever gets one, that is its own build.

**The bundle-isolation gate runs before the second business is built.** After `next build` for business X:
1. Assert the output is newer than every source (gotcha 13).
2. Scan every emitted file (client and server chunks, static assets, source maps) for every other business's slug, name,
   profile strings and art file hashes, and for the kirana's name. Any hit fails.

Red-proof: plant an import of the other business's profile; the gate fails, and passes once it is removed. A second
gate holds that `apps/sites` imports only `@munshi/sdk` and its own files (an import-closure scan, like B1).

### 5.7 Gates S1–S8

- **S1:** a bad, unknown-slug or revoked key gets 404, identical to an unknown route (body and headers compared). The
  resolver compares with `timingSafeEqual`; a source scan finds no `===` on a hash.
- **S2:** a POST from a disallowed origin gets 404 and stores nothing; a GET with no origin gets 200.
- **S3:** every figure in every GET response resolves to a cell of the latest release from a read over the books, and
  equals the book row it names. The count is asserted positive.
- **S4:** the public routes write only `ops.site_request` and `ops.rate_counter`. Row counts of `books.*`, `snap.*`,
  `audit.*` and `approval.*` are unchanged across a scripted run.
- **S5:**
  - 413 above 4 KB; 415 for anything but JSON; 400 for unknown fields; 429 with `Retry-After` at the limit;
  - a honeypot gets 202 and stores nothing;
  - a failed bot check gets 400 `bot_check`, using the bot-check service's test keys and a recorded verifier, never the
    network.
- **S6:** an `Idempotency-Key` replay stores one row.
- **S7:** paused intake answers 503 `intake_paused` to a POST, and GETs still work.
- **S8:**
  - the SDK has no dependencies, and its types match the server's (typecheck);
  - the sites' import closure holds;
  - the bundle-isolation gate is red-proved.

## 6 · Real staff sign-in and the demo fence (revised with the Munim tenancy report)

Munim never built a real staff sign-in screen or a tenant picker; it had a demo picker only (F). Here it is a
first-class screen, and a **Must**.

### 6.1 Options for Indian shop owners

| Option | For | Against | Verdict |
|---|---|---|---|
| **Google sign-in** (OIDC) | Most Indian shop owners carry an Android phone already signed in to Google (INFERENCE; share figures UNVERIFIED), so sign-in is one tap in Chrome. Free, no SMS, and Google handles second factors and recovery | The founder must create a Google OAuth client (~20 min). A staff member with no Google account of their own is out. The consent screen in *Testing* admits only listed test users (UNVERIFIED: up to 100); publishing with basic scopes only (`openid email`) may need no verification (UNVERIFIED) | **Recommended** |
| Email magic link | No third-party identity | Needs a sender service, a key and SPF/DKIM on a domain before 5 Nov. Owners read email rarely, and a link opened in the Gmail app's own browser loses the cookie (INFERENCE) | rejected for now |
| SMS OTP | The phone number is how owners think of identity | India's DLT registration of the sender and its templates (lead time UNVERIFIED, reported as days), plus a paid SMS provider | the natural next step, not before 5 Nov |
| WhatsApp OTP | Familiar | Authentication templates need a verified business number, and the test number reaches ≤ 5 verified phones (lane A), mostly taken by test recipients | rejected |
| Passkeys | Phishing-resistant, no vendor | Enrolment still needs a first factor, and a lost device means a new invite. Unfamiliar | later, as a second factor |

### 6.2 The flow (live deploy only)

1. **Invite.**
   - The owner adds the person with a name and role (`ops.member`, under `ops.member_guard`'s rules) and their Google
     address. For the first owner, the provisioning command does this.
   - Core makes an invite: 32 random bytes, stored as sha256, valid 24 hours, single use. The link
     `https://<live>/invite/<slug>/<token>` is shown once. The owner sends it from their own WhatsApp; Munshi sends
     nothing.
2. **Accept: `/invite/<slug>/<token>` → Google.**
   - The request uses the authorization-code flow with PKCE S256 and scopes `openid email`; `state` and `nonce` ride in
     a signed cookie that lives 10 minutes.
   - The callback exchanges the code with Google's token endpoint over TLS. It checks the ID token's `iss`, `aud`, `exp`
     and `nonce`, and that `email_verified` is true. OIDC Core §3.1.3.7 lets a client rely on TLS instead of the
     signature for a token taken straight from the token endpoint; whether Google's own guidance agrees is UNVERIFIED,
     so verifying with Google's JWKS through `jose` is the fallback if review prefers it.
   - **The verified email must equal the invite's email** (Munim binds invites the same way, F). Otherwise: 404.
3. **Bind,** in one transaction as the invited member:
   - mark the invite used (`used_txid`);
   - insert `ops.member_login`, which its trigger refuses unless the invite was consumed in this transaction;
   - audit `member.login_bound`;
   - create the `ops.login_session`, and set the cookie.
4. **Later sign-ins: `/sign-in` → Google → the subject.**
   - The **memberships lookup** reads the global `ops.member_login` by subject. For each (tenant, member) it reads,
     under that tenant, the tenant's name and the member's role and active flag, and returns **id, name and role only**
     (Munim's `/v1/me/tenants` shape, F).
   - One membership goes straight in. Several show the **tenant picker**.
   - None shows "Ask your shop owner for an invite", with no hint whether the account exists anywhere.
5. **Roles come from `ops.member` rows on every request** (`openSession`), never from token claims (F).

### 6.3 Session rules

- **The cookie.** `munshi_session` v2 is `v2.<tenant>.<member>.<session>.<via>.<expires>.<HMAC>`, set HttpOnly, Secure,
  SameSite=Lax and Path=/.
  - Live sessions last 14 days, absolute: a shop phone should not re-sign in daily. Demo sessions last 12 hours, as
    today.
  - Hosted deploys take the secret from `MUNSHI_SESSION_SECRET`. Dev keeps `.run/session-secret` (FACT, `config.ts`).
- **`sessionFrom` stays the one place a Session is made.** It checks:
  - the signature (timing-safe), and the expiry;
  - that the `ops.login_session` row exists and is not revoked;
  - that the member is active;
  - the `via` rule (6.4).
- **Ending sessions.** Sign-out revokes the row. *Settings → People* lists each member's sessions, with "Sign out
  everywhere". Deactivating a member ends all their sessions at once, because `openSession` checks `active`.
- **Server actions** rely on Next's own Origin-versus-Host check (INFERENCE) plus SameSite=Lax.
- **The OAuth callback** refuses a reused `state`.

### 6.4 The fence: four layers, each red-proved

1. **Where the data lives.** Separate deploys and databases (§8), and a live tenant cannot exist in the demo database
   (`ops.tenant_class`, T1).
2. **`MUNSHI_DEPLOYMENT=demo|live`.** `demo` shows the demo picker and no Google; `live` answers 404 to the demo picker
   and its server action. The app refuses to start when the variable disagrees with the database's `ops.deployment`,
   checked on the pool's first use, like the role check `db.ts` already does (FACT).
3. **Every request, not only sign-in.** `openSession(pool, tenantId, memberId, via)` refuses `via=demo` for a live
   tenant, and `sessionFrom` passes `via` from the cookie. So a demo-minted cookie cannot act on a live tenant even
   inside one database.
4. **The picker.** It lists only directory rows whose tenant reads synthetic or showcase under its own context.

### 6.5 Size

**L**, about 1.5–2 lane-days:
- the OIDC flow and invites: 0.6;
- session v2, the session rows, revocation and deactivation: 0.4;
- the fence: 0.3;
- the gates and red-proofs: 0.5.

It is a **Must** in §11.

### 6.6 Gates F1–F6

- **F1:** a demo-minted cookie for a live tenant gives no session. Red-proof: drop the `via` check.
- **F2:** with `MUNSHI_DEPLOYMENT=live`, the demo picker's route and action answer 404. The app refuses to start when the
  variable disagrees with `ops.deployment`.
- **F3:** the picker never lists a planted live tenant.
- **F4:**
  - `ops.member_login` cannot be inserted without an invite consumed in the same transaction. Red-proof: drop the
    trigger.
  - An invite is single-use and expires.
  - A mismatched email gets 404.
- **F5:** a revoked session or a deactivated member has no session on the next request. The last active owner cannot be
  deactivated.
- **F6:** the memberships lookup returns id, name and role only, and nothing for an unbound subject.

## 7 · Real personal data: notice, consent, retention, erasure, who sees it

### 7.1 What enters, and where it lives

| Data | Enters through | Held in (ops, erasable) | What the books hold |
|---|---|---|---|
| name, phone, preferred time, note, the WhatsApp box | a site's form | `ops.site_request` | nothing until a person confirms |
| phone, text, voice note, transcript | WhatsApp (demo deploy, test phones only) | `ops.inbound_message`, `ops.document` + `ops.document_blob` | nothing until a person acts |
| name, phone | a person confirming a request or adding a customer | `ops.contact` | `books.customer.contact_id` (an id) |
| destination phone | an approved message | `ops.delivery.to_address` | `books.outbound_message`: the recipient's id and a template body |
| IP address | the public routes | a keyed hash only (§9) | nothing |

**The privacy notice** is versioned. It lives at `/privacy` on each site and in the app, and is linked beside every
submit button and from the app's sign-in and footer. It says:
- **Whose data it is and who runs the software.** The merchant (named) holds it. Munshi, run by the founder, is the
  software that processes it on the merchant's behalf.
- **What is collected and why:** to answer your request.
- **WhatsApp updates:** sent only if you tick the box; reply STOP to end them.
- **Retention (7.3), and erasure:** ask the shop, and the shop erases it in Munshi.
- **AI:** staff may use AI to draft replies, and the AI is given ids and counts, not your phone (7.4). On the demo deploy
  only, voice notes from test phones are transcribed by Meta's models, with Standard model ids, not Contributor ones
  (FACT, lane A).
- **Payments:** none are taken here.

Meta's Model API terms require both a privacy policy and an AI-output disclosure (FACT, lane A). DPDP's duties phase in
around May 2027 (FACT per law-firm summaries, lane B); this follows them now as practice. The founder reviews the
wording; this is not legal advice.

### 7.2 Consent on the forms

- **The box.** It is separate, unticked by default, and has its own label: "Send me updates and offers from <shop> on
  WhatsApp". The booking needs no tick, because the request is the person asking to be contacted about it, and those
  service messages need no marketing consent.
- **What the form sends.** `consentVersion` and `noticeVersion`, which the request row keeps.
- **A ticked box enters the books only through a person.** `booking.confirm` writes a `books.customer_consent` row
  (`whatsapp`, `marketing`, `source = 'site_form'`, evidence = the request). An unticked box writes nothing.
- **Withdrawal.**
  - STOP on WhatsApp takes effect at once, read-side (§3.5), and a person records it with `consent.record`
    (`granted = false`).
  - At the counter, withdrawal is `consent.record` too.

### 7.3 Retention and erasure (proposal: the founder sets the numbers)

| Data | Kept | Then |
|---|---|---|
| `site_request` name, phone, note | 90 days after it is handled; 30 days if never handled; 7 days if spam; **7 days for everything on the demo deploy** | set to NULL by the daily purge; the row stays, for counts |
| inbound text, transcript, media | 30 days after handled; audio 7 days after transcription. An `opt_out` row is kept until a withdrawal row follows it (§3.5) | set to NULL; blob bytes set to NULL |
| `delivery.to_address` | 30 days after the final status | set to NULL |
| rate counters | 1 day | deleted |
| `ops.contact` | while the customer relationship lasts | erased on request. A watcher raises a finding after 24 months with no activity and no open balance, and a person erases |
| books (sales, credit, packages, consent, messages) | as accounting records; they hold no personal data | never; they hold ids |

The purge touches ops only, never a book row, so it needs no approval. It runs on the daily cron in a system scope and
records `erase_reason = 'retention'`.

**Erasure on request** (`contact.erase`; owner only; the demo deny-list refuses it on demo tenants):
- **Refused while the customer owes credit or holds an unexpired package balance** ("settle first"). This is a legal or
  contractual ground to keep the record (INFERENCE; the founder confirms).
- **One transaction:**
  - the contact's name and phone become NULL, and `erased_at`, `erased_by` and `erase_reason` are set;
  - every `ops.site_request`, `ops.inbound_message` (and its media blobs) and `ops.delivery` with that phone has its
    personal columns set to NULL;
  - the audit entry `contact.erase` carries `{contact_id}`.
- **What remains:**
  - book rows that name the customer by id: sales, credit history, consent history, package and loyalty entries, and
    outbound messages whose bodies are fixed templates;
  - the audit chain, intact: no personal data was ever in it for a vault-backed customer;
  - the erased contact row. Screens show "Erased customer · C-1a2b".
- **What erasure cannot reach:**
  - names written to `books.customer` before this change. These exist only on synthetic and showcase tenants: invented
    people, and the PII1 trigger keeps live tenants free of them.
  - a message staff sent from their own WhatsApp app, outside Munshi.
- **On a live tenant, messages to customers use fixed templates only,** with no personal data (a booking confirmation
  names the service, the date and the shop). Free-text replies on live tenants wait for a follow-up that keeps the body
  in ops and only its sha256 in the book row. That comes after the hackathon, when a verified number makes such replies
  possible at all.

**Gate E1:** after erasure, the phone and the name appear in no column of any table of that tenant (every text, jsonb
and bytea column is scanned). The positive control is the same scan finding both before erasure. Erasure is refused
while a credit balance is open.

### 7.4 The agent sees ids and counts only

- The agent role gets **no grant on any new table** (G1 over the manifest).
- `agent_view.customer` shows `books.customer.name`, which is NULL for every vault-backed customer.
- **No named read puts personal data into a snapshot cell:** no contact name or phone, no request note, no inbound text
  or quote. The agent role can read every cell of its tenant (FACT, 0003), so screens fetch names through a plain core
  read and show them beside the cells. Gate PII2 scans the cells.
- **The existing reads keep their `customer` column, and it is NULL for a vault-backed customer.** Those reads are
  `credit.balance`, `credit.balances`, `watch.overdue_credit` and `sale.receipt` (FACT, `c.name as customer` in
  `queries*.ts`). `toCell` stores NULL as a `null` cell (FACT, `snapshots.ts`). Each read is keyed by `customer_id` or
  `line_no`, never by name, so two unnamed customers cannot collide in one finding's dedupe key (FACT, `key:
  ['customer_id']`). The screens that show these names (credit book, receipt, overdue card) take the name from
  `people.ts` by id. That is MS-24's core function and MS-30's screen work (§11).
- The model sees a transcript only when a person taps *Transcribe*, inside a `<data>` block, and only on the demo deploy.
  Transcripts never enter traces (H3).

### 7.5 Who sees what

| Who | Name | Phone | Request note, inbound text | Confirm | Erase |
|---|---|---|---|---|---|
| owner | yes | full | yes | yes | yes |
| manager | yes | full | yes | yes | no |
| staff | yes | last four digits (`•••• 1234`) | yes | no (decline only) | no |
| agent | no (an id) | no | no | no | no |

- **Masking happens in core's read functions,** which take the session. *A masking view in the database* was rejected:
  the app role reads the base table either way, so it would add a layer without adding a boundary.
- **On the demo deploy every screen masks phones for everyone,** so film and screenshots cannot show a test phone.
- **Gate V1:** a staff session's request list and customer page render no full phone (the HTML is scanned).

## 8 · Keeping real data out of the submission: two deploys

### 8.1 Decision: two deploys on two databases

| | Demo deploy | Live deploy |
|---|---|---|
| Database | its own Neon project | its own Neon project |
| `ops.deployment` | `demo` | `live` |
| Tenants | kirana (synthetic); suit shop and salon (showcase) | the two merchants (live) |
| Sign-in | the demo picker | Google + invites |
| WhatsApp webhook | yes: the test number and its ≤ 5 verified, consenting phones | none until a verified merchant number |
| Sites | `<slug>-demo` builds, with the "Sample data" ribbon | `<slug>` builds: real catalogue, real requests |
| Who sees it | judges, the film, screenshots, the README | the merchants, their staff, their customers |

**Why two deploys.**
- **Separation is physical.** No query, bug or env-variable slip in the demo can reach a real customer.
- **The judges keep their passwordless picker,** with nothing real behind it.
- **Meta's perpetual licence** over the submitted materials (FACT, the rules via the synthesis) never touches a real
  customer.
- **The live deploy can change on the merchants' timetable** after 5 Nov.

*One deploy with fencing* was rejected. A single wrong variable, or one bug in the picker, would sit one step away from
real phones, and the film's guarantee would rest on code paths instead of on where the data is.

**Two Neon projects, not two databases in one cluster.** `0001` creates the roles cluster-wide (FACT, `create role` in
0001), so two databases in one cluster would collide on role names. Neon branches, each with its own roles, are the
fallback if a second project is not free; the free tier's project count is UNVERIFIED.

**Vercel: two app projects plus four site projects.** The Hobby plan is for non-commercial use (UNVERIFIED this
session), and the live deploy serves two businesses, so it probably needs a paid plan. That is a money decision for the
founder (§12).

### 8.2 What the submission holds

- The demo URL and the repo. The repo carries the merchants' catalogue and photos under signed permission, plus invented
  customers, and never a real customer's data.
- The film and the screenshots.
- Whether the live sites are named in the submission as "the merchants' own sites" (public pages showing their own
  catalogue) is the founder's call (§12). Their data never appears in it.

### 8.3 How the film and screenshots are held to synthetic tenants

1. **Captured only from the demo deploy,** whose database refuses live tenants (T1).
2. **Every page renders `<html data-class="…">`** from the tenant row, and the label is on screen.
3. **The capture scripts check first.** They cover screenshots, film capture and the smoke scripts, beginning with
   `scripts/hero-smoke.ts`.
   - Before capturing, each GETs `/api/health`, which returns `deployment` only, and refuses unless it says `demo`.
   - After each capture it reads `data-class` from the page and fails on `live`, or on a missing value.
   - It holds an allow-list of the three demo slugs; any other slug fails.
4. **Phones are masked on every demo screen** (7.5).

Red-proof: point a capture at a page carrying `data-class="live"`, and the script exits non-zero.

## 9 · Abuse protection on the public forms

### Rate limits (proposal)

| Limit | Value |
|---|---|
| per IP | 5 POSTs per 10 minutes; 120 GETs per minute |
| per key | 300 POSTs and 20,000 GETs per day |
| per phone | 3 open requests per site |
| per tenant | 500 stored requests per day; beyond that 429, and the owner sees the count |

- **Held in `ops.rate_counter`**, one statement per hit (`insert … on conflict do update set hits = hits + 1 returning
  hits`), so the limits hold across Vercel instances.
  - *In-memory counters* were rejected: each instance counts alone.
  - *Vercel's firewall rules alone* were rejected: they depend on the plan (UNVERIFIED).
- **The IP** is read from the header Vercel's edge sets (`x-real-ip` / `x-forwarded-for`; how well it resists spoofing
  is UNVERIFIED), hashed with HMAC-SHA256 under `MUNSHI_RATE_SECRET` and cut to 16 bytes. The raw IP is never stored or
  logged.

### Bot check

**Cloudflare Turnstile** runs on both forms. Its free tier and its published always-pass and always-fail test keys are
UNVERIFIED this session.
- The API verifies the token server-side with `TURNSTILE_SECRET_KEY` before it stores anything.
- Gates use the test keys and a recorded verifier, never the network.
- A honeypot field (`website`) is added; when it is filled the request gets 202 and nothing is stored.
- *reCAPTCHA* was rejected: it is heavier, and it would bring Google tracking onto the merchants' sites.

### Size and shape limits

- **The body** is at most 4 KB: `Content-Length` is checked first, then the read is capped before parsing. JSON only
  (otherwise 415).
- **Schemas are strict:** an unknown field gets 400.
- **Field limits:**
  - name ≤ 80 characters; note or message ≤ 500; at most 3 item ids;
  - the phone is normalised to E.164 and must be `+91` followed by [6-9] and 9 digits (India only in v1);
  - the date must fall between today and 60 days ahead;
  - text is NFKC-normalised, with control characters stripped.

### No raw user text in traces or logs

- The public routes start no agent run and write no `ops.run_trace`.
- Logging goes through one helper, `publicLog(label, ids)`, whose labels come from a fixed list, like `TRACE_LABELS`.
  A source scan fails on any `console.` under `app/api/v1/**` and in the webhook route.
- Errors leave as `CoreError` codes (the gate C2 pattern).
- URLs carry no personal data and no key (POST bodies and headers only), so Vercel's request logs hold none.

### Owner controls

- **The kill switch:** *Pause requests* sets `ops.site.intake = 'paused'`. POSTs then get 503, and the site shows "Call
  or WhatsApp us instead".
- **Double submits:** an `Idempotency-Key` per form render; the SDK makes one.
- **Spam:** staff mark a request spam, and it is purged after 7 days.

## 10 · Environment names the build needs

This is a proposal only. No lane edits the founder's `.env.example`; the founder adds these names. Gates need none of
them: they run on embedded Postgres, with recorded models and the recorded sender.

**Already named** (FACT: `.env.example`, `deploy/neon.md`): `DATABASE_URL`, `AGENT_DATABASE_URL`,
`MIGRATOR_DATABASE_URL`, `ADMIN_DATABASE_URL`, `META_MODEL_API_KEY`, `MUNSHI_MODEL_MODE`, `MUNSHI_EDITION`. The last
three of the database URLs are not yet in `.env.example` (FACT, neon.md).

| New name | Where | Purpose |
|---|---|---|
| `MUNSHI_DEPLOYMENT` | both app deploys | `demo` or `live`; must equal `ops.deployment` (§6.4) |
| `MUNSHI_PUBLIC_URL` | both app deploys | the app's https origin: the OAuth redirect, invite links, card URLs |
| `MUNSHI_SESSION_SECRET` | hosted app deploys | 32 bytes of hex. Dev keeps `.run/session-secret`, which does not exist on Vercel |
| `MUNSHI_RATE_SECRET` | both app deploys | the HMAC key for hashed IPs and phones in rate buckets |
| `CRON_SECRET` | both app deploys | authenticates Vercel's cron calls (Vercel's own convention name, UNVERIFIED) |
| `MUNSHI_SEND_MODE` | both app deploys | `recorded` (default) or `live` |
| `TURNSTILE_SECRET_KEY` | both app deploys | the server-side bot-check verification |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | live app | staff sign-in |
| `WHATSAPP_ACCESS_TOKEN` | demo app | the permanent system-user token |
| `WHATSAPP_PHONE_NUMBER_ID` | demo app | the test number's id; the webhook ignores any other |
| `WHATSAPP_APP_SECRET` | demo app | checks `X-Hub-Signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | demo app | the webhook's GET handshake |
| `WHATSAPP_TEST_PHONES` | demo app | each verified test phone mapped to its tenant's slug (`+91…=suit-shop,+91…=salon`). Any other sender is dropped. These are real numbers: treat them as secret |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID` | demo app | posting an approved card to the founder's professional account |
| `MUNSHI_SITE` | each site project (build time) | the business slug the build bundles |
| `MUNSHI_API_BASE` | each site project | the matching app deploy's origin |
| `NEXT_PUBLIC_MUNSHI_SITE_KEY` | each site project | the publishable key (public by design) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | each site project | the bot-check widget |

The "Sample data" ribbon on a site takes no variable: it comes from `GET /api/v1/site`, which returns the label of the
tenant's `data_class`. Labels come from data, never hard-coded (F).

## 11 · Ticket split for W5-B and W5-C

**Sizes:** S ≤ ½ lane-day, M ≈ 1, L ≈ 2. **Territories never overlap.** `commands.ts`, `queries.ts` and `approvals.ts`
are touched once, by the MS-22a pre-step, and after that each lane owns its own `commands-<area>.ts` and
`queries-<area>.ts`.

**Every ticket's done-when** includes `pnpm check` green, `pnpm redproof` green with that ticket's new gates
red-then-green in its report, a failing run exiting non-zero (G8), and the kirana suite unchanged. An Opus guarantee
review (read-only) runs after the migrations and again after the core lanes, each allowing ≤ 2 fix cycles.

### W5-B (after the founder signs off the looks, MS-16a and MS-16b, and this design)

| Ticket | Model | Size | Must? | Territory | Depends on | Done when (beyond the common line) |
|---|---|---|---|---|---|---|
| **MS-22a** Registry split and draft hooks | Sonnet | S | Must, first | `packages/core/src/{commands.ts, queries.ts, approvals.ts}`; new empty `commands-{people,packages,messaging,grid}.ts` and `queries-{offers,people,packages,campaigns,sites,grid}.ts`; `customer.create` moved unchanged into `commands-people.ts`; `packages/core/test/hooks.test.ts` | none | A command whose `checks` returns a bad path is refused at proposal and stale at approval (red-proof: remove the call). A money draft naming a `holdingId` without a `package.balance` cell is refused. `runCommand` refuses every `draftOnly` command (red-proof: drop the flag). Every existing gate is unchanged |
| **MS-19a** Migrations 0010–0013 | Opus (migrator) | M | Must | `db/migrations/0010–0013`, `manifest.json`, `db/test/{tenancy,people,sign-in}*.test.ts`, the sabotage entries, `docs/SCHEMA.md` | none | T1–T3, PII1, the database parts of F4 and F5, the `ops.only_erase` red-proof. The G1, G4, G9 and G10 counts rise by exactly the manifest's new entries |
| **MS-19b** Migrations 0014–0018 | Opus (migrator) | L | Must (0018 Should) | `db/migrations/0014–0018`, `manifest.json`, `db/test/{offers,packages,messaging,sites,grid}*.test.ts`, `docs/SCHEMA.md` | MS-19a | L1 and L2; P2's database part; `MS009` and `MS011`; the extract trigger; one-way key revocation; the localhost-origin trigger |
| **MS-20** Business registry, provisioning, seeds, reseed rule | Opus | M | Must | `packages/core/src/{business.ts, tenancy.ts, watchers.ts}`, `apps/web/lib/{business.ts, nav.ts}`, new `apps/web/lib/i18n-<type>.ts`, `db/src/{provision.ts, reset-demo.ts, dev.ts}`, `db/seed/{suit-shop.ts, salon.ts, merchants/**}`, `db/test/business*.test.ts` | MS-19a | The totality test; the type-literal scan; reseed and reset refuse a planted live tenant (red-proof); `provision` is idempotent (a second run adds no row); `listDemoTenants()` never returns a live tenant (F3) |
| **MS-21** Real sign-in and the fence | Opus | **L** | **Must** | `apps/web/app/{sign-in,invite,auth,settings/people}/**`, `apps/web/lib/server/{session.ts, config.ts, db.ts}`, `packages/core/src/{session.ts, members.ts, logins.ts}`, `apps/web/test/sign-in*.test.ts`, `db/test/fence*.test.ts` | MS-19a, MS-20 (`listDemoTenants`) | F1–F6. The Google exchange sits behind an adapter with a recorded fake, so no gate calls Google. Screenshots at 390 and 1280 of sign-in, the picker, the invite, "ask for an invite" and people with their sessions |
| **MS-24** People: contacts, consent, requests, erasure, retention | Opus | M | Must | `packages/core/src/{commands-people.ts, queries-people.ts, people.ts, retention.ts}`, `db/test/people*.test.ts` | MS-22a, MS-19a, 0017 | PII2, E1, K1, the core part of V1, and the retention purge. `booking.confirm` writes consent only when the box was ticked. The demo deny-list refuses erasure on demo tenants |
| **MS-22** The counter's money: services, variants, offers, discounts, loyalty, package lines | Opus | L | Must (loyalty Should) | `packages/core/src/{commands.ts, queries-offers.ts, money.ts}`, `db/test/counter*.test.ts` | MS-22a, MS-19b (0014, 0015) | I1–I3, O1, O2, L1, P3, and P1's sale half. The quote equals the sale to the paisa, and every new journal balances |
| **MS-23** Packages: plans, redemption, expiry | Opus | M | Must | `packages/core/src/{commands-packages.ts, queries-packages.ts}`, `db/test/packages-core*.test.ts` | MS-22 | P1, P2, P4. The expiry draft goes stale after a redemption (red-proof: drop `holdingId` from `CURRENT`) |
| **MS-25** Messaging: campaigns, outbox, senders, webhook, inbox | Opus | L | Must (Instagram Should) | `packages/channels/**`, `packages/core/src/{commands-messaging.ts, queries-campaigns.ts, outbox.ts, inbox.ts}`, `apps/web/app/api/{webhooks,cron}/**`, their tests | MS-22a, MS-19b (0016), MS-24 (contacts) | K2, K3, W1–W5. Gates use only the recorded sender. The outbox flushes after commit and is swept by cron |
| **MS-26** Agent: campaign copy, voice note → draft, desks by type, the expiry recipe | Opus | M | Must | `packages/agent/**` and its tests and fixtures | MS-25 (inbox), MS-23 (expiry read) | Copy carries refs only, and a free digit abstains. K4. Every extract quote is in its transcript. A transcript never reaches a trace (H3 extended). The desks pass the totality test |
| **MS-28** Developer kit: `/api/v1`, keys, releases, intake, limits, SDK, docs | Opus | L | Must | `apps/web/app/api/{v1,health}/**`, `apps/web/app/developers/**`, `packages/core/src/{site.ts, site-api.ts, queries-sites.ts, rate.ts}`, `packages/sdk/**`, `db/test/site*.test.ts`, `apps/web/test/api-v1*.test.ts` | MS-22a, MS-19b (0017), MS-24 | S1–S7, and S8's SDK half |
| **MS-29** The merchant sites | Sonnet | L | Must | `apps/sites/**` | the MS-16a sign-off, MS-28's SDK | Both businesses build. The bundle-isolation gate and the import closure are red-proved. Screenshots of every page at 390 and 1280 for each build (demo ribbon and live). The forms post through the SDK to a local API. Inputs ≥ 16 px, targets ≥ 48 px, contrast ≥ 4.5:1 |
| **MS-30** App screens: requests, campaigns, inbox, packages, offers, counter changes, customer names from `people.ts`, *Developer kit* settings, privacy | Sonnet | L | Must (loyalty screens Should) | `apps/web/app/{requests,campaigns,inbox,packages,offers,counter,credit,settings/developer,privacy}/**`, new `apps/web/components/*` and `apps/web/lib/server/*` files for them, plus the existing `lib/server/{credit,counter,home}.ts` for the name lookup | the MS-16b sign-off; MS-22–MS-28 | Every state in MS-16b's specs screenshotted at 390 and 1280. V1. Labels from `data_class`. Each AI surface's "Cannot verify" and hidden states. A vault-backed customer's name shows on the credit book, the receipt and the overdue card, and an erased one shows "Erased customer" |
| **MS-27** `grid.apply` | Sonnet | M | Should | `packages/core/src/{commands-grid.ts, queries-grid.ts}`, `apps/web/app/stock/table/**`, `apps/web/lib/grid/submit.ts` | MS-18, MS-19b (0018) | GR1–GR4 |
| **MS-33** Two deploys, hosted demo reset, capture guard | Sonnet | M | Must | `deploy/**`, `docs/DEPLOY.md`, `scripts/{deploy-check.ts, capture-guard.ts}`, `db/src/deploy-check.ts`, `vercel.json` per project | MS-20 | `deploy-check` refuses a demo URL whose database says `live`, and the reverse. The capture-guard red-proof (8.3). A dry run of `provision --class live` on embedded Postgres with `deployment = live` |

**Parallel plan.**
1. MS-22a and MS-19a run first.
2. Then MS-20, MS-24 and MS-19b.
3. Then MS-21, MS-22, MS-25 and MS-28.
4. Then MS-23, MS-26, MS-29 and MS-33.
5. MS-30 runs last, after the founder's look sign-off. MS-27 runs whenever MS-18 has landed.

### W5-C (with the Meta key)

| Ticket | Model | Size | Must? | What it does |
|---|---|---|---|---|
| **MS-31** M0 smoke | Opus | S | Must | Spark tool call; SAM 3.1 on a real rack photo and on a product photo (records the mask format); Voice Transcribe on a Hindi ogg/opus clip. Go or no-go for the cut-out cards and the voice beat |
| **MS-32** Campaign cards | Opus | M | Must if M0 says go | A SAM mask → a cut-out → a branded JPEG card (an image library chosen at M0). Fallbacks: a box crop, then text only |
| **MS-34** Live channels on the test number | founder + Sonnet | S | Must | Webhook live, five phones verified, a campaign inside their windows, an Instagram post (Should) |
| **MS-35** Live re-record and the corpus | Sonnet | M | Must | Fixtures re-recorded from live models, the precision corpus re-run |
| **MS-36** Live go-live for the two merchants | founder + Sonnet | S | Must | `provision --class live` for both; owners accept invites; keys and origins set; sites published; one real test request each, from the founder's own phone, then erased |
| README, `SCHEMA.md` and `ARCHITECTURE.md` updates; the film re-cut | Sonnet; founder | S | Must | |

### Capacity, honestly

| | Lane-days |
|---|---|
| W5-B | ≈ 22.75 |
| W5-C | ≈ 3.5 |
| Guarantee reviews and fix cycles (~30%) | ≈ 8 |
| **Total** | **≈ 34** |

The synthesis called about 14 safe in the time left. Parallel lanes shorten the calendar, but founder sign-offs, the
orchestrator's reviews and spend do not run in parallel. **It does not fit.**

**Cut order** (first to fall):
1. `grid.apply` (MS-27);
2. loyalty;
3. Instagram;
4. the voice-note → udhaar draft for the kirana;
5. the package-expiry *draft* (keep the watcher's finding);
6. SAM cut-out cards (a text campaign instead);
7. the docs page beyond its quickstart.

**What cannot fall without breaking D-037 and the 28 Oct scope change:** real sign-in, the people/consent/erasure work,
the developer kit API and SDK, the live sites, the two deploys, the registry and seeds, packages, offers, and campaigns
on WhatsApp.

## 12 · Open questions for the founder

1. **Money.** The live deploy is commercial use: Vercel's Hobby plan likely does not cover it (UNVERIFIED), and a
   second Neon project may cost. Turnstile and a Google OAuth client are free (UNVERIFIED).
2. **AI on live tenants by 5 Nov.** The proposal is **off** (AI surfaces hidden, the existing degrade-to-hidden rule)
   until the privacy notice and each merchant's agreement cover sending their books' cells to Meta's Model API. The demo
   deploy keeps every AI beat.
3. **Retention periods** (7.3), and refusing erasure while credit or a package balance is open. Both are legal judgement,
   not engineering.
4. **Roles.** `booking.confirm` is owner and manager here; a salon receptionist may be staff. `campaign.send` is owner
   only.
5. **Whether the submission names the merchants' live sites** (public pages showing their own catalogue).
6. **GST stays unmodelled,** as today. Site and counter prices are as the merchant enters them. Each merchant's GST
   status is still open (D-037), and a composition dealer needs a bill-of-supply mode (lane B).
7. **For the orchestrator:**
   - relaxing `books.customer.name` NOT NULL (0012);
   - the one DELETE grant (`ops.rate_counter`);
   - India-only phone validation;
   - one site per tenant in v1;
   - staff without a Google account cannot sign in in v1.
8. **Whether the suit shop sells fabric by the metre,** which would add a unit `m` in 0011. UNVERIFIED need.

*What this document does not decide:* screen layouts (MS-16a and MS-16b, awaiting the founder's choice), the card image
library (M0), and the wording of the privacy notice (the founder's review).
