# Completing Munshi: the Paytm finals today, then Meta — the execution plan

Written 31 Oct 2026, about 02:30 IST (revised 02:50 after a review), after six question rounds with the founder (D-065 to D-068). It is written
for **another AI agent to execute without asking anything back**. Where a choice was left open, the default is written
here and marked *(default; founder may change)*. Follow the waves in order; inside a wave, run lanes in parallel as §4
says.

---

## 0 · Read this first (the executing agent)

1. Read, in this order: `CLAUDE.md` (the One Guarantee, the hard rules, the database rules), this file,
   `docs/DECISIONS.md` (D-045 to D-068: binding, never re-asked), `docs/HANDOFF-CLOUD.md` §4 (open findings), §6
   (how to merge) and §8 (gotchas). `docs/BLUEPRINT.md` is the design; **where it and a `db/schema` file differ, the SQL
   is the contract.**
2. **Never:**
   - read, print, copy or log `.env`, `.env.production` or anything under `.run/`;
   - add AI attribution (no `Co-Authored-By`, no "Generated with", no session links). Every commit is authored
     `Satvik Sawhney <satvik.sawhney2005@gmail.com>`. Check with `git log -1 --format='%an <%ae> | %cn <%ce>'`
     after every commit;
   - copy a file or paste a block of code from Munim (`../foodops-os`, `../foodops-intel`), Cobnut or any other repo.
     Patterns only; write it new (Meta's Indie fresh-code rule);
   - use Paytm's logo, colours or wordmark, or imitate Paytm. The copy is "for Paytm merchants" only;
   - process a payment. Payments are recorded; simulated and synthetic parts say so on screen;
   - make a live model call from a test. Gates run `MUNSHI_MODEL_MODE=recorded`; live calls happen only in the smoke
     scripts and on the hosted demo;
   - kill processes by pattern; take a test out of `pnpm check` to get past it; edit `db/schema/**` from more than one
     lane at once;
   - use any `gemini-2.5-*` model (retired 20 Oct 2026); install `litellm`;
   - put a provider name in the database schema (CLAUDE.md hard rule 5). Provider and model are text **data** checked by
     core against the config's provider list.
3. **Stop and ask the founder** only for: money or tax rules, the event rules, a hard rule, or a founder checkpoint
   (§6). Anything else: take the default written here, record it as the next D-number marked "executing agent, for
   founder review", and continue.
4. Every gate you add must be able to fail. Red-prove each new case once (`cd db && node test/redproof.ts --only=v2
   <names>`), and show a failing run exits non-zero.

## 1 · What is decided (binding)

| Ref | Decision |
|---|---|
| D-065 | All work is on `main` under the founder's name; only `main` exists on GitHub; backup bundle `../munshi-backup-2026-10-31.bundle`. D-058–D-064 accepted; D-053 rounding as built; the demo inbox shows without a WhatsApp grant. |
| D-066 | Branch **`paytm`** off `main` is provider-agnostic (Anthropic, OpenAI, Gemini, OpenRouter, Sarvam, alongside Meta, Baseten, Nebius). `main` stays the Meta edition. Fixes flow `main` → `paytm` by merge, never back. **Model choice per agent:** the superadmin approves an allow-list (approved platform change); the shopkeeper picks per agent from it as their own audited command. Lands on `main`, so the schema is identical on both branches. Hosted tonight: a new Supabase project, plus Vercel from the GitHub branch. Merchants' written permission is in (Elite, Prabhave may be public). New Munshi deck. Demo video after everything else. Nothing is cut. |
| D-067 | **Munshi goes to the Paytm finals** (the founder chose it over Munim + Cobnut, knowing the first deploy happens tonight). A **Paytm dummy shop**, a general store on the kirana pack (name below), synthetic and labelled. The Paytm layer: **Sarvam** for voice (Hindi speech-to-text) and as a selectable reasoning model; **settlement reconciliation** (import a Paytm-style settlement statement, match it to recorded UPI receipts, show the shortfalls with sources); the **per-agent model picker**. No Paytm payment integration. **The app is restyled:** the founder rejected the green "Neem Ledger" look. The base is the product site's look (the `/` site, sign-up and demo picker, `apps/web/components/site/site.css`). A board shows two mixes, *product site + Munim* and *product site + Cobnut*, and the founder picks one before anything is built. Vercel is one project with services and path rewrites, like `../foodops-intel/vercel.json`. |

**The founder's answers at 02:45 (D-068):**
- **Paytm deadline.** The prototype, demo video and deck are submitted by **about 13:00 IST** on 31 Oct. Shortlisting
  is from 14:00, and the top-10 pitch from 17:00. No judging criteria are known.
  - Gate P1, by 09:00: the laptop demo is ready on `paytm`.
  - Gate P2, by 13:00: hosted, with the deck and the video submitted.
- **Strict spend caps on the hosted demo:**
  - sandbox sign-ups get **AI off**;
  - the four demo shops (Bansal, the kirana, Elite, Prabhave) keep 200 text and 40 media calls a shop a day;
  - **one deployment-wide ceiling of 1,500 live model calls a day**, after which every AI surface shows its template;
  - the founder sets a budget limit at each provider's console (F6).
- **The Paytm demo video is made in Wave P** (P-12): a 2–3 minute recording of the hosted Bansal path. The produced
  film waits for Meta.

**Defaults (founder may change):**
- The dummy shop is called **"Bansal Super Mart (sample)"**, slug `bansal`, kirana pack, with `campaigns` and
  `loyalty` switched on if `switchCapability` admits them for a kirana (otherwise the pack as is). It has no public
  site tonight; one can follow a look board later.
- The hosted demo runs on the **`paytm`** branch tonight. The Meta demo deploys from `main` in Wave M.
- The settlement statement format is our own synthetic, Paytm-style CSV (§P-4). It is never Paytm's real format, and is
  labelled "sample statement".

## 2 · Where the build stands (FACT, 31 Oct, `main` 947784f)

- **Suites** (`pnpm check` on the founder's Mac, 01:30 IST): config 10, contracts 15, sdk 7, adapters 4, core 21,
  widgets 5, sites 9, agent 94, db v2 562 all green; **web 361 of 364, 2 red**:
  - `apps/web/test/app2.test.tsx` "a manager marks today …" fails every time on 31 Oct. **Root cause:** `db/seed/elite.ts`
    (~line 218) writes "last month's attendance" relative to `as_of` = tomorrow (`showcase.ts:37`). On the last day of
    a month, "last month" includes today, so a seeded `present` row for today already exists, and the test's
    `half_day` mark doesn't become the row it reads. It fails on the last day of every month.
  - `apps/web/test/console.test.tsx` "approval is refused for a wrong or stale digest …" passes alone, so it's flaky
    under load. A time-step (TOTP or digest) boundary is the likely cause; confirm it before fixing.
- **Not done from the cloud session's list** (stopped at its step 7): the full red-proof sweep, the perf gate with
  fixtures for every new read, and reviews R-W3, R-W5 and R-B.
- **Built:** the v2 schema (00–21, 30, 90); sign-in; counter money with GST invoices; offers, loyalty, packages and
  reversals; bookings, staff and salary; holds; orders; messaging (recorded sends) and the WhatsApp webhook; capability
  switches; Elite and Prabhave (labelled sample data); `/api/v1` and the SDK; `<munshi-order>`; the cache port; the AI
  back office (17 watchers, the brief, chat to order, campaign copy, the injection and cross-tenant suites); every app
  screen; the product site and onboarding; both shop sites through the SDK; the superadmin console; the developer
  portal; the deploy kit (offline only). The screens as built: `design/screens/index.html` (137 screens; open it
  locally).
- **Facts the tickets rely on:**
  - **Model layer:**
    - `packages/agent/src/config.ts`: `EDITION_ROLES[edition][role]` gives a provider and model; the `paytm` map
      holds `TODO-` ids.
    - `providers/types.ts`: roles are `router, reason, vision, segment, voice, narrate`; `PROVIDER_IDS` is
      `meta, baseten, nebius, gemini, openrouter, sarvam`.
    - `providers/client.ts`: one OpenAI-SDK client per provider with `BASE_URLS` and `KEY_ENV`; `resolveBinding()`
      reads the edition only.
    - `providers/generate.ts`: Responses API for `meta`, Chat Completions for the rest.
    - `providers/fixtures.ts`: the fixture key is the sha256 of the canonical request, including provider and model.
    - `meta-sam.ts` and `meta-voice.ts` are Meta-only.
  - **AI caps:** `packages/core/src/allow.ts` (`allowIn`, `aiOpen`); text roles are `router, reason, narrate`, media
    roles `vision, segment, voice`. `platform.shop_config` and `platform.default_config` are in
    `db/schema/09_idp_platform.sql`. `platform.change.kind` admits `shop_config, channel_grant, site_verify,
    reserved_slug, default_config, operator`, and the payload is flat (no arrays or objects, strings matching
    `^[A-Za-z0-9 _.:-]{1,64}$`, numbers 0–100000).
  - **Desks:** `packages/agent/src/desks.ts` `DESK_REGISTRY` lists `stock, sales, orders, bookings, packages, customers,
    staff`.
  - **Settlements:**
    - the `settlement.record` input is `{ channel, businessDate, amountMinor, reference?, receivedOn }`, and it writes
      a journal entry (`packages/core/src/commands-trade.ts:393`);
    - `books.settlement` keeps one live row per channel and day (`db/schema/15_trade_journal.sql:250`);
    - the `watch.short_settlement` watcher runs on `needs: 'counter'`, desk `sales` (`packages/core/src/queries.ts:328`,
      `watchers.ts:29`).
  - **Grid import:** `apps/web/lib/grid/files.ts` parses CSV and XLSX (papaparse, read-excel-file) into `importTable`.
    `grid.apply`, its approval wiring, does not exist.
  - **Media:**
    - `apps/web/lib/api/deps.ts` defines `MediaStore = { read(storageKey) }` and wires `NO_STORE` in production;
    - bill and shelf photos are read straight into the agent and never stored.
  - **Business types:** `ref.business_type` is `kirana, apparel, salon`. The kirana pack is `counter, credit, stock,
    buying, orders, offers, messaging, staff, gst, site, ai` (`db/schema/01_ref.sql:175`).
  - **Seeds:**
    - `db/seed/kirana.ts` builds "Sharma General Store (synthetic)" at `as_of` 2026-10-27 in recorded mode;
    - `db/seed/showcase.ts` builds Elite and Prabhave;
    - `db/src/dev.ts` runs `reseed()`. Supabase steps 1–7 are in `deploy/supabase.md`, and the hosted seed is missing
      (its §5).
  - **Sites:**
    - `apps/sites/next.config.ts` refuses a build without `MUNSHI_SITE ∈ {elite, prabhave}` and builds into
      `.next/<slug>`;
    - `apps/sites/lib/api.ts` reads `MUNSHI_API_URL`, `MUNSHI_PUBLIC_API_URL` and `MUNSHI_SITE_KEY` at runtime.
  - **Looks:**
    - the app's tokens are `apps/web/styles/tokens.css` (Neem Ledger) and `base.css`, plus about 10 component CSS
      files;
    - the product site's look is `apps/web/components/site/site.css`;
    - `apps/web/test/contrast.test.ts` reads `tokens.css`.
  - **Vercel:**
    - `apps/web/vercel.json` and `apps/sites/vercel.json` are checked by `db/test/v2/deploy/vercel.test.ts` (VERCEL1);
    - Munim's Vercel lessons are in `../foodops-intel/deploy/vercel/README.md`: `ENABLE_EXPERIMENTAL_COREPACK=1` for
      pnpm 11; `bom1`; services share one set of variables; Hobby needs the commit author to be the Vercel account's
      GitHub user; deploy from a clean checkout; `--archive=tgz` for CLI deploys; turn off `cacheComponents` for
      dynamic-id client navigation.

## 3 · Before anything: the founder's inputs (Wave P cannot finish without them)

| # | What | Where, exactly |
|---|---|---|
| F1 | **Done (31 Oct, 03:00).** The Supabase project's values are in **`munshi/.env`** under the names the founder added to `.env.example`: `SUPABASE_URL`, `SUPABASE_PASSWORD`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `DIRECT_CONNECTION_STRING` (+ `_HOST/_PORT/_DATABASE/_USER`), `TRANSACTION_POOL_CONNECTION_STRING` (+ parts), `SESSION_POOL_CONNECTION_STRING` (+ parts). The **admin URL is `SESSION_POOL_CONNECTION_STRING`** (the session pooler, user `postgres.<ref>`). `db/src/supabase-roles.ts` reads it through `@munshi/config` and writes the role URLs into `.env.production` (git-ignored by `.env.*`). Storage uses `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server-only), in place of `MUNSHI_BLOB_URL`/`MUNSHI_BLOB_KEY`. **`SUPABASE_ACCOUNT_PASSWORD` is never read or used by anything.** | `munshi/.env` |
| F2 | **Partly done:** `GEMINI_API_KEY` is set. Others (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `SARVAM_API_KEY`, `META_MODEL_API_KEY`, `BASETEN_API_KEY`) come later; a provider without a key stays off the allow-list. | `munshi/.env` |
| F3 | Vercel connected to GitHub `SawhneySatvik/munshi` (the Vercel GitHub app installed for that repo; the Vercel account signed in with the GitHub user whose email is `satvik.sawhney2005@gmail.com`) | Vercel dashboard. The agent creates the project and its settings through `vercel` CLI/API once the app is installed. |
| F4 | **The look pick** (checkpoint C1, §6) | answer on the board page |
| F5 | The operator's TOTP: enrol the authenticator when `pnpm platform:operator` prints the URI once, and give the 30-second codes when asked | terminal, live |
| F6 | A spend limit at each provider whose key is in (Google AI Studio or Cloud billing budget for Gemini; OpenAI, Anthropic, OpenRouter, Sarvam usage limits) | each provider's console |

**If F1 fails** (Supabase's free plan allows a limited number of active projects, and Munim and Nebius may already use
them; the exact limit is UNVERIFIED):
- **never pause or delete a Munim or Nebius project** without the founder's word, because judged demos may still
  depend on them;
- ask the founder: create the project in a new organization, upgrade, or name a project to pause;
- meanwhile Gate P1 holds on the laptop.

The agent checks F1–F2 **without reading the files**. P-0 adds a `scripts/env-presence.ts` that loads through
`@munshi/config` and prints only `NAME: set|unset`.

## 4 · How the lanes run

- Local agents, at most 8 at once. **Opus** for schema, providers, deploy, settlements and reviews; **Sonnet** for
  screens, seeds, the board and the deck.
- Each lane works in `../munshi-wt/<ticket>`, a `git worktree add` from the current `main` (or `paytm`) on branch
  `t/<ticket>`, installed with `pnpm install --frozen-lockfile --offline`. **A worktree lane commits only on its own
  branch and never pushes.** That is HANDOFF-CLOUD §6's ticket-session rule. CLAUDE.md's "lanes never commit" applies
  to a lane working in a shared tree, which this plan never uses. A lane never runs `git add`, `commit`, `stash`,
  `reset` or `checkout` in the main checkout. The **orchestrator** rebases it, checks for markers (`git grep -n '^<<<<<<< '`), runs `pnpm check` and
  the lane's red-proofs, fast-forwards, pushes, then removes the worktree and its branch.
- **The schema has one owner at a time** (the migrator lane). Schema changes tonight go into one ticket, P-5S, in
  a single order: model choice, then the settlement import's extras.
- **Before parallel lanes**, the orchestrator commits a **prep**: empty area files, registry entries
  (`commands.ts`, `queries.ts`, `jobs.ts`, `watchers.ts`, `db/test/v2/sabotage/index.ts`) and empty red-proof case
  files for every ticket, as 92830aa did. No two lanes then edit a shared registry.
- **Lane report** (the lane's final message): the files touched with line counts; tests per gate; verbatim output (the
  v2 suite or its area, the package tests, `tsc`, `biome lint`, its own red-proof cases); doc-versus-SQL choices;
  schema wishes; a guarantee scan stating both clauses even when clean; what it did not do.

**Parallel map for Wave P** (→ means "after"):

```
P-0 prep ──┬─ P-9a step 1: throwaway Vercel layout probe (Sonnet) — FIRST, highest uncertainty
           ├─ P-1 board (Sonnet) ── C1 pick ── P-6a tokens + shell ── P-6b screens (after P-4/P-5 merge for theirs)
           ├─ P-2 main green (Sonnet)
           ├─ P-5S schema (Opus migrator) ─┬─ P-5 model choice + spend ceiling + fallback (Opus)
           │                               └─ P-4 settlements (Opus)
           ├─ P-3 Bansal seed (Sonnet) ──── (P-4 plants its situations)
           └─ P-8 deploy essentials (Opus)
P-5 → cut `paytm` → P-7 providers (Opus ×2) → Gate P1 (09:00, laptop) → P-9b hosted (Opus + founder)
    → P-10 deck, P-11 rehearsal, P-12 video → Gate P2 (13:00, submitted)
```

- **Restyle against the feature lanes.** P-6a (tokens, `base.css`, the shell) merges first.
  - P-4 and P-5 build their new screens directly in the new tokens.
  - P-6b's screen lanes stay out of `app/app/settings/**` and `app/app/settlements/**` until P-4 and P-5 have merged.
  - If C1 arrives late, P-4 and P-5 build in the current tokens, and P-6b restyles their screens after they merge.

---

## 5 · The waves

### Wave P · The Paytm demo (Gate P1 by 09:00: laptop ready on `paytm`; Gate P2 by 13:00: hosted, deck and video submitted)

#### P-0 · Preflight and prep (orchestrator)
- `git pull --ff-only`; `pnpm install --frozen-lockfile --offline`; `node -v` (22), `pnpm -v` (11.9.0).
- Write `scripts/env-presence.ts`. It loads `.env` and `.env.production` only through `@munshi/config`'s loader and
  prints each expected name as `set` or `unset`, never a value. Add a test: a planted value never appears in its
  output (red-proved).
- Commit the prep: empty files and registry entries for P-3, P-4, P-5, P-8 and their case files.
- Record D-067 (written with this plan) and push.

#### P-1 · The look board (Sonnet) → **checkpoint C1**
- One standalone local page, `design/options-3/app-look.html`. Doctype, charset and viewport set; fonts from Google
  Fonts only; no other external assets.
- Two columns, **A: product site + Munim** and **B: product site + Cobnut**.
  - The base for both is the product site's look, `apps/web/components/site/site.css` (its palette, type and spacing as
    shipped; read it, don't copy outside this repo).
  - **A** adds Munim's calm-ledger language. Study, don't copy, `../foodops-os/apps/site/app/globals.css`: paper and
    ink, tap-for-source on a dotted-underlined figure, hairline ledger rows.
  - **B** adds Cobnut's warmer, brand-forward storefront feel. Study `../foodops-os/apps/web` screens in
    `../foodops-os/.screenshots/`, or run its pages.
- Each column shows the same three screens at 390 px and 1280 px, filled with real figures from the kirana seed:
  1. the owner home with the morning brief;
  2. the counter (a sale with UPI);
  3. orders, with a chat-to-order draft waiting for approval.
- Under each column: the token list (colour, type, radius, shadow) as it would go into `tokens.css`, and the contrast
  ratios of every text pair (≥ 4.5:1 body, ≥ 3:1 large).
- Open it with `open design/options-3/app-look.html`. Then **stop and ask the founder** (AskUserQuestion: A, B, or
  notes). If the founder rejects both, make one more round from their notes; never build before a pick.

#### P-2 · `main` green (Sonnet)
- Attendance: change `db/seed/elite.ts` so seeded attendance covers only days strictly before the shop's today
  (`businessDate(now, TZ)` from the one tz module). The salary month stays "last full month before today". Add a test
  that seeds with a fake clock at 31 Oct 23:30 IST, 1 Nov 00:30 IST and 15 Nov 12:00 IST and asserts no attendance row
  is dated today or later. Red-prove it by restoring the old range.
- Console: find the flaky boundary in `apps/web/test/console.test.tsx` "approval is refused…". Pin the clock or step
  at the test's start, so a step rollover between propose and approve can't make the stale digest pass. Run the file 10
  times under `pnpm check` load: 10 of 10 pass. Red-prove that the stale-digest assertion still fails when the refusal
  is removed.
- Done when: `pnpm check` is green twice in a row.

#### P-3 · The Paytm dummy shop (Sonnet)
- `db/seed/bansal.ts`: "Bansal Super Mart (sample)", slug `bansal`, kirana pack, Asia/Kolkata, one shop at a synthetic
  Noida address, built through core like `kirana.ts`: owner, manager, 2 staff, about 120 items (staples, packaged
  foods, toiletries, dairy), 30 days of counter sales with a UPI share around 70 %, udhaar customers, suppliers, bills,
  reorders. No real person or business name.
- Switch on `campaigns` and `loyalty` through `switchCapability` if the kirana type admits them. If it refuses, keep
  the pack and note it.
- Planted situations with a hand-worked answer key, `db/seed/bansal.answers.json`:
  1. a UPI settlement short by ₹1,240 on one day;
  2. a missing settlement on another;
  3. an udhaar customer 45 days overdue;
  4. a shelf gap with a reorder due;
  5. dead stock;
  6. an order unanswered for two hours;
  7. a loyalty regular who has lapsed.
- Wire it into `pnpm dev` and `pnpm reseed` beside the kirana, and into the hosted seed (P-8). Add it to the demo
  picker under the heading "For Paytm merchants (sample)". The demo default config covers it (the sample shops' AI
  caps).
- Gates: the seed is deterministic for a given `as_of`; every planted situation is found by its watcher, matching the
  key, with nothing else. The settlement ones wait for P-4, so this ticket keeps those two key rows marked "P-4".

#### P-4 · Settlement reconciliation (Opus; after P-5S)
- **The statement (synthetic):** a CSV with the header `settlement_date,txn_date,channel,gross_amount,fees,net_amount,
  utr,status`. Amounts are rupees with two decimals. `channel` is `UPI` or `CARD`; `status` is `SETTLED` or `ON_HOLD`.
  Sample files go in `db/seed/merchants/bansal/settlement-*.csv`, labelled "Sample statement" in the UI.
- **Import** (`/app/settlements`, owner and manager):
  - upload a CSV or XLSX through the existing parser in `apps/web/lib/grid/files.ts`;
  - parse **on the server** (client totals ignored), money to minor units with exact decimal parsing (no floats);
  - preview each line against the books for its `txn_date`: receipts (UPI or card sale tenders), settled (net),
    difference, verdict (`matched`, `short`, `over`, `missing in statement`, `already recorded`);
  - "Record these settlements" runs one command, **`settlement.import`**: the person's own direct command, recording
    each new line as a `settlement.record` in one transaction, each with its own audit row and journal entry, under the
    importer's identity;
  - re-uploading the same file records nothing (idempotent by `utr` plus day, and the file's sha256 is kept);
  - rows with `ON_HOLD` are shown and never recorded.
- **Read:** `settlements.reconcile`, cells per business day: receipts, settled, difference, and the verdict as a label
  code. Every figure on the page is a cell with its source.
- **Watchers:** keep `short_settlement` and add **`missing_settlement`**: UPI receipts on a day older than T+2 with no
  live settlement. It has its own query, perf fixture, answer key row and brief line, with the template "No payout yet
  for ⟦1⟧ of UPI sales on ⟦2⟧."
- **Draft:** for a short day the agent may draft a polite message to the payment provider's support, citing the cells.
  The default is **off** for the demo, because messages to real outside parties are books. If included, it is a draft
  and is never sent.
- Gates: amounts re-derived on the server (red-proof: a tampered client total is ignored); the import is idempotent
  (red-proof: the second import records 0); a malformed line is refused with its line number and the rest still
  previews; the import runs only for owner and manager; one audit row per settlement; journals balance; the two
  Bansal key rows are found.

#### P-5S · Schema, one migrator lane (Opus)
- **The model encoding (why aliases).** `platform.change.payload` admits only flat values: strings matching
  `^[A-Za-z0-9 _.:-]{1,64}$` with no run of seven digits, numbers 0–100000, no arrays. Real model ids break it: an
  OpenRouter id has a slash, and an Anthropic id carries a date stamp of 8 digits. So the database stores a **model
  alias**, never a provider's id:
  - a short name matching `^[a-z0-9][a-z0-9.-]{1,31}$`, such as `gemini-flash`, `claude-sonnet`, `gpt-mini`,
    `sarvam-m`, `muse-spark`;
  - the alias resolves to provider and model id **in code**, in `packages/agent/src/models.ts` (`MODEL_ALIASES`),
    written from the probe's output (P-7);
  - the database holds no provider name or model id (hard rule 5), and the payload guard stays exactly as it is,
    including its phone-number refusal.
- **Model choice:**
  - `platform.model_allow`: `id, alias text, role text, enabled boolean, effective_from, change_id references
    platform.change`. **One approved change per (alias, role)**: the payload is `{alias, role, enabled}`. The latest
    row per (alias, role) wins.
  - Add `'model_allow'` to `platform.change.kind`, with its platform guard and audit triggers, exactly like
    `default_config`.
  - `ops.model_choice`: `tenant_id, id, agent text, alias text, chosen_by (member), chosen_at`; append-only, latest
    per (tenant, agent) wins.
- **The spend ceiling** (D-068). ai.usage is under the tenant's forced RLS, so no transaction can sum other shops'
  calls (`allow.ts` header). So:
  - add `platform.ai_usage_total (day date primary key, calls int)`;
  - add a SECURITY DEFINER function `platform.count_ai_call(p_day date, p_cap int) returns boolean`, owned by
    `munshi_owner`. It increments `calls` only while under `p_cap` and returns whether it did;
  - `REVOKE EXECUTE … FROM PUBLIC`, then `GRANT EXECUTE` to `munshi_app` and `munshi_jobs` only (Munim gotcha 21);
  - add `deployment_daily_calls int` (0–100000) to `platform.default_config`;
  - add `sandbox_ai_enabled boolean` (default false), so sandboxes made by the sample-shop sign-up read AI off unless
    an approved change turns it on.
  - A book guard row so only the `model.choose` command writes it.
  - Agents: `ask, counter, bills, shelf, voice, brief, chat_to_order, campaigns, replies, settlements`. Keep the list
    in `ref.ai_agent`, each with its default role (`reason`, `vision`, `voice` …).
  - RLS forced, tenant first in every key, revoke-then-grant blocks, the manifests and `90_seal` updated.
- **No provider names in the DDL** (hard rule 5): provider and model are free text, validated by core.
- **Settlement extras:**
  - `ops.import_file (tenant_id, id, kind 'settlement', sha256, rows, imported_by, imported_at)`;
  - the `settlement.import` row in `ref.command_authority` (owner, manager);
  - `books.settlement` uniqueness by (tenant, utr) when `utr` is not null, with a fix-forward of 15.
- Gates: isolation over the new tables; intel- and agent-write refusal; the guard admits `model.choose` only; an
  operator change is required for `model_allow`; all prefixes build; perf fixtures added. Red-prove each.
- Done when: `pnpm check` is green and its own cases are RED.

#### P-5 · Model choice per agent, core + console + settings (Opus; after P-5S)
- **Core:**
  - `model.choose` (owner only): refused unless the alias is on the live allow-list for that agent's role and the
    running build's `MODEL_ALIASES` knows it;
  - `modelFor(tenant, agent)` returns an ordered list: the shop's choice, then the edition default from `config.ts`,
    then any other allowed alias for the role (the **fallback chain**). Fail closed: an empty list hides the AI
    surface (template), never an error.
- **The live fallback.** In `generate()` (live mode only), a 429, a 5xx or a timeout on one binding moves to the next
  in the chain, inside the run's time budget. Each attempt passes `allow()` and the ceiling. The trace records "fell
  back to `<alias>`". Recorded mode never falls back: a missing fixture stays an error, so gates stay strict.
  - Gate: a fake transport answering 429 on the first binding makes the second answer, and the trace shows both.
    Red-prove it with the fallback removed.
- **The ceiling in `allowIn`**: after the shop's own cap, call `platform.count_ai_call(day, deployment_daily_calls)`.
  `false` refuses with reason `cap`.
  - Gates: with the ceiling at 3, the fourth call across two shops is refused; red-prove with the call removed. A
    sandbox reads AI off while `sandbox_ai_enabled` is false.
- **Agent:**
  - `resolveBinding` takes an optional per-call binding from the port: add `binding(agent)` to `AgentPort`;
  - every run trace records provider, model and agent as labels (no text);
  - every AI answer shows "Written by `<provider> · <model>`", from the trace, not model text;
  - fixtures key on provider and model, so a re-bound role needs its own fixture. The fake transport writes them.
- **Console** (`apps/web/app/platform/(console)/models/`): list the allow-list; propose add or disable; approve in a
  later request with a fresh TOTP (as for `default_config`).
- **Shop:** Settings gets an "AI staff" section with one row per agent (desk name, what it does, current model, a
  picker from the allow-list, "Default" option). Staff see it read-only.
- **Seed:** the demo allow-list (by approved operator changes, one per (alias, role), in `dev.ts` and the hosted
  seed) holds every alias of the running edition **whose provider key is set and whose probe row is go**:
  - `main`: Meta and Baseten;
  - `paytm`: Gemini, OpenAI, Anthropic, OpenRouter, Sarvam, NVIDIA/Nebius, Meta.
  Model ids come from the probe (P-7).
- Gates: an off-list pick is refused (red-proof); a staff member's `model.choose` is refused; an allow-list row
  without an approved change is refused; after a pick, the next run's trace shows the chosen binding; a disabled
  allow-list row makes the surface fall back to the default, or hide if that's off too; the screens are shot at 390
  and 1280 px.

#### P-6 · The app restyle (Opus lead + 2 Sonnet; after C1)
- Rewrite `apps/web/styles/tokens.css` and `base.css` to the picked look, keeping the variable names BLUEPRINT §9.1
  defines (a shop's look overrides them through `lib/brand.ts`). Add a dark set if the board defined one.
- Then the shell (`app/app/layout.tsx`, the nav), then each component CSS file (`components/*.css`), then every
  screen under `/app`. The Sonnet lanes split screens by folder: lane A covers counter, bills, stock, credit,
  suppliers, reports, ask and home; lane B covers offers through settings plus orders, inbox, campaigns, office and
  settlements. Disjoint files.
- Keep `<Figure>` refs-only and the tap-for-source drawer. No layout change that drops a state the screen spec names.
- Gates: the contrast test passes on the new tokens (red-prove with one failing pair); the brand-seam tests pass;
  every screen is re-shot at 390 and 1280 into `.screenshots/BP-RESTYLE/`; `design/screens/index.html` is regenerated
  with `python3 design/screens/build.py` (commit the generator). Show the founder 6 screens before the full pass
  (checkpoint C2).

#### P-7 · The `paytm` branch: every provider (Opus ×2; after P-5 is on `main`)
- `git switch -c paytm main`, push. From now on, `main` fixes are merged into `paytm` after each merge to `main`.
- **Adapters** in `packages/agent/src/providers/`, each the only place its provider's code lives:
  - `anthropic.ts`: the Messages API through the `@anthropic-ai/sdk` package, pinned, with tools and JSON (tool-forced
    schema), and images for vision;
  - `openai.ts`: the Responses API through the existing `openai` package, with tools, `json_schema` and images;
  - `gemini.ts`: keep the OpenAI-compatible path if tools, JSON and vision all pass the probe; otherwise
    `@google/genai`, pinned;
  - `openrouter`: OpenAI-compatible, existing path;
  - `sarvam.ts`: chat (reasoning) and speech-to-text (Hindi). Read the request shapes and model ids from Sarvam's
    current docs at probe time (UNVERIFIED here).
  - Meta, Baseten and Nebius stay.
- Add the new ids to `PROVIDER_IDS`, `KEY_ENV` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and `.env.example` (names
  only). `segment` stays Meta's SAM, or is hidden when its key is absent. `voice` admits `meta` or `sarvam`.
- **The probe** (`scripts/model-probe.ts`) runs per provider whose key is set:
  - it lists models where the API allows it;
  - it runs one call per role with a tool, one with a JSON schema and one with an image;
  - it prints go or no-go per (provider, model, role) and never a key;
  - it refuses `gemini-2.5-*`;
  - its output is written to `docs/model-probe-<date>.md`, the only source for model ids in `EDITION_ROLES.paytm` and
    the allow-list seed.
- The probe's go rows become **aliases** in `packages/agent/src/models.ts` (`MODEL_ALIASES`: alias, provider, model
  id, the roles it passed). `EDITION_ROLES.paytm` names aliases, not ids: reason and router on a Gemini alias by
  default (the key exists tonight); voice on a Sarvam alias if its key is set, else a Gemini audio alias if the probe
  passed, else hidden. `main` gets the same alias layer for Meta's models.
- Fixtures for each new provider are written through the fake transport (`MUNSHI_AGENT_FIXTURES=write`), never live.
  Every agent suite runs green with any provider bound.
- Paytm copy on the `paytm` branch only: the product site and app say "AI staff for every Paytm merchant", with the
  model picker shown as a feature. No Paytm marks.
- Gates: the adapter contract tests per provider (tools, JSON, image, a 429 retry, a timeout abort, key redaction in
  errors — red-prove that redaction); the same answer-key run passes with each provider's fixtures; the probe refuses
  `gemini-2.5`.

#### P-8 · The deploy essentials (Opus; on `main`, merged into `paytm`)

**Tonight:** items 1, 2, 9 and 10 only. Item 3, the blob adapter, comes tonight only if the hosted smoke shows missing
media; otherwise it moves to Wave S. Items 4–8 move to Wave S as S-5.

The hosted seed's `as_of` follows the deployment's model mode (`seedDate(MUNSHI_MODEL_MODE)`). Live means today, and
Bansal follows the same rule.
1. `db/src/build.ts --deployment=demo|live` writes the `ops.deployment` row as the owner after the build. A test
   covers it, and `deploy/supabase.md` step 4's manual SQL is removed.
2. **The hosted seed**, `db/seed/hosted.ts` (CLI `pnpm seed:hosted --confirm=<project-ref>`):
   - it refuses unless `deploy-check` passes, `ops.tenant` is empty and the ref matches the URL;
   - it seeds the kirana (as_of per `seedDate`), Bansal, and the showcase with `verify: false`, runs the watchers,
     proposes the demo reorder draft and issues the site keys;
   - it prints only tenant ids and site-key ids (not the secret parts);
   - the founder's operator, the demo defaults, the `model_allow` changes and the site verification then go through
     `pnpm platform:*` (F5).
3. **MediaStore on Supabase Storage**, `packages/adapters/blob/`:
   - `read`/`write` against Storage's REST API with the service key held only server-side;
   - one private bucket per tenant (`t-<tenant uuid>`), short signed links;
   - the database keeps id, sha256 and size;
   - the local adapter uses `.run/blobs/`;
   - wire it in `apps/web/lib/api/deps.ts` instead of `NO_STORE` when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set;
   - store bill and shelf photos and settlement files through it (sha256 checked on read).
   - Gates: a cross-tenant key is refused; a sha mismatch is refused; the key never appears in a client bundle (scan,
     red-proved).
4. **`rediss://` in the cache:** TLS through `node:tls` with SNI, the config pattern widened, a red-proof. Hosted Redis
   stays optional; empty means memory.
5. **BOOT1's boot half** in `apps/web/lib/server/db.ts`: a hosted app refuses a `hosted = false` database and a live
   one not built from migrations.
6. **The capture-guard markers:** `<html data-class data-tenant>` on app pages, and `<meta name="munshi-surface"
   content="public-site">` on site pages; `scripts/capture-guard.ts` passes on the screenshot pages.
7. **The platform secret is required on live** (`signInKeys()` and `webConfig`), optional on demo.
8. **`pnpm reseed` keeps `platform.*`:** no cascade from `ops.tenant` into `platform.change`. Test it.
9. **`.env.example`:** point at `deploy/supabase.md`, and add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MUNSHI_SITE_KEY_ELITE`, `MUNSHI_SITE_KEY_PRABHAVE`, `MUNSHI_API_URL` (names only). These names
   are the founder's template; adding names is allowed, values never.
10. **The demo inbox:** seed recorded inbound WhatsApp and Instagram messages and customers with marketing consent for
    the kirana, Bansal and Elite, so the inbox, replies and campaigns work on screen (D-063). Answer keys unchanged.
- Gates: each item's own test, red-proved; `deploy-check` passes against a scratch PostgreSQL 17 built with
  `--deployment=demo` and seeded by `hosted.ts`.

#### P-9a · Vercel: one project, services, path rewrites (Sonnet; step 1 runs first in Wave P)

**Why it's first.** No evidence exists that this layout has ever deployed:
- `../foodops-intel/vercel.json` is uncommitted, and the Nebius URLs answer 404;
- Munim's live services project, `munim-api`, was deployed by a CLI upload of staged output, because Vercel's own Git
  build could not build it (`../foodops-intel/deploy/vercel/README.md`).

**Step 1, the layout probe** (throwaway, in parallel with everything else, needs F3):
- a scratch branch `probe/vercel` with a bare copy of the layout below, where each Next service renders one page naming
  itself, and one service sits under `/s/elite` with `basePath`;
- push it, deploy it as a Vercel **preview** with the Git integration, and check four things:
  1. two services on the same root (`apps/sites`) both build;
  2. the `basePath` rewrite serves `/s/elite/<page>` and its assets;
  3. the catch-all goes to `web`;
  4. pnpm 11 runs with `ENABLE_EXPERIMENTAL_COREPACK=1`.
- Record the result in `deploy/vercel.md`, then delete the branch and the preview.
- Without the Vercel GitHub app, deploy the probe as a preview with `vercel deploy --archive=tgz` (a remote build on
  Vercel's builder, so the layout is still tested).
- **If the probe fails**, pick a fallback, in order:
  1. the sites as their own projects (`deploy/vercel.md`'s two-project layout, one more for the second site);
  2. a prebuilt CLI deploy from a clean checkout (`vercel build` then `vercel deploy --prebuilt --archive=tgz`).

**Installs stay filtered.** An unfiltered `pnpm install` pulls embedded-postgres binaries (including the PG18
devDependency) onto the build machine, and the per-app files filtered them out on purpose. Use `--filter
@munshi/web...` and `--filter @munshi/sites...`, as the existing per-app `vercel.json` files do.

- **Root `vercel.json`**, modelled on `../foodops-intel/vercel.json` (write it new; the install lines below replace
  the plain install with the filtered one):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["bom1"],
  "services": {
    "web": {
      "root": "apps/web",
      "framework": "nextjs",
      "installCommand": "cd ../.. && pnpm install --frozen-lockfile --filter @munshi/web...",
      "buildCommand": "pnpm build"
    },
    "elite": {
      "root": "apps/sites",
      "framework": "nextjs",
      "installCommand": "cd ../.. && pnpm install --frozen-lockfile --filter @munshi/sites...",
      "buildCommand": "MUNSHI_SITE=elite MUNSHI_SITES_BASE_PATH=/s/elite MUNSHI_SITES_DIST=.next pnpm build"
    },
    "prabhave": {
      "root": "apps/sites",
      "framework": "nextjs",
      "installCommand": "cd ../.. && pnpm install --frozen-lockfile --filter @munshi/sites...",
      "buildCommand": "MUNSHI_SITE=prabhave MUNSHI_SITES_BASE_PATH=/s/prabhave MUNSHI_SITES_DIST=.next pnpm build"
    }
  },
  "rewrites": [
    { "source": "/s/elite/(.*)", "destination": { "service": "elite" } },
    { "source": "/s/elite", "destination": { "service": "elite" } },
    { "source": "/s/prabhave/(.*)", "destination": { "service": "prabhave" } },
    { "source": "/s/prabhave", "destination": { "service": "prabhave" } },
    { "source": "/(.*)", "destination": { "service": "web" } }
  ],
  "crons": [{ "path": "/api/internal/tick", "schedule": "41 0 * * *" }]
}
```

- **`apps/sites/next.config.ts`:** `basePath` from `MUNSHI_SITES_BASE_PATH` (none when unset, so local dev is
  unchanged). Check every hard-coded href, asset, font and `fetch` path and the `proxy.ts` lang redirect under the base
  path. `MUNSHI_SITES_DIST` is already honoured.
- **`apps/sites/lib/api.ts`:** services share one variable set, so the key is `MUNSHI_SITE_KEY_<SLUG uppercased>`
  (falling back to `MUNSHI_SITE_KEY` for local dev), and `MUNSHI_API_URL` is the production origin.
- **VERCEL1** (`db/test/v2/deploy/vercel.test.ts`) also checks the root file:
  - it has `bom1`;
  - every service root exists;
  - a rewrite sends every `/s/<slug>` to a service of that slug;
  - the catch-all goes to `web` and comes last;
  - it holds no environment value;
  - there is one daily cron on a GET route.
  Red-prove a misordered catch-all and a value in the file.
- **Fallback, if Vercel refuses two services with the same root** (UNVERIFIED): two thin wrapper folders,
  `deploy/vercel/sites-elite` and `deploy/vercel/sites-prabhave`, whose package `build` runs `apps/sites`' build with
  the slug. Or separate projects per site, as in `deploy/vercel.md`. Try services first.
- `deploy/vercel.md` is rewritten for the one-project layout, with the variable table per environment.

#### P-9b · Hosted (Opus + founder; after P-7, P-8, P-9a, C1)
1. **Supabase**, from a clean checkout of the `paytm` commit (`git worktree add ../munshi-deploy <sha>`, then
   `pnpm install --frozen-lockfile --offline`):
   - steps 1–3 of `deploy/supabase.md`, with the admin URL taken from `SESSION_POOL_CONNECTION_STRING` in `.env`;
     step 3 is scripted as `db/src/supabase-roles.ts`, which generates the seven passwords, sets them as the admin and
     writes the role URLs into `.env.production` without printing anything;
   - `pnpm db:build --deployment=demo`;
   - `pnpm platform:operator` (F5);
   - `pnpm seed:hosted --confirm=<ref>`;
   - the platform changes: the demo defaults with the spend ceiling (`ai_daily_calls=200`, `media_daily_calls=40`,
     `deployment_daily_calls=1500`, `sandbox_ai_enabled=false`), one `model_allow` per (alias, role) that passed the
     probe, and `site_verify` for Elite and Prabhave;
   - `node --env-file=.env.production scripts/deploy-check.ts` prints `deploy-check: ok`;
   - nothing later needs the admin URL; it stays only in `.env`.
2. **Supabase Storage:** the adapter uses `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `.env` (server-side only).
3. **Vercel:**
   - create the project `munshi`, linked to `SawhneySatvik/munshi` with production branch `paytm`, and set
     `ENABLE_EXPERIMENTAL_COREPACK=1`;
   - after any `vercel link`, find where `.vercel/project.json` landed and delete any `.env.local` unread (Munim
     gotcha 39);
   - set the production variables with `deploy/vercel-env.ts`, which reads `.env.production` and `.env` through
     `@munshi/config` and calls `vercel env add` per name. It prints names only, never values, and never sets
     `MIGRATOR_*`, `ADMIN_*`, `MUNSHI_PLATFORM_SECRET`, `WHATSAPP_*` or `INSTAGRAM_*`;
   - the variables: the six runtime pool URLs, `MUNSHI_DEPLOYMENT=demo`, `MUNSHI_SESSION_SECRET`,
     `MUNSHI_RATE_SECRET`, `MUNSHI_IDENTITY_SECRET`, `CRON_SECRET`, `MUNSHI_EDITION=paytm`, `MUNSHI_MODEL_MODE=live`
     (only once the demo defaults with `deployment_daily_calls=1500` and `sandbox_ai_enabled=false` are approved,
     and F6 is done),
     `MUNSHI_DEMO_TENANT_ID`, the site keys, `MUNSHI_API_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and the model
     keys whose providers passed the probe;
   - push `paytm` to deploy. If a production build is skipped or cancelled, deploy the same commit from the clean
     checkout with `vercel deploy --prebuilt --archive=tgz --prod` (Munim gotchas 42, 43).
4. **Smoke** (`scripts/hosted-smoke.ts`, Playwright with **client navigation**, never `page.goto` between pages,
   Munim gotcha 41):
   - `/api/health` answers ok (`deployment: demo`, the schema prefix);
   - the product site; the demo picker opens Bansal, the kirana, Elite and Prabhave;
   - Bansal's counter sale, bills photo, settlements import with the sample statement, the brief, chat to order, a
     model pick in Settings and the next answer's "Written by";
   - `/s/elite` booking and `/s/prabhave` order intake;
   - `/platform` gives 404 without a session;
   - one live call per allowed provider through the hosted app;
   - each phone-width page has no horizontal scroll.
   Screenshots go to `.screenshots/HOSTED/`.
- Gate: everything above passes from a phone on mobile data (the founder checks one page).

#### P-10 · The deck (Sonnet; after P-9b's screenshots)
- If the executing agent has the Artifact tool, make a **Slides** artifact (quickstart `slides`). Otherwise make a
  7-slide HTML deck at `design/paytm-deck/index.html`, printable to PDF.
- The seven required slides, pitched as **AI staff for every Paytm merchant**:
  1. title;
  2. problem;
  3. solution;
  4. tech stack (agnostic models, chosen per agent by the shop within an allow-list; Sarvam for Hindi voice);
  5. USP (nothing changes the books without a person; every number traces to its source; "Cannot verify");
  6. impact and benefits (figures only from the sample shops' measured results, labelled synthetic);
  7. business model (no prices or fee percentages).
- One feature list, grouped by area, never split into "built today" and "later". The spreadsheet view stays out.
  Screens come from `.screenshots/HOSTED/`.

#### P-11 · Rehearsal and the hack hours
- `docs/PAYTM-DEMO.md`: the 3-minute click path on the hosted Bansal shop. Four steps:
  1. the morning brief, which finds the short and missing settlements;
  2. the settlements import, matched with its sources;
  3. chat to order (a Hindi voice note through Sarvam if its key is in, else typed), then the draft approved;
  4. the model picker, switching the reasoning model and showing "Written by".
  Then a shop site booking, then "Cannot verify" on a forged figure.
- It ends with the fallback: `pnpm dev` on the laptop on `paytm`, with live keys.
- Rehearse once by 11:30. From 11:00 to 12:00, fix only what the rehearsal finds; P-12 runs 12:00–12:45. Each fix goes to `main` first if it isn't Paytm-specific, then is
  merged into `paytm`.

#### P-12 · The Paytm demo video (agent + founder; 12:00–12:45)
- `docs/PAYTM-VIDEO.md`: a 2–3 minute shot list on the hosted Bansal path (P-11's path), with the line to say over each
  shot and the on-screen labels that must be visible: "Sample shop", "Sample statement", "Recorded" where it applies,
  and "Written by `<model>`".
- **The founder records** their screen with their voice (QuickTime or the OS recorder).
- If the founder can't, the agent captures a captioned Playwright recording (`scripts/record-demo.ts`, video on, 1280
  × 800, captions as on-page overlays from the shot list) into `video/paytm/demo.webm`. The founder checks it before
  submission.
- The video is submitted with the deck and the prototype URL by 13:00.

**Gate P1 (by 09:00 IST):**
- `pnpm check` is green on `main` and on `paytm`;
- `pnpm dev` on `paytm` runs the whole Bansal path from P-11 on the laptop with live Gemini (the model probe
  passed);
- the model picker, settlements, Sarvam (if its key is in) and the restyle are in, as far as C1 allowed.

**Gate P2 (by 13:00 IST):**
- the hosted smoke passes;
- at least two providers answer live through the hosted app (Gemini plus one more once its key is in);
- the spend ceiling is approved and live;
- the deck, the video and the prototype URL are **submitted**;
- the demo path is rehearsed once end to end.

**Fallback (named once):** if Supabase or Vercel fails on something UNVERIFIED (PostgreSQL 17 or `btree_gist` on the
plan, pnpm 11, two services on one root), the prototype is the laptop on `paytm` with live keys. The video is recorded
from the laptop and submitted by 13:00, and P-9b continues after submission.

---

### Wave S · Soundness (after the pitch; on `main`, then merged into `paytm`)
- **S-1:** the full red-proof sweep on a quiet tree (`pnpm redproof`); 0 NOT RED and 0 ERROR, or each one fixed.
- **S-2:** the perf config (`cd db && ../node_modules/.bin/vitest run -c vitest.perf.config.ts`) with fixtures for
  every named read, P-4's and P-5's included. Every new allowance carries its measured cost pair.
- **S-3, review R-B** (Opus, read-only):
  - everything since the backend close (W3, W5, the surfaces, P-1 to P-9), both clauses of the One Guarantee;
  - a security pass over sign-in, sessions, the webhook signature, the API keys and rate limits, the console's TOTP and
    the blob adapter, including the multi-provider key handling and redaction.
  At most two fix cycles, each finding closed by a red-proved gate.
- **S-4:** `pnpm check` twice in a row, green.
- **S-5, the deploy hardening moved from P-8:** item 4 (`rediss://`), 5 (BOOT1's boot half), 6 (the capture-guard
  markers), 7 (the platform secret required on live) and 8 (`pnpm reseed` keeps `platform.*`). Item 3, the blob
  adapter, joins them unless P-9b needed it.

### Wave F · Every feature left (parallel lanes, prep commit first)
1. **`<munshi-book>`:** the booking widget, the same contract as `<munshi-order>`. A switched-off capability renders
   nothing, and every figure carries its ref. It gets a demo page.
2. **BP-APP-3's leftovers:** revoke another member's session; the look editor and *Publish* (a release); "insert
   figure" chips in campaign copy (refs only); the office's per-desk cards and run log; inbox filters; over-cap states
   on every AI surface.
3. **The portal:** a public sandbox publishable key for writes, recorded write examples, and Hindi.
4. **Hindi:** item names in the seeds (Bansal and the kirana), and every app and site string in the `hi` dictionary.
5. **The API's look tokens** applied on the shop sites (`ops.site_look`, from the release).
6. **The grid writer** for variants (apparel), plus **`grid.apply`**: a grid edit becomes one draft and is approved
   under the approver.
7. **The HANDOFF §4 residuals:**
   - `wages.pay` linked to a salary line, with a kind column, and bounded;
   - the trusted client IP (the platform's header, not the first `x-forwarded-for` hop) and Turnstile behind the bot
     port;
   - an audit entry for `identity:reset`, and the reset grant on decisions;
   - the three digit scripts (U+06F0, U+1C50, U+ABF0) in `extract_span`;
   - claim, commit, send, mark, so a crash after a send can't resend;
   - the jobs role's `select (tenant_id, id, offer_id) on ops.campaign` for W7;
   - `sale.soldAt` backdating (R-A-4) bounded outside GST.
8. **Prabhave's real catalogue,** spelling and measurement points when the founder sends them (D-067: permission is in).
9. **A Bansal public site:** a look board first (checkpoint C3), then built at `/s/bansal` as a fourth service.

### Wave M · Meta (needs the Meta key)
- **M-1, W6 on `main`:**
  - `scripts/meta-smoke.ts`, one call per model: Muse Spark 1.3 (with a tool and a JSON schema), SAM 3.1, Voice
    Transcribe, and Spark Open on Baseten;
  - re-record every fixture live (`MUNSHI_MODEL_MODE=record`), then re-run the suites recorded;
  - fix what the live calls reveal, each with a gate.
- **Gate M:** the one-shop-day chain runs live end to end: chat to order, Ask by voice, shelf and bill photos, the
  brief's findings.
- **M-2, the Meta hosted demo from `main`:**
  - a second Vercel project from the same `vercel.json`, production branch `main`, `MUNSHI_EDITION=meta`;
  - the database: the same Supabase project if the schema sha is identical (it is, by D-066). Otherwise a second
    project (founder's call at the time).

### Wave E · The end
- **E-1:** the film, after everything else (founder: "post everything else is complete"), on the hosted app with live
  calls. "Tap for source" and "Cannot verify" are on screen, and the simulated parts are labelled. It uses
  `docs/FILM-SCRIPT.md` and `video/` (HyperFrames).
- **E-2:** the README with measured counts (from `pnpm check` and the sweep, dated), the public repository (the founder
  creates it), the Meta form and the post. Due **Thu 5 Nov, 07:30 IST**.
- **E-3:** PayPal (13 Nov), a PayPal sandbox payments capability on `paytm`. It gets its own plan after 5 Nov.

---

## 6 · Founder checkpoints (the only stops)

| # | When | What the founder does | Default if no answer within the wave |
|---|---|---|---|
| C1 | after P-1 | picks look A or B (or gives notes) | **none: don't build the restyle without a pick**; continue everything else |
| C2 | P-6, after 6 screens | approves the restyle direction on real screens | continue, flag it in the summary |
| F1–F3, F5, F6 | before P-9b | Supabase admin URL, keys, Vercel GitHub app, TOTP enrolment, provider spend limits | the laptop fallback; live mode stays off on the hosted demo until F6 |
| C3 | Wave F item 9 | picks Bansal's site look | no Bansal site |

## 7 · Verification commands (paste their output in every report)

```bash
pnpm check                                                     # lint + typecheck + every suite
cd db && ../node_modules/.bin/vitest run -c vitest.v2.config.ts [path]
cd db && node test/redproof.ts --only=v2 <case names>          # a lane's own cases
pnpm redproof                                                  # the full sweep (S-1)
cd db && ../node_modules/.bin/vitest run -c vitest.perf.config.ts
node scripts/env-presence.ts                                   # names only
node scripts/model-probe.ts                                    # live: only where a key is set
node --env-file=.env.production scripts/deploy-check.ts        # deploy-check: ok
node scripts/hosted-smoke.ts --base https://<prod domain>
git log -1 --format='%an <%ae> | %cn <%ce>'                    # the founder, every commit
```

## 8 · The status summary (after each wave, in the terminal)

Plain words, self-contained, no internal ids without a gloss:
- what is on `main` and `paytm`, with measured test counts;
- the hosted URLs;
- the screenshots' paths;
- every autonomous decision (its D-number);
- what is left, with the founder input each item waits for.
