# 3. The agent's database role has no write grant

Status: accepted · October 2026

## Context

Rules enforced only in application code can be bypassed by a bug or a new code path. If the agent could write through
any path, "agents only propose" would depend on every future change being careful.

## Decision

- The agent's reads run as their own database role, `munshi_agent`, which holds SELECT on snapshots and a few name-only
  views and nothing else: no INSERT, UPDATE, DELETE or TRUNCATE on any table, no temporary tables, no objects in any
  schema.
- `packages/agent` holds no connection pool. The app hands each run a port bound to one shop and one run; the port's
  only way to change anything is to propose a draft through core.
- A source-scanning test follows every import from `packages/agent` and fails on any path to a core writer, the app's
  pool or the database URL.
- Each process connects as its own least-privilege role, and the app refuses to boot if a pool is a superuser or can
  bypass row-level security.

## Consequences

- The guarantee holds in the database even if agent code is wrong.
- Some agent needs are served by the app on the member's behalf (minting a snapshot, reading a finding's state), which
  makes the port wider than a pure read-only client. Each such method is a bound function, never a pool.
- Grants are listed per table in manifests and checked against the built database, so a new grant shows up in review.

Code: [`db/schema/00_bootstrap.sql`](../../db/schema/00_bootstrap.sql),
[`db/schema/30_agent_views.sql`](../../db/schema/30_agent_views.sql),
[`apps/web/lib/server/agent-port.ts`](../../apps/web/lib/server/agent-port.ts),
[`packages/core/test/boundary.test.ts`](../../packages/core/test/boundary.test.ts).
