# @munshi/sdk

A thin, typed `fetch` client for the Munshi API v1, with no runtime dependencies. Every figure it returns is a stored
cell with its ref; one that cannot be traced renders "Cannot verify".

```ts
import { createClient } from "@munshi/sdk";

const munshi = createClient({ baseUrl: "https://<munshi host>", key: "<publishable site key>" });
```

## Entry points

| File | What |
|---|---|
| [`src/index.ts`](src/index.ts) | `createClient`, one method per operation, and `MunshiError` with the contract's error codes |
| [`src/money.ts`](src/money.ts) | `formatMoney`, `isRef`, `CANNOT_VERIFY` |
| [`src/schema.gen.ts`](src/schema.gen.ts) | Types generated from [`@munshi/contracts`](../contracts) (`pnpm contracts`); each method's path is checked against them at compile time |
| [`scripts/pack.ts`](scripts/pack.ts) | `pnpm sdk:pack`: a tarball with its sha256 for the developer docs |

## Boundaries

- The publishable key travels only in a write's `Authorization` header. Nothing here logs.
- Depends on nothing at run time; the shop sites and the order widget use it as their only door to a shop.

## Testing

```bash
pnpm --filter @munshi/sdk test
```

The API itself is documented at `/developers` in the running app.
