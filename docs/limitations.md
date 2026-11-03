# Limitations

What Munshi does not do yet, and where its guarantees are weaker than the headline. Where this page and the code
disagree, the code wins.

## Live, recorded and simulated

| Part | Today |
|---|---|
| **Meta's models** | **Not yet called live** from this code. Every Meta turn in the repository is a hand-written response replayed through the real adapter path (`packages/agent/fixtures`, `apps/web/fixtures`), not a recording. The Meta model ids in [`packages/ai/src/models.ts`](../packages/ai/src/models.ts) have not been confirmed against a live call. `pnpm --filter @munshi/ai smoke` and `pnpm --filter @munshi/agent hero-smoke` make one live call per model and fail clearly without a key |
| **Other providers** | A live probe on 31 Oct 2026 ([model-probe-2026-10-31.md](model-probe-2026-10-31.md)) passed Gemini's three aliased models on text, a tool call, a JSON schema and an image, called directly; and, through Munshi's own adapters (calls recorded in `packages/ai/fixtures/probe`), the aliased Anthropic, OpenAI, OpenRouter and NVIDIA models in every text and image role, Sarvam's `sarvam-105b` for reason and narrate, and Saaras v4 on a Hindi voice clip. No live run of Sarvam's Bulbul (read-aloud) or its document reader is recorded. None of these has been run live through every app flow |
| **Shelf count from a photo** | Needs Meta's SAM 3.1: no other provider serves the segment role. Without Meta's key, items are marked uncounted |
| **Suppliers, surplus recipients** | Simulated, and labelled on screen. Nothing reaches a real supplier or recipient |
| **Payments** | Recorded, never processed. Cash and UPI entries are bookkeeping rows; the payments feed is simulated. PayPal is sandbox only; refunds and disputes are not handled |
| **WhatsApp, Instagram** | Recorded (ids and body hashes, nothing sent) unless every live condition holds: `MUNSHI_SEND_MODE=live`, the credentials, a real accepted shop, its channel grant and, on WhatsApp, a listed recipient. Instagram posting and Supabase Storage are tested against fake HTTP endpoints, not the live services. Downloading a WhatsApp voice note's media is not built: the inbox takes the clip by hand and labels it simulated |
| **Bot check** | Only the recorded verifier exists; no live challenge service is wired |
| **Data** | Synthetic only (below) |

**Unverified request shapes.** These follow the providers' published docs but have not met a live response; each is
marked `UNVERIFIED` in its adapter under [`packages/ai/src/providers`](../packages/ai/src/providers):

- SAM 3.1's response parsing (`meta-sam.ts`);
- Muse Voice Transcribe's response field (`meta-voice.ts`);
- the Chat Completions path in `generate.ts`, marked unverified for Baseten, Nebius, Gemini and OpenRouter. OpenRouter, NVIDIA and Sarvam have since passed through it in the probe; Gemini was probed directly, and Baseten (Muse Spark Open) has not been called;
- Sarvam's document parse output (`sarvam-docs.ts`).

How a live provider takes a tool result back is also unverified: the agent sends it as labelled text.

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
- **Hosted deployment.** The deploy tooling is tested offline; a complete hosted run is not yet recorded. See
  [deployment.md](deployment.md).
