# Munshi as a platform: orders, packs and switches, widgets, cache, and the order of work

The brainstorm's spec (superpowers:brainstorming), Thu 29 Oct 2026. It **adds to** `docs/BLUEPRINT.md` and does not
replace it. It folds into the blueprint together with the schema review
(`hackathon/meta-ai-developer-hackathon/review-2026-10-29/R4-schema-review.md`). The founder's decisions behind it are
D-047 to D-050 in `hackathon/_meta/DECISIONS.md`. Tags: **FACT**, **INFERENCE**, **UNVERIFIED**.

---

## 1 · What Munshi is

- **One service, many capabilities.** All of the backend lives with Munshi. A shop takes the capabilities it needs and
  uses them in three ways:
  - Munshi's own app (owner and staff);
  - a Munshi-hosted shop site;
  - or its own website, through the API and embeddable widgets.
- **Pack, then switch.** A shop starts from a starter pack for its type (kirana, salon, boutique), then switches any
  capability on or off.
- **The goal is the Meta hackathon (D-048).** The judged story is **one shop day** that passes through the four AI
  moments:
  1. a customer's WhatsApp chat or voice note becomes a draft order;
  2. the owner asks by voice in Hindi;
  3. a photo becomes books (a shelf count, a bill);
  4. the back office finds lost money.

  Each moment ends with a named person's tap.
- **The One Guarantee is unchanged** and holds for every addition below (§7).

---

## 2 · Capabilities, packs and switches (D-050, design A)

### 2.1 Reference data

| Table | Columns | Seeded with |
|---|---|---|
| `ref.capability` | `code text pk`; `label_key`; `needs_grant bool` (the superadmin must grant it first) | `counter`, `credit`, `stock`, `buying`, `orders`, `stitching`, `bookings`, `holds`, `cart`, `offers`, `loyalty`, `packages`, `messaging`, `campaigns`, `staff`, `salary`, `gst`, `site`, `api`, `ai`, `variants`; `needs_grant` on `ai`, `messaging`, `site` |
| `ref.capability_requires` | `capability → ref.capability`, `requires → ref.capability`; pk both | `credit→counter`, `gst→counter`, `offers→counter`, `loyalty→counter`, `packages→counter`, `stitching→orders`, `cart→orders`, `cart→site`, `holds→site`, `campaigns→messaging`, `salary→staff`, `bookings→staff`, `variants→stock` |
| `ref.pack_capability` | `business_type → ref.business_type`, `capability → ref.capability`; pk both | kirana: counter, credit, stock, buying, orders, offers, messaging, staff, gst, site, ai. Salon: counter, credit, bookings, packages, offers, loyalty, messaging, campaigns, staff, salary, gst, site, ai. Apparel (shown as "Boutique"): counter, credit, stock, buying, variants, orders, stitching, holds, cart, offers, messaging, campaigns, staff, gst, site, ai |
| `ref.command_capability` | `command → ref.command`, `capability → ref.capability`, `use text` start\|finish; pk (command, capability) | every command (gate CAP1; every row is listed in BLUEPRINT §2.10.14). `start` begins new use (`order.confirm`, `package.sell`, `campaign.send`); `finish` completes an open obligation (`order.step`, `package.redeem`, `sale.record` naming an order or a hold) |
| `ref.capability_item_kind` | `capability → ref.capability`, `item_kind` good\|service\|package; pk both | counter→good, stock→good, bookings→service, stitching→service, orders→good, packages→package |

The code `apparel` is kept (it is already in the blueprint and the seeds); the label reads "Boutique".

### 2.2 The switch

| Table | Columns | Keys | Grants | Rules |
|---|---|---|---|---|
| `ops.capability_switch` | [T] `id`, `capability → ref.capability`, `is_on bool`, `by` (a member, or NULL inside the tenant's creation transaction), `at`, `created_txid` | `switch_latest (tenant_id, capability, at desc)` | A: S I · J: S | **append-only; the latest row per capability wins.** `capability_guard`: only an active owner inserts. Switching on needs every `requires` to be on. Switching off is refused while a capability that depends on it is on. Sign-up inserts the pack's rows in the tenant's creation transaction (`by` NULL, admitted only then). Each insert is audited `capability.switch {capability, is_on}` |

- **What a shop can use** = its latest switch is on **and**, for a `needs_grant` capability, the superadmin's grant is
  on. That grant is `platform.shop_config` for AI and the site, and `platform.channel_grant` for messaging. Core
  computes it once per request as `can(session, capability)`, inside the page's one transaction.
- **When a capability is off:**
  - its `start` commands refuse (a new error code, `capability_off`);
  - its `finish` commands still run, so an open package balance, an open order or a live hold can be completed;
  - its screens, desks, watchers, API routes and widgets hide or answer 404 (public routes; gotcha 16);
  - **nothing in the books is ever deleted or hidden from reports.**
- **`ops.tenant.business_type` stays fixed.** It now means the pack the shop started from. Desks (§7.2 of the
  blueprint), watchers (§7.3), screens and the API are keyed by capability, not by type. The blueprint's "type literal
  outside the registry" scan becomes "capability literal outside the registry".

### 2.3 Gates

| Gate | Holds | Red-proof |
|---|---|---|
| CAP1 | every command has a `ref.command_capability` row | delete one row |
| CAP2 | with a capability off, each `start` command refuses and each `finish` command runs | drop the check in `runCommand` |
| CAP3 | the desk, watcher, screen and route registries cover every capability, and none names a business type | add a type literal |
| CAP4 | switch-on with a missing dependency, and switch-off under a dependant, are refused | drop the dependency check |

### 2.4 Amended after R4 (29 Oct)

The orchestrator's ruling 2 on R4 (`docs/superpowers/plans/2026-10-29-w1-database.md`) amends this section. The tables
above are updated to match; BLUEPRINT §2.5, §2.10.1, §2.10.14 and §8.13 hold the folded design.
- **Kept from this spec:** switching off refuses the capability's `start` commands and allows its `finish` commands.
  R4's alternative, refusing switch-off while balances are open, is **not** adopted.
- **The book guard never checks capabilities; core does.** So switching off can never block a reversal of an existing
  book row.
- **`ref.business_type` drops `item_kinds`, `has_variants` and `has_calendar`.** It only names the starting pack.
- **New table `ref.capability_item_kind (capability, item_kind)`**, which says which item kinds a shop may create:
  counter→good, stock→good, bookings→service, stitching→service, orders→good, packages→package.
- **New capability `variants`.** It requires `stock`, is in the boutique pack, and allows variant attributes and
  variant parents.
- **`ops.site.booking_mode` requires `bookings`.** A mode other than `none` is refused while `bookings` is off.
- **The switch's column `on` is renamed `is_on`.** `ON` is a reserved word in SQL (INFERENCE).

---

## 3 · Orders (D-050, design A)

### 3.1 The flow

```mermaid
flowchart LR
  subgraph intake["Intake: operational, no books"]
    cart["Site cart or widget"]
    chat["WhatsApp or Instagram text"]
    voice["Voice note"]
    photo["Photo of a list or a product"]
    phone["Staff types a phone order"]
  end
  req["ops.order_request"]
  ai["AI drafts the order<br/>quarantined, spans, catalogue match"]
  draft["approval.draft order.confirm"]
  ord["books.order and lines<br/>prices from books.price"]
  steps["books.order_step<br/>a staff tap, the customer's update"]
  adv["books.payment naming the order<br/>the advance, recorded"]
  sale["sale.record naming the order<br/>the invoice, the final step"]
  cart --> req
  chat --> req
  voice --> req
  photo --> req
  req --> ai --> draft
  phone --> ord
  draft -- "a named person approves" --> ord
  ord --> steps
  ord --> adv
  steps --> sale
```

1. **Intake.** Any channel makes an `ops.order_request`:
   - a site cart or widget (`POST /sites/{slug}/orders`, which absorbs today's `ops.wa_cart`);
   - an inbound WhatsApp or Instagram message (text, a voice note, a photo of a list or a product);
   - staff typing a phone order (which can skip the request and go straight to step 3 as the staff member's own
     command).

   An inbound message that carries a request's code (`ORD-7K2Q`) is linked to it by code, never by a model.
2. **The AI drafts** (only when AI is on and under its cap, §4.6 of the blueprint).
   - A voice note is transcribed (Voice Transcribe).
   - Spark reads the text or the photo with no tools, inside `<data>` blocks.
   - It returns each line as **spans**: the item phrase and the quantity phrase, as offsets into the transcript or the
     message.
   - Code matches the item phrase to the catalogue by exact name or alias. An unmatched line is shown as "Not in your
     catalogue — choose", and the person's choice is a member input.
   - Code re-parses each quantity span (the one number detector). The database re-parses it again
     (`ops.inbound_extract`, field `item` or `quantity`).
   - Each line's price is the `books.price` cell in effect. The line amounts and the total are derived figures,
     computed by the counter's own line function.
   - The draft is `order.confirm`. It carries the reply to the customer, with the total and the code, as
     code-composed template text.
   - A run that read inbound text is tainted (§7.8 of the blueprint), so the port refuses any proposal except this
     recipe.
3. **Confirm.** A named person approves the draft, or a staff member records an order they took themselves.
   - This writes `books.order`, its `books.order_line` rows and the first `books.order_step` (`confirmed`, with the
     due date and, for stitching, the trial date).
   - It writes the confirmation message as a book under that decision.
   - Prices are re-derived server-side from `books.price` at that moment. **The order fixes the promised price.**
4. **Steps.** Each status change is a staff tap: `order.step`, the person's own command.
   - It inserts the next `books.order_step`, allowed only by `ref.order_flow` from the current step.
   - It is conditional: a unique `(order_id, step_no)` key means two taps cannot both win.
   - When the step's template has one, it writes the customer's update (`books.outbound_message`) in the same
     transaction. Consent and the WhatsApp 24-hour window are rechecked at send (blueprint §8.6). On the demo every send
     is recorded.
   - With `messaging` off or not granted, the step writes no message, and the app offers the update as a manual
     WhatsApp link.
5. **Advance.** `payment.record` naming the order (recorded, never processed). It posts to a new liability account,
   `customer_advance`.
6. **Finish.** `sale.record` naming the order.
   - The sale's lines must equal the order's lines: item, quantity and the promised unit price (gate ORD3).
   - The advance is applied and the rest is paid or goes on udhaar.
   - The GST invoice is written in the sale's own transaction (blueprint decision 5).
   - The final step (`delivered`) is written in the same transaction.
7. **Cancel.** `order.cancel` (owner or manager, with a reason) writes the `cancelled` step. An advance is either refunded
   (`payment.record`, direction out, naming the order) or kept as customer credit (`credit.record`).

### 3.2 Tables

| Table | Columns | Keys | Written by | Rules |
|---|---|---|---|---|
| `ops.order_request` | [T] `id`, `shop_id`, `code ^ORD-[A-Z0-9]{4,6}$`, `channel` site\|widget\|whatsapp\|instagram\|voice\|photo, `release_id` + `lines jsonb` (site and widget only: ≤ 20 of `{itemId, qtyMilli}`, as `wa_cart` today), `inbound_message_id → ops.inbound_message`, `contact_id → ops.contact`, `kind` goods\|stitching\|alteration, `state` new\|drafted\|confirmed\|declined\|expired, `draft_id`, `order_id`, `handled_by`, `handled_at`, `reason → ref.reason`, `created_at`, `expires_at` (7 days) | unique `(tenant_id, code)`; `(tenant_id, state, created_at)` | the public role (site, widget), the webhook (messages), members | `order_request_flow`, role-shaped: the public inserts `new` only; members move it on; jobs expire it. **Holds no personal data** (a contact id at most) |
| `books.order` | [T][S][R] `id`, `shop_id`, `request_id`, `customer_id → books.customer`, `kind` goods\|stitching\|alteration, `code`, `currency` | `(tenant_id, customer_id)`; unique `(tenant_id, code)` | `order.confirm` | immutable header; a reversal voids an order created in error |
| `books.order_line` | [T][S][R] `id`, `order_id` (parent), `line_no`, `item_id` + `item_kind`, `price_id → books.price` or `quote_input_id → ops.member_input`, exactly one (`check (num_nonnulls(price_id, quote_input_id) = 1)`), `qty_milli >0` (positive unless a reversal), `unit_price_minor ≥0`, `gross_minor`, `measurement_id → ops.measurement` (stitching), `note_text_id → ops.message_text` (erasable) | unique `(tenant_id, order_id, line_no)` | `order.confirm`, `order.reverse` | `unit_price_minor` equals the cited price row, or the person's typed quote (a stitching quote, labelled as theirs); `gross` by the counter's line function |
| `books.order_step` | [T][S] `id`, `order_id`, `step_no >0`, `step → ref.order_step`, `due_on`, `trial_on` (set on `confirmed` and `rescheduled`), `message_id → books.outbound_message`, `reason`, `at` | unique **`(tenant_id, order_id, step_no)`**; `order_step_latest (tenant_id, order_id, step_no desc)` | `order.confirm`, `order.step`, `order.reschedule`, `order.cancel`, `sale.record` | `b_order_flow`: `step_no` = the latest + 1, and (latest step → this step) is in `ref.order_flow` for the order's kind; `delivered` only inside the transaction of a sale naming the order; `z_order_state` (after insert) writes the order's `ops.order_state` row |
| `ops.order_state` | `tenant_id`, `order_id` (pk with tenant), the current `step`, `step_no`, `due_on`, `trial_on`, `updated_at` | pk; `(tenant_id, step, due_on)` | only `z_order_state`, an after-insert trigger on `books.order_step` (as `z_outbound_delivery`) | a derived row per order that serves the board; no direct write (a guard refuses any write outside the trigger) |
| `ops.measurement` | [T] `id`, `contact_id → ops.contact`, `taken_by` (a member), `taken_at`, `note ≤200`, [E] | `(tenant_id, contact_id, taken_at desc)` | members (`measurement.take`, ops) | personal data in the vault: erased with the contact; an order line keeps the id |
| `ops.measurement_value` | [T] `measurement_id`, `point → ref.measure_point`, `mm int 1..3000` | pk `(tenant_id, measurement_id, point)` | with its measurement | one row per point (normalised, not JSON); erased with its measurement |
| `ref.order_step` | `code text pk`, `kinds text[]`, `terminal bool`, `template_code` (NULL = no customer update), `label_key` | — | seed | goods: `confirmed`, `packed`, `ready`, `out_for_delivery`, `delivered`, `cancelled`, `rescheduled`. Stitching and alteration: `confirmed`, `cutting`, `stitching`, `trial`, `ready`, `delivered`, `cancelled`, `rescheduled` |
| `ref.order_flow` | `kind`, `from_step`, `to_step`; pk all three | — | seed | the allowed transitions (blueprint non-negotiable 10, in Munim's form) |
| `ref.measure_point` | `code text pk`, `label_key` | — | seed | chest, waist, hip, shoulder, sleeve, length, bottom length, bottom waist, neck (to confirm with Prabhave) |

**Changes to existing tables:**
- `books.payment` gains `order_id`;
- `books.sale` gains `order_id`, so a sale names at most one of booking, reservation or order;
- `books.sale_line` gains `order_line_id`, with `check (num_nonnulls(price_id, order_line_id) >= 1)`;
- `books.outbound_message` gains `order_id`;
- `21_orders.sql` adds these four foreign keys by `alter table`, so the build order never breaks;
- `ref.account` gains `customer_advance` (a liability, credit-normal);
- `ops.inbound_extract.field` gains `item`;
- `ops.wa_cart` is replaced by `ops.order_request`'s site channel. Gate CART1 carries over as ORD1 for site requests;
- a contact's erasure is held while an open order or an unapplied advance exists.

### 3.3 Commands, screens, watchers

- **Commands** (`ref.command_authority`):

  | Command | Who | Notes |
  |---|---|---|
  | `order.confirm` | owner, manager, staff | draftable |
  | `order.step` | owner, manager, staff | |
  | `order.reschedule` | owner, manager, staff | |
  | `order.cancel` | owner, manager | |
  | `order.reverse` | owner, manager | voids an order entered in error (added after R4, §3.5) |
  | `measurement.take` | owner, manager, staff | ops |

  `sale.record` and `payment.record` gain the order.
- **Screens.**
  - `/app/orders`: requests waiting, with each AI draft shown line by line against its source span; then a board by
    step. Each card shows the customer, the kind, the due date, the total and the advance (cells), and one button for
    the next step, with the customer's update written under it.
  - Stitching cards also show the measurements (cells) and the trial date.
  - The customer's status page `GET /sites/{slug}/orders/{code}` shows step labels only, with no personal data. The
    code is a capability token: a bad code answers 404, compared timing-safe, never logged (gotcha 16).
- **Watchers** (blueprint §7.3):

  | Watcher | Raises when | Impact cell | Recipe |
  |---|---|---|---|
  | `order_unanswered` | a request older than 30 minutes is still `new` or `drafted` | its derived total, when it has lines | the draft itself |
  | `order_late` | `due_on` has passed and the latest step is not `ready` or terminal | the order's total | explain; links the order |
  | `advance_unapplied` | an advance on a cancelled or delivered order is neither refunded nor applied | the advance | explain; links the order |

### 3.4 Gates

| Gate | Holds | Red-proof |
|---|---|---|
| ORD1 | every order line's unit price equals its cited `books.price` row, and every line amount and total recomputes from stored ids with the counter's function (site requests: from their release and lines) | change the line function in one place |
| ORD2 | steps follow `ref.order_flow`; two concurrent taps produce one step and one refusal | drop the unique `(order_id, step_no)` |
| ORD3 | a sale naming an order has the order's lines and writes `delivered` in its transaction | let `sale.record` skip the line match |
| ORD4 | an AI-drafted order's quantities are spans the database re-parses; a free digit in the draft is refused | accept a quantity without a span |
| ORD5 | the public and webhook roles cannot write `books.order*`; a request never becomes an order without a person | grant INSERT to the public role |
| M1 | erasing a contact erases its measurements and values; order lines keep the id | skip the measurement erase |

### 3.5 Amended after R4 (29 Oct)

The orchestrator's ruling 3 on R4 amends this section: this spec's §3 holds, with R4 §6a's attach points. The tables
above are updated to match; BLUEPRINT §2.10.16 and §8.12 hold the folded design.
- **An order line names a price or a quote.** `books.order_line` has `price_id` or `quote_input_id → ops.member_input`,
  exactly one (`check (num_nonnulls(price_id, quote_input_id) = 1)`). A stitching quote is the person's typed figure,
  labelled as theirs.
- **`books.sale_line` gains `order_line_id`**, with `check (num_nonnulls(price_id, order_line_id) >= 1)`.
- **`books.outbound_message` gains `order_id`.**
- **The taint allow-list** (BLUEPRINT §7.8) gains `order.confirm`.
- **A contact's erasure is held** while an open order or an unapplied advance exists.
- **A third watcher, `advance_unapplied`:** an advance on a cancelled or delivered order that is neither refunded nor
  applied. Its impact is the advance. There are 17 watchers in all.
- **`ops.order_state`:** a derived row per order (the current step, `step_no`, `due_on`, `trial_on`, `updated_at`),
  written by `z_order_state`, an after-insert trigger on `books.order_step`. It has the index
  `(tenant_id, step, due_on)` and serves the order board. A trigger runs with the inserting role's rights, so the app
  holds the grant and a guard refuses any write that is not the trigger's (INFERENCE from PostgreSQL's trigger rules).
- **`21_orders.sql` adds the foreign keys from earlier files by `alter table`:** `books.sale.order_id`,
  `books.sale_line.order_line_id`, `books.payment.order_id`, `books.outbound_message.order_id`.
- **Added in the fold, for the orchestrator to confirm:**
  - `books.order` is [R], and BLUEPRINT §2.9 gives every reversible book one `*.reverse` command, so the fold adds
    `order.reverse` (owner, manager). By R4 K4, `books.order_line` is [R] too.
  - `measurement.take` stays an ops action. It is not a `ref.command` row, because every command must write a book
    table (gate G3).
  - `order.confirm` also writes a new customer (customer, terms, party contact), as `booking.confirm` does.
  - The request's trigger is named `order_request_flow`, because `ops.site_request` already has `request_flow`.

---

## 4 · Every capability through the API, and widgets

- **For 5 Nov (W3, with API v1):**
  - **Order intake and status** are added to the shop-site API (§3.3).
  - **Widgets:** a new package, `packages/widgets`, provides web components built on the SDK and a publishable key,
    with the same origin allow-list as the sites:
    - `<munshi-order>` (catalogue and order);
    - `<munshi-book>` (slots, if time allows).

    A widget for a capability that is switched off renders nothing. Every figure in a widget carries its ref, and
    "tap for source" works as on the sites.
  - Proof for the judges: one plain HTML page that embeds `<munshi-order>` for the kirana.
- **After 5 Nov:** merchant API keys (server-side, scoped per capability), the back-office endpoints, and the rest of
  the widgets.

---

## 5 · The cache (Redis, W4, founder's decision D-049)

| Item | Design |
|---|---|
| Port | `packages/adapters/cache` with two adapters: `memory` (tests) and `redis`. Local: `redis-server` (installed, FACT) on a Unix socket under `.run/`. Deploy: a hosted Redis chosen in the deploy wave (Upstash on Vercel is the likely one; its free tier and Mumbai region are UNVERIFIED) |
| Keys | built only by `cacheKey(tenantId, kind, …)`, whose first argument has the branded `TenantId` type; a source scan refuses any Redis call outside the adapter |
| Cached | (1) **a release's pinned snapshots**, by release id; (2) **pinned snapshots**, by id; (3) **the slug → tenant, latest release and verified lookup**, with a short TTL, dropped on publish and on verify, with negative entries that answer the same byte-identical 404 |
| Computed per request over the cached release | the live overlays: `held` flags, offers in effect, slots. Never cached |
| Always in Postgres | idempotency, `allow()`, sessions, hold caps, balances (and rate counters, in `ops.rate_counter`) |
| Never cached | a screen read's result; a name or a phone number; anything without the tenant id |
| Failure | Redis down or slow (a 50 ms budget): the read goes to Postgres, with no error shown (non-negotiable 11's spirit) |
| Gates | **RC1**: every key starts with a tenant id (type and source scan). **RC2**: a public response built from the cached release plus the live overlays equals one built fresh for the same release, refs included. **RC3**: a request for tenant B never reads a key planted for tenant A (red-proved by dropping the tenant prefix). **RC4**: with Redis stopped, every page and API route still answers |

### 5.1 Amended after R4 (29 Oct)

The orchestrator's ruling 4 on R4 narrows this section with R4 §6c. The table above is updated to match; BLUEPRINT §4.8
and decision 19 hold the folded design.
- **Cached:** a release's pinned snapshots by release id; pinned snapshots by id; the slug → tenant, latest release
  and verified lookup, with a short TTL, invalidation on publish and verify, and negative entries that answer the same
  byte-identical 404.
- **Computed per request, over the cached release (never cached):** the live overlays (`held` flags, offers in
  effect, slots). So whole public responses are no longer cached, and RC2 compares the cached release plus the
  overlays with a fresh build.
- **Always stays in Postgres:** idempotency, `allow()`, sessions, hold caps, balances.
- **Never in the cache:** a screen read's result; a name or a phone number.
- **Rate counters are no longer a cache candidate:** the ruling's cached list does not include them, so they stay in
  `ops.rate_counter`.

---

## 6 · The order of work (D-049)

| Wave | Work | Gate to move on |
|---|---|---|
| **W0 Design close-out** | the schema review (R4); this spec; both folded into BLUEPRINT.md; the founder approves | approval |
| **W1 Database** | schema files `00–90` with R4's rank-1 fixes and this spec's tables; runner, harness and populate for the three shops; every gate retargeted, plus CAP, ORD and M1 | `pnpm check` and the red-proof harness pass; `EXPLAIN` on the populated tenants for every named read |
| **W2 Backend** | commands and reads per area: orders, capability switches, sign-in, tenancy and sign-up, platform rules, GST, offers, packages, loyalty, bookings, holds, messaging (recorded), staff, salary | tests, then one adversarial review with a guarantee scan, at most 2 fix cycles |
| **W3 Architecture hardening** | config from the environment only, the jobs runner, health, logs and request ids, one transaction per page, no SQL in apps, API v1 with contracts and SDK, order intake, widgets, abuse limits | same |
| **W4 Cache** | §5 | RC1–RC4 |
| **W5 AI layer hardening** | desks and watchers by capability (16 watchers with §3.3's two), the finding lifecycle, recipes, the brief, chat → order extraction, the injection and cross-tenant suites, caps and the off switch | the corpus and eval suites pass on recorded turns |
| **W6 Meta keys** | M0 smoke test, a live re-record of every fixture, fixes for what live calls reveal | the one-shop-day chain works live |
| **Surfaces** (orchestrator's assumption, D-049) | the app in the new look (the app pick is still open), the shop sites by slug (elite-A, prabhave-C), the product site (site-F, round 3); built from W3 on, done before the film | screenshots of every state |
| **Deploy** (assumption) | the hosted demo on Supabase and Vercel, before the film | the demo opens from a phone |
| **W7 Film**, **W8 Submission** | the one shop day, shot on the hosted app with live calls; README, form | — |

The Paytm finals (Sat 31 Oct) show whatever exists then. PayPal (13 Nov) needs a payments capability after 5 Nov
(D-048).

---

## 7 · Guarantee scan

**Clause 1 — nothing changes the books without a named person's approval.**
- An order request, from the public, the webhook or the AI, is ops. The public and webhook roles hold no grant on
  `books.order*` (ORD5).
- An order enters the books only by `order.confirm`: a person's own command, or a draft a named person approved.
- Every step, advance, cancellation and the final sale is a person's own command, and the customer's update is written
  under it.
- A capability switch is the owner's own audited action on ops configuration. It cannot write or delete a book row.
- Platform grants stay approved drafts.
- The cache never writes anything to Postgres.

**Clause 2 — every number shown traces to a ledger row.**
- Order prices are `books.price` cells.
- Quantities are spans re-parsed by the database, member inputs labelled as the person's, or a site request's stored
  lines.
- Line amounts and totals are derived figures that ORD1 recomputes from stored ids.
- Advances and balances are book rows' cells.
- Measurements are cells of a read over `ops.measurement_value`.
- A cached public response is the release's own snapshot cells with their refs (RC2). A figure with no ref is never
  cached.

Clean on both clauses as designed (INFERENCE, to be checked by the W2 review).

---

## 8 · Open items

1. **GST on advances for stitching** (a service): GST may fall due when the advance is received, with a receipt
   voucher. INFERENCE; for a chartered accountant. For 5 Nov the advance is recorded and the invoice is written at
   completion, with a labelled note.
2. **Prabhave's measurement points and steps:** confirm with the shop (§3.2 defaults).
3. **Kirana home delivery:** whether the kirana's orders include `out_for_delivery`. The default is yes.
4. **The app look** (round 2, E–J) and **site round 3**: needed before the surfaces start.
