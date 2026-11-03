# Architecture decision records

Short records of the decisions that shape Munshi: the context, what was decided, and what follows from it. Each names
the code that carries it out.

| # | Decision |
|---|---|
| [1](0001-draft-and-approve.md) | Agents draft; a named person approves |
| [2](0002-snapshot-cells.md) | Every figure renders from a stored snapshot cell |
| [3](0003-agent-role-without-writes.md) | The agent's database role has no write grant |
| [4](0004-schema-from-ordered-files.md) | The schema is ordered files, rebuilt from scratch |
| [5](0005-model-roles-meta-first.md) | Agents ask for roles; Meta's models first |
| [6](0006-per-shop-router-and-spend-caps.md) | A per-shop model router, feature switches and spend caps |
| [7](0007-recorded-mode.md) | Recorded mode is the default |
| [8](0008-channels-recorded-until-live.md) | Channels stay recorded until every live condition holds |
| [9](0009-paypal-as-approved-drafts.md) | PayPal links are approved drafts; Munshi never moves money |
| [10](0010-real-shop-acceptance.md) | Real shops share the database and wait for the operator's acceptance |
| [11](0011-one-process-context-from-session.md) | One server process; shop and person come only from the session |
| [12](0012-every-gate-red-proved.md) | Every gate is proven to fail; the database is never mocked |

A new record takes the next number. A record is not edited to reverse it; a later record supersedes it and says so.
