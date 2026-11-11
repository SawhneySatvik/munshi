# 9. PayPal links are approved drafts; Munshi never moves money

Status: accepted · November 2026

## Context

Overdue customer credit is one of a small shop's biggest leaks. A payment link helps collect it, but creating a link,
messaging a customer and recording a payment each change what the shop says and records. Munshi records payments; it
must never process them.

## Decision

- PayPal is sandbox only (`PAYPAL_ENV` must be `sandbox`). Munshi asks PayPal to create an invoice, reads its status and
  stores PayPal's paid notification; PayPal holds and moves the money.
- A payment link for an overdue balance, an open invoice or a confirmed order is a draft (`paypal.request`) a person
  approves. Its amount is a reference to a stored cell: the customer's current balance, the invoice's amount due, or the
  order's `order.due` (its total less any advance held). A typed amount, another order's cell or a closed order is
  refused, and the database binds an order's link to that order.
- Once PayPal makes the link, the WhatsApp message carrying it is a separate draft, bound to that link, shown in full
  and sent only on its own approval.
- A paid notification writes no book row. It becomes a finding, whose fix drafts `payment.record` for a person to
  approve. For an order still open, the payment is recorded as the order's advance; for an order delivered or
  cancelled in the meantime, against the customer's credit.
- One live link per customer; no new link while a paid link is not yet in the books.
- Without sandbox keys, the flow runs in recorded mode and says so wherever a person decides.

## Consequences

- The overdue-credit finding offers two fixes, a reminder or a PayPal link, both fixed recipes.
- Collecting money takes up to three approvals (the link, the message, the payment record). Each is a separate decision
  with its own name on it.
- Refunds and disputes are not handled.

Walkthrough: [docs/paypal.md](../paypal.md).

Code: [`packages/adapters/payments/paypal.ts`](../../packages/adapters/payments/paypal.ts),
[`packages/core/src/payments-paypal.ts`](../../packages/core/src/payments-paypal.ts),
[`packages/core/src/commands-paypal.ts`](../../packages/core/src/commands-paypal.ts).
