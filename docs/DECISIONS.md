# Decisions log (copied from the founder's hackathon notes, 29 Oct 2026)

The founder's running decisions journal lives outside this repo (`hackathon/_meta/DECISIONS.md`). The entries that bind
the current build are copied here unchanged, so a session that sees only this repo has them. Ratified means: never
re-asked, binding on every agent. New decisions are appended here from now on, numbered D-057 onwards.

## D-045

**29 Oct 2026 — Blueprint questions answered. Status: DECIDED (founder, three AskUserQuestion rounds).** Design:
munshi `docs/BLUEPRINT.md` (383f4cf), its Opus guarantee review found 2 rank-1 and 8 rank-2 items (fix cycle running).

- **Local Postgres now; Supabase later, for production** (founder: "can't we have a local postgres running and later
  shift to supabase on prod"). Everything is built and demoed locally; the hosted demo moves to Supabase at deploy.
- **Sign-in before Supabase: email + password** (founder), our own, securely hashed and rate-limited, behind an identity
  adapter; Supabase Auth replaces it at the move.
- **GitHub repository: later.** CI and the scheduled background tick wait for it; jobs run after writes and on page
  loads meanwhile.
- **Guarantee readings confirmed:** WhatsApp cart totals are code-derived from published price cells; free slots are
  roster times.
- **AI spend caps: database config controlled by a superadmin** (founder), adjustable per shop. **New self-serve shops
  start with AI off** until the superadmin enables it (recommended, accepted); demo sample shops keep AI with a cap.
- **A new shop's public site stays hidden until the superadmin verifies it** (recommended, accepted); Elite and
  Prabhave are reserved names.
- **Demo sign-up for judges: yes** (sandbox shop, made-up data, no email).
- **GST:** build with the stated rules (prices include GST, one GSTIN per business, a series per branch, the ₹2,500
  rule on the selling price); a chartered accountant checks before real use.
- **Defaults accepted:** salary rules, hold durations (10-min slot hold, 48-h piece hold), roles (owner and manager
  confirm bookings; staff mark their own attendance), severity ladder (₹10,000 / ₹2,000 / ₹500 a month).
- **Keep rebuilding until 5 Nov** (founder, over "switch before any go-live"): real shops go live after 5 Nov; the
  submission links the shops' demo copies, and the live sites follow after judging (amends D-037's "real requests before
  5 Nov" and D-038's "link the live sites").

---

## D-046

**29 Oct 2026 — Design boards are local pages; site leans to F, studied against the ishita repo. Status: DECIDED (founder).**

- **Local HTML pages, not hosted links** (founder: "move this to a local html page"). The round-2 boards live in
  munshi `design/options-2/` as standalone pages (doctype, charset added); the hosted site-options link was deleted. The
  blueprint page is built as a local page too (Mermaid loaded from a pinned CDN script).
- **Munshi site: site-F "Ask" is liked** (dark conversation at closing time, warm black and coral, Gabarito with Akshar,
  floating pill nav, record side sheet), to be evolved with the design language of the founder's portfolio repo
  (GitHub SawhneySatvik/IshitaGoel, local `projects_26/ishita_resume`), with **better motion, design and art elements**.
  Patterns and judgment only; no files or code copied (fresh-code rule).
- Next: a design study of that repo, then a site round 3 built on F. Still open: the app pick (round 2, E–J), the
  Prabhave pick (A–F) and Elite-A's default mode.

---

## D-047

**29 Oct 2026 — Picks, the platform framing, and two hackathons. Status: DECIDED (founder, chat); the product
brainstorm is OPEN.**

- **Prabhave: prabhave-C "From the bolt"** (dark single-scroll story, aubergine and pyaazi, a drawn thread joining the
  four kinds). (Recommended was D; the founder chose C.)
- **Elite light mode: the gold text merges with the porcelain ground.** Fix: a whiter, pale-paper ground and deeper, more
  solid gold for text and drawing; champagne only on black. (Fix lane running.)
- **Prabhave needs placing orders, with proper tools in Munshi** (founder). What features each merchant gets is to be made
  explicit.
- **Munshi is a service platform:** all the backend lives with Munshi, and merchants come and take a complete suite of
  capabilities, thought "broad and generic" (founder). Opened as a product brainstorm (superpowers:brainstorming) before
  any further build.
- **Two hackathons, one product:** the Meta hackathon (judged on how we use Meta AI to empower merchants) and the **Paytm
  Build for India AI Hackathon, where the founder is now selected for the finals**. Munshi is submitted to both, subject
  to each event's rules (research running: rubrics, Paytm finals format and existing-code rule, cross-submission).
- **The goal: win both.** `/goal` is a UI command the founder runs; recorded here and in memory.
- Next: a built-vs-left audit of the Munshi repo and the rules research (both running), then the brainstorm's
  questions one at a time.

---

## D-048

**29 Oct 2026 — Meta is the goal; Munshi also goes to Paytm and PayPal; the founder's backend-first order. Status:
DECIDED (founder, chat); the order of work is asked (AskUserQuestion).** Assessment:
`../meta-ai-developer-hackathon/review-2026-10-29/WHERE-WE-STAND.md`.

- **The /goal: build Munshi so it wins the Meta hackathon** (Indie, due Thu 5 Nov 07:30 IST); the main focus is
  AI-powered small businesses. Paytm and PayPal are secondary.
- **Munshi may be submitted to the Paytm and PayPal hackathons as well** (founder: "that is not an issue"). Facts from
  the saved pages: the Paytm Delhi-NCR finals are Sat 31 Oct, 09:30–19:00 IST, Noida, a build-on-the-day event
  (prototype, demo video and presentation submitted); devSemble's terms leave ownership with the entrant. PayPal
  (Devpost, Fri 13 Nov 01:30 IST) needs PayPal integration at the centre (sandbox), so it needs a new payments
  capability after 5 Nov; Munshi today records payments and never processes them.
- **The founder's order of work:** the backend fierce and tested → the schema validated, normalised and optimised → the
  API design → then Redis caching. The orchestrator's view, flagged once: add a schema review before the schema files
  are written; start the live Meta chain when the key arrives (Fri), in parallel with the rebuild; Redis after 5 Nov,
  for a measured slowdown only, behind a port with the tenant in every key and only immutable or non-book values.
- **Deviations found** (WHERE-WE-STAND §3): the orders capability, "pack, then switch" and "API and widget for every
  capability" are decided but not in the blueprint; the plan puts the live Meta calls, the hosted URL and the film (50%
  of the rubric) in the last two waves; the code and README drift from later decisions; two looks are unpicked.

---

## D-049

**29 Oct 2026 — The order of work to 5 Nov. Status: DECIDED (founder, AskUserQuestion, free text).**

- **Founder's order:** backend first → the database schema, its review and the rebuild → architecture hardening →
  Redis → AI layer hardening → **then the Meta keys** (added after the AI hardening) → the film → the submission.
- **Recommended and overruled:** the orchestrator recommended starting the live Meta chain in parallel with the rebuild
  as soon as the key arrives, and Redis after 5 Nov. The founder chose Redis before 5 Nov and the Meta keys after the
  AI hardening. Consequence accepted: every wave until then runs on recorded model turns, and the first live call
  comes late.
- **Orchestrator's assumptions, stated for correction:** the surfaces (the app in the new look, the shop sites, the
  product site) are built once the core screen reads and the API exist, and finish before the film. The hosted demo
  deploy comes before the film, so the film shows the hosted app. The brainstorm's additions (orders, capability
  switches) are designed before the schema files are written, because the schema needs them. Widgets wait for the API
  wave.
- **Started:** the schema review (read-only, Opus) of BLUEPRINT §2–§3, report to
  `../meta-ai-developer-hackathon/review-2026-10-29/R4-schema-review.md`.

---

## D-050

**29 Oct 2026 — Brainstorm designs for the schema: orders. Status: DECIDED (founder, AskUserQuestion).**

- **Orders: one intake, then books (A, recommended, accepted).** Every order starts as an operational request from any
  channel (a site cart, a WhatsApp or Instagram chat, a voice note, or staff typing a phone order); the AI turns chats
  into a draft (quarantined text, quantities as spans parsed by code, prices as book cells); a named person confirms it
  into a books order priced from the books; each status step is a staff tap that writes the step and the customer's
  update; an advance is recorded against the order; finishing records the sale and its GST invoice. Stitching and
  alteration are the same order with measurements (erasable personal data), due and trial dates, and their own steps.
  Default steps: goods confirmed → packed → ready or out for delivery → delivered; stitching confirmed → cutting →
  stitching → trial → ready → delivered; cancel with a reason before delivery. The site's WhatsApp cart becomes one
  intake channel. Rejected: orders as pending sales (breaks invoice-at-sale), orders outside the books (the advance
  and the promised price have nothing to attach to).
- **Starter packs and capability switches: a catalogue with switches (A, recommended, accepted).** A fixed list of
  capabilities in `ref`, with dependencies (GST invoices need sales, stitching needs orders, campaigns need
  messaging); the starter pack switches a set on at sign-up; the owner switches any on or off later (audited); the
  superadmin's grants for AI, WhatsApp and the public site sit above. Desks, watchers, screens and the API follow the
  switches, not the business type (which stays as the pack the shop started from). Switching off stops new use and
  never deletes books; open balances, orders and holds can still be finished. Packs as proposed: kirana (counter,
  udhaar, stock, bills and suppliers, orders, offers, staff, GST, site, AI); salon (counter, bookings, packages, offers,
  loyalty, campaigns, staff and salary, GST, site, AI); boutique (counter, stock by size and colour, orders, stitching,
  hold a piece, cart, offers, campaigns, staff, GST, site, AI). Rejected: type decides everything; free-form flags.
- **Spec approved** (founder: "approved"): munshi `docs/superpowers/specs/2026-10-29-munshi-platform-design.md`
  (657b7d2). The founder works remotely from here: every status and question goes in the terminal, self-contained.

## D-051 · 29 Oct · W2 regrouped around one spine commit (orchestrator, technical)

- **Finding (mapping of the code, 29 Oct):** every core command and read goes through one path (`withTx` → `execute`/
  `runCommand` → `journal` → `mintSnapshot`/`resolveRef`), and the core tests and 19 web test files build their shops
  through it or the kirana seed. v2 reshapes the tables that path writes (snapshot cells into jsonb, `ops.run` →
  `ai.run`, names into `ops.contact`, item names into revisions). So about 230 tests in 37 files (INFERENCE, grep;
  SPINE-0 measures) break together the moment any of it moves. The waves index's "each area moves while v1 stays
  green" does not hold.
- **Rejected:** taking those tests out of `pnpm check` during the rewrite (gates that cannot fail while their code
  changes; the kirana answer key unchecked).
- **Ruling:** `docs/superpowers/plans/2026-10-29-w2-backend.md` (munshi 1a38c10). W2a (BP-PLAT-1 core + CLI, BP-JOBS-1)
  beside the migrator; BP-SPINE (three lanes in one worktree, landed as one commit) moves today's core, seed, web
  reads and their tests to v2; W2c features each in its own worktree; BP-FLIP deletes v1; Review R-A. Console screens
  move to Surfaces; AUTH-1 after the spine; ORD3 and request expiry to BP-F5; REV1 to BP-CORE-4b; Elite and Prabhave
  to BP-CORE-5b. Every lane in its own git worktree (red-proofs edit source files). Founder: "Start, summarise
  (Recommended)" for W2 (29 Oct).

## D-052 · 29 Oct · GST on the discounted price; the console's figures trace to their change record (founder)

- **GST (founder: "Tax the discounted price (Recommended)").** BP-DB-3 built `18_gst.sql` as BLUEPRINT §2.10.9 says:
  each invoice line carries its sale line's undiscounted gross and tax, so a ₹2,025 receipt (₹25 offer) became a ₹2,050
  invoice with GST on the undiscounted line. Ruling: an invoice line shows its discount, its taxable value is price
  minus discount, and GST is worked on that, so the invoice and the receipt agree. Basis: CGST Act s.15(3)(a) as read
  from public law (INFERENCE; the chartered accountant's check is still owed before any real invoice). The migrator
  fixes 18 forward (and `z_invoice_total`); core works tax on the net amount (BP-F1). Rejected: keep as built (over-
  charges GST under any offer); no offers on tax invoices.
- **Console (founder: "Trace to the change record (Recommended)").** `munshi_platform` has no snapshot grant (decision 2),
  so the console's and CLI's config values (caps, flags) are shown with the id of the approved `platform.change` that
  set them, and trace to that row. BLUEPRINT §11.2 gains the row. Rejected: snapshot console reads (new rights for the
  platform role).

## D-053 · 29 Oct · A bill-level discount is split pro rata across the bill's lines (founder)

- Founder: "Pro rata by line value (Recommended)". Since D-052, an invoiced sale refuses a discount that names no line,
  so a bill-level discount (loyalty redemption, an amount off the bill) is split by the counter (BP-F1) before the
  invoice: each line takes discount × line value ÷ bill value, rounded to the paisa, the remainder to the largest line,
  and each line is taxed on its discounted price (D-052). The usual practice as read from public sources (INFERENCE);
  the CA confirms before any real invoice. Rejected: line offers only on invoices (loses loyalty and bill offers at
  registered shops).

## D-054 · 29 Oct · Close every wave by tomorrow night (30 Oct), no cuts, 8 agents (founder)

- Founder: "we need to close all the work by tomorrow"; asked, chose "All waves, no cuts" (over the recommended cuts
  1–6) and "Yes, use all 8" agents (the founder's full cap; Nebius and Kaaj get no slots until this closes).
- Consequences stated to the founder: about 30 tickets remain; the screens need the look pick (E–J) and site round 3,
  the live Meta calls and film need the Meta key, the hosted demo needs Supabase, Vercel and Redis accounts. Per-wave
  reviews and every red-proof stay. Lanes start the moment their inputs exist, W3's independent tickets (BP-CORE-1,
  BP-CON-1) before the spine lands.

## D-055 · 29 Oct · Piece holds get the slot holds' per-IP cap (orchestrator, technical)

- BP-F4 found no per-IP limit on `ops.reservation` (the public cannot read `ip_hash`, so nothing can count by IP). No
  doc gives a number for pieces. Ruling: the same cap as slot holds, at most three live (requested or held) piece
  holds per IP hash, checked in `reservation_flow`'s insert under the per-IP lock (MS015); the migrator fixes it
  forward with the other schema findings. The founder may change the number.

## D-056 · 29 Oct · Red-proofing cut to each lane's own cases (founder)

- Founder: "reduce the redproofing everything". Ruling: lanes red-prove only their own new or changed cases, once
  (`redproof.ts --only=v2 <names>`); no full sweeps in lanes (they took 35–60 min each under load). Per merge the
  orchestrator runs `pnpm check` plus the ticket's own cases. One full sweep (v1 + v2) at the W2 close and one before
  submission. Every new gate is still shown to fail once.

## D-057 · 30 Oct · The looks, and the priority before the Meta keys (founder)

- **App look: "Neem Ledger"** (round-2 board, `design/options-2/`).
- **Munshi site: F "Ask", blended with the Munim site's visual language.** Patterns only: no code, copy text or
  assets from any other repo. If `design/reference/munim/` exists, study it; otherwise: calm, editorial, generous
  whitespace, one confident accent.
- **Prabhave: a blend of its A and C boards. Elite: A as is.** Both get real images later.
- **Priority before the Meta keys, deploy and film:** finish the Munshi site frontend, the remaining features and
  backend, and the soundness of the whole system, in Claude Code cloud sessions (`docs/HANDOFF-CLOUD.md` §9.0).

## D-058 · 30 Oct · The integrator pushes to its session branch, not `main` (integrator, autonomous, for founder review)

- The autonomous prompt says "fast-forward main, push main"; this cloud session is bound to push only its own branch
  `claude/quirky-cerf-r5bf1c`. Ruling (the safer, reversible option): the integrator keeps `main` locally as the
  integration line and pushes it to `origin/claude/quirky-cerf-r5bf1c` after each verified merge
  (`git push origin main:claude/quirky-cerf-r5bf1c`). `origin/main` is untouched. The founder fast-forwards `main` from
  that branch (`git push origin origin/claude/quirky-cerf-r5bf1c:main`) once they have looked. Ticket branches are not
  pushed; they are merged locally and deleted.

## D-059 · 30 Oct · What a sale finishes, and the capability parts (integrator, autonomous, for founder review)

- **A sale finishes at most one obligation** (`orderId`, `reservationId` or `bookingId`, as `books.sale` allows). With an
  order, the sale's lines must be the order's live lines in order (same items and quantities) at the prices promised
  at confirmation, to the order's customer; the advance still held is applied first (debiting `customer_advance`),
  then the tenders, then udhaar; the delivered step and the customer's update are written in the sale's transaction.
  A held piece is marked sold; a confirmed booking is marked done (the database lets only an owner or manager move a
  booking, so a staff member bills a booking through a manager).
- **`sale.reverse` leaves what the sale finished finished**: a sold piece stays sold (the piece returns to stock by the
  stock move), a booking stays done, an order keeps its delivered step. The reversal names the order, so the advance
  the delivery applied is held again and goes back by `payment.record` (a refund) or `credit.record` (kept as credit).
  Rejected: reopening the order (no `ref.order_flow` edge leaves `delivered`).
- **Capability parts** (CAP2): an udhaar rest needs `credit`, offer codes `offers`, a points redemption `loyalty`, a
  package line `packages`, a stitching or alteration order `stitching`; each is refused by name (`capability_off`).
  Points are not *earned* while loyalty is off (a rule left from before stays inert), rather than refusing the sale.
  A new hold (`holdPiece`) needs `holds`; declining or releasing an ask already made always runs (a finish). An item's
  kind needs a switched-on capability that admits it (`ref.capability_item_kind`). An approved draft is refused at
  execution when its command's base capability is off, and the draft stays proposed.
- **The brief's schedule**: `runBackOffice` beside the jobs runner (the tick route and the dev ticker call it after
  `runDueJobs`): the watchers hourly per tenant, each branch's brief once its day reaches 07:00 in the shop's zone.
  Until the narrator is wired with `allow()`, the scheduled brief uses its templated lines.
- **`allow()` in the app's agent port waits for the demo default config** (an approved `platform.default_config`):
  without one, every sample shop reads AI off and the hero flows would abstain. It is wired with BP-CORE-5b's seeded
  operator. Taint is wired: the bill flow runs under `tappedPort(…, 'purchase.record')`, so reading a bill's lines
  marks its run tainted.

## D-060 · 30 Oct · The showcase tenants and the demo's AI defaults (integrator, autonomous, for founder review)

- **Elite and Prabhave are provisioned, not signed up:** their slugs are reserved (`platform.reserved_slug`) and only
  `munshi_owner` may take a reserved slug, so `db/seed/provision.ts` writes the creation transaction as the owner role
  with no actor (03's provisioning path); everything after it goes through core as their members. Data class
  `showcase`. Tenant, owner and shop ids derive from the slug (UUID v8, fixed namespace); other ids are random.
- **Prabhave uses labelled placeholders** (every piece "(sample)", the tenant "Prabhave (sample catalogue)") until the
  founder sends the catalogue, spelling and measurement points; Elite's menu is the site's sample menu. Pieces are
  plain goods named with colour and size (the grid writer is not built yet). Elite's as_of is tomorrow (desk bookings
  refuse past starts); the kirana stays at 27 Oct.
- **The demo default config:** the sample shops (synthetic and showcase) get AI on with 200 text and 40 media calls a
  shop a day, and 300 media calls a day shared by all sandboxes, by the seeded operator's approved `default_config`
  change, approved before the sites' `site_verify` changes (a shop's own config row carries the effective values
  forward and then outranks the default). The founder may change the numbers.
- **Kirana order situation:** not planted, so the kirana's answer key stays unchanged (a ground rule); Prabhave carries
  both order situations (an unanswered cart, a late stitching order).
- **Found, not fixed here:** `pnpm reseed` truncates `ops.tenant` with cascade, which reaches `platform.change` and so
  the reserved slugs, the default config and the platform audit log (dev database only). Logged for the W2-close fixes.

## D-061 · 30 Oct · Review R-A, fix round 1 (integrator, autonomous, for founder review)

R-A (read-only, both clauses, W1 and W2) found no rank-1 break; two rank-2 and two rank-3 findings.
- **R-A-1 (fixed):** an AI-drafted `order.confirm` priced its lines at approval from whatever price was in effect, so
  a price set between proposal and approval was promised to the customer unseen. Each line must now cite its item's
  `items.price` cell at the price in effect; approval re-checks it, so a changed price makes the draft stale.
- **R-A-2 (ruled, enforced):** BLUEPRINT §11.1 said every send is an approved draft; the schema lets seven direct
  commands write a message. Ruling: a person's own direct command (reorder, booking confirm, order confirm/step/
  reschedule/cancel, the delivery sale) may send only its fixed template composed by code — that is the person's own
  act (CLAUDE.md admits a person's direct command); a member's or a run's own words go out only as an approved draft.
  The database now refuses a direct command's message that is not a template (MS002), and a gate pins the list of
  direct commands that may message. Rejected: making order steps owner-only (the counter staff mark "packed").
- **R-A-3 (round 2):** the web forms send no idempotency key, so a retried POST records twice. Waits for the web lane
  (the forms are moving under `/app`).
- **R-A-4 (accepted residual):** outside GST a sale's `soldAt` may be backdated freely (the seeds and a shop entering
  yesterday's book need it); each row's `created_at` and actor show when and who. Revisit before live.

## D-062 · 30 Oct · BP-FLIP as done (integrator, autonomous, for founder review)

- v1 is deleted: `db/migrations`, the v1 harness and its 17 test files, `db/test/sabotage.ts`, `db/src/migrate*.ts`,
  `db/vitest.config.ts`. `pnpm check`'s db step is the v2 suite alone.
- **Every v1 test is accounted for** in `db/test/v2/successors.json`: 459 baseline tests, 277 still run, 167 replaced
  by a v2 test asserting the same rule, 15 retired with a reason naming the v2 gate that covers the rule (`node
  scripts/w2-successors.ts` reports 0 problems).
- **The packages' red-proofs moved into the v2 set** (`db/test/v2/sabotage/packages.ts`, unchanged, run in their own
  package); the v2 index refuses a duplicated case name at load, which found five more duplicates there (renamed and
  RED). `redproof.ts` has one set; `--only=v2` still works.
- **Kept, against the handoff's list:** the `embedded-postgres` 18 devDependency. The PG17 gate's red-proof
  (`v2-pg18`) starts PostgreSQL 18 to show an 18-only function fails the suite; removing the package would leave that
  gate unprovable. It is a test dependency only. `deploy/neon.md` is marked superseded (BP-OPS-1 rewrites it).

## D-063 · 30 Oct · Commit identity and the BP-APP lane's choices (integrator, autonomous, for founder review)

- **Commit identity.** The cloud container's git identity is `Claude <noreply@anthropic.com>`; 40 commits on the
  session branch already carry it, and the lanes' commits use it too. No commit carries a Co-Authored-By trailer or a
  "Generated with" line, which is what CLAUDE.md rule 4 names. History is not rewritten (it is pushed, and a rewrite
  risks the lanes' branches). **For the founder:** if the event wants every commit under your own name, rewrite the
  authorship once before submission (`git filter-repo --mailmap`, or a `.mailmap` for display) from a clean clone.
- **The morning brief has its own page, `/app/office`** (owner and manager), not the home: the shared home's
  one-transaction read and its tests stay as they were.
- **Left from BP-APP-3:** revoking another member's session, the look editor and *Publish*, "insert figure" chips in
  campaign words, the office's per-desk cards and run log, inbox filters, over-cap states on the AI surfaces. The dev
  seeds hold no inbound messages and no customer with marketing consent, so the demo's inbox shows its empty state and
  proposing a campaign there is refused (the tests cover both full paths on their own data).

## D-064 · 30 Oct · The sites, the console and the developer portal as built (integrator, autonomous, for founder review)

- **BP-SITES-1.** Both shop sites read and write only through `@munshi/sdk` against `/api/v1`; one business per build
  (BUNDLE1 scans each build for the other business). The look stays in each business folder: the API's look tokens are
  not applied yet. Pages render per request (`force-dynamic`), not revalidated every 60 s. Item names have no Hindi.
  The bot token is a recorded placeholder until Turnstile at deploy. `pnpm dev` makes Elite's site public (an empty
  look, the invented stylists' public profiles, a release) and issues both sites a publishable key (`sitesDemo`).
  The lockfile's 9 new lines were written by hand (an offline install rewrote 1,400); a frozen install passes.
- **BP-PLAT-1 console.** `/platform/*` is 404 without an operator session (its own cookie, `munshi_operator`, path
  `/platform`). `MUNSHI_PLATFORM_SECRET` is optional: without it the console is 404. **For the founder:** make it
  required on live before the live track (one line in `signInKeys()` and a live check in `webConfig`). `pnpm dev`
  enrols a "Dev operator" and writes its sign-in (email, password, authenticator URI) to `.run/dev-operator.json`
  (0600), never printed; that operator approves the demo defaults and verifies both showcase sites. A `pnpm
  db:reseed` on a dev database keeps that operator, so the reseeded showcase sites stay unverified until verified
  again in the console. Adding or removing an operator stays CLI-only (it needs an identity subject).
- **BP-DEV-1.** `/developers` sits inside the product site's frame. Its content is bundled at build time by `pnpm kit`
  into `apps/web/lib/kit.gen.json` (JSON, so the SQL1 scan does not read the recorded examples, which name book
  tables in `source`). The SDK ships as compiled JavaScript with declarations, `munshi-sdk-0.1.0.tgz`, packed by
  `pnpm sdk:pack` (deterministic: the same sources give the same sha256). The examples are recorded from the two
  showcase shops on a test database (`MUNSHI_KIT_EXAMPLES=write`), reads only: a write needs a publishable key, and no
  sandbox key is published yet. **Left:** a public sandbox key for writes, write examples, Hindi.
- **INJ-BILL's flake.** The test looked for `999` anywhere in the draft's JSON, ids included; a random uuid held it
  once. Ids are now blanked first (its case `v2-w5-inj-bill-guess` still RED).

## D-065 · 31 Oct · The cloud branch on `main`, under the founder's name; branches cleaned (founder)

- The 70 commits on `claude/quirky-cerf-r5bf1c` were rewritten so the founder is their author and committer (messages,
  dates and every tree unchanged; the tip's tree is byte-identical), then `main` was fast-forwarded and pushed
  (935643a..3d987a6). This settles D-063's commit-identity note; D-058 is moot.
- Removed: the ten lane worktrees and their branches, `wip/w5b-schema-draft`, and every remote branch but `main`.
  Every lane's work was checked present on `main` first. A bundle of all earlier refs:
  `projects_26/munshi-backup-2026-10-31.bundle`.
- D-058 to D-064 are accepted as built, with D-053's rounding as built and the demo inbox shown without a WhatsApp
  grant (sends stay recorded).

## D-066 · 31 Oct · Paytm today on a provider-agnostic branch; model choice per agent; hosted tonight (founder)

- **Paytm finals (today):** Munshi is prebuilt tonight and refined in the hack hours. It is pitched with a **new Munshi
  deck** (the seven required slides), and the demo video comes after everything else.
- **Branch `paytm` off `main`:** provider-agnostic, with Anthropic, OpenAI, Gemini, OpenRouter and Sarvam (reasoning and
  voice) alongside Meta, for Paytm and later PayPal. `main` stays the Meta edition (the fixed base and UI). Fixes flow
  from `main` into the branch.
- **Model choice per agent:** the superadmin approves an allow-list of providers and models (an approved platform
  change), and the shopkeeper picks a model per agent from it as their own audited command. It goes on `main`, so the
  schema stays identical on both branches.
- **Hosted tonight:** a new Supabase project, and Vercel deploying from the GitHub branch (Git integration).
- **The merchants' written permission is in** (Elite, Prabhave): their names and branding may be public.
- **Scope:** everything left is built; nothing is cut. Plan: `docs/superpowers/plans/2026-10-31-complete-munshi.md`.

## D-067 · 31 Oct · Munshi to the Paytm finals; a dummy Paytm shop; the Paytm layer; the app restyled (founder)

- **Munshi goes to the Paytm finals**, chosen by the founder over the recommended Munim + Cobnut (which was live and
  matched the Stage-1 deck), knowing Munshi's first deploy happens tonight.
- **A Paytm dummy shop:** a general store on the kirana pack, synthetic and labelled. The default name, "Bansal Super
  Mart (sample)", is the executing agent's choice; the founder may rename it.
- **The Paytm layer:** Sarvam for Hindi voice and as a selectable reasoning model; settlement reconciliation (a
  synthetic, Paytm-style statement imported, matched to recorded UPI receipts, the shortfalls shown with sources); the
  per-agent model picker. No Paytm payment integration.
- **The app is restyled.** The founder rejected the green "Neem Ledger" look ("not looking good at all"). The new base
  is the product site's look (`/`, sign-up, the demo picker). A board shows it mixed with Munim and with Cobnut, and the
  founder picks before any build.
- **Vercel:** one project with services and path rewrites, like `foodops-intel/vercel.json`.
- **Correction to the 31 Oct plan's first draft:** the red attendance test is a month-boundary bug, not a midnight one
  (the seed's "last month" from tomorrow's as_of includes today on the last day of a month).
- Plan: `docs/superpowers/plans/2026-10-31-complete-munshi.md`, rewritten for another agent to execute.

## D-068 · 31 Oct · The Paytm deadline, the spend caps, the Paytm video; the plan's review fixes (founder + orchestrator)

- **Deadline (founder):** the prototype, demo video and deck are submitted by about 13:00 IST; no judging criteria are
  known. Gate P1 at 09:00 (the laptop demo on `paytm`), Gate P2 at 13:00 (hosted and submitted).
- **Spend (founder, recommended option):** sandbox sign-ups get AI off on the hosted demo; the four demo shops keep
  200 text and 40 media calls a day; one deployment-wide ceiling of 1,500 live calls a day; the founder sets a spend
  limit at each provider.
- **Video (founder):** the Paytm demo video is made in Wave P, recorded by the founder from the agent's shot list (or
  a captioned Playwright capture). The produced film waits for Meta.
- **Plan fixes from the review (orchestrator):**
  - models are stored as **aliases**, because the platform change payload refuses slashes and 7-digit runs, which real
    model ids carry;
  - a live fallback chain per role;
  - the deployment-wide ceiling as a SECURITY DEFINER counter;
  - the Vercel layout is probed first, with filtered installs, because no services deploy of this shape has been
    proved;
  - the deploy hardening is moved to Wave S;
  - the restyle's tokens and shell come first, to avoid lane conflicts;
  - worktree lanes commit on their own branch.

## D-069 · 31 Oct · The autonomous prompt; the founder's Supabase names; .env.example names only (orchestrator)

- The founder put the Supabase project's values in `munshi/.env` under new names, added to `.env.example`
  (`SUPABASE_*`, `DIRECT_*`, `TRANSACTION_POOL_*`, `SESSION_POOL_*`), plus `GEMINI_API_KEY` for tonight's testing.
  - The admin URL is `SESSION_POOL_CONNECTION_STRING`; Storage uses `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
  - `SUPABASE_ACCOUNT_PASSWORD` is in `.env` but never used by anything.
- `.env.example` had real values on six of the new lines (host, port, database and user names). They were blanked:
  the template holds names only, and the committed defaults `recorded` and `meta` stay.
- `docs/PROMPT-AUTONOMOUS.md` holds the orchestrator prompt that runs the plan without the founder. It is sized to this
  Mac (8 cores, 8 GB RAM): at most 3 lanes at once and one heavy test run at a time.
  - The founder-only steps become autonomous: a demo platform operator whose TOTP the CLI computes from a 0600 file;
    a Vercel CLI deploy if the GitHub app is missing; the look pick printed as plain text, never a blocking
    question, with look A built only as tokens, shell and six screens until the founder picks.
- The foodops-intel Nebius work was committed on `intelligence` as 1aa562c0, dated 30 Oct 21:08 IST (founder). It is
  not pushed.

## D-070 · 31 Oct · The app look: product site + Munim (founder)

- **The founder picked look A, "product site + Munim", without a board** ("if I do not like it we will change tomorrow
  at 8:00 am"). The base is the product site's language: Gabarito with Akshar, one coral accent, mono kickers, the
  pill nav. It adds Munim's calm ledger: paper and ink working surfaces, hairline rows, tap-for-source on a
  dotted-underlined figure.
- P-1's board is skipped, and P-6 builds the look directly.
- The founder reviews the restyled screens at 08:00 IST. The look stays in tokens and the shell, so a change is
  mostly a token swap.

## D-071 · 31 Oct · Paytm demo shop (autonomous, for founder review)

- The Paytm demo shop is **Bansal Super Mart (sample)** at `/demo/bansal`, with the kirana pack, Asia/Kolkata
  business time and synthetic data only. “Bansal” is a fictional sample name; no real person or business is used.
- Plant about 120 everyday items, 30 days of counter activity, UPI-heavy sales, credit customers, suppliers, bills and
  reorders. Enable campaigns and loyalty only if the kirana pack admits them; otherwise leave the pack unchanged and
  record that result.
- The shop has no public site tonight. Seed dates follow the active recorded/live mode; watcher answer keys are
  hand-worked, with settlement situations held for the settlement lane.
