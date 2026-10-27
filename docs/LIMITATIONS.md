# Limitations

What Munshi does not do, and where its guarantees are weaker than the headline. Written against the code at HEAD
(`6aa1fb2`, 27 Oct 2026). Where this page and the code disagree, the code wins.

## No live model has been called yet (TO-MEASURE)

No Meta Model API key existed when this was written. Every model turn in the repository is a **hand-written response
replayed from a fixture** (`packages/agent/fixtures/`, `apps/web/fixtures/`; `packages/agent/test/script.ts` explains how
they are made). They are not recordings of Meta's models. So:

- Whether Muse Spark routes, reads shelves and bills, and narrates within the validator's rules: **TO-MEASURE**.
- SAM 3.1 shelf counts on real kirana photos, and Muse Voice Transcribe accuracy on Hindi and English speech: **TO-MEASURE**.
- Request and response shapes follow Meta's captured API docs. Non-streaming parsing of the SAM response, the voice
  response field (`transcript`), and whether the narrate model on Baseten accepts the Chat Completions request, are
  marked `UNVERIFIED` in `packages/agent/src/providers/*.ts`. How a live provider takes a tool result is also unverified
  (`run.ts` sends it back as labelled text).
- The model ids in `packages/agent/src/config.ts` are the ones this project plans to use; none has been confirmed against
  a live `GET /v1/models`.
- `scripts/hero-smoke.ts` runs the whole chain live once and fails clearly without a key. It has not been run.
- The Paytm edition's role map is placeholders (`TODO-…` model ids, no Sarvam adapter). Only the switch is exercised.

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
(`meta-sam.ts` hashes at arrival) and a source-scan gate (H1), which does not see an alias through a variable. A
response signed by the provider would close it. A count also depends on the vision model naming the right noun phrase.
Loose goods (kg, g, l, ml) are never counted from a photo.

## What a photo's text is, and where it goes

- **A bill's item text is the model's reading, not a checked figure.** The text of each line ("Glucose biscuits 70 g") is
  copied by the vision model off the photo and shown as it was read, under a visible note that it is "not checked against
  your books". It can carry a digit the validator never saw. The figures beside it (quantity, price, date) are the checked
  ones: cells the server stored. A shelf photo's unrecognised product phrases have their digits stripped; a bill's item
  text is not stripped, because "70 g" is part of an item's name and stripping it would make the line unreadable.
- **A photo leaves the device.** It goes to the server for reading and, with a live model, on to Meta's models. Only its
  sha256 is stored (never the picture); what the model read is stored as evidence. The photo shown on screen is a local
  copy that is gone after a reload.
- **A repeat photo returns its waiting draft.** The same bytes (same sha256), for a bill the same supplier, return the
  draft still waiting instead of stacking another. A waiting draft whose evidence has since moved is returned too, and goes
  stale on approval.
- **The agent's finding state is read on the app's pool.** `finding` reads the finding and its cells as the read-only
  agent role, but its status and open-draft flag come from core's `findingState` on the app pool (a `system` scope),
  because the agent role has no grant on `ops.finding` or `approval.draft`. It writes nothing.
- **Trace timings ride in the trace label** ("read@12ms"): `ops.run_trace` has no timing column and migrations are
  append-only, so no migration was added for it.

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
  authentication for real shops.

## Scope of the product

- **Synthetic data only.** The demo shop is "Sharma General Store (synthetic)", generated by `db/seed/kirana.ts`. The
  sample photos and audio are drawn or generated for the project (the voice clips with macOS `say`). No real customer,
  supplier or shop is in the repository.
- **Suppliers are simulated** and labelled "Simulated supplier" on screen. Nothing is sent to a real supplier.
- **Payments are recorded, never processed.** Cash and UPI entries are bookkeeping rows; no money moves and no payment
  provider is called.
- Messages to customers and suppliers (`books.outbound_message`) exist as a table and an authority entry; core has no
  command that sends one yet, so overdue-credit and short-settlement findings have no drafted fix. Only a shelf shortage
  (`shrinkage`) gets a drafted reorder.
- One time zone and currency per shop (Asia/Kolkata, INR by default). One server process, no separate API service.
- The savings the findings point at are measured against the seeded answer key (`db/seed/kirana.answers.json`), on
  synthetic data. They are not a claim about any real shop.
- Recorded mode shows a visible "Recorded response" label on screens; live-mode screens have not been seen.
