# Limitations

What Munshi does not do yet, and where its guarantees are weaker than the headline. Where this page and the code
disagree, the code wins.

## Live, recorded and simulated

| Part | Today |
|---|---|
| **Meta's models** | The default for every role but read-aloud ([`packages/ai/src/config.ts`](../packages/ai/src/config.ts)). In live mode Munshi calls Meta's API for Muse Spark (router, reason, vision), SAM 3.1 (shelf count) and Muse Voice Transcribe, and Muse Spark Open (narrate) on Baseten or, without a Baseten key, OpenRouter; the hosted demo runs live. The adapters read Meta's live replies: the commentary message that comes with a tool call is skipped, and SAM's box fields, confidence included, are read by name. Short writing (Ask's calls, campaign copy, an order drafted from a message) asks for low reasoning effort. In recorded mode and in tests, Meta turns are answered from hand-written fixtures (`packages/agent/fixtures`, `apps/web/fixtures`) through the same adapter path. `pnpm --filter @munshi/ai smoke` and `pnpm --filter @munshi/agent hero-smoke` make one live call per model and fail clearly without a key |
| **Other providers** | Gemini is the first fallback after Meta. A model is listed in [`packages/ai/src/models.ts`](../packages/ai/src/models.ts) only for the roles it passed a live probe in ([model-probe-2026-10-31.md](model-probe-2026-10-31.md)): Gemini's three aliased models on text, a tool call, a JSON schema and an image, called directly; and, through Munshi's own adapters (calls recorded in `packages/ai/fixtures/probe`), the aliased Anthropic, OpenAI, OpenRouter and NVIDIA models in every text and image role, Sarvam's `sarvam-105b` for reason and narrate, and Saaras v4 on a Hindi voice clip. Sarvam's Bulbul reads answers aloud, and its document reader reads PDF bills |
| **Shelf count from a photo** | Needs Meta's SAM 3.1: no other provider serves the segment role. Without Meta's key, items are marked uncounted |
| **Suppliers, surplus recipients** | Simulated, and labelled on screen. Nothing reaches a real supplier or recipient |
| **Payments** | Recorded, never processed. Cash and UPI entries are bookkeeping rows; the payments feed is simulated. PayPal is sandbox only: with sandbox keys (as on the hosted demo) Munshi makes real sandbox invoices, and without them the PayPal steps run recorded and say so. `PAYPAL_SANDBOX_CURRENCY=INR:USD` asks a sandbox merchant that refuses rupees for the same digits in US dollars, says so in the invoice's note, and keeps the books in rupees. Refunds and disputes are not handled |
| **WhatsApp, Instagram** | Recorded (ids and body hashes, nothing sent) unless every live condition holds: `MUNSHI_SEND_MODE=live`, the credentials, a real accepted shop, its channel grant and, on WhatsApp, a listed recipient. Instagram posting and Supabase Storage are tested against fake HTTP endpoints shaped like the live APIs. Downloading a WhatsApp voice note's media is not built: the inbox takes the clip by hand and labels it simulated |
| **Bot check** | Only the recorded verifier exists; no live challenge service is wired |
| **Data** | Synthetic only (below) |

**Tool results.** The adapters have no tool-result message: the agent sends a tool's result back to the model as
labelled text ([`packages/agent/src/run.ts`](../packages/agent/src/run.ts)).

## Cite-or-abstain is a filter, and it errs toward refusing

The validator ([`packages/agent/src/answer.ts`](../packages/agent/src/answer.ts), word lists in `words.ts`) refuses
model prose that could carry a number the model typed. It proves that every number shown came from a cell; it cannot
prove the prose is true.

- It reads English and Hindi (Devanagari, and romanised Hindi against fixed lists). A letter from any other script
  makes the whole answer "Cannot verify". The word lists are finite; a number word in a form they do not list would
  pass.
- Ambiguous words (for example "do", "teen", "tin", "sat", "couple", "score") count as numbers only in a quantity
  context, a heuristic about neighbouring words. Some ordinary sentences are refused on purpose
  ([`packages/agent/test/corpus/dropped.jsonl`](../packages/agent/test/corpus/dropped.jsonl) lists them with reasons);
  the reverse risk is a quantity phrase the heuristic does not recognise.
- The precision corpus was written by the same author as the rules and measured on those sentences only. Real model
  output may differ.
- A cell can be cited honestly and still answer the wrong question. The validator checks that the cell exists, belongs
  to this run and shop, and is not an id or a name used as a number; it does not check relevance.

## Photos

- **A bill's item text is the model's reading, not a checked figure.** Each line's text ("Glucose biscuits 70 g") is
  copied by the vision model and shown as read, under a note that it is not checked against the books. The figures
  beside it (quantity, price, date) are cells. A bill's item text keeps its digits, because "70 g" is part of a name.
- **A photo leaves the device** when a live model reads it: it goes to the configured provider (a PDF bill to Sarvam).
  Only its sha256 and what the model read are stored, never the picture.
- **The shelf-count hash binds the stored response to itself.** The database refuses a stored response edited after
  hashing and a count that is not that response's number of boxes, but it cannot tell whether the text is what the
  model returned: whoever stores the count supplies both. The calling path is held by the adapter (which hashes on
  arrival) and a source scan, which does not see an alias through a variable. A count also depends on the vision model
  naming the right product. Loose goods (kg, g, l, ml) are never counted from a photo.

## The books and the audit chain

- The book guard trusts the acting-member setting from the app; the database cannot see who is at the keyboard. It is
  set in one place, from the signed session, and a source scan holds that. A compromised app server could set it.
- The audit chain is unkeyed: whoever can rewrite the table as the owner role or a superuser can re-hash it, and it will
  verify. `verify_chain` cannot detect removal of the newest entries. Publishing the chain head outside the database is
  planned, not done.
- Audit appends are serialised per shop by an advisory lock: fine for one shop, a busy one would queue. Any role can
  take advisory locks, so the agent role could stall a shop's appends (a stall, not a write).

More on security residuals: [security.md](security.md#residual-risks).

## Scope

- **Synthetic data only.** The sample shops are generated by [`db/seed`](../db/seed). Sample photos and audio were made
  for the project (the voice clips with a text-to-speech tool). No real customer, supplier or shop is in the
  repository, and no real shop has used Munshi.
- **Shop kinds.** Sign-up offers kirana, salon and apparel. Restaurants are intended, not built.
- **Draft the fix** has a recipe for five finding kinds: a shelf shortage, overdue credit, an expiring package, an
  expiring lot and an unrecorded PayPal payment. Any other finding, such as a short settlement, is explained only.
- **Memory** notes reach a prompt only with a live model; recorded mode never uses them.
- **Offline**, the installed app shows a read-only view of the last Home and stock list; nothing can be recorded.
- **Counter staff** see the counter, the credit book and stock only.
- **One time zone and currency per shop** (Asia/Kolkata and INR by default). One server process.
- **Caching** covers only the public site's reads; screen reads are not cached yet. The Redis adapter does not speak
  TLS.
- **The API** serves the published site (catalogue, services, offers, packages, slots, bookings, orders, holds,
  enquiries). The `/findings` and `/drafts` endpoints are reserved and answer 404.
- **Savings** the findings point at are measured against the seeded answer key
  ([`db/seed/kirana.answers.json`](../db/seed/kirana.answers.json)), on synthetic data. They are not a claim about any
  real shop.
- **Hosted deployment.** The hosted demo, https://munshi-sable.vercel.app, runs on Vercel with its database on
  Supabase. [`render.yaml`](../render.yaml) defines the 10-minute jobs tick and the chat relay for Render. See
  [deployment.md](deployment.md) and [deploy-render.md](deploy-render.md).
