# Merchants design: the schema from 0010, the developer kit, real sign-in (MS-17)

Status: **PROPOSED, design only (28 Oct 2026).** Nothing here is built. The orchestrator and the founder review it before
any migration. Once built, the code wins over this page (`db/migrations/*.sql` is the contract). Tags: FACT (read in this
repo or in research lanes A–E, `../hackathon/meta-ai-developer-hackathon/research-2026-10-28/`), INFERENCE, UNVERIFIED.

§1, §5 and the sign-in and fence parts of §6 were drafted "pending the Munim tenancy report", then revised against it
(`research-2026-10-28/F-munim-tenancy.md`, lane F). Munim is a design reference only. Nothing here copies its text or code.

**Fix cycle 1 (28 Oct).** This revision applies the founder's four answers (A1–A4) and the guarantee review's findings
(B1–B8, rank 2 #9–#14, rank 3) in place. Where each landed:

| Item | Where |
|---|---|
| A1 free tiers only | §8.1, §4.1 step 7, 0016 media caps, §12 |
| A2 AI on for live tenants | §7.1, §7.4 (gate AI1), §12 |
| A3 retention defaults | §7.3 |
| A4 live sites linked; judges may send test requests | §5.2, §8.2, §9 |
| B1 staff personal data in the chain | 0010 (`member_audit`, moved in fix 2), 0013, 0012 (`books.staff`), §7.6 |
| B2 customers' words in permanent rows | 0016 (`ops.message_text`, extract offsets), 0019 (reason codes), §2.0 (`only_erase`), §3.2 |
| B3 the passwordless demo reaching real people | §4.3, §4.4, §5.6, §6.4, §8.1 |
| B4 the outbox | 0016 (`ops.delivery`), §4.1, §4.3 |
| B5 one number detector | §3.2, MS-22b |
| B6 draft-only commands in the database | 0018 |
| B7 reset as `munshi_owner` | §1.4 |
| B8 releases name only site reads | 0017 |
| #9 media route slug | §5.2 |
| #10 whole-audience recheck | §3.2, §4.1 |
| #11 deactivation lock | 0013 |
| #12 `login_session` trigger | 0013, §6.4 |
| #13 versions and double opt-in | §5.2, §7.2 |
| #14 the PII trigger covers showcase | 0012 |
| Rank 3 | §1.1 (slugs public), 0010 (`ops.deployment` immutable), 0017 (expired-window DELETE), §9 (Turnstile hostname), §2.0 (G9, G13) |

**Fix cycle 2 (28 Oct), the verification review:**

| Finding | Where |
|---|---|
| 1 fill-once let a value be swapped | §2.0: `only_erase` nulls only with `erased_at` and freezes the row; `fill_once` with a stamp; identity columns never filled; gate OE1 |
| 2 the capture guard contradicted itself | §8.3: two modes, a site marker only `apps/sites` renders, app origins refused |
| 3 "no PII reaches Meta" over-claimed | §7.1 notice and agreement say what reaches Meta; §7.4 PII2 scope; "[phone]" redaction |
| 4 rank 3 | 0017 (demo trigger pins name, phone, note); 0016 (campaign copy by `text_id`; test sends without a book row); 0010 (`member_audit` replaced there); §4.3 |
| 5 extract values held only by core | 0016: the database parses digit spans; words and dates are a stated residual under gate EX2 |

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
   wrong env var would put real customers on a public demo with a passwordless sign-in. Everything runs on free plans
   (founder, A1). **No real channel touches the demo:** it always uses the recorded sender, its site forms store sample
   values only, and the WhatsApp webhook and Instagram live on the live deploy (B3).
2. **`ops.tenant.data_class` = `synthetic | showcase | live`** (§1). It is immutable and set only by the operator
   provisioning command. It drives the on-screen label, the demo sign-in, the demo deny-list and the reseed refusal. It
   replaces today's `name.endsWith('(synthetic)')` check, which a showcase tenant's real name would fail.
3. **A global `ops.tenant_directory` (slug → tenant)** and a global `ops.member_login` (Google subject → memberships)
   (§1, §6). Forced RLS hides every other tenant, so these two global, read-mostly tables are how a sign-in, a site key
   and the webhook find their tenant before any tenant context exists.
4. **Real people's names, phones and words never enter a permanent row** (§7). That covers customers and staff, the
   books, the audit chain, draft payloads and decision reasons. People live in an erasable `ops.contact` vault, and
   `books.customer` and `books.staff` point at it by id; a trigger enforces this for showcase and live tenants. Free text
   lives in erasable `ops.message_text` rows, and books keep only its hash. Reasons are codes. Reason:
   `books.audit_row` and `ops.member_audit` hash `to_jsonb(new)` into the chain (FACT, 0005, 0007), so anything
   personal written there could never be erased.
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
13. **The webhook only stores, and only on the live deploy** (§4). It checks the signature, normalises the sender to
    E.164, writes an ops inbox row, makes no model call and writes no book row. A person taps *Transcribe*. The model
    returns quote spans only; **code** parses each figure from its span.
14. **No blob vendor** (§2, 0016). Voice notes and campaign cards are small and live in Postgres (`bytea`, capped per
    file and per tenant, purged early: free-tier storage). Instagram fetches a card from a public app route.
15. **Ops-only actions** (erase, publish, keys, invites, deactivation, booking decline, request erase) stay out of
    `ops.command_authority`. Gate G3 requires every held command to write a book table. Their role checks live in core,
    plus a DB trigger where the action is irreversible. **Draft-only commands are refused as direct commands by the
    guard itself** (0018: `ops.draft_only` and a replaced `books.guard()`), and the dormant `message.send` is retired.
16. **A small pre-step, MS-22a** (§11), makes the command and named-read registries composable, one file per lane, so
    the W5-B lanes never share a file.
17. **Capacity does not fit** (§11). W5-B and W5-C come to about 28 lane-days before review overhead (~37 with it), against the ~14
    the synthesis called safe. The cut order is in §11.
18. **The outbox is derived, claimed and rechecked** (0016). A trigger creates each delivery from its message, and the
    caller can choose nothing. A send first claims the row (`queued → sending`), then rechecks consent, STOP, the offer
    and the window. It sends at most once.

## 1 · Business type and tenancy (revised with the Munim tenancy report)

### 1.1 What a business is

- **Tenant** is the only isolation unit. That holds today: `tenant_id` leads every key and RLS is forced (FACT, 0002).
  New live tenants get a **UUIDv7** id, which is time-ordered (Munim's choice, F). Core generates it, rather than
  assuming Postgres 18's `uuidv7()` on Neon (`deploy/neon.md` asks only for 17 or newer). Seeded tenants get a **deterministic
  id derived from their slug**, so a reseed keeps the id and the recorded fixtures stay valid. Existing v4 ids remain
  valid, since a `uuid` column takes any version.
- **Slug** is a unique human name (`sharma-kirana`, `suit-shop`, `elite`). It is **public, not a secret**: it appears
  in site keys, invite links and media URLs, and it proves nothing on its own. It is held in the global
  `ops.tenant_directory`
  (0010). It is immutable. Munim had none, and it hurt (F).
- **Shop** is the outlet. It already exists as `ops.shop`, and a one-shop business has one row. A site, a booking
  request and a sale each name their shop.
  - **Elite Unisex Salon & Academy** (the real salon; Instagram `@elitesalon30`; "Luxury You Deserve") is **one tenant,
    slug `elite`, with two shops: Kirti Nagar and Kalkaji** (New Delhi). It has one public site, and its booking form
    picks the branch, which becomes `site_request.shop_id`.
  - **Packages and loyalty are tenant-wide.** One customer base visits either branch, and the liability belongs to the
    business. Each entry records the branch that used it (0015).
  - **Staff are tenant-wide in v1.** Scoping a member to a branch would mean filtering every read and command by shop,
    and nothing does that today. It is not cheap. The counter already stamps each sale with its shop, so branch reports
    work without it.
  - The suit shop's name is still pending (slug `suit-shop`).
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
| Seed | `db/seed/<slug>.ts` | `kirana.ts` (unchanged) | `suit-shop.ts` | `elite.ts` (two shops) |

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

**How a reset works as `munshi_owner` (B7).** Today's check (`dev.ts` L115) reads `ops.tenant` and then truncates. That
works only as a superuser. As `munshi_owner`, the hosted login, forced RLS returns zero tenants, so the check passes
vacuously, and TRUNCATE wipes every tenant, so a showcase-only reset cannot exist. The new path:
1. Read the global `ops.tenant_directory`.
2. For each tenant asked for, check `data_class` under that tenant's own context (`SET LOCAL munshi.tenant_id`). Refuse
   the whole run if any is `live`, if a tenant has no directory row, or if `ops.deployment` is `live`.
3. In one transaction as the owner, run `ALTER TABLE … DISABLE TRIGGER USER` on the affected tables. That turns off
   guard, audit, txn and tally. FK triggers stay on, because disabling them needs a superuser, so children go first. Delete that
   tenant's rows, children first, with `WHERE tenant_id = $1`, never TRUNCATE. Re-enable the triggers before commit.
   DDL is transactional, so other sessions wait on the lock and never see the triggers off.
4. Re-provision and re-seed through the normal paths, and publish the showcase site's first release.

Gate T3 runs as `munshi_owner`, not as a superuser:
- a planted live tenant makes the run refuse, with every table's row count unchanged;
- a showcase-only reset leaves the other tenants' row counts unchanged.

Red-proof: replace the per-tenant check with the old `select … from ops.tenant`, and T3 goes red.

**How "refuses non-synthetic tenants" (the ticket) is read here.** By default reseed rebuilds `synthetic` tenants only.
A `showcase` tenant is rebuilt only when named explicitly (`--showcase <slug>`), because its data is reproducible from
committed seed files. A `live` tenant is refused always, with or without a flag. The orchestrator should confirm this
reading.

### 1.5 The multi-tenant dev seed, the demo picker, the demo deny-list

- **Seed.** `pnpm dev` and `pnpm reseed` provision three tenants: the kirana (synthetic), the suit shop (showcase) and
  Elite (showcase, with its two branches). The directory replaces `.run/demo-tenant`.
- **Demo sign-in** (`/sign-in`, demo deploy only, while `MUNSHI_DEPLOYMENT=demo`):
  - On the live deploy the route returns 404.
  - The screen shows shop cards (name and label), then the chosen shop's active members. It lists directory rows and,
    per tenant, reads `data_class` under that tenant (system scope). Anything not synthetic or showcase is dropped.
  - The cookie records `via=demo`, and `sessionFrom` refuses that cookie for a live tenant (§6.4).
- **Demo deny-list** (Munim's demo guard pattern, F). On a public demo deploy anyone can sign in as the owner. So, on
  synthetic and showcase tenants, core refuses these with `demo_protected`:
  - adding or deactivating a member, and invites;
  - creating or revoking a site key, and changing origins;
  - erasing a contact;
  - **publishing a site release.** A showcase site carries a real brand, so only the reset publishes it (B3).
  
  Drafts, approvals, sales and campaigns stay allowed, because they are the demo. **No demo session reaches a real
  channel** (B3):
  - The database derives every delivery's mode, and it is always `recorded` while `ops.deployment` is `demo` or
    `munshi.via` is `demo` (0016).
  - The demo deploy holds no WhatsApp or Instagram credentials at all (§10).

### 1.6 Add-a-business checklist

1. A signed one-page permission (`../hackathon/meta-ai-developer-hackathon/merchants/PERMISSION-AND-INTAKE.md`). It includes
   the AI clause: the shop's books' cells go to Meta's Model API under Standard model ids only (A2, §7.1).
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
- **Two shared trigger functions: erasure and fill-once** (rewritten in fix cycle 2, finding 1). Fix 1's "NULL → value
  once" let two UPDATEs swap a value: null a column, then fill a different one. They are now separate rules, and
  anything else raises `MS011`.
  - **`ops.only_erase(cols…)`.** `TG_ARGV` lists the row's personal and identity columns. A listed column may go to NULL
    only in the same UPDATE that moves `erased_at` from NULL to `now()`, and that UPDATE must null **every** listed
    column. The row is then **frozen**: the trigger refuses any later UPDATE of it. A listed column never goes from NULL
    to a value, so **an identity or recipient column can never be filled after insert**: `to_address`, `subject`,
    `phone_e164`, `from_address`, `email`, `name`, `phone`, `note`, `text`, `body`, `bytes`. A changed phone means a new
    contact; a new Google account means a new invite.
  - **`ops.fill_once(col, stamp)`** covers the two columns filled after insert: `inbound_message.transcript` (stamp
    `transcribed_at`) and `inbound_message.media_document_id` (stamp `media_at`). The column may go from NULL to a value
    only in the same UPDATE that sets its stamp from NULL to `now()`. The stamp is never cleared, so a second fill,
    even after a NULL, is refused. Erasure still nulls the column through `only_erase`, which then freezes the row.
  
  `only_erase` is used by `ops.contact`, `ops.member`, `ops.member_invite`, `ops.member_login`, `ops.site_request`,
  `ops.inbound_message`, `ops.message_text`, `ops.delivery` and `ops.document_blob`. Two functions rather than one per
  table, so each rule is red-proved once.
  
  **Gate OE1** red-proves each exploit path the review found. Each must be refused:
  - null `delivery.to_address`, fill another phone, claim;
  - null `member_login.subject`, fill another account, sign in;
  - move `contact.phone_e164` to a new phone;
  - null `inbound_message.from_address` to detach a STOP;
  - erase one column without `erased_at`;
  - fill `transcript` twice, or without its stamp;
  - any UPDATE of a frozen row.
  
  Red-proof: the fix-1 rule ("NULL → value once") lets the first four through.
- **Phones are E.164 everywhere.** Every phone column checks `'^\+[1-9][0-9]{7,14}$'`, and every phone that enters or
  leaves (form, contact, webhook `from`, outbound address, erase-by-phone) passes core's one `e164(raw)` (B4). Meta
  sends `from` as digits with no `+` (UNVERIFIED example shape, so the gate uses Meta's documented sample). Without this
  a STOP or an erasure would miss the contact.
- **No SECURITY DEFINER.** G9 also asserts `prosecdef = false` for every function in the manifest: every trigger runs
  with the caller's rights, under RLS.
- **G13, a gate for the global tables.** The manifest's `globalTables` must equal the munshi tables that have no
  `tenant_isolation` policy. Each one's app privileges must equal the set declared here, and the agent must hold none.

| # | File | Concern | New tables | Size |
|---|---|---|---|---|
| 0010 | `tenancy.sql` | business type, data class, deployment, slug directory | `ops.deployment`ᵍ, `ops.tenant_directory`ᵍ | S |
| 0011 | `items.sql` | services, packages as items, variants | (columns on `books.item`) | S |
| 0012 | `people.sql` | the contact vault, customers without personal data, consent | `ops.contact`, `books.customer_consent` | M |
| 0013 | `sign_in.sql` | logins, invites, sessions, deactivation | `ops.member_login`ᵍ, `ops.member_invite`, `ops.login_session` | M |
| 0014 | `offers_loyalty.sql` | offers, sale discounts, loyalty | `books.offer`, `books.offer_item`, `books.offer_end`, `books.sale_discount`, `books.loyalty_rule`, `books.loyalty_entry` | M |
| 0015 | `packages.sql` | prepaid packages and their liability ledger | `books.package_plan`, `books.package_plan_line`, `books.package_holding`, `books.package_entry` | M |
| 0016 | `messaging.sql` | campaigns, outbox, inbox, message text, media, channel `instagram` | `ops.campaign`, `ops.delivery`, `ops.inbound_message`, `ops.inbound_extract`, `ops.message_text`, `ops.document_blob` | M |
| 0017 | `sites.sql` | sites, keys, releases, public requests, rate counters | `ops.site`, `ops.site_key`, `ops.site_release`, `ops.site_request`, `ops.rate_counter`ᵍ | M |
| 0018 | `draft_only.sql` | draft-only commands refused as direct commands by the guard; `message.send` retired | `ops.draft_only`ᵍ | S |
| 0019 | `reason_codes.sql` | reasons are codes, never free text | (a function and checks) | S |
| 0020 | `grid.sql` | a person's grid edits as evidence | `ops.grid_batch`, `ops.grid_change` | S |

ᵍ = global (in `globalTables`). The total is 31 new tables (5 global), 11 of them books. The migrator lane writes them in
order, serially. *Lane E's appointment, staff-hours, stitching, payables and commission files* are not here: they are
Won't for 5 Nov (SYNTHESIS, Won't list).

### 0010 · tenancy

- **`ops.tenant`** gains two columns:
  - `business_type text not null default 'kirana'`, check `kirana | apparel | salon`;
  - `data_class text not null default 'synthetic'`, check `synthetic | showcase | live`.
  
  Grants are unchanged (S I; no UPDATE, so both are immutable).
- **`ops.member_audit()` is replaced here, in the first file** (`create or replace`, as 0007 replaced functions, FACT;
  moved from 0013 in fix 2, finding 4), so no member added after 0010, a live owner provisioned between 0010 and 0013
  included, is ever chained with a name or phone. It logs
  `{member_id, role}` only. Today it hashes `to_jsonb(new)`, including the member's name and phone, into the permanent
  chain (FACT, 0007 L104), which would make a live shop's staff unerasable (B1). Entries already chained hold only the
  kirana's invented members.
- **Trigger `ops.tenant_class`** (before insert on `ops.tenant`) raises `MS010` unless `(data_class = 'live')` equals
  `(the deployment kind = 'live')`. No deployment row counts as `demo`, which is what dev and the tests are.
- **`ops.deployment`ᵍ**, one row: `one boolean primary key default true check (one)`, `kind text check demo | live`,
  `created_at`.
  - App: S. Agent: none.
  - Inserted only by `provision.ts` or `reset-demo.ts` as `munshi_owner`, before any tenant.
  - **Immutable.** Trigger `ops.deployment_fixed` refuses every UPDATE and DELETE, even by the owner. A database never
    changes kind; a new deployment means a new database.
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
| `erase_requested_at` | set when the owner asks for erasure while a balance holds it (§7.3) |

The vault holds customers and, on showcase and live tenants, staff too (B1).

- **Grants.** App: S I, plus U(`name`, `phone_e164`, `erased_at`, `erased_by`, `erase_reason`, `erase_requested_at`).
  Agent: none.
- **Triggers.**
  - `ops.only_erase('name', 'phone_e164')`.
  - `ops.contact_erase`, before update. It admits an erasure in one of two shapes only:
    - an active owner as the actor, with `erased_by` = the actor and reason `request`;
    - no actor (the daily purge, in a system scope), with reason `retention`.
- **Index:** unique `contact_phone (tenant_id, phone_e164) where erased_at is null`, one live contact per phone.
- **Audit.** Every insert and erasure is audited under the actor with payload `{contact_id}` only: never a name or a
  phone, because the chain is permanent.

**`books.customer`** changes:
- It gains `contact_id uuid` (FK `ops.contact`).
- `name` drops NOT NULL. This relaxes a constraint on a book table, so the orchestrator should check it.
- Check `customer_identity`: `(contact_id is null) = (name is not null)`.
- Check `customer_no_phone`: `contact_id is null or phone is null`.
- Trigger `books.customer_pii` (before insert, after `guard`, so it is named `pii`): for a **showcase or live** tenant
  it raises `MS008` unless `contact_id` is set (#14). Showcase seeds write their invented customers through the vault
  too, so the one path real test phones take is the one every showcase customer takes.

**`books.staff`** changes, the same way (B1):
- It gains `contact_id`, and `name` drops NOT NULL.
- The same two checks apply: identity, and no phone beside a contact.
- Trigger `books.staff_pii`, the same rule for showcase and live tenants.

A live shop's staff are real people, and `books.audit_row` would chain their names and phones forever (FACT, 0005 L80).

Existing rows have a name and no contact, so every check holds. The kirana (synthetic) keeps writing names (invented
people), and its tests do not change. `agent_view.customer` and `agent_view.staff` need no change: for a vault-backed
person `name` is NULL, so the agent sees an id only, and nothing personal reaches Meta through the agent (A2).

**`books.customer_consent`** (books)

| Column | Type / check |
|---|---|
| `customer_id` | uuid, FK |
| `channel` | `whatsapp \| sms` |
| `purpose` | `marketing \| service` |
| `granted` | boolean |
| `source` | `in_person \| whatsapp_reply \| in_chat_attested \| import` |
| `evidence_table`, `evidence_id` | e.g. `ops.inbound_message` + id (the customer's "YES"); both or neither |
| `notice_version` | text (the privacy notice the person saw) |
| `at` | timestamptz |

- **Append-only.** The latest row per (customer, channel, purpose) wins, and a withdrawal is a new row with
  `granted = false`, never an update.
- **Written by `consent.record` only** (owner, manager, staff), never straight from a web form (#13). A ticked box on a
  form comes from a phone nobody has verified, since anyone can type anyone's number. So the tick only makes the
  booking confirmation ask "Reply YES for offers on WhatsApp". The consent row is written when the phone's owner
  answers:
  - `whatsapp_reply`: the YES arrived through the Cloud API (live test number); the evidence is the inbound message.
  - `in_chat_attested`: staff saw the YES in their own WhatsApp after a manual-link send, and the row is written under
    their name.
  - `in_person`: the customer said yes at the counter.
- **Grants:** S I. **Index:** `consent_latest (tenant_id, customer_id, channel, purpose, at)`.
- **`ops.command_table`:** `consent.record → customer_consent`; `booking.confirm → customer, outbound_message`;
  `customer.create` is unchanged (`customer`).
- **Gates.**
  - **PII1:** a showcase or live tenant's customer or staff row with a name or phone is refused (`MS008`; red-proof:
    drop the trigger). The synthetic kirana's legacy rows are accepted.
  - **K5:** a ticked web-form box alone writes no consent row; a YES does.
  - **PII2:** after a scripted live-tenant run, no `audit.audit_log.payload` and no `snap.snapshot_cell.txt` contains the
    contact's phone or name. The positive control is a planted synthetic customer whose name *is* found.
  - **E1:** erasure (§7.3).
  - **K1:** the latest consent row wins.
  - G1, G3 and G4 over the new tables.

### 0013 · sign-in: logins, invites, sessions, deactivation

- **`ops.member_audit()`'s replacement moved to 0010** (fix 2, finding 4); see there.
- **`ops.member_login`ᵍ** (global, because a Google subject names no tenant)
  - **Columns:** `id` (primary key), `provider text check google`, `subject text` (nullable once erased), `tenant_id`,
    `member_id`, `created_at`, `revoked_at`. **No email:** a global table has no RLS, so it holds nothing personal beyond
    the provider's opaque subject (B1).
    The FK is `(tenant_id, member_id) → ops.member`, with `unique (provider, subject, tenant_id) where subject is not
    null` and `unique (tenant_id, member_id, provider)`.
  - **Grants.** App: S I U(`revoked_at`, `subject`, `erased_at`). Trigger `ops.only_erase('subject')`. Revocation sets
    `revoked_at`; erasure nulls `subject` with `erased_at` and freezes the row. `subject` can never be refilled, so a
    member is rebound to another Google account only through a new row, which `ops.login_bind` admits only with a
    consumed invite. A revoked or erased binding signs no one in. Agent: none.
  - **Trigger `ops.login_bind`:** `tenant_id` must be the current tenant and `member_id` the acting member. An
    `ops.member_invite` row for that member must have been consumed in this transaction (`used_txid = txid_current()`).
    So no login is ever bound without an invite.
  - **Audit:** `member.login_bound`, with payload `{member_id, provider}`.
- **`ops.member_invite`**
  - **Columns:** `member_id`, `email` (the Google address the owner typed; must match the verified email at
    acceptance), `token_sha256 bytea unique`, `expires_at` (24 hours), `created_by`, `created_at`, `used_at`,
    `used_txid`, `erased_at`.
  - **Grants.** App: S I, plus U(`used_at`, `used_txid`, `email`, `erased_at`), once only (a trigger refuses a second
    use or use after expiry). Agent: none.
  - **The email is erasable.** `ops.only_erase('email')` applies. Consuming the invite is one UPDATE that sets `used_at`
    and `used_txid`, nulls `email` and sets `erased_at`: the comparison has been made by then, and the row freezes. The
    daily purge does the same on expired invites. So no lasting copy of a staff member's address exists (B1).
- **`ops.login_session`**
  - **Columns:** `member_id`, `via text check demo | google`, `created_at`, `expires_at`, `revoked_at`.
  - **Grants.** App: S I U(`revoked_at`), one way. Agent: none.
  - **Trigger `ops.login_session_via`** (#12) refuses `via = 'demo'` for a live tenant, so the database holds the fence
    as well as core.
  - **Index:** `login_session_member (tenant_id, member_id)`.
- **`munshi.via`,** a new context setting. `withTx` sets it from the Session, which now carries `via`, in the same one
  place it sets the actor. It is trusted like the actor (CLAUDE.md), and gate B3 extends to it. Triggers read it to
  force the recorded sender and to refuse publishing for demo sessions (B3).
- **`ops.member`** gains U(`active`, `name`, `phone`, `erased_at`).
  - **Trigger `ops.member_deactivate`:** only true → false, by an active owner, never the last active owner. It takes
    `ops.member_guard`'s per-tenant advisory lock before counting owners (#11), so two owners cannot deactivate each
    other at once. It is audited as `member.deactivate` (`{member_id}`).
  - `ops.only_erase('name', 'phone')` applies (with `erased_at` in the same UPDATE, which freezes the row), and erasure
    is allowed only on a deactivated member, by an active owner.
    Screens then show "Former staff · M-1a2b" wherever that member approved something.
  - Today there is no way to remove a person who has left (no UPDATE grant, FACT 0002). Re-activation means a new member
    row.
  - `ops.member.name` drops NOT NULL, for erasure only. A check keeps it NOT NULL while `erased_at` is null.
- **Gate PII3** (B1): add, deactivate and erase a live staff member, then scan every `audit.audit_log.payload` and
  every global table for their name, phone and email. It must find none. The positive control is the same scan against
  the pre-0013 `member_audit`, which does find them.
- **Gates:** F1–F6 (§6.6).

### 0014 · offers, sale discounts, loyalty

| Table (books) | Columns | Written by | Authority |
|---|---|---|---|
| `books.offer` | `name`; `kind` (`percent_off`, `amount_off`); `percent_bp` (1..9000, integer basis points: 2000 = 20%); `amount_off_minor` + `currency`; `scope` (`all`, `category`, `items`); `category`; `min_spend_minor`; `starts_at`; `ends_at`; `published` (shown by the public API). Checks: the kind's amount and only it set; `ends_at > starts_at` | `offer.create` | owner |
| `books.offer_item` | `offer_id`, `item_id` (scope `items`) | `offer.create` | owner |
| `books.offer_end` | `offer_id` (unique), `ended_at`, `reason` not null, a reason code (0019): ending an offer early, append-only | `offer.end` | owner |
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
| `books.package_entry` | `holding_id`; `shop_id` (the branch that sold or redeemed it); `item_id` (NULL for value plans); `kind` (`sold`, `redeemed`, `expired`, `reversal`); `sessions` (signed; NULL for value plans); `value_minor` (signed: the liability this row moves); `currency`; `seq`; `sessions_after` and `value_after` (checks ≥ 0); `at`; `reverses_id` + `reason` | `sale.record` (sold), `package.redeem`, `package.expire` | owner, manager and staff (redeem); owner (expire) |

- **Packages are tenant-wide, and so is loyalty.** Elite's two branches share one customer base and one liability, so
  a pack bought in Kirti Nagar is redeemed in Kalkaji. The journal is per tenant (FACT, 0005). Each entry records its
  `shop_id`, so branch reports still show where a session was used.
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
  - `channel` adds `instagram`, and `recipient_kind` adds `public` (drop and re-add both checks), with the new check
    `(channel = 'instagram') = (recipient_kind = 'public')`. An Instagram post's `recipient_id` is its campaign's id: the
    column is NOT NULL and polymorphic, with no FK (FACT, 0005).
  - New columns:
    - `campaign_id` (FK `ops.campaign`);
    - `reply_to_id` (FK `ops.inbound_message`);
    - `text_id` (FK `ops.message_text`) and `body_sha256`;
    - `created_txid`, stamped by trigger like `journal_entry`'s.
  - **`body` drops NOT NULL (B2).** Checks: `(body is null) = (text_id is not null)` and
    `(text_id is null) = (body_sha256 is null)`.
    - An inline `body` is only for code-composed text: fixed templates (a booking confirmation) and reorders to
      (simulated) suppliers.
    - **Every model- or person-written text is `text_id` plus `body_sha256`:** a reply, and campaign copy too (fix 2,
      finding 4). The chain proves what was approved, and the words stay erasable. At execution a campaign's copy is
      rendered once, with its figures from cells and the disclosure line, into one `ops.message_text` row. Every
      recipient's outbound row references that row by `text_id`.
    
    This relaxes a book column; it is for the orchestrator to check.
  - **Trigger `books.outbound_delivery`** (after insert) inserts the message's `ops.delivery` row. Core never writes a
    delivery itself (B4).
- **`ops.message_text`** holds the words of a reply or a campaign's copy, referenced by id from draft payloads and
  book rows.
  - **Columns:** `body` (≤ 4,096; nullable once erased); `body_sha256`, check
    `= encode(sha256(convert_to(body, 'UTF8')), 'hex')` while `body` is not null; `created_by` or `run_id`;
    `created_at`; `erased_at`.
  - **Grants.** App: S I U(`body`, `erased_at`). Trigger `ops.only_erase('body')`. Agent: none.
  - **Immutable.** A changed copy is a new row. A draft's payload carries `textId` and `textSha256`, and execution
    refuses a text whose hash differs. So the approver approves exactly the words that are sent.
- **`ops.campaign`**
  - **Columns:** `name`; `channel` (`whatsapp`, `instagram`); `offer_id` (FK `books.offer`, nullable); `copy_text_id`
    (FK `ops.message_text`); `card_document_id` (FK `ops.document`); `segment` (`bought_within_days`, the one v1
    segment); `segment_days` (1..365); `status` (`composing`, `proposed`, `approved`, `rejected`, `sent`); `created_by`;
    `created_at`; `updated_at`.
  - **Grants.** App: S I U(`status`, `updated_at`).
  - It is the composer's working object; the send itself is the draft (§3).
- **`ops.delivery`**, the outbox, **derived, never chosen** (B4)
  - **Columns:** `message_id` (unique, FK `books.outbound_message`; NULL for a test send); `test_member_id` and
    `text_id` (test sends only); `channel`; `to_address` (E.164, or NULL for
    Instagram); `mode` (`recorded`, `pending`, `cloud_api`, `manual_link`, `instagram`); `status`; `claimed_at`;
    `attempts` (0 or 1); `provider_message_id` (unique per tenant where not null); `error_code` (the provider's numeric
    code, never its text); `not_after`; `sent_at`; `final_at`; `created_at`; `updated_at`; `erased_at`.
  - **Trigger `ops.delivery_derive`** (before insert). It refuses unless the message exists, has no delivery yet, and was
    created in this transaction (`created_txid`). It then sets every field itself; whatever the caller sent is
    overwritten:
    - `to_address`: from the customer's contact phone, the legacy synthetic `books.customer.phone`, or the supplier's
      phone. NULL for Instagram.
    - `mode`: `recorded` when `ops.deployment` is `demo` or `munshi.via` is `demo`, else `pending` (B3).
    - `status = 'queued'`, `attempts = 0`.
    - `not_after`: the earlier of approval + 24 h and, for a campaign, the offer's `ends_at`.
    
    The app keeps INSERT on `ops.delivery` only because triggers run with the caller's rights and G9 forbids
    SECURITY DEFINER; the trigger decides everything the insert holds.
  - **Test sends leave no book row** (fix 2, finding 4). A delivery has either a `message_id` or, for a test,
    `test_member_id` plus `text_id` (a check enforces exactly one).
    - For a test, `ops.delivery_derive` requires `test_member_id` = the acting member and takes `to_address` from that
      member's own `ops.member.phone`. That phone must be a verified test phone, checked at send.
    - Core's `campaign.test_send` (owner or manager, ops-only) uses it: "send this copy to me".
    - *A marked, reversible book row* was rejected. Books are append-only, so the "test" row and its reversal would sit
      in the merchant's real books forever, and every report would have to filter them out. A message to the person
      testing is not a message to a customer or supplier, so it is not a book (CLAUDE.md).
  - **Trigger `ops.delivery_status`, a state machine:**
    - `queued → sending`, the claim: `update … set status = 'sending', claimed_at = now(), attempts = 1 where id = $1
      and status = 'queued' and erased_at is null and now() < not_after returning *`;
    - `queued → expired`;
    - `sending → sent | failed | needs_window | blocked | handed_off`;
    - `sent → delivered → read`, and `sent | delivered → failed` from Meta's status events.
    
    A row never returns to `queued`. Requeueing would mean resending, so a delivery is sent **at most once**. `mode`
    moves from `pending` to the route the claim chose, and never away from `recorded`. A failure is final, and the
    owner sees it.
  - **Grants.** App: S I, plus U on the status columns, `mode`, `claimed_at`, `attempts`, `provider_message_id`,
    `error_code`, `sent_at`, `final_at`, `updated_at`, `to_address` and `erased_at`. Trigger
    `ops.only_erase('to_address')`.
- **`ops.inbound_message`**, the inbox. It is written with **no actor**, by the webhook in a system scope, on the live
  deploy only (B3).
  - **Columns:** `channel` (`whatsapp`); `provider_message_id` (unique per tenant, so Meta's retries are idempotent);
    `from_address` (E.164, normalised from Meta's `from`); `kind` (`text`, `audio`, `image`, `other`); `text`
    (≤ 4,096); `media_document_id` and `media_at`; `transcript` and `transcribed_at` (filled once, when a person taps
    *Transcribe*); `opt_out` (set by plain code on a stop word: STOP, UNSUBSCRIBE, "band karo", "बंद करो");
    `received_at`; `status` (`new`, `handled`, `ignored`); `handled_by`; `handled_at`; `erased_at`.
  - **Grants.** App: S I U(`status`, `handled_by`, `handled_at`, `transcript`, `transcribed_at`, `media_document_id`,
    `media_at`, `text`, `from_address`, `erased_at`).
  - **Triggers:** `ops.only_erase('text', 'from_address', 'transcript', 'media_document_id')`;
    `ops.fill_once('transcript', 'transcribed_at')`; `ops.fill_once('media_document_id', 'media_at')`. `from_address` is
    set on insert only, so a STOP stays attached to its phone until the row is erased.
  - **An `opt_out` row** is marked `handled` only in the transaction that writes the person's withdrawal row, and the
    purge keeps it until then (§3.5).
- **`ops.inbound_extract`**, one figure from a transcript: the voice note's version of `ops.bill_line`
  - **Columns:** `message_id`; `run_id`; `field` (`amount`, `date`, `service`, `quantity`); `num` or `day` or `item_id`;
    `span_start`; `span_end`; `span_sha256`. **No quote is stored** (B2). The screen shows the span by its offsets from
    the erasable transcript; once the transcript is erased, it shows "erased".
  - **Trigger:** the span must lie inside its message's transcript, and `span_sha256` must equal the sha256 of that
    span; otherwise `MS006`. Each extract also carries `parsed_as text check digits | words`.
  - **The database parses digit spans itself** (fix 2, finding 5; picked over "state the risk" because these are the
    common case, and plain SQL handles them). For `amount` and `quantity` with `parsed_as = 'digits'`, the trigger
    takes the span and:
    - maps Devanagari digits to ASCII (`translate`);
    - strips an optional `₹`, `Rs`, `rs.` or `rupaye`, plus spaces and grouping commas (Indian or Western);
    - requires `^[0-9]+(\.[0-9]{1,2})?$`.
    
    It then checks the value equals `num`: paise for an amount (rupees × 100), a whole count for a quantity. A digit
    span that does not reduce to that shape, or holds another value, raises `MS006`. So the figure in the cell is the
    figure in the span, held by the database, not by core.
  - **Words and dates stay with core, and that is a stated residual.** For `parsed_as = 'words'` ("paanch sau",
    "dhai hazaar"), and for every `date` ("kal", "shanivaar", "3 Nov"), the database checks only the span hash; core's
    parser gives the value. A core bug could therefore put a wrong value beside a correct span. Two things cover it:
    - **gate EX2** runs every word, every supported composition and every date form in the parser's list against a
      hand-written answer key (an independent source), and asserts a positive count;
    - **the approver sees the span beside the figure**, as the bill photo's place does (H2's pattern).
    
    Red-proof: plant an extract whose digit span says "₹500" and whose `num` is 60,000 paise; the database refuses it.
  - **The model never gives a value** (B2). It returns the intent and the span offsets only. Core's parser reads the
    figure from the span text: ASCII and Devanagari digits, rupee forms, and a fixed list of Hindi, English and
    romanised number and date words. A span the parser cannot read fills nothing; the person then uses the direct
    command and types the figure as their own.
  - **Grants.** App: S I.
- **`ops.document`** changes:
  - `kind` adds `voice` and `card`; `uploaded_by` drops NOT NULL.
  - New column `source text not null default 'upload'`, check `upload | inbound`, with check
    `(source = 'upload') = (uploaded_by is not null)`.
  - Inbound media has no member. The existing rows are uploads, so every check holds.
- **`ops.document_blob`**, sized for free-tier storage (A1)
  - **Columns:** `document_id` (unique); `bytes bytea`, check `octet_length ≤ 1,048,576`; `purge_after`; `erased_at`.
  - **Grants.** App: S I U(`bytes`, `erased_at`). Trigger `ops.only_erase('bytes')`.
  - **Limits.** Core refuses a blob that would take its tenant past 25 MB of live blobs. An inbound voice note or image
    over the limit is kept as a text-only inbox row, with no media.
  - **Purge, daily.**
    - Voice audio is nulled as soon as it is transcribed, and at most 7 days after receipt.
    - Inbound images are nulled after 7 days.
    - A card is nulled 30 days after its campaign is sent, unless a release still uses it.
  - **Why `bytea` and no blob store.** No store exists today: no code reads `ops.document.storage_key` (FACT, grep). A
    voice note is about 100 KB and a card about 300 KB (INFERENCE). Storage keys stay as `db:<id>`, so a blob store can
    replace this later behind the same column.
- **`ops.run.trigger`** adds `inbox` and `campaign`.
- **`ops.command_table`:** `campaign.send → outbound_message`; `campaign.post → outbound_message`;
  `message.reply → outbound_message`. **Authority:** `campaign.send` and `campaign.post` owner; `message.reply` owner and
  manager. All three are draft-only (0018).
- **Indexes:** `delivery_due (tenant_id, status, not_after)`; `inbound_from (tenant_id, from_address, received_at)`;
  `inbound_status (tenant_id, status, received_at)`; `outbound_campaign (tenant_id, campaign_id)`;
  `extract_message (tenant_id, message_id)`.
- **Gates:** W1–W8 and K2–K5 (§4.7).

### 0017 · sites: sites, keys, releases, public requests, rate counters

- **`ops.site`**
  - **Columns:** `name`; `origins text[]` (each `https://host[:port]`; `http://localhost:<port>` only while
    the deployment is `demo`, by trigger); `intake` (`open`, `paused`: the owner's kill switch for the public forms);
    `privacy_version` and `consent_version` (the texts the site must show now); `created_by`; `created_at`; `updated_at`.
  - **Grants.** App: S I U(`origins`, `intake`, `privacy_version`, `consent_version`, `updated_at`).
  - **Rules.** One site per tenant in v1 (unique on tenant). The slug is the tenant's directory slug.
  - **The site serves every shop of its tenant.** The salon, Elite Unisex Salon & Academy, is one tenant with two shops,
    Kirti Nagar and Kalkaji: one site, one key, and a branch picker on the booking form (§1.1).
- **`ops.site_key`**
  - **Columns:** `site_id`; `key_sha256 bytea` (unique per tenant); `prefix text` (`mpk_<slug>_` plus four characters,
    for display); `created_by`; `created_at`; `revoked_at`; `revoked_by`.
  - **Grants.** App: S I U(`revoked_at`, `revoked_by`). A trigger allows revocation once, by an active owner.
- **`ops.site_release`**: `site_id`, `snapshots jsonb` (read name → snapshot id), `published_by`, `published_at`.
  - **Grants.** App: S I.
  - The API serves the newest release.
  - **Trigger `ops.release_check`** (B8). Every snapshot the release names must be of this tenant, have a `query_name`
    starting with `site.`, and have been minted in this transaction (`created_txid = txid_current()`). Otherwise a
    release could name any snapshot, a credit balance among them, and the public API would serve it.
  - **Refused when `munshi.via` is `demo`** (B3): demo sessions cannot publish a real brand. The reset publishes the
    showcase sites' releases.
- **`ops.site_request`**: a booking request or an enquiry. It is written with **no actor**, by the public route in a
  system scope. It is never a book.

| Column | Type / check |
|---|---|
| `site_id`, `shop_id` | uuid. `shop_id` is the branch the form picked; it must be a shop of the site's tenant (composite FK) |
| `kind` | `booking \| enquiry` |
| `source` | `site \| whatsapp` (a voice-note booking, §4.5) |
| `name` | ≤ 80 |
| `phone_e164` | E.164, India `+91[6-9]` + 9 digits |
| `item_ids` | uuid[], ≤ 3 (services asked for, or the product enquired about) |
| `preferred_on` | date, booking only, today..+60 days |
| `time_window` | `morning \| afternoon \| evening`, booking only |
| `note` | ≤ 500 |
| `wa_updates` | boolean, the unticked box |
| `notice_version`, `consent_version` | text; the public route refuses (400 `stale_notice`) any that differ from the site's current versions (#13) |
| `idempotency_key` | text, unique per site |
| `ip_hash` | bytea, keyed hash, §9 |
| `status` | `new \| confirmed \| declined \| spam \| closed`; an unhandled request is closed by the daily purge after 30 days |
| `handled_by`, `handled_at`, `customer_id`, `created_at`, `erased_at` | |

- **`ops.site_request` checks:** `(kind = 'booking') = (preferred_on is not null and time_window is not null)`.
- **`ops.site_request` grants.** App: S I U(`status`, `handled_by`, `handled_at`, `customer_id`, `name`, `phone_e164`,
  `note`, `erased_at`). Trigger `ops.only_erase('name', 'phone_e164', 'note')`.
- **On the demo deploy the route stores sample values only** (B3). It replaces the name with "Sample customer", the phone
  with `+910000000000` (a shape no Indian mobile has, since those start 6–9), and the note with NULL before inserting.
  What a judge types is never stored. **A trigger pins all three while `ops.deployment` is `demo`** (fix 2, finding 4):
  the name must be "Sample customer", the phone `+910000000000`, and the note NULL. Any other value is refused.
- **Erasing a request** (`request.erase`, owner or manager, ops-only) nulls its personal columns at once. Live sites are
  linked from the submission (A4), so a judge's test request can be marked spam and erased the same day.
- **`ops.rate_counter`ᵍ**
  - **Columns:** `bucket bytea` (a keyed hash of the IP, the key or the phone, plus the route class); `window_start`;
    `hits`. The primary key is `(bucket, window_start)`.
  - **Grants.** App: S I U(`hits`), plus DELETE.
  - This is **the only DELETE grant in the schema**, and RLS limits it to expired windows (rank 3). RLS is enabled and
    forced, with permissive SELECT, INSERT and UPDATE policies and a DELETE policy of
    `using (window_start < now() - interval '1 day')`.
  - It holds hashes only, no tenant. There is no hourly cron on the free plan (A1), so the public route itself deletes
    expired windows, at most once every ten minutes per instance.
  - *An unlogged table* was rejected because it would vanish on a crash. *An external KV store* was rejected as a new
    vendor and key for a counter.
- **Indexes:** unique `site_one (tenant_id)` on `ops.site`; `site_key_site (tenant_id, site_id)`;
  `site_release_latest (tenant_id, site_id, published_at)`; `site_request_status (tenant_id, status, created_at)`;
  `site_request_phone (tenant_id, phone_e164) where erased_at is null`; unique
  `site_request_idem (tenant_id, site_id, idempotency_key)`.
- **Gates:** S1–S10 (§5.7).

### 0018 · draft-only commands, in the guard (B6)

- **`ops.draft_only`ᵍ** (`command text primary key`, app S), seeded with `campaign.send`, `campaign.post`,
  `message.reply`, `package.expire` and `grid.apply`.
- **`books.guard()` is replaced** (`create or replace`, as 0007 replaced functions in place, FACT 0007 L55). Its direct
  branch (b) (FACT, 0005 L47–51) gains: refuse when `ctx_command` is in `ops.draft_only`. A draft-only command then
  writes a book row only under an approved decision, whatever string a caller hands `withTx` (which accepts any command
  name, FACT session.ts L27).
- **`message.send` is retired.** Its `ops.command_authority` and `ops.command_table` rows are deleted (FACT, 0002
  L46, L83). It has no `Def` in `commands.ts`, so it was a dormant direct path to `books.outbound_message`.
- **Gates.**
  - **D1:** each draft-only command, set as `munshi.command` by an owner, writes nothing (`MS001`). Red-proof: delete
    its `ops.draft_only` row. Under an approved decision of this transaction, it writes.
  - **D2:** `message.send` is held by no role.
  - G3 stays total: `books.outbound_message` is still written by `reorder.place`, `campaign.send`, `message.reply` and
    `booking.confirm`.

### 0019 · reasons are codes (B2)

- **`ops.is_reason(text) returns boolean`**, an immutable function holding the fixed list, e.g. `wrong_figure`,
  `duplicate`, `not_now`, `customer_cancelled`, `entered_in_error`, `returned_goods`, `damaged`, `expired_offer`,
  `other`. Changing the list means a new migration that replaces the function.
- **Every free-text reason column gets** `check (reason is null or ops.is_reason(reason)) not valid`. `NOT VALID`
  checks new rows only, so the dev database's existing rows stand. *A global code table with FKs* was rejected: G10
  requires `tenant_id` to lead every FK of a tenant table. The columns are `reason` on `books.purchase`,
  `sale`, `stock_move`, `payment`, `credit_entry`, `journal_entry`, `attendance`, `settlement`, `offer_end`,
  `loyalty_entry`, `package_entry`, and `approval.decision.reason`.
- **Why.** A reversal or rejection reason is typed by a person and lands in the permanent chain: `books.audit_row`
  hashes the whole row, and `decide()` audits `{reason}` (FACT, approvals.ts L266). A code can carry no name or phone.
  A person who needs to say more uses an erasable note (`ops.message_text`) referenced by id.
- **Other free-text columns that reach the books stay code-written:**
  - `journal_entry.memo` is set by core only (FACT, `commands.ts`);
  - `payment.reference` takes a transaction id shape only (`^[A-Za-z0-9-]{1,64}$`);
  - catalogue names, offer names and plan names are the owner's catalogue, not personal data.
- **Gate R1:** a reversal with a free-text reason is refused, and a code is accepted. Red-proof: drop the check.

### 0020 · grid: a person's edits as evidence

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
| `booking.confirm` | `requestId`, `customerId?` or `newCustomer: true`, `reply` | customer (+ `ops.contact`), outbound_message (a fixed template; if the box was ticked it asks "Reply YES for offers", §7.2); sets the request's status | owner, manager |

**Ops-only actions** have no `ops.command_authority` row, because G3 requires every held command to write a book table.
Core checks the role; a DB trigger checks it too where marked †.
- `booking.decline`, `enquiry.close`, `request.spam`: owner, manager, staff.
- `request.erase`: owner, manager (A4).
- `contact.erase`†: owner; held while a balance is open (§7.3).
- `site.create`, `site.update` (origins, intake): owner.
- `site.key.create`, `site.key.revoke`†: owner.
- `site.publish`: owner, manager.
- `member.invite`: owner invites a manager; owner or manager invites staff, mirroring `ops.member_guard`.
- `member.deactivate`†: owner.
- Composing a campaign and handling an inbox item: owner, manager.

### 3.2 Draft types (the agent or a member proposes; a person whose role holds the command approves)

| Draft | Payload | Every number and the cell it must cite | Checked at proposal and again at approval |
|---|---|---|---|
| `campaign.send` | `campaignId`, `textId`, `textSha256`, `offerId?`, `cardDocumentId?`, `audienceCount` | `audienceCount` → `campaign.audience` row 0 `audience`. The figures *inside* the copy (`ops.message_text`) are ref tokens to `offer.detail` cells (`percent_bp`, `amount_off`, `ends_at`) | the copy passes core's number detector (below); every token is in `basedOn`; the offer is still in effect. **The whole audience set is re-checked** (#10): the re-run read's set of `customer_id`s must equal the stored snapshot's set, all rows, not only the cited one. Any difference → `stale` |
| `campaign.post` | `campaignId`, `textId`, `textSha256`, `cardDocumentId` | the caption's figures are ref tokens, as above | the same detector; the card is a `card` document of this tenant |
| `message.reply` | `inboundMessageId`, `customerId`, `textId`, `textSha256` | the reply's figures are ref tokens | the payload holds ids and a hash only, and the words live in an erasable `ops.message_text` row (B2). The window is open at proposal (shown) and checked again at send (§4.3). On a live tenant before a verified number, the reply goes out by manual link |
| `package.expire` | `holdingId`, `valueMinor`, `lines[{itemId, sessions}]` | `valueMinor` → `package.balance.value_left`; `lines[n].sessions` → `package.balance.sessions_left`, same item | the new current-state rule `holdingId → package.balance`: a redemption after the draft makes it stale |
| `grid.apply` | `batchId`, `lines[{itemId, oldAmountMinor, amountMinor}]`, `adds[{addKey, name, unit, category?, kind?, parentItemId?, amountMinor}]` | `oldAmountMinor` → `grid.catalogue.price`, same item; `amountMinor` → `grid.batch.new_amount`, same item or add key | ≤ 500 lines; every old cell re-checked at approval (3.4) |
| `booking.confirm` (from a voice note) | `messageId`, `extractIds`, `serviceItemIds`, `shopId`, `preferredOn`, `timeWindow`: ids, a date and a code, no words (B2) | `preferredOn` → an `inbox.extract` date cell; the service ids → `inbox.extract` item cells | the extracts belong to that message, and each value was parsed by code from its span |
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
   (red-proof: drop the flag). **The database enforces it too** (B6): 0018's `ops.draft_only` and the replaced
   `books.guard()`. This core flag only gives a clean error first.
5. **One number detector** (B5). The agent's free-number detector moves into `@munshi/core/read`
   (`packages/core/src/numbers.ts`). It covers `\p{N}` (every script's digits), `%`, digit emoji, and the number words in
   English, Hindi and romanised Hindi from `words.ts`, with MS-12's quantity-context homograph rules. The agent's
   validator and core's `checks` for `campaign.send`, `campaign.post` and `message.reply` call the same function, so
   core's backstop is exactly as strict as the agent. The precision corpus (199 clean, 157 attacks) must pass unchanged.
   Ticket MS-22b.
6. **Decision reasons are codes** (0019). `decide(…, reason?)` takes a code. The audit payload `{reason}` (FACT,
   approvals.ts L266) can then hold no words.

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
6. **Approve** (owner). `decide()` re-checks: the offer is still in effect, the copy's hash matches, and the re-run
   audience set equals the stored snapshot's set exactly (#10). Then, in one transaction:
   - it renders the copy once (figures from cells, plus the disclosure line) into an `ops.message_text` row;
   - for each customer in that set, it writes one `books.outbound_message` (`text_id` = that row, `body_sha256`,
     `campaign_id`), and the trigger derives its `ops.delivery` (`queued`, B4);
   - it marks the campaign `approved`.
7. **Send** (free plan: no frequent cron, A1).
   - The outbox flushes after commit, inside the approver's own request (Next's `after()`).
   - Every owner or manager page load, and every approval, also sweeps queued rows.
   - The daily cron is a last resort only: Vercel Hobby crons run at most daily (UNVERIFIED).
   
   The sweep and the flush cannot double-send, because each send begins with the claim.
8. **For each claimed delivery, at send time** (B4), the claim transaction rechecks:
   - the recipient still passes the audience predicate: consent latest-granted, no newer STOP, contact not erased;
   - `now() < not_after`, and the offer has not ended;
   - the 24-hour window (§4.3).
   
   Any failure ends the delivery `blocked` or `needs_window`, unsent. A recheck can only remove recipients, never add
   one.

### 4.2 Sender adapters (`packages/channels`, new: no provider code outside its adapter, CLAUDE.md rule 5)

| Adapter | Does | Used |
|---|---|---|
| `recorded` | stores the request and returns a fixed provider id; nothing leaves the machine | every gate (`MUNSHI_SEND_MODE=recorded`, the default) |
| `whatsapp-cloud` | `POST /{phone-number-id}/messages`: a `text` message, or an `image` message with a caption (the card's public URL) | the live deploy, on the test number, to its ≤ 5 verified phones |
| `instagram` | creates a media container from the card's public JPEG URL and the caption, then publishes it | the live deploy, to the founder's own professional account |
| `manual-link` | no network: builds a `https://wa.me/<phone>?text=…` link, which the person opens on their own phone. The delivery becomes `handed_off` | live tenants before a verified number; the booking confirmations |

Only the provider's numeric error code is stored, never its text. For example, 131049 is the per-user marketing cap: the
delivery is `failed`, with no retry for 24 hours (FACT, lane A).

### 4.3 The 24-hour window: decided at send time, not at approval

| Condition at send | Mode | Status |
|---|---|---|
| the delivery's mode is `recorded`: always on the demo deploy, and for any approval by a `via=demo` session (B3) | `recorded` | `sent` (recorded, labelled "Recorded" on screen) |
| live deploy: the customer's last inbound message is < 24 h old, and the recipient is a verified test phone mapped to this tenant in `WHATSAPP_TEST_PHONES` | `cloud_api`, free-form | `sent` → `delivered` / `read` / `failed` (status events) |
| live deploy: the window is closed for a test phone | none | `needs_window`: listed in the composer ("ask them to message you first") |
| live deploy: anyone else (a real customer, before a verified merchant number), and every booking confirmation | `manual_link` | `handed_off` |

- **No template fallback in v1.** Custom templates on the test account are UNVERIFIED (only `hello_world` is known, lane
  A), and a template's text would differ from what the owner approved.
- **Test sends on live tenants** (fix 2, finding 4). Before approving a campaign, the owner taps "Send a test to me". The
  rendered copy goes to their own verified test phone as an ops-only delivery, with no book row (0016). Only an
  approved campaign writes `books.outbound_message`, and its recipients are the consenting audience.
- **For the film** (§8.3): every in-app beat is shot on the demo deploy, where sends are recorded and labelled. Any shot
  of a message arriving on a phone is a test send to the founder's own verified phone from the live deploy, which leaves
  nothing in the merchant's books. Only the
  founder's own chat is visible, and it is labelled "sent to a consenting test phone". The founder decides whether to
  use that shot (§12).
- **Pacing.** One message per user every six seconds (FACT, lane A). It does not bind here: a campaign sends one message
  per user.

### 4.4 The webhook: its own route, on the live deploy only

The route is `apps/web/app/api/webhooks/whatsapp/route.ts`. It reads no session cookie and makes no model call.
**It runs only where `MUNSHI_DEPLOYMENT=live`** (B3). On the demo deploy it answers 404 and holds no WhatsApp secret.
The messages of real people, the test phones' owners included, therefore land only in the live database, behind Google
sign-in. The demo's inbox beat replays a recorded fixture through the same code path (`MUNSHI_SEND_MODE=recorded`):
an invented customer's voice note, labelled "Recorded".

- **GET** (verification). It needs `hub.mode = subscribe` and a `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN`
  (timing-safe), then echoes `hub.challenge`. Anything else gets 404.
- **POST** (events):
  1. Read the raw body, capped at 256 KB.
  2. Compute HMAC-SHA256 over it with `WHATSAPP_APP_SECRET` and compare it to `X-Hub-Signature-256` (`sha256=<hex>`),
     timing-safe, **before parsing**. A missing or bad signature gets 401, and nothing is stored; only a fixed label is
     logged.
  3. **The tenant comes from the sender's phone.** `WHATSAPP_TEST_PHONES` maps each verified test phone to one tenant
     slug (`+91…=suit-shop,+91…=elite`), resolved through the directory. One number can then serve both merchants.
     *Binding the whole number to one tenant* was rejected: the 24-hour window is read from one tenant's inbox, so the
     other shop's sends would always end `needs_window`. A phone belongs to one tenant at a time.
     `metadata.phone_number_id` must equal `WHATSAPP_PHONE_NUMBER_ID`, or the event is ignored.
     **Meta's `from` is normalised by `e164()` first** (digits without `+` become `+<digits>`, B4), so the map lookup,
     the STOP filter and erasure by phone all match the contact.
  4. **`messages[]`.** A sender not in `WHATSAPP_TEST_PHONES` is dropped and only counted. Whether strangers can message
     a test number is UNVERIFIED; this way a stranger writes nothing either way. Otherwise:
     - insert `ops.inbound_message` in a system scope with no actor, on conflict `(provider_message_id)` do nothing;
     - set `opt_out` by stop-word match;
     - fetch audio or an image in `after()`: media id → URL → download with the token (≤ 1 MB, within the tenant's
       25 MB budget) → `ops.document` (`source = 'inbound'`) plus its blob.
  5. **`statuses[]`.** Update `ops.delivery` by `provider_message_id`.
  6. Answer 200.
- **It never writes a book row and never logs a body.**

### 4.5 A voice note becomes a draft, and only a person starts it

1. The inbox shows the item: the sender (masked by role, §7.5), the time, "voice note" and its status.
2. **A person taps *Transcribe*** (an agent run, trigger `inbox`).
   - The ogg/opus file goes to Voice Transcribe. Hindi and ogg support are UNVERIFIED (lane A), and M0 decides. The
     fallback converts the file to the WAV that `voice.ts` takes today (FACT, ARCHITECTURE).
   - The transcript is stored on the inbox row (ops, erasable), and it never enters a trace (gate H3, existing).
3. **Spark points; code reads.** Spark runs the `reason` role with schema-constrained JSON, the transcript inside a
   `<data>` block. It returns the intent (booking, reply, credit or none) and, for each figure, **only the span
   offsets** in the transcript. It never returns a value.
   - **Core's parser reads each figure from its span** (0016): digits in any script, rupee forms, and the fixed Hindi,
     English and romanised number and date words. It converts rupees to paise, and dates to Asia/Kolkata through the
     one time module. A span it cannot read fills nothing.
   - The `ops.inbound_extract` trigger refuses a span outside the transcript or with the wrong hash.
   - `inbox.extract` then mints the figures as cells. A reply's words go to `ops.message_text`, never into the draft
     payload (B2).
4. **The run proposes** one of:
   - for the salon, a `booking.confirm` draft (the services, date and window as extract cells);
   - for the kirana, a `credit.record` draft (the amount cell plus the customer's `credit.balance`; Should);
   - on any tenant, a `message.reply` draft.
5. **The approver sees** the transcript, the figures with their spans as source chips, Approve and Reject. The English
   gloss is model text, so it passes the same validator, with figures as refs; if it fails it is hidden, never shown with
   free digits.
6. **Approval** executes under the approver.

The model is called only on a person's tap. That bounds its cost, and it keeps Meta's "no consequential actions without
human oversight" (FACT, lane A).

### 4.6 Instagram: an approved card on the founder's own professional account (live deploy only)

- **Where.** It runs on the live deploy only, from a Google session (B3). The card shows the merchant's own product,
  under their permission. The demo deploy holds no Instagram token, and its `campaign.post` drafts send recorded.
- **Access.** The account has the tester role. Standard Access covers accounts with a role on the app (FACT); the
  dev-mode specifics are UNVERIFIED (lane A).
- **The draft.** `campaign.post` carries the caption (the digit rule plus the disclosure line) and the card. Approval
  writes `books.outbound_message` (`instagram`, `public`, `recipient_id` = the campaign) and an `ops.delivery` addressed
  to `INSTAGRAM_ACCOUNT_ID`.
- **The sender.** It creates the container from `image_url` = `/api/v1/media/<slug>/<document id>.jpg` (#9), which serves `card`
  documents only, as JPEG, the one format the API takes (FACT, lane A). Then it publishes, and stores the media id and
  permalink on the delivery.

### 4.7 Labels and gates

- **Labels.**
  - The channel line on every send screen, from the deployment and the mode: "Recorded · nothing is sent" on the demo;
    "WhatsApp · sent to consenting test phones" for the live test number; "Opens your WhatsApp" for a manual link.
  - "Written with AI" on AI copy.
  - The disclosure line inside the message.
  - The tenant label from `data_class`.
- **K2:** planted recipients: one consenting, one who never consented, one who withdrew, one who sent STOP after
  consenting, one erased. Exactly one outbound row results. A consent change between proposal and approval makes the
  draft `stale`.
- **K3:** copy with a free number is refused by the shared detector in core (`\p{N}`, `%`, digit emoji, number words)
  exactly as by the agent's validator. The precision corpus runs against core's copy of the check too. A ref token that
  is not in `basedOn` is refused.
- **K5:** two audiences with the same count but different members (one withdraws, another consents) make the draft
  `stale` (#10). Red-proof: compare only the cited row.
- **K4:** every AI-drafted body carries the disclosure line, and a source scan shows that only the i18n key writes it.
- **W1:** a missing or forged signature gets 401 and stores zero rows. Red-proof: skip the check, and the gate fails.
- **W2:** a replayed event inserts once.
- **W3:** the webhook writes no book row: row counts of every books table are unchanged across a scripted run, and a
  source scan shows it imports no command runner.
- **W4:** a stranger's number stores nothing. A stop word sets `opt_out` and drops that customer from the next audience
  read.
- **W5:** a message approved while the window was open, whose window closed before sending, ends `needs_window`, unsent.
- **W6** (B4):
  - the app's direct `INSERT` into `ops.delivery` cannot choose an address, status or mode, and is refused for a message
    of an earlier transaction;
  - a delivery never returns to `queued`;
  - two concurrent sweeps send one message once (the claim). Red-proof: drop the `where status = 'queued'`.
- **W7:** a STOP or an erasure between approval and send ends the delivery `blocked`, unsent. So does an offer that ends
  in that time.
- **W8:**
  - on the demo deploy, or from a `via=demo` session, every delivery is `recorded` and no adapter but `recorded` is
    called. Red-proof: drop the mode rule.
  - Meta's `from` without `+` matches its contact for STOP and erasure.
  - the webhook answers 404 on the demo deploy.

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
| `POST /api/v1/booking-requests` | `{shopId, name, phone, serviceIds (≤ 3), preferredOn, timeWindow, note?, whatsappUpdates, consentVersion, noticeVersion, botToken, website}` (`website` is the honeypot; `shopId` is the branch the form picked, one of `GET /site`'s shops) + header `Idempotency-Key` | one `ops.site_request`, plus rate counters |
| `POST /api/v1/enquiries` | `{name, phone, itemId?, message, whatsappUpdates, consentVersion, noticeVersion, botToken, website}` + `Idempotency-Key` | the same |
| `GET /api/v1/media/:slug/:id.jpg` | a card image (kind `card` only). The slug finds the tenant, because RLS hides the document otherwise (#9); this route takes no key, since Instagram's fetcher sends none | nothing |

- **A Figure** is `{"minor": 249900, "currency": "INR", "ref": "⟨snap:…·12·price⟩", "source": "books.price:<id>"}` for
  money and `{"value": 45, "ref": "…"}` for an integer. Every Figure is a cell of the latest release's snapshot of a
  read over the books (gate S3), so **every figure the API returns is a book row**.
- **A POST** answers `202 {"id": "<request id>", "received": true}` and never echoes a name or a phone. A filled
  honeypot gets the same 202 and stores nothing, so a bot learns nothing.
- **`GET /api/v1/site`** also lists the tenant's shops (id, name, area: for Elite, Kirti Nagar and Kalkaji), and the
  current `privacy_version` and `consent_version`. A POST whose versions differ gets 400 `stale_notice`, and the SDK
  refetches (#13).
- **On the demo deploy,** a POST stores sample values only, and the form says "Sample site · what you type is not stored
  or sent to the shop" (0017, B3). *Disabling the demo forms* was rejected: the film and the judges need to see a
  request arrive, and replacing the values keeps every real name out of the demo database.
- **On the live sites,** which the submission links (A4), judges may send test requests to the real shops. The forms
  keep the bot check and every rate limit, and the owner marks such a request spam and erases it (`request.erase`).

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
- **Deploy projects.** One per business and environment: `suit-shop`, `suit-shop-demo`, `elite`, `elite-demo`. Each is
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

### 5.7 Gates S1–S10

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
- **S9:**
  - a release naming a non-`site.*` snapshot, or one minted in an earlier transaction, is refused (B8; red-proof: drop
    the trigger);
  - publishing from a `via=demo` session is refused;
  - the media route serves only `card` documents, under the slug's tenant.
- **S10:**
  - on the demo deploy, a POST with a real-looking name and phone stores "Sample customer" and `+910000000000`;
  - a direct insert of any other phone there is refused;
  - stale versions get 400;
  - a `shopId` of another tenant is refused.

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
   - **The verified email must equal the invite's email** (Munim binds invites the same way, F). Otherwise: 404. The
     invite's email is set to NULL in the binding transaction; no table keeps it after that (B1).
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
5. **The database refuses a demo session row for a live tenant** (`ops.login_session_via`, #12). Even a core bug
   cannot mint one.
6. **A demo session reaches no real person** (B3). `munshi.via = 'demo'` forces every delivery it approves to
   `recorded`, and refuses a site release. On the demo deploy every session is a demo session, and the deploy holds no
   channel credentials. Real channels and publishing therefore need a Google session on the live deploy.

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
- **F7:**
  - inserting `ops.login_session` with `via = 'demo'` for a live tenant is refused (red-proof: drop the trigger);
  - `munshi.via = 'demo'` makes every delivery `recorded` and refuses a release;
  - no email survives a consumed invite;
  - two owners deactivating each other at once leave one active owner (#11).

## 7 · Real personal data: notice, consent, retention, erasure, who sees it

### 7.1 What enters, and where it lives

| Data | Enters through | Held in (ops, erasable) | What the books hold |
|---|---|---|---|
| name, phone, branch, preferred time, note, the WhatsApp box | a live site's form (a demo site stores sample values only) | `ops.site_request` | nothing until a person confirms |
| phone, text, voice note, transcript | WhatsApp (live deploy, the verified test phones only) | `ops.inbound_message`, `ops.document` + `ops.document_blob` | nothing until a person acts |
| the words of a reply or a campaign | a person, or Spark under a person's tap | `ops.message_text` | `body_sha256` only, for free text to a person |
| a staff member's name, phone, Google address | an owner adding or inviting them | `ops.member`, `ops.contact` (via `books.staff`), `ops.member_invite` (until used) | `books.staff.contact_id`; audit entries hold `{member_id, role}` only |
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
- **AI (on for live tenants too, A2).** The shop uses Meta's AI models through the Meta Model API to answer questions
  about its own books and to draft messages. They run on Standard model ids, which do not train on the data, never
  Contributor ids (FACT, lane A). What the models see, said plainly (fix 2, finding 3):
  - figures and item names from the shop's books, as snapshot cells. No cell holds a customer's or staff member's name
    or phone (7.4).
  - **the questions staff type or speak to Munshi, as they are written or said.** A question such as "Priya ka
    udhaar?" names a customer, and that name goes to Meta's model.
  - **a WhatsApp voice note or message, when staff tap *Transcribe* on it:** the sender's own words, names included.
  - Before any text goes to a model, code replaces phone-shaped digit runs with "[phone]". Names cannot be removed
    reliably, so they are disclosed here instead.
  
  None of this is kept by Munshi beyond the erasable transcript (7.3), and none of it enters a trace. Every AI-drafted
  message says so in its disclosure line.
- **Payments:** none are taken here.

**Each merchant's signed agreement** says the same thing in the merchant's own terms. Under Standard model ids only, the
shop's books' cells, staff's typed and spoken questions, and the voice notes staff choose to transcribe are sent to
Meta's Model API. The questions and voice notes may name people; phone numbers are masked first. It sits beside the existing permission page
(`PERMISSION-AND-INTAKE.md`), and the founder drafts it.

Meta's Model API terms require both a privacy policy and an AI-output disclosure (FACT, lane A). DPDP's duties phase in
around May 2027 (FACT per law-firm summaries, lane B); this follows them now as practice. The founder reviews the
wording; this is not legal advice.

### 7.2 Consent on the forms

- **The box.** It is separate, unticked by default, and has its own label: "Send me updates and offers from <shop> on
  WhatsApp". The booking needs no tick, because the request is the person asking to be contacted about it, and those
  service messages need no marketing consent.
- **What the form sends.** `consentVersion` and `noticeVersion`. They must equal the site's current versions (400
  `stale_notice` otherwise, #13), and the request row keeps them.
- **A tick is not consent yet: double opt-in** (#13). A web form cannot prove the phone belongs to the person typing.
  So a ticked box only makes the booking confirmation end with "Reply YES for offers on WhatsApp", and no consent row
  exists until the phone's owner answers. Then a person records it with `consent.record`: `whatsapp_reply`, with the
  inbound YES as evidence, on the live test number; or `in_chat_attested`, when the YES arrived in the staff's own
  WhatsApp after a manual-link send. An unticked box writes nothing, and asks nothing.
- **Withdrawal.**
  - STOP on WhatsApp takes effect at once, read-side (§3.5), and a person records it with `consent.record`
    (`granted = false`).
  - At the counter, withdrawal is `consent.record` too.

### 7.3 Retention and erasure (the founder's defaults, 28 Oct, A3)

| Data | Kept | Then |
|---|---|---|
| booking requests and enquiries (`site_request` name, phone, note) | **90 days after closed** (confirmed, declined, spam or closed; a request still open after 30 days is closed by the purge). On the demo deploy only sample values exist, purged after 7 days for free-tier storage | set to NULL by the daily purge; the row stays, for counts |
| inbound WhatsApp messages and voice notes (text, transcript, media) | **30 days** after receipt; voice audio sooner (0016). An `opt_out` row is kept until a withdrawal row follows it (§3.5) | set to NULL; blob bytes set to NULL |
| reply and copy text (`ops.message_text`) | 30 days after its message's final status; campaign copy while its campaign is shown | set to NULL; the book keeps the hash |
| `delivery.to_address` | 30 days after the final status | set to NULL |
| invites' email | until used or expired | set to NULL |
| rate counters | 1 day | deleted |
| `ops.contact`, and with it the person behind every consent record | **while the customer is active, plus 1 year** (active: a sale, credit entry, package or loyalty entry, booking or message in that time) | erased by the daily purge (`retention`), unless a balance is open |
| books (sales, credit, packages, consent, messages) | as accounting records; they hold no personal data | never; they hold ids. A consent row outlives its contact as an id-only record |

The purge touches ops only, never a book row, so it needs no approval. It runs on the daily cron in a system scope and
records `erase_reason = 'retention'`. If a day's cron is missed (A1), the owner's next page load runs it.

**Erasure on request** (`contact.erase`; owner only; the demo deny-list refuses it on demo tenants):
- **Held while the customer owes credit or holds an unexpired package balance,** with the reason shown to the owner
  (A3). Screens say "Waiting: credit ₹… open" or "Waiting: package balance open", with the figure as a `credit.balance`
  or `package.balance` cell. `erase_requested_at` records the request, and the daily purge completes it the day the
  balance reaches zero, so it is never forgotten. The hold is a legal or contractual ground to keep the record
  (INFERENCE; the founder accepted the default).
- **One transaction:**
  - the contact's name and phone become NULL, and `erased_at`, `erased_by` and `erase_reason` are set;
  - every `ops.site_request`, `ops.inbound_message` (and its media blobs), `ops.message_text` addressed to them and
    `ops.delivery` with that phone has its personal columns set to NULL;
  - the audit entry `contact.erase` carries `{contact_id}`.
- **What remains:**
  - book rows that name the customer by id: sales, credit history, consent history, package and loyalty entries, and
    outbound messages, whose free text is only a hash;
  - the audit chain, intact: no personal data was ever in it for a vault-backed customer, and reasons are codes (0019);
  - draft payloads, which hold ids, codes and hashes only (B2);
  - the erased contact row. Screens show "Erased customer · C-1a2b".
- **What erasure cannot reach:**
  - names written to `books.customer` and `books.staff` on the synthetic kirana: invented people. The PII1 trigger
    keeps showcase and live tenants free of them.
  - a message staff sent from their own WhatsApp app, outside Munshi.

**Request erasure** (`request.erase`, owner or manager) nulls one request's personal columns at once, for a judge's test
or a spammer (A4).

**Gate E1:** after erasure, the phone and the name appear in no column of any table of that tenant (every text, jsonb
and bytea column is scanned). The positive control is the same scan finding both before erasure. Erasure is refused
while a credit balance is open.

### 7.4 The agent sees ids and counts only

- The agent role gets **no grant on any new table** (G1 over the manifest).
- `agent_view.customer` and `agent_view.staff` show the book row's `name`, which is NULL for every vault-backed person,
  as is every showcase and live customer and staff member.
- **No named read puts personal data into a snapshot cell:** no contact name or phone, no request note, no inbound text
  or quote. The agent role can read every cell of its tenant (FACT, 0003), so screens fetch names through a plain core
  read and show them beside the cells. Gate PII2 scans the cells.
- **The existing reads keep their `customer` column, and it is NULL for a vault-backed customer.** Those reads are
  `credit.balance`, `credit.balances`, `watch.overdue_credit` and `sale.receipt` (FACT, `c.name as customer` in
  `queries*.ts`). `toCell` stores NULL as a `null` cell (FACT, `snapshots.ts`). Each read is keyed by `customer_id` or
  `line_no`, never by name, so two unnamed customers cannot collide in one finding's dedupe key (FACT, `key:
  ['customer_id']`). The screens that show these names (credit book, receipt, overdue card) take the name from
  `people.ts` by id. That is MS-24's core function and MS-30's screen work (§11).
- The model sees a transcript only when a person taps *Transcribe*, inside a `<data>` block, and only on the live deploy,
  where WhatsApp runs. Transcripts never enter traces (H3).
- **AI is on for live tenants** (A2). These rules keep stored personal data away from Meta, but not everything:
  **a staff member's own question and a tapped transcript reach the model as written**, and they may name people. This
  is disclosed in the notice and in the merchant agreement (7.1), not hidden.
- **PII2's scope** (fix 2, finding 3), run on a live-class tenant with real-looking contacts through every agent flow,
  recorded:
  - **scanned, and must hold no planted name or phone:** snapshot cells, agent views, traces, audit payloads, draft
    payloads, decision reasons;
  - **scanned, and must hold no planted phone:** every outgoing model request in the recorded fixtures, including a
    question and a transcript that each contain a planted phone. Each must show "[phone]" (red-proof: drop the
    redaction);
  - **disclosed instead, not scanned for names:** the question text and the transcript inside those requests.
- **Gate AI1.** The model config refuses any model id that is not a Standard id: a `-contributor` suffix, or any id
  outside the edition's list, fails at startup (red-proof: plant a contributor id). PII2 runs on a live-class tenant,
  with real-looking contacts, through every agent flow, recorded.

### 7.5 Who sees what

| Who | Name | Phone | Request note, inbound text | Confirm | Erase |
|---|---|---|---|---|---|
| owner | yes | full | yes | yes | yes |
| manager | yes | full | yes | yes | no |
| staff | yes | last four digits (`•••• 1234`) | yes | no (decline only) | no |
| agent | no (an id) | no | no | no | no |

- **Masking happens in core's read functions,** which take the session. *A masking view in the database* was rejected:
  the app role reads the base table either way, so it would add a layer without adding a boundary.
- **On the demo deploy every screen masks phones for everyone,** so film and screenshots cannot show one. The demo
  holds invented and sample phones only.
- **Gate V1:** a staff session's request list and customer page render no full phone (the HTML is scanned).

### 7.6 Staff are people too (B1)

- **On showcase and live tenants, a staff member's name and phone live in `ops.contact`,** and `books.staff` holds
  only `contact_id` (0012).
- **`ops.member`** keeps the name and phone the app needs to sign them in and to say "approved by". Once the member is
  deactivated, both are erasable (0013).
- **The audit chain holds `{member_id, role}` only,** because 0010 replaces `ops.member_audit()`.
- **Google:** the global login table holds no email, and the invite's email is nulled when it is used.
- **Retention:** a deactivated member's name and phone are erased on the owner's request, or 1 year after
  deactivation by the purge. Decisions they made keep their member id; screens show "Former staff · M-1a2b".
- **The privacy notice** has a staff section, in the app at sign-in, saying the same.

## 8 · Keeping real data out of the submission: two deploys

### 8.1 Decision: two deploys on two databases

| | Demo deploy | Live deploy |
|---|---|---|
| Database | its own Neon project | its own Neon project |
| `ops.deployment` | `demo` | `live` |
| Tenants | kirana (synthetic); suit shop and Elite (showcase) | the suit shop and Elite (live; Elite with its two branches) |
| Sign-in | the demo picker only (`via=demo`) | Google + invites only |
| Channels | **none**: the recorded sender only, no channel credentials; a recorded inbound fixture (B3) | the WhatsApp test number and its ≤ 5 verified, consenting phones; Instagram to the founder's account; manual links for real customers |
| Sites | `<slug>-demo` builds, with the "Sample data" ribbon; forms store sample values only | `<slug>` builds: real catalogue, real requests; linked from the submission (A4) |
| Who sees it | judges, the film, screenshots, the README | the merchants, their staff, their customers |

**Why two deploys.**
- **Separation is physical.** No query, bug or env-variable slip in the demo can reach a real customer.
- **The judges keep their passwordless picker,** with nothing real behind it.
- **Meta's perpetual licence** over the submitted materials (FACT, the rules via the synthesis) never touches a real
  customer.
- **The live deploy can change on the merchants' timetable** after 5 Nov.

*One deploy with fencing* was rejected. A single wrong variable, or one bug in the picker, would sit one step away from
real phones, and the film's guarantee would rest on code paths instead of on where the data is.

**Free plans only** (founder, A1: "these are trial websites for these merchants and I'm not charging them yet").
- **Neon free: one project per database.** That makes two projects. `0001` creates the roles cluster-wide (FACT,
  `create role` in 0001), so two databases in one cluster would collide on role names. The free tier's project limit is
  UNVERIFIED.
- **Neon free storage is small** (size UNVERIFIED), so media is capped and purged early (0016, §7.3).
- **Vercel Hobby: two app projects plus four site projects.** Nothing relies on a frequent cron: Hobby crons run at most
  daily (UNVERIFIED). The outbox flushes in-request with `after()`, plus sweeps on approval and on owner page loads
  (§4.1). Retention runs daily, and on the owner's next page load if a day is missed.
- **Hobby's non-commercial-use term** is a founder risk, recorded in §12 with no workaround (UNVERIFIED).

### 8.2 What the submission holds

- The demo URL and the repo. The repo carries the merchants' catalogue and photos under signed permission, plus invented
  customers, and never a real customer's data.
- The film and the screenshots.
- **The live sites, linked and shown in the film** (A4). They are public pages showing the merchant's own catalogue,
  under permission. Their forms are real, so judges may send test requests: the forms keep the bot check and every rate
  limit, and the owner marks such a request spam and erases it (§5.2, §9). No request, customer or live app screen
  appears in the submission.

### 8.3 How the film and screenshots are held to synthetic tenants

The capture guard (`scripts/capture-guard.ts`) has **two modes, chosen by the caller and checked against the page**
(fix 2, finding 2). Fix 1 required `/api/health = demo` and a `data-class` on every page, so a live public page could
never pass, and an implementer would have added a path exception. The modes replace that.

1. **`--mode app`,** for every app screen.
   - The target's `GET /api/health` must say `deployment: demo`.
   - Every captured page must carry `<html data-class>` of `synthetic` or `showcase`, and a slug in the allow-list of the
     three demo tenants. A missing or `live` value fails.
   - The demo database refuses live tenants (T1), so this mode can only ever see demo data.
2. **`--mode site`,** for the merchants' public site pages, live or demo (A4).
   - Every captured page must carry the marker `<meta name="munshi-surface" content="public-site">`. Only `apps/sites`
     renders it: a source scan fails if `apps/web` ever does.
   - The page must not be in a form-result or request state (`data-state` absent).
   - The guard **refuses any URL on either app deploy's origin** (both `MUNSHI_PUBLIC_URL`s are in its config). A live
     app page therefore fails even if it carried the marker.
3. **Phones are masked on every demo screen** (7.5).

Red-proofs, each exiting non-zero:
- an app page in `--mode site` (its origin is refused);
- a page on the live app's origin with the marker planted;
- a site page in `--mode app` (no `/api/health = demo`);
- a demo page carrying `data-class="live"`.

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
- **The token's hostname is checked** (rank 3). Turnstile's verification reply names the hostname that rendered the
  widget (UNVERIFIED field name: `hostname`), and it must be the host of one of the site's allowed origins. A token
  solved on another site cannot be replayed here.
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
- **Spam and judges' tests** (A4): staff mark a request spam (`request.spam`), and the owner or a manager can erase it
  at once (`request.erase`). Otherwise it is purged 90 days after closing, as every request is (§7.3).

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
| `CRON_SECRET` | both app deploys | authenticates Vercel's daily cron call (Vercel's own convention name, UNVERIFIED); the cron is a last resort, never relied on (A1) |
| `MUNSHI_SEND_MODE` | both app deploys | `recorded` (default) or `live` |
| `TURNSTILE_SECRET_KEY` | both app deploys | the server-side bot-check verification |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | live app | staff sign-in |
| `WHATSAPP_ACCESS_TOKEN` | live app | the permanent system-user token |
| `WHATSAPP_PHONE_NUMBER_ID` | live app | the test number's id; the webhook ignores any other |
| `WHATSAPP_APP_SECRET` | live app | checks `X-Hub-Signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | live app | the webhook's GET handshake |
| `WHATSAPP_TEST_PHONES` | live app | each verified test phone mapped to its tenant's slug (`+91…=suit-shop,+91…=elite`). Any other sender is dropped. These are real numbers: treat them as secret |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID` | live app | posting an approved card to the founder's professional account |
| `MUNSHI_SITE` | each site project (build time) | the business slug the build bundles |
| `MUNSHI_API_BASE` | each site project | the matching app deploy's origin |
| `NEXT_PUBLIC_MUNSHI_SITE_KEY` | each site project | the publishable key (public by design) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | each site project | the bot-check widget |

**The demo app holds no channel credential at all** (B3): no `WHATSAPP_*`, no `INSTAGRAM_*`, no Google client. A test
refuses a demo deploy config that names one.

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
| **MS-22a** Registry split and draft hooks | Sonnet | S | Must, first | `packages/core/src/{commands.ts, queries.ts, approvals.ts}`; new empty `commands-{people,packages,messaging,grid}.ts` and `queries-{offers,people,packages,campaigns,sites,grid}.ts`; `customer.create` and `staff.create` moved unchanged into `commands-people.ts`; `packages/core/test/hooks.test.ts` | none | A command whose `checks` returns a bad path is refused at proposal and stale at approval (red-proof: remove the call). A money draft naming a `holdingId` without a `package.balance` cell is refused. `runCommand` refuses every `draftOnly` command (red-proof: drop the flag). `decide()` takes a reason code. Every existing gate is unchanged |
| **MS-22b** One number detector and the span parser in core | Opus | S | Must | `packages/core/src/{numbers.ts, read.ts}`, `packages/agent/src/{answer.ts, words.ts}`, `packages/core/test/numbers.test.ts` | MS-22a | The agent's validator imports the detector from `@munshi/core/read`, and the precision corpus (199 clean, 157 attacks) passes unchanged through both the agent and core. Gate EX2 runs the word, composition and date forms against a hand-written key. The span parser reads digits in any script, rupee forms and the fixed number and date words, and refuses everything else. Red-proof: weaken core's copy, and a corpus attack passes core, so the gate goes red (B5) |
| **MS-19a** Migrations 0010–0013 | Opus (migrator) | M | Must | `db/migrations/0010–0013`, `manifest.json`, `db/test/{tenancy,people,sign-in,globals}*.test.ts`, the sabotage entries, `docs/SCHEMA.md` | none | OE1 (every exploit path refused, red-proved against the fix-1 rule), `member_audit` replaced in 0010, T1, T2, PII1 (customer and staff, showcase and live), PII3, the database parts of F4, F5 and F7. `ops.only_erase` red-proved both ways (fill once, erase). `ops.deployment` is immutable. G9 asserts `prosecdef = false`. G13 covers the global tables. The G1, G4, G9 and G10 counts rise by exactly the manifest's new entries |
| **MS-19b** Migrations 0014–0020 | Opus (migrator) | L | Must (0020 Should) | `db/migrations/0014–0020`, `manifest.json`, `db/test/{offers,packages,messaging,sites,guard,reasons,grid}*.test.ts`, `docs/SCHEMA.md` | MS-19a | The extract trigger's digit-span parse (red-proof: ₹500 against 60,000 paise). Test-send deliveries derive only the acting member's phone. The demo trigger pins name, phone and note. L1, L2, P2's database part, D1, D2, R1. W6's database part (the derived delivery, the state machine, at-most-once). `ops.release_check` (S9), the demo sample-phone trigger (S10), and the expired-window-only DELETE. `MS009`, `MS011`, the extract span trigger, one-way key revocation. **Rank 1 and the listed rank 2 items land here, before any builder writes a send** |
| **MS-20** Business registry, provisioning, seeds, reset as owner | Opus | M | Must | `packages/core/src/{business.ts, tenancy.ts, watchers.ts}`, `apps/web/lib/{business.ts, nav.ts}`, new `apps/web/lib/i18n-<type>.ts`, `db/src/{provision.ts, reset-demo.ts, dev.ts}`, `db/seed/{suit-shop.ts, elite.ts, merchants/**}`, `db/test/business*.test.ts` | MS-19a | The totality test and the type-literal scan. **T3 run as `munshi_owner`** (B7): a planted live tenant refuses, a showcase-only reset leaves the others' counts unchanged (red-proof: the old `select … from ops.tenant`). `provision` is idempotent. Elite is seeded with two shops and its customers through the vault. `listDemoTenants()` never returns a live tenant (F3) |
| **MS-21** Real sign-in and the fence | Opus | **L** | **Must** | `apps/web/app/{sign-in,invite,auth,settings/people}/**`, `apps/web/lib/server/{session.ts, config.ts, db.ts}`, `packages/core/src/{session.ts, members.ts, logins.ts}`, `apps/web/test/sign-in*.test.ts`, `db/test/fence*.test.ts` | MS-19a, MS-20 (`listDemoTenants`) | F1–F7. The Session carries `via`, and `withTx` sets `munshi.via` beside the actor (B3 gate extended). The Google exchange sits behind an adapter with a recorded fake, so no gate calls Google. Member erasure works only after deactivation. Screenshots at 390 and 1280 of sign-in, the picker, the invite, "ask for an invite" and people with their sessions |
| **MS-24** People: contacts, staff, consent, requests, erasure, retention, phones | Opus | M | Must | `packages/core/src/{commands-people.ts, queries-people.ts, people.ts, retention.ts, phone.ts}`, `db/test/people*.test.ts` | MS-22a, MS-19a, 0017 | PII2, E1, K1, K5 (double opt-in), V1's core part, PII3's core part. The retention purge runs on the founder's defaults (A3). An erasure held by a balance completes the day the balance clears. `request.spam` and `request.erase`. Core's one `e164()`, used by every phone path. The demo deny-list refuses erasure on demo tenants |
| **MS-22** The counter's money: services, variants, offers, discounts, loyalty, package lines | Opus | L | Must (loyalty Should) | `packages/core/src/{commands.ts, queries-offers.ts, money.ts}`, `db/test/counter*.test.ts` | MS-22a, MS-19b (0014, 0015) | I1–I3, O1, O2, L1, P3, and P1's sale half. The quote equals the sale to the paisa, and every new journal balances |
| **MS-23** Packages: plans, redemption, expiry | Opus | M | Must | `packages/core/src/{commands-packages.ts, queries-packages.ts}`, `db/test/packages-core*.test.ts` | MS-22 | P1, P2, P4. The expiry draft goes stale after a redemption (red-proof: drop `holdingId` from `CURRENT`) |
| **MS-25** Messaging: campaigns, outbox, senders, webhook, inbox | Opus | L | Must (Instagram Should) | `packages/channels/**`, `packages/core/src/{commands-messaging.ts, queries-campaigns.ts, outbox.ts, inbox.ts}`, `apps/web/app/api/{webhooks,cron}/**`, their tests | MS-22a, MS-22b, MS-19b (0016, 0018), MS-24 (contacts, `e164`) | `campaign.test_send` writes no book row. Campaign copy is always referenced by `text_id`. K2, K3, K5's whole-set recheck (#10), W1–W8. The claim, send-time recheck, `not_after`, at most once. The webhook runs on the live deploy only, and the demo inbox replays a recorded fixture. Words live in `ops.message_text`, and payloads hold ids and hashes. Gates use only the recorded sender. The outbox flushes in-request, sweeps on approval and page load, and the daily cron is a last resort |
| **MS-26** Agent: campaign copy, voice note → spans → draft, desks by type, the expiry recipe | Opus | M | Must | `packages/agent/**` and its tests and fixtures, except the files MS-22b owns | MS-22b, MS-25 (inbox), MS-23 (expiry read) | Copy carries refs only, and a free number abstains. K4. The model returns spans, never values, and every figure is parsed by core from its span (B2). A transcript never reaches a trace (H3 extended). AI1 (Standard model ids only). Phone-shaped runs become "[phone]" before any question or transcript reaches a model (PII2's request scan; red-proof: drop it). The desks pass the totality test |
| **MS-28** Developer kit: `/api/v1`, keys, releases, intake, limits, SDK, docs | Opus | L | Must | `apps/web/app/api/{v1,health}/**`, `apps/web/app/developers/**`, `packages/core/src/{site.ts, site-api.ts, queries-sites.ts, rate.ts}`, `packages/sdk/**`, `db/test/site*.test.ts`, `apps/web/test/api-v1*.test.ts` | MS-22a, MS-19b (0017), MS-24 | S1–S7, S9, S10, and S8's SDK half. The media route with the slug (#9). Version equality (#13). Turnstile's hostname check. Demo POSTs store sample values only. `GET /site` lists the shops, and the booking request names one |
| **MS-29** The merchant sites | Sonnet | L | Must | `apps/sites/**` | the MS-16a sign-off, MS-28's SDK | Both businesses build. The bundle-isolation gate and the import closure are red-proved. Elite's booking form picks Kirti Nagar or Kalkaji. The demo builds show "Sample site · what you type is not stored or sent to the shop". Screenshots of every page at 390 and 1280 for each build (demo and live). The forms post through the SDK to a local API. Inputs ≥ 16 px, targets ≥ 48 px, contrast ≥ 4.5:1 |
| **MS-30** App screens: requests, campaigns, inbox, packages, offers, counter changes, customer names from `people.ts`, *Developer kit* settings, privacy | Sonnet | L | Must (loyalty screens Should) | `apps/web/app/{requests,campaigns,inbox,packages,offers,counter,credit,settings/developer,privacy}/**`, new `apps/web/components/*` and `apps/web/lib/server/*` files for them, plus the existing `lib/server/{credit,counter,home}.ts` for the name lookup | the MS-16b sign-off; MS-22–MS-28 | Every state in MS-16b's specs screenshotted at 390 and 1280. V1. Labels from `data_class`. Each AI surface's "Cannot verify" and hidden states. A vault-backed customer's name shows on the credit book, the receipt and the overdue card, and an erased one shows "Erased customer" |
| **MS-27** `grid.apply` | Sonnet | M | Should | `packages/core/src/{commands-grid.ts, queries-grid.ts}`, `apps/web/app/stock/table/**`, `apps/web/lib/grid/submit.ts` | MS-18, MS-19b (0020) | GR1–GR4 |
| **MS-33** Two deploys on free plans, hosted demo reset, capture guard | Sonnet | M | Must | `deploy/**`, `docs/DEPLOY.md`, `scripts/{deploy-check.ts, capture-guard.ts}`, `db/src/deploy-check.ts`, `vercel.json` per project | MS-20 | `deploy-check` refuses a demo URL whose database says `live`, and the reverse, and refuses a demo config that names any channel credential (B3). The capture guard's two modes and their four red-proofs (8.3). A dry run of `provision --class live` on embedded Postgres with `deployment = live`. Free plans only (A1) |

**Parallel plan.**
1. MS-22a and MS-19a run first.
2. Then MS-22b, MS-20, MS-24 and MS-19b.
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
| W5-B (fix cycle 1 added MS-22b and about 1.5 lane-days of guarantee work across MS-19a/b, MS-24 and MS-25) | ≈ 24.75 |
| W5-C | ≈ 3.5 |
| Guarantee reviews and fix cycles (~30%) | ≈ 8.5 |
| **Total** | **≈ 37** |

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

## 12 · Open questions and risks

**Answered by the founder on 28 Oct** (now in the body):
- free plans only (A1);
- AI on for live tenants (A2);
- the retention defaults (A3);
- the live sites linked from the submission and shown in the film (A4);
- the salon is Elite Unisex Salon & Academy, two branches.

1. **Risk, no workaround: Vercel Hobby's non-commercial-use term** (UNVERIFIED this session). The live deploy and the
   live sites serve two real businesses, though nothing is charged. The founder holds this risk. Neon's free project
   limit and storage size are also UNVERIFIED.
2. **The film's WhatsApp beat.** Webhooks and real sends now run only on the live deploy (B3). The in-app voice-note and
   campaign beats are therefore recorded and labelled on the demo. A shot of a message arriving needs the founder's own
   test phone, receiving from the live deploy (§4.3). Use it or not?
3. **The merchants' AI clause.** Each signed agreement must say that the shop's books' cells go to Meta's Model API
   (Standard ids only). The founder drafts it beside the permission page (§7.1).
4. **Roles.** `booking.confirm` is owner and manager here; a salon receptionist may be staff. `campaign.send` is owner
   only.
5. **GST stays unmodelled,** as today. Site and counter prices are as the merchant enters them. Each merchant's GST
   status is still open (D-037), and a composition dealer needs a bill-of-supply mode (lane B).
6. **For the orchestrator:**
   - relaxing NOT NULL on `books.customer.name`, `books.staff.name` (0012), `books.outbound_message.body` (0016) and
     `ops.member.name` (0013);
   - replacing `books.guard()` and `ops.member_audit()` in place (0018, 0010);
   - the one DELETE grant (`ops.rate_counter`, expired windows only);
   - `NOT VALID` reason checks (0019);
   - India-only phones; one site per tenant; staff without a Google account cannot sign in in v1; staff are
     tenant-wide, not per branch.
7. **Whether the suit shop sells fabric by the metre,** which would add a unit `m` in 0011. UNVERIFIED need. The suit
   shop's name is still pending.

*What this document does not decide:* screen layouts (MS-16a and MS-16b, awaiting the founder's choice), the card image
library (M0), and the wording of the privacy notice (the founder's review).
