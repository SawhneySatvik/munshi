# PayPal in Munshi

A small shop loses money in two places PayPal can close: customers who owe it (credit, _udhaar_) and customers who order
by message and still have to pay. Munshi's agents find both, and draft the PayPal step. A named person approves every
step, and PayPal holds and moves the money. Munshi records what PayPal reports, and only on a person's approval.

Everything here runs against **PayPal's sandbox**. Without sandbox keys, the same flows run in a recorded mode that
says so on every screen.

## Two flows, end to end

### 1. Collecting overdue credit

| Step | Who | What happens |
|---|---|---|
| 1 | Watcher (code) | Finds customers whose credit is overdue, ranked by rupees at stake, in the morning brief |
| 2 | Agent | Explains the finding in English or Hindi; every figure in its words is a stored cell, never model text |
| 3 | Owner | Picks "Send a PayPal link". Munshi drafts `paypal.request` for the customer's current balance cell |
| 4 | Owner | Approves the draft. In the same transaction, under the owner's name, the link is queued |
| 5 | Jobs | Asks PayPal for an invoice (Invoicing API v2) and stores the payer link PayPal returns |
| 6 | Owner | Approves a separate draft: the WhatsApp message carrying the link, shown in full |
| 7 | PayPal | The customer pays on PayPal's own page; PayPal sends `INVOICING.INVOICE.PAID` |
| 8 | Webhook | Munshi asks PayPal to verify the notification's signature, then stores it. No book row is written |
| 9 | Watcher | "PayPal reports a payment the books do not show yet" becomes a finding |
| 10 | Owner | Approves "Record this payment": the credit is paid down in the journal, citing PayPal's stored event |

### 2. An order by message, paid by PayPal

| Step | Who | What happens |
|---|---|---|
| 1 | Customer | Sends "2 kg atta and a butter, I'll pay online" (WhatsApp in production, recorded on the demo) |
| 2 | Agent | The model (role `reason`) points at the item and quantity words; core matches them to the catalogue and reads the quantities. It never writes a number itself |
| 3 | Owner | Approves the order draft |
| 4 | Owner | Taps "Send PayPal link" on the order. The amount is the `order.due` cell: the order's total less any advance |
| 5 | Owner | Approves the link, then the message carrying it, as in the first flow |
| 6 | PayPal | Reports the payment; it becomes a finding |
| 7 | Owner | Approves recording it as the order's advance. If the order was delivered or cancelled meanwhile, it is recorded against the customer's credit |

Ask can answer questions about PayPal from the same stored rows, such as "Which PayPal payments are not in the books
yet?". Each figure in the answer opens its source; anything it cannot trace reads "Cannot verify".

## Where the AI is, and where it is not

- **Watchers** are code over named reads of the books. They decide what is a finding.
- **Agents** explain findings, answer questions through named reads (owner and manager may read PayPal links), and turn
  a customer's message into an order draft by pointing at words. A model never writes a figure: the validator refuses
  any digit or number word in model prose that does not come from a stored cell.
- **Every PayPal step is a draft.** The agents' database role has no write grant. A person approves; the database
  checks the approval, its approver and the amount's cell in the same transaction.

The models are set per role in [`packages/ai`](../packages/ai/src/config.ts): Meta's Muse Spark for routing and
reasoning, Muse Spark Open for narration, with Gemini as the fallback when a Meta key is missing. Recorded responses let
the demo run with no model keys.

## The PayPal desk

`/app/paypal` gathers collections on one screen, built on AG Grid Community: who owes, how late, the last reminder, the
PayPal link's state and amount, and the next move, with charts by lateness and by link state. Every row action is one
of the drafts above. See the README's "The PayPal desk, on AG Grid".

## The PayPal APIs used

All calls go through one adapter, [`packages/adapters/payments/paypal.ts`](../packages/adapters/payments/paypal.ts),
against `https://api-m.sandbox.paypal.com`:

| Call | Used for |
|---|---|
| `POST /v1/oauth2/token` | Client credentials, cached to expiry |
| `POST /v2/invoicing/search-invoices` | Finding Munshi's own invoice number first, so a retry never makes a second invoice |
| `POST /v2/invoicing/invoices` | A draft invoice for one cited amount |
| `POST /v2/invoicing/invoices/{id}/send` | With `send_to_recipient: false`, so PayPal returns the payer link and Munshi's approved message carries it |
| `GET /v2/invoicing/invoices/{id}` | Status and paid amount |
| `POST /v2/invoicing/invoices/{id}/cancel` | Closing a link whose debt was settled another way |
| `POST /v1/notifications/verify-webhook-signature` | Checking every notification with PayPal before storing it |

Every write carries `PayPal-Request-Id`. Errors carry a code only: no key, token or body reaches a log.

## Try it

- **Hosted demo:** sign in as the sample kirana's owner and open the PayPal desk, Orders or the Inbox. The sample shop
  is seeded with one walk at each stage: a payment PayPal reports that the books do not show yet, and a fresh message
  waiting to become an order.
- **Locally:** `pnpm dev` (see the README's Quick start). Recorded mode needs no keys.
- **With sandbox keys:** set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` and `PAYPAL_ENV=sandbox`
  (a sandbox app at developer.paypal.com, with a webhook for "Invoicing invoice paid" pointing at
  `/api/webhooks/paypal`). `node scripts/paypal-smoke.ts` makes one real sandbox link per currency through the same
  adapter, reads it back and cancels it.

## Limits

- Sandbox only; `PAYPAL_ENV` must be `sandbox`. Refunds and disputes are not handled.
- Munshi never moves money. Recording a payment is bookkeeping, approved by a person.
- Collecting takes up to three approvals (the link, the message, the record). That is deliberate: each changes what the
  shop says or records.

Design record: [decision 9](decisions/0009-paypal-as-approved-drafts.md).
