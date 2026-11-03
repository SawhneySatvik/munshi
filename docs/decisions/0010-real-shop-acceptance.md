# 10. Real shops share the database and wait for the operator's acceptance

Status: accepted · November 2026

## Context

Munshi hosts sample shops (synthetic data, for demos) and real shops on one deployment. Anyone can sign up, and a
real shop's records and messages are personal data. The platform must not become a place to store or send arbitrary
data under a shop nobody has checked.

## Decision

- Real and sample shops live in one database, separated by `tenant_id` with row-level security forced on every table.
  Sessions, delivery and limits follow each shop's data class, not the deployment's.
- On a hosted or live deployment, a real shop signs up only through an email verified by Supabase Auth. The email link
  returns to the configured public origin, never to a request header.
- A new real shop waits for the operator's acceptance. Until then it writes nothing but its own creation: the books
  refuse it, and no inbound message is stored for it.
- A sign-up not accepted within 14 days is purged: names, logins, members and channel grants are erased or revoked; a
  tombstone keeps the audit chains whole.
- A new shop starts with AI off, and its public site hidden, until the operator enables them. Channel grants go only to
  accepted real shops.

## Consequences

- One deployment serves demos and real shops; a demo session can never reach a real shop's rows.
- Onboarding needs a human operator, which suits the current scale.
- On a managed database, platform-managed roles that bypass row-level security can read real shops' rows. This is a
  stated residual of the hosting choice.

Code: [`db/schema/29_open.sql`](../../db/schema/29_open.sql),
[`packages/core/src/jobs-signups.ts`](../../packages/core/src/jobs-signups.ts),
[`apps/web/app/(site)/sign-up/actions.ts`](../../apps/web/app/(site)/sign-up/actions.ts).
