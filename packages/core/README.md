# @munshi/core

The framework-free domain: everything that reads or changes a shop's records. The web app, the jobs tick, the seeds
and the deploy tools all go through it.

## Entry points

| Name | File | What |
|---|---|---|
| `withTx`, `openSession`, `Session` | [`src/session.ts`](src/session.ts) | Every transaction, and the one place shop, actor and command are set (`SET LOCAL`) |
| `runCommand` | [`src/commands.ts`](src/commands.ts), `src/commands-*.ts` | A person's direct command, with an optional idempotency key |
| `proposeDraft`, `decide` | [`src/approvals.ts`](src/approvals.ts) | Drafts and decisions: a draft's numbers mapped to cells; approval re-checks, then executes as the approver |
| `mintSnapshot`, `resolveRef` | [`src/snapshots.ts`](src/snapshots.ts), [`src/read.ts`](src/read.ts) | Named reads stored as immutable snapshot cells; refs to one cell |
| Named reads | [`src/queries.ts`](src/queries.ts), `src/queries-*.ts` | The registry of every read a screen or an agent may run |
| `READ_ROLES`, `ASK_DESKS` | [`src/read-roles.ts`](src/read-roles.ts) | Which role may read what, enforced wherever a snapshot is minted or loaded |
| Views | `src/views-*.ts` | What each screen loads, in one transaction as the member |
| `runWatchers`, `runBackOffice` | [`src/watchers.ts`](src/watchers.ts), [`src/brief-schedule.ts`](src/brief-schedule.ts) | Detectors that raise findings, and the morning brief |
| `runDueJobs` | [`src/jobs.ts`](src/jobs.ts), `src/jobs-*.ts` | Scheduled jobs: the outbox, PayPal sweeps, holds, purges, retention |
| `allow`, `modelFor`, `recordSpend` | [`src/allow.ts`](src/allow.ts), [`src/models.ts`](src/models.ts), [`src/spend.ts`](src/spend.ts) | AI switches, caps and budget; the per-shop model chain; spend |
| Platform | [`src/platform.ts`](src/platform.ts), [`src/platform-totp.ts`](src/platform-totp.ts) | Operators, TOTP, and approved platform changes |
| `@munshi/core/read` | [`src/read.ts`](src/read.ts) | The read-only entry point, the only part of core the agent may import |
| `@munshi/core/paypal` | [`src/payments-paypal.ts`](src/payments-paypal.ts) | PayPal (sandbox) proposals, the webhook's store and recording a payment |

Money is integer minor units with a currency ([`src/money.ts`](src/money.ts)); time goes through one module
([`src/time.ts`](src/time.ts)). Every error leaving core is a `CoreError` with a code and a fixed message, never the
database's text ([`src/errors.ts`](src/errors.ts)).

## Boundaries

- No framework, no agent import. Adapters (channels, cache, payments) are wired in by the app.
- Only `withTx` names the acting-member setting (gate B3); only `mintSnapshot` writes snapshots (gate B4);
  `@munshi/core/read` reaches only read-side files (gate B2).
- A command returns the ids of the rows it wrote, never a number; numbers are minted from the books as cells.

## Testing

```bash
pnpm --filter @munshi/core test       # unit tests and the source-scanning boundary gates (B0 to B6)
pnpm --filter @munshi/db test         # core's database-backed tests, in db/test/v2/core
```

Core's tests that touch data live in [`db/test/v2/core`](../../db/test/v2/core), against a real PostgreSQL 17; the
database is never mocked. [`test/types.ts`](test/types.ts) holds type-level gates that `tsc` must reject.
