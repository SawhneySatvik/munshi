# Munshi documentation

Start with the [project README](../README.md): what Munshi is, the One Guarantee, a tour of the screens and a quick
start.

| Document | What it covers |
|---|---|
| [architecture.md](architecture.md) | The system in depth: package boundaries, the database and its roles, snapshots, drafts and decisions, request flows, the agent layer, model routing, caching, channels and payments, the public API |
| [security.md](security.md) | The threat model and the controls, with the code that carries each; the superadmin console; residual risks |
| [testing.md](testing.md) | How the suites run on embedded PostgreSQL, the gate families, the red-proof harness, known flakiness |
| [deployment.md](deployment.md) | The hosted shape (Supabase and Vercel), the steps, the settings, and what is not yet verified |
| [limitations.md](limitations.md) | What is live, recorded or simulated, and where the guarantees are weaker than the headline |
| [decisions/](decisions/README.md) | Architecture decision records: the choices that shape the code, and their consequences |
| [model-probe-2026-10-31.md](model-probe-2026-10-31.md) | The recorded live probe of the model providers |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, conventions, the test rule and the review bar |

## Per package

| Package | README |
|---|---|
| The web app | [apps/web](../apps/web/README.md) |
| The shop websites | [apps/sites](../apps/sites/README.md) (shared code), [apps/elite](../apps/elite/README.md), [apps/prabhave](../apps/prabhave/README.md) |
| The domain | [packages/core](../packages/core/README.md) |
| The agent flows | [packages/agent](../packages/agent/README.md) |
| The model provider layer | [packages/ai](../packages/ai/README.md) |
| Channels, payments, identity, cache, media | [packages/adapters](../packages/adapters/README.md) |
| Configuration | [packages/config](../packages/config/README.md) |
| The API contract | [packages/contracts](../packages/contracts/README.md) |
| The API client | [packages/sdk](../packages/sdk/README.md) |
| The order widget | [packages/widgets](../packages/widgets/README.md) |
| The database | [db](../db/README.md) |

## For API users

The API documentation is served by the running app at `/developers`; its source pages are in [kit/](kit).
