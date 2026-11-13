# Codebase audit: Munshi and Sarthi (as of the November 2026 checkouts)

Scope: a code-and-docs audit of `/home/user/munshi` (Munshi) and `/home/user/sawhneysatvik/sarthi` (Sarthi). Sources are file paths (line numbers where useful). `research_notes/` and `reports/` in the Munshi repo were excluded from all counts. Line counts are raw `wc -l` over git-tracked files (they include comments and blank lines). No live URL was fetched; deployment facts come from the repos' own docs.

## 1. What each product is: purpose, target user, stack, architecture, data model, AI layer

### Takeaway
Munshi is a large, deeply engineered multi-tenant "AI back office" for small Indian shops (kirana, salon, apparel): agents read the books and draft fixes, and only a named person's approval writes, enforced inside PostgreSQL. Sarthi is a mid-sized, single-user-per-account "voice and photo life coach": one sentence is parsed into typed entries across Health, Money, Habits and Skills, estimates need a swipe to confirm, and a grounded coach sits on top. They share an author, a stack generation (Next.js 16, React 19, Node 22, pnpm 11.9, zod 4, Supabase Postgres, Vercel) and a design philosophy. Their persistence and AI layers are built differently.

### Cited Findings
**Munshi**
- Product: "An AI back office for a small shop. Agents do the books; a named person approves every change." It covers the counter, stock, buying, books, customer credit (udhaar), staff and salary. The demo has two kiranas, a salon and a boutique — [README.md:5,36-41](/home/user/munshi/README.md)
- Target user: the owner of a small shop who is "the cashier, the buyer, the stock-keeper, the credit desk and the payroll office". Built phone-first "for a phone at the counter" — [README.md:107-128, 188-191](/home/user/munshi/README.md)
- Core guarantee: "Nothing changes the books without a named person's approval, and every number shown traces to a ledger row". It is enforced by a DB trigger (`books.write()`, error `MS001`), a write-less agent DB role (`munshi_agent`), snapshot cells, and a "Cannot verify" validator — [README.md:129-160](/home/user/munshi/README.md); [docs/decisions/0001–0003](/home/user/munshi/docs/decisions/README.md)
- Seven named agents (Munshi, Tally, Ledger, Dash, Echo, Bloom, Keeper). "Keeper" holds short memory notes that the owner can make it forget. Five finding kinds have a deterministic "Draft the fix" recipe — [README.md:161-182](/home/user/munshi/README.md)
- Architecture: a pnpm monorepo. `apps/web` (Next.js 16.4.3: owner app, product site, operator console, `/api/v1`, webhooks, jobs tick), `apps/sites`/`elite`/`prabhave` (shop websites), `apps/teammate` (chat relay). Packages: `core` (framework-free domain), `agent` (flows plus cite-or-abstain validator), `ai` (provider layer, no DB), `adapters`, `config`, `contracts` (zod → OpenAPI), `sdk`, `widgets`. One server process; the agent runs in-process — [README.md:384-411](/home/user/munshi/README.md); [docs/decisions/0011](/home/user/munshi/docs/decisions/0011-one-process-context-from-session.md)
- Stack: raw SQL over `pg` (no ORM). The schema is 30 ordered SQL files (`00_bootstrap` to `90_seal`) rebuilt from scratch on every build, each with a `.manifest.json`. PostgreSQL 17 has forced RLS and six login roles. Biome and Vitest; tests run on embedded Postgres — [README.md:602-632](/home/user/munshi/README.md); [apps/web/package.json](/home/user/munshi/apps/web/package.json); [package.json](/home/user/munshi/package.json)
- Data model: 151 `create table` statements across schemas: books 46, ops 55, ref 17, platform 14, ai 10, idp 3, approval/audit/snap 2 each. Money is in integer minor units with currency, quantities in milli-units. Journals must balance per currency at commit — `grep "^create table" db/schema/*.sql`; [README.md:612-632](/home/user/munshi/README.md)
- AI layer: agents ask for a role (`router, reason, vision, segment, voice, narrate, speak`), never a model. Seven providers sit behind one layer: Meta (Muse Spark, SAM 3.1, Muse Voice, Muse Spark Open), Gemini, Anthropic, OpenAI, OpenRouter, NVIDIA, Sarvam. Meta is the default. A fallback chain runs owner pick → shop default → build default → Meta → Gemini → others. `packages/ai` depends only on `openai` 7.43 and zod — [packages/ai/src/providers/types.ts:3](/home/user/munshi/packages/ai/src/providers/types.ts); [packages/ai/package.json](/home/user/munshi/packages/ai/package.json); [README.md:61-65, 521-545](/home/user/munshi/README.md)
- Hindi: the UI strings ship in English and Hindi (19 `i18n-*.ts` modules), and the cite-or-abstain validator reads English, Devanagari and romanised Hindi number words — [apps/web/lib/](/home/user/munshi/apps/web/lib); [docs/limitations.md:24-30](/home/user/munshi/docs/limitations.md)

**Sarthi**
- Product: "A voice and photo life coach that runs your whole life from one capture surface". One sentence, for example "spent ₹340 on lunch, 2 rotis and dal, drank a bottle, 90 min of system design, woke at 5:10", is filed into Health, Money, Habits and Skills. Estimated values become confirm cards. A coach reacts, briefs daily and reflects weekly, and proposes plan changes as Keep/Revert — [README.md:5-38](/home/user/sawhneysatvik/sarthi/README.md)
- Target user: "Primary user = Satvik, dogfooded in parallel… Broader audience post-hackathon" — [docs/product/PRD.md:48-50](/home/user/sawhneysatvik/sarthi/docs/product/PRD.md). The positioning is a better "Life Reset / Rise" (plan-and-gamify apps) — [docs/product/PRD.md:20-36](/home/user/sawhneysatvik/sarthi/docs/product/PRD.md)
- Architecture: a single Next.js app (not a monorepo): `app/` (routes and API), `components/`, `core/` (framework-free business logic, AST-enforced boundary), `data/` (Drizzle schema, migrations, repository), `providers/` (llm, vision, voice, media, auth, fake). `core/` must stay framework-import-clean so a mobile shell could extract it (invariant #9) — [AGENTS.md §2](/home/user/sawhneysatvik/sarthi/AGENTS.md); [package.json](/home/user/sawhneysatvik/sarthi/package.json) (`check:core-boundary`)
- Stack: Next 16.1.6, React 19.2.4, Vercel AI SDK `ai` 7.0.28 (`@ai-sdk/google`, `openai`, `anthropic`), Drizzle 0.44 over SQLite/libSQL (dev) and postgres-js (prod), Supabase SSR, Tailwind 4, framer-motion, ESLint, `node:test` via tsx — [package.json](/home/user/sawhneysatvik/sarthi/package.json)
- Data model: 38 tables in one shared, drizzle-free contract (`data/schema/contract.ts`, 2,600 lines) with mirrored SQLite and Postgres dialects (about 770 lines each). Groups: money (4), health (6), habits (3), skills (3), plans/progress (4), coach (coach_notes, coach_messages, coach_memory, coach_memory_audit, adaptations), evidence, journey (2), commits (4), profile (3), billing (checkout_sessions, billing_events), waitlist. Integer paise/ml/minutes/grams; confidence in basis points — [data/schema/postgres.ts](/home/user/sawhneysatvik/sarthi/data/schema/postgres.ts); [AGENTS.md §2 invariant 2](/home/user/sawhneysatvik/sarthi/AGENTS.md)
- Tenancy: app-level only. `ScopeContext.userId` is "the ONLY source of tenant scope". There is no RLS or policy anywhere in `data/` (0 hits) — [data/repository/scope.ts:1-35](/home/user/sawhneysatvik/sarthi/data/repository/scope.ts)
- AI layer: provider-blind `LlmGateway` with tiers `deep | balanced | fast`. Models: google deep = `gemini-2.5-flash`, balanced/fast = `gemini-flash-lite-latest`; openai = `gpt-5.6-sol/terra/luna`; anthropic is all `null` ("wired but disabled"). A deterministic `fake` gateway drives everything keyless — [providers/llm/matrix.ts:12-42](/home/user/sawhneysatvik/sarthi/providers/llm/matrix.ts); [providers/llm/index.ts](/home/user/sawhneysatvik/sarthi/providers/llm/index.ts); [core/contracts/providers.ts:7](/home/user/sawhneysatvik/sarthi/core/contracts/providers.ts)
- Capture trust boundary: auto-write only when `create` + `estimated:false` + confidence ≥ `AUTO_WRITE_CONFIDENCE_BPS = 9000` + integer-valid + entity resolved. Everything else becomes a card. Photo evidence never auto-writes. The server re-routes the auto batch itself (D-040) — [core/capture/route.ts:17,62](/home/user/sawhneysatvik/sarthi/core/capture/route.ts); [docs/product/CHANGELOG.md (SAR-004, SAR-006, SAR-011)](/home/user/sawhneysatvik/sarthi/docs/product/CHANGELOG.md)
- Hindi: no Hindi UI or parsing found. Devanagari appears only in the brand mark and wordmark — [app/lib/brand-mark.tsx:4](/home/user/sawhneysatvik/sarthi/app/lib/brand-mark.tsx); [components/landing/Wordmark.tsx:5](/home/user/sawhneysatvik/sarthi/components/landing/Wordmark.tsx)

### Inferences
- Munshi holds its guarantees in the database (RLS, triggers, roles, a seal file). Sarthi holds them in TypeScript (repository scoping, a routing function, Zod). Munshi's approach is stronger but much heavier to change. Sarthi's is lighter and portable to mobile, but a single bug in the app layer could leak tenant data.
- "Hindi" is shared DNA only in branding. Only Munshi has bilingual product behaviour.

### Gaps
- The `COACH-LIFT` spec and the "second_brain study" are cited in Sarthi code comments but are not in the checkout, so the full intended coach and memory design cannot be read (see §5).

## 2. Size, tests and commit history (timeline and hackathon context)

### Takeaway
Munshi is about 3× Sarthi's product code and about 8× its test code: roughly 95k product lines plus 65k test lines, against Sarthi's 32k plus 8k. Sarthi was built in about 5.7 days for OpenAI Build Week, July 17–22, 2026. Munshi's visible history covers October 31 to November 13, 2026, and served at least three hackathon submissions (PayPal AI, Meta, Flip the Switch). Both clones are shallow: Munshi's too, despite the brief.

### Cited Findings
**Munshi size**
- 1,657 tracked files (excluding research_notes and reports). By extension: ts 836 files / 102,825 lines, tsx 308 / 33,182, sql 31 / 11,290, css 49 / 10,981, md 54 / 5,032 — `git ls-files` + `wc -l` over [/home/user/munshi](/home/user/munshi)
- Product (non-test) lines by area: apps/web 44,508 (421 files); packages/core 18,743; db/schema 11,290; apps/sites 5,016; packages/agent 2,546; db/seed 2,112; db/src 1,919; packages/ai 1,651; adapters 1,336; contracts 1,281; sdk 1,255; scripts 878; integrations 726. That totals about 94.7k (it includes about 11k lines of CSS) — same method.
- Test lines: db/test 41,809 (260 files); apps/web/test 16,568 (105 files); packages/agent/test 2,305; other packages about 4.9k. Total about 65.5k, a test-to-product ratio of about 0.69. There are 294 `*.test.ts(x)` files and about 1,567 `it(`/`test(` call lines — same method.
- README claims "Test files: 263" (badge), "292" test files and ">1,400 test cases" (table), and "1,916" red-proof sabotage cases. The badge and the table disagree with each other — [README.md:22-23, 657-697](/home/user/munshi/README.md). The sabotage registry is 84 files / 8,356 lines — [db/test/v2/sabotage/](/home/user/munshi/db/test/v2/sabotage)

**Munshi history**
- 176 commits visible: 173 by the founder and 3 by "Claude" (the November 13 research notes). 47 are merges. Commits per day: Oct 31 29, Nov 3 65, Nov 4 39, Nov 5 12, Nov 12 28, Nov 13 3 — `git -C /home/user/munshi log`
- The clone is shallow: `.git/shallow` lists 3 boundary commits. The oldest visible commit (Oct 31 03:55) already has 1,760 files in its tree, so most of Munshi predates the visible history. Seven ADRs are dated "October 2026" and five "November 2026" — [/home/user/munshi/.git/shallow](/home/user/munshi/.git/shallow); [docs/decisions/*.md](/home/user/munshi/docs/decisions/README.md)
- Hackathons:
  - PayPal's AI hackathon on Devpost — [docs/api-sdks.md:86](/home/user/munshi/docs/api-sdks.md); [docs/submission/paypal.md](/home/user/munshi/docs/submission/paypal.md)
  - A Meta model submission — [docs/submission/meta.md](/home/user/munshi/docs/submission/meta.md)
  - "Built for the Flip the Switch hackathon" — [docs/switch.md:7](/home/user/munshi/docs/switch.md)
  - Sponsor-tool integrations: AG Grid, Bryntum, Render, APIMatic, Postman, Zapier — [README.md:70-82](/home/user/munshi/README.md)
  - [docs/kit/overview.md:19](/home/user/munshi/docs/kit/overview.md): "This is a hackathon build."
- 11 merges come from branches named `worktree-agent-*`. That is the naming pattern of Claude Code's isolated agent worktrees — `git log --format=%s | grep worktree-agent`

**Sarthi size**
- 523 tracked files. ts 217 / 27,019 lines, tsx 115 / 9,887, sql 10 / 1,241, md 71 / 13,386, plus 41 WebP art scenes (public/ is 1.3 MB) and 16 gallery PNGs — `git ls-files` + `wc -l` over [/home/user/sawhneysatvik/sarthi](/home/user/sawhneysatvik/sarthi)
- Product (non-test) lines are about 32,291: components 10,004; core 8,528 (capture 2,004, coach 1,752, onboarding 1,636, domains 1,381, game 489, contracts 484, tools 481, plan 181); data 6,726 (schema 4,141, migrations 1,241, repository 778, seed 519); app 4,104; scripts 1,542; providers 1,200 — same method.
- Tests are about 7,877 lines: 40 `*.test.ts` files (36 unit/integration plus 4 eval) and about 298 `test(` cases, run under `node:test`. The test-to-product ratio is about 0.24. The `eval/cases` and `eval/fixtures` directories are empty (`.gitkeep` only) — [tests/](/home/user/sawhneysatvik/sarthi/tests); [eval/](/home/user/sawhneysatvik/sarthi/eval)
- Process text: 13,386 markdown lines (docs, AGENTS.md, .codex plans and skills), about 41% of product-code line count — same method.

**Sarthi history**
- 97 commits visible, all by the founder, 10 of them merges. Dates: Jul 17 5, Jul 18 36, Jul 19 8, Jul 20 10, Jul 21 34, Jul 22 4. The first commit is Jul 17 12:26 IST ("docs: establish signed Sarthi build contract"); the last is Jul 22 04:28 ("submission README + gallery + MIT license"). The clone is shallow at 1 boundary (`08d6fbb`, Jul 18) — `git -C /home/user/sawhneysatvik/sarthi log`; [.git/shallow](/home/user/sawhneysatvik/sarthi/.git/shallow)
- Context: "OpenAI Build Week · Track: Apps for your life · Built with Codex + GPT-5.6". Submission was due Tue Jul 21, 5 PM PT. The PRD was locked Jul 15 — [README.md:11](/home/user/sawhneysatvik/sarthi/README.md); [docs/product/PRD.md:1-14](/home/user/sawhneysatvik/sarthi/docs/product/PRD.md)
- The whole coach "agentic lift" (COACH-0 → COACH-4) landed in about 3 hours on Jul 21 (17:01 → 19:49 IST), roughly a day before the submission merge — `git log` (b7096e1, 1a43f41, 4529105, 28b0a3a, 9c55a5f)
- No commits after Jul 22, 2026: the repo has been idle for about 4 months.

### Inferences
- Munshi's true build length cannot be measured from this clone. The October-dated ADRs and the 1,760-file tree at the first visible commit suggest several weeks of work before October 31.
- Munshi's late commits add sponsor integrations (PayPal desk on AG Grid, Bryntum, APIMatic, Postman, Zapier, Switch relay). That points to scope driven by hackathon prize tracks rather than user demand.

### Gaps
- The full commit history for both repos (both clones are shallow), so total person-days per project are unknown.
- Whether either hackathon submission placed or won: nothing in the repos says.

## 3. Deployment: what is live vs simulated, recorded or fake

### Takeaway
Munshi's hosted demo runs live models (Meta, with fallbacks) and real PayPal sandbox invoices on synthetic shops. Payments are never processed, and channels are recorded unless every live condition holds. Sarthi's hosted demo runs on a deterministic fake by default, with bring-your-own-key (BYOK) for real parse, vision and coach calls. Its voice transcription is fake in every configuration: whatever is spoken, the server returns the canonical demo sentence. Photo storage is not wired in production.

### Cited Findings
**Munshi**
- Live demo https://munshi-sable.vercel.app and a 2:44 video https://youtu.be/spnJi2BXCms. Vercel (one project, three services) plus Supabase Postgres 17; `render.yaml` runs a 10-minute jobs tick and the chat relay — [README.md:50, 778-808](/home/user/munshi/README.md)
- Meta's models are the default for every role except read-aloud and are "called in live mode, as on the hosted demo". Recorded mode (the default for `pnpm dev` and tests) replays hand-written fixtures — [docs/limitations.md:10](/home/user/munshi/docs/limitations.md); [docs/decisions/0007-recorded-mode.md](/home/user/munshi/docs/decisions/0007-recorded-mode.md)
- Simulated:
  - Suppliers and surplus recipients
  - The payments feed
  - The bot check (only a recorded verifier exists)
  - WhatsApp and Instagram, which are recorded unless send mode is live, credentials exist, the shop is real and accepted, it has a channel grant and the recipient is listed. Instagram posting is tested only against fake endpoints, and WhatsApp voice-note download is not built.
  - PayPal is sandbox only, with no live endpoint wired; refunds and disputes are not handled.

  — [docs/limitations.md:8-20](/home/user/munshi/docs/limitations.md); [docs/submission/paypal.md:7-11](/home/user/munshi/docs/submission/paypal.md)
- Data: "Synthetic only… no real shop has used Munshi." Savings figures are measured against a seeded answer key — [docs/limitations.md:66-90](/home/user/munshi/docs/limitations.md)
- Other limits: offline mode is read-only; restaurants are not built; there is one time zone and currency per shop; the Redis adapter has no TLS; the `/findings` and `/drafts` API endpoints answer 404 — [docs/limitations.md:66-90](/home/user/munshi/docs/limitations.md)

**Sarthi**
- Live demo https://sarthi-gray.vercel.app/ and a video at https://www.youtube.com/watch?v=DtNvdCOvIY4. "Try the demo" opens a seeded 12-day life; "Start fresh" creates a private empty sandbox — [README.md:12, 110-116](/home/user/sawhneysatvik/sarthi/README.md)
- "By default the live site runs on a deterministic fake… paste your own Gemini or OpenAI key. It stays in your browser" (sent per request as `x-sarthi-byok-*` headers) — [README.md:118-120](/home/user/sawhneysatvik/sarthi/README.md); [app/lib/byok.ts:8-46](/home/user/sawhneysatvik/sarthi/app/lib/byok.ts)
- Identity on the live demo is a per-browser anonymous sandbox: middleware mints a random UUID cookie per browser when `AUTH_PROVIDER=anonymous`. Supabase email/password auth exists but is env-gated — [middleware.ts](/home/user/sawhneysatvik/sarthi/middleware.ts); [app/api/start-fresh/route.ts](/home/user/sawhneysatvik/sarthi/app/api/start-fresh/route.ts); [docs/operations/DEPLOY-SETUP.md §5](/home/user/sawhneysatvik/sarthi/docs/operations/DEPLOY-SETUP.md); commit `1ded931` ("SAR-021 real Supabase auth (email/password), env-gated")
- Voice is fake-only. `createVoiceProvider` throws for anything except `fake` ("not implemented in SAR-002"). The settings UI disables every non-fake voice option. `FakeVoiceProvider.transcribe` ignores the audio and returns the canonical cross-domain sentence — [providers/voice/index.ts](/home/user/sawhneysatvik/sarthi/providers/voice/index.ts); [providers/fake/voice.ts](/home/user/sawhneysatvik/sarthi/providers/fake/voice.ts); [providers/fake/fixtures.ts:196-200](/home/user/sawhneysatvik/sarthi/providers/fake/fixtures.ts); [components/settings/SettingsSheet.tsx:339](/home/user/sawhneysatvik/sarthi/components/settings/SettingsSheet.tsx)
- Photo and media storage in production: `ProductionMediaProvider.put/read` throw "Production media storage is not configured." The deploy runbook recommends a "voice-only live demo" — [providers/media/production.ts](/home/user/sawhneysatvik/sarthi/providers/media/production.ts); [docs/operations/DEPLOY-SETUP.md §6](/home/user/sawhneysatvik/sarthi/docs/operations/DEPLOY-SETUP.md)
- Claude: the README says the app "talks to Gemini, GPT-5.6, or Claude through one gateway". In the code, Anthropic is "wired but disabled until a deployment-account model ID is verified" — [README.md:146](/home/user/sawhneysatvik/sarthi/README.md) vs [providers/llm/index.ts](/home/user/sawhneysatvik/sarthi/providers/llm/index.ts)
- Billing: `BILLING_MODE` defaults to `waitlist`. The landing page shows "Free=BYOK / Pro=waitlist". Razorpay exists only as schema (`checkout_sessions`, `billing_events`, `billingProviderEnum=['razorpay']`); no checkout route exists — [app/lib/runtime.ts:38](/home/user/sawhneysatvik/sarthi/app/lib/runtime.ts); [data/schema/contract.ts:125](/home/user/sawhneysatvik/sarthi/data/schema/contract.ts); commit `0d9be4e` message; [app/api/](/home/user/sawhneysatvik/sarthi/app/api) route list
- The SAR-020 eval A/B report (12 fixtures, Gemini vs GPT-5.6, cost per turn) never landed. Only the F3/F5/timer/coach gate evals exist — [tests/eval/report.ts:1-5](/home/user/sawhneysatvik/sarthi/tests/eval/report.ts); [docs/handsoff/handsoff_10.md](/home/user/sawhneysatvik/sarthi/docs/handsoff/handsoff_10.md)

### Inferences
- In Sarthi's live demo, the headline "say one sentence" interaction always produces the same demo sentence. The PTT transcript is shown pinned and editable before parsing, so typing works; the real-input path is typed text plus BYOK. For a "voice life coach", real STT is the single biggest demo-versus-product gap.
- Munshi is more honest and more complete about live versus recorded: every surface is labelled, and the hosted demo makes real model and sandbox calls.

### Gaps
- Whether either live URL is still up in November 2026, and how many visitors used them. No analytics exist in either repo, and no URL was fetched.

## 4. Readiness for real, paying users (gaps from "demo" to "first 10 paying users")

### Takeaway
Neither product has had a real user, and neither can take money from its own customers today. Munshi is far ahead on auth, multi-tenancy, AI spend caps and data protection, but has no self-serve billing, no legal pages, operator-gated onboarding and AI off by default. Sarthi has the shell of a SaaS (Supabase auth, waitlist plus admin invite, privacy and terms stubs, JSON export, PWA), but its billing is schema-only, its voice and media are not live, tenancy is app-level, it has no per-user AI cost control, and account deletion is unavailable.

### Cited Findings
**Munshi readiness**
- Auth and tenancy:
  - HMAC-signed session cookies checked against a live session row; scrypt passwords; per-(email, IP) lockouts.
  - Real shops sign up via a Supabase-verified email and "wait for acceptance". Sign-ups not accepted within 14 days are purged.
  - RLS is forced on every tenant table, and `tenant_id` leads every key.

  — [README.md:634-655](/home/user/munshi/README.md); [docs/decisions/0010-real-shop-acceptance.md](/home/user/munshi/docs/decisions/0010-real-shop-acceptance.md)
- AI cost controls: an operator-approved per-role model list, per-shop feature switches, and `allow()` checks before every call (deployment switch, shop switch, shop daily cap, deployment daily ceiling, shop monthly budget). Every call writes an `ai.spend` row, and unknown cost shows "Cannot verify". New self-serve shops start with AI off — [docs/decisions/0006-per-shop-router-and-spend-caps.md](/home/user/munshi/docs/decisions/0006-per-shop-router-and-spend-caps.md)
- Privacy: IPs and emails are stored as keyed hashes; photos are not stored; inbound messages are erased after 30 days; person erasure blanks memory notes. No privacy-policy or terms page was found under `apps/web/app` (grep for privacy/terms returned nothing) — [README.md:651-653](/home/user/munshi/README.md); [packages/core/src/memory.ts:203-236](/home/user/munshi/packages/core/src/memory.ts); [apps/web/app/](/home/user/munshi/apps/web/app)
- Billing: no subscription, pricing or own-billing code (grep for razorpay/stripe/pricing/billing/waitlist found only Sarvam headers, LLM price tables and the POS "billing" nav). PayPal is only for collecting a shop's customer dues, and only in sandbox — `grep -rniE` over [/home/user/munshi](/home/user/munshi); [docs/decisions/0009](/home/user/munshi/docs/decisions/0009-paypal-as-approved-drafts.md)
- Mobile and offline: an installable PWA; offline is "a read-only view of the last Home and stock list" — [docs/limitations.md:74](/home/user/munshi/docs/limitations.md)
- Observability: internal `ai.trace` and `ai.spend` tables, run logs, and failure names logged for operators (commit "Log why a question failed, by name and code"). No external APM or analytics SDK found — [README.md:163-165](/home/user/munshi/README.md); `grep` for sentry/posthog/otel returned nothing
- Known residual risks: the audit chain is unkeyed; the book guard trusts the app-set actor; the advisory lock is per shop; Supabase platform roles can bypass RLS — [docs/limitations.md:55-64](/home/user/munshi/docs/limitations.md); [docs/decisions/0010](/home/user/munshi/docs/decisions/0010-real-shop-acceptance.md)

**Sarthi readiness**
- Auth: Supabase email/password plus reset (SAR-021, env-gated); `local-password` for dev; an `anonymous` per-browser sandbox for the demo. Admin waitlist status, approve/invite and a "signup rollout gate" (PL-2) — [middleware.ts](/home/user/sawhneysatvik/sarthi/middleware.ts); [app/admin/](/home/user/sawhneysatvik/sarthi/app/admin); [app/waitlist/page.tsx](/home/user/sawhneysatvik/sarthi/app/waitlist/page.tsx); commits `1ded931`, `f5d4b31`
- Planned pricing: "Razorpay test mode, annual Pro at ₹499/year (`49900` paise), with no v1 feature gate" (D-032). Pro "gates nothing in v1". Cut line #1 was "Razorpay checkout → payment link / waitlist", and it fired — [docs/product/DECISIONS.md:137](/home/user/sawhneysatvik/sarthi/docs/product/DECISIONS.md); [docs/screens/SCREEN-PRICING.md](/home/user/sawhneysatvik/sarthi/docs/screens/SCREEN-PRICING.md); [docs/product/PHASES.md (Phase 1 cut lines)](/home/user/sawhneysatvik/sarthi/docs/product/PHASES.md); [app/lib/runtime.ts:38](/home/user/sawhneysatvik/sarthi/app/lib/runtime.ts)
- Data rights: a repository-scoped JSON export exists, but it omits `coach_messages`, `coach_memory` and journey reflections. Deletion: the Settings danger zone says "Destructive data controls need a signed, scoped operation. This build does not pretend…" — [app/api/settings/export/route.ts](/home/user/sawhneysatvik/sarthi/app/api/settings/export/route.ts); [components/settings/SettingsSheet.tsx:543](/home/user/sawhneysatvik/sarthi/components/settings/SettingsSheet.tsx)
- Legal: privacy (84 lines) and terms (90 lines) stub pages; the privacy page says "Payments, when enabled, run on Razorpay" — [app/privacy/page.tsx:48](/home/user/sawhneysatvik/sarthi/app/privacy/page.tsx); [app/terms/page.tsx](/home/user/sawhneysatvik/sarthi/app/terms/page.tsx)
- PWA and offline: an installable manifest, code-generated icons, a service-worker scaffold, an iOS install guide, local reminders, and a push scaffold. The offline capture queue is behind `NEXT_PUBLIC_ENABLE_OFFLINE_QUEUE === "1"` (off by default). Coach mutations are online-only — [app/lib/offline/flag.ts](/home/user/sawhneysatvik/sarthi/app/lib/offline/flag.ts); [app/lib/offline/queue.ts:70-91](/home/user/sawhneysatvik/sarthi/app/lib/offline/queue.ts); commits `f43d363`, `7bc51b7`
- AI cost control: none server-side. No rate limit, quota or spend cap was found in `providers/`, `app/lib` or `app/api`. Cost is pushed to the user through BYOK, and the server default is `fake` — grep over [/home/user/sawhneysatvik/sarthi](/home/user/sawhneysatvik/sarthi); [app/lib/byok.ts](/home/user/sawhneysatvik/sarthi/app/lib/byok.ts)
- Observability: AI SDK `telemetry: { isEnabled: true, functionId }` on calls; no APM or analytics SDK found — [providers/llm/ai-sdk.ts:109,158,190](/home/user/sawhneysatvik/sarthi/providers/llm/ai-sdk.ts)
- Native app: a separate "sarthi-mobile" Expo worktree exists outside this repo; a stray `mobile/` copy is excluded from typecheck — commit `bad58b5`; [tsconfig.json:41](/home/user/sawhneysatvik/sarthi/tsconfig.json)
- Real users: the only documented user is the founder (the dogfood bar). The repo holds no waitlist counts or user data — [docs/product/PRD.md:48-50, 221](/home/user/sawhneysatvik/sarthi/docs/product/PRD.md)

### Inferences
Concrete gaps to the first 10 paying users. These are derived from the findings above, not from either repo's roadmap.
- **Munshi:**
  1. A way to charge shops (no billing rail or pricing exists; Razorpay or UPI autopay would fit Indian SMBs).
  2. Privacy policy and terms (it handles customer PII: names, credit balances, WhatsApp messages).
  3. A real onboarding path for a shop's existing data. Today it relies on synthetic seeds and operator acceptance; there is no evidence of an import path for an owner's existing books beyond spreadsheets (the `read-excel-file` dependency exists, but its use was not audited).
  4. WhatsApp Business live sending (needs Meta business verification and templates; code exists but is recorded-only).
  5. Live payments (PayPal is sandbox only and is a weak fit for Indian kirana collections, where UPI dominates; the repo itself treats UPI only as bookkeeping rows).
  6. Model risk (defaults are Meta's newest Muse models; the shelf count depends solely on SAM 3.1).
  7. Operator time per shop (manual acceptance, AI switch-on).
- **Sarthi:**
  1. Real STT (voice is fake; Gemini multimodal, Sarvam or OpenAI adapters exist only as enum values).
  2. Production media storage (Supabase Storage) for meal and receipt photos.
  3. A Razorpay checkout and webhook (schema exists, routes don't).
  4. Server-side AI keys with per-user daily caps. BYOK will not work for paying consumers.
  5. Account deletion and a complete export (coach and journey tables are missing).
  6. Turning Supabase auth on in production and retiring anonymous sandboxes.
  7. A memory write path (§5).
  8. Considering RLS or per-user DB policies as defence in depth.
  9. A native or PWA notification loop (push is a scaffold); the coach "that reaches out" is roadmap only — [README.md "Where it is going"](/home/user/sawhneysatvik/sarthi/README.md)
- Munshi is closer to "safe to hold real data". Sarthi is closer to "cheap to put in front of consumers", because its feature surface is smaller and BYOK or fake modes keep costs near zero for a demo.

### Gaps
- No evidence in either repo of user interviews, waitlist size, conversion data or pricing tests.
- Hosting cost per user for either product: Munshi's `ai.spend` design could measure it, but there is no production data.

## 5. Sarthi's memory today: how it is written, retrieved, ranked, retired and audited

### Takeaway
Sarthi's coach has a "two-layer memory".
- **Layer 1** is a raw, append-only transcript: the last 12 `coach_messages` across all time.
- **Layer 2** is a durable `coach_memory` table. Content is immutable; only `pinned`, `useCount`, `lastUsedAt` and `retired` can change. It is ranked at read time by a frecency formula (0.6·recency with τ=60 days + 0.4·log-frequency) with an un-evictable pinned floor and top-K=8 per detected domain, plus an append-only audit table.

The retrieval and ranking half is built and tested. The write half is not: no production code path creates or audits a memory. Layer-2 rows come only from the demo seed (two pinned goals), and the UI's memory-confirm endpoint (`/api/coach/memory`, "C7") does not exist. Learned "estimate-memory" is explicitly deferred.

### Cited Findings
**Layer 1 (short-term)**
- `converse()` reads the last 12 `coach_messages` (chronological), then appends the user turn. The coach reply is persisted with a bounded `toolLogJson` (tool, ok, args, summary, entryIds), `proposedAdaptationId`, `modelProvider` and `modelId` — [core/coach/engine.ts:126-224](/home/user/sawhneysatvik/sarthi/core/coach/engine.ts); [data/migrations/0006_coach_memory.sql:5-17](/home/user/sawhneysatvik/sarthi/data/migrations/0006_coach_memory.sql)

**Layer 2 (durable) schema and rules**
- Schema: `coach_memory(id, userId, createdAt, domain ∈ {health, money, habits, skills, global}, kind ∈ {goal, preference, commitment, observation, struggle}, text, pinned, useCount, lastUsedAt, sourceCaptureId, estimated, confidenceBps 0–10000, retired)`. Indexes are (userId, domain) and (userId, pinned) — [data/schema/contract.ts:95-103, 1643-1735](/home/user/sawhneysatvik/sarthi/data/schema/contract.ts); [data/migrations/0006_coach_memory.sql:19-36](/home/user/sawhneysatvik/sarthi/data/migrations/0006_coach_memory.sql)
- Mutation rules: `text`, `kind` and `domain` are immutable after creation. The only update is the Zod-bounded `coachMemoryUpdate {pinned, useCount, lastUsedAt, retired}`. A test proves that a patch carrying `text:"HACKED"` is stripped. "Retire, never delete" (no `softDelete`). The tenant guard sits in the WHERE clause (`id` AND `userId`) — [data/repository/coach-memory.ts](/home/user/sawhneysatvik/sarthi/data/repository/coach-memory.ts); [tests/coach-memory.test.ts:203-213](/home/user/sawhneysatvik/sarthi/tests/coach-memory.test.ts)

**Ranking and retrieval**
- Score: `W_RECENCY·exp(−Δdays/τ) + W_FREQUENCY·log1p(useCount)/(1+log1p(useCount))`, with W_RECENCY=0.6, W_FREQUENCY=0.4, TAU_DAYS=60. Δdays is measured from `lastUsedAt ?? createdAt`, clamped ≥0. Pinned rows score `PINNED_FLOOR=1.0` (unpinned scores are strictly <1). The score is transient and never persisted. "No stored tier, no tier-transition engine, no graph, no nightly worker — 'cold' is simply 'not in top-K'" — [core/coach/memory.ts:1-56](/home/user/sawhneysatvik/sarthi/core/coach/memory.ts)
- Retrieval: `selectMemories` returns ALL active pinned rows, unfiltered by domain and uncapped. It adds the top K=8 active non-pinned rows whose domain is in (detected domains ∪ {global}). Retired rows are excluded. Ties break by createdAt, then id. Implementation detail: it lists every memory row for the user and filters in JS — [core/coach/memory.ts:61-112](/home/user/sawhneysatvik/sarthi/core/coach/memory.ts)
- Domain detection is keyword regex over the question. Progress or planning words, or no match, fan out to all four domains — [core/coach/engine.ts:30-48](/home/user/sawhneysatvik/sarthi/core/coach/engine.ts)
- Bookkeeping: after every non-busy turn, `bumpMemoryUsage` sets useCount+1 and `lastUsedAt=now` on every row that was injected (pinned + ranked), whether or not the model used it — [core/coach/memory.ts:114-141](/home/user/sawhneysatvik/sarthi/core/coach/memory.ts); [core/coach/engine.ts:197-198](/home/user/sawhneysatvik/sarthi/core/coach/engine.ts)

**Use in the coach loop**
- Memories go into the agent envelope as `{pinned, ranked}`. In the keyless fake path, the first pinned `goal` relevant to the touched domains is appended as "This connects to your goal: …" — [core/coach/agent.ts:184-194, 547-611](/home/user/sawhneysatvik/sarthi/core/coach/agent.ts)
- The agent loop:
  - Hand-rolled with no framework, using a flat Zod discriminated union with 4 tools (read-domain-evidence, read-progress, read-plan, propose-adaptation) plus `final`.
  - MAX_STEPS=6, 45-second wall timeout, one retry then "degrade-never-abort".
  - Duplicate-call guard; an empty first final is rejected once; one proposal per turn; money plans cannot be adapted.
  - Citations are validated against toolLog entryIds.
  - Untrusted text is fenced with `⟦untrusted⟧`.
  - An in-process `INFLIGHT` Set enforces single-flight.

  — [core/coach/agent.ts:43-53, 96-138, 515-541, 731-848](/home/user/sawhneysatvik/sarthi/core/coach/agent.ts)
- Memory reaches only `converse`. Daily and weekly briefs, the per-capture line and reflection summaries do not read `coach_memory` — [core/coach/engine.ts:72-124](/home/user/sawhneysatvik/sarthi/core/coach/engine.ts); [core/coach/reflection.ts](/home/user/sawhneysatvik/sarthi/core/coach/reflection.ts)

**Writing and auditing (the missing half)**
- The audit table `coach_memory_audit(memoryId, kind ∈ {created, confirmed, pinned, unpinned, edited, retired}, confidenceTier, source ∈ {converse, daily-brief, weekly-reflect, user})` is append-only. Its repository is wired, but only tests call it — [data/schema/contract.ts:105-111, 1737-1766](/home/user/sawhneysatvik/sarthi/data/schema/contract.ts); [data/repository/factory.ts:113-114](/home/user/sawhneysatvik/sarthi/data/repository/factory.ts)
- Write path: `repos.coach.memory.create` is called only in `data/seed/demo.ts:326-331` (two pinned goals, "Save ₹5,000 every month" and "Reach 500 hours on System Design", with `estimated:false` and 10000 bps) and in tests and eval fixtures. Onboarding, capture and the coach never create memories. The contract comment says "write gating enforced in C7" — [data/seed/demo.ts:322-331](/home/user/sawhneysatvik/sarthi/data/seed/demo.ts); [data/schema/contract.ts:1649](/home/user/sawhneysatvik/sarthi/data/schema/contract.ts); `grep "coach.memory"` across the repo
- UI: `CoachReadingRoom` has a `resolveMemory(id, "confirm" | "discard")` that POSTs to `/api/coach/memory`. The comment calls the shape "a guess until C7 lands its route… Never fires in C4 (the list is empty)". There is no such route under `app/api/coach/` (only `adaptation`, `ask`, `brief`). The offline queue explicitly refuses `/api/coach/memory` — [components/coach/CoachReadingRoom.tsx:284-302](/home/user/sawhneysatvik/sarthi/components/coach/CoachReadingRoom.tsx); [tests/offline-queue.test.ts:162-163](/home/user/sawhneysatvik/sarthi/tests/offline-queue.test.ts)
- Commit timeline: COACH-1 "two-layer memory — coach_messages + coach_memory + audit + frecency" (Jul 21 18:21), COACH-2 "grounded persistent converse — replaces the fabricating ask", COACH-3 "coach acts", COACH-4 "/coach conversation UI". No COACH-5, 6 or 7 — `git log` (1a43f41, 4529105, 28b0a3a, 9c55a5f)

**Tests**
- 11 tests in `coach-memory.test.ts` (frecency ordering, pinned floor at any age or K, domain filter plus global, retired excluded, K cap, bump leaves content untouched, immutable content, audit append and query, tenant isolation). 17 in `coach-agent.test.ts` (routing, pinned goal surfaced, alias coercion, step cap, duplicate guard, empty-final, dangling citations, money refusal, one proposal per turn, degrade, wall timeout, single-flight, fence). The eval gate is "groundedAnswerRate=1.0, ungrounded=0, pinnedGoalRetention=1.0, wrongSilentWrites=0", run on the keyless fake — [tests/coach-memory.test.ts](/home/user/sawhneysatvik/sarthi/tests/coach-memory.test.ts); [tests/coach-agent.test.ts](/home/user/sawhneysatvik/sarthi/tests/coach-agent.test.ts); [tests/eval/coach-agent.eval.test.ts:107-271](/home/user/sawhneysatvik/sarthi/tests/eval/coach-agent.eval.test.ts)

**What the design deliberately excludes or defers**
- Excludes stored tiers, tier transitions, a graph, nightly workers and LRU eviction of goals. Floats are never persisted (the score is transient). Memory is "coach INFRA, not a fifth domain (D-054)" — [core/coach/memory.ts:1-15](/home/user/sawhneysatvik/sarthi/core/coach/memory.ts); [data/migrations/0006_coach_memory.sql:1-4](/home/user/sawhneysatvik/sarthi/data/migrations/0006_coach_memory.sql)
- "Learned estimate-memory (your 'dal 450→520 sticks') — deferred. v1 corrections edit only the current entry. Roadmap version is corrections-only, confidence-gated, inspectable, deletable", scoped to food items and spend categories — [docs/product/PRD.md:82, 231](/home/user/sawhneysatvik/sarthi/docs/product/PRD.md); [docs/product/PHASES.md](/home/user/sawhneysatvik/sarthi/docs/product/PHASES.md) (Phase 2)
- Journey "memory" is a different thing: bounded `daily_reflections` (one per day: mood, energy, sleep, journal) and up to 4 private images, "never a fifth domain" (D-047) — [docs/product/DECISIONS.md:222-223](/home/user/sawhneysatvik/sarthi/docs/product/DECISIONS.md)

**Documentation drift**
- SCREEN-COACH.md still says Q&A is "session-scoped in v1; thread-persisted = roadmap" and does not mention durable memory — [docs/screens/SCREEN-COACH.md §8-9](/home/user/sawhneysatvik/sarthi/docs/screens/SCREEN-COACH.md)
- DECISIONS.md stops at D-048, while code cites D-050 to D-054 — [docs/product/DECISIONS.md](/home/user/sawhneysatvik/sarthi/docs/product/DECISIONS.md); grep "D-05"
- `docs/roadmap/` holds only a one-line README — [docs/roadmap/README.md](/home/user/sawhneysatvik/sarthi/docs/roadmap/README.md)

**For comparison: Munshi's "Keeper" memory**
- Notes are written by a person (owner or manager) inside their own decision transaction: a rejection's words become a `declined` note, an approval's a `preference`. Each note:
  - cites a decision;
  - is 1–160 characters;
  - contains no digits or number words (enforced in the app and again in the schema across every Unicode digit class);
  - has names masked to roles on live shops;
  - lists `about` ids so erasure can find it.
- Notes are valid for 180 days (365 maximum). The newest 12 enter the prompt inside a delimited `<memory>` block. The owner can forget a note (audited). Notes are used only in live mode.
- [db/schema/23_memory.sql:1-60](/home/user/munshi/db/schema/23_memory.sql); [packages/core/src/memory.ts:1-25, 143-236](/home/user/munshi/packages/core/src/memory.ts); [packages/agent/src/run.ts:78-91](/home/user/munshi/packages/agent/src/run.ts); [docs/limitations.md:73](/home/user/munshi/docs/limitations.md)

### Inferences
- **The README overstates current behaviour.** "It keeps… a longer one that holds the things that matter to you… and it brings those up across conversations" ([README.md:105](/home/user/sawhneysatvik/sarthi/README.md)) is true only for the two seeded demo goals. A "Start fresh" user's Layer 2 stays empty forever, so their only cross-conversation memory is the 12-message transcript.
- **The frecency loop reinforces itself.** Usage means "injected", not "cited", so every row that makes the top-K gets its recency reset and its frequency raised each turn it surfaces. A row with useCount 10 surfaced today scores about 0.88 (0.6 + 0.4·0.706). A brand-new memory scores 0.60, so incumbents in an eligible domain (and all `global` rows) can monopolise the 8 slots. A fresh design should count model citations, not injections.
- **Several defence-in-depth gaps would matter once memories come from conversation:**
  - Memories are not fenced in the wire envelope (`toWireEnvelope` fences question, transcript and toolLog, but not `memories`), so a user-derived memory could carry instructions.
  - `citationsValid=false` is computed but never consumed by the engine, route or UI, and the coach's final text is not checked for invented numbers. Munshi's digit and number-word validator does both.
  - `INFLIGHT` single-flight is per serverless instance, not global.
  - These points come from [core/coach/agent.ts:305-316, 515-541, 672-848](/home/user/sawhneysatvik/sarthi/core/coach/agent.ts) and [app/api/coach/ask/route.ts](/home/user/sawhneysatvik/sarthi/app/api/coach/ask/route.ts).
- **Retrieval is keyword and domain based:** no embeddings or semantic search, no dedupe or contradiction handling, and no consolidation or summarisation of Layer 1 into Layer 2. Content immutability means "edit" can only be retire plus create, even though an `edited` audit kind exists.
- **What a restart could keep from the memory work:**
  - the immutable-content plus bounded-lifecycle table shape;
  - retire-not-delete with an append-only audit;
  - integer `confidenceBps` and an `estimated` flag;
  - the pinned-goal floor;
  - controlled-clock tests.
- **What it would replace:**
  - the missing write and confirm path (C7);
  - usage counting tied to injection;
  - regex domain detection;
  - unfenced memory injection;
  - memory reaching only `converse`.
- **Munshi's memory philosophy differs.** Notes are human-authored, decision-cited, number-free and expiring; Sarthi's are machine-ranked with a planned confirm gate. A unified design could use Munshi's write discipline (citation, expiry, forget, erasure) with Sarthi's ranking and pinning.

### Gaps
- The `COACH-LIFT` document (§2, §2.1–2.6, §8 are cited in code) and the "second_brain study" are not in the repo (probably local-only: `.gitignore` excludes `.claude/`, `CLAUDE.md` and `claude.mk` — [.gitignore](/home/user/sawhneysatvik/sarthi/.gitignore)). Its planned C5–C7 scope (memory proposal, confirm, write gating) cannot be verified.

## 6. Shared DNA: what could be extracted, and how much of Sarthi survives a fresh restart

### Takeaway
The two codebases share principles more than code: a provider-agnostic model layer, a deterministic keyless or recorded mode, propose-then-confirm before any write, grounded or cite-or-abstain answers, integer money, Next.js, Supabase and Vercel, and PWA. Their implementations diverge: OpenAI SDK vs Vercel AI SDK, roles vs tiers, raw SQL with RLS vs Drizzle with app scoping, Vitest vs `node:test`, Biome vs ESLint. Realistic shared packages are a model-provider package, a number-grounding validator, an env/config module and a confirm/approval-plus-memory contract. In a Sarthi restart focused on memory, about 90% of current product code is not memory-specific and could be kept. A true clean-slate rewrite would most profitably port the portable `core/` (capture, domains, game, onboarding), the schema contract, the providers and the art.

### Cited Findings
**Model layer**
- Munshi: `packages/ai` (1,651 lines) has "no database and no agent logic". A source-scanning gate fails if it imports a Munshi package or a DB driver. It provides roles, catalogue, fallback, prices, redaction and recorded fixtures — [README.md:396-397, 409-411](/home/user/munshi/README.md); [packages/ai/src/](/home/user/munshi/packages/ai/src)
- Sarthi: `providers/llm` + `vision` + `fake` (about 700 lines) on AI SDK 7, with tiers and BYOK — [providers/](/home/user/sawhneysatvik/sarthi/providers)
- Both keep provider names out of business logic. Sarthi enforces this with a hook grep for `@ai-sdk/*` in `core/` and `data/` — [.codex/hooks/check-invariants.sh](/home/user/sawhneysatvik/sarthi/.codex/hooks/check-invariants.sh)

**Confirm before write**
- Munshi: `proposeDraft` and `decide` re-run the cited reads and mark the draft stale if anything moved, enforced by a DB trigger — [packages/core/src/approvals.ts](/home/user/munshi/packages/core/src/approvals.ts) via [README.md:152](/home/user/munshi/README.md)
- Sarthi: route-by-confidence ≥9000 bps; estimate cards; latest-batch compensating undo (`core/capture/commit.ts`, 1,143 lines); adaptation Keep/Revert with server-built before/after snapshots — [core/capture/route.ts](/home/user/sawhneysatvik/sarthi/core/capture/route.ts); [core/coach/agent.ts:479-509](/home/user/sawhneysatvik/sarthi/core/coach/agent.ts)

**Grounding**
- Munshi's validator refuses any digit or number word (English/Hindi) and any cell from another run or shop; it backs 199 clean, 157 attack and 18 refused corpus sentences — [README.md:154, 687](/home/user/munshi/README.md); [docs/limitations.md:22-36](/home/user/munshi/docs/limitations.md)
- Sarthi validates citation entryIds but does not check numbers in prose — [core/coach/agent.ts:515-541](/home/user/sawhneysatvik/sarthi/core/coach/agent.ts)

**Money and units**
- Munshi: minor units plus currency, milli-units for quantities.
- Sarthi: paise, ml, minutes and grams, with a hook flagging float money fields.
- [README.md:631-632](/home/user/munshi/README.md); [AGENTS.md §2.2](/home/user/sawhneysatvik/sarthi/AGENTS.md)

**Keyless or recorded modes**
- Munshi: recorded mode is the default with hand-written fixtures; "never call a model in a test".
- Sarthi: the `fake` stack drives every flow keyless, and tests sentinel `fetch` to throw.
- [docs/decisions/0007-recorded-mode.md](/home/user/munshi/docs/decisions/0007-recorded-mode.md); [CONTRIBUTING.md](/home/user/munshi/CONTRIBUTING.md); [tests/coach-memory.test.ts:33-40](/home/user/sawhneysatvik/sarthi/tests/coach-memory.test.ts)

**Config**
- Munshi: `packages/config` (442 lines) reads the environment, checks it at boot and never prints a secret.
- Sarthi: Zod env parsing in `app/lib/runtime.ts` with empty-string-as-unset.
- [README.md:398](/home/user/munshi/README.md); [app/lib/runtime.ts:29-62](/home/user/sawhneysatvik/sarthi/app/lib/runtime.ts)

**Stack versions**
- Munshi: Next 16.4.3, React 19.3.1, zod 4.6.7.
- Sarthi: Next 16.1.6, React 19.2.4, zod 4.1.13.
- Both use pnpm 11.9.0 and Node ≥22.
- [apps/web/package.json](/home/user/munshi/apps/web/package.json); [package.json](/home/user/sawhneysatvik/sarthi/package.json)

**Sarthi code that is coach- or memory-specific**
- core/coach is 1,752 lines; components/coach/CoachReadingRoom.tsx 402; app/api/coach/* 153; data/repository/coach-memory.ts 86; the 0006 migrations about 96 (SQLite plus Postgres). That is about 2,500 lines, roughly 8% of about 32.3k product lines.
- Coach-related tests are 1,414 lines (coach-agent 489, coach-memory 240, coach 171, reflection 49, eval coach 278 + 187), about 18% of 7,877 test lines.
- Source: `wc -l` over those paths.

**Portable core**
- Sarthi's `core/` is framework-clean and AST-checked. Its largest parts are capture (2,004), onboarding (1,636), domains (1,381), game (489) and tools (481).
- The 41-scene GPT-Image art set is 1.13 MB of WebP.
- [AGENTS.md §2.9](/home/user/sawhneysatvik/sarthi/AGENTS.md); [docs/product/CHANGELOG.md (SAR-018)](/home/user/sawhneysatvik/sarthi/docs/product/CHANGELOG.md); [public/art/](/home/user/sawhneysatvik/sarthi/public/art)

### Inferences
- **Candidate shared packages**, ordered by value over effort:
  1. A provider package: role or tier → model alias → fallback chain, recorded/fake fixtures, price table and spend row, key redaction. Munshi's `packages/ai` is closest to package-ready, but uses the `openai` SDK rather than AI SDK 7, so one side would migrate.
  2. A number-grounding validator, porting Munshi's `answer.ts`/`words.ts`/`numbers.ts` so Sarthi's coach prose cannot carry free digits.
  3. A "proposal → human decision → typed write → audit → undo" contract, with memory notes as decision-cited records (Munshi's `ai.memory` discipline).
  4. The config/env module.
  5. PWA shell pieces (manifest, service worker, install guidance).

  The deep DB-enforced parts of Munshi (RLS roles, the book guard trigger, 30 ordered SQL files) are domain-specific and would not transfer to Sarthi without adopting raw SQL over Drizzle.
- **Sarthi restart scenarios, as estimates from line counts:**
  - **"Keep the repo, rebuild the coach and memory":** discard or rewrite about 2.5k product lines and about 1.4k test lines; keep about 90% of product code and about 80% of tests.
  - **"Fresh repo, port selectively":**
    - Likely survivors: the schema contract for the four domains plus commits, plans and progress (most of `data/schema/contract.ts`); `core/capture`, `core/domains`, `core/game`, `core/onboarding` and `core/tools` (about 6k lines); the providers and fake stack (about 1.2k); the token and theme system and most `components/` (about 9.6k); the art; the capture, F3 and receipt eval tests.
    - Candidates to drop or re-decide: the dual SQLite/Postgres Drizzle layer (going Postgres-only, perhaps with RLS); the anonymous sandbox identity; the Razorpay schema stubs (no code); the coach memory tables; the Codex process scaffolding and 13.4k lines of planning and handoff docs (archive rather than port).
  - The unbuilt items in either scenario are the same: real STT, media storage, billing, deletion, and the memory write path.
- **Munshi to Sarthi transfer:** Munshi's test harness ideas (embedded Postgres, never mock the DB, red-proofs) and its cost controls (`allow()`, `ai.spend`) are the most valuable things for a Sarthi restart with server-paid AI.

### Gaps
- No attempt was made to compile or run either test suite, so whether the suites pass on these checkouts is unverified. The last recorded claims are Sarthi `pnpm check` "223 green" at SAR-018 ([.codex/GOAL](/home/user/sawhneysatvik/sarthi/.codex/GOAL)) and Munshi CI `pnpm check` in recorded mode ([.github/workflows/check.yml](/home/user/munshi/.github/workflows/check.yml)).
- The survival percentages are line-count estimates, not a dependency analysis of every import.

## 7. Process signals: how each was built, and over-engineering vs user validation

### Takeaway
Both were built agent-first by a solo founder under hackathon deadlines, with heavy process scaffolding. Sarthi used a Codex multi-agent "mesh" with signed plans, hooks, 48 recorded decisions and 10 handoffs; local Claude Code was also used. Munshi used Claude Code worktree agents, 12 ADRs and a 1,916-case red-proof harness. Both repos invest heavily in verification and process relative to user validation: zero real users in either, Munshi's test-to-product ratio is about 0.69, and Sarthi's process docs are about 41% of its code lines. Several user-facing basics remain fake or unwired (Sarthi voice and media, both products' billing).

### Cited Findings
**Sarthi's agent mesh**
- Nine Codex agents in `.codex/agents/*.toml`: architect, reviewer and product-researcher on `gpt-5.6-sol`; pipeline, ship, screens and test-eval on `gpt-5.6-terra`; scout and docs-verifier on `gpt-5.6-luna`.
- Rule: "Sol plans + reviews · Terra writes ALL code · Luna stays read-only". Every ticket flows plan → human sign-off → build → diff review.
- [AGENTS.md §6](/home/user/sawhneysatvik/sarthi/AGENTS.md); [.codex/config.toml](/home/user/sawhneysatvik/sarthi/.codex/config.toml); `grep model= .codex/agents/*.toml`

**Sarthi's process artifacts**
- 3 hooks (check-invariants, guard-writes, session-context); 11 per-ticket plans (`.codex/plans/SAR-008…019A`); 11 design-oriented Codex skills; 10 handoff docs; an adversarial doc audit (`CRITIQUE.md`); DECISIONS D-001 to D-048 (later IDs cited in code but not recorded); "Codex `/feedback` session" provenance for the rubric.
- [.codex/](/home/user/sawhneysatvik/sarthi/.codex); [docs/handsoff/](/home/user/sawhneysatvik/sarthi/docs/handsoff); [docs/product/CRITIQUE.md](/home/user/sawhneysatvik/sarthi/docs/product/CRITIQUE.md); [docs/product/CHANGELOG.md](/home/user/sawhneysatvik/sarthi/docs/product/CHANGELOG.md)
- The project was planned with a "Claude Max Mega-Planning Session" that should have produced `docs/roadmap/*` (a mobile bake-off, a monetization deep-dive with pricing research and an AI cost model per user). Those outputs are not in the repo. Local Claude Code config is gitignored — [docs/planning/PLANNING-BRIEF.md](/home/user/sawhneysatvik/sarthi/docs/planning/PLANNING-BRIEF.md); [docs/roadmap/README.md](/home/user/sawhneysatvik/sarthi/docs/roadmap/README.md); [.gitignore](/home/user/sawhneysatvik/sarthi/.gitignore)
- The "Codex harness" ticket flow ended at SAR-019A (Jul 19), with "NEXT: SAR-020… HARD STOP before SAR-021". The Jul 20–21 work (deploy, BYOK, Supabase auth, waitlist and admin, PWA, offline queue, COACH-0…4) uses new ticket families (UIE-, PL-, T2–T4, COACH-) and decision IDs D-049 to D-054 that are not recorded in DECISIONS.md — [.codex/GOAL](/home/user/sawhneysatvik/sarthi/.codex/GOAL); [docs/handsoff/handsoff_10.md](/home/user/sawhneysatvik/sarthi/docs/handsoff/handsoff_10.md); `git log`
- Sarthi's README tells the build story: "I set up a small crew of agents on top of Codex and let them run… A fair amount of it happened overnight" — [README.md:148](/home/user/sawhneysatvik/sarthi/README.md)

**Munshi's process**
- 12 ADRs. CONTRIBUTING requires that "a new or changed gate is not done until it is red-proved". The red-proof harness runs each of 1,916 sabotage cases and requires the named test to fail. "Never mock the database." 11 merges from Claude Code `worktree-agent-*` branches.
- [docs/decisions/README.md](/home/user/munshi/docs/decisions/README.md); [CONTRIBUTING.md](/home/user/munshi/CONTRIBUTING.md); [docs/decisions/0012-every-gate-red-proved.md](/home/user/munshi/docs/decisions/0012-every-gate-red-proved.md); `git log`
- Munshi deliberately keeps planning out of the repo: commit "Keep internal working material out of the repository: planning notes, design explorations and review screenshots stay local" (Nov 3) — `git log`

**User validation**
- Munshi: "no real shop has used Munshi"; all data is synthetic — [docs/limitations.md:66-69](/home/user/munshi/docs/limitations.md)
- Sarthi: the only intended user is the founder (dogfood bar: "logs his real life through it daily"). No repo evidence that dogfooding happened (no exported data, no dogfood notes). Voice capture, the core interaction, is fake — [docs/product/PRD.md:48-50, 221](/home/user/sawhneysatvik/sarthi/docs/product/PRD.md); §3 above

**Breadth signals**
- Munshi: 151 tables, 7 model providers, 6 DB login roles, a public API with TypeScript and Python SDKs (APIMatic), a Postman collection, a Zapier app, an embeddable widget, two shop websites, an operator console with TOTP, and AG Grid and Bryntum views — [README.md](/home/user/munshi/README.md)
- Sarthi: 3 themes × 2 modes, 41 generated scenes, 4 Tools, a game layer (XP, levels, streaks), and four lenses — [README.md](/home/user/sawhneysatvik/sarthi/README.md); [docs/product/PRD.md §7](/home/user/sawhneysatvik/sarthi/docs/product/PRD.md)

### Inferences
- **Over-engineering versus validation:** both projects optimise for correctness proofs and judge-facing completeness rather than for learning from users. Munshi's guarantee machinery (DB-enforced approvals, red-proofs) is impressive and is a real moat for a money product, but it was built before any shop validated the core loop (findings → draft → approve) or the willingness to pay. Sarthi spent its effort on process, art and lenses while leaving the defining input (real voice) and the defining coach capability (durable memory writes) unbuilt.
- **Velocity:** both show very high throughput (Sarthi's about 32k product lines in about 5.7 days; Munshi's about 170 commits in the visible two weeks on top of a large existing tree), consistent with heavy agent-written code. Maintainability for one person is the open question. Munshi's scale (about 160k lines including tests, 151 tables) is a large surface for a solo maintainer; Sarthi's (about 40k lines) is more tractable.
- **For a "restart Sarthi with proper memory" decision:** the strongest reusable assets are the capture pipeline and its trust boundary, the typed domain schema, the keyless fake stack and the art. The weakest are the memory write path (absent), voice (fake) and process docs (stale or partly unrecorded). Munshi's memory, grounding and spend-cap patterns are directly relevant prior art from the same author.

### Gaps
- Exact AI-generated share of code: Sarthi says "coded end to end with Codex", and Munshi's worktree-agent merges indicate Claude Code, but neither repo quantifies it.
- Whether the founder dogfooded either product on real data. Nothing in either repo shows it, and the brief's question "whether any real user has used either" can only be answered from Munshi's explicit statement: none.
