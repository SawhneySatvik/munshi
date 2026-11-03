# 7. Recorded mode is the default

Status: accepted · October 2026

## Context

Tests must be deterministic and must not need API keys. A demo must work on any laptop without keys or network, and
must not quietly spend money. But the code paths under test should be the same ones that run live.

## Decision

- `MUNSHI_MODEL_MODE` is `recorded` unless set. In recorded mode every model call goes through the real adapter path
  and is answered from a committed fixture, keyed by the sha256 of the request's canonical form. Nothing leaves the
  machine.
- A request with no fixture is a model error. Flows turn it into an abstention ("Cannot verify") or their template,
  never an error screen.
- `live` calls the providers; `record` calls them and saves the answers as new fixtures.
- Screens built on recorded answers say "Recorded response".

## Consequences

- The whole suite runs offline, with no keys, and the demo runs the same way.
- A recorded demo answers only the inputs it has fixtures for; the sample photos and voice clips in the repository are
  those inputs.
- Fixtures can drift from what a live model would say. Meta's fixtures in the repository are hand-written, because no
  live Meta call has been made yet; they are to be re-recorded once one is.
- Memory notes reach prompts only in live mode, so recording and replay stay identical.

Code: [`packages/ai/src/providers/fixtures.ts`](../../packages/ai/src/providers/fixtures.ts),
[`packages/ai/src/providers/client.ts`](../../packages/ai/src/providers/client.ts).
