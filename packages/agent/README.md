# @munshi/agent

The agent flows: answering questions, reading photos and bills, voice, read-aloud, the inbox, campaign copy, fix
recipes, and the cite-or-abstain validator that keeps model text from carrying numbers.

## Entry points

| Export | File | What |
|---|---|---|
| `ask`, `explainFinding`, `explainCard`, `narrateBrief` | [`src/run.ts`](src/run.ts) | Router, then a desk's tool loop over named reads (at most 8 calls, a 45-second budget), then narrate |
| `draftFix` | [`src/run.ts`](src/run.ts), [`src/recipes.ts`](src/recipes.ts) | A finding's fix by a fixed recipe, with no model call |
| `countShelf` | [`src/shelf.ts`](src/shelf.ts) | Shelf photo: vision names products, segment counts them, code compares with stock on hand |
| `readBill` | [`src/bill.ts`](src/bill.ts) | Bill photo or PDF into a `purchase.record` draft whose numbers are bill cells |
| `askByVoice`, `readAloud` | [`src/voice.ts`](src/voice.ts), [`src/speak.ts`](src/speak.ts) | Speech in, checked answers out loud |
| `draftReply`, `draftOrder`, `writeCampaignCopy` | [`src/inbox.ts`](src/inbox.ts), [`src/order-draft.ts`](src/order-draft.ts), [`src/copy.ts`](src/copy.ts) | Drafts from a customer's message, and campaign words for the owner to edit |
| The validator | [`src/answer.ts`](src/answer.ts), [`src/words.ts`](src/words.ts) | Refuses free digits, number words (English and Hindi), unknown handles and cells from another run or shop |
| `AgentPort` | [`src/port.ts`](src/port.ts) | Everything a run may do, handed in by the app already bound to one shop and one run |
| Tools | [`src/tools.ts`](src/tools.ts) | One tool per named read, grouped by desk (stock, sales, credit) |

## Boundaries

- Holds no database pool and imports nothing of core but `@munshi/core/read` (gate B1). Its reads run as the read-only
  `munshi_agent` role; its only way to change anything is `port.propose`, a draft that waits for a person.
- Models are reached only through [`@munshi/ai`](../ai), by role.
- The model never sees a uuid; ids appear as handles, and a tool takes back only a handle the run showed.
- A run that reads untrusted text (a customer's message, a bill's lines) is tainted and may propose only the recipe the
  person tapped.
- Traces hold kinds, fixed labels, ids and timings; never a question, model text, a name or bill text.

## Testing

```bash
pnpm --filter @munshi/agent test
pnpm --filter @munshi/agent hero-smoke    # the hero flows against live models; needs keys
```

Tests run the flows on recorded fixtures in [`fixtures`](fixtures), including injection and cross-shop cases. The
validator's precision corpus ([`test/corpus`](test/corpus)) holds clean sentences that must pass and attacks that must
be refused. Sample inputs (a shelf photo, a bill, English and Hindi voice clips) are in
[`fixtures/media`](fixtures/media).
