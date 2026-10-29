# Munshi build waves to 5 Nov: implementation plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Munshi in the founder's order (D-049), so that the one-shop-day demo works live, hosted, on the
rebuilt database, in time for the Meta hackathon (due Thu 5 Nov 07:30 IST).

**Architecture:** This is the wave index.
- Every wave runs the same way (shipyard method):
  1. its tickets are built in parallel lanes with non-overlapping file territories;
  2. the wave's tests run on a quiet tree;
  3. one adversarial review with a guarantee scan;
  4. at most two fix cycles;
  5. an orchestrator spot-check;
  6. commits by ticket.
- Each wave gets its own **detailed, step-by-step plan** (`2026-10-29-w<N>-*.md`), written just before it starts,
  so it matches the code as it then stands. W1's plan is written once the schema review R4 lands.
- **"The appendix"** = `2026-10-29-appendix-bp-tickets.md`, the ticket rows of the old BLUEPRINT §10, carried
  unchanged. Where a row and the folded BLUEPRINT differ, BLUEPRINT wins.
- Sources: `docs/BLUEPRINT.md` (tables, rules and gates at DDL level) and
  `docs/superpowers/specs/2026-10-29-munshi-platform-design.md` (orders, capabilities, widgets, cache).

**Tech Stack:** TypeScript (Node 22, pnpm 11), Next.js 16, PostgreSQL 17 (local now, Supabase at deploy;
`embedded-postgres` **17.10.0-beta.17** for tests, FACT: on npm), node-postgres 8.23.1, zod, vitest, Redis (local
`redis-server`, a hosted Redis at deploy), Meta Model API (Muse Spark 1.3, SAM 3.1, Voice Transcribe) and Spark Open on
Baseten, recorded until W6.

---

## Ground rules (every ticket)

- **Done when**, beyond the ticket's own line:
  - `pnpm check` is green;
  - `pnpm redproof` is green, with the ticket's new gates shown red, then green, in its report;
  - a failing run exits non-zero (G8);
  - the kirana suite and its answer key are unchanged;
  - UI tickets screenshot every state at 390 and 1280 px into `.screenshots/<ticket>/`.
- **The dual build (new; it keeps `pnpm check` green through the rebuild).**
  - The old path (`db/migrations` → `db/test/global-setup.ts`) keeps serving today's suites (core's database tests
    in `db/test`, the web tests) until W2 retargets them.
  - The new path (`db/schema` → `db/test/v2/global-setup.ts`, config `db/vitest.v2.config.ts`) serves every new
    gate.
  - `db`'s `test` script runs both.
  - W2's last ticket flips the web suite to v2 and deletes `db/migrations` and the v1 harness.
- **One schema lane.** `db/schema/` has one owner, an Opus migrator, working file by file in order (BLUEPRINT §3.1);
  other lanes pick up each file as it lands.
- **At most six Munshi agents at once** (the founder's cap is eight, shared). Reviews count.
- **Model tier:**
  - Opus: the schema, the guarantee, sign-in, the API, money, orders, messaging, the agent, the cache.
  - Sonnet: screens, the portal, the product site, seed data entry, deploy docs.
- **Lanes never stage or commit.** The orchestrator stages by name, reads `git diff --cached --stat` and the lockfile
  diff, and commits by ticket (`BP-xxx: …`) with no AI attribution. Nothing is pushed.
- **Never read `.env` or `.run/`.** Every model call is recorded (`MUNSHI_MODEL_MODE=recorded`) until W6.

---

## W0 · Design close-out (orchestrator)

- [ ] Read R4 (`hackathon/meta-ai-developer-hackathon/review-2026-10-29/R4-schema-review.md`). Fold every rank-1 and
  rank-2 finding into BLUEPRINT §2–§3, each with a "fix (R4 #n)" note.
- [ ] Fold the platform spec into BLUEPRINT:
  - §0.1: decisions 17 (capabilities), 18 (orders) and 19 (cache);
  - §2.5: the new `ref` tables;
  - §2.10: the new and changed tables;
  - §3.1: a new file `21_orders.sql` and the capability tables in `01_ref.sql` and `03_tenancy.sql`;
  - §5.1: order intake and status;
  - §7.2–7.3: desks and watchers by capability, plus the two order watchers;
  - §8.12 Orders and §8.13 Packs and switches;
  - §10: replaced by a pointer to this index;
  - §11: the guarantee rows.
- [ ] Rebuild `docs/blueprint.html` from the new BLUEPRINT (the diagrams for orders and capabilities added).
- [ ] Write `docs/superpowers/plans/2026-10-29-w1-database.md` (step by step).
- [ ] Commit `W0: …`; tell the founder in the terminal what changed.

**Gate:** the founder approves the folded blueprint summary and the W1 plan.

---

## W1 · Database (schema, review fixes, rebuild)

| Ticket | Tier, size | Territory | Done when (with red-proofs) |
|---|---|---|---|
| **BP-DB-0** runner and harness v2 | Opus, M | `db/src/{bootstrap,build,reset,populate-cli}.ts`, `db/test/v2/harness/**`, `db/test/v2/global-setup.ts`, `db/vitest.v2.config.ts`, `db/package.json` scripts, the `db/test/sabotage/` split | an empty set builds; the template is built as `munshi_migrator`, and a file that needs a superuser fails every v2 suite (red-proof); embedded Postgres 17.10 for v2 (gate PG17: an 18-only function fails); the merged manifest drives G1, G4, G9, G10, G13; G8 red-proved on v2; v1 suites untouched and green |
| **BP-DB-1** foundation `00`–`09`, `90`, with the capability tables | Opus migrator, L | those files and fragments, their v2 gates | as the appendix BP-DB-1, plus `ref.capability`, `ref.capability_requires`, `ref.pack_capability`, `ref.command_capability` and `ops.capability_switch`, with CAP4's database part |
| **BP-DB-2** books core `10`–`15` | Opus migrator, L | those files | as the appendix BP-DB-2, plus the `order_id` and `order_line_id` columns in `15` (their keys come with `21`), and the `customer_advance` account |
| **BP-DB-3** `16`, `17`, `18` | Opus migrator, M | those files | as the appendix BP-DB-3 (INV1 with 20 concurrent sales) |
| **BP-DB-4** `19`, `20` | Opus migrator, M | those files | as the appendix BP-DB-4; the cart replaced by `ops.order_request`'s site channel; `inbound_extract.field` gains `item` |
| **BP-DB-5** orders `21`, then `30` | Opus migrator, M | `21_orders.sql`, `30_*.sql` and their fragments | `ops.order_request`, `books.order`, `books.order_line`, `books.order_step`, `ops.measurement`, `ops.measurement_value`, `ref.order_step`, `ref.order_flow`, `ref.measure_point`; the database parts of ORD2, ORD5 and M1; `b_order_flow` red-proved |
| **BP-DB-6** volume and plans | Opus, S | `db/test/v2/perf/**`, `db/test/v2/perf/volume.ts` | a populated tenant at realistic volume (a year of a busy kirana: INFERENCE about 40k sales and 150k lines; Elite: 6k bookings); `EXPLAIN (ANALYZE, BUFFERS)` for every named read and the counter sale; any sequential scan of a growing table fails the gate (red-proof: drop one index) |
| **BP-CORE-0** per-area spreads | Sonnet, S (parallel, no schema dependency) | as the appendix BP-CORE-0 | every existing gate unchanged; each area file exists, including `commands-orders.ts`, `queries-orders.ts` and `capabilities.ts` (empty spreads) |

**Gate:** the v2 suites and red-proofs pass over all files `00`–`90`; the v1 suites are unchanged and green; BP-DB-6's
plans are recorded in its report.

---

## W2 · Backend (commands, reads, rules on the new schema)

| Ticket | Tier, size | Territory | Done when |
|---|---|---|---|
| **BP-CORE-3** snapshots v2 and the read retarget | Opus, M | as the appendix BP-CORE-3, plus `packages/core/src/{queries,queries-agent,queries-app,queries-count,watchers}.ts` retargeted unchanged in meaning | refs unchanged; C3, C5 (5 of 5, nothing else), C6, A1 and B0–B4 green on v2 |
| **BP-CORE-4** commands v2 | Opus, L | as the appendix BP-CORE-4 | C1, C4, C7, REV1 and idempotency on v2 |
| **BP-CAP-1** capability switches in core | Opus, M | `packages/core/src/capabilities.ts`, the `runCommand` check, the registries' capability keys | CAP1–CAP4 end to end; sign-up writes the pack's switches; `can(session, cap)` in the page's one transaction |
| **BP-CORE-5** tenancy, sign-up, populate | Opus, M | as the appendix BP-CORE-5 | the three tenants through real paths with their packs; every planted situation matches its key (two order situations added for Prabhave and the kirana) |
| **BP-JOBS-1** the jobs runner | Opus, M | as the appendix | as the appendix (plus request expiry for `ops.order_request`) |
| **BP-AUTH-1** sign-in and the fence | Opus, L | as the appendix | as the appendix |
| **BP-PLAT-1** the superadmin core and console | Opus, M | as the appendix | as the appendix |
| **BP-F1** the counter's money | Opus, L | as the appendix | as the appendix, plus a sale naming an order (ORD3) |
| **BP-F2** calendar, bookings, staff | Opus, L | as the appendix | as the appendix |
| **BP-F3a** messaging core (recorded) | Opus, L | `packages/adapters/channels/**`, `packages/core/src/{commands-messaging,outbox,inbox,queries-campaigns}.ts` | K2–K6, W1–W8 and CH1 on the recorded sender; at most once under two sweeps |
| **BP-F4** holds | Sonnet + Opus review, S | `packages/core/src/reservations.ts` | a hold changes no book; expiry by jobs |
| **BP-F5** orders core | Opus, L | `packages/core/src/{commands-orders,queries-orders,intake}.ts` | `order.confirm`, `order.step`, `order.reschedule`, `order.cancel` and `measurement.take`; ORD1–ORD5 and M1 end to end; the advance as `payment.record`; cancel with a refund or credit |
| **BP-FLIP** the switch to v2 | Opus, S (last) | `apps/web/vitest.config.ts`, `db/test/` (delete v1), `db/migrations/` (delete), `db/package.json` | every suite runs on v2; nothing imports `db/src/migrate.ts`; `pnpm check` green |

**Review R-A** (Opus, read-only) of W1 and W2, both clauses; at most two fix cycles.

---

## W3 · Architecture hardening (hosting layer, API, widgets)

| Ticket | Tier, size | Territory | Done when |
|---|---|---|---|
| **BP-CORE-1** hosting layer | Sonnet + Opus review, M | as the appendix | as the appendix: no `.run/` read at runtime; boot checks red-proved; CSP on every route |
| **BP-CORE-2** screen reads in core, routes under `/app` | Opus, M | as the appendix | SQL1; one transaction per page |
| **BP-CON-1** contracts and SDK | Opus, M | as the appendix | the freshness test red-proved; the SDK has no dependencies |
| **BP-API-1** `/api/v1` | Opus, L | as the appendix, plus `POST /sites/{slug}/orders` and `GET /sites/{slug}/orders/{code}` | S1–S10 and PUB1; a bad order code is 404, compared timing-safe, never logged |
| **BP-F3b** the webhook | Opus, M | `apps/web/app/api/webhooks/**` | the signature checked (red-proof: a bad signature is refused); the webhook writes ops only; an `ORD-` code in a message links its request |
| **BP-WID-1** widgets | Opus, M | `packages/widgets/**`, `apps/web/public/widgets/**`, `design/widget-demo/index.html` | `<munshi-order>` on a plain page against the local API; a switched-off capability renders nothing; every figure carries its ref |

**Review R-W3** (Opus), both clauses; at most two fix cycles.

---

## W4 · Cache (Redis)

| Ticket | Tier, size | Territory | Done when |
|---|---|---|---|
| **BP-CACHE-1** the cache port | Opus, M | `packages/adapters/cache/**`, `packages/core/src/cache-keys.ts`, the API read path, `db/src/dev.ts` (start `redis-server` on a socket under `.run/`) | RC1–RC4 (spec §5) red-proved; p95 of the public reads measured before and after, in the report |

---

## W5 · AI layer hardening

| Ticket | Tier, size | Territory | Done when |
|---|---|---|---|
| **BP-AI-1** the back office | Opus, L | as the appendix BP-AI-1, keyed by capability | as the appendix, with 17 watchers (plus `order_unanswered`, `order_late` and `advance_unapplied`) |
| **BP-AI-2** chat → order | Opus, L | `packages/agent/src/{intake,order-draft}.ts` and their fixtures | text, voice note and photo of a list → spans → the `order.confirm` draft; ORD4; a tainted run's other proposals refused; unmatched lines become "Not in your catalogue — choose" |
| **BP-F3c** the agent's messaging | Opus, M | `packages/agent/src/{copy,inbox}.ts` | K3, K4 (copy carries refs only); EX2 (a voice note's figures from spans) |
| **BP-EVAL-1** the suites | Opus, M | `packages/agent/test/{injection,cross-tenant}/**` | injection attacks through chats, bill text and catalogue names are refused; a cross-tenant ref is "Cannot verify"; the corpus passes unchanged |

**Review R-W5** (Opus), both clauses.

---

## Surfaces (from W3's end, in parallel with W4–W5; needs the app pick and site round 3)

| Ticket | Tier | Done when |
|---|---|---|
| **BP-UI-1** the calm-ledger system and shell | Opus | as the appendix |
| **BP-APP-1, 2, 3** | Sonnet | as the appendix |
| **BP-APP-4** orders screens | Sonnet | `/app/orders`: requests with drafts line by line against their spans, the board by step, stitching cards; every state |
| **BP-SITES-1** the hosted shop app | Sonnet + Opus for gates | as the appendix (elite-A, prabhave-C), with the order intake replacing the cart |
| **BP-WEB-1** product site (site-F, round 3) | Sonnet | as the appendix |
| **BP-DEV-1** developer portal | Sonnet | as the appendix, plus the widget page |

**Review R-B** (Opus) of everything, both clauses; at most two fix cycles.

---

## W6 · Meta keys (the founder adds them)

- [ ] **BP-M0:** the live smoke test.
  - Spark tool call, SAM 3.1 on a real rack photo, Hindi voice, Spark Open on Baseten.
  - Go or no-go for each, with a fallback where the brief names one.
- [ ] **BP-REC:** re-record every fixture live (`MUNSHI_AGENT_FIXTURES=record`), then rerun the suites in recorded
  mode.
- [ ] Fix what the live calls reveal (each fix with a gate).

**Gate:** the one-shop-day chain runs live end to end: chat → order, Ask by voice, shelf and bill photos, the brief's
findings.

---

## Deploy (before the film)

- [ ] **BP-OPS-1** the deploy kit (Sonnet), as the appendix, plus the hosted Redis.
- [ ] **BP-OPS-2** the founder creates the accounts: one Supabase project (the demo), the Vercel account and a hosted
  Redis (Upstash's free tier and Mumbai region are UNVERIFIED). Then, as the appendix BP-OPS-2, deployed from a clean
  checkout (Munim gotchas 42, 43).

**Gate:** the demo opens from a phone, and `deploy-check` is ok.

---

## W7 · Film, and W8 · Submission

- [ ] The film: the one shop day on the hosted app with live calls; "tap for source" and "Cannot verify" on screen;
  simulated parts labelled.
- [ ] The README with measured counts; the public repository (the founder creates it); the form; the post.

---

## If time runs short: cut in this order

1. the appendix §10.4 items 1–10, unchanged.
2. `<munshi-book>` (keep `<munshi-order>`).
3. The cache's rate counters (keep the public-response and snapshot caches).
4. Stitching's trial-date reminders (keep the steps).

**Cannot fall:** the appendix §10.4's list, plus the order intake and confirm flow, the capability switches, chat →
order, and the live Meta chain.

## Founder inputs, by the wave that needs them

| Input | Needed by |
|---|---|
| The app look pick (round 2, E–J) and site round 3 | Surfaces |
| Prabhave's spelling, catalogue, measurement points; the merchants' permissions and GST status | BP-CORE-5 (sample values until then) |
| The Meta key | W6 |
| Supabase, Vercel and Redis accounts | Deploy |
| A chartered accountant's GST check (stitching advances included) | after 5 Nov, before any real invoice |
