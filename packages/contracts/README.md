# @munshi/contracts

API v1 as zod schemas: every route's parameters, body, answers and error codes. They are the single source for the
server's validation, [`openapi.json`](openapi.json) and the SDK's types.

## Entry points

| File | What |
|---|---|
| [`src/v1`](src/v1) | One file per resource (catalogue, services, offers, packages, slots, bookings, orders, holds, reservations, enquiries, refs) and the shared figure and error shapes |
| [`src/v1/routes.ts`](src/v1/routes.ts) | Every operation: method, path, schemas |
| [`src/figures.ts`](src/figures.ts) | Walks every response schema and fails any number that sits outside the figure shapes (a cell with its ref) |
| [`src/build.ts`](src/build.ts) | `pnpm contracts`: writes `openapi.json` and `packages/sdk/src/schema.gen.ts` |

## Boundaries

- The web app's `/api/v1` pipeline parses every answer against its response schema before sending it.
- Both generated files are committed; a freshness test fails when either differs from a fresh generation.

## Testing

```bash
pnpm contracts                            # regenerate after changing a schema
pnpm --filter @munshi/contracts test
```
