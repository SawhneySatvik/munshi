# 2. Every figure renders from a stored snapshot cell

Status: accepted · October 2026

## Context

Language models produce fluent numbers that may be wrong. A back office that shows a wrong figure, or one nobody can
trace, loses its owner's trust at once. We needed every number on screen, in an answer, in a draft or through the API to
be checkable against the row it came from.

## Decision

- Numbers are read only through registered **named reads**. Running one stores a **snapshot**: its declared columns and
  rows as typed cells (money in minor units with a currency, quantities in milli-units with a unit, dates, text). A
  stored snapshot never changes.
- Anything that shows or uses a number points at a cell with a reference, `⟨snap:id·row·col⟩`.
- Model prose may carry references, never free digits or number words. A validator refuses any answer that breaks this,
  and the screen shows "Cannot verify" in fixed words instead of the model's text.
- A draft's every number must map to a cell holding exactly that number. A typed amount is refused.

## Consequences

- Any figure can be walked back: cell, read, book row, decision, approver ("Why this number").
- The API returns figures as cells with refs, so a storefront can show the same receipts.
- The validator errs toward refusing: some honest sentences become "Cannot verify". We accept that trade.
- The validator proves numbers came from cells; it cannot prove the cell answers the question asked.
- Snapshots cost storage; unpinned ones are purged after seven days.

Code: [`packages/core/src/snapshots.ts`](../../packages/core/src/snapshots.ts),
[`packages/core/src/read.ts`](../../packages/core/src/read.ts),
[`packages/agent/src/answer.ts`](../../packages/agent/src/answer.ts).
