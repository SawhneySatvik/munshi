# Munshi: handoff to Claude Code cloud sessions

Written 29–30 Oct 2026 by the local orchestrator session, for the cloud sessions that carry the build to submission.
Read §0–§2 before doing anything; §6 is how to work; §9 holds the two starting prompts; §10 is how the founder enables
cloud sessions.

> **31 Oct:** everything is on `main` (D-065). The next plan is `docs/superpowers/plans/2026-10-31-complete-munshi.md`
> (D-066: Paytm on the `paytm` branch, model choice per agent, hosted demo). This file is the history up to 30 Oct.

## 0 · Read first

1. `CLAUDE.md`: the One Guarantee, the hard rules, the database rules.
2. This file.
3. `docs/DECISIONS.md` (D-045 to D-056): binding, never re-asked.
4. `docs/BLUEPRINT.md`: the design (3,056 lines). Its §2.10 tables, §9 gates and §11 guarantee table are the spec.
   **Where BLUEPRINT and a `db/schema` file differ, the SQL is the contract.**
5. The plans in `docs/superpowers/plans/`:
   - `2026-10-29-munshi-build-waves.md`: the waves index, every ticket's row;
   - `2026-10-29-w2-backend.md`: why W2 has a spine, and the W2c table;
   - `2026-10-29-appendix-bp-tickets.md`: the done-when lines the waves cite;
   - `2026-10-29-w1-database.md`: the schema rules and DB-6.

## 1 · The goal and the clock

- **Goal (D-048).** Munshi wins the **Meta Global AI Developer Hackathon**: Indie track, due **Thu 5 Nov 2026, 07:30 IST**. The rubric is Impact 30, Meta AI tooling 25, Technical 20, Demo 25. The main focus is AI-powered small businesses.
- **Other submissions.** Munshi also goes to the Paytm finals (Sat 31 Oct, build on the day) and the PayPal hackathon (13 Nov). Cross-submission is fine (founder).
- **The founder's order (D-049).** Backend → database → architecture hardening → Redis → AI layer hardening → **then the Meta keys** → film → submission. Don't re-argue it.
- **The founder's deadline (D-054):** close every wave by **30 Oct night**, no cuts, up to 8 agents at once. The founder's inputs gate the end (§5).
- **Founder style.** The founder works remotely. Every status update is a self-contained summary, with plain words and no internal ids. Questions are multiple choice, with a recommended option marked and its trade-off stated. Waves, not calendars. Build only after approval.

## 2 · Where the build stands (FACT, measured)

**On `main`, every commit verified** (`pnpm check` green, plus the ticket's red-proofs):

| Commit | Ticket | What |
|---|---|---|
| 657b7d2 … 1a38c10 | plans | spec, waves index, W1 plan, W2 plan |
| 5647af2 | W0 | BLUEPRINT folded with the schema review's 53 findings and the platform spec |
| 2eb21b3 | BP-DB-0 | the v2 schema runner and harness (PostgreSQL 17 embedded) |
| eeedfcf, 94588f1, 3c14e27, 6b87d08, 73e0093, 141bedf | BP-DB-1…5 | every schema file, `00–21`, `30`, `90` |
| 80edbdd | BP-PLAT-1 | superadmin core and the `pnpm platform:*` CLI (TOTP, approve-later changes) |
| 5a365e2 | BP-JOBS-1 | the jobs runner (claims, sweeps, the snapshot purge, the tick route) |
| d47cb2a, eb26f42 | SPINE-0 | the 459-test v1 baseline and `scripts/w2-successors.ts` |
| 3de831c | BP-SPINE | today's core, seed and web reads (with their tests) moved onto v2 in one commit |
| 92830aa | W2c prep | empty area files, registry entries and case files; `@munshi/adapters` |
| c426409 | BP-CON-1 | API v1 contracts (21 operations), `openapi.json`, the dependency-free SDK |
| fbd1dc2 | BP-CORE-1 | hosting layer: config, boot checks, headers and CSP, health, `pnpm dev` verified live |
| a6f6b34 | BP-DB-6 | volume (a busy kirana's year) and query plans (27 of 27); `purchase_day` index |
| 46098fe | BP-F4 | hold a piece: the public ask, member moves, availability as cells, the holds job (8 tests, 10 cases RED) |
| (30 Oct, about 01:00) | BP-AUTH-1, the schema fix-forward, BP-F1, BP-CORE-4b, BP-F2, BP-F5, BP-AI-1 | sign-in; six schema fixes; counter money; reversals and service items; bookings, staff, salary; orders; the AI back office; plus glue (two holds fixtures send `ip_hash`, J2's date). Combined check green: v2 453 tests (one file re-run alone), web 185, every package suite and tsc. Each lane's own red-proofs were RED in its lane |

**Measured on main (29 Oct, 23:00):**
- suites: core 21, agent 81, db v1 95, db v2 312, web 177, config 5, contracts 15, sdk 7, all passing;
- full red-proof after the spine: 664 RED, 0 NOT RED, 0 ERROR;
- a counter sale takes 11–17 ms to commit at volume; the order board 0.28 ms.

**Finished on branches, or still running at handoff.** §2.1 below is the final table, updated at handoff.

### 2.1 Branch state at handoff

- **P9a Vercel layout completed (31 Oct, 04:10 IST):** root services, base-path links, per-site keys, filtered installs,
  and deployment redproofs are in this branch. Five clean-archive previews built the app services but failed Vercel
  packaging; separate projects are the next fallback, but CLI project creation/listing did not respond. No hosted URL
  exists yet. `pnpm check` passed (v2 568; web 363 passed, 1 skipped; sites 10; all other package tests/typechecks
  passed). Site bundle-isolation test passed after removing the cross-business key reference.

**Integrator progress (cloud session, 30 Oct; pushed to `claude/quirky-cerf-r5bf1c`, D-058).**
- Harness: every embedded cluster is UTF8 and SUPA1's cluster runs as `postgres` under root (a bare container made
  SQL_ASCII clusters and failed 15 v2 files); REV1's double reversal serialized on the original's lock.
- `w2/f3a` and `w2/cap-1` merged (rows below). `w2/int` and `w5/ai-1` were already on `main`.
- **BP-WIRE-1 done** (D-059): sale ↔ order (ORD3 end to end, the advance applied), hold (sold), booking (done);
  payment/credit take the order forms; CAP-1's gaps closed (decide, parts, holds, item kinds); taint wired (the bill
  flow runs under `tappedPort`); `runBackOffice` schedules the watchers and the morning brief from the tick. 12 tests,
  22 cases RED; `pnpm check` green (v2 513, web 185). Left: `allow()` in the app port (needs the demo default config),
  the schema items below (next schema batch).
- **BP-CORE-5b done** (D-060): Elite and Prabhave provisioned (reserved slugs) and built through core, 3 + 4 planted
  situations with hand-worked keys, sites verified and the demo default config set by a seeded operator's approved
  changes; core `publishRelease` + the `site.catalogue` read (B4 caught a hand-written release snapshot); wired into
  `pnpm dev` / `pnpm reseed`. 7 tests, 15 cases RED; `pnpm check` green (v2 520, web 185). Prabhave's real catalogue,
  spelling and measurement points still owed (labelled placeholders).

**State at handoff (30 Oct, about 01:00 IST).**
- **Main green fix completed (31 Oct, 03:37 IST):** Elite attendance stops before today in the shop timezone; the console stale-digest check is pinned at its starting time. Its focused suite passed 8/8 ten times, the two lane redproofs were RED, and two consecutive full `pnpm check` runs passed (v2 567/567; web 363 passed, 1 skipped of 364; all other package tests and typechecks passed).
- **Schema controls completed (31 Oct, 03:38 IST):** added the shared deployment AI-call ceiling, sandbox AI default, approved model allow-list and owner-only model choice audit, plus tenant-scoped settlement-import provenance and UTR uniqueness. Defaults remain safe/off until the next lane approves demo limits. Four schema redproofs were RED; the manifest gate passed 20/20; the combined full check passed twice (v2 567/567; web 363 passed, 1 skipped of 364).
- `main` holds everything except the two branches below.
- The combined work (sign-in, schema fixes, counter money, reversals, bookings and staff, orders, the AI layer) was merged after one combined `pnpm check`.

| Branch | Holds | State | First action for the integrator |
|---|---|---|---|
| `w2/f3a` | BP-F3a, the messaging core (34 tests, 36 cases RED alone) | **Merged by the integrator (30 Oct):** CH1 uses real-session owners (`startSession`); 36 RED / 0 NOT RED; `pnpm check` green (v2 487, web 185). Was: Not merged: 4 CH1 tests fail with sign-in in. `ch1.test.ts` stood in for a real session with `ALTER DATABASE … SET munshi.via='real'`, and `withTx` now always sets `munshi.via` (`''` for an `openSession` session). | Rebase onto `main` (the index files are unions). In `db/test/v2/core/messaging/ch1.test.ts`, replace the stand-in with real-session members from `startSession(c, tenantId, memberId, 'real')` (`packages/core/src/session.ts`). Run `pnpm check` and its own cases, then merge. |
| `w2/cap-1` | BP-CAP-1, capability switches (14 tests, 25 cases RED alone) | **Merged by the integrator (30 Oct):** no fixture needed a change (v2 501 green); 25 RED; H1's scan now skips `.claude/` (agents' worktrees). Was: Merge after `w2/f3a`. Its check refuses start commands whose base capability is off, so other lanes' test shops (`smallShop` and the area fixtures) may need `switchCapability` or a pack that includes the capability. | Rebase, run `pnpm check`, fix fixtures, not the check. Then do BP-WIRE-1, below. |

**The AI layer's leftovers (merged, not wired):**
- wire `allow` and `taint` in `apps/web/lib/server/agent-port.ts` and the db test port;
- schedule the brief job;
- plan its 14 new reads in the perf gate;
- the shared sandbox ceiling needs a global counter: choose (a) `platform.sandbox_usage` or (b) `ops.rate_counter` (a schema change).

**BP-WIRE-1** (one ticket, after `w2/f3a` and `w2/cap-1` are on `main`). The lanes left these joins on purpose:
- **`sale.record`** (`commands-sale.ts`):
  - take `orderId` and `reservationId`;
  - write `books.sale.order_id` and `sale_line.order_line_id` at the promised unit price, then call `orderDelivered(ctx.c, orderId)` (ORD3);
  - apply the advance by debiting `customer_advance` with `advanceHeld`;
  - call `sellHeldPiece(ctx.c, reservationId)` after the lines;
  - decide what `sale.reverse` does to a held piece and to an order's delivered step.
- **`payment.record` and `credit.record`** (`commands-trade.ts`):
  - `z.union([existing, orderPaymentInput])` with `if ('orderId' in i) return recordOrderPayment(ctx, i);`
  - `z.union([creditRecord, advanceCreditInput])` with `if ('paymentId' in i) return keepAdvanceAsCredit(ctx, i);`
- **Capabilities (CAP-1's gaps):**
  - `decide()` must call `refuseSwitchedOff` after `d.run`; today an approved draft runs with its capability off;
  - a command's parts must check theirs, raising `CoreError('capability_off', { fields: ['credit'] })` and so on: `sale.record`'s credit, offers, loyalty and packages; `order.confirm`'s stitching;
  - hold moves (`reservations.ts`) must call `can(session, 'holds')`;
  - `item.create` must refuse a kind the shop's capabilities don't admit.
  - Make sure `order.confirm` isn't refused at a kirana because its `stitching` row is off. Only the base row should gate it.
- **Schema (the migrator), found by BP-F5:**
  - `ops.contact_hold` (21) subtracts an advance kept as credit with the wrong sign. It only over-refuses an erasure, never under-refuses, but fix it;
  - `ops.inbound_message.channel` admits only `whatsapp`;
  - `munshi_public` has no read of `ops.order_state` or `books.order_step`, which `GET /orders/{code}` needs.

**Founder confirmations pending (not blocking; ask once):**
- **D-053 rounding** as built: each line's share rounded down to the paisa, the remainder to the largest line, and any overflow spread to the next lines.
- **The demo inbox** shows without a WhatsApp grant (recommended: yes; sends stay recorded). Today `can('messaging')` is false without a grant.

## 3 · What is left, in order

Ticket rows and done-when lines are in the waves index and the appendix. These are the regroupings and additions since,
in the order to do them.

### W2 close (backend)

> **Status (integrator, 30 Oct):** items 1–5 and 8 are done on `claude/quirky-cerf-r5bf1c` (D-058…D-062): the branches
> merged; BP-WIRE-1; BP-CORE-5b (Elite, Prabhave as labelled placeholders, the demo default config); the W2-close fixes
> (unique case names with a load-time guard, the clean run's re-run counting, real sign-in's config keys, perf fixtures
> for every named read: perf 61 of 61); BP-FLIP (v1 deleted, 0 successor problems); the BLUEPRINT fold. Review R-A ran
> (no rank-1; round 1 fixed R-A-1 and R-A-2, D-061). Left: R-A round 2 (R-A-3, idempotency keys in the web forms), the
> full red-proof sweep. Also done ahead of W3: BP-CORE-2's route move (screens under `/app`, one transaction per page)
> and BP-WEB-1 (the product site and onboarding, `.screenshots/BP-WEB-1/`).
>
> **Merged since (30 Oct night):** R-A-3 (every web form carries its render's idempotency key); BP-F3b (the WhatsApp
> webhook, live and configured only; the outbox wired at boot and flushed after an approval; `inbox.order_link`);
> BP-UI-1 (Neem Ledger tokens and shell, `<Figure>` takes refs only, the contrast and brand gates,
> `.screenshots/BP-UI-1/`); BP-API-1 (`/api/v1`: the 18 non-deferred routes, S1–S10 and PUB1, 17 cases RED).
> `pnpm check` green: v2 526, web 284, every package. Then **W5 merged** (BP-AI-2 chat → order, BP-F3c the agent's
> copy and replies, BP-EVAL-1 injection and cross-tenant suites; 26 cases RED; not yet wired into the app's port):
> v2 544, agent 94, web 284 (figure.test timed out its seed hook once under load; alone 4 of 4). Running: BP-WID-1 +
> BP-CACHE-1, BP-APP-1…4. The full red-proof sweep is in progress in its own worktree.
> Then **BP-WID-1 and BP-CACHE-1 merged**: `<munshi-order>` (`apps/web/public/widgets/munshi-order.js`, a demo page in
> `design/widget-demo/`), the cache port (memory, Redis over RESP on a socket in `pnpm dev`), tenant-first keys, a 50 ms
> budget then Postgres, RC1–RC4; p95 of the catalogue read 15.5 → 7.3 ms (memory) / 11.9 ms (Redis); 19 cases RED;
> `pnpm check` green (v2 544, web 292). Running: BP-APP-3 and the APP screenshots (APP-1, 2, 4 are committed on `t/app`),
> then BP-SITES-1.
> Then **the app's agent port asks `allow()`** before every model call (ALLOW-APP, red-proved; the web test home
> approves the demo default config as the seed does), and **BP-APP-1…4 merged** (D-063): offers, packages, loyalty,
> customers, invoices; calendar, requests, staff, salary; orders; inbox, campaigns, settings and `/app/office` (the
> morning brief); 96 screenshots in `.screenshots/BP-APP/`. `pnpm check` green: config 8, sdk 7, contracts 15,
> adapters 4, core 21, widgets 5, agent 94, v2 544, web 345 (+1 skipped). Running: BP-SITES-1, the console screens
> (BP-PLAT-1, CONSOLE1).
> **The W2-close red-proof sweep is done** (at f2b550e, 928 cases): every case RED but two — `v2-c1-stored-total`
> (ERROR, its mutation text updated, RED) and `v2-ai-pack-ignored` (NOT RED: the watchers' pack fallback predated
> CAP-1 and disagreed with `can()`; the watchers now read no switch row as off, and the case is replaced by
> `v2-ai-switch-ignored`, RED). `pnpm check` green after (v2 544, web 345).
> Then **BP-SITES-1, the console (BP-PLAT-1, CONSOLE1) and BP-DEV-1 merged** (D-064): both shop sites through the SDK
> against `/api/v1` (60 screenshots, `.screenshots/BP-SITES-1/`); `/platform/*` with its own operator cookie, proposals
> approved in a later request (30 screenshots, `.screenshots/BP-CONSOLE/`; dev's operator sign-in in
> `.run/dev-operator.json`); `/developers` built by `pnpm kit`, the SDK tarball by `pnpm sdk:pack`. `pnpm check` green:
> config 9, sdk 7, contracts 15, adapters 4, widgets 5, core 21, sites 9, agent 94, v2 544, web 363 (+1 skipped).
> Then **BP-OPS-1 merged**, the deploy kit, written and tested offline: `deploy/supabase.md` (replaces neon.md),
> `deploy/vercel.md`, `docs/DEPLOY.md` (the runbook and the founder's checklist), v2 `deploy-check` (DEPLOY1, SUPA1),
> the capture guard (CAPTURE1), both `vercel.json` (VERCEL1), the demo boot refusing a channel credential; 28 cases
> RED. `pnpm check` green: config 10, v2 562, web 363. Running: the deploy follow-ups (markers, BOOT1's boot half,
> the platform secret on live, a hosted seed).

1. **Merge what's finished** (§2.1), each rebased on `main`, with `pnpm check` and its own cases.
2. **BP-WIRE-1** (small, after BP-F1 and BP-F5 are on main):
   - `sale.record` calls `orderDelivered(c, orderId)` for a sale naming an order (ORD3);
   - it calls `sellHeldPiece(c, reservationId)` for a sale naming a hold, if BP-F1 didn't wire it;
   - hold moves call `can(session, 'holds')` once BP-CAP-1 is on main.
3. **BP-CORE-5b, the showcase tenants:**
   - Elite (salon) and Prabhave (boutique: orders, stitching, holds) built through real paths with their packs and deterministic ids, each with an answer key of planted situations;
   - the showcase sites verified by the seeded operator's approved platform changes.
   - Until the founder sends Prabhave's catalogue, spelling and measurement points, use **labelled placeholders**.
4. **W2-close fixes, found by lanes:**
   - **Rename the duplicated v2 case names** so each is unique: `v2-h1-expected-unchecked`, `v2-c4-no-recheck`, `v2-c5-resee-no-run`, `v2-h1-evidence-any-item`, `v2-vision-tools-offered`, `v2-vision-tool-call-used`. With a duplicated name, only the first case's SQL runs, which is a hole in the safety net.
   - **The full sweep's clean check** saw L1 (`16-offers-loyalty`) and P2 (`17-packages`) reported "passed,passed". Find out why a test runs twice, and fix the harness or the test.
   - Add `sabotagePlugin` to `apps/web/vitest.config.ts`, so web gates are red-proved by the runner, not by hand.
   - **Real sign-in config:** `MUNSHI_IDENTITY_SECRET` and `MUNSHI_RATE_SECRET` in `packages/config`, `.env.example` and `db/src/dev.ts`. The demo doesn't need them.
   - Perf fixtures for the new reads (bookings, orders, holds, messaging) in `db/test/v2/perf/plans.test.ts`; then run the perf config, which is not part of `pnpm check`.
5. **BP-FLIP:** delete v1 (`db/migrations`, the v1 tests and `db/test/sabotage.ts`, `db/src/migrate*.ts`, the `embedded-postgres` 18 devDependency). Every remaining v1 test gets a successor or a reason in `db/test/v2/successors.json`. The successor script must report 0 problems.
6. **Full red-proof sweep** (v1 before FLIP, v2 after), on a quiet machine.
7. **Review R-A** (W1 and W2): read-only, both clauses, at most two fix cycles, each finding closed by a red-proved gate. Start from the residuals in §4.
8. **Fold into BLUEPRINT:**
   - the migrator's grants and columns beyond §2.10 (in each BP-DB commit message and report);
   - the W2 regroupings (D-051);
   - D-052–D-056;
   - the console's row in §11.2 (D-052).

### W3 · Architecture hardening

- **BP-API-1, `/api/v1`, against `packages/contracts`:**
  - S1–S10 and PUB1; every route in the contracts, the two order routes included;
  - the error table; cursor pages; idempotency replays; rate limits (`rate.ts`); the bot-check adapter (recorded until Turnstile); VERIFY1's route half;
  - publishing a release, if no core function exists yet.
  - CON-1's rules: a bad path parameter answers 404 `not_found`, never 400; raw strings go into the schemas (`z.coerce`); an untraceable ref answers 200 `{verified:false, label:'Cannot verify'}`.
  - `apps/sites` fixtures carry null refs and fields the SQL lacks; BP-SITES-1 fixes them.
- **BP-F3b, the WhatsApp webhook:**
  - the signature checked (red-proved); the webhook writes ops rows only; an `ORD-` code links its request;
  - **wire the outbox:** `wireChannels(channelsFor(deployment, recordedSender(), live))` at boot, plus the after-approval flush `runDueJobs(jobsPool, now, ['outbox'])`. Until then, demo deliveries stay `queued`.
- **BP-WID-1:** widgets (`<munshi-order>`) on a plain page against the local API. A switched-off capability renders nothing; every figure carries its ref.
- **BP-CORE-2, the remaining half:** move the screens under `/app`, one transaction per page. The screen reads are already in core views (SQL1 is green).
- **Review R-W3.**

### W4 · Redis cache (BLUEPRINT §4.8; Redis is installed locally and in the cloud image)

- `packages/adapters/cache`: memory and redis adapters, plus core's `cacheKey(tenantId, kind, …)`.
- **Cached:** a release's pinned snapshots, a pinned snapshot by id, and the slug lookup, with negative entries.
- A 50 ms budget, then fall back to Postgres. RC1–RC4.

### W5 · AI layer hardening

- BP-AI-1 (running at handoff, §2.1).
- BP-AI-2: chat to order.
- BP-F3c: the agent's messaging copy (K3, K4, EX2).
- BP-EVAL-1: injection and cross-tenant suites.
- Review R-W5.

### Surfaces (needs the founder's look pick, §5)

- BP-UI-1: the design system and shell.
- BP-WEB-1: the product site (site-F "Ask", evolved; D-046).
- BP-SITES-1: the hosted shop app for Elite and Prabhave.
- BP-DEV-1: the developer portal.
- BP-APP-1/2/3: counter, offers, invoices; calendar and staff; home, inbox, ask, campaigns, settings.
- The console screens (CONSOLE1).
- Every state is screenshotted at 390 px and 1280 px.

### W6 · Meta keys → Deploy → W7 film → W8 submission

- **W6:** the first live calls (Muse Spark 1.3, SAM 3.1, Voice Transcribe; Spark Open on Baseten), `scripts/meta-smoke.ts`, and the fixtures re-recorded. This runs where the key is: locally, or a cloud network secret (§10).
- **Deploy:** BP-OPS-1 (the deploy kit) and BP-OPS-2 (the demo on Supabase plus Vercel, hosted Redis; deploy from a clean checkout).
- **W7:** the film (`docs/FILM-SCRIPT.md`, `video/`).
- **W8:** the README with measured counts, the form, the post.

## 4 · Open findings and residuals (for R-A and later)

- **`wages.pay` is unbounded.** It's a person's own recorded command, but payments have no kind column or link to a salary line (BP-F2).
- **Before live:**
  - the client IP trusts the first `x-forwarded-for` hop, and the bot check is recorded as passed (BP-AUTH-1);
  - `identity:reset` deletes session rows with no audit entry, because no owner path raises the epoch;
  - decisions don't carry the reset grant.
- **Messaging:**
  - W7's "offer ended between approval and send" needs `select (tenant_id, id, offer_id) on ops.campaign` for the jobs role;
  - `extract_span` misses three digit scripts (U+06F0, U+1C50, U+ABF0);
  - a job can't commit its claim before an external send, so a crash between send and commit resends.
- **Salary approval window:** BP-F2 adds the tenant chain lock in `citesPreview` (check it is on main).
- **Schema batch** (the migrator's `schema2`, §2.1): the piece-hold per-IP cap (D-055); `reservation_flow` same-state and reason guard; booking `ip_hash` nulled at a final state; unreferenced message texts purged; test recipients removed on erasure; request item ids checked against the tenant.
- **Accepted residuals:**
  - E1's `ai.*` half can't fail (no free text there);
  - a reused display snapshot keeps its first minter's `actor_id`;
  - words and dates in a voice note are parsed by core alone.
- **The GST rules (D-052, D-053)** follow public law as read (INFERENCE); a chartered accountant checks before any real invoice.

## 5 · Founder inputs owed

1. **The app look pick (E–J) and site round 3.** Surfaces can't start without them.
2. **The Meta key** (W6).
3. **Supabase, Vercel and Redis accounts** (Deploy).
4. **Prabhave:** spelling, catalogue, measurement points, and confirmation of the order steps (the migrator's `ref.order_flow` design).
5. **Merchants:** written permission for their names and branding on public pages, and their GST status.
6. **A CA's check:** GST with discounts (D-052, D-053), and stitching advances.
7. **Optional:** the per-IP piece-hold cap (D-055 set it at 3).

## 6 · How to work in cloud sessions

**Roles.**
- **The integrator** (one session at a time) owns `main`:
  - it merges ticket branches in order, runs the wave closes (full sweep, reviews), writes the founder's summaries and keeps this file current;
  - it is **the only session that pushes `main`**, after each verified merge.
- **Ticket sessions** (several in parallel) do one ticket each:
  - each works on its own branch `t/<ticket>` made from `main`, never edits or pushes `main`, and pushes only its own branch;
  - each ends with a report in the format below.
- **The schema owner:** one session at a time may edit `db/schema/**`. Another ticket that needs a schema change reports it, and the integrator gives it to a schema session.

**Before running tickets in parallel,** the integrator commits a prep: empty area files, registry entries and red-proof case files for each ticket, as 92830aa did. Then no two tickets edit a shared registry (`commands.ts`, `queries.ts`, `jobs.ts`, `db/test/v2/sabotage/index.ts`).

**Merging** (integrator):
1. `git fetch`, then check out the branch and rebase it on `main`.
2. Resolve conflicts. Registry and index lines are unions. Lockfile: take `main`'s, then run `pnpm install --offline`.
3. **Check for markers before `rebase --continue`:** `git grep -n '^<<<<<<< '`.
4. Run `pnpm check` and the ticket's own red-proof cases.
5. Fast-forward `main`, then push.

A suite that fails only from a setup-hook timeout under load is re-run alone, and both runs are reported.

**Rules that bind every session:**
- `CLAUDE.md`'s rules, in full.
- **No AI attribution:** `.claude/settings.json` turns off the co-author trailer, the PR line and the session link. Never add them by hand.
- **Never read `.env` or `.run/`.** Keys live in cloud network secrets, never in the repo.
- **Models stay recorded** (`MUNSHI_MODEL_MODE=recorded`) until W6. New fixtures are written only through the fake transport (`MUNSHI_AGENT_FIXTURES=write`, `MUNSHI_WEB_FIXTURES=write`).
- **Red-proofing (D-056):** a session proves its own new cases once; full sweeps only at wave closes and before submission.
- **Never kill processes by pattern.**
- **One-commit moves:** when shared code changes shape, the code and its tests move in the same commit (D-051). Taking tests out of `pnpm check` is never a way through.
- **The cloud VM is about 4 vCPU and 16 GB.** Each test file starts its own embedded PostgreSQL.
  - Run the db v2 suite with `--maxWorkers=2` if memory runs short.
  - Never run two full suites at once in one VM.
  - Use subagents for reading and review; heavy test runs belong to separate sessions.

**A ticket session's report** (its final message):
- files and line counts;
- tests per gate;
- verbatim verify output (the v2 suite, the package tests, tsc, biome, its own red-proof cases);
- doc-versus-SQL choices;
- schema wishes;
- a guarantee scan with both clauses, stated even when clean;
- what it did not do.

## 7 · Commands

```bash
pnpm install --frozen-lockfile        # the SessionStart hook runs this
pnpm check                            # lint + typecheck + every suite (db runs v1 then v2)
cd db && ../node_modules/.bin/vitest run -c vitest.v2.config.ts [path]   # the v2 suite or one area
cd db && node test/redproof.ts --only=v2 <case names>                    # red-prove named cases
cd db && ../node_modules/.bin/vitest run -c vitest.perf.config.ts        # volume plans (wave gate only)
node scripts/w2-successors.ts --root=. core=<json> agent=<json> db-v1=<json> db-v2=<json> web=<json>
pnpm contracts                        # regenerate openapi.json and the SDK's types
pnpm dev                              # local app on .run/pg17 (reads and writes .run/; never print it)
pnpm platform:list|propose|approve|reject, pnpm identity:reset, pnpm dev:ticker
```

## 8 · Gotchas (measured during this build)

- **The embedded-postgres exit hook can make a failing run exit 0.** The harness fixes it; G8 proves it on v1 and v2.
- **`sabotageIs(name)` throws for a name not in the index.** Add the case to its file first.
- **A duplicated case name runs only the first case's SQL** (§3 W2 close).
- **zsh doesn't word-split `$var`.** Use `${=var}` or `xargs`.
- **`git diff <commit> -- <untracked file>` shows the file as deleted.** Compare with `git show <commit>:<path> | cmp - <path>`.
- **Next 16 renamed `middleware.ts` to `proxy.ts`.** The schema sha is compiled in with `compiler.defineServer`.
- **The J1 scan follows imports.** A jobs file that reaches `read.ts` or `session.ts` fails it.
- **No person's name or phone in any snapshot cell;** names come from `packages/core/src/people.ts`.
- **A rebase while another process runs tests in that tree** produces ERRORs ("sabotage never applied"). Never touch a tree that a red-proof is running in.

## 9 · Starting prompts

### 9.0 The autonomous integrator (use this one): one session on `main`, no founder attention needed

```text
You are the Munshi integrator, working autonomously. The founder is away and will not answer questions. Never wait for
input: when a choice is needed, take the recommended or safest option, record it in docs/DECISIONS.md as the next
D-number (marked "autonomous, for founder review"), and continue. Stop only for something that would break CLAUDE.md's
hard rules or the event rules; skip that item, log it, and move on.

Read once, in order: CLAUDE.md; docs/HANDOFF-CLOUD.md (all); docs/DECISIONS.md. D-057 holds the founder's looks and
priority: the app in "Neem Ledger"; the Munshi site in F "Ask" blended with the Munim site's language (patterns only);
Prabhave a blend of A and C; Elite A. After that, read only what each ticket needs.

ORDER OF WORK
1. Environment: report node -v, pnpm -v (11.9.0), redis-cli ping. Run `pnpm check` on main.
2. Merge per HANDOFF §2.1, each verified as §6 says: w2/f3a (fix CH1 with a real session first); then w2/cap-1
   (fix fixtures, not the check). Then BP-WIRE-1 and the AI layer's wiring as §2.1 lists them.
3. Soundness, the W2 close (§3):
   - CORE-5b, the showcase tenants (labelled placeholders where Prabhave's data is missing);
   - the W2-close fixes, including unique red-proof case names;
   - BP-FLIP;
   - one full red-proof sweep;
   - a read-only guarantee review of W1 and W2 by a subagent (both clauses of the One Guarantee), then at most two fix
     rounds, each finding closed by a red-proved gate;
   - fold the listed items into BLUEPRINT.
4. The Munshi site frontend (BP-WEB-1): product site and onboarding in D-057's look, with sign-up, log-in, "Try the
   demo" and the sample-shop paths working against the real backend. Every page at 390 and 1280 px, screenshotted
   into .screenshots/BP-WEB-1/.
5. The remaining backend and features:
   - W3: BP-API-1, BP-F3b (wire the outbox), BP-WID-1, the BP-CORE-2 route move;
   - W4: the Redis cache;
   - W5: AI-2, F3c, EVAL-1.
6. The app and shop frontends:
   - UI-1, the shell and design system, in Neem Ledger;
   - APP-1, APP-2, APP-3;
   - SITES-1 (Prabhave's A+C blend, Elite A);
   - DEV-1;
   - the console screens.
   Screenshot every state at 390 and 1280 px.
7. A final soundness pass: the full red-proof sweep, `pnpm check`, the perf config
   (`cd db && ../node_modules/.bin/vitest run -c vitest.perf.config.ts`, with fixtures for every new read), and a
   read-only review of everything built since step 3.
8. Stop before W6, Deploy, the film and the submission (they need the Meta key and accounts). Leave them fully
   prepared: scripts, docs and checklists.

HOW TO WORK EFFICIENTLY (the VM has about 4 vCPU and 16 GB)
- Work ticket by ticket on a branch t/<ticket>. Write code with at most two subagents at a time, given disjoint files.
  You run all heavy tests yourself, one suite at a time.
- Per ticket: write each gate's test first and see it fail; implement; see it pass. Red-prove only the new cases, once:
  `cd db && node test/redproof.ts --only=v2 <names>`. Then `pnpm check`. If a file fails only on "Hook timed out",
  re-run it alone with --maxWorkers=2. Fast-forward main, push main, delete the branch.
- Before parallel subagents, commit empty stubs and registry entries, so no two of them edit a shared registry.
- Before every rebase --continue, run `git grep -n '^<<<<<<< '`.
- Full red-proof sweeps only at step 3 and step 7.
- After each merge, update HANDOFF-CLOUD.md §2.1 and §3 in the same push, so the founder can check progress on GitHub.

NEVER
- read or print .env or .run/;
- add AI attribution;
- make a live model call (models stay recorded; new fixtures go only through the fake transport);
- kill processes by pattern;
- take a test out of `pnpm check` to get past it;
- edit db/schema from more than one place at once;
- copy code or assets from another repo.

The One Guarantee outranks everything: nothing changes the books without a named person's approval, and every number
shown traces to a snapshot cell, else "Cannot verify".

END: write a final summary for the founder in plain words:
- what is on main, with measured test counts;
- screenshots' paths;
- every autonomous decision (D-numbers);
- what is left, and which founder input each item waits for.
```

### 9.1 The integrator session, attended (when the founder is available)

```text
You are the Munshi integrator in a Claude Code cloud session. You own `main`. The founder works remotely: every update
you give is a self-contained summary in plain words, and every question is multiple choice with your recommendation
marked.

Read, in order: CLAUDE.md; docs/HANDOFF-CLOUD.md (all of it); docs/DECISIONS.md. Then:
1. Check the environment and report it: `node -v` (22), `pnpm -v` (11.9.0), `redis-cli ping`, `git log --oneline -5`.
   Run `pnpm check` on main; it must be green. If a db suite runs out of memory, re-run it with `--maxWorkers=2`.
2. Read §2.1 of the handoff. For each branch listed there as finished, merge it as §6 describes: rebase on main,
   resolve conflicts, check for markers, run `pnpm check` and that ticket's own red-proof cases, fast-forward, push
   main. Report each merge in one line.
3. Then work §3 in order. For each next ticket, either do it yourself (small ones) or write a ticket prompt from §9.2
   for the founder to start in a parallel session, after committing a prep (stubs and registry entries) so parallel
   tickets never edit a shared file. Keep §2.1 and §3 of the handoff current as tickets land, and commit that.
4. At the W2 close, run the full red-proof sweep and Review R-A (a read-only subagent; both clauses of the One
   Guarantee), then fix forward.
You may push `main` after each verified merge; no other session does. Never add AI attribution, never read .env or
.run/, never kill processes by pattern. Stop and ask the founder for anything touching the hard rules, money or tax,
the event rules, or the founder inputs in §5.
```

### 9.2 A ticket session (one per ticket; fill in the ticket)

```text
You are the <TICKET-ID> lane for Munshi in a Claude Code cloud session: <one-line purpose>.

Create your branch `t/<ticket-id>` from `main` and work only there; push only that branch. Read CLAUDE.md,
docs/HANDOFF-CLOUD.md §6 and §8, your ticket's row in docs/superpowers/plans/2026-10-29-munshi-build-waves.md (and the
appendix row it cites), and the BLUEPRINT sections it names. The SQL in db/schema is the contract.

Territory (create or edit only these): <files>. Your empty area files and red-proof case file already exist where the
prep made them; fill them, and never edit a shared registry or db/test/v2/sabotage/index.ts. Other sessions own
<their areas>; never touch their files. If the schema blocks you, report exactly what is missing.

Done when: <the ticket's done-when, with each gate red-proved in your case file>.

Method: write each gate's test first and see it fail; implement; see it pass; red-prove your own cases once with
`cd db && node test/redproof.ts --only=v2 <names>`. Verify and paste verbatim: the v2 suite (with `--maxWorkers=2` if
memory is short), the package tests you touched, tsc for each package you touched, `node_modules/.bin/biome lint`.
Never read .env or .run/; never mock the database; models stay recorded; no new dependencies; never kill processes by
pattern; no AI attribution. Commit on your branch with a message `<TICKET-ID>: <what, with counts>`, push the branch,
and end with the report §6 lists.
```

## 10 · Enabling cloud sessions (for the founder)

1. **Create the repository.** On GitHub, make a **private** repo (no README, licence or .gitignore), e.g. `munshi`.
2. **Push from this machine.** The orchestrator never creates remotes or pushes, so you do this:
   ```bash
   cd ~/Downloads/projects_26/munshi
   git remote add origin git@github.com:<you>/munshi.git
   git push -u origin main
   git push origin <each branch listed in §2.1 as not yet merged>
   ```
3. **Connect GitHub to Claude.** Either:
   - open claude.ai/code and install the Claude GitHub App on that repo; or
   - in a terminal signed in to claude.ai, run `gh auth login` and then `/web-setup` inside `claude`.
4. **Create an environment** (claude.ai/code, the environment selector, then edit). Name it `munshi`.
   - **Network access: Trusted.** It allows npm, GitHub and Ubuntu's package archives. Add a Custom entry for `*.supabase.co` only at Deploy.
   - **Environment variables:** `MUNSHI_MODEL_MODE=recorded` and `BASH_MAX_TIMEOUT_MS=600000`. Env vars are visible to everyone using the environment, so **no keys here**.
   - **Setup script** (runs as root before Claude starts; must exit 0):
     ```bash
     #!/bin/bash
     npm install -g pnpm@11.9.0 || true
     exit 0
     ```
     The repo's SessionStart hook (`.claude/settings.json` → `scripts/session-start.sh`) runs `pnpm install` and starts the preinstalled Redis in every session.
   - **The Meta key later (W6):** add it as a network secret for Meta's API host. The VM never sees it; the proxy attaches it. How the injected header meets the agent's provider adapter is UNVERIFIED, so if it doesn't, run W6's live calls from this machine instead.
5. **Start the integrator:** pick the `munshi` repo, branch `main`, the `munshi` environment, and paste §9.0 (autonomous) or §9.1 (attended). Then start ticket sessions from the prompts it writes (§9.2), each on `main`.
6. **Optional:** pull a session down to this machine with `claude --teleport` (it needs a clean tree here and the branch pushed). Send a follow-up from the terminal with `claude -p "…" --cloud <session-id>`.

**Why private.** Merchants' real names and branding stay off public pages until they sign (CLAUDE.md); the security review (R-A) hasn't run; and nothing is lost, since a hackathon can be given read access, or a clean public export can be made at submission. Pushing this history publicly now would publish the merchants' design boards and the internal plans.
