# Munshi and Meta

This page covers how Munshi uses Meta's models (Muse Spark, SAM 3.1, Muse Voice Transcribe, Muse Spark Open) and
Meta's channels (WhatsApp and Instagram). It also says what runs today and what needs keys.

**The short version:**
- Every Meta model call in the repository is answered from a **hand-written recorded fixture**. No live Meta call has
  been made, because no Meta key existed while this was built.
- In live mode, without Meta's key, the meta edition falls back to Gemini and Sarvam.
- WhatsApp and Instagram sends are built behind several switches. They stay recorded until a real shop is accepted and
  given a channel grant.

## Meta's models, through the provider layer

Agents ask for a role, never a model. `packages/ai/src/config.ts` maps each role to a model alias on the `meta` edition
(the default, `MUNSHI_EDITION` unset). `packages/ai/src/models.ts` maps each alias to a provider and model id. No
provider name is stored in the database, and no provider-specific code lives outside its adapter.

| Role | Alias, model id | What it does | Adapter |
|---|---|---|---|
| router | `muse-spark`, `muse-spark-1.3` | sends a question to the right desk (stock, sales, credit and so on) | `providers/generate.ts` (Responses API) |
| reason | `muse-spark` | the desk's tool loop: picks named reads | `generate.ts` |
| vision | `muse-spark` | names products on a shelf photo; copies a supplier's bill off a photo | `generate.ts` |
| segment | `sam`, `sam-3.1` | finds every unit of one product on the shelf photo; the count is the number of matches | `providers/meta-sam.ts` |
| voice | `muse-voice`, `muse-voice-transcribe-1.0` | speech to text, Hindi and English | `providers/meta-voice.ts` |
| narrate | `spark-open`, `meta-models/muse-spark-open-1026` on Baseten | writes the short answer, citing stored cells by handle | `generate.ts` (Chat Completions) |
| speak | `bulbul-v3` (Sarvam) | reads a checked answer or the brief aloud. Meta has no text-to-speech model, so this is Sarvam's on both editions | `providers/sarvam-speak.ts` |

The models never do arithmetic, and they never see a tenant id or a database id. They see handles such as `item:1`.
Model text is checked by the cite-or-abstain validator (`packages/agent/src/answer.ts`, `words.ts`). An answer with a
free number is refused, and the screen says "Cannot verify".

**Llama.** No Llama model is wired. The Meta models in the build are the four above, and Muse Spark Open is the
open-weights one.

### Meta first, then fallback (D-077)

- **Order.** On the meta edition, a run's chain keeps Meta-hosted models (Meta's API and Muse Spark Open on Baseten)
  ahead of every other provider (`metaFirst` in `config.ts`).
- **Missing key.** In live mode with `META_MODEL_API_KEY` unset, a call moves to the next allowed model that has a key
  (`keyedBinding`). On a run's chain, an error from Meta moves it on the same way.
- **What the edition may fall back to.** Gemini, Anthropic, OpenAI, OpenRouter, NVIDIA and Sarvam, each behind Meta's
  own models.
- **Voice** falls back to Sarvam's `saaras-v4`.
- **Segment** has no other adapter. Without Meta's key the shelf count marks items as uncounted instead of guessing.

### What works on Gemini until the Meta keys arrive

Set `MUNSHI_MODEL_MODE=live` and `GEMINI_API_KEY`, and leave `META_MODEL_API_KEY` unset.

| Feature | Without Meta's key |
|---|---|
| Ask (typed), the morning brief, Why?, campaign copy, inbox reply and order drafts | router, reason and narrate move to Gemini |
| Reading a supplier's bill from a photo | vision moves to Gemini. A PDF bill goes to Sarvam Vision (`SARVAM_API_KEY`) on either edition |
| Ask by voice | moves to Sarvam's `saaras-v4` (`SARVAM_API_KEY`) |
| Read-aloud | Sarvam's Bulbul (`SARVAM_API_KEY`), as with Meta's key |
| Shelf count from a photo | needs SAM 3.1. Without it, items show as uncounted |

**Gemini's evidence.** `docs/model-probe-2026-10-31.md` records a live probe on 31 Oct, in which Gemini models passed
text, a tool call, a JSON schema and an image. Gemini has not been run live through the whole app flow in this
repository.

In recorded mode (the default), none of this applies. The edition's own (Meta) bindings are replayed from fixtures, and
no provider is called.

### Before the Meta keys go live

1. Set `META_MODEL_API_KEY` and, for narrate, `BASETEN_API_KEY`.
2. Run `pnpm --filter @munshi/ai smoke` (`scripts/meta-smoke.ts`). It makes one real call per Meta model.
3. Run `pnpm --filter @munshi/agent hero-smoke` (`scripts/hero-smoke.ts`). It runs the shelf, bill and voice chain once.
4. Record new fixtures with `MUNSHI_MODEL_MODE=record`.

Some request and response shapes are marked `UNVERIFIED` in the adapters. They include:

- SAM's response parsing;
- the voice response field;
- whether Baseten accepts the narrate request.

Each needs a first live call to confirm. See `docs/LIMITATIONS.md`.

### Not built

- **D-081's capability routing:** models declaring capabilities, and the `document` and `video` roles in
  `packages/ai`.
- **The shelf walk-through video counted by Muse Spark Open.** The `shelf_video` desk exists in the schema, but has no
  agent code.

## Meta's channels: WhatsApp and Instagram

| | WhatsApp Cloud API | Instagram |
|---|---|---|
| **Adapter** | `packages/adapters/channels/whatsapp.ts` | `packages/adapters/channels/instagram.ts` |
| **Outbound** | Approved messages: credit reminders, campaign sends, package-expiry reminders. Outside the 24-hour window, only an approved template with its known wording is sent | An approved campaign's post (image and caption) |
| **Inbound** | `/api/webhooks/whatsapp`: `X-Hub-Signature-256` is checked over the raw body. Messages and statuses are stored as ops rows, for a number a shop listed. No book row and no model call | `/api/webhooks/instagram`: the signature is checked, but events are not stored yet, and the route answers 503 |
| **Settings** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `MUNSHI_PHONE_ROUTE_SECRET`, and the optional `WHATSAPP_TEMPLATE_*` | `INSTAGRAM_ACCOUNT_REF`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN`, optional `INSTAGRAM_GRAPH_HOST` |

A real send needs all of the following. Otherwise the send is recorded: ids and body hashes go to the recorded outbox,
and the screen says so.

- the channel's settings;
- `MUNSHI_SEND_MODE=live`;
- a real shop the superadmin has accepted, not a sample shop;
- the superadmin's grant for that channel;
- a listed recipient.

All of these are re-checked at send time. Every outbound message is a draft first, and a person approves it.

**Not built:** downloading a WhatsApp voice note's media. In the inbox you attach the clip by hand, and the screen
labels it "Simulated".

## The "Built with Muse Spark Open" credit

Muse Spark Open's licence asks for a credit. The line "Built with Muse Spark Open" is shown on:

- the AI staff page (`apps/web/app/app/settings/ai/AiStaffView.tsx`);
- the public site's footer (`apps/web/components/site/SiteFoot.tsx`).

The component is `apps/web/components/pwa/MuseCredit.tsx`.

## A judge's walkthrough

These steps are written for `pnpm dev` (http://localhost:3000): the meta edition, in recorded mode, with no keys.

**On the hosted demo (`<hosted demo URL>`) the steps differ.**
- The hosted deploy's environment list (`deploy/vercel.md`) sets the paytm edition. There, the model defaults are
  Gemini and Sarvam, and the shelf count is hidden.
- The demo picker there leads with Bansal Super Mart, the paytm edition's shop.
- The recorded fixtures are Meta's. On the paytm edition in recorded mode, Ask finds no fixture and abstains
  (`apps/web/test/hero-ask.test.tsx`), so that deploy needs `MUNSHI_MODEL_MODE=live` with `GEMINI_API_KEY` for answers.
- This repository does not verify whether Sharma General Store exists on the hosted database.

**Recorded mode answers only the inputs it has fixtures for.** Use the committed synthetic samples in
`packages/agent/fixtures/media/`: `shelf.png`, `bill.png`, and `ask-en.wav` or `ask-hi.wav`. Any other photo or
recording gets "There is no recorded response for this."

1. **Landing page (`/`).** The split hero shows the isometric office. The footer carries "Built with Muse Spark Open".
2. **`/demo`, then Sharma General Store.** Sign in as the owner, Rajesh Sharma; no password is needed. Every shop is
   synthetic and says so.
3. **Home.**
   - The morning brief ranks findings planted in the seed: stock missing from the shelf, a supplier's price creeping
     up, overdue credit, a short settlement, goods near expiry.
   - Tap a figure to open its source drawer and **Why this number**.
   - Tap **Why?** on a finding for an explanation with sources, or **Draft the fix** for a draft that waits under
     "Waiting for you".
4. **Stock, shelf photo.** Upload `shelf.png`. Muse Spark names the products and SAM 3.1 counts the units
   (recorded). The count and the books are shown side by side, and a stock correction is drafted. Approve it, and it
   runs under your name.
5. **Bills, new.** Upload `bill.png`. Muse Spark reads the supplier's bill (recorded). Each figure carries its place on
   the photo, and a price above the last one paid is flagged. A purchase is drafted for approval.
6. **Ask.** In recorded mode the screen offers the questions that have recorded answers. To ask by voice, send
   `ask-en.wav` as a recording. Every number in the answer is a tappable cell, and a number that cannot be traced
   reads "Cannot verify".
7. **Office (`/app/office`).** The seven-name cast: Munshi, Tally, Ledger, Dash, Echo, Bloom, Keeper. Each card shows
   its runs as stored counts, and the run log opens each run step by step.
8. **Settings, AI staff.** The model each agent uses, by alias, and the Muse Spark Open credit.

Screens built on recorded answers say "Recorded response". Nothing on this walkthrough calls a Meta model live.
