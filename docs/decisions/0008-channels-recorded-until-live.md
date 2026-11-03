# 8. Channels stay recorded until every live condition holds

Status: accepted · November 2026

## Context

A message to a customer is part of the books: it speaks for the shop. Sending one by mistake (from a sample shop, a
shop nobody verified, or a demo with real credentials set) cannot be undone. Credentials alone are too weak a signal
that sending is intended.

## Decision

- Every outbound message is a draft a person approves.
- A send is real only if **all** of these hold, rechecked at send time: `MUNSHI_SEND_MODE=live`; the channel's
  credentials; a real shop (never a sample) that the operator accepted; the operator's grant for that channel; and, on
  WhatsApp, a listed recipient. Otherwise it goes to the recorded sender, which keeps ids and body hashes only.
- The outbox claims each delivery and commits the claim before any provider call, so a delivery is sent at most once.
  A delivery that cannot be sent waits and lapses at its deadline.
- Outside WhatsApp's 24-hour window, only an approved template with its exact configured wording is sent.
- An Instagram post's approval binds the picture's id and hash; a picture changed after the proposal makes the draft
  stale.
- Inbound webhooks verify the provider's signature over the raw body before parsing, store messages as operational
  rows, and never write a book row or call a model.

## Consequences

- Holding credentials sends nothing by itself; a demo can carry them safely.
- Each screen says whether a channel is live or recorded, and why.
- Getting to a real send takes deliberate steps by both the deployment and the operator.

Code: [`packages/core/src/outbox.ts`](../../packages/core/src/outbox.ts),
[`packages/adapters/channels`](../../packages/adapters/channels),
[`apps/web/lib/server/outbox.ts`](../../apps/web/lib/server/outbox.ts).
