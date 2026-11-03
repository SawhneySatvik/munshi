# Munshi

Munshi is an AI back office for a small shop that sells, stocks and buys. The demo shop is a kirana (an Indian corner
store). Sign-up today offers three kinds of shop: kirana, salon and apparel. A restaurant kind is not built yet. All data in this repository is synthetic.

Munshi comes in three layers:

1. **Munshi, the agentic back office.** Counter, stock, buying, books, customer credit (udhaar), staff and salary,
   customers, campaigns and an inbox. Agents watch the shop's records, explain what happened, find where money leaks and
   draft the fix. A named person approves each draft.
2. **Munshi API.** The same shop as a backend for any storefront: catalogue, offers, bookings, orders and holds, through
   `/api/v1` and a dependency-free SDK (`packages/sdk`).
3. **Munshi Studio.** Shop websites built on that API. Today this means two hand-built sites, a salon (Elite) and a
   boutique (Prabhave), in `apps/sites`. The "Build your storefront" step in the app links to the developer docs
   (`/developers`); there is no template picker yet.

Built for the Meta Global AI Developer Hackathon (Indie track), and prepared for the PayPal AI Hackathon. All code was
written from 27 Oct 2026.

## The One Guarantee

> **Nothing changes the books without a named person's approval, and every number shown traces to a ledger row.**

"The books" means ledgers, stock, prices, the catalogue, customer credit, staff records, and messages to customers or
suppliers. Every other rule in this repository serves this one.

## How the agents work

### The cast

Seven names on screen. Each one covers some of the database's desks and run kinds, which keep their own ids. The mapping
is in `apps/web/lib/cast.ts`.

| Name | Role | What it does |
|---|---|---|
| Munshi | The lead | Answers questions (typed or spoken), routes them to a desk, writes the morning brief, reads answers aloud |
| Tally | Stock | Counts a shelf from a photo; watches shrinkage, expiry, dead stock and holds |
| Ledger | Money | Reads supplier bills (photo or PDF); watches overdue credit, short or missing settlements and staff advances |
| Dash | Fixes | Turns a finding into a draft fix ("Draft the fix") using fixed recipes, not model output |
| Echo | Customers | Inbox: transcribes voice notes, drafts replies and orders from chat; watches orders, bookings and lapsing regulars |
| Bloom | Campaigns | Writes campaign copy for the owner to edit; watches expiring packages |
| Keeper | Memory | Keeps short notes made from past decisions (for example, why a draft was rejected); the owner can make it forget |

The office page (`/app/office`) shows a card for each cast member with its last seven days of runs: proposed, approved,
rejected, abstained, failed. The run log opens each run step by step.

### Agents propose, a person approves

- The agent's database role (`munshi_agent`) can read snapshots and some name views. It has no write grant.
- An agent reaches the books only by proposing a draft through the core API. The draft waits under "Waiting for you".
- Approving a draft runs it under the approver's name, in one transaction with its audit entry. If the rows the draft
  was based on have changed since, the draft is marked stale instead of running.
- Watchers (the jobs that look for leaks) run with no actor and can only raise findings. A finding offers **Why?** (an
  explanation with sources), **Draft the fix**, **Snooze** and **Dismiss**.

### Every figure traces to a stored row

- A screen or an agent gets numbers only through a named read. Each named read stores its result as a snapshot: one
  typed cell per value (`snap.snapshot_cell`).
- Model text carries handles that point at cells, never free digits. The validator (`packages/agent/src/answer.ts`,
  `words.ts`) refuses an answer that contains a digit, a number written as words, or a cell from another run or shop.
  The screen then shows "Cannot verify" in fixed words.
- A draft's numbers are cells too. A typed amount is refused.

### Why this number

Tap any figure to open its source drawer. On request, it walks the chain behind the figure:

1. the cell;
2. the read that produced it;
3. the book row behind it;
4. the decision that wrote that row;
5. who approved it.

A total stops at the read that summed it. A link that cannot be walked shows "Cannot verify" where the chain breaks.
Counter staff see the chain only up to the book row; the owner and the manager also see who decided and who approved.
The code is `apps/web/components/WhyChain.tsx`.

## Architecture

```
apps/web            Next.js 16: owner app (/app), counter, demo picker, superadmin console (/platform), /api/v1, webhooks
apps/sites          the hosted shop sites (Elite, Prabhave), reading the shop through the SDK
packages/core       framework-free domain: commands, approvals, snapshots, named reads, watchers, jobs, platform, sign-in
packages/ai         the provider layer: adapters, model catalogue, editions and fallback, recorded fixtures
packages/agent      the agent flows: ask, photos, bills, voice, read-aloud, inbox, recipes, cite-or-abstain
packages/adapters   channels (WhatsApp, Instagram, recorded), payments (PayPal), identity (password, Supabase email), cache
packages/config     the one config module: boot checks and secret redaction
packages/contracts  API v1 zod schemas, which generate openapi.json and the SDK's types (pnpm contracts)
packages/sdk        the dependency-free API client
db                  db/schema (the SQL), db/seed (synthetic shops), db/test/v2 (gates and red-proofs), db/src (dev, build)
```

### The database

- PostgreSQL 17. The schema is the ordered files `db/schema/00_bootstrap.sql` to `90_seal.sql`, rebuilt from scratch
  on every build. Each file has a `.manifest.json` listing its tables, grants and indexes, and the gates check the
  built database against those manifests.
- `tenant_id` leads every key. Row-level security is enabled and forced on every tenant table. The app role never owns a
  table. Tenant and actor are set only with `SET LOCAL` inside a transaction.
- **The book guard.** A trigger on every book table admits an insert only in two cases:
  - a person's own direct command, which their role is allowed to run and which writes that table;
  - an approved decision made in the same transaction by a member allowed to approve it.

  Anything else is refused with `MS001`.
- Books are append-only, with no UPDATE or DELETE grant. A correction is a reversal with a reason and an actor. Journal
  entries balance per currency at commit.
- Every book row has an audit entry in a per-tenant hash chain (`audit.audit_log`).
- Which named reads each role may see is one map in core (`packages/core/src/read-roles.ts`), checked wherever a
  snapshot is minted or read back.

### The provider layer

Agents ask for a **role**, not a model. The roles are router, reason, vision, segment, voice, narrate and speak. Config
maps each role to a provider and model by alias (`packages/ai/src/config.ts`, `models.ts`). No provider name is stored
in the database, and no provider-specific code lives outside its adapter.

- **Two editions,** selected by `MUNSHI_EDITION`:
  - `meta` (the default) uses Meta's models first;
  - `paytm` uses Gemini, Sarvam and the other providers.
- **Meta first.** On the meta edition a run's chain keeps Meta-hosted models ahead of every other provider.
- **Fallback.** In live mode, when Meta's key is missing a call moves to the next allowed model that has a key. When
  Meta is down, a run's chain moves on the same way.
- **Choosing models.** The superadmin approves a list of allowed model aliases for each role, and a shop's owner picks
  one per agent from that list.
- **Off switch and caps.** Before every model call, core's `allow()` checks three things: AI is on for the deployment
  and for the shop, the shop's daily call cap is not reached, and the deployment's daily ceiling is not reached. If a
  call is refused, the screen shows its template.
- **Not built yet.**
  - Spend in money: the `ai.spend` table and the monthly budget exist in the schema, but no code writes or reads them.
  - Per-shop model lists and per-feature switches: the platform design describes them, but they are not in the code.

### Recorded mode

`MUNSHI_MODEL_MODE` is `recorded` unless set. In recorded mode every model call is answered from a committed fixture,
and nothing leaves the machine. The fixtures live in `apps/web/fixtures`, `packages/agent/fixtures` and
`packages/ai/fixtures`.

- The Meta fixtures are hand-written, not recordings of Meta's models.
- A request with no fixture fails as a model error, and the flow abstains ("Cannot verify") or uses its template.
- Screens built on recorded answers say "Recorded response".

`live` calls the providers. `record` calls them and saves the answers as fixtures.

## Run it locally

Needs Node 22+ and pnpm 11. No Docker and no API key. `redis-server` is optional: without it the app uses an in-memory
cache.

```bash
pnpm install
pnpm dev
```

`pnpm dev` (`db/src/dev.ts`) does the following:

- starts an embedded PostgreSQL 17 in `.run/pg17` and builds the schema;
- seeds the synthetic shops and runs their watchers;
- starts the app on http://localhost:3000 in recorded mode, with the jobs ticker.

To see the shops, open `/demo` and pick a sample shop; no password is needed. The superadmin console's dev sign-in is
written to `.run/dev-operator.json`.

`pnpm dev` passes your shell's environment to the app, so to use keys, run
`node --env-file=.env db/src/dev.ts` instead. Variable names are in `.env.example`. None are needed for the demo.

| You want | Set |
|---|---|
| Live models, Meta first | `MUNSHI_MODEL_MODE=live`, `META_MODEL_API_KEY` (Muse Spark, SAM 3.1, Muse Voice Transcribe), `BASETEN_API_KEY` (Muse Spark Open, narrate) |
| Live models before the Meta keys arrive | `MUNSHI_MODEL_MODE=live`, `GEMINI_API_KEY`. The meta edition falls back to Gemini for text and vision |
| Hindi and English speech, read-aloud, PDF bills | `SARVAM_API_KEY` |
| Other providers (optional) | `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY` |
| PayPal sandbox (optional) | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, optionally `PAYPAL_ENV=sandbox`. See [docs/submission/paypal.md](docs/submission/paypal.md) |
| WhatsApp, Instagram (optional) | the `WHATSAPP_*` and `INSTAGRAM_*` names, `MUNSHI_PHONE_ROUTE_SECRET`, and `MUNSHI_SEND_MODE=live` |
| Real-shop email sign-up on a hosted deploy | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `MUNSHI_APP_URL` |

The hosted deploy (Supabase plus Vercel) is described in `deploy/supabase.md`, `deploy/vercel.md` and `docs/DEPLOY.md`.

## Integrations, and what each needs before it goes live

| Integration | Used for | In the code | Status today | Needs before live |
|---|---|---|---|---|
| Meta Muse Spark, SAM 3.1, Muse Voice Transcribe | router, reason, vision; counting units on a shelf photo; speech to text | `packages/ai/src/providers/generate.ts`, `meta-sam.ts`, `meta-voice.ts` | Recorded (hand-written fixtures). No live Meta call has been made | `META_MODEL_API_KEY`; then record real fixtures |
| Meta Muse Spark Open (open weights, on Baseten) | narrate (writes the short answer) | `generate.ts` through Baseten's OpenAI-compatible endpoint | Recorded. The request shape is unverified | `BASETEN_API_KEY` |
| Gemini | Meta edition's fallback; paytm edition's default | `generate.ts`, OpenAI-compatible endpoint | The three Gemini models the build uses passed a live probe on 31 Oct (`docs/model-probe-2026-10-31.md`) | `GEMINI_API_KEY`, `MUNSHI_MODEL_MODE=live` |
| Sarvam | read-aloud (Bulbul v3, both editions); speech to text (Saaras v4, the voice fallback); PDF bills (Sarvam Vision) | `sarvam-speak.ts`, `sarvam-voice.ts`, `sarvam-docs.ts` | Adapters with recorded fixtures. Saaras v4 passed a live probe on 31 Oct (`packages/ai/src/models.ts`); no live run of Bulbul or Sarvam Vision is recorded in the repository | `SARVAM_API_KEY` |
| WhatsApp Cloud API | inbound messages to the inbox; approved sends (reminders, campaigns) | `packages/adapters/channels/whatsapp.ts`, `/api/webhooks/whatsapp` | Sends are recorded by default. A voice note's media download is not wired; the inbox labels it simulated | the four `WHATSAPP_*` credentials, `MUNSHI_PHONE_ROUTE_SECRET`, `MUNSHI_SEND_MODE=live`, a real accepted shop, the superadmin's channel grant, approved templates for sends outside the 24-hour window |
| Instagram | publishing an approved campaign post | `packages/adapters/channels/instagram.ts`, `/api/webhooks/instagram` | Sends are recorded by default. Webhook events are verified but not stored: the route answers 503 | the five `INSTAGRAM_*` settings, the same send conditions as WhatsApp |
| PayPal (sandbox) | a payment link for an overdue udhaar or an unpaid invoice; PayPal's paid notification | `packages/adapters/payments/paypal.ts`, `packages/core/src/payments-paypal.ts`, `/api/webhooks/paypal` | Built and tested, but hidden in the app until two registry lines are wired (see the PayPal page). Recorded by default. Sandbox only; Munshi never moves money | the three `PAYPAL_*` keys and a public HTTPS URL for the webhook |
| Supabase | the hosted database; verifying a real shop's email at sign-up | `deploy/supabase.md`, `packages/adapters/identity/supabase-email.ts` | Written and tested offline | a Supabase project, its email templates and SMTP sender (`deploy/supabase.md` §8) |

Segment (the shelf count) has no adapter outside Meta. Without Meta's key, the shelf count marks items as uncounted.

## Simulated means labelled

- Every shop in the repository is synthetic: Sharma General Store (kirana), Elite Unisex Salon & Academy, Prabhave
  (suits) and Bansal Super Mart (the Paytm edition's shop). No real shop has used Munshi.
- Suppliers are simulated. Payments are recorded, never processed. A screen with simulated parts says so on the screen.
- The demo shop plants known problems: stock missing from the shelf, a supplier's price creeping up, overdue credit, a
  short settlement, goods near expiry. The answer key is worked out by hand in `db/seed/kirana.answers.json`, so the
  watchers can be checked against it.
- The demo runs in recorded mode. The Ask screen offers the questions that have recorded answers. For the shelf
  count, the bill reader and voice, use the synthetic samples in `packages/agent/fixtures/media/` (`shelf.png`,
  `bill.png`, `ask-en.wav`, `ask-hi.wav`). Any other input has no recorded answer.

## Testing

```bash
pnpm check                                  # lint, typecheck and every package's tests
pnpm --filter @munshi/db test               # the database gates and core tests (embedded PostgreSQL 17)
cd db && node test/redproof.ts --only=v2 <case names>   # red-prove named cases
pnpm redproof                               # every case (slow; run on a quiet machine)
```

- **Gates.** `db/test/v2/gates` holds one test file per schema area: RLS, grants, the book guard, the audit chain, the
  seal. `db/test/v2/core` tests the domain: approvals, snapshots, watchers, PayPal, memory and more. Tests never mock
  the database, because RLS and the guard are what is under test.
- **Every gate can fail.** Each sabotage case in `db/test/v2/sabotage` breaks one protection, through SQL in the test
  database, a source change applied as the module loads, or a harness switch. `redproof.ts` requires the named test to
  fail with each case applied and to pass clean.
  - A sabotage that did not apply counts as an error, not a pass.
  - A run that fails must exit non-zero, even though `embedded-postgres` registers an exit hook that calls
    `process.exit(0)`. `db/test/v2/g8-exit-code.test.ts` checks this.

This README quotes no test counts; run the commands above to get current ones.

## Limitations

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md). In short:

- No live Meta model has been called.
- The Meta fixtures are hand-written.
- The cite-or-abstain validator is word-list based and leans towards refusing.
- Some provider request shapes are marked `UNVERIFIED` in their adapters.

## Licence

Licence: to be chosen by the maintainer before the repository is made public.
