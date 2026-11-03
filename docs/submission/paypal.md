# Munshi and PayPal

Munshi uses PayPal to collect money a shop is owed. Its agents notice overdue udhaar (store credit) and offer a PayPal
payment link as one of two fixes. A named person approves each link before it is made. Munshi then drafts the
WhatsApp message carrying the link, and a person approves that message, its words in full, before it goes. When PayPal
reports the link paid, a watcher raises it, and a person approves recording that payment in the books.

**Sandbox only. Munshi never moves money.** PayPal holds and moves the money. Munshi asks PayPal to create an invoice,
reads its status back, and stores PayPal's paid notification. `PAYPAL_ENV` may only be `sandbox`, and no live PayPal
endpoint is wired. Every PayPal surface says "PayPal sandbox" and "Munshi never moves money".

## Status: live in the app

- **Registered.** Core's registries hold the PayPal commands and reads: `commands.ts` spreads `PAYPAL_COMMANDS` and
  `queries.ts` spreads `PAYPAL_QUERIES`. `paypalReady()` is true on any database built from `db/schema`.
- **Tests use the real registry.** No test registers the PayPal commands on its own.
- **Watcher.** It is scheduled (`watch.paypal_unrecorded`, kind `paypal_unrecorded`, on the credit capability).
- **The agent offers the link.** An overdue-credit finding offers "Send a PayPal link" beside the reminder, on Home's
  overdue card and on the office brief.

## The code

| Part | File |
|---|---|
| The PayPal adapter: OAuth, invoices, cancel, webhook verification, recorded mode | `packages/adapters/payments/paypal.ts` |
| The two draft-only commands, `paypal.request` and `paypal.cancel` | `packages/core/src/commands-paypal.ts` |
| Proposals, the webhook's store, "record this payment", the link's WhatsApp message, the page's reads | `packages/core/src/payments-paypal.ts` |
| The `paypal_link` message template (a `customer.remind` template) | `packages/core/src/commands-messaging.ts` |
| The sweep that takes approved links to PayPal | `packages/core/src/jobs-paypal.ts` |
| The named reads (`invoice.open_credit`, `paypal.event`, `watch.paypal_unrecorded`) | `packages/core/src/queries-paypal.ts` |
| The recipes: overdue credit's second fix (a PayPal link) and "record this payment" | `packages/agent/src/recipes.ts` |
| The webhook route | `apps/web/app/api/webhooks/paypal/route.ts` |
| After a link's approval: the sweep, then the message's draft | `apps/web/lib/server/paypal-deliver.ts` |
| The screens | `apps/web/components/PayPalLink.tsx` (credit book and invoices), `TrayCard.tsx` (Home's tray), `FindingMoves.tsx` (the fix) |
| The demo data | `db/seed/kirana-paypal.ts`, run by `pnpm dev` and the hosted reseed after the kirana seed |
| The tables: `ops.paypal_link`, `ops.paypal_route`, `ops.payment_event` | `db/schema/24_paypal.sql` |
| Tests | `db/test/v2/core/paypal/paypal.test.ts` (PAYPAL0 to PAYPAL10), `db/test/v2/core/paypal/paypal-app.test.ts` (PP-APP1 to 5, PP-APP7 to 10), `apps/web/test/paypal-app.test.tsx` (PP-APP3, PP-APP6, the judge script, pending, recorded), `apps/web/test/paypal*.test.tsx`, `packages/adapters/test/paypal.test.ts`, `packages/config/test/paypal.test.ts` |
| Red-proofs | `db/test/v2/sabotage/paypal.ts`, `db/test/v2/sabotage/paypal-app.ts` |

## The flow

### 1. A PayPal link is proposed

There are two ways to start one:

- **The agent proposes it.** The overdue-credit watcher raises a finding.
  - The finding offers two fixes: **Draft the fix** (a reminder) and **Send a PayPal link** (labelled PayPal sandbox).
  - Either is a fixed recipe, not a model.
  - The PayPal fix drafts `paypal.request`. Its amount is a reference to the customer's current `credit.balance` cell. It
    also cites the finding's own overdue cell (PP-APP1).
- **A person proposes it.** On the credit book (`/app/credit`) or an invoice, the owner or a manager taps **Send PayPal
  link**.

Rules that apply either way:

- **The amount is a stored cell, never a typed number.** A typed amount is refused, and so is a figure that is not
  this customer's balance (PAYPAL3, PP-APP5). An invoice's link asks for the sale's open credit (`invoice.open_credit`).
- **One live link per customer.** A second link is refused while one is queued, sent and unpaid, or being cancelled
  (PAYPAL7).
- **Not while a payment is unrecorded.** A new link is refused while PayPal reports the customer's link paid and the
  books do not show that payment yet (PP-APP4).
  - The hold lifts as soon as the books catch up: a payment recorded by PayPal's reference, or any payment from the
    customer recorded after PayPal's notice, whatever its method (PP-APP9). No customer is held back for good.
  - The Home card's PayPal fix skips such customers, and customers with a live link or a link draft waiting, and says
    so: "PayPal links drafted for some; skipped customers who have a live link, or a paid one the books do not show
    yet".
- **The office's alone.** Only a role allowed to decide a link may ask for one. Counter staff are refused, whatever
  path they take (PP-APP3).
- **Nothing happens yet.** Proposing writes no book row, no link and no message, and calls no PayPal (PP-APP1).

### 2. A person approves

- **Where the draft waits.** It is in Home's tray and on the customer's row in the credit book.
- **What the card shows.**
  - "Ask the customer to pay the amount by PayPal" (for an invoice's link: "… still owed on a bill by PayPal").
  - The amount is a source chip on the very cell the draft cites ("Credit balance", or "Still owed on the bill").
  - The card also shows the customer's name, the PayPal sticker and "Munshi never moves money".
  - **Recorded mode is said where the person decides.** Without the sandbox keys, the sticker reads "PayPal sandbox
    (recorded: sandbox keys not set, nothing is sent to PayPal)" and the card says "Approving records a PayPal link here
    only (sandbox keys not set: nothing is sent to PayPal)". It never claims to ask PayPal. The finding's **Send a
    PayPal link** fix carries the same recorded sticker.
- **Who can approve.** The owner or a manager. `decide()` runs under the approver's own session.
- **What approval writes.** In one transaction with its audit entry, it writes one `ops.paypal_link` row (status
  `queued`) under the approver. It writes no book row and makes no PayPal call (PP-APP2, PAYPAL1).
- **If the books moved.** If the balance the draft cites has changed since, the draft goes stale and nothing is done
  (PAYPAL8).

### 3. The link is made on PayPal

- **When.** After the approval commits, the same request runs the jobs role's sweep for this shop alone. Any link left
  queued is picked up by the `paypal_links` job on the next jobs tick.
- **The PayPal calls.** The draft's id is PayPal's request id. The adapter searches for the invoice number, creates a
  draft invoice with one line ("Balance due"), and calls `/send` with `send_to_recipient: false`. PayPal never emails
  the customer.
- **Failures.** A failed call is retried, up to five attempts, and then the link is failed.
- **Cancelling.** **Cancel link** is a draft too (`paypal.cancel`).

### 4. The link reaches the customer on WhatsApp, as its own approved message

**The design.** The message is its own draft, approved on its own.

- Approving the link (step 2) is one decision. With the sandbox keys, the link card says: "Approving asks PayPal
  (sandbox) for a payment link; then Munshi drafts the WhatsApp message for you to approve". In recorded mode it says
  the link is recorded here only (above).
- Once PayPal has made the link, the same request proposes a `customer.remind` draft with the `paypal_link` template
  (`messagePaypalLink`), and nothing more. If PayPal has not made it yet, the credit book offers **Draft the WhatsApp
  message** on the made link later.
- **The message names its link.** Its payload carries the link's id (`linkId`), and its figure must be that link's own
  cited cell. The tray shows the words of that link, and approving sends that link's page.
  - If that link is no longer made and unpaid, the approval goes stale and nothing is sent.
  - A link cancelled and asked for again the same day may cite the very same balance cell. Its waiting message still
    never carries the new link, and the new link is its own to message (PP-APP8).
- The draft waits in Home's tray with its words in full, as its approval will write them, in English and Hindi on one
  line: the shop, the amount (a chip on the link's own cell), "PayPal (sandbox)", and the payer page (in recorded mode,
  the recorded id, said to be recorded). One function chooses those words for both the tray and the message
  (`paypalMessage`).
- **An invoice's link** gets its own words: "… is still due on a bill of yours" (Hindi: "आपके एक बिल पर … अभी बाक़ी
  है"), its amount the invoice's open credit (PP-APP10). The credit book offers **Draft the WhatsApp message** on
  invoice links too.
- Only a person's **Approve** on that card writes the message, as a book row under them, with its audit entry
  (PP-APP2). Until then nothing is written or delivered, and a draft no one approves simply stays proposed.
- The database's consent rule for `customer.remind` applies to this message as to any other reminder.

**The rules.**

- The customer's current contact must have given service consent on WhatsApp, and messaging must be on for the shop.
  Otherwise no message is drafted, and the screen says why: "share the link yourself".
- A link goes to its customer once. A second draft is not made while one waits, and a second message is refused once
  one went. Messages for one link are proposed and decided one at a time (advisory locks), so two approvals at once
  write one message and the other goes stale (PP-APP2).
- Counter staff may not draft or approve it (PP-APP3).
- The outbox delivers an approved message, recorded on a sample shop, until the shop's own WhatsApp channel is live.
- If a link's approval went through but its link could not be read back, the card says the approval is done and the
  link is pending: never an error over a completed approval. Only a PayPal link's approval shows that note.

### 5. PayPal's webhook stores a payment event

`/api/webhooks/paypal` accepts PayPal's `INVOICING.INVOICE.PAID`.

- **Checks before PayPal is asked.**
  - The body is capped.
  - The transmission headers must be well formed.
  - The transmission time must be within ten minutes.
- **Verification.** PayPal's `verify-webhook-signature` decides whether a notice is genuine.
- **What is stored.** Only a full payment, as one `ops.payment_event` per PayPal event id (PAYPAL4).
- **No book row and no draft.** The webhook has no person behind it (PP-APP4).

### 6. A person records the payment

- **The watcher.** `watch.paypal_unrecorded` is scheduled. A paid PayPal event that no live payment records becomes a
  `paypal_unrecorded` finding: "PayPal reports a payment the books do not show yet".
  - Its fix (or **Record this payment** on the link) drafts `payment.record` by PayPal.
  - The amount and date are the cells of PayPal's stored notice.
  - The draft cites the customer's current balance.
- **Approval.** Only a person's approval writes the payment (account `paypal_clearing`).
  - Counter staff may neither propose nor approve it, since it cites the office's `paypal.event` read.
  - The next watcher run resolves the finding (PP-APP4).
- **Other currencies.** A notice in another currency is never recorded or raised.

## What runs, and what needs keys

| Mode | When | What happens |
|---|---|---|
| Recorded (the default) | none of the three keys set | Steps 1 to 4 run. The link gets a `REC-…` id derived from the draft id and has no payer page. The screen says "PayPal sandbox (recorded: sandbox keys not set, nothing is sent to PayPal)". The webhook route answers 404, so step 5 comes only from the seeded demo notice (below), labelled on screen as a recorded demo. |
| Sandbox | all three keys set | Every step runs against `https://api-m.sandbox.paypal.com`. Steps 5 and 6 need PayPal to reach the webhook over public HTTPS: use the hosted deploy or a tunnel. |

## The demo data (recorded mode)

`pnpm dev` and the hosted reseed run `db/seed/kirana-paypal.ts` after the kirana seed. It goes through core's real
paths, as the shop's people would.

- **Neha J.** A synthetic customer with a WhatsApp number and service consent, given in person.
  - Her opening balance from the paper khata was due ten days ago.
  - From the first watcher run of the day, her overdue-credit finding offers both fixes. `pnpm dev`'s ticker runs one
    within a minute of start; the hosted reseed runs it at once.
- **Sunita P.** A planted overdue customer.
  - The manager drafted a PayPal link for her and the owner approved it. It was made in recorded mode.
  - A paid notice for it is stored the way the webhook stores one: by the public role, with no actor and no book row.
  - The screen labels it "Paid (recorded demo: PayPal sent no notice)".
  - The books do not show that payment, so the watcher raises it.

The step runs after the recorded day the replayed answers use (27 Oct). No read as of that day changes, so
`kirana.answers.json` and the recorded fixtures (hero-ask, agents-wired, memory-recorded) still match. The seeded
kirana (`seedKirana`) is unchanged, and the web tests' demo shop (`apps/web/test/home-db.ts`, `openHome`) runs the same
PayPal step, so every recorded fixture is proved against the seed `pnpm dev` builds.

## Configure the keys

The names are in `.env.example`. Set all three keys or none: a partial set is a boot refusal that names the missing
setting.

| Name | Value |
|---|---|
| `PAYPAL_CLIENT_ID` | the sandbox app's client id (developer.paypal.com, Apps & Credentials, Sandbox) |
| `PAYPAL_CLIENT_SECRET` | the sandbox app's secret |
| `PAYPAL_WEBHOOK_ID` | the id of the webhook you create for `https://<your host>/api/webhooks/paypal`, subscribed to `INVOICING.INVOICE.PAID` |
| `PAYPAL_ENV` | optional. If set, it must be `sandbox` |

Locally, run `node --env-file=.env db/src/dev.ts` so the keys reach the app (`pnpm dev` alone uses the shell's
environment). The app also needs its jobs connection for the sweep; `pnpm dev` sets it, and a hosted deploy sets
`JOBS_DATABASE_URL`.

## Demo script for the PayPal judges

About three minutes.

1. Start at `/demo` (on `pnpm dev`, http://localhost:3000/demo).
2. Open **Sharma General Store** and sign in as the owner, Rajesh Sharma. Everything in the shop is synthetic.
3. Wait a minute after start, so the first watcher run of the day has run.

**Recorded track (no keys):**

1. **Home.** The overdue-credit card offers **Draft the fix** (a reminder) and **Send a PayPal link** (with the
   PayPal sandbox sticker).
   - The card stands for every overdue customer. Tap **Send a PayPal link**: one link draft per overdue customer waits
     in the tray, except Sunita P., whose PayPal payment the books do not show yet. The note says she was skipped and
     nothing has changed yet.
   - The office brief offers the same two fixes per finding, once the morning brief is written.
2. **Home's tray** shows "PayPal link: ask Neha J. to pay … by PayPal".
   - The amount is a chip: tap it to see the balance row it comes from.
   - The card says PayPal sandbox and "Munshi never moves money".
3. **Tap Approve on Neha J.'s card.** The note says PayPal made the link and Munshi drafted the WhatsApp message, which
   waits for your approval. Approve Ramesh K.'s instead and the link is made, but the note says no phone is on file, so
   share it yourself.
4. **The message's card** in the tray shows the words as they will be sent: the shop, the amount as a chip, "PayPal
   (sandbox)" and the recorded link. Tap **Approve**: only now is the message written, under your name.
5. **Open Credit.**
   - Neha J.'s row shows "Recorded: nothing is sent", with the `REC-…` id and "Sent to the customer on WhatsApp".
   - **Send PayPal link** is not offered again while her link is live.
6. **Sunita P.'s row.** It shows her link "Paid (recorded demo: PayPal sent no notice)" and **Record this payment**.
   - The watcher's finding says "PayPal reports a payment the books do not show yet" (on the office brief, once the
     morning brief is written); its **Draft the fix** drafts the same payment.
   - Tap **Record this payment**, then **Approve**. The payment enters the books under your name, marked "Recorded in
     the books", and her balance drops.
7. **Sign in as counter staff** from `/demo`. The credit book shows no PayPal panel at all.

**Sandbox track (keys set, the app on a public HTTPS URL):**

1. Repeat steps 1 to 4. Neha's link now reads "Link made on PayPal", with PayPal's invoice id and **Open the payment
   page**. Her message's card shows the payer page before you approve it.
2. Open the payment page and pay with a PayPal sandbox buyer account.
3. Back in Munshi, the link shows "PayPal says paid", and the next watcher run raises the finding. Nothing is in the
   books yet.
4. Tap **Record this payment**, then **Approve**. The book row is written by the approval, under the approver's name,
   with its audit entry.

The recorded track runs end to end in `apps/web/test/paypal-app.test.tsx` (PP-APP6, PP-APP3 and "PP-APP judge
script"), on the demo kirana with this PayPal step and a watcher run of today. The tests cover:

- the Home card's PayPal fix, which drafts one link per overdue customer, skipping Neha J. (live link) and Sunita P.
  (paid, unrecorded);
- Neha J.'s link approved, its message drafted, shown in full and approved on its own;
- Ramesh K.'s link, approved with no phone on file;
- Sunita P.'s recorded payment, recorded and approved from the credit book;
- the counter staff view.

The database side runs in `db/test/v2/core/paypal/paypal-app.test.ts` against the real guards.

## Not built

- **The PayPal Agent Toolkit.** It is not used, and the package has not been evaluated.
  - The agent holds no PayPal key by design.
  - Installs are frozen to the lockfile, and the toolkit is not in it.
  - Recorded replay must stay deterministic.
  - Invoice status is read by the adapter, behind core, never by a model.

## Limitations

- **Refunds and disputes at PayPal are not read.** Munshi stores only PayPal's paid notice. A later refund or dispute at
  PayPal changes nothing here, and a person must reverse the recorded payment themselves. The hold on a new link (step
  1) lifts once the books show a payment; a refund afterwards does not bring it back.
- **WhatsApp template.** A real send outside the 24-hour window needs an approved WhatsApp template, set as
  `WHATSAPP_TEMPLATE_PAYPAL_LINK` and `WHATSAPP_TEMPLATE_PAYPAL_LINK_TEXT` (names in `.env.example`). Without one, the
  send waits for the window. The message is one line (English, then Hindi), so it can fit a template.

## Not verified

- No run against PayPal's sandbox is recorded in this repository. The adapter is tested with a stubbed `fetch`.
- Whether PayPal sandbox invoicing accepts Indian rupees for the sandbox merchant account.
- Which shape the `INVOICING.INVOICE.PAID` event carries. The parser tries `resource.invoice`, then `resource`.
- A real WhatsApp send of the link. A sample shop's delivery is always recorded; a real shop's needs its live channel
  and the `paypal_link` template approved on WhatsApp. Without that template, a send outside the 24-hour window waits.
