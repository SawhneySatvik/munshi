# 11. One server process; shop and person come only from the session

Status: accepted · October 2026

## Context

Agent systems often run the agent as a separate service holding a token, and pass the tenant as a tool argument. That
puts the tenant within reach of the model and adds a credential to protect. Row-level security in PostgreSQL also
needs its context set reliably on pooled connections.

## Decision

- One server process. The agent runs inside the web app; there is no separate API service and no run token.
- The shop and the person come from the authenticated session, never from a model argument. No tool schema has a
  tenant field; a tool closes over the run's context.
- A `Session` is a branded type only core can make, from a verified cookie and a live session row. A hand-built one
  does not type-check.
- Database context (shop, actor, command) is set only with `SET LOCAL`, inside the transaction, in one function,
  `withTx`. Readers use `nullif(current_setting(k, true), '')`, because a pooled connection returns an empty string
  after a `SET LOCAL` transaction ends.

## Consequences

- A model cannot name another shop or another person, whatever text it reads.
- Context cannot leak between requests on a pooled connection; the transaction pooler is safe for every runtime role.
- The database trusts the actor setting from the app. A source-scanning gate holds that only `withTx` names it, which
  limits but does not remove that trust; see [security.md](../security.md#residual-risks).

Code: [`packages/core/src/session.ts`](../../packages/core/src/session.ts),
[`apps/web/lib/server/session.ts`](../../apps/web/lib/server/session.ts),
[`apps/web/lib/server/agent-port.ts`](../../apps/web/lib/server/agent-port.ts).
