# Munshi and Meta

This page covers how Munshi uses Meta's models (Muse Spark, SAM 3.1, Muse Voice Transcribe, Muse Spark Open) and
Meta's channels (WhatsApp and Instagram). It also says what runs today and what needs keys.

**The short version:**
- Every Meta model call in the repository is answered from a **hand-written recorded fixture**. No live Meta call has
  been made, because no Meta key existed while this was built.
- In live mode, a call without Meta's key moves to Gemini first, then to the other providers that have a key. Voice
  moves to Sarvam.
- WhatsApp and Instagram sends are built behind several switches. They stay recorded until a real shop is accepted and
  given a channel grant.

## Meta's models, through the provider layer

Agents ask for a role, never a model. `packages/ai/src/config.ts` maps each role to its default model alias
(`DEFAULT_ALIASES`): Meta's own models, with one exception for read-aloud. `packages/ai/src/models.ts` maps each alias
to a provider and model id. No provider name is stored in the database, and no provider-specific code lives outside
its adapter.

| Role | Alias, model id | What it does | Adapter |
|---|---|---|---|
| router | `muse-spark`, `muse-spark-1.3` | sends a question to the right desk (stock, sales, credit and so on) | `providers/generate.ts` (Responses API) |
| reason | `muse-spark` | the desk's tool loop: picks named reads | `generate.ts` |
| vision | `muse-spark` | names products on a shelf photo; copies a supplier's bill off a photo | `generate.ts` |
| segment | `sam`, `sam-3.1` | finds every unit of one product on the shelf photo; the count is the number of matches | `providers/meta-sam.ts` |
| voice | `muse-voice`, `muse-voice-transcribe-1.0` | speech to text, Hindi and English | `providers/meta-voice.ts` |
| narrate | `spark-open`, `meta-models/muse-spark-open-1026` on Baseten | writes the short answer, citing stored cells by handle | `generate.ts` (Chat Completions) |
| speak | `bulbul-v3` (Sarvam) | reads a checked answer or the brief aloud. Meta has no text-to-speech model, so this is Sarvam's | `providers/sarvam-speak.ts` |

The models never do arithmetic, and they never see a tenant id or a database id. They see handles such as `item:1`.
Model text is checked by the cite-or-abstain validator (`packages/agent/src/answer.ts`, `words.ts`). An answer with a
free number is refused, and the screen says "Cannot verify".

**Llama.** No Llama model is wired. The Meta models in the build are the four above, and Muse Spark Open is the
open-weights one.

### Meta first, then Gemini, then the rest

The reasoning is in [docs/decisions/0005-model-roles-meta-first.md](../decisions/0005-model-roles-meta-first.md).

- **Order.** A run's chain starts with the owner's pick, the shop's default and the build's default. After those it
  keeps Meta-hosted models (Meta's API and Muse Spark Open on Baseten) first, Gemini's second, and every other
  provider's last (`fallbackOrder` in `config.ts`).
- **Missing key.** In live mode with `META_MODEL_API_KEY` unset, a call moves to the next allowed model that has a key
  (`keyedBinding`). On a run's chain, an error from Meta moves it on the same way.
- **What a call may fall back to.** Gemini first; then Anthropic, OpenAI, OpenRouter, NVIDIA and Sarvam. Each is
  allowed only for the roles it passed a live probe in, and is used only when its key is set.
- **Voice** falls back to Sarvam's `saaras-v4`.
- **Segment** has no other adapter. Without Meta's key the shelf count marks items as uncounted instead of guessing.

### What works on Gemini until the Meta keys arrive

Set `MUNSHI_MODEL_MODE=live` and `GEMINI_API_KEY`, and leave `META_MODEL_API_KEY` unset.

| Feature | Without Meta's key |
|---|---|
| Ask (typed), the morning brief, Why?, campaign copy, inbox reply and order drafts | router, reason and narrate move to Gemini |
| Reading a supplier's bill from a photo | vision moves to Gemini. A PDF bill always goes to Sarvam Vision (`SARVAM_API_KEY`) |
| Ask by voice | moves to Sarvam's `saaras-v4` (`SARVAM_API_KEY`) |
| Read-aloud | Sarvam's Bulbul (`SARVAM_API_KEY`), as with Meta's key |
| Shelf count from a photo | needs SAM 3.1. Without it, items show as uncounted |

**Gemini's evidence.** `docs/model-probe-2026-10-31.md` records a live probe on 31 Oct, in which Gemini models passed
text, a tool call, a JSON schema and an image. Gemini has not been run live through the whole app flow in this
repository.

In recorded mode (the default), none of this applies. The default (Meta) bindings are replayed from fixtures, and no
provider is called.

### Before the Meta keys go live

1. Set `META_MODEL_API_KEY` and, for narrate, `BASETEN_API_KEY`.
2. Run `pnpm --filter @munshi/ai smoke` (`scripts/meta-smoke.ts`). It makes one real call per Meta model.
3. Run `pnpm --filter @munshi/agent hero-smoke` (`scripts/hero-smoke.ts`). It runs the shelf, bill and voice chain once.
4. Record new fixtures with `MUNSHI_MODEL_MODE=record`.

Some request and response shapes are marked `UNVERIFIED` in the adapters. They include:

- SAM's response parsing;
- the voice response field;
- whether Baseten accepts the narrate request.

Each needs a first live call to confirm. See [docs/limitations.md](../limitations.md).

### Not built

- **Capability routing:** models declaring what they can do, and `document` and `video` roles in `packages/ai`. A
  PDF bill is read by one fixed document reader (Sarvam Vision), outside the role chain.
- **The shelf walk-through video counted by Muse Spark Open.** The `shelf_video` desk exists in the schema, but has no
  agent code.

## Meta's channels: WhatsApp and Instagram

| | WhatsApp Cloud API | Instagram |
|---|---|---|
| **Adapter** | `packages/adapters/channels/whatsapp.ts` | `packages/adapters/channels/instagram.ts` |
| **Outbound** | Approved messages: credit reminders, campaign sends, package-expiry reminders. Outside the 24-hour window, only an approved template with its known wording is sent | An approved campaign's post (image and caption) |
| **Inbound** | `/api/webhooks/whatsapp`: `X-Hub-Signature-256` is checked over the raw body. Messages and statuses are stored as ops rows, for a number a shop listed. No book row and no model call | `/api/webhooks/instagram`: the signature is checked, then direct messages are stored as ops rows for the shop granted the account. No book row and no model call. See below |
| **Settings** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `MUNSHI_PHONE_ROUTE_SECRET`, and the optional `WHATSAPP_TEMPLATE_*` | `INSTAGRAM_ACCOUNT_REF`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN`, optional `INSTAGRAM_GRAPH_HOST` |

A real send needs all of the following. Otherwise the send is recorded: ids and body hashes go to the recorded outbox,
and the screen says so.

- the channel's settings;
- `MUNSHI_SEND_MODE=live`;
- a real shop the superadmin has accepted, not a sample shop;
- the superadmin's grant for that channel;
- on WhatsApp, a listed recipient (an Instagram post has none; it also needs its card served, below).

All of these are re-checked at send time. Every outbound message is a draft first, and a person approves it.

### Instagram, with and without keys

**Without the `INSTAGRAM_*` settings** (every demo, and the default):
- `/api/webhooks/instagram` answers 404 to everything.
- An approved Instagram post never reaches Meta. On a sample shop, or a shop without the grant, it is recorded: its id
  and body hash go to the recorded outbox. On a granted real shop it waits and lapses unposted.
- The inbox, campaigns and settings screens say "Recorded · nothing is sent", with the reason.

**With the settings, on a real shop the superadmin accepted and granted Instagram (the grant names
`INSTAGRAM_ACCOUNT_REF`):**
- **Inbound.**
  - Meta's subscription check is answered with the verify token.
  - A POST is read only when its `X-Hub-Signature-256` matches `INSTAGRAM_APP_SECRET`. Anything else gets an empty 404.
  - Each direct message to `INSTAGRAM_BUSINESS_ACCOUNT_ID` is stored once per Meta message id, as an inbox row of the
    one shop whose latest grant names the account. The row carries the sender's Instagram-scoped id, never a username.
  - The database refuses a row for any other shop. A shop the sign-up purge removed no longer counts, even though its
    old grant row is left behind.
  - An account no shop holds gets the same 200 with counts, and nothing is stored. The answer never says which shops
    exist.
  - If storing fails (the database is unreachable, or it refuses a grant that changed meanwhile), the answer is an
    empty 500, never a 200, so Meta delivers the event again.
  - On Instagram, "STOP" is an ordinary message. Nothing is ever sent to a person there.
  - Comments on the shop's posts are parsed but not stored, because the inbox cannot mark a comment apart from a message.
- **The picture (the card).** While an Instagram campaign is composing, an owner or a manager attaches a JPEG or PNG
  photo on `/app/campaigns`. The browser first scales it down (longest side at most 1440 px) and makes it a JPEG
  through a canvas. A picture still over 4 MB is not sent, and the screen says why. The server refuses any upload
  over 4 MB, since a deployed function on Vercel takes at most a 4.5 MB request. The server tells the type from
  the file's first bytes and from what it decodes; anything but a JPEG or PNG is refused with its reason. It then writes
  the picture again as a JPEG that Instagram accepts (sharp):
  - turned upright;
  - cropped about its centre to between 4:5 and 1.91:1, with the height rounded to whole pixels toward the inside of
    that range;
  - 320 to 1440 pixels wide;
  - transparency set on white;
  - metadata (a phone's location among it) dropped.

  The JPEG goes to the media store, with a `card` document holding its sha256. The owner or manager can replace or
  remove it until the campaign is proposed; after that the database freezes it. Staff can do none of this. The same
  picture attached again reuses its card, and is written back if the store lost it. A picture whose card was erased
  cannot be attached again, and the screen says so.
- **The approval covers the picture.** An Instagram campaign with no picture, or whose picture was erased,
  cannot be proposed ("Attach a picture first"). Proposing locks the campaign, so it waits for an attach in flight, and
  binds the card's id and sha256 into the `campaign.post` draft. The approval checks both again: a card replaced or
  removed since the proposal makes the draft stale, and nothing is posted. The approver sees the bound card as a thumbnail on the campaign line, served by a private,
  uncached route to the shop's owner and managers only.
- **Posting.** An approved campaign's post goes through the same outbox claim as WhatsApp. The claim is committed
  before Meta is called, and the grant is checked again at send time. Meta then gets:
  - the address of the card the approved draft bound, `MUNSHI_APP_URL/api/cards/<shop>/<card>.jpg`. That address
    serves the JPEG only while an approved Instagram campaign of that shop names it, and only if the stored bytes
    still match the document's sha256. It counts each caller's IP against the public API's read limit;
  - the approved draft's words, exactly, as the caption.
- **The media store.**
  - `SUPABASE_STORAGE_BUCKET`, with `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, puts the cards in that private Supabase
    Storage bucket. The app reads them back with the secret key, which stays on the server.
  - Without a bucket, a process that is not hosted (no `VERCEL_REGION`) keeps them in the folder `MUNSHI_MEDIA_DIR`
    names; `pnpm dev` sets it to `.run/media`. With neither, there is no store.
  - A hosted deploy without a bucket has no store. There, the composer says no picture can be attached and the post
    waits.
- **What a live post needs.** Meta fetches the picture from the app, so `MUNSHI_APP_URL` must be https. Until it is,
  and until a store is wired, no Instagram sender is wired. An approved post then waits and lapses unposted, and the
  screens give the reason (`no_card`). Local `pnpm dev` runs on http://localhost, so there a post is only recorded,
  and the screens say so. As a defence behind the proposal's check, a post whose card is gone at send time fails
  without calling Meta.
- **Tested in recorded mode, not against Meta.** The whole path is tested with a fake Graph endpoint: attach, propose,
  approve, the outbox claim, then the Graph call with the card's address and the exact caption, and that address
  serving the stored bytes. Supabase Storage is tested only against a fake HTTP server shaped like its REST API, not
  against a live project.

**Not built:** downloading a WhatsApp voice note's media. In the inbox you attach the clip by hand, and the screen
labels it "Simulated".

## The "Built with Muse Spark Open" credit

Muse Spark Open's licence asks for a credit. The line "Built with Muse Spark Open" is shown on:

- the AI staff page (`apps/web/app/app/settings/ai/AiStaffView.tsx`);
- the public site's footer (`apps/web/components/site/SiteFoot.tsx`).

The component is `apps/web/components/pwa/MuseCredit.tsx`.

## The operators' console

The platform operators' console is `/platform`, on the same site as the app. Nothing on the site links to it, and every
`/platform` response asks not to be indexed. Its sign-in asks for an operator's email, password and a six-digit code
from an authenticator app (TOTP); a wrong answer of any kind reads the same one line, and every other `/platform` page
answers 404 without an operator session. From there an operator accepts a real shop, grants it a channel (the Instagram
grant names the account), and sets the model allow-list, defaults and budgets. Nothing there applies on its own: each
setting is a proposal that a later request approves, and adding an operator is approved only from the command line. The
details are in `deploy/vercel.md`, "The superadmin console".

## A judge's walkthrough

These steps are written for `pnpm dev` (http://localhost:3000), in recorded mode, with no keys.

**On the hosted demo (`<hosted demo URL>`).**
- It runs the same build, with the same model defaults. Whether it answers from recordings or live is the deployment's
  `MUNSHI_MODEL_MODE` (`deploy/vercel.md`). In recorded mode the samples below should apply unchanged; that is not
  verified on the hosted deployment.
- The demo picker lists several sample shops. Open Sharma General Store, whichever card comes first.
- This repository does not verify which shops exist on the hosted database.

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
