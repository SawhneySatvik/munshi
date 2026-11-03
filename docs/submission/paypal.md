# Munshi and PayPal

Munshi is built to use PayPal to collect money a shop is owed. It can create a PayPal payment link for an overdue udhaar (store
credit) or an unpaid invoice. A named person approves each link before it is made. When PayPal reports the link paid,
a person approves recording that payment in the books.

**Sandbox only. Munshi never moves money.** PayPal holds and moves the money. Munshi asks PayPal to create an invoice,
reads its status back, and stores PayPal's paid notification. `PAYPAL_ENV` may only be `sandbox`, and no live PayPal
endpoint is wired.

## Status: built and tested, not yet switched on in the app

The PayPal code, its tables (`db/schema/24_paypal.sql`) and its tests are all on this branch. **The running app does
not show PayPal yet**, because two registry lines are still to be wired:

- `packages/core/src/commands.ts` does not yet spread `PAYPAL_COMMANDS`;
- `packages/core/src/queries.ts` does not yet spread `PAYPAL_QUERIES`.

`paypalReady()` (`payments-paypal.ts`) hides every PayPal surface until both are registered. Today only the tests
register them, through `registerPendingPaypal()` in `db/test/v2/core/paypal/pending-ddl.ts`, which says the lines are
held for the orchestrator to wire.

So everything below is what the code does, as proved by the database and web tests, and what the screens will show
once those two lines land.

## The code

| Part | File |
|---|---|
| The PayPal adapter: OAuth, invoices, cancel, webhook verification, recorded mode | `packages/adapters/payments/paypal.ts` |
| The two draft-only commands, `paypal.request` and `paypal.cancel` | `packages/core/src/commands-paypal.ts` |
| Proposals, the webhook's store, "record this payment", the page's reads | `packages/core/src/payments-paypal.ts` |
| The sweep that takes approved links to PayPal | `packages/core/src/jobs-paypal.ts` |
| The named reads (`paypal.event`, `watch.paypal_unrecorded`) | `packages/core/src/queries-paypal.ts` |
| The recipes: a finding to a PayPal draft | `packages/agent/src/recipes-paypal.ts` |
| The webhook route | `apps/web/app/api/webhooks/paypal/route.ts` |
| The screen actions and panel | `apps/web/app/app/credit/paypal-actions.ts`, `apps/web/components/PayPalLink.tsx` |
| The tables: `ops.paypal_link`, `ops.paypal_route`, `ops.payment_event` | `db/schema/24_paypal.sql` |
| Tests | `db/test/v2/core/paypal/paypal.test.ts` (PAYPAL0 to PAYPAL10), `packages/adapters/test/paypal.test.ts`, `packages/config/test/paypal.test.ts`, `apps/web/test/paypal*.test.tsx` |
| Red-proofs | `db/test/v2/sabotage/paypal.ts` |

## The flow

### 1. A PayPal link is proposed

- **How a person starts it:** on the credit book (`/app/credit`) or an invoice, the owner or a manager taps **Send
  PayPal link**. Core creates a draft, `paypal.request`, and the screen says: "Drafted. It waits below for a person to
  approve; nothing goes to PayPal before that."
- **The amount is a stored cell, not a typed number.**
  - For credit, it is the customer's current `credit.balance` cell.
  - For an invoice, it is the sale's open credit (`invoice.open_credit`).
  - The draft holds a reference to that cell. A typed amount is refused (PAYPAL3).
- **One live link per customer.** A second link draft is refused while one is queued, sent and unpaid, or being
  cancelled (PAYPAL7).
- **The agent's version is written and tested, but the app does not offer it yet.** The recipe `paypalLink`
  (`recipes-paypal.ts`) turns an overdue-credit finding into the same `paypal.request` draft, and core accepts it
  (PAYPAL5). It is not yet joined to the finding card's **Draft the fix**: `RECIPES` in `packages/agent/src/recipes.ts`
  still maps `overdue_credit` only to a reminder.

### 2. A person approves

- **Who can approve.** The owner or a manager, by the command authority set in `24_paypal.sql`. `decide()` runs under
  the approver's own session.
- **What approval writes.** In one transaction with its audit entry, it writes one `ops.paypal_link` row with status
  `queued`. It writes no book row and makes no PayPal call.
- **If the books moved.** If the balance cited by the draft has changed since, the decision is stale and nothing is
  done (PAYPAL8 covers a sale reversed after the proposal).

### 3. The link is made on PayPal

- **When.** After the approval commits, the jobs role's sweep takes the queued link to PayPal (PAYPAL2, PAYPAL9). It
  runs at once for the approving shop. Any link left queued is picked up by the `paypal_links` job on the next jobs
  tick (at most once a minute).
- **Duplicates.** The draft's id is PayPal's request id, and the invoice number is derived from it. A retried sweep
  therefore finds the invoice PayPal already holds instead of making a second one.
- **The PayPal calls.** The adapter does three things:
  - searches for the invoice number;
  - creates a draft invoice with one line, "Balance due";
  - calls `/send` with `send_to_recipient: false`.

  PayPal answers with the payer page link.
- **Who tells the customer.** PayPal does not email the customer, and Munshi does not message the link either. The
  screen shows "Link made on PayPal" and **Open the payment page**. The shop shares that page with its customer.
- **Failures.** A failed call is retried, up to five attempts, and then the link is marked failed. One link's failure
  never blocks the next.
- **Cancelling.** **Cancel link** is a draft too (`paypal.cancel`). Once approved, a queued link is cancelled at once and
  a sent one is cancelled at PayPal by the sweep.

### 4. PayPal's webhook stores a payment event

`/api/webhooks/paypal` accepts PayPal's `INVOICING.INVOICE.PAID`.

- **Checks before PayPal is asked:**
  - the body is capped;
  - the five transmission headers must be present and well formed, with `SHA256withRSA` and a certificate URL on
    PayPal's own hosts;
  - the transmission time must be within ten minutes.
- **Verification.** PayPal's own `verify-webhook-signature` call, with our `PAYPAL_WEBHOOK_ID`, decides whether the
  notification is genuine. Munshi never fetches the certificate URL a request names.
- **What is stored.** Only a full payment (PayPal status `PAID`) is stored, as one `ops.payment_event` per PayPal event
  id (PAYPAL4).
  - A replay, a partial payment or an unknown invoice stores nothing.
  - An unknown invoice answers 503, so PayPal retries.
- **No book row.** The webhook has no person behind it, so it writes no book row and no draft.

### 5. A person records the payment

- **Recording it.** On the link, the screen shows "PayPal says paid" and **Record this payment**. Tapping it proposes
  `payment.record` with method `paypal`.
  - The amount and date are the cells of PayPal's stored notification.
  - The draft also cites the customer's current balance, so a payment recorded in between makes it stale.
- **Approval.** Only the approval writes the payment into the books (account `paypal_clearing`), once (PAYPAL6).
- **Other currencies.** A notification in another currency is never recorded. The screen says "Cannot record: currency
  differs. Settle it with PayPal."
- **Not wired yet.** The read `watch.paypal_unrecorded` and its recipe exist, but they are not in the watcher list
  (`packages/core/src/watchers.ts`). So no finding is raised yet for a PayPal payment the books do not show.

## What runs, and what needs keys

All of this applies once the registry lines above are wired. Until then, the app shows no PayPal panel in either mode.

| Mode | When | What happens |
|---|---|---|
| Recorded (the default) | none of the three keys set | Steps 1, 2 and 3 run. The link gets a `REC-…` id derived from the draft id, has no payer page, and is never paid. The screen says "PayPal sandbox (recorded: nothing is sent to PayPal)". The webhook route answers 404 and no notification verifies, so steps 4 and 5 cannot be shown. |
| Sandbox | all three keys set | Every step runs against `https://api-m.sandbox.paypal.com`. Steps 4 and 5 need PayPal to reach the webhook over public HTTPS. `localhost` does not work: use the hosted deploy or a tunnel. |

Not built:

- The registry wiring that switches PayPal on in the app (see Status).
- The PayPal Agent Toolkit or MCP server, which the platform design mentioned.
- The agent proposing a PayPal link from a finding card (see step 1).
- Sending the payer page to the customer over WhatsApp.

Not verified:

- No run against PayPal's sandbox is recorded in this repository. The adapter is tested with a stubbed `fetch`.
- Whether PayPal sandbox invoicing accepts the demo shop's currency (Indian rupees) for the sandbox merchant account.
  The adapter refuses only PayPal's zero-decimal currencies.
- Which shape the `INVOICING.INVOICE.PAID` event carries: the parser tries `resource.invoice`, then `resource`. If the
  event carries no paid amount, the route reads the invoice back from PayPal.

## Configure the keys

The names are in `.env.example`. Set all three keys or none: a partial set is a boot refusal that names the missing
setting.

| Name | Value |
|---|---|
| `PAYPAL_CLIENT_ID` | the sandbox app's client id (developer.paypal.com, Apps & Credentials, Sandbox) |
| `PAYPAL_CLIENT_SECRET` | the sandbox app's secret |
| `PAYPAL_WEBHOOK_ID` | the id of the webhook you create for `https://<your host>/api/webhooks/paypal`, subscribed to `INVOICING.INVOICE.PAID`. Letters and digits, at most 50 characters |
| `PAYPAL_ENV` | optional. If set, it must be `sandbox` |

Locally, run `node --env-file=.env db/src/dev.ts`, so the keys reach the app (`pnpm dev` alone uses the shell's
environment). The app also needs its jobs connection for the sweep. `pnpm dev` sets it; a hosted deploy sets
`JOBS_DATABASE_URL`.

## Demo script for the PayPal judges

**This script needs the registry lines wired first (see Status).** On the current branch the PayPal panel does not
appear. The same flow can be seen in `apps/web/test/paypal-credit.test.tsx` and `db/test/v2/core/paypal/paypal.test.ts`.

About three minutes. Start at `/demo` (on `pnpm dev`, http://localhost:3000/demo). Open **Sharma General Store** and sign
in as the owner, Rajesh Sharma. The shop and its customers are synthetic.

**Recorded track (no keys):**

1. Open **Credit**. Ramesh K. owes for toor dal bought on credit and is overdue, as seeded
   (`db/seed/kirana.answers.json`). Tap the amount to open its source. A balance is a total, so its chain ends at the
   read that summed it.
2. Tap **Send PayPal link**. The screen says the draft waits and nothing goes to PayPal before approval.
3. Tap **Approve**. The link moves from "Approved; waiting to reach PayPal" to "Recorded: nothing is sent", with a
   `REC-…` id.
4. Try **Send PayPal link** for Ramesh K. again. It is not offered while his link is live.
5. Tap **Cancel link**, then approve the cancel. The link closes.

**Sandbox track (keys set, the app on a public HTTPS URL):**

1. Repeat steps 1 to 3. The link now reads "Link made on PayPal" with PayPal's invoice id and **Open the payment page**.
2. Open the payment page and pay with a PayPal sandbox buyer account.
3. Back in Munshi, the link shows "PayPal says paid". Nothing is in the books yet.
4. Tap **Record this payment**, then **Approve**. The payment enters the books under the approver's name, marked
   "Recorded in the books", and Ramesh K.'s balance drops. The payment's book row was written by the approval, under
   the approver's name, with its audit entry.
