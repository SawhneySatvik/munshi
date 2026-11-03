# apps/sites

The shop websites built on the Munshi API (Next.js 16): a salon (`elite`) and a boutique (`prabhave`), both synthetic.
They show what the shop has published and send it requests (a booking request, an order, a hold on a piece, an
enquiry), which a person at the shop confirms.

This folder is the sites' shared code, a source package (`@munshi/sites`), not an app of its own. Each business builds
as its own thin Next.js app, [`apps/elite`](../elite) and [`apps/prabhave`](../prabhave), whose routes re-export the
pages here. Each app has its own folder and its own `.next`, so the two never share a build output.

## Entry points

| Path | What |
|---|---|
| [`businesses/`](businesses) | Each business's profile, copy and art; a site app's `@business` alias reaches only its own |
| [`app/[lang]`](app/[lang]) | The pages, in English and Hindi, which each site app re-exports |
| [`proxy.ts`](proxy.ts) | English without a prefix (rewritten to `/en`); each site app re-exports it with its own matcher |
| [`lib/api.ts`](lib/api.ts), [`lib/api-base.ts`](lib/api-base.ts) | The site's one door to the shop: the SDK, the API's address on the server and in the browser, and the site's publishable key for browser writes |
| [`components/Figure.tsx`](components/Figure.tsx), [`components/Source.tsx`](components/Source.tsx) | A figure rendered from its cell, with its source; "Cannot verify" when it cannot be traced |

## Boundaries

- The sites hold no figure of their own. Every price, duration and count comes from the API at request time, as a cell
  with its ref.
- They depend only on [`@munshi/sdk`](../../packages/sdk); nothing from core, the database or the app. A site app
  depends only on this package (gate in [`test/closure.test.ts`](test/closure.test.ts)).
- A build contains exactly one business (gate BUNDLE1 in [`test/bundle.test.ts`](test/bundle.test.ts), which builds
  both site apps).
- Where the API is: a site's server reads it at `WEB_URL`, the address the deployed binding to the web app gives the
  site's functions (only at request time, never during a build), else at `MUNSHI_API_URL` (local). The browser calls
  `/api/v1` on the page's own origin, since the deployed sites share the web app's domain under `/s/<slug>`;
  `MUNSHI_PUBLIC_API_URL` overrides it (`pnpm dev` sets it, as each site runs on its own port there).
- Server-side reads send no Origin and no key; browser writes carry the site's publishable key and Origin, which the
  API checks against the site's own list.

## Running and testing

`pnpm dev` at the repository root starts both site apps, Elite at http://localhost:3150/s/elite and Prabhave at
http://localhost:3151/s/prabhave, each with the publishable key it just issued for that origin. To run one by hand
against a running app:

```bash
MUNSHI_API_URL=http://localhost:3000 MUNSHI_PUBLIC_API_URL=http://localhost:3000 MUNSHI_SITE_KEY_ELITE=<key> \
  pnpm --filter @munshi/elite dev --port 3150
pnpm --filter @munshi/sites test
```

The page tests seed both showcase shops into a fresh embedded PostgreSQL 17, then answer every request the site makes
with the app's real `/api/v1` route handlers, with browser calls carrying the site's Origin as a browser would. They
render the shared pages with `@business` aliased to each business in turn. The gate tests build both site apps, scan
their imports, and check that each app serves every shared route with its business and base path fixed.
