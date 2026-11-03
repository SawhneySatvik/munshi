# 1. Agents draft; a named person approves

Status: accepted · October 2026

## Context

Munshi's agents find problems in a shop's records and know how to fix many of them: reorder what went missing, remind a
customer who owes money, record a supplier's bill. Letting them apply those fixes would be faster, but a shopkeeper has
to be able to trust the books absolutely, and a model can be wrong or be manipulated by text it reads (a customer's
message, a supplier's bill).

## Decision

Nothing changes the books without a named person's approval. A book row is written only by:

- a person's own direct command (a counter sale, a manual entry), or
- an approved draft, executed under the approver's identity in one transaction with its audit entry.

Agents only propose drafts (`proposeDraft`). A person approves or rejects each one (`decide`), and the approver is
always the signed-in member of that request; there is no parameter to name anyone else. Before executing, `decide`
re-runs every read the draft cited; if anything changed, the draft goes stale instead of running. The database's book
guard, not only the app, refuses any write that is neither a held direct command nor an approved decision made in the
same transaction.

## Consequences

- Every change has a person's name on it, in an append-only, hash-chained audit log.
- An approval cannot be replayed later, by another shop, or by anyone but the approver.
- Agents cannot act alone, even when confident. Every outbound message, including a reply to a customer, waits in the
  tray. This costs the shopkeeper taps, which the tray and the morning brief keep few.
- Stale drafts are expected and safe: a draft made from yesterday's stock count does not run on today's.

Code: [`packages/core/src/approvals.ts`](../../packages/core/src/approvals.ts), `books.write()` in
[`db/schema/02_shared.sql`](../../db/schema/02_shared.sql).
