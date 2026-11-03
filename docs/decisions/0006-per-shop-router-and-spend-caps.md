# 6. A per-shop model router, feature switches and spend caps

Status: accepted · November 2026

## Context

Munshi is a platform for many shops. Each shop's AI use costs money, a new shop should not get AI before the operator
trusts it, and an owner should be able to see, and choose, which model each agent uses. "The model on the screen" must
be the model actually called.

## Decision

- The operator approves the deployment's allowed model aliases per role, and may narrow the list for one shop and set
  its default per role. The owner picks one model per agent from the shop's list.
- Every call follows one order: the owner's pick, the shop's default, the deployment's default, then the rest of the
  allowed list. The AI staff page shows the result of that same order.
- The operator switches each shop's AI features (ask, photos, voice, read-aloud, narration, campaign copy, inbox
  drafts, memory) on or off. A switched-off feature is refused before any run or model call, and the database refuses
  its writes.
- Before every model call, core's `allow()` checks the deployment's AI switch, the shop's switch, the shop's daily cap,
  the deployment's daily ceiling and the shop's monthly budget.
- Every answered call writes a spend row with its tokens and, where the alias has a price, its cost. A call with no
  price, or whose provider reported no usage, has an unknown cost shown as "Cannot verify", never zero.
- Every list, switch and budget is an approved platform change.

## Consequences

- An operator can contain cost and risk per shop without a deploy.
- Near the budget, the owner sees a warning; the soft cap warns, it does not swap models.
- The budget can count only priced calls. Few aliases have prices today, so the console shows the unpriced share beside
  the total.
- New self-serve shops start with AI off until the operator turns it on.

Code: [`packages/core/src/models.ts`](../../packages/core/src/models.ts),
[`packages/core/src/allow.ts`](../../packages/core/src/allow.ts),
[`packages/core/src/spend.ts`](../../packages/core/src/spend.ts),
[`db/schema/22_ai_controls.sql`](../../db/schema/22_ai_controls.sql).
