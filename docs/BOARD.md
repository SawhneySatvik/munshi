# Munshi — ticket board

Plan: `../hackathon/_meta/PLANS-2026-10-27.md` §2–3 (decisions D-025–D-028 in `../hackathon/_meta/DECISIONS.md`). Rules:
`CLAUDE.md` (read it first; the fresh-code rule and the database rules bind every ticket). Waves run back to back; each
ticket ends with a report of ≤ 300 words to the orchestrator: files changed, each command run with its key output lines,
red-proofs, what you did NOT do. The orchestrator commits.

Shared for every MS ticket:
- Work in `/Users/satviksawhney/Downloads/projects_26/munshi`. Run every `pnpm install/add/remove` through
  `scripts/pnpm-locked.sh` (lanes share one lockfile). Node 22, pnpm 11, TypeScript strict, vitest.
- Product names in data and screens are **generic** ("Glucose biscuits 70 g", "Butter 100 g", "Toor dal 1 kg"), never real
  brands; the shop is "Sharma General Store (synthetic)"; suppliers carry "(simulated)".
- Fresh code: read Munim's docs for design (`../foodops-os/docs/plan/02-schema.md`, `03-architecture.md`,
  `04-agent-framework.md`, `adr/`); open Munim's source only when stuck; never copy a file or paste a block.

---

## Wave 1

### MS-1 · Foundation: database, the guarantee, then the core domain (Opus) — two phases with a stop between

**Territory:** `db/**`, `packages/core/**`, `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, root `package.json` scripts,
root dev tooling (vitest/biome config). Not `packages/agent`, not `design`, not `apps`.

**Phase 1 — schema and guarantee (stop and report after it; an Opus guarantee review runs before phase 2):**
1. `docs/ARCHITECTURE.md` (≤ 2 pages): the parts and the trust boundary. One Next.js app (`apps/web`) whose route
   handlers call `packages/core`; the agent runs in the same server but queries Postgres only through a pool connected as
   the read-only `munshi_agent` role, and proposes drafts only through core functions. No separate API service, no run
   tokens. Snapshot cells, drafts, decisions, the book guard, the audit chain, editions (meta | paytm) in config.
2. `docs/SCHEMA.md` + `db/migrations/0001_*.sql …` (plain SQL, applied in order by a small runner in `db/src/migrate.ts`):
   - Roles: `munshi_owner` (owns everything, NOLOGIN), `munshi_migrator`, `munshi_app` (the API), `munshi_agent`
     (SELECT on `snap.*` and on named read views only; no write grant anywhere).
   - Schemas: `ops` (tenant, shop, member + role, command_authority, photo/document metadata, finding, run trace),
     `books` (item, price, stock_move, supplier, purchase + purchase_line, sale + sale_line, payment (recorded),
     customer, credit_entry (udhaar), journal_entry + journal_line, staff, attendance, outbound_message),
     `approval` (draft: command type + payload + `based_on` snapshot refs + status; decision: verdict, decided_by, reason,
     `created_txid`), `snap` (snapshot: query name, params, actor/run, created_at; snapshot_cell: snapshot id, row, col,
     typed value), `audit` (audit_log, append-only, hash-chained per tenant).
   - `tenant_id` leads every key; RLS enabled **and forced** on every tenant table; context only via `SET LOCAL`
     (`munshi.tenant_id`, `munshi.actor_id`, `munshi.decision_id`, `munshi.command`).
   - **Book guard** (trigger on every `books` table, every write): admits a write only if (a) `munshi.decision_id` names a
     decision row that exists, is `approved`, has the same tenant and `created_txid = txid_current()`; or (b)
     `munshi.command` is a direct command the actor's role holds in `ops.command_authority` for that tenant (e.g.
     `sale.record` for counter staff). Anything else raises. Books are append-only: no UPDATE/DELETE grants; corrections
     are reversal rows with reason and actor.
   - Journal entries balance per currency at commit (deferred constraint trigger).
   - `audit.verify_chain(tenant)` returns the first broken link or NULL.
   - Explicit revoke-then-grant block per table; `REVOKE EXECUTE … FROM PUBLIC` per function; indexes asserted in
     `pg_index` by a test.
3. `db/test/` harness on `embedded-postgres` (a fresh database per test file) and these tests, **each red-proved**
   (show it failing when the guard is broken, then passing):
   - G1 the agent role is refused INSERT/UPDATE/DELETE on every table; the count of tables checked equals the count in
     the migrations' table manifest (a positive number from an independent source).
   - G2 a book write is refused with: no context; a decision of another tenant; a decision from an earlier transaction; a
     rejected decision. Allowed with an approved decision created in this transaction.
   - G3 direct command allowed for an authorised member; refused for a member without that authority and for a member
     of another tenant.
   - G4 RLS: tenant A can neither read nor write tenant B's rows, on every tenant table (count asserted).
   - G5 UPDATE/DELETE on books refused for `munshi_app`.
   - G6 an unbalanced journal entry fails at commit; a balanced one commits.
   - G7 `audit.verify_chain` finds a tampered row (tampered as owner).
   - G8 a deliberately failing test makes the test process exit non-zero (the embedded-postgres exit hook).
   - G9 no function in the `munshi` schemas grants EXECUTE to PUBLIC.
   - G10 every declared index exists in `pg_index` with its columns.
4. Root scripts: `pnpm check` = lint + typecheck + test. **Done when:** `pnpm check` is green; each of G1–G10 shown red
   then green in the report; then **STOP and report**.

**MS-1 fix cycle 1 (after the Opus guarantee review of 94e1be9 — FAIL, one major; Opus):** nothing is deployed, so
migrations 0001–0006 may be edited in place (fix forward starts at the first hosted deploy). Each item gets a test that
fails before the fix (red-proved through `pnpm redproof` cases where it fits):
1. **MAJOR — command authority checks a label, not the table.** `books.guard()` (0005_books.sql ~31–48) never reads
   `tg_table_name`: a staff actor holding `sale.record` can insert into `books.price`, `books.staff`, `books.journal_*`,
   `books.outbound_message`; an approved `reorder.place` decision admits writes to any books table. Add a global
   `ops.command_table(command, rel)` (one command → its tables; e.g. `sale.record` → the 7 tables the fixture writes) and
   join it in BOTH admit branches (direct command and approved decision: the decision's draft's command). New cases: G2 an
   approved `price.set` decision cannot insert `books.sale`; G3 staff with `sale.record` cannot insert `books.price`.
2. `munshi_app` can insert `audit.audit_log` directly (0004 ~83): the chain function must require `actor_id =
   munshi.actor_id` (and the row's entity to exist in this transaction where checkable); G7 must not insert as the app.
3. The guard writes the audit entry in a BEFORE trigger (0005 ~58): `INSERT … ON CONFLICT DO NOTHING` on an existing id
   leaves an audit entry for a row never written. Move the audit write to an AFTER ROW trigger.
4. `approval.draft_status` (0003 ~117–125) lets a draft move to executed/rejected without a matching decision: the
   transition must check the decision (same draft, matching verdict, same transaction for `executed`).
5. A later transaction can append lines to an already-committed journal entry, and cells to an old snapshot: lines and
   cells are accepted only in the transaction that created their parent (store and check `created_txid`).
6. Docs must not claim more than the code: ARCHITECTURE.md "trusts no setting alone" → state plainly that the actor
   setting is trusted from the app (ruling (c) below); "no write anywhere" → revoke TEMP on the database and large-object
   functions from `munshi_agent` (and from PUBLIC with explicit grants where the app needs them) and document the
   advisory-lock caveat; "negated amounts" → enforce it with a CHECK or remove the claim.
7. ARCHITECTURE.md states that the audit hash chain is unkeyed (an owner can rewrite and re-hash) and that the chain head
   will be published outside the database at deploy.
8. Cheap hardening from ruling (c): refuse a decision on a draft created in the same transaction.

**Rulings carried into phase 2 (binding):** (b) before any endpoint that creates members: a trigger requiring an active
owner actor to add an owner/manager (the tenant's first member excepted), with an audit entry. (c) the database trusts the
app's actor: `decide()` runs only from the approver's own request; the actor is set in ONE place from the session;
`packages/agent` must never import the app pool (add a boundary gate); watchers never set an actor. (d) `mintSnapshot`
is the only writer of `snap.*` and runs named queries only — add a gate. (e) prove the `munshi_migrator` path before a
hosted deploy. Raw Postgres errors carry row values in DETAIL: phase 2 maps every DB error to a code before it reaches a
response.

**Phase 2 — core domain, seed, watchers (starts only after the orchestrator says the guarantee review passed):**
5. `packages/core`: money (minor units + currency), time (`Asia/Kolkata`, one module), commands (counter sale,
   purchase from a bill, stock count adjustment, waste, credit entry, payment recorded, reorder), approvals
   (`proposeDraft`, `decide` → executes the command under the approver's identity in one transaction with its audit
   entry; re-checks `based_on` cells and marks the draft `stale` if the evidence changed), snapshots (`mintSnapshot(name,
   params)` runs a named read and stores its cells; `resolveRef`).
6. Seed: `db/seed/kirana.ts` builds "Sharma General Store (synthetic)": 60 generic SKUs, 90 days of sales, purchases from
   3 simulated distributors with bills, 25 credit customers, 4 staff. **Planted situations** with an answer key
   (`db/seed/kirana.answers.json`): shelf shrinkage on 2 SKUs, a distributor price creep on 1 SKU, stock expiring within 7
   days, 3 overdue credit customers, a short UPI settlement on 1 day. One command reseeds in under 60 s.
7. Watchers: deterministic SQL detectors, one per planted kind, writing `ops.finding` with snapshot refs; a finding is not
   raised twice for the same situation.
8. **Done when:** `pnpm check` green; the watcher test finds 5 of 5 plants and red-proves (remove a plant → the test
   fails); a draft approved by the owner executes and its audit chain verifies; a draft whose evidence changed goes
   `stale`.

### MS-2 · Visual direction: the owner's home screen, two directions (Opus)

**Territory:** `design/**` only. No npm installs: static HTML + CSS (+ inline SVG), screenshots with headless Chrome
(`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --screenshot=… --window-size=390,844 …`).
Load the `impeccable` or `frontend-design` skill first. Original art only (CSS/SVG drawn), no stock images, no icon packs
copied in.

**The screen (same content in both directions):** the owner's phone home for "Sharma General Store (synthetic)":
- Header: shop name, date, a Hindi/English toggle, a "Synthetic data" label.
- Morning brief, 3 cards, each number with a small source chip:
  1. Shelf count gap: "Glucose biscuits 70 g: books say 24, shelf shows 18", with a drawn shelf thumbnail and boxes on the
     gaps.
  2. Bill price rise: "Butter 100 g: ₹56 → ₹60 a unit on Gupta Traders' bill (simulated supplier)".
  3. Overdue credit: "3 customers owe ₹2,350 for more than 30 days".
- A draft awaiting approval: "Reorder 48 × Glucose biscuits 70 g from Gupta Traders (simulated)", Approve / Reject.
- A large voice button: "बोलकर पूछें · Ask by voice".
- One "Cannot verify" example on a line whose number has no source.

**Deliver:** `design/a/index.html`, `design/b/index.html` (two clearly different directions: type, colour, density,
layout), screenshots `design/shots/{a,b}-390.png` (390×844) and `{a,b}-1280.png` (1280×800), and `design/NOTES.md` (one
paragraph per direction: its idea and what it is good at). Tap targets ≥ 48 px; text ≥ 16 px for inputs; contrast ≥ 4.5:1.
**Done when:** the four PNGs exist and you have looked at each one (read the image) and fixed anything clipped or
overlapping. The founder chooses; no other UI is built until then.

### MS-4 · The app shell and the design system in code (Opus)

**The reference is approved (D-032):** `design/munim-look/` (screens `design/shots/munim-look-390.png`, `-1280.png`). Every
token value comes from it. Source chips show a **plain name** ("Stock ledger", "Gupta Traders' bill", "Shelf photo");
tapping one opens the source drawer with the exact snapshot row, cell highlighted (as on the 1280 shot).

**Territory:** `apps/web/**` only. Run pnpm only via `scripts/pnpm-locked.sh`.

1. `apps/web`: Next.js App Router, TypeScript strict.
   - Pick the newest stable Next.js that is NOT flagged by `npm audit` (16.4.0 is flagged). State the version and why.
   - Leave `cacheComponents`/partial prefetching **off**: in Munim it served dynamic-id routes from one cached shell with
     placeholder ids.
   - Plain CSS: one `tokens.css` holding the reference's values, re-declared by you, plus component CSS. No CSS framework.
2. **Components:**
   - TopBar: wordmark, "Synthetic data" chip, EN/हिंदी toggle.
   - LedgerCard and its cells.
   - SourceChip (plain label, accessible name, tap opens SourceDrawer) and SourceDrawer.
   - Sticker: "Waiting for you", "Simulated supplier", "Draft".
   - Button: primary and secondary.
   - VoiceButton.
   - CannotVerify.
   - ShelfThumbnail: an SVG drawn from data, with the gap boxes.
   - RedRing (the circled number) and Stamp (the approved state).
   Strings come from an EN/HI dictionary; the toggle persists in a cookie. Fonts are the reference's, from Google Fonts
   (Hindi: Noto Sans Devanagari).
3. **Edition switch:** `MUNSHI_EDITION=meta|paytm` picks a token override file. Paytm gets a neutral placeholder palette
   marked TODO. **No Paytm logo, colours or wordmark** (never imitate a real company's brand).
4. **The owner home at `/`,** rendered from a typed fixture shaped like what core will return. Each brief card value
   carries `SourceRef {label, snapshotId, row, col}`, so wiring it to core later is a swap of the data source. It must
   match the reference at 390 and 1280: same layout, same content, the approved state on Approve.
5. **Gates:**
   - `pnpm --filter ./apps/web build` succeeds; typecheck and lint pass.
   - Unit tests: SourceChip renders the plain label and opens the drawer; the toggle switches strings.
   - Screenshots at 390×844 and 1280×800 in `apps/web/.screenshots/MS-4/`, taken with a real 390 px viewport (Chrome
     remote-debugging device metrics, as MS-2b did). Open them and compare them with the reference shots; fix every
     difference.
   - Tap targets ≥ 48 px; input text ≥ 16 px; contrast ≥ 4.5:1.

---

## Wave 2

### MS-5 · Guarantee review of phase 2 (Opus reviewer, read-only)
This reviews commit 1ab2ad4. It covers:
- approvals: `proposeDraft` (member vs run proposer), `decide` (one transaction, actor = decided_by, re-check, stale);
- `mintSnapshot` (the only writer, named reads only, READ ONLY savepoint);
- watchers (no actor; written only to ops and snap);
- the member-addition guard; error mapping (no row values);
- reseed (superuser, dev-only, synthetic tenants only);
- gates B1–B4 and the redproof ERROR handling.

It ends with a verdict and a guarantee scan.

### MS-1 fix cycle 2 · The MS-5 review's findings (Opus)

MS-5 FAILED phase 2 (1ab2ad4) with 3 majors. Probes are in the session scratchpad: `stale/stale.test.ts`,
`b1probe.ts`.

**Territory:**
- `packages/core/src/{approvals,snapshots,commands,session}.ts`;
- core's boundary and gate tests;
- `db/migrations/0007_phase2.sql` (editable in place: nothing is deployed);
- `db/test/**`;
- `docs/ARCHITECTURE.md`.

**NOT** `packages/core/src/queries.ts` or `queries-agent.ts` (MS-6 and MS-7 are editing them), not `packages/agent`, not
`apps/web`, not `db/src/dev.ts` (MS-7). Every fix gets a red-proved test.

1. **MAJOR — the stale check misses writes after a watcher's `as_of`.** `recheck` re-runs reads with their stored
   params, and the `watch.*` reads stop at `as_of`. Probe: a run drafts `stock.waste` of 20 from `watch.expiry`; staff
   writes the same lot off; the owner approves and on-hand goes 32 → 12 → −8.

   **Decided fix (option a):** a draft for a command that moves stock or money must cite at least one cell from an
   UNDATED read (a read with no date param: current state), covering every item or customer the payload touches. For
   stock that is `stock.on_hand` per item. Core refuses the draft otherwise. Add the probe as a C4 case (red-proved) and
   update ARCHITECTURE §Decide.
2. **MAJOR — gate B1 does not catch an import of the app pool.** `import { createAppPool, runCommand } from '../../core'`
   passes with 0 violations. The gate also misses imports reached through `apps/**`, template-literal `import()`,
   `createRequire`, `fixtures/` and `.mts`.

   **Fix:** follow imports to their files from every `packages/agent` file (as B2 does), fail on any non-literal
   `import`/`require`/`createRequire`, and plant each of these forms in B0 so the gate is proved. Also make `Session`
   unforgeable outside core's session constructor (a branded type, or a class with a private constructor), so a
   hand-built Session does not typecheck.
3. **MAJOR — a run's draft needs no evidence.** `proposeDraft` accepts an empty `basedOn` and payload numbers tied to
   no ref.

   **Fix:** require a non-empty `basedOn` AND `payloadRefs: Record<jsonPath, CellRef>` covering EVERY number in the
   payload, each cell's value equal to that number. Core refuses otherwise, and stores `payloadRefs` on the draft (in
   0007) so screens render every draft number with its own SourceRef. MS-6 and MS-7 have been told the port shape:
   `propose({command, payload, basedOn, payloadRefs})`.
4. **MINOR:** reject and mark-stale require the member's authority to approve that command, and an active member (today
   staff can reject a reorder it cannot approve). Red-prove it.
5. **MINOR:** command results return numbers never stored as cells. Either mint a snapshot of the result or mark result
   numbers as non-display (document which, and enforce it with a type).
6. Items 5–6 of the review (reseed's dev check; the pool's role check) are routed to MS-7 (`dev.ts`); do not do them
   here.

**Done when:**
- `pnpm --filter ./db --filter ./packages/core test` is green;
- `pnpm redproof` is all red with 0 ERROR;
- the scratchpad probes now fail as attacks (quote their output);
- the guarantee scan states both clauses.

### MS-6 · The AI layer: specialists, tools over named reads, cite-or-abstain (Opus)

**Territory:**
- `packages/agent/**`;
- a NEW file, `packages/core/src/queries-agent.ts` (named reads for the agent), plus the single line in
  `packages/core/src/queries.ts` that spreads it into `QUERIES`;
- core tests for the new reads.

MS-7 edits `queries.ts` at the same time, so touch only that one line there.

1. **Ports.** The agent never imports a pool or any core write (gate B1). It receives a port object from the app:
   - `read(name, params) → {snapshotId, rows}` (the app mints via `mintSnapshot` with a `system` scope and this run's id);
   - `resolve(ref) → Cell | null`;
   - `propose({command, payload, basedOn}) → draftId` (the app calls `proposeDraft` with a run proposer);
   - `trace(event)`: ids, labels and timings only, never model or user text.
2. **Named reads** in `queries-agent.ts`, each with a test against the seeded kirana:
   - `sales.by_day(from, to)`;
   - `sales.by_item(from, to, limit)`;
   - `purchases.last_price(item_id)` and `purchases.price_history(item_id, days)`;
   - `stock.below_reorder()`;
   - `credit.balances()`;
   - `bills.recent(days)`.
3. **The run.** A manager routes a question (role `router`) to one specialist:
   - stock & purchasing;
   - sales & money;
   - credit (udhaar).

   The specialist runs a bounded tool loop (role `reason`; at most 8 tool calls and a time budget), using the named reads
   as tools. Then `narrate` writes short lines.

   **Output is JSON:** `{segments: [{text, refs: [CellRef]}]}`. A number appears in `text` only as a handle
   `⟦1⟧ … ⟦n⟧` that points into `refs`. The renderer substitutes the cell's value; free digits are never rendered.
4. **The validator, cite-or-abstain.** Each of these fails the answer: a digit in `text` outside a handle; a handle
   with no ref; a ref not minted in THIS run for THIS tenant; a ref that does not resolve. Abstaining is a valid answer:
   "Cannot verify" plus what is missing. Untrusted text (bill photos, customer names) never reaches a trace.
5. **Also:** `explainFinding(findingId)` (why, from the books) and `draftFix(findingId)`, which proposes a draft whose
   `basedOn` cites the finding's cells and whose payload numbers each appear beside a cited cell.
6. **Tests** run recorded, with hand-written fixtures until the Meta key exists, then `MUNSHI_MODEL_MODE=record`. Each
   one is red-proved:
   - a free digit makes it abstain;
   - a forged ref is refused;
   - a cross-tenant ref is refused;
   - a ref minted by another run is refused;
   - the happy path renders values from cells;
   - B1 still holds.

### MS-7 · The app on real data: session, owner home from the books, approve and reject (Opus)

**Territory:**
- `apps/web/**`;
- `db/src/dev.ts` (new: start embedded Postgres, migrate, reseed, run watchers);
- root `package.json` script `dev`;
- in `packages/core/src/queries.ts`, ONE new named read `credit.overdue_total`.

MS-6 edits `queries.ts` at the same time; touch only your own entry.

1. `pnpm dev` starts the dev database (embedded, local; credentials generated under `.run/`, never printed), migrates,
   reseeds the kirana, runs the watchers, then starts the web app against it.
2. **Demo sign-in:** pick a person (owner or counter staff). It sets an HMAC-signed cookie with a secret generated under
   `.run/`. ONE server function, `sessionFrom(cookies)`, builds the `Session`. A forged or tampered cookie gets no
   session, and the page asks the person to sign in.
3. **The owner home** (the MS-4 screen) is built from the database:
   - brief cards from `ops.finding` and their snapshot cells (SourceRef = the finding's cell);
   - the overdue-credit total from `credit.overdue_total`, so every number on the card has its own cell;
   - pending drafts from `approval.draft`;
   - the source drawer resolving the snapshot row through a read-only path.
4. **Approve and Reject** are server actions calling `decide(pool, session, …)`. Approval executes under the signed-in
   member; the card shows the stamped state with the approver's name and time from the audit row. A stale draft shows as
   stale.
5. **Gates:**
   - approving through the server action writes the books under the session's member, and the audit chain verifies;
   - a tampered cookie is refused (red-proof);
   - the counter staff role cannot approve a reorder (red-proof);
   - no number on the home renders without a SourceRef (a test fails if one does);
   - screenshots at 390 and 1280 on real data in `apps/web/.screenshots/MS-7/`, compared with MS-4's.

### MS-8 · The hero chain's engine: shelf count, bill reading, voice (Opus)

This is the Meta-scoring core (Use of Meta AI tooling 25%). It is built and tested on recorded responses and synthetic
images until the Meta key and the real kirana photos exist; then it is re-recorded live.

**Territory:**
- `packages/agent/**` (new flows);
- `packages/core/src/{commands,approvals}.ts` and a NEW `packages/core/src/queries-count.ts` (plus its one spread line
  in `queries.ts`);
- `db/migrations/0008_*.sql` (new) and `db/test/**`;
- `packages/agent/fixtures/**` (synthetic images and audio you draw or generate).

NOT `apps/web` (MS-7). The UI for this chain is a later ticket.

1. **Shelf count.** `countShelf(photo, ports)`:
   - Muse Spark (role `vision`) names the distinct products visible, matched to catalogue items through the port's
     `items.list`. Only items in the catalogue count; anything else is listed as "unrecognised".
   - SAM 3.1 (role `segment`) segments ONE product per request with its noun phrase; the count is the number of
     matches. Stills only.
   - The raw SAM response, a sha256 of the photo and the count are stored through a new core path (a `count`
     evidence table plus a named read `count.shelf(count_id)`, so the counted number is a cell).
   - Plain code compares each count with `stock.on_hand` and produces gaps. No model does arithmetic.
   - A gap becomes a `stock.count` draft whose `payloadRefs` cite the count cell and the on-hand cell; a person approves
     it.
2. **Bill reading.** `readBill(photo, ports)`:
   - Muse Spark (role `vision`, no tools: quarantined) returns structured lines (item text, qty, unit price, page
     position on the 0–1000 grid).
   - Item text is matched to catalogue items by code only (exact or alias; no model guess). An unmatched line stays
     unmatched.
   - The figures are stored as a bill-evidence snapshot whose cells carry their page positions.
   - The result is a `purchase.record` draft whose every number maps to a bill cell. A price above the last paid
     (`purchases.last_price`) raises a price-rise flag, cited.
3. **Voice.** `transcribe(wav)` → text → `runAsk` (MS-6). Hindi and English. The transcript is untrusted user text and
   never rides in a trace.
4. **Core rules found by the MS-1 fix cycle 2, done here:**
   - a stock-reducing command (`stock.waste`, a count below on-hand) cannot take on-hand below zero at execution;
   - an undated per-customer read `credit.balance(customer_id)`, so credit drafts can cite current state.
5. **Tests** (recorded, each red-proved):
   - a forged count (SAM response edited after hashing) is refused;
   - a bill number with no page position is refused;
   - an unmatched bill line never becomes a book line;
   - the count draft executes only with both cells;
   - the voice transcript never appears in a trace.

   Also a `scripts/hero-smoke.ts`, which runs the whole chain live once the key exists (fails clearly without it).

---

## Wave 3 — the rest of the product, built to the approved reference

Shared rules for MS-9a and MS-9b:
- the look is `design/munim-look/` and MS-4's components (no new visual language);
- every number renders from a cell with its SourceRef (plain-name chip; the drawer on tap);
- simulated parts are labelled; EN and HI strings;
- 390 and 1280 screenshots taken with a true viewport;
- tests for each command path, the counter staff role tested against the owner role;
- writes only through core's commands under the session (`runCommand`) or approvals (`decide`);
- no new core commands in these tickets (MS-8 is editing `commands.ts`). If a screen needs one, stub the button as
  disabled with "Coming soon" and report it.

### MS-9a · Counter, credit book, stock, and the app navigation (Opus)

**Territory:** `apps/web/**` for the routes `/counter`, `/credit`, `/stock` and the shared navigation.
1. **Navigation:** a phone-first bottom bar plus a desktop side rail in the reference style, by role.
   - Owner: Home, Counter, Credit, Stock, Bills, Suppliers, Reports.
   - Counter staff: Counter, Credit, Stock.
   The `/bills`, `/suppliers` and `/reports` entries link to MS-9b's pages.
2. **Counter:** pick items (search plus quick tiles), quantities, the total from a cell, tender cash, UPI or on credit
   (recorded, never processed: say so on screen), then `sale.record`. A receipt view follows.
3. **Credit book (udhaar):** customers with their balances from `credit.balances`, record credit and record a payment
   (`credit.record` / `payment.record`), and the overdue mark.
4. **Stock:** on hand from `items.list` / `stock.on_hand`, record a count or waste (`stock.count` / `stock.waste`, direct
   commands under authority), with below-reorder highlighted from `stock.below_reorder`.

### MS-9b · Bills, suppliers and the day report (Opus)

**Territory:** `apps/web/**` for the routes `/bills`, `/suppliers` and `/reports` only (MS-9a owns the navigation).
1. **Bills:** recent bills from `bills.recent`, a bill's lines, and record a purchase from a bill by hand
   (`purchase.record`). A price rise against `purchases.last_price` is flagged, cited. The photo-reading entry is MS-8's
   and comes later: leave a clearly marked slot.
2. **Suppliers (simulated):** a list with the last prices, reorder drafts awaiting approval (approve and reject via
   `decide`), every supplier labelled "Simulated supplier".
3. **Reports:** the day and week from `sales.by_day` and `sales.by_item` (bills, total, cash, UPI, card, on credit) as
   ledger tables with cells, plus a chart only if every plotted value is a cell.

### MS-8 fix cycle 1 · The fa53b7d review's findings (Opus)

The review FAILED clause 2. Probes are in the session scratchpad at `probe2/`.

**Territory:**
- `packages/agent/src/{answer,words,shelf,photo,bill}.ts` and their tests;
- `packages/core/src/{approvals,queries-count}.ts`;
- a NEW `db/migrations/0009_*.sql`;
- `db/test/**`.

**Not:** `apps/web` (MS-9b is there) or migrations 0001–0008. Every fix needs a red-proved test, plus sabotage cases.
1. **FATAL — free numbers still pass:**
   - **Hindi words:** complete the Hindi number words for 1–100, plus सौ/हज़ार/लाख/करोड़ and the ordinals, and add
     romanised Hindi (ek, do, teen … sau, hazaar, lakh, crore). Check both against an INDEPENDENT table: a generator
     or a list from a published source, not the same list.
   - **Other scripts and forms:** refuse any letter outside the Latin and Devanagari scripts. Refuse Roman numerals in
     any case (i, ii, iv, xxiv …) as standalone tokens, and number emoji (keycaps, 💯, 🔟, \p{So} with a numeric
     value).
   - **Scale words:** treat minus, negative, point, decimal, ऋण, दशमलव, ½ and fraction words beside a handle as scale
     words.
   - **Name cells:** refuse a name cell with no letter in it.
2. **MAJOR — the edited migration:** move `draft_open_per_finding` out of 0007 into the new 0009 (restore 0007 exactly
   to fa53b7d's parent bytes for that file), so persistent dev databases migrate.
3. **MAJOR — raw catalogue names in the prompt:** wrap catalogue names into the shelf vision prompt with `asData` (as
   tools.ts does), and test that a planted name holding a newline and "item:N" cannot forge a catalogue line.
4. **MINOR — core checks for photo drafts:**
   - one bill line backs a payload line's qty AND cost, and no bill line is cited twice in a draft;
   - `supplierId`, `billNo` and `billDate` must equal the bill's cells;
   - a count carries `counted_at`, and a count older than N hours (config, default 6) cannot back a draft;
   - the vision quarantine has a test (no tools are sent; a returned tool call is refused);
   - `unrecognised` phrases are stripped of digits before they leave the agent.
5. **MINOR — honest limit:** the shelf-count hash binds the stored text to itself, not to Meta's response. Document
   this in ARCHITECTURE as a known limit (the adapter is the only caller), and add a gate that only `shelf.ts` calls
   `recordShelfCount`.

**Done when:**
- the probe2 attacks all fail (quote them);
- the agent, core and db suites are green;
- `pnpm redproof` shows all red and 0 ERROR;
- `pnpm dev` migrates an existing `.run/pg` without the "edited after it was applied" error.

---

## Wave 4

### MS-10 · The missing core reads: quote, receipt, bill lines, last prices, week total (Sonnet)

**Territory:**
- a NEW `packages/core/src/queries-app.ts`, plus its one spread line in `queries.ts`;
- `db/test/` (new test files only);
- `apps/web` for wiring these reads into the existing screens: Counter, Bills, Suppliers, Reports.

**Not:** `packages/agent`, `approvals.ts`, `queries-count.ts`, migrations (MS-8 fix cycle 1 is editing those).

Every read is a named read minted as a snapshot. Every number it returns is a cell; no arithmetic happens in the
browser.
1. **`sale.quote(lines: [{item_id, qty_milli}])`:** each line's unit price (the current `books.price` for the item, its
   source named), its line amount, and the total. It is computed in SQL with the same rounding `sale.record` uses; a
   test checks the quote total equals the recorded sale's total for the same lines.
2. **`sale.receipt(sale_id)`:** the recorded sale's lines, the total, the tender and the time.
3. **`bill.lines_for(purchase_id)`:** a recorded bill's lines by id.
4. **`purchases.last_prices()`:** batched, one row per item with its last price and supplier, replacing the ~25
   per-item mints on /suppliers.
5. **`sales.week_total(from, to)`:** bills, the total, and each tender's total for a range.
6. **Wiring:**
   - Counter: prices and the total from `sale.quote`; enable Cash and UPI, recorded and never processed (say so on
     screen); the receipt from `sale.receipt`.
   - Bills: a recorded bill's lines from `bill.lines_for`.
   - Suppliers: `purchases.last_prices`.
   - Reports: the week total.
   - Remove the "Coming soon" and "Cannot verify" placeholders these reads close.

**Done when:**
- a test per read against the seed;
- the quote equals the recorded sale (red-proved: change the quote's rounding and the test fails);
- the web tests show Counter totals as cells;
- screenshots in `apps/web/.screenshots/MS-10/`;
- the core, db and web suites green;
- lint and tsc clean.

### MS-3 · Model adapters by role (Sonnet)

**Territory:** `packages/agent/**`, `scripts/meta-smoke.ts`, `packages/agent/fixtures/**`. Not `.env.example` (it exists;
report any new name you need).

1. `packages/agent/src/providers/types.ts`: `Role` = router | reason | vision | segment | voice | narrate; `ProviderId` =
   meta | baseten | nebius | gemini | openrouter | sarvam; request/result types for `generate` (messages, optional tools,
   optional JSON schema → text | tool calls | parsed JSON, usage tokens, provider id, model id, latency), `segment`
   (image + noun phrase or boxes → matches with box, mask, score), `transcribe` (16-bit mono WAV + optional language →
   text, language).
2. `config.ts`: editions → role map. `meta`: router, reason, vision = `muse-spark-1.3` on meta; segment = `sam-3.1`;
   voice = `muse-voice-transcribe-1.0`; narrate = Muse Spark Open on baseten (`meta-models/muse-spark-open-1026`).
   `paytm`: a placeholder map on gemini/nebius/sarvam, marked TODO for the Paytm edition. Unknown role/provider → error.
3. Adapters: one OpenAI-compatible adapter (the `openai` npm package with a per-provider base URL; the Responses API for
   meta, Chat Completions where a provider lacks Responses) covering meta (`https://api.meta.ai/v1`), baseten, nebius
   (Token Factory — take the base URL from `../foodops-intel/services/intel/munim_intel/llm/providers.py`, the value
   only), gemini (`https://generativelanguage.googleapis.com/v1beta/openai/`), openrouter (`https://openrouter.ai/api/v1`);
   `meta-sam.ts` (`sam-3.1`); `meta-voice.ts` (`POST /v1/asr/transcribe`). Verify each base URL and request shape against
   the provider's current docs (Meta's captures: `../hackathon/meta-ai-developer-hackathon/raw/2026-10-27/tech/`); mark
   anything unverified in a comment.
4. Strict JSON-schema output validated with zod; tool calls normalised; 429/5xx retried 3 times with exponential backoff
   and jitter; per-role timeouts; every error message redacts keys (keys read from `process.env` names in `.env.example`).
5. Record/replay: `MUNSHI_MODEL_MODE` = live | recorded | record; fixtures keyed by the sha256 of the canonical request,
   under `packages/agent/fixtures/`. Tests run recorded (hand-written synthetic fixtures until a key exists).
6. `scripts/meta-smoke.ts` (the M0 gate): calls `muse-spark-1.3` once with a tool and a JSON schema, `sam-3.1` once on a
   committed synthetic shelf image (`packages/agent/fixtures/smoke/shelf.png`, drawn by you: identical packets on shelves)
   with a noun phrase, `muse-voice-transcribe-1.0` once on a committed synthetic Hindi clip (`fixtures/smoke/hindi.wav`,
   made with macOS `say -v Lekha` then `afconvert` to 16 kHz mono 16-bit WAV); prints PASS/FAIL per model with model id
   and latency; exits non-zero on any FAIL; never prints a key. Baseten checked only if its key is set.
7. **Done when:** `pnpm --filter @munshi/agent test` green; red-proofs: a key planted in an error is redacted (test fails
   if redaction is removed); a schema-violating fixture is refused; a role missing from an edition fails the config test.
   `scripts/meta-smoke.ts` run without a key prints FAIL for each model and exits non-zero (show it).
