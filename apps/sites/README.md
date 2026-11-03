# apps/sites

The shop websites built on the Munshi API (Next.js 16): a salon (`elite`) and a boutique (`prabhave`), both synthetic.
They show what the shop has published and send it requests (a booking request, an order, a hold on a piece, an
enquiry), which a person at the shop confirms.

## Entry points

| Path | What |
|---|---|
| [`next.config.ts`](next.config.ts) | One business per build, chosen by `MUNSHI_SITE` (`elite` or `prabhave`); no default |
| [`businesses/`](businesses) | Each business's profile, copy and art; only the built one reaches the bundle |
| [`app/[lang]`](app/[lang]) | The pages, in English and Hindi |
| [`lib/api.ts`](lib/api.ts) | The site's one door to the shop: the SDK, with `MUNSHI_API_URL` for server reads and the site's publishable key for browser writes |
| [`components/Figure.tsx`](components/Figure.tsx), [`components/Source.tsx`](components/Source.tsx) | A figure rendered from its cell, with its source; "Cannot verify" when it cannot be traced |

## Boundaries

- The sites hold no figure of their own. Every price, duration and count comes from the API at request time, as a cell
  with its ref.
- They depend only on [`@munshi/sdk`](../../packages/sdk); nothing from core, the database or the app.
- A build contains exactly one business (gate BUNDLE1 in [`test/bundle.test.ts`](test/bundle.test.ts)).
- Server-side reads send no Origin and no key; browser writes carry the site's publishable key and Origin, which the
  API checks against the site's own list.

## Running and testing

`pnpm dev` at the repository root prints each site's publishable key and the origin to run it on. To run one:

```bash
MUNSHI_SITE=elite MUNSHI_API_URL=http://localhost:3000 MUNSHI_SITE_KEY_ELITE=<key> pnpm --filter @munshi/sites dev --port 3150
pnpm --filter @munshi/sites test
```

Tests seed both showcase shops into a fresh embedded PostgreSQL 17, then answer every request the site makes with the
app's real `/api/v1` route handlers, with browser calls carrying the site's Origin as a browser would.
