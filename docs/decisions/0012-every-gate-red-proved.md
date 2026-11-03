# 12. Every gate is proven to fail; the database is never mocked

Status: accepted · October 2026

## Context

Security tests that pass for the wrong reason are worse than none: a typo'd filter, a test that never ran, or a harness
quirk can make a broken protection look green. One such quirk is real here: the embedded PostgreSQL package registers
an exit hook that calls `process.exit(0)`, so a failing test run could exit 0.

## Decision

- Tests that touch data run against a real PostgreSQL 17 built from the schema files, connecting as the runtime roles.
  Row-level security, grants and the book guard are what is under test, so they are never mocked.
- Every gate has a sabotage case that breaks exactly its protection (by SQL, a source mutation at load, or a harness
  switch). A red-proof harness requires the gate's test to pass clean and fail under the sabotage, judged from the test
  runner's JSON report. A sabotage that did not apply is an error, never a pass, and each full run proves that branch
  on planted cases.
- A test proves that a failing run exits non-zero despite the exit hook.

## Consequences

- A new or changed gate is not done until its red-proof shows RED.
- The suite is slower than a mocked one, and setup can time out under heavy load; re-running the file alone tells a
  timeout from a failure.
- The full red-proof sweep takes a long time and runs before releases; a change red-proves only its own cases.

Code: [`db/test/redproof.ts`](../../db/test/redproof.ts), [`db/test/v2/sabotage`](../../db/test/v2/sabotage),
[`db/test/v2/g8-exit-code.test.ts`](../../db/test/v2/g8-exit-code.test.ts). See [testing.md](../testing.md).
