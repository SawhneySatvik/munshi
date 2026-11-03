# Limitations

What Munshi does not do, and where its guarantees are weaker than the headline. Written against the code at
`c30c079` (3 Nov 2026). Where this page and the code disagree, the code wins.

## What is live, and what is recorded or simulated

| Part | Today |
|---|---|
| Meta's models | **Not called live.** The keys wait on the founder. Every Meta turn in the repository is a hand-written response replayed from a fixture (`packages/agent/fixtures/`, `apps/web/fixtures/`; `packages/agent/test/script.ts`), not a recording of Meta's models |
| Live intelligence | Until the Meta keys arrive: **Gemini** for text and images (router, reason, vision, narrate), **Sarvam** for voice, read-aloud and PDF bills. That is the paytm edition's default, and the meta edition's fallback when no Meta key is set (D-077); read-aloud and PDF bills are Sarvam's on both editions. Gemini, Anthropic, OpenAI, OpenRouter, NVIDIA and Sarvam passed live probes on 31 Oct (`docs/model-probe-2026-10-31.md`; the others' calls recorded in `packages/ai/fixtures/probe/`) |
| Shelf count from a photo | Needs Meta's SAM: no other provider serves the segment role. Hidden on the paytm edition; on the meta edition a live call without the key fails by name (recorded mode replays the hand-written fixture) |
| Suppliers, surplus recipients | **Simulated**, labelled on screen. Nothing reaches a real supplier or recipient |
| Payments | **Recorded, never processed**: cash and UPI entries are bookkeeping rows; the payments feed is simulated and labelled. PayPal is sandbox only (in progress): a payment link is an approved draft, and a paid notification becomes a finding a person records |
| WhatsApp, Instagram | **Recorded** (written to the outbox, nothing sent) unless all hold: `MUNSHI_SEND_MODE=live`, the channel's credentials, a real shop the operator accepted, its approved grant, and a listed recipient. So: recorded until the founder supplies channel keys and the operator grants a real shop |
| Data | Synthetic only (below) |

Model caveats (**TO-MEASURE** until a Meta key exists):

- Whether Muse Spark routes, reads shelves and bills, and narrates within the validator's rules; SAM 3.1 shelf counts on
  real kirana photos; Muse Voice Transcribe accuracy on Hindi and English speech.
- Meta's request and response shapes follow its captured API docs. The SAM response parsing, the voice response field
  (`transcript`) and the Chat Completions path for providers other than Meta are marked `UNVERIFIED` in
  `packages/ai/src/providers/*.ts`. How a live provider takes a tool result is also unverified (`run.ts` sends it back
  as labelled text).
- The Meta model ids in `packages/ai/src/models.ts` have not been confirmed against a live call.
  `pnpm --filter @munshi/ai smoke` and `pnpm --filter @munshi/agent hero-smoke` run them live and fail clearly without a
  key; neither has run against Meta.

## Cite-or-abstain is a filter, and it errs towards refusing

The validator (`packages/agent/src/answer.ts`, word lists in `words.ts`) refuses model prose that could carry a number
the model typed. It cannot prove prose is *true*; it proves that every number shown came from a cell.

- It reads English and Hindi (Devanagari, and romanised Hindi against fixed lists). A letter from any other script makes
  the whole answer "Cannot verify". The word lists are finite; a number word in a form they do not list would pass.
- Ambiguous words (do, teen, tin, char, sat, bees, tees, couple, score, trio, lone letters, एक, दो) count as numbers only
  in a quantity context, a heuristic about neighbouring words. A sentence that reads as ordinary but has a homograph in
  a quantity-like position is refused: `packages/agent/test/corpus/dropped.jsonl` lists 18 such sentences, each with its
  reason, that stay refused on purpose because letting them pass would open a hole. The reverse risk is a quantity
  phrase the heuristic does not recognise.
- The precision corpus is 199 clean sentences (0 abstain) and 157 attacks (all refused), written by the same author as
  the rules. It was measured on those sentences only; real model output may differ.
- A cell can be cited honestly and still answer the wrong question. The validator checks that the cell exists, belongs
  to this run and tenant, and is not an id or a name used as a number; it does not check relevance.

## The shelf-count hash binds the stored response to itself

`ops.shelf_count` stores the segment model's raw response, its sha256 and the number of boxes. The database refuses a
response edited after hashing and a count that is not that response's box count. It cannot tell whether the text is what
the segment model returned: whoever calls `recordShelfCount` supplies both. The calling path is held by the adapter
(`packages/ai/src/providers/meta-sam.ts` hashes at arrival) and a source-scan gate (H1), which does not see an alias
through a variable. A response signed by the provider would close it. A count also depends on the vision model naming
the right noun phrase. Loose goods (kg, g, l, ml) are never counted from a photo.

## What a photo's text is, and where it goes

- **A bill's item text is the model's reading, not a checked figure.** The text of each line ("Glucose biscuits 70 g") is
  copied by the vision model off the photo and shown as it was read, under a visible note that it is "not checked against
  your books". It can carry a digit the validator never saw. The figures beside it (quantity, price, date) are the checked
  ones: cells the server stored. A shelf photo's unrecognised product phrases have their digits stripped; a bill's item
  text is not stripped, because "70 g" is part of an item's name and stripping it would make the line unreadable.
- **A photo leaves the device.** It goes to the server for reading and, with a live model, on to the configured
  provider (Meta's, or Gemini until the Meta keys arrive; a PDF bill goes to Sarvam). Only its sha256 is stored (never
  the picture); what the model read is stored as evidence. The photo shown on screen is a local copy that is gone after
  a reload.
- **A repeat photo returns its waiting draft.** The same bytes (same sha256), for a bill the same supplier, return the
  draft still waiting instead of stacking another. A waiting draft whose evidence has since moved is returned too, and goes
  stale on approval.
- **The agent's finding state is read on the app's pool.** `finding` reads the finding and its cells as the read-only
  agent role, but its status and open-draft flag come from core's `findingState` on the app pool (a `system` scope),
  because the agent role has no grant on `ai.finding` or `approval.draft`. It writes nothing.

## The books, the audit chain and the actor

- The book guard trusts `munshi.actor_id` from the app: the database cannot see who is at the keyboard. It is set in one
  place from the signed session (gate B3 scans for any other); a compromised app server could set it.
- The audit chain is unkeyed. Anyone who can rewrite the table as `munshi_owner` or a superuser can re-hash it and it
  will verify. `verify_chain` cannot detect removal of the newest rows. The plan is to publish the chain head outside the
  database at deploy; that is not done.
- Core's reversal commands write opposite amounts; the database does not check a reversal mirrors its original.
- Audit appends are serialised per tenant by an advisory lock: fine for one shop, a hot tenant would queue. Any role can
  take advisory locks, so the agent role could stall a tenant's appends (a stall, not a write).
- The demo sign-in is an HMAC-signed cookie that lists the demo shop's members for anyone to pick. It is a demo, not
  authentication for real shops. A real shop signs up with a password; on a hosted or live deployment only through a
  verified email (Supabase Auth sends the link), and it waits until the operator accepts it; a sign-up not accepted in
  14 days is purged.

## Scope of the product

- **Synthetic data only.** The sample shops (Sharma General Store, Bansal Super Mart, Elite Unisex Salon & Academy,
  Prabhave) are generated by `db/seed/`. The sample photos and audio are drawn or generated for the project (the voice
  clips with macOS `say`). No real customer, supplier or shop is in the repository.
- Sign-up offers three shop kinds: kirana, salon and apparel. Restaurants are intended, not built.
- "Draft the fix" has a recipe for four finding kinds: a shelf shortage (a reorder), overdue credit (a reminder), an
  expiring package (a reminder, or expiring it) and an expiring lot (Offer it, a gift to a simulated recipient). Any
  other finding, such as a short settlement, is explained only.
- Keeper's notes (memory from decisions) reach a prompt only with a live model; recorded mode never uses them.
- Offline, the installed app shows only a read-only view of the last Home and stock list; nothing can be recorded
  offline.
- Counter staff see the counter, credit and stock only (D-082); everything else is the owner's and a manager's.
- One time zone and currency per shop (Asia/Kolkata, INR by default). One server process, no separate API service.
- The savings the findings point at are measured against the seeded answer key (`db/seed/kirana.answers.json`), on
  synthetic data. They are not a claim about any real shop.
- Recorded mode shows a visible "Recorded response" label on screens; live-mode screens have not been seen.
