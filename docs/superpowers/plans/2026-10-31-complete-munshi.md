# Completing Munshi: the Paytm finals today, then Meta (plan, 31 Oct 2026)

Written 31 Oct, about 01:45 IST, after the founder's three question rounds (D-065, D-066). **Waiting for the founder's
go**: nothing below is being built yet.

## Where we stand (FACT, measured 31 Oct on `main` 3d987a6)

- `main` holds everything: the local work to 30 Oct plus the cloud integrator's 70 commits. Every commit is now authored
  by the founder (the history was rewritten before the merge and the tree is byte-identical). `origin/main` is pushed and
  is the only remote branch left; the old lane worktrees and branches are removed. A bundle of every earlier ref is at
  `projects_26/munshi-backup-2026-10-31.bundle`.
- `pnpm check` on this Mac at 01:30 IST: config 10, contracts 15, sdk 7, adapters 4, core 21, widgets 5, sites 9,
  agent 94, **db v2 562**, web **361 of 364 (2 failed, 1 skipped)**:
  - `app2.test.tsx`, a manager marks today: **fails again when re-run alone**. It's a date-boundary bug: between 00:00
    and 05:30 IST the seed's "tomorrow" (Elite's `as_of`) and the shop's "today" land on the same day, so a seeded
    "present" row already exists.
  - `console.test.tsx`, a stale digest refused: passes alone, so it's flaky under load (time-step codes).
- The cloud session stopped at **step 7** of its prompt (HANDOFF-CLOUD §9.0): the full red-proof sweep, the perf gate
  with fixtures for every new read, and the read-only review of everything since the backend close are **not done**.
  Reviews R-W3, R-W5 and R-B never ran (only R-A).

### Built (W1–W5, the surfaces, the deploy kit)

The v2 schema (00–21, 30, 90), sign-in, the counter's money with GST invoices, offers, loyalty, packages, reversals,
bookings, staff and salary, holds, orders, messaging with the WhatsApp webhook (recorded sends), capability switches,
the showcase shops (Elite, Prabhave on labelled sample data), `/api/v1` and the SDK, the `<munshi-order>` widget, the
cache port (memory and Redis), the AI back office (17 watchers, the morning brief, chat to order, campaign copy, injection
and cross-tenant suites), Neem Ledger app screens, the product site and onboarding, both shop sites through the SDK, the
superadmin console, the developer portal, and the deploy kit (written and tested offline).

### Left

| Area | Item |
|---|---|
| Soundness | fix the two red web tests; full red-proof sweep; perf gate with every new read; review R-B of everything since the backend close (both clauses), at most two fix cycles |
| Deploy gaps | hosted seed script and a `--deployment` flag on `db/src/build.ts`; Supabase Storage blob adapter; TLS (`rediss://`) in the cache; boot half of BOOT1; capture-guard markers in `apps/web` and `apps/sites`; platform secret required on live; `.env.example` points at the removed `neon.md`; `pnpm reseed` wipes platform rows (D-060) |
| Demo data | demo inbox seeded with inbound messages and customers who gave marketing consent, so the inbox and campaigns work on screen (D-063) |
| Features | `<munshi-book>` widget; BP-APP-3 leftovers (revoke a member's session, the look editor and *Publish*, "insert figure" chips in campaign copy, the office's per-desk cards and run log, inbox filters, over-cap states); the portal's public sandbox key, write examples and Hindi; Hindi item names; the API's look tokens on the sites; the grid writer for variants |
| Residuals (HANDOFF §4) | `wages.pay` unbounded; trust in the client IP (first `x-forwarded-for` hop) and the recorded bot check (Turnstile); `identity:reset` writes no audit entry; three digit scripts missing from `extract_span`; send-before-commit can resend after a crash; the jobs role's campaign read for W7 |
| New (D-066) | model choice per agent (superadmin allow-list, the shop picks); the provider-agnostic branch `paytm` (Anthropic, OpenAI, Gemini, OpenRouter, Sarvam for reasoning and voice, Meta); the hosted demo; the new Munshi deck |
| Meta | W6: live smoke for Muse Spark, SAM 3.1, Voice Transcribe and Spark Open; fixtures re-recorded; the one-shop-day chain live |
| End | the film (after everything else, per the founder), the README with measured counts, the Meta form and post; PayPal (13 Nov) on the agnostic branch |

## How we work tonight

- Local agents, up to 8 at once. Opus for schema, providers, deploy and review; Sonnet for screens, seeds and the deck.
  Each lane gets its own worktree under `projects_26/munshi-wt/<ticket>` and branch `t/<ticket>`. Lanes commit only on
  their own branch. The orchestrator merges into `main` (or `paytm`), runs `pnpm check` and the lane's red-proofs,
  and pushes.
- **Schema stays identical on `main` and `paytm`.** The model-choice tables land on `main`, so either branch can boot
  against the same hosted database (boot refuses a schema sha it wasn't built with). The branch differs only in
  provider adapters, the edition's default bindings and copy. Fixes flow `main` → `paytm` by merge, never back, until
  the founder says.
- Gates run recorded (`MUNSHI_MODEL_MODE=recorded`). Live calls only in each provider's smoke test and on the hosted
  demo.
- **No Paytm logo, colours or wordmark.** It's "for Paytm merchants", never an imitation of Paytm. Payments are
  recorded, never processed. Simulated parts carry their labels.

## Wave P · The Paytm demo (before 09:00 IST; the hack hours 11:00–13:00 refine)

**P0 · Founder, at the start (blocks P4 and P5)**
- Create one Supabase project in Mumbai (Singapore if Mumbai isn't offered). Put its connection strings in
  `munshi/.env.production` yourself, under the names in `deploy/supabase.md`.
- Put the model keys in `munshi/.env`: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`,
  `META_MODEL_API_KEY` (if it arrived), `SARVAM_API_KEY`.
- On Vercel, import the GitHub repo `SawhneySatvik/munshi` (Git integration, production branch `paytm`). I create the
  projects' settings and variables from `deploy/vercel.md`.

**P1 · `main` green and the demo data (Sonnet ×2, parallel)**
- Fix the attendance date-boundary bug at its root (one tz module: the seed's `as_of` from the shop's zone, not UTC),
  with a test pinned at 00:30 IST and at 23:30 IST. De-flake the console's digest test (pin the time step).
- Seed the demo inbox: inbound WhatsApp and Instagram messages (recorded), customers with marketing consent, one
  campaign draft. The answer keys stay unchanged.

**P2 · Model choice per agent, on `main` (Opus, schema + core + console + settings)**
- Schema (one migrator lane): `platform.model_allow` (provider, model, roles it may serve, per-call caps), written only
  by an approved platform change of a new kind `model_allow`; `ops.model_choice` (tenant, agent desk or role → provider
  and model), written only by the shop owner's own command `model.choose`, audited, refused unless the pair is on the
  allow-list.
- Core: the agent port resolves each call's binding as the shop's choice, else the edition default, and it must be on the
  allow-list (fail closed: AI hidden, never an error). `allow()` caps are unchanged. Every run trace records provider and
  model.
- Screens: the console's "Models" page (propose and approve allow-list changes); the shop's Settings → "AI staff": one
  row per agent (counter, bills, shelf, voice, brief, chat to order, campaigns) with a picker. Every AI answer shows
  "Written by `<model>`".
- Gates: an off-list pick is refused (red-proved); a staff member can't choose; the allow-list can't be written without
  an approved change; the trace shows the binding.

**P3 · The `paytm` branch, provider-agnostic (Opus ×2: adapters; Sonnet: edition copy)**
- Cut `paytm` from `main` after P2.
- Add native adapters (each with its recorded fixtures through the fake transport, plus a live smoke):
  - Anthropic Messages, with tools and JSON;
  - OpenAI Responses, with tools and JSON;
  - Gemini, with tools, JSON and vision;
  - OpenRouter, OpenAI-compatible;
  - Sarvam, for chat (reasoning) and speech-to-text (Hindi voice).
  Meta, Baseten and Nebius stay. Current model ids come from a live probe of each provider, never from memory.
- The Paytm edition gets real default bindings (the `TODO-` ids go) and its allow-list seed. The product site and app
  copy say "AI staff for every Paytm merchant", with no Paytm marks.
- `pnpm --filter @munshi/agent smoke` runs one call per provider and role and prints go or no-go. Recorded fixtures stay
  the fallback when a provider fails.

**P4 · The deploy gaps (Opus, on `main`, merged into `paytm`)**
- `db/src/build.ts --deployment=demo`, and the hosted seed script: the kirana, Elite and Prabhave built through core as
  in `pnpm dev`, the operator enrolled, the demo defaults and both sites verified by approved changes, gated by
  `deploy-check`.
- The Supabase Storage blob adapter, behind the existing port.
- `rediss://` in the cache. Tonight the cache stays in memory; hosted Redis comes later.
- The boot half of BOOT1 and the capture-guard markers.
- The platform secret required on live.
- `pnpm reseed` keeps platform rows.
- The `.env.example` pointer fixed (names only).

**P5 · Hosted (Opus + founder)**
- Build the Supabase database from the `paytm` checkout, run the hosted seed, and see `deploy-check: ok`.
- Three Vercel projects from the GitHub branch: the app (`apps/web`), Elite's site and Prabhave's site (`apps/sites`,
  `MUNSHI_SITE`).
- Variables set through a script that loads them through the config module and never prints a value, or by the founder
  in the dashboard.
- Gate: `/api/health` ok; the demo opens on a phone; a client-navigation smoke run (not `page.goto`) passes on all three;
  one live call per provider through the hosted app.

**P6 · The deck (Sonnet, from P5's screenshots)**
- A new Munshi deck as a Slides artifact. Seven slides: title, problem, solution, tech stack (agnostic models, with a
  choice per agent), USP (every number traces to its source; nothing changes the books without a person), impact and
  benefits, business model (no prices or fee percentages).
- Pitched as AI staff for every Paytm merchant. One feature list, grouped by area. The spreadsheet view stays out.

**P7 · Rehearsal**
- A 3-minute demo path on the hosted app, written as a click list: chat to order, a bill photo, the morning brief, a
  campaign, a shop site booking, the model picker, tap for source, "Cannot verify".
- The hack hours (11:00–13:00) fix what the rehearsal finds.

**Gate P:** the hosted demo opens on a phone. A live call answers through at least two providers. `pnpm check` is green
on both branches. The deck is linked.
**Fallback, named once:** if Supabase or Vercel fails on something UNVERIFIED (PG17 extensions, pnpm 11 on Vercel), the
pitch runs `pnpm dev` from the laptop on the `paytm` branch, with live keys, and the hosted fix continues in the hack
hours.

## Wave S · Soundness (after the pitch; `main`, then merged into `paytm`)

- Full red-proof sweep on a quiet tree; the perf config with fixtures for every new read (the P2 reads included).
- Review R-B, read-only (Opus): everything since the backend close (W3, W5, the surfaces, P2–P4), both clauses, plus a
  security pass over sign-in, the webhook, the API and the console. At most two fix cycles, each finding closed by a
  red-proved gate.

## Wave F · Every feature left (parallel lanes, prep commit first)

- `<munshi-book>`.
- BP-APP-3's leftovers.
- The portal's sandbox key, write examples and Hindi.
- Hindi item names and app strings.
- The API's look tokens applied on the sites.
- The grid writer.
- The HANDOFF §4 residuals: `wages.pay` linked to a salary line; trusted client IP and Turnstile; an audit entry for
  `identity:reset`; the digit scripts; claim-then-send; the jobs role's campaign read.
- Prabhave's real catalogue and measurement points when the founder sends them.

## Wave M · Meta (needs the Meta key)

- W6 on `main`: the live smoke for Muse Spark 1.3, SAM 3.1, Voice Transcribe and Spark Open; fixtures re-recorded live,
  then the suites re-run recorded; fixes, each with a gate.
- Gate: the one-shop-day chain runs live end to end.
- The Meta hosted deploy from `main`. It shares the schema, so it can share the hosted database if the founder agrees.
  Otherwise it gets a second project.

## Wave E · End

- The film, after everything else (founder).
- The README with measured counts.
- The Meta form and post (due Thu 5 Nov, 07:30 IST).
- PayPal (13 Nov): a PayPal sandbox payments capability on `paytm`. It is planned separately after 5 Nov.

## Founder inputs, by wave

| Input | Wave |
|---|---|
| Supabase project (Mumbai), its strings in `.env.production`; Vercel connected to the GitHub repo | P0 → P5 |
| Model keys in `.env` (Gemini, OpenAI, Anthropic, OpenRouter, Meta, Sarvam) | P0 → P3 smoke, P5 |
| Prabhave's catalogue, spelling, measurement points; the merchants' GST status | F |
| The Meta key (if not already in) | M |
| A chartered accountant's GST check | after 5 Nov, before any real invoice |
